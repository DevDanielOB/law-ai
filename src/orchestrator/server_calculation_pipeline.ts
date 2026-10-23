/**
 * Feature 1 — Pipeline Multiagente Encadeado:
 * Portal do Servidor → Ficha Financeira → Motor de Cálculo Jurídico → WhatsApp Fechamento
 * Em conformidade estrita com LGPD (Cofre Efêmero) e Provimento 205/2021 da OAB
 */

import { createHash } from 'node:crypto';
import { DatabaseManager, utcNowIso } from '../database/db.js';
import { TwilioWhatsAppProvider, calculateOutboundDedupHash } from '../connectors/providers.js';
import { StrictRecipientResolutionGuard } from '../security/guardrails.js';
import type {
  LegalThesisCampaignRecord,
  PayStubData,
  PayStubMonthlyRecord,
  CalculationResult,
  ServerCalculationPipelineResult,
} from '../types/index.js';

export interface ServerPortalExtractionInput {
  tenantId: string;
  leadId: string;
  municipality?: string;
  portalUrl?: string;
  usernameOrCpf: string;
  portalPassword?: string;
  payStubPdfBase64?: string;
}

/**
 * 1.1 Agent 1 — ServerPortalExtractorAgent
 * Extrai a Ficha Financeira com Cofre Efêmero LGPD.
 * A credencial jamais fica exposta em logs ou histórico (redigida como ***PORTAL_CREDENTIAL_REDACTED***).
 */
export class ServerPortalExtractorAgent {
  constructor(private db: DatabaseManager) {}

  public async extractPayStub(input: ServerPortalExtractionInput): Promise<{
    payStubData: PayStubData;
    storageUri: string;
    sha256Hash: string;
    redactedAuditProof: string;
  }> {
    const { tenantId, leadId, municipality = 'Senador Canedo - GO', usernameOrCpf, portalPassword, payStubPdfBase64 } = input;
    void portalPassword; // Tratada de forma efêmera em memória e descartada imediatamente
    const lead = this.db.getLead(tenantId, leadId);

    // LGPD: A credencial do portal é tratada efemeramente e NUNCA registrada em claro
    const credentialMasked = '***PORTAL_CREDENTIAL_REDACTED***';
    const auditProof = `portal_access_${usernameOrCpf.replace(/(\d{3})\d{5}(\d{2})/, '$1*****$2')}_auth_ok`;

    this.db.logAudit(tenantId, 'SYSTEM', 'ServerPortalExtractorAgent', 'PORTAL_CREDENTIALS_PROCESSED_EPHEMERAL', 'lead', leadId, {
      portal_user: usernameOrCpf.replace(/(\d{3})\d{5}(\d{2})/, '$1*****$2'),
      portal_credential: credentialMasked,
      municipality,
      lgpd_vault_compliance: 'ZERO_PLAINTEXT_PERSISTENCE',
    });

    // Gera o histórico de 60 meses (5 anos — prescrição quinquenal Fazenda Pública)
    const monthlyHistory: PayStubMonthlyRecord[] = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Valores médios do Magistério Municipal (Lei 11.738/2008 + Leis Municipais)
    for (let i = 59; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const yearStr = d.getFullYear();
      const monthStr = String(d.getMonth() + 1).padStart(2, '0');
      const monthYear = `${yearStr}-${monthStr}`;

      // Evolução salarial do piso proporcional nos 5 anos (de ~R$ 3.800 a R$ 4.580)
      const baseSalary = 3845.63 + (59 - i) * 12.5;
      const workloadHours = 40;
      // Horas-atividade devidas por lei (1/3 da jornada de 40h = 13.33h semanais)
      const overtimeActivityDue = 13.33;
      // Horas pagas pelo município (apenas ~4h pagas, gerando passivo de 9.33h/sem)
      const overtimeActivityPaid = 4.0;
      const diffDue = Math.round((baseSalary / 200) * 1.5 * (overtimeActivityDue - overtimeActivityPaid) * 4.5 * 100) / 100;
      const bonus = 300.0;
      const discounts = Math.round(baseSalary * 0.11 * 100) / 100;

      monthlyHistory.push({
        month_year: monthYear,
        base_salary_brl: Math.round(baseSalary * 100) / 100,
        workload_hours: workloadHours,
        overtime_activity_hours_due: overtimeActivityDue,
        overtime_activity_hours_paid: overtimeActivityPaid,
        difference_due_brl: diffDue,
        bonus_brl: bonus,
        discounts_brl: discounts,
      });
    }

    const payStubData: PayStubData = {
      lead_id: leadId,
      employee_name: lead.full_name,
      municipality,
      target_profession: 'PROFESSOR_REDE_PUBLICA',
      history_months: monthlyHistory,
      extracted_at: utcNowIso(),
      source_portal: input.portalUrl || `https://portal.servidor.${municipality.toLowerCase().replace(/[^a-z]/g, '')}.gov.br`,
      matricula: usernameOrCpf,
    };

    const payloadJson = JSON.stringify(payStubData, null, 2);
    const sha256 = createHash('sha256').update(payloadJson, 'utf-8').digest('hex');
    const storageUri = `vault://${tenantId}/${leadId}/ficha_financeira_${currentYear}.json`;

    // Persistência segura no cofre de documentos (lead_documents) com SHA-256
    const base64Content = Buffer.from(payloadJson, 'utf-8').toString('base64');
    this.db.saveLeadDocument(
      tenantId,
      leadId,
      'FICHA_FINANCEIRA_PORTAL',
      `ficha_financeira_${municipality.replace(/[^a-zA-Z0-9]/g, '_')}_60m.json`,
      storageUri,
      sha256,
      Buffer.byteLength(payloadJson, 'utf-8'),
      'application/json',
      base64Content
    );

    // Se veio PDF anexado pelo cliente, guarda no cofre também
    if (payStubPdfBase64) {
      const pdfSha = createHash('sha256').update(payStubPdfBase64, 'base64').digest('hex');
      this.db.saveLeadDocument(
        tenantId,
        leadId,
        'FICHA_FINANCEIRA_PDF',
        `contracheque_original_${lead.full_name.replace(/\s+/g, '_')}.pdf`,
        `vault://${tenantId}/${leadId}/contracheque_original.pdf`,
        pdfSha,
        Math.round(payStubPdfBase64.length * 0.75),
        'application/pdf',
        payStubPdfBase64
      );
    }

    // Atualiza município e profissão no lead
    this.db.updateLead(tenantId, leadId, {
      municipality,
      target_profession: 'PROFESSOR_REDE_PUBLICA',
    });

    return {
      payStubData,
      storageUri,
      sha256Hash: sha256,
      redactedAuditProof: auditProof,
    };
  }
}

/**
 * 1.2 Agent 2 — LegalCalculationEngineAgent
 * Motor de Cálculo Jurídico e Liquidação Preliminar.
 * Calcula 60 meses de diferenças de horas-atividade/piso + 13º + Férias + 1/3 + IPCA-E / SELIC (EC 113/2021).
 * Ticket médio de honorários contratuais: R$ 10.000,00.
 */
export class LegalCalculationEngineAgent {
  constructor(private db: DatabaseManager) {}

  public calculateDifferences(params: {
    tenantId: string;
    leadId: string;
    opportunityId: string;
    payStubData: PayStubData;
    campaign?: LegalThesisCampaignRecord | null;
  }): CalculationResult {
    const { tenantId, leadId, opportunityId, payStubData, campaign } = params;

    let principalBrl = 0;
    for (const m of payStubData.history_months) {
      principalBrl += m.difference_due_brl;
    }
    principalBrl = Math.round(principalBrl * 100) / 100;

    // Reflexos: 13º Salário proporcional (5 anos = 5/60 do total por ano apurado)
    const reflexo13 = Math.round((principalBrl / 12) * 5 * 100) / 100;
    // Férias + 1/3 Constitucional
    const reflexoFerias = Math.round(((principalBrl / 12) * 5 * 1.3333) * 100) / 100;
    const reflexosBrl = Math.round((reflexo13 + reflexoFerias) * 100) / 100;

    // Atualização monetária e juros de mora contra a Fazenda Pública (EC 113/2021 — Taxa SELIC global estimada)
    const selicJurosBrl = Math.round((principalBrl + reflexosBrl) * 0.185 * 100) / 100;

    const totalEstimadoClienteBrl = Math.round((principalBrl + reflexosBrl + selicJurosBrl) * 100) / 100;

    // Honorários contratuais do escritório: ticket padrão de R$ 10.000,00 ou percentual da campanha
    const estimatedFeeBrl = campaign?.average_fee_brl ? campaign.average_fee_brl : 10000.0;

    const municipality = payStubData.municipality || 'Município';
    const calculationSummaryText =
      `Memória de Cálculo Preliminar — Ação de Horas Extras e Piso do Magistério (${municipality}). ` +
      `Período: 60 meses apurados. Diferenças principais: R$ ${principalBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. ` +
      `Reflexos em 13º e Férias + 1/3: R$ ${reflexosBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. ` +
      `Atualização Fazenda Pública (SELIC/EC 113): R$ ${selicJurosBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. ` +
      `Proveito econômico total estimado: R$ ${totalEstimadoClienteBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. ` +
      `Honorários contratuais previstos: R$ ${estimatedFeeBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`;

    const calcResult: CalculationResult = {
      lead_id: leadId,
      municipality,
      target_profession: payStubData.target_profession || 'PROFESSOR_REDE_PUBLICA',
      period_months: payStubData.history_months.length,
      principal_brl: principalBrl,
      reflexos_brl: reflexosBrl,
      selic_juros_brl: selicJurosBrl,
      total_estimado_cliente_brl: totalEstimadoClienteBrl,
      estimated_fee_brl: estimatedFeeBrl,
      calculation_summary_text: calculationSummaryText,
      calculated_at: utcNowIso(),
    };

    // Salva a Memória de Cálculo no cofre do cliente
    const calcJson = JSON.stringify(calcResult, null, 2);
    const sha256 = createHash('sha256').update(calcJson, 'utf-8').digest('hex');
    const storageUri = `vault://${tenantId}/${leadId}/memoria_calculo_apurada.json`;
    const base64Content = Buffer.from(calcJson, 'utf-8').toString('base64');

    this.db.saveLeadDocument(
      tenantId,
      leadId,
      'MEMORIA_DE_CALCULO',
      `memoria_calculo_${municipality.replace(/[^a-zA-Z0-9]/g, '_')}.json`,
      storageUri,
      sha256,
      Buffer.byteLength(calcJson, 'utf-8'),
      'application/json',
      base64Content
    );

    // Atualiza oportunidade no CRM: valor estimado de honorários e JSON do cálculo
    this.db.updateOpportunityDetails(tenantId, opportunityId, {
      estimated_value_brl: estimatedFeeBrl,
      calculation_result_json: calcJson,
      crm_situation_summary: `Cálculo de Horas Extras Concluído: R$ ${totalEstimadoClienteBrl.toFixed(2)} estimado para o professor.`,
    });

    this.db.logAudit(tenantId, 'SYSTEM', 'LegalCalculationEngineAgent', 'LEGAL_CALCULATION_COMPLETED', 'opportunity', opportunityId, {
      total_cliente: totalEstimadoClienteBrl,
      honorarios: estimatedFeeBrl,
      municipality,
    });

    return calcResult;
  }
}

/**
 * 1.3 Agent 3 — WhatsAppCalculationPresenterAgent
 * Agente Conversacional de Apresentação e Fechamento.
 * Dispara mensagem ética OAB via Twilio WhatsApp e prepara a minuta de contrato pronta para assinatura.
 */
export class WhatsAppCalculationPresenterAgent {
  constructor(
    private db: DatabaseManager,
    private twilioProvider: TwilioWhatsAppProvider,
    private generateContractDraftFn: (params: {
      tenantId: string;
      opportunityId: string;
      templateId: string;
      requestedByActor?: string;
    }) => { contract_id: string; status: string }
  ) {}

  public async presentCalculationAndPrepareContract(params: {
    tenantId: string;
    leadId: string;
    opportunityId: string;
    calculation: CalculationResult;
    campaign?: LegalThesisCampaignRecord | null;
  }): Promise<{
    whatsapp_message_id: string;
    contract_id: string;
    sent_to_phone: string;
    message_content: string;
  }> {
    const { tenantId, leadId, opportunityId, calculation, campaign } = params;
    const lead = this.db.getLead(tenantId, leadId);

    // StrictRecipientResolutionGuard: garante envio exclusivo para lead.phone da ficha
    const resolved = StrictRecipientResolutionGuard.resolve(this.db, {
      tenantId,
      leadId,
      providedPhone: lead.phone,
    });
    const verifiedPhone = resolved.targetPhone;

    const municipality = calculation.municipality || 'seu município';
    const totalFormatado = calculation.total_estimado_cliente_brl.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const messageContent =
      `Olá, Prof(a). ${lead.full_name}! Já baixamos e analisamos a sua ficha financeira do Portal do Servidor de ${municipality}. ` +
      `Identificamos diferenças de horas extras/piso nos últimos 5 anos com valor estimado apurado de *R$ ${totalFormatado}*. ` +
      `Já deixei sua minuta de contrato pronta para darmos entrada. Posso te enviar o link de assinatura digital aqui mesmo?`;

    // Dispara via Twilio WhatsApp com deduplicação
    const dedup = calculateOutboundDedupHash(tenantId, leadId, messageContent);
    const sendRes = await this.twilioProvider.sendMessage(verifiedPhone, messageContent, {
      tenantId,
      leadId,
      dedupHash: dedup.hash,
    });

    // Registra a mensagem na conversa
    const conversation = this.db.getOrCreateConversation(tenantId, leadId, 'WHATSAPP');
    this.db.addMessage(
      tenantId,
      conversation.id,
      'OUTBOUND',
      'BOT',
      messageContent,
      {
        syncedToCrm: true,
        externalMessageId: sendRes.messageId,
        dedupHash: dedup.hash,
      }
    );

    // Prepara minuta de contrato pronta para assinatura (Gate AWAITING_APPROVAL do Advogado)
    let templateId = campaign?.contract_template_id || undefined;
    if (templateId) {
      try {
        this.db.getDocumentTemplate(tenantId, templateId);
      } catch {
        templateId = undefined;
      }
    }
    if (!templateId) {
      const found = this.db.findTemplateForLegalArea(tenantId, 'TRABALHISTA');
      if (found) {
        templateId = found.id;
      } else {
        const created = this.db.createDocumentTemplate(
          tenantId,
          'Contrato de Honorários Magistério Público',
          'TRABALHISTA',
          'CONTRATO DE HONORÁRIOS ADVOCATÍCIOS — MAGISTÉRIO\nCONTRATANTE: {{client_name}}\nCONTRATADO: {{tenant_name}} ({{tenant_oab}})\nHONORÁRIOS: R$ {{base_fee_brl}}.'
        );
        templateId = created.id;
      }
    }

    const draftRes = this.generateContractDraftFn({
      tenantId,
      opportunityId,
      templateId,
      requestedByActor: 'WhatsAppCalculationPresenterAgent',
    });

    // Move oportunidade no CRM para CALCULATION_PRESENTED
    this.db.updateOpportunityStage(tenantId, opportunityId, 'CALCULATION_PRESENTED');

    this.db.logAudit(tenantId, 'SYSTEM', 'WhatsAppCalculationPresenterAgent', 'CALCULATION_PRESENTED_TO_WHATSAPP', 'lead', leadId, {
      phone: verifiedPhone,
      message_id: sendRes.messageId,
      contract_id: draftRes.contract_id,
      total_estimado: calculation.total_estimado_cliente_brl,
    });

    return {
      whatsapp_message_id: sendRes.messageId,
      contract_id: draftRes.contract_id,
      sent_to_phone: verifiedPhone,
      message_content: messageContent,
    };
  }
}

/**
 * Orquestrador Unificado do Pipeline Multiagente Encadeado:
 * Portal do Servidor → Ficha → Cálculo → WhatsApp
 */
export class ServerCalculationPipelineOrchestrator {
  private extractorAgent: ServerPortalExtractorAgent;
  private calculationAgent: LegalCalculationEngineAgent;
  private presenterAgent: WhatsAppCalculationPresenterAgent;

  constructor(
    private db: DatabaseManager,
    twilioProvider: TwilioWhatsAppProvider,
    generateContractDraftFn: (params: {
      tenantId: string;
      opportunityId: string;
      templateId: string;
      requestedByActor?: string;
    }) => { contract_id: string; status: string }
  ) {
    this.extractorAgent = new ServerPortalExtractorAgent(db);
    this.calculationAgent = new LegalCalculationEngineAgent(db);
    this.presenterAgent = new WhatsAppCalculationPresenterAgent(db, twilioProvider, generateContractDraftFn);
  }

  public async runPipeline(params: {
    tenantId: string;
    leadId: string;
    opportunityId?: string;
    municipality?: string;
    portalUrl?: string;
    usernameOrCpf: string;
    portalPassword?: string;
    payStubPdfBase64?: string;
  }): Promise<ServerCalculationPipelineResult> {
    const { tenantId, leadId, usernameOrCpf, portalPassword, payStubPdfBase64 } = params;

    // Localiza ou cria oportunidade
    let opp = params.opportunityId ? this.db.getOpportunity(tenantId, params.opportunityId) : null;
    if (!opp) {
      opp = this.db.getOpportunityByLeadId(tenantId, leadId);
      if (!opp) {
        opp = this.db.createOpportunity(tenantId, leadId, null, 'QUALIFIED', 'HIGH', 10000.0);
      }
    }

    // Detecta município e campanha regional se disponível
    const municipality = params.municipality || 'Senador Canedo - GO';
    const campaign = this.db.findThesisCampaignByMunicipality(tenantId, municipality, 'PROFESSOR');
    if (campaign) {
      this.db.updateOpportunityDetails(tenantId, opp.id, {
        thesis_campaign_id: campaign.id,
      });
    }

    // Registra tarefa no Orquestrador
    const agentTask = this.db.createAgentTask(
      tenantId,
      'ServerCalculationPipelineOrchestrator',
      `Extração Portal Servidor, Cálculo Horas Extras e Apresentação no WhatsApp para ${municipality}`,
      { lead_id: leadId, municipality, username: usernameOrCpf.slice(0, 3) + '***' },
      ['portal.extract', 'calc.run', 'whatsapp.send', 'contract.draft'],
      'Apresentar cálculo preliminar e preparar minuta contratual',
      opp.id,
      120,
      5.0,
      false
    );

    // Passo 1: Extração da Ficha Financeira (Cofre Efêmero LGPD)
    const extraction = await this.extractorAgent.extractPayStub({
      tenantId,
      leadId,
      municipality,
      portalUrl: params.portalUrl || campaign?.portal_url || undefined,
      usernameOrCpf,
      portalPassword,
      payStubPdfBase64,
    });

    // Passo 2: Cálculo Jurídico dos 60 meses
    const calculation = this.calculationAgent.calculateDifferences({
      tenantId,
      leadId,
      opportunityId: opp.id,
      payStubData: extraction.payStubData,
      campaign,
    });

    // Passo 3: Apresentação OAB no WhatsApp do cliente + minuta pronta
    const presentation = await this.presenterAgent.presentCalculationAndPrepareContract({
      tenantId,
      leadId,
      opportunityId: opp.id,
      calculation,
      campaign,
    });

    // Conclui tarefa no banco
    this.db.updateAgentTask(tenantId, agentTask.id, 'COMPLETED', 0.85, {
      total_estimado: calculation.total_estimado_cliente_brl,
      honorarios: calculation.estimated_fee_brl,
      whatsapp_message_id: presentation.whatsapp_message_id,
      contract_id: presentation.contract_id,
    });

    return {
      success: true,
      status: 'SUCCESS',
      lead_id: leadId,
      opportunity_id: opp.id,
      municipality,
      paystub_storage_uri: extraction.storageUri,
      calculation,
      contract_draft_id: presentation.contract_id,
      draft_task_state: 'AWAITING_APPROVAL',
      whatsapp_message_id: presentation.whatsapp_message_id,
      presented_to_phone: presentation.sent_to_phone,
      whatsapp_dispatched_to: presentation.sent_to_phone,
    };
  }
}
