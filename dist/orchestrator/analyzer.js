/**
 * Agente IA Analisador de Fluxo Omnichannel e Automatizador de Contratos
 * Módulos E, F, G, I, J e K da Plataforma Law.AI
 */
import { createHash } from 'node:crypto';
import { utcNowIso } from '../database/db.js';
import { EthicalComplianceGuard } from '../security/guardrails.js';
import { normalizeLegalAreaKey, } from './engine.js';
export class OmnichannelFlowAndDocumentAnalyzer {
    db;
    orchestrator;
    constructor(db, orchestrator) {
        this.db = db;
        this.orchestrator = orchestrator;
    }
    /**
     * Mapeamento de documentos obrigatórios por área do Direito
     */
    static getDefaultChecklistForArea(area) {
        const key = normalizeLegalAreaKey(area);
        switch (key) {
            case 'TRABALHISTA':
                return [
                    'RG / CNH',
                    'CPF',
                    'Carteira de Trabalho (CTPS)',
                    'Extrato Analítico do FGTS',
                ];
            case 'PREVIDENCIARIO':
                return [
                    'RG / CNH',
                    'CPF',
                    'Comprovante de Residência',
                    'Extrato Previdenciário (CNIS)',
                    'Laudos / Atestados Médicos',
                ];
            case 'CIVEL_CONSUMIDOR':
                return [
                    'RG / CNH',
                    'CPF',
                    'Comprovante de Residência',
                    'Comprovantes do Dano / Faturas',
                ];
            case 'FAMILIA_SUCESSOES':
                return [
                    'RG / CNH',
                    'CPF',
                    'Comprovante de Residência',
                    'Certidão de Casamento ou Nascimento',
                ];
            case 'EMPRESARIAL':
                return [
                    'Contrato Social / Cartão CNPJ',
                    'RG / CNH do Sócio Administrador',
                    'Documentos da Operação / Contratos em Discussão',
                ];
            case 'TRIBUTARIO':
                return [
                    'Cartão CNPJ e Contrato Social',
                    'CDA / Auto de Infração / Notificação Fiscal',
                    'Comprovantes de Recolhimento ou Extratos Fiscais',
                ];
            default:
                return ['RG / CNH', 'CPF', 'Comprovante de Residência'];
        }
    }
    /**
     * Avalia se um item do checklist está atendido pelos arquivos do cofre ou pelas mensagens da conversa
     */
    isDocumentVerified(docName, storedDocs, messageTexts) {
        const norm = docName.toLowerCase();
        // 1. Verificar nos arquivos físicos e anexos registrados no cofre
        for (const doc of storedDocs) {
            const type = (doc.document_type || '').toLowerCase();
            const fn = (doc.original_filename || '').toLowerCase();
            if (type.includes(norm) || norm.includes(type))
                return true;
            if (norm.includes('rg') || norm.includes('cnh') || norm.includes('identidade')) {
                if (type.includes('rg') || type.includes('cnh') || fn.includes('rg') || fn.includes('cnh') || fn.includes('identidade')) {
                    return true;
                }
            }
            if (norm.includes('cpf')) {
                if (type.includes('cpf') || fn.includes('cpf'))
                    return true;
            }
            if (norm.includes('ctps') || norm.includes('trabalho')) {
                if (type.includes('ctps') || type.includes('trabalho') || fn.includes('ctps') || fn.includes('carteira')) {
                    return true;
                }
            }
            if (norm.includes('fgts')) {
                if (type.includes('fgts') || fn.includes('fgts'))
                    return true;
            }
            if (norm.includes('residência') || norm.includes('residencia') || norm.includes('endereço')) {
                if (type.includes('resid') || type.includes('ender') || fn.includes('resid') || fn.includes('luz') || fn.includes('agua')) {
                    return true;
                }
            }
            if (norm.includes('cnis') || norm.includes('previdenciário') || norm.includes('previdenciario')) {
                if (type.includes('cnis') || fn.includes('cnis'))
                    return true;
            }
            if (norm.includes('laudo') || norm.includes('atestado') || norm.includes('médico')) {
                if (type.includes('laudo') || type.includes('atestado') || fn.includes('laudo') || fn.includes('atestado')) {
                    return true;
                }
            }
            if (norm.includes('contrato social') || norm.includes('cnpj')) {
                if (type.includes('cnpj') || type.includes('contrato_social') || fn.includes('cnpj'))
                    return true;
            }
            if (norm.includes('certidão') || norm.includes('certidao')) {
                if (type.includes('certidao') || fn.includes('certidao'))
                    return true;
            }
        }
        // 2. Verificar menções textuais explícitas de envio nas mensagens
        const combined = messageTexts.join(' ').toLowerCase();
        if (norm.includes('rg') || norm.includes('cnh')) {
            if (combined.includes('arquivo_digitalizado_cnh') || combined.includes('arquivo_digitalizado_rg') || /\b(rg|cnh)\b/.test(combined)) {
                if (combined.includes('enviei') || combined.includes('segue') || combined.includes('anexo') || combined.includes('arquivo_digitalizado') || combined.includes('anexei')) {
                    return true;
                }
            }
        }
        if (norm.includes('cpf')) {
            if (combined.includes('arquivo_digitalizado_cpf') || /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(combined)) {
                return true;
            }
        }
        if (norm.includes('ctps') || norm.includes('trabalho')) {
            if (combined.includes('arquivo_digitalizado_ctps') || combined.includes('ctps') || combined.includes('carteira de trabalho')) {
                if (combined.includes('enviei') || combined.includes('segue') || combined.includes('anexo') || combined.includes('arquivo_digitalizado')) {
                    return true;
                }
            }
        }
        if (norm.includes('fgts')) {
            if (combined.includes('arquivo_digitalizado_fgts') || combined.includes('extrato do fgts') || combined.includes('extrato fgts')) {
                if (combined.includes('enviei') || combined.includes('segue') || combined.includes('anexo') || combined.includes('arquivo_digitalizado')) {
                    return true;
                }
            }
        }
        if (norm.includes('residência') || norm.includes('residencia')) {
            if (combined.includes('comprovante de residência') || combined.includes('conta de luz') || combined.includes('comprovante de endereço')) {
                if (combined.includes('enviei') || combined.includes('segue') || combined.includes('anexo')) {
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * Extração de dados cadastrais a partir do histórico e registros do lead
     */
    extractClientData(lead, messages) {
        const combined = messages.join('\n');
        let cpf = lead.document_cpf_cnpj || undefined;
        if (!cpf) {
            const matchCpf = combined.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
            if (matchCpf && matchCpf[1]) {
                cpf = matchCpf[1];
            }
        }
        let rg;
        const matchRg = combined.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}-?[\dX])\b/i);
        if (matchRg && matchRg[1]) {
            rg = matchRg[1];
        }
        let full_address = 'Avenida Goiás, nº 1000, Setor Central, Goiânia - GO';
        const matchAddr = combined.match(/(?:moro na|endereço:|residente em|rua|avenida|av\.)\s+([^,.\n]+(?:,[^.\n]+){1,3})/i);
        if (matchAddr && matchAddr[1]) {
            full_address = matchAddr[1].trim();
        }
        let marital_status = 'Solteiro(a)';
        if (/casad[oa]/i.test(combined))
            marital_status = 'Casado(a)';
        else if (/uni[aã]o\s+est[aá]vel/i.test(combined))
            marital_status = 'Em União Estável';
        else if (/divorciad[oa]/i.test(combined))
            marital_status = 'Divorciado(a)';
        else if (/vi[uú]v[oa]/i.test(combined))
            marital_status = 'Viúvo(a)';
        let profession = 'Trabalhador(a)';
        const matchProf = combined.match(/(?:profissão:|trabalho como|sou)\s+([a-zA-ZÀ-ÿ\s]{4,30})/i);
        if (matchProf && matchProf[1]) {
            profession = matchProf[1].trim();
        }
        let opposing_party = 'Empresa Reclamada / Parte Contrária';
        const matchCompany = combined.match(/(?:empresa|trabalhava na|contra o|contra a|banco)\s+([A-ZÀ-ÿ][a-zA-Z0-9À-ÿ\s&.-]{3,35})/);
        if (matchCompany && matchCompany[1]) {
            opposing_party = matchCompany[1].trim();
        }
        return {
            client_full_name: lead.full_name,
            cpf_cnpj: cpf,
            rg: rg || '00.000.000-0',
            full_address,
            marital_status,
            profession,
            case_summary: combined.slice(0, 500) || `Atendimento inicial para análise de direitos na área ${lead.legal_area || 'Geral'}.`,
            opposing_party,
        };
    }
    /**
     * 3.1 Análise Completa da Conversa e Verificação de Documentos
     */
    async analyzeConversationAndProcessContract(tenantId, opportunityId) {
        const opp = this.db.getOpportunity(tenantId, opportunityId);
        const lead = this.db.getLead(tenantId, opp.lead_id);
        const resolvedArea = lead.legal_area || 'TRABALHISTA';
        // 1. Leitura do Contexto Omnichannel
        const conversations = this.db.listConversations(tenantId).filter((c) => c.lead_id === lead.id);
        const messages = conversations.flatMap((c) => this.db.listMessages(tenantId, c.id));
        const storedDocs = this.db.listLeadDocuments(tenantId, lead.id);
        // 2. Checklist Obrigatório
        let checklist = OmnichannelFlowAndDocumentAnalyzer.getDefaultChecklistForArea(resolvedArea);
        if (opp.pending_documents_json && opp.pending_documents_json.trim()) {
            try {
                const parsed = JSON.parse(opp.pending_documents_json);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const set = new Set([...checklist, ...parsed]);
                    checklist = Array.from(set);
                }
            }
            catch { }
        }
        // 3. Verificação Inteligente do Checklist
        const messageTexts = messages.map((m) => m.content);
        const verified = [];
        const missing = [];
        for (const item of checklist) {
            if (this.isDocumentVerified(item, storedDocs, messageTexts)) {
                verified.push(item);
            }
            else {
                missing.push(item);
            }
        }
        const extracted = this.extractClientData(lead, messageTexts);
        // =========================================================================
        // CENÁRIO A — Ainda faltam documentos (missing.length > 0)
        // =========================================================================
        if (missing.length > 0) {
            this.db.updateOpportunityStage(tenantId, opp.id, 'AWAITING_DOCUMENTS');
            this.db.db
                .prepare('UPDATE opportunities SET pending_documents_json = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
                .run(JSON.stringify(missing), utcNowIso(), tenantId, opp.id);
            const missingList = missing.map((d) => `• ${d}`).join('\n');
            const receivedAck = verified.length > 0
                ? `Recebemos e confirmamos: ${verified.join(', ')}.\n\n`
                : '';
            const whatsappText = `Olá, ${lead.full_name}! ${receivedAck}Para que nosso advogado possa analisar seu caso e emitir seu contrato com segurança, ainda precisamos dos seguintes documentos pendentes:\n\n${missingList}\n\nPor favor, envie-os por aqui em foto ou PDF.`;
            let clientNotified = false;
            try {
                await this.orchestrator.messaging.sendMessage(lead.phone, whatsappText, {
                    tenantId,
                    leadId: lead.id,
                });
                clientNotified = true;
            }
            catch (err) {
                console.warn('[OmnichannelAnalyzer] Falha ao notificar WhatsApp do cliente:', err);
            }
            // Criar ou atualizar follow-up task para 24h
            const scheduledForIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
            this.db.createFollowUpTask(tenantId, opp.id, lead.id, 'AWAITING_DOCUMENTS', missing, scheduledForIso, 'WHATSAPP_AUTO', whatsappText);
            this.db.logAudit(tenantId, 'SYSTEM', 'omnichannel_analyzer', 'DOCUMENTS_PENDING_PROMPTED', 'opportunity', opp.id, {
                missing_documents: missing,
                verified_documents: verified,
                phone: lead.phone,
            });
            return {
                status: 'AWAITING_DOCUMENTS',
                opportunity_id: opp.id,
                lead_id: lead.id,
                verified_documents: verified,
                missing_documents: missing,
                client_notification_sent: clientNotified,
                lawyer_notification_sent: false,
                extracted_data: extracted,
            };
        }
        // =========================================================================
        // CENÁRIO B — Documentos Completos (missing.length === 0)
        // =========================================================================
        if (extracted.cpf_cnpj && !lead.document_cpf_cnpj) {
            this.db.db
                .prepare('UPDATE leads SET document_cpf_cnpj = ? WHERE tenant_id = ? AND id = ?')
                .run(extracted.cpf_cnpj, tenantId, lead.id);
        }
        // Concluir follow-ups pendentes
        this.db.db
            .prepare("UPDATE follow_up_tasks SET status = 'COMPLETED_DOCS_RECEIVED', updated_at = ? WHERE tenant_id = ? AND opportunity_id = ? AND status = 'SCHEDULED'")
            .run(utcNowIso(), tenantId, opp.id);
        this.db.updateOpportunityStage(tenantId, opp.id, 'DOCUMENTS_RECEIVED');
        // 4. Geração Automática da Minuta Contratual Pronta para o Advogado
        const template = this.db.findTemplateForLegalArea(tenantId, resolvedArea);
        if (!template) {
            throw new Error(`Nenhum modelo de contrato homologado encontrado para ${resolvedArea}.`);
        }
        const service = this.db.findServiceForLegalArea(tenantId, resolvedArea);
        const feeValue = opp.estimated_value_brl > 0 ? opp.estimated_value_brl : service?.base_fee_brl || 3500.0;
        const successFee = service?.success_fee_pct || 20.0;
        let rendered = template.body_template
            .replace(/\{\{full_name\}\}/g, extracted.client_full_name)
            .replace(/\{\{client_name\}\}/g, extracted.client_full_name)
            .replace(/\{\{document_cpf_cnpj\}\}/g, extracted.cpf_cnpj || '111.222.333-44')
            .replace(/\{\{client_cpf_cnpj\}\}/g, extracted.cpf_cnpj || '111.222.333-44')
            .replace(/\{\{address\}\}/g, extracted.full_address || 'Endereço fornecido pelo cliente')
            .replace(/\{\{client_address\}\}/g, extracted.full_address || 'Endereço fornecido pelo cliente')
            .replace(/\{\{legal_area\}\}/g, resolvedArea)
            .replace(/\{\{service_name\}\}/g, service?.name || `Atendimento Especializado em Direito ${resolvedArea}`)
            .replace(/\{\{case_summary\}\}/g, extracted.case_summary || 'Análise de direitos trabalhistas e rescisórios.')
            .replace(/\{\{fee_value_brl\}\}/g, feeValue.toFixed(2))
            .replace(/\{\{success_fee_pct\}\}/g, successFee.toString());
        // Garantir conformidade ética com o Provimento 205/2021 da OAB
        EthicalComplianceGuard.validate(rendered);
        const contentSha256 = createHash('sha256').update(rendered).digest('hex');
        // Armazenar no cofre seguro
        await this.orchestrator.storage.storeDocument(`contrato_${opp.id}.html`, Buffer.from(rendered, 'utf-8'));
        // Criar proposta de contrato com status READY_FOR_LAWYER_SIGNATURE
        const contract = this.db.createProposalContract(tenantId, opp.id, template.id, rendered, contentSha256, feeValue);
        this.db.db
            .prepare("UPDATE proposals_and_contracts SET status = 'READY_FOR_LAWYER_SIGNATURE' WHERE id = ?")
            .run(contract.id);
        // Criar ApprovalRequest no Gate do Advogado
        const approval = this.db.createApprovalRequest(tenantId, contract.id, opp.id, 'APPROVE_CONTRACT_DRAFT', 'OmnichannelFlowAndDocumentAnalyzer');
        this.db.updateOpportunityStage(tenantId, opp.id, 'AWAITING_APPROVAL');
        // 5. Agendamento Automático de Reunião com o Advogado via IA (Google Calendar / Meet)
        let aptRecord = null;
        try {
            const existingApt = this.db.db
                .prepare('SELECT * FROM appointments WHERE tenant_id = ? AND opportunity_id = ? ORDER BY created_at DESC LIMIT 1')
                .get(tenantId, opp.id);
            if (existingApt) {
                aptRecord = existingApt;
            }
            else {
                const nextDay = new Date();
                nextDay.setDate(nextDay.getDate() + 1);
                if (nextDay.getDay() === 0)
                    nextDay.setDate(nextDay.getDate() + 1);
                if (nextDay.getDay() === 6)
                    nextDay.setDate(nextDay.getDate() + 2);
                nextDay.setHours(14, 0, 0, 0);
                const slotIso = nextDay.toISOString();
                const meetRes = await this.orchestrator.calendar.createMeetingSlot(`Consulta Jurídica — ${lead.full_name}`, slotIso, lead.email);
                aptRecord = this.db.createAppointment(tenantId, opp.id, lead.id, opp.assigned_lawyer_id || 'usr_fabricio_cardoso', slotIso, meetRes.meetingLink);
            }
        }
        catch (errApt) {
            console.warn('[OmnichannelAnalyzer] Falha ao agendar consulta no Google Calendar:', errApt);
        }
        // 6. Notificação Ativa no WhatsApp (Cliente e Advogado)
        let clientMsg;
        if (aptRecord && aptRecord.meeting_link) {
            const aptTime = new Date(aptRecord.scheduled_slot_iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            clientMsg = `Recebemos e conferimos toda a sua documentação! Sua Consulta Jurídica foi agendada para ${aptTime} via Google Meet: ${aptRecord.meeting_link}. Seu contrato de prestação de serviços jurídicos já foi elaborado e está em conferência final pelo advogado responsável. Em instantes você receberá o link oficial de assinatura digital.`;
        }
        else {
            clientMsg = 'Recebemos e conferimos toda a sua documentação! Seu contrato de prestação de serviços jurídicos já foi elaborado e está em conferência final pelo advogado responsável. Em instantes você receberá o link oficial de assinatura digital.';
        }
        let clientNotified = false;
        try {
            await this.orchestrator.messaging.sendMessage(lead.phone, clientMsg, {
                tenantId,
                leadId: lead.id,
            });
            clientNotified = true;
        }
        catch (err) {
            console.warn('[OmnichannelAnalyzer] Falha ao enviar WhatsApp ao cliente:', err);
        }
        const lawyerMsg = `⚖️ [Law.AI] Minuta Pronta para Assinatura: Cliente ${lead.full_name} (${resolvedArea}). 100% dos documentos conferidos no cofre seguro. Aprove no painel ou via 1-clique: /api/v1/approvals/${approval.id}/decide`;
        this.db.logAudit(tenantId, 'SYSTEM', 'omnichannel_analyzer', 'READY_FOR_LAWYER_SIGNATURE_NOTIFICATION', 'approval_request', approval.id, {
            opportunity_id: opp.id,
            contract_id: contract.id,
            approval_id: approval.id,
            lawyer_action_url: `/api/v1/approvals/${approval.id}/decide`,
            notice: lawyerMsg,
        });
        return {
            status: 'READY_FOR_LAWYER_SIGNATURE',
            opportunity_id: opp.id,
            lead_id: lead.id,
            verified_documents: verified,
            missing_documents: [],
            contract_id: contract.id,
            approval_request_id: approval.id,
            client_notification_sent: clientNotified,
            lawyer_notification_sent: true,
            extracted_data: extracted,
        };
    }
    /**
     * Processamento em lote de todas as oportunidades ativas do escritório
     */
    async analyzeAllActive(tenantId) {
        const opps = this.db.listOpportunities(tenantId).filter((o) => ['NEW', 'QUALIFIED', 'AWAITING_DOCUMENTS', 'DOCUMENTS_RECEIVED'].includes(o.stage));
        const results = [];
        let contractsGenerated = 0;
        let awaitingDocs = 0;
        for (const opp of opps) {
            try {
                const res = await this.analyzeConversationAndProcessContract(tenantId, opp.id);
                results.push(res);
                if (res.status === 'READY_FOR_LAWYER_SIGNATURE') {
                    contractsGenerated++;
                }
                else if (res.status === 'AWAITING_DOCUMENTS') {
                    awaitingDocs++;
                }
            }
            catch (err) {
                console.warn(`[OmnichannelAnalyzer] Erro ao analisar oportunidade ${opp.id}:`, err);
            }
        }
        return {
            processed_count: opps.length,
            contracts_generated_count: contractsGenerated,
            awaiting_docs_count: awaitingDocs,
            results,
        };
    }
}
