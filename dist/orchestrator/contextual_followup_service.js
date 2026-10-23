/**
 * Feature 2 — Importação de Contatos do WhatsApp com Contexto da Última Conversa
 * e "Follow-up Geral com 1 Único Comando" (OneClickContextualFollowUpService)
 */
import { calculateOutboundDedupHash } from '../connectors/providers.js';
import { StrictRecipientResolutionGuard } from '../security/guardrails.js';
export class OneClickContextualFollowUpService {
    db;
    twilioProvider;
    constructor(db, twilioProvider) {
        this.db = db;
        this.twilioProvider = twilioProvider;
    }
    /**
     * 2.1 Sincronização de Contatos e Resumo Automático da Última Conversa
     */
    async syncWhatsAppContacts(tenantId, contactsInput) {
        this.db.requireTenant(tenantId);
        // Se não foram fornecidos contatos no payload, sincroniza com as conversas existentes no tenant
        const rawContacts = contactsInput || [];
        if (rawContacts.length === 0) {
            const convs = this.db.listConversations(tenantId);
            for (const c of convs) {
                const msgs = this.db.listMessages(tenantId, c.id);
                rawContacts.push({
                    phone: c.lead_phone,
                    name: c.lead_name,
                    messages: msgs.map((m) => ({
                        direction: m.direction,
                        content: m.content,
                        timestamp: m.created_at,
                    })),
                });
            }
        }
        let createdCount = 0;
        let updatedCount = 0;
        const syncedContacts = [];
        for (const c of rawContacts) {
            if (!c.phone)
                continue;
            let lead = this.db.findLeadByPhone(tenantId, c.phone);
            if (!lead) {
                lead = this.db.createLead(tenantId, c.name || `Contato WhatsApp ${c.phone.slice(-4)}`, c.phone, c.email ?? null, null, 'WHATSAPP', 'TRABALHISTA', 'NORMAL', 40, {}, c.municipality, c.targetProfession);
                createdCount++;
            }
            else {
                // Atualiza campos se fornecidos
                if (c.name || c.municipality || c.targetProfession) {
                    lead = this.db.updateLead(tenantId, lead.id, {
                        full_name: c.name || lead.full_name,
                        municipality: c.municipality || lead.municipality,
                        target_profession: c.targetProfession || lead.target_profession,
                    });
                }
                updatedCount++;
            }
            // Garante que o histórico de mensagens está no banco
            const conv = this.db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');
            if (c.messages && c.messages.length > 0) {
                for (const m of c.messages) {
                    const hash = calculateOutboundDedupHash(tenantId, lead.id, m.content).hash;
                    this.db.addMessage(tenantId, conv.id, m.direction, m.direction === 'INBOUND' ? 'LEAD' : 'BOT', m.content, {
                        syncedToCrm: true,
                        dedupHash: hash,
                    });
                }
            }
            // Recupera mensagens atualizadas
            const allMsgs = this.db.listMessages(tenantId, conv.id);
            const lastMessages = allMsgs.slice(-5);
            // Gera contexto inteligente da última conversa
            const contextAnalysis = this.analyzeLastConversation(lead, lastMessages, c.municipality);
            // Localiza ou cria oportunidade
            let opp = this.db.getOpportunityByLeadId(tenantId, lead.id);
            if (!opp) {
                opp = this.db.createOpportunity(tenantId, lead.id, null, 'QUALIFIED', contextAnalysis.temperature === 'HOT' ? 'HIGH' : 'MEDIUM', 10000.0, null, [], contextAnalysis.summaryNotes);
            }
            // Atualiza as Observações do CRM com o contexto da última conversa
            this.db.updateOpportunityDetails(tenantId, opp.id, {
                last_conversation_context_notes: contextAnalysis.summaryNotes,
                priority: contextAnalysis.temperature === 'HOT' ? 'HIGH' : opp.priority,
            });
            // Atualiza também município e score no lead se inferido
            if (contextAnalysis.inferredMunicipality && !lead.municipality) {
                this.db.updateLead(tenantId, lead.id, {
                    municipality: contextAnalysis.inferredMunicipality,
                    target_profession: 'PROFESSOR_REDE_PUBLICA',
                    qualification_score: contextAnalysis.temperature === 'HOT' ? 85 : 60,
                });
            }
            syncedContacts.push({
                lead_id: lead.id,
                opportunity_id: opp.id,
                phone: lead.phone,
                name: lead.full_name,
                temperature: contextAnalysis.temperature,
                municipality: contextAnalysis.inferredMunicipality || (lead.municipality ? lead.municipality : undefined),
                context_notes: contextAnalysis.summaryNotes,
            });
        }
        this.db.logAudit(tenantId, 'USER', 'OneClickContextualFollowUpService', 'WHATSAPP_CONTACTS_SYNCED', 'crm', tenantId, {
            total: rawContacts.length,
            created: createdCount,
            updated: updatedCount,
        });
        return {
            synced_count: rawContacts.length,
            created_leads_count: createdCount,
            updated_leads_count: updatedCount,
            contacts: syncedContacts,
        };
    }
    /**
     * 2.2 Execução de Todos os Follow-ups com 1 Único Comando
     * Dispara para todos os leads elegíveis usando a mensagem personalizada baseada no contexto.
     */
    async executeAllFollowUps(tenantId) {
        this.db.requireTenant(tenantId);
        const eligible = this.db.listEligibleFollowUpOpportunities(tenantId);
        let executedCount = 0;
        let skippedCount = 0;
        const dispatches = [];
        for (const item of eligible) {
            const { lead } = item;
            if (lead.opt_out) {
                skippedCount++;
                continue;
            }
            // Enforça estritamente o WhatsApp da ficha
            const resolved = StrictRecipientResolutionGuard.resolve(this.db, {
                tenantId,
                leadId: lead.id,
                providedPhone: lead.phone,
            });
            const verifiedPhone = resolved.targetPhone;
            const contextNotes = item.last_conversation_context_notes || '';
            const messageContent = this.generateContextualFollowUpMessage(lead, contextNotes, item);
            // Verificação de deduplicação
            const dedup = calculateOutboundDedupHash(tenantId, lead.id, messageContent);
            const isDuplicate = this.db.isOutboundMessageDuplicate(tenantId, dedup.hash, 90);
            if (isDuplicate) {
                skippedCount++;
                continue;
            }
            // Dispara via WhatsApp
            const sendRes = await this.twilioProvider.sendMessage(verifiedPhone, messageContent, {
                tenantId,
                leadId: lead.id,
                dedupHash: dedup.hash,
            });
            // Registra mensagem na conversa
            const conv = this.db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');
            this.db.addMessage(tenantId, conv.id, 'OUTBOUND', 'BOT', messageContent, {
                syncedToCrm: true,
                externalMessageId: sendRes.messageId,
                dedupHash: dedup.hash,
            });
            // Atualiza CRM
            this.db.updateOpportunityDetails(tenantId, item.id, {
                crm_situation_summary: `Follow-up contextual executado em ${new Date().toLocaleDateString('pt-BR')}`,
            });
            executedCount++;
            dispatches.push({
                lead_id: lead.id,
                opportunity_id: item.id,
                phone: verifiedPhone,
                name: lead.full_name,
                context_used: contextNotes,
                message_content: messageContent,
                whatsapp_message_id: sendRes.messageId,
            });
        }
        this.db.logAudit(tenantId, 'USER', 'lawyer_batch_trigger', 'ALL_FOLLOWUPS_EXECUTED_ONE_CLICK', 'crm', tenantId, {
            executed: executedCount,
            skipped: skippedCount,
        });
        return {
            executed_count: executedCount,
            skipped_count: skippedCount,
            dispatches,
        };
    }
    /**
     * Helper: Analisa as últimas mensagens trocadas e gera o contexto objetivo
     */
    analyzeLastConversation(lead, messages, explicitMunicipality) {
        const textCorpus = messages.map((m) => m.content).join(' ').toLowerCase();
        // Detecção de Município
        let muni = explicitMunicipality || (lead.municipality ? lead.municipality : undefined);
        if (!muni) {
            if (textCorpus.includes('senador canedo'))
                muni = 'Senador Canedo - GO';
            else if (textCorpus.includes('luziânia') || textCorpus.includes('luziania'))
                muni = 'Luziânia - GO';
            else if (textCorpus.includes('nerópolis') || textCorpus.includes('neropolis'))
                muni = 'Nerópolis - GO';
            else if (textCorpus.includes('rio verde'))
                muni = 'Rio Verde - GO';
        }
        // Detecção de Temperatura e Pendência
        let temperature = 'WARM';
        let topicSummary = '';
        if (textCorpus.includes('senha') || textCorpus.includes('portal') || textCorpus.includes('contracheque') || textCorpus.includes('ficha')) {
            temperature = 'HOT';
            topicSummary = `Professor(a)${muni ? ` em ${muni}` : ''} — conversou sobre ação de horas extras, ficou de enviar dados do Portal do Servidor para cálculo.`;
        }
        else if (textCorpus.includes('contrato') || textCorpus.includes('assinar') || textCorpus.includes('procuração')) {
            temperature = 'HOT';
            topicSummary = `Cliente com minuta contratual apresentada, aguardando assinatura digital.`;
        }
        else if (textCorpus.includes('valor') || textCorpus.includes('quanto') || textCorpus.includes('direito')) {
            temperature = 'WARM';
            topicSummary = `Tirou dúvidas preliminares sobre direito às diferenças salariais de horas-atividade.`;
        }
        else if (messages.length === 0) {
            temperature = 'COLD';
            topicSummary = `Contato importado da agenda telefônica, sem interação recente registrada.`;
        }
        else {
            const last = messages[messages.length - 1];
            topicSummary = `Última mensagem trocada: "${last.content.slice(0, 80)}...". Próxima ação: resgatar diálogo operacional.`;
        }
        return {
            summaryNotes: topicSummary,
            temperature,
            inferredMunicipality: muni,
        };
    }
    /**
     * Helper: Gera mensagem de follow-up 100% personalizada a partir do contexto
     */
    generateContextualFollowUpMessage(lead, contextNotes, opp) {
        const firstName = lead.full_name.split(' ')[0] || 'Cliente';
        const notesLower = contextNotes.toLowerCase();
        const muni = lead.municipality || 'sua rede de ensino';
        if (notesLower.includes('portal') || notesLower.includes('senha') || notesLower.includes('ficha')) {
            return `Olá, Prof(a). ${firstName}! Tudo bem? Passando para saber se você conseguiu acessar o Portal do Servidor de ${muni} para nos enviar a matrícula/senha ou a ficha financeira. Nossa equipe jurídica já está com o simulador pronto para apurar suas horas extras dos últimos 5 anos!`;
        }
        if (notesLower.includes('contrato') || notesLower.includes('assinar') || opp.stage === 'CALCULATION_PRESENTED') {
            return `Olá, Prof(a). ${firstName}! Espero que esteja bem. Sua minuta de contrato e procuração para a ação de horas extras de ${muni} já está pronta para formalização digital. Ficou alguma dúvida sobre o cálculo que possamos esclarecer?`;
        }
        if ((lead.video_watched_pct ?? 0) >= 50) {
            return `Oi, Prof(a). ${firstName}! Vi que você assistiu ao nosso vídeo explicativo sobre o direito às horas extras dos professores de ${muni}. Se quiser que façamos o levantamento preliminar do seu caso sem custo, basta nos responder por aqui!`;
        }
        return `Olá, Prof(a). ${firstName}! Aqui é da equipe jurídica do escritório Cardoso & Associados. Estamos dando andamento aos atendimentos dos professores de ${muni} sobre a recomposição das horas-atividade. Como podemos te ajudar hoje?`;
    }
}
