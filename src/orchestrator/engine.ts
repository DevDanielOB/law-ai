import { createHash } from 'node:crypto';
import { DatabaseManager } from '../database/db.js';
import {
  AuthAndRbacManager,
  EthicalComplianceGuard,
  PromptInjectionGuard,
  ConversationLockManager,
} from '../security/guardrails.js';
import {
  AIModelProvider,
  AsaasPaymentAdapter,
  BrazilESignatureAdapter,
  CalendarProvider,
  DocumentStorageProvider,
  EmailProvider,
  ESignatureProvider,
  GoogleCalendarAdapter,
  GoogleWorkspaceEmailAdapter,
  LegalAIModelAdapter,
  LocalVaultStorageAdapter,
  MessagingProvider,
  PaymentProvider,
  TelephonyProvider,
  TwilioElevenLabsVoiceAdapter,
  WhatsAppCloudMessagingAdapter,
  TwilioWhatsAppProvider,
  verifyWebhookHmac,
  calculateOutboundDedupHash,
} from '../connectors/providers.js';
import { OmnichannelFlowAndDocumentAnalyzer } from './analyzer.js';
import { DocumentVisionClassifier } from './vision_classifier.js';
import { SchedulingAndCalendarAgent } from './scheduling_agent.js';
import { ServerCalculationPipelineOrchestrator } from './server_calculation_pipeline.js';
import { OneClickContextualFollowUpService } from './contextual_followup_service.js';
import { LegalThesisCampaignManager, WordOfMouthAndVideoTriggerEngine } from './campaign_and_referral_engine.js';
import type {
  OpportunityRecord,
  OpportunityStage,
  IntakeStartRequest,
  IntakeQuestion,
  IntakeStartResponse,
  IntakeCompleteRequest,
  IntakeCompleteResponse,
  IntakeContractResponse,
  IntakeStatusResponse,
} from '../types/index.js';

export class BudgetExceededError extends Error {
  constructor(message: string = 'Limite mensal de orçamento de IA do escritório atingido.') {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class DocumentChecklistExtractor {
  public static readonly KNOWN_LEGAL_DOCUMENTS: [string, RegExp][] = [
    ['RG / CNH', /\b(rg|cnh|identidade|documento\s+com\s+foto)\b/i],
    ['CPF', /\b(cpf)\b/i],
    ['Comprovante de Residência', /\b(comprovante\s+de\s+resid[eê]ncia|conta\s+de\s+luz|conta\s+de\s+[aá]gua|comprovante\s+de\s+endere[cç]o)\b/i],
    ['Carteira de Trabalho (CTPS)', /\b(ctps|carteira\s+de\s+trabalho)\b/i],
    ['Extrato Analítico do FGTS', /\b(extrato\s+(do\s+|anal[ií]tico\s+do\s+)?fgts|fgts)\b/i],
    ['Termo de Rescisão (TRCT)', /\b(trct|termo\s+de\s+rescis[aã]o|rescis[aã]o)\b/i],
    ['Holerites / Contracheques', /\b(holerite[s]?|contracheque[s]?|recibo[s]?\s+de\s+sal[aá]rio)\b/i],
    ['Extrato Previdenciário (CNIS)', /\b(cnis|extrato\s+previdenci[aá]rio|carta\s+de\s+indeferimento)\b/i],
    ['Laudos / Atestados Médicos', /\b(laudo[s]?\s+m[eé]dico[s]?|atestado[s]?|receita[s]?\s+m[eé]dica[s]?)\b/i],
    ['Contrato Social / CNPJ', /\b(contrato\s+social|altera[cç][aã]o\s+contratual|cart[aã]o\s+cnpj)\b/i],
    ['Certidão de Casamento / Nascimento', /\b(certid[aã]o\s+de\s+(casamento|nascimento|[oó]bito))\b/i],
  ];

  public static readonly LIST_INTENT_KEYWORDS: RegExp[] = [
    /lista\s+de\s+documentos/i,
    /documentos\s+necess[aá]rios/i,
    /preciso\s+que\s+(me\s+)?(envie|mande)\s+os\s+(seguintes\s+)?documentos/i,
    /segue\s+a\s+rela[cç][aã]o\s+de\s+documentos/i,
    /documenta[cç][aã]o\s+para\s+dar\s+andamento/i,
    /separar\s+os\s+documentos/i,
    /checklist\s+de\s+documentos/i,
  ];

  public static readonly CLIENT_SENT_DOCS_KEYWORDS: RegExp[] = [
    /segue(m)?\s+os\s+documentos/i,
    /enviei\s+os\s+documentos/i,
    /anexei\s+o\s+(rg|cpf|ctps|fgts|comprovante|documento)/i,
    /t[aá]\s+aqui\s+a\s+documenta[cç][aã]o/i,
    /acabei\s+de\s+mandar\s+os\s+pdf/i,
  ];

  public static extractRequestedDocuments(messageText: string): { isChecklist: boolean; documents: string[] } {
    if (!messageText) return { isChecklist: false, documents: [] };
    const foundDocs: string[] = [];
    for (const [label, regex] of this.KNOWN_LEGAL_DOCUMENTS) {
      if (regex.test(messageText)) {
        foundDocs.push(label);
      }
    }
    const hasListIntent = this.LIST_INTENT_KEYWORDS.some((regex) => regex.test(messageText));
    const isChecklist = hasListIntent || foundDocs.length >= 2;
    if (isChecklist && foundDocs.length === 0) {
      foundDocs.push('RG / CNH', 'CPF', 'Comprovante de Residência', 'Documentos Específicos do Caso');
    }
    return { isChecklist, documents: foundDocs };
  }

  public static detectClientSentDocuments(messageText: string): boolean {
    if (!messageText) return false;
    return this.CLIENT_SENT_DOCS_KEYWORDS.some((regex) => regex.test(messageText));
  }
}

export function normalizeE164Phone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  return phone.startsWith('+') ? phone : `+${digits}`;
}

export function normalizeLegalAreaKey(area: string): string {
  const u = (area || '').toUpperCase().trim();
  if (u.includes('TRAB')) return 'TRABALHISTA';
  if (u.includes('PREV') || u.includes('INSS')) return 'PREVIDENCIARIO';
  if (u.includes('CIVEL') || u.includes('CONSUMIDOR')) return 'CIVEL_CONSUMIDOR';
  if (u.includes('FAMIL') || u.includes('SUCESS')) return 'FAMILIA_SUCESSOES';
  if (u.includes('EMPR') || u.includes('SOCIET')) return 'EMPRESARIAL';
  if (u.includes('TRIB') || u.includes('FISC')) return 'TRIBUTARIO';
  return 'TRABALHISTA';
}

export const AREA_QUESTION_CATALOG: Record<string, IntakeQuestion[]> = {
  TRABALHISTA: [
    {
      id: 'datas_contrato',
      label: 'Qual foi o período trabalhado (data de admissão e data de saída, ou se ainda está na empresa)?',
      type: 'text',
      required: true,
      placeholder: 'Ex: De março/2021 até agosto/2024 (ou ainda trabalhando)',
    },
    {
      id: 'ctps_fgts',
      label: 'Sua carteira de trabalho (CTPS) era assinada e os depósitos de FGTS estavam regulares?',
      type: 'radio',
      options: [
        'CTPS assinada e FGTS em dia',
        'CTPS assinada mas FGTS em atraso',
        'Sem registro em carteira (informal/PJ pejotizado)',
        'Outra situação',
      ],
      required: true,
    },
    {
      id: 'direitos_violados',
      label: 'Quais direitos trabalhistas foram violados ou não pagos pelo empregador?',
      type: 'textarea',
      required: true,
      placeholder: 'Ex: Horas extras não pagas, desvio de função, verbas rescisórias atrasadas, assédio moral...',
    },
    {
      id: 'motivo_saida',
      label: 'Qual foi o motivo ou modalidade do término do contrato?',
      type: 'select',
      options: [
        'Demissão sem justa causa',
        'Pedido de demissão',
        'Rescisão indireta (falta grave do patrão)',
        'Contrato ainda ativo (busco orientação)',
      ],
      required: true,
    },
  ],
  PREVIDENCIARIO: [
    {
      id: 'tipo_beneficio',
      label: 'Qual modalidade de benefício você deseja solicitar ou revisar junto ao INSS?',
      type: 'select',
      options: [
        'Aposentadoria por Idade',
        'Aposentadoria por Tempo de Contribuição',
        'Auxílio por Incapacidade Temporária (Doença)',
        'BPC / LOAS (Idoso ou Deficiência)',
        'Pensão por Morte / Revisão da Vida Toda',
      ],
      required: true,
    },
    {
      id: 'pedido_previo_inss',
      label: 'Já realizou pedido prévio no INSS? Houve indeferimento ou cancelamento?',
      type: 'radio',
      options: [
        'Sim, foi indeferido recentemente',
        'Sim, recebia e foi cancelado/cessado',
        'Nunca dei entrada (primeiro pedido)',
        'Em análise há mais de 45 dias sem resposta',
      ],
      required: true,
    },
    {
      id: 'tempo_especial_rural',
      label: 'Possui tempo de trabalho rural, atividade insalubre/perigosa ou períodos sem registro?',
      type: 'textarea',
      required: false,
      placeholder: 'Descreva eventuais períodos especiais, tempo militar ou atividade rural.',
    },
  ],
  CIVEL_CONSUMIDOR: [
    {
      id: 'empresa_causadora',
      label: 'Qual empresa, instituição financeira ou parte causou o prejuízo?',
      type: 'text',
      required: true,
      placeholder: 'Ex: Banco XYZ, Companhia Aérea, Plano de Saúde, Construtora...',
    },
    {
      id: 'tipo_dano',
      label: 'Qual a natureza do problema sofrido?',
      type: 'radio',
      options: [
        'Negativação indevida no SPC/Serasa',
        'Recusa indevida de cobertura de Plano de Saúde',
        'Golpe / Fraude bancária / Empréstimo não contratado',
        'Cobrança abusiva ou descumprimento de contrato',
      ],
      required: true,
    },
    {
      id: 'valor_prejuizo',
      label: 'Qual o valor estimado do dano patrimonial ou prejuízo financeiro?',
      type: 'text',
      required: true,
      placeholder: 'Ex: R$ 8.500,00 ou Não sei estimar com exatidão',
    },
  ],
  FAMILIA_SUCESSOES: [
    {
      id: 'acao_familia',
      label: 'Qual o objeto principal da ação familiar ou sucessória?',
      type: 'select',
      options: [
        'Divórcio / Dissolução de União Estável',
        'Pensão Alimentícia (Fixação, Revisão ou Execução)',
        'Guarda de Filhos e Regime de Convivência',
        'Inventário e Partilha de Herança',
      ],
      required: true,
    },
    {
      id: 'consenso_ou_litigio',
      label: 'Existe acordo e consenso amigável entre as partes envolvidas?',
      type: 'radio',
      options: [
        'Sim, temos total consenso amigável',
        'Não, existe divergência e conflito (litigioso)',
        'Parcialmente em acordo',
      ],
      required: true,
    },
    {
      id: 'filhos_bens',
      label: 'Há menores de idade, dependentes ou bens imóveis/veículos a partilhar?',
      type: 'textarea',
      required: false,
      placeholder: 'Ex: 1 filho de 7 anos, 1 imóvel financiado e 1 veículo.',
    },
  ],
  EMPRESARIAL: [
    {
      id: 'dados_empresa',
      label: 'Qual a Razão Social, CNPJ aproximado e porte da sua empresa?',
      type: 'text',
      required: true,
      placeholder: 'Ex: Razão Social Ltda - ME/EPP',
    },
    {
      id: 'demanda_empresarial',
      label: 'Qual a necessidade jurídica da sociedade?',
      type: 'select',
      options: [
        'Cobrança e Recuperação de Crédito Judicial/Extrajudicial',
        'Assessoria Trabalhista Preventiva e Contratos',
        'Disputa Societária ou Dissolução de Sociedade',
        'Consultoria e Compliance Preventivo Contínuo',
      ],
      required: true,
    },
    {
      id: 'urgencia_bloqueio',
      label: 'Existe urgência iminente como bloqueio de contas, protesto ou prazo de citação?',
      type: 'radio',
      options: [
        'Sim, bloqueio judicial ou prazo em curso',
        'Não, questão consultiva ou cobrança ordinária',
      ],
      required: true,
    },
  ],
  TRIBUTARIO: [
    {
      id: 'esfera_tributaria',
      label: 'A demanda tributária envolve qual esfera governamental?',
      type: 'select',
      options: [
        'Federal (Receita Federal / PGFN)',
        'Estadual (SEFAZ - ICMS)',
        'Municipal (Prefeitura - ISS / IPTU)',
        'Não sei especificar',
      ],
      required: true,
    },
    {
      id: 'fase_tributaria',
      label: 'Em qual fase se encontra o débito ou demanda fiscal?',
      type: 'radio',
      options: [
        'Execução Fiscal ajuizada com citação ou penhora',
        'Notificação de débito / Auto de infração administrativo',
        'Desejo realizar Recuperação de Tributos Pagos Indevidamente',
        'Planejamento Tributário preventivo',
      ],
      required: true,
    },
    {
      id: 'valor_tributo',
      label: 'Qual o tributo e valor estimado em discussão?',
      type: 'text',
      required: false,
      placeholder: 'Ex: ICMS / IRPJ aproximado R$ 45.000,00',
    },
  ],
};

export const AREA_DOCUMENT_CATALOG: Record<string, string[]> = {
  TRABALHISTA: [
    'RG / CNH',
    'CPF',
    'Comprovante de Residência',
    'Carteira de Trabalho (CTPS)',
    'Termo de Rescisão (TRCT)',
    'Extrato Analítico do FGTS',
  ],
  PREVIDENCIARIO: [
    'RG / CNH',
    'CPF',
    'Comprovante de Residência',
    'Extrato Previdenciário (CNIS)',
    'Laudos / Atestados Médicos',
  ],
  CIVEL_CONSUMIDOR: [
    'RG / CNH',
    'CPF',
    'Comprovante de Residência',
    'Comprovantes da Cobrança ou Dano (Extratos / Protocolos)',
  ],
  FAMILIA_SUCESSOES: [
    'RG / CNH',
    'CPF',
    'Comprovante de Residência',
    'Certidão de Casamento ou Nascimento',
    'Documentos de Bens e Veículos (se houver partilha)',
  ],
  EMPRESARIAL: [
    'Contrato Social / Cartão CNPJ',
    'RG / CNH do Sócio Administrador',
    'Documentos da Operação / Contratos em Discussão',
  ],
  TRIBUTARIO: [
    'Cartão CNPJ e Contrato Social',
    'CDA / Auto de Infração / Notificação Fiscal',
    'Comprovantes de Recolhimento ou Extratos Fiscais',
  ],
};

export class TaskOrchestrator {
  public messaging: MessagingProvider;
  public email: EmailProvider;
  public telephony: TelephonyProvider;
  public calendar: CalendarProvider;
  public esignature: ESignatureProvider;
  public payment: PaymentProvider;
  public storage: DocumentStorageProvider;
  public aiModel: AIModelProvider;
  public authManager: AuthAndRbacManager;
  public omnichannelAnalyzer: OmnichannelFlowAndDocumentAnalyzer;
  public visionClassifier: DocumentVisionClassifier;
  public conversationLock: ConversationLockManager;
  public schedulingAgent: SchedulingAndCalendarAgent;
  public serverCalculationPipeline: ServerCalculationPipelineOrchestrator;
  public contextualFollowUpService: OneClickContextualFollowUpService;
  public thesisCampaignManager: LegalThesisCampaignManager;
  public videoAndReferralEngine: WordOfMouthAndVideoTriggerEngine;

  constructor(
    public db: DatabaseManager,
    options?: {
      messaging?: MessagingProvider;
      email?: EmailProvider;
      telephony?: TelephonyProvider;
      calendar?: CalendarProvider;
      esignature?: ESignatureProvider;
      payment?: PaymentProvider;
      storage?: DocumentStorageProvider;
      aiModel?: AIModelProvider;
      visionClassifier?: DocumentVisionClassifier;
    }
  ) {
    this.messaging =
      options?.messaging ||
      (process.env['MESSAGING_PROVIDER'] === 'twilio_whatsapp'
        ? new TwilioWhatsAppProvider()
        : new WhatsAppCloudMessagingAdapter());
    this.email = options?.email || new GoogleWorkspaceEmailAdapter();
    this.telephony = options?.telephony || new TwilioElevenLabsVoiceAdapter();
    this.calendar = options?.calendar || new GoogleCalendarAdapter();
    this.esignature = options?.esignature || new BrazilESignatureAdapter('zapsign');
    this.payment = options?.payment || new AsaasPaymentAdapter();
    this.storage = options?.storage || new LocalVaultStorageAdapter();
    this.aiModel = options?.aiModel || new LegalAIModelAdapter();
    this.authManager = new AuthAndRbacManager();
    this.omnichannelAnalyzer = new OmnichannelFlowAndDocumentAnalyzer(this.db, this);
    this.visionClassifier = options?.visionClassifier || new DocumentVisionClassifier();
    this.conversationLock = new ConversationLockManager();
    this.schedulingAgent = new SchedulingAndCalendarAgent(this);

    const twilioProvider = this.messaging instanceof TwilioWhatsAppProvider
      ? (this.messaging as TwilioWhatsAppProvider)
      : new TwilioWhatsAppProvider();

    this.serverCalculationPipeline = new ServerCalculationPipelineOrchestrator(
      this.db,
      twilioProvider,
      (p) => this.generateContractDraft(p)
    );
    this.contextualFollowUpService = new OneClickContextualFollowUpService(this.db, twilioProvider);
    this.thesisCampaignManager = new LegalThesisCampaignManager(this.db);
    this.videoAndReferralEngine = new WordOfMouthAndVideoTriggerEngine(this.db, twilioProvider, this.thesisCampaignManager);
  }

  private chargeAiBudget(tenantId: string, costBrl: number): void {
    const tenant = this.db.getTenant(tenantId);
    if (tenant.current_ai_spend_brl + costBrl > tenant.monthly_ai_budget_brl) {
      throw new BudgetExceededError(
        `Limite mensal de orçamento de IA do escritório (${tenant.monthly_ai_budget_brl.toFixed(2)} BRL) atingido.`
      );
    }
    this.db.updateTenantSpend(tenantId, costBrl);
  }

  public createTask(
    tenantId: string,
    agentType: string,
    objective: string,
    context: Record<string, unknown>,
    allowedTools: string[],
    successCriteria: string,
    opportunityId?: string | null,
    timeoutSeconds: number = 60,
    maxBudgetBrl: number = 2.0,
    requiresHumanApproval: boolean = false
  ): unknown {
    this.chargeAiBudget(tenantId, 0.0);
    return this.db.createAgentTask(
      tenantId,
      agentType,
      objective,
      context,
      allowedTools,
      successCriteria,
      opportunityId,
      timeoutSeconds,
      maxBudgetBrl,
      requiresHumanApproval
    );
  }

  // MÓDULO F: INBOUND MESSAGE & TRIAGEM
  public async handleInboundMessage(params: {
    tenantId: string;
    channel?: string;
    senderName: string;
    senderPhone: string;
    messageText: string;
    senderEmail?: string | null;
    senderCpfCnpj?: string | null;
  }): Promise<{
    lead_id: string;
    opportunity_id: string;
    conversation_id: string;
    legal_area: string;
    qualification_score: number;
    opt_out: boolean;
    assistant_reply: string;
  }> {
    const { tenantId, channel = 'WHATSAPP', senderName, senderPhone, messageText, senderEmail, senderCpfCnpj } = params;
    PromptInjectionGuard.inspect(messageText);
    EthicalComplianceGuard.validate(messageText);

    const canonicalPhone = normalizeE164Phone(senderPhone);

    // Identificar ou criar lead
    const existingLeads = this.db.listLeads(tenantId, canonicalPhone);
    let lead = existingLeads.find((l) => normalizeE164Phone(l.phone) === canonicalPhone);
    if (!lead) {
      lead = this.db.createLead(
        tenantId,
        senderName,
        canonicalPhone,
        senderEmail ?? null,
        senderCpfCnpj ?? null,
        channel,
        'CIVEL',
        'NORMAL',
        75
      );
    }

    const conversation = this.db.getOrCreateConversation(tenantId, lead.id, channel);

    return await this.conversationLock.acquire(conversation.id, async () => {
      this.db.addMessage(tenantId, conversation.id, 'INBOUND', 'LEAD', messageText);

      // Tratar comando de opt-out (LGPD)
      const upperMsg = messageText.trim().toUpperCase();
      if (['PARAR', 'CANCELAR', 'SAIR', 'STOP'].includes(upperMsg)) {
        this.db.db
          .prepare('UPDATE leads SET opt_out = 1, lgpd_consent_status = ? WHERE id = ? AND tenant_id = ?')
          .run('REVOKED', lead.id, tenantId);
        this.db.logAudit(tenantId, 'USER', 'system', 'LGPD_OPT_OUT', 'lead', lead.id, { reason: 'Comando PARAR' });
        return {
          lead_id: lead.id,
          opportunity_id: '',
          conversation_id: conversation.id,
          legal_area: lead.legal_area || 'CIVEL',
          qualification_score: lead.qualification_score,
          opt_out: true,
          assistant_reply: 'Seu consentimento foi revogado. O escritório não enviará novas mensagens ativas.',
        };
      }

      // Identificar ou criar oportunidade
      const existingOpps = this.db.listOpportunities(tenantId);
      const existing = existingOpps.find((o) => o.lead_id === lead.id && o.stage !== 'WON' && o.stage !== 'LOST');
      const opp: OpportunityRecord = existing ?? this.db.createOpportunity(tenantId, lead.id, null, 'NEW', 'MEDIUM', 3500.0, null, [], 'Novo contato inbound');

      // 1. Verificar se o cliente está respondendo afirmativamente a uma contraproposta de agendamento do advogado
      const counterApt = this.db.findRecentCounterProposedAppointment(tenantId, lead.id);
      if (counterApt && this.schedulingAgent.isAffirmativeAcceptance(messageText)) {
        const acceptRes = await this.schedulingAgent.handleClientCounterProposalAcceptance({
          tenantId,
          appointmentId: counterApt.id,
          leadId: lead.id,
        });
        return {
          lead_id: lead.id,
          opportunity_id: opp.id,
          conversation_id: conversation.id,
          legal_area: lead.legal_area || 'CIVEL',
          qualification_score: lead.qualification_score || 85,
          opt_out: false,
          assistant_reply: acceptRes.reply_text,
        };
      }

      // 2. Verificar se o cliente solicitou agendamento de consulta
      if (this.schedulingAgent.isSchedulingConsultationIntent(messageText)) {
        const schedRes = await this.schedulingAgent.handleConsultationRequest({
          tenantId,
          leadId: lead.id,
          opportunityId: opp.id,
          messageText,
        });
        return {
          lead_id: lead.id,
          opportunity_id: opp.id,
          conversation_id: conversation.id,
          legal_area: lead.legal_area || 'CIVEL',
          qualification_score: lead.qualification_score || 85,
          opt_out: false,
          assistant_reply: schedRes.reply_text,
        };
      }

      // 3. Baixa automática se o cliente enviou documentos
      if (DocumentChecklistExtractor.detectClientSentDocuments(messageText)) {
        this.db.updateOpportunityStage(tenantId, opp.id, 'DOCUMENTS_RECEIVED');
        this.db.completeFollowUpsForOpportunity(tenantId, opp.id);
        this.db.logAudit(tenantId, 'AGENT', 'FollowUpAndAttendanceAgent', 'CLIENT_DOCS_DELIVERY_CONFIRMED', 'opportunity', opp.id, {
          summary: 'Cliente confirmou entrega de documentos -> Oportunidade movida para DOCUMENTS_RECEIVED',
        });
      }

      // 4. Classificação por área do direito
      let area = 'CIVEL';
      if (/demitid|rescis|fgts|horas extras|carteira|trabalhist|sal[aá]rio/i.test(messageText)) {
        area = 'TRABALHISTA';
      } else if (/inss|aposenta|benef[íi]cio|laudo|per[íi]cia|aux[íi]lio|servidor|p[úu]blic|rpps|pens[aã]o\s+por\s+morte/i.test(messageText)) {
        area = 'PREVIDENCIARIO';
      } else if (/contrato\s+social|empresa|s[óo]cio|cnpj|tribut/i.test(messageText)) {
        area = 'EMPRESARIAL';
      } else if (/golpe|banco|empr[ée]stimo|cart[aã]o|serasa|spc|nome\s+sujo|v[oô]o|atraso/i.test(messageText)) {
        area = 'CIVEL_CONSUMIDOR';
      } else if (/div[oó]rcio|pens[aã]o|guarda|invent[aá]rio|heran[cç]a/i.test(messageText)) {
        area = 'FAMILIA_SUCESSOES';
      }

      this.chargeAiBudget(tenantId, 0.05);

      const reply = `Olá, ${senderName}! Recebemos seu contato no escritório. Identifiquei que sua demanda pertence à área ${area}. Como podemos lhe auxiliar?`;
      const dedupHash = calculateOutboundDedupHash(tenantId, lead.id, reply).hash;
      this.db.addMessage(tenantId, conversation.id, 'OUTBOUND', 'BOT', reply, false, false, null, dedupHash);

      return {
        lead_id: lead.id,
        opportunity_id: opp.id,
        conversation_id: conversation.id,
        legal_area: area,
        qualification_score: 85,
        opt_out: false,
        assistant_reply: reply,
      };
    });
  }

  // MÓDULO G: GATILHO EM TEMPO REAL AO ENVIAR LISTA DE DOCUMENTOS
  public handleOutboundLawyerMessage(params: {
    tenantId: string;
    leadId: string;
    messageText: string;
    channel?: string;
    actorId?: string;
    autoSyncCrm?: boolean;
    followupDelayHours?: number;
  }): {
    status: string;
    checklist_detected: boolean;
    detected_documents: string[];
    crm_updated: boolean;
    followup_task?: unknown;
  } {
    const { tenantId, leadId, messageText, channel = 'WHATSAPP', autoSyncCrm = true, followupDelayHours = 24 } = params;
    const lead = this.db.getLead(tenantId, leadId);
    const conv = this.db.getOrCreateConversation(tenantId, lead.id, channel);
    this.db.addMessage(tenantId, conv.id, 'OUTBOUND', 'LAWYER', messageText, false, autoSyncCrm);

    const { isChecklist, documents } = DocumentChecklistExtractor.extractRequestedDocuments(messageText);

    if (isChecklist && autoSyncCrm) {
      const opps = this.db.listOpportunities(tenantId);
      const existing = opps.find((o) => o.lead_id === lead.id && o.stage !== 'WON');
      const opp: OpportunityRecord = existing ?? this.db.createOpportunity(tenantId, lead.id, null, 'QUALIFIED', 'HIGH', 3500.0, null, documents);

      this.db.updateOpportunityStage(tenantId, opp.id, 'AWAITING_DOCUMENTS');
      const scheduledDate = new Date(Date.now() + followupDelayHours * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');

      const preview = `Olá, ${lead.full_name}! Passando para verificar se você conseguiu separar os documentos solicitados (${documents.join(', ')}) para darmos andamento ao seu caso no escritório.`;
      const fup = this.db.createFollowUpTask(
        tenantId,
        opp.id,
        lead.id,
        'DOCUMENT_COLLECTION_FOLLOWUP',
        documents,
        scheduledDate,
        'REALTIME_WHATSAPP_LISTENER',
        preview
      );

      return {
        status: 'CHECKLIST_DETECTED_AND_FOLLOWUP_SCHEDULED',
        checklist_detected: true,
        detected_documents: documents,
        crm_updated: true,
        followup_task: fup,
      };
    }

    return {
      status: 'MESSAGE_RECORDED',
      checklist_detected: isChecklist,
      detected_documents: documents,
      crm_updated: false,
    };
  }

  // MÓDULO G: SINCRONIZAÇÃO EM ATACADO DO DIA
  public batchSyncCrmFromTodayMessages(params: {
    tenantId: string;
    naturalLanguageCommand: string;
    followupDelayHours?: number;
  }): {
    status: string;
    command_executed: string;
    messages_processed: number;
    crm_cards_updated_count: number;
    followups_scheduled_count: number;
    updated_clients: unknown[];
  } {
    const { tenantId, naturalLanguageCommand, followupDelayHours = 24 } = params;
    PromptInjectionGuard.inspect(naturalLanguageCommand);

    const unsynced = this.db.getUnsyncedTodayMessages(tenantId);
    let updatedCards = 0;
    let followupsScheduled = 0;
    const updatedClients: unknown[] = [];
    const messageIdsToMark: string[] = [];

    const messagesByLead: Record<string, string[]> = {};
    for (const item of unsynced) {
      messageIdsToMark.push(item.message.id);
      if (!messagesByLead[item.lead_id]) messagesByLead[item.lead_id] = [];
      messagesByLead[item.lead_id]!.push(item.message.content);
    }

    for (const [leadId, contents] of Object.entries(messagesByLead)) {
      const fullText = contents.join('\n');
      const { isChecklist, documents } = DocumentChecklistExtractor.extractRequestedDocuments(fullText);

      if (isChecklist) {
        const opps = this.db.listOpportunities(tenantId);
        const existing = opps.find((o) => o.lead_id === leadId && o.stage !== 'WON');
        const opp: OpportunityRecord = existing ?? this.db.createOpportunity(tenantId, leadId, null, 'QUALIFIED', 'HIGH', 3500.0, null, documents);
        this.db.updateOpportunityStage(tenantId, opp.id, 'AWAITING_DOCUMENTS');
        updatedCards += 1;

        const scheduledDate = new Date(Date.now() + followupDelayHours * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
        const lead = this.db.getLead(tenantId, leadId);
        const preview = `Olá, ${lead.full_name}! Passando para verificar se você conseguiu reunir a documentação pendente (${documents.join(', ')}) para o escritório.`;
        this.db.createFollowUpTask(
          tenantId,
          opp.id,
          lead.id,
          'BATCH_SYNC_DOCUMENT_FOLLOWUP',
          documents,
          scheduledDate,
          'BATCH_DAILY_SYNC',
          preview
        );
        followupsScheduled += 1;

        updatedClients.push({
          lead_id: leadId,
          lead_name: lead.full_name,
          new_stage: 'AWAITING_DOCUMENTS',
          documents,
          scheduled_for: scheduledDate,
        });
      }
    }

    this.db.markMessagesSynced(tenantId, messageIdsToMark);
    this.db.logAudit(tenantId, 'USER', 'batch_sync', 'BATCH_DAILY_SYNC_COMPLETED', 'crm_sync', 'daily', {
      command: naturalLanguageCommand,
      cardsUpdated: updatedCards,
      followupsScheduled,
    });

    return {
      status: 'BATCH_SYNC_COMPLETED',
      command_executed: naturalLanguageCommand,
      messages_processed: unsynced.length,
      crm_cards_updated_count: updatedCards,
      followups_scheduled_count: followupsScheduled,
      updated_clients: updatedClients,
    };
  }

  // MÓDULOS H & N: VOZ E AGENDAMENTO GOOGLE MEET
  public async handleVoiceAndSchedule(params: {
    tenantId: string;
    opportunityId: string;
    callerPhone: string;
    speechTranscript: string;
    preferredDateIso?: string;
  }): Promise<{
    status: string;
    appointment_id: string;
    meeting_link: string;
    opportunity_stage: OpportunityStage;
  }> {
    const { tenantId, opportunityId, speechTranscript, preferredDateIso = '2026-10-15' } = params;
    PromptInjectionGuard.inspect(speechTranscript);

    const opp = this.db.getOpportunity(tenantId, opportunityId);
    const users = this.db.listUsers(tenantId);
    const lawyer = users.find((u) => u.role === 'LAWYER') || users[0];
    const lawyerId = lawyer ? lawyer.id : 'usr_default_lawyer';

    const slotIso = `${preferredDateIso}T14:30:00Z`;
    const meetRes = await this.calendar.createMeetingSlot('Consulta Jurídica Inicial — Law.AI', slotIso, null);

    const apt = this.db.createAppointment(tenantId, opp.id, opp.lead_id, lawyerId, slotIso, meetRes.meetingLink);
    this.db.updateOpportunityStage(tenantId, opp.id, 'MEETING_SCHEDULED');

    return {
      status: 'APPOINTMENT_SCHEDULED',
      appointment_id: apt.id,
      meeting_link: meetRes.meetingLink,
      opportunity_stage: 'MEETING_SCHEDULED',
    };
  }

  // MÓDULOS I & J: GERAÇÃO DE MINUTA (GATE AWAITING_APPROVAL)
  public generateContractDraft(params: {
    tenantId: string;
    opportunityId: string;
    templateId: string;
    requestedByActor?: string;
    customClausesNotes?: string;
  }): {
    contract_id: string;
    approval_request_id: string;
    content_sha256: string;
    status: string;
  } {
    const { tenantId, opportunityId, templateId, requestedByActor = 'ProposalAndContractDraftingAgent', customClausesNotes = '' } = params;
    PromptInjectionGuard.inspect(customClausesNotes);

    const opp = this.db.getOpportunity(tenantId, opportunityId);
    const lead = this.db.getLead(tenantId, opp.lead_id);
    const template = this.db.getDocumentTemplate(tenantId, templateId);
    const tenant = this.db.getTenant(tenantId);

    const rendered = template.body_template
      .replace(/\{\{tenant_name\}\}/g, tenant.name)
      .replace(/\{\{tenant_oab\}\}/g, tenant.oab_society_number)
      .replace(/\{\{client_name\}\}/g, lead.full_name)
      .replace(/\{\{client_cpf_cnpj\}\}/g, lead.document_cpf_cnpj || '***.***.***-**')
      .replace(/\{\{base_fee_brl\}\}/g, opp.estimated_value_brl.toFixed(2));

    EthicalComplianceGuard.validate(rendered);

    const contentSha256 = createHash('sha256').update(rendered, 'utf-8').digest('hex');

    const contract = this.db.createProposalContract(
      tenantId,
      opp.id,
      template.id,
      rendered,
      contentSha256,
      opp.estimated_value_brl
    );

    const approval = this.db.createApprovalRequest(
      tenantId,
      contract.id,
      opp.id,
      'APPROVE_CONTRACT_DRAFT',
      requestedByActor
    );

    return {
      contract_id: contract.id,
      approval_request_id: approval.id,
      content_sha256: contentSha256,
      status: 'AWAITING_APPROVAL',
    };
  }

  // MÓDULO K: DECISÃO HUMANA DE APROVAÇÃO (RBAC ESTREITO)
  public async decideApprovalRequest(params: {
    tenantId: string;
    approvalId: string;
    reviewerUserId: string;
    decision: 'APPROVED' | 'REJECTED';
    decisionNotes?: string;
    paymentMethod?: string;
  }): Promise<{
    approval_status: string;
    contract_status: string;
    esignature_envelope_id?: string;
    payment_charge_id?: string;
    signer_url?: string;
  }> {
    const { tenantId, approvalId, reviewerUserId, decision, decisionNotes = '', paymentMethod = 'PIX' } = params;
    const reviewer = this.db.getUser(tenantId, reviewerUserId);

    // Validação estrita RBAC: apenas LAWYER ou TENANT_ADMIN possuem 'contracts:approve'
    this.authManager.checkPermission(reviewer.role, 'contracts:approve');

    const res = this.db.decideApproval(tenantId, approvalId, reviewerUserId, decision, decisionNotes);

    if (decision === 'APPROVED') {
      const opp = this.db.getOpportunity(tenantId, res.contract.opportunity_id);
      const lead = this.db.getLead(tenantId, opp.lead_id);

      // Disparo ZapSign / Clicksign
      const envRes = await this.esignature.createDocumentEnvelope(
        res.contract.id,
        lead.full_name,
        lead.email || `${lead.phone}@lead.lawai`,
        lead.phone,
        res.contract.rendered_content,
        'APPROVED'
      );
      this.db.createEsignatureEnvelope(
        tenantId,
        res.contract.id,
        opp.id,
        'zapsign',
        envRes.externalId,
        envRes.signerUrl,
        envRes.mode
      );

      // Disparo Asaas Pix
      const payRes = await this.payment.createPaymentCharge(
        res.contract.id,
        lead.full_name,
        lead.document_cpf_cnpj || '11122233344',
        res.contract.fee_value_brl,
        'APPROVED',
        paymentMethod
      );
      this.db.createPaymentCharge(
        tenantId,
        res.contract.id,
        opp.id,
        'asaas',
        payRes.externalId,
        paymentMethod,
        res.contract.fee_value_brl,
        payRes.pixCopyPaste,
        payRes.invoiceUrl,
        payRes.mode
      );

      // Disparo automático do link de assinatura no WhatsApp do cliente via Twilio
      try {
        const approvalMsg = `Olá, ${lead.full_name}! Seu contrato de prestação de serviços jurídicos foi conferido e aprovado pelo Dr. ${reviewer.full_name}. Segue o link oficial para assinatura digital: ${envRes.signerUrl}`;
        await this.messaging.sendMessage(lead.phone, approvalMsg);
        this.db.logAudit(tenantId, 'SYSTEM', 'twilio_notifier', 'SIGNER_URL_SENT_TO_WHATSAPP', 'opportunity', opp.id, {
          phone: lead.phone,
          signer_url: envRes.signerUrl,
          envelope_id: envRes.externalId,
        });
      } catch (sendErr) {
        console.warn('[decideApprovalRequest] Falha ao enviar WhatsApp de assinatura:', sendErr);
      }

      return {
        approval_status: 'APPROVED',
        contract_status: 'APPROVED',
        esignature_envelope_id: envRes.externalId,
        payment_charge_id: payRes.externalId,
        signer_url: envRes.signerUrl,
      };
    }

    return {
      approval_status: 'REJECTED',
      contract_status: 'REJECTED',
    };
  }

  // MÓDULO L & M: WEBHOOKS E RECONCILIAÇÃO AUTOMÁTICA
  public processEsignatureWebhook(params: {
    tenantId: string;
    externalEnvelopeId: string;
    eventType: string;
    idempotencyKey: string;
    rawBody: Buffer | string;
    signatureHeader: string;
    webhookSecret?: string;
  }): { status: string; opportunity_stage?: string } {
    const { tenantId, externalEnvelopeId, eventType, idempotencyKey, rawBody, signatureHeader, webhookSecret = 'esign_secret_2026' } = params;

    if (!verifyWebhookHmac(rawBody, signatureHeader, webhookSecret)) {
      throw new Error('Assinatura HMAC de webhook de assinatura inválida.');
    }

    if (this.db.isWebhookProcessed(tenantId, idempotencyKey)) {
      return { status: 'ALREADY_PROCESSED' };
    }
    this.db.markWebhookProcessed(tenantId, idempotencyKey, 'zapsign');

    const env = this.db.getEsignatureEnvelopeByExternalId(tenantId, externalEnvelopeId);
    if (eventType === 'DOC_SIGNED') {
      this.db.updateEsignatureStatus(tenantId, externalEnvelopeId, 'SIGNED');
      this.reconcileOpportunityWon(tenantId, env.opportunity_id);
      return { status: 'SIGNED_RECONCILED', opportunity_stage: 'WON' };
    }
    return { status: 'EVENT_ACKNOWLEDGED' };
  }

  public processPaymentWebhook(params: {
    tenantId: string;
    externalChargeId: string;
    eventType: string;
    idempotencyKey: string;
    rawBody: Buffer | string;
    signatureHeader: string;
    webhookSecret?: string;
  }): { status: string; opportunity_stage?: string } {
    const { tenantId, externalChargeId, eventType, idempotencyKey, rawBody, signatureHeader, webhookSecret = 'payment_secret_2026' } = params;

    if (!verifyWebhookHmac(rawBody, signatureHeader, webhookSecret)) {
      throw new Error('Assinatura HMAC de webhook de pagamento inválida.');
    }

    if (this.db.isWebhookProcessed(tenantId, idempotencyKey)) {
      return { status: 'ALREADY_PROCESSED' };
    }
    this.db.markWebhookProcessed(tenantId, idempotencyKey, 'asaas');

    const charge = this.db.getPaymentChargeByExternalId(tenantId, externalChargeId);
    if (eventType === 'PAYMENT_CONFIRMED') {
      this.db.updatePaymentStatus(tenantId, externalChargeId, 'CONFIRMED');
      this.reconcileOpportunityWon(tenantId, charge.opportunity_id);
      return { status: 'PAYMENT_RECONCILED', opportunity_stage: 'WON' };
    }
    return { status: 'EVENT_ACKNOWLEDGED' };
  }

  private reconcileOpportunityWon(tenantId: string, opportunityId: string): void {
    const envStmt = this.db.db.prepare('SELECT status FROM esignature_envelopes WHERE tenant_id = ? AND opportunity_id = ?');
    const env = envStmt.get(tenantId, opportunityId) as { status: string } | undefined;

    const payStmt = this.db.db.prepare('SELECT status FROM payment_charges WHERE tenant_id = ? AND opportunity_id = ?');
    const pay = payStmt.get(tenantId, opportunityId) as { status: string } | undefined;

    if (env?.status === 'SIGNED' && pay?.status === 'CONFIRMED') {
      this.db.updateOpportunityStage(tenantId, opportunityId, 'WON');
      this.db.logAudit(tenantId, 'SYSTEM', 'webhook_reconciler', 'OPPORTUNITY_WON', 'opportunity', opportunityId, {
        reason: 'Contrato assinado digitalmente e pagamento Pix confirmado',
      });
    }
  }

  public getDashboardMetrics(tenantId: string): Record<string, unknown> {
    const tenant = this.db.getTenant(tenantId);
    const leads = this.db.listLeads(tenantId);
    const opps = this.db.listOpportunities(tenantId);
    const followups = this.db.listFollowUpTasks(tenantId, 'SCHEDULED');

    const totalPipeline = opps
      .filter((o) => o.stage !== 'WON' && o.stage !== 'LOST')
      .reduce((acc, cur) => acc + cur.estimated_value_brl, 0);

    const totalWon = opps
      .filter((o) => o.stage === 'WON')
      .reduce((acc, cur) => acc + cur.estimated_value_brl, 0);

    return {
      tenant_id: tenantId,
      tenant_name: tenant.name,
      plan_tier: tenant.plan_tier,
      total_leads: leads.length,
      active_opportunities: opps.length,
      pipeline_value_brl: totalPipeline,
      realized_revenue_brl: totalWon,
      scheduled_followups_count: followups.length,
      monthly_ai_spend_brl: tenant.current_ai_spend_brl,
      monthly_ai_budget_brl: tenant.monthly_ai_budget_brl,
    };
  }

  // =========================================================================
  // MÓDULO: CAPTAÇÃO ONLINE VIA TRÁFEGO PAGO COM FORMULÁRIO IA & FECHAMENTO
  // =========================================================================

  public async handlePublicIntakeStart(params: IntakeStartRequest & { tenantId?: string }): Promise<IntakeStartResponse> {
    // 1. Guardrail: Inspecionar nome contra Prompt Injection
    if (!params.full_name || params.full_name.trim().length < 3) {
      throw new Error('Nome completo é obrigatório (mínimo nome e sobrenome).');
    }
    PromptInjectionGuard.inspect(params.full_name);

    if (!params.whatsapp_phone) {
      throw new Error('Número de WhatsApp com DDD é obrigatório.');
    }
    if (!params.lgpd_consent) {
      throw new Error('O consentimento com os termos da LGPD e autorização para contato via WhatsApp são obrigatórios.');
    }

    // 2. Resolver Tenant
    let tenantId = params.tenantId;
    if (!tenantId && params.tenant_slug) {
      const tenant = this.db.getTenantBySlug(params.tenant_slug);
      if (tenant) tenantId = tenant.id;
    }
    if (!tenantId) {
      const defaultTenant = this.db.getTenantBySlug('cardoso-adv');
      tenantId = defaultTenant?.id || 'tnt_cardoso_adv';
    }

    const normalizedPhone = normalizeE164Phone(params.whatsapp_phone);
    const resolvedArea = normalizeLegalAreaKey(params.service_interest_area);

    // 3. Capturar UTMs e metadados de tráfego pago
    const campaignData: Record<string, unknown> = {
      utm_source: params.utm_source || 'direct',
      utm_medium: params.utm_medium || 'landing_page',
      utm_campaign: params.utm_campaign || 'paid_traffic_intake',
      utm_content: params.utm_content || null,
      utm_term: params.utm_term || null,
      gclid: params.gclid || null,
      fbclid: params.fbclid || null,
      captured_at: new Date().toISOString(),
    };

    // 4. Cadastrar Lead com canal PAID_TRAFFIC_LANDING_PAGE
    const lead = this.db.createLead(
      tenantId,
      params.full_name.trim(),
      normalizedPhone,
      null,
      null,
      'PAID_TRAFFIC_LANDING_PAGE',
      resolvedArea,
      'NORMAL',
      50,
      campaignData
    );

    // 5. Gravar registro formal de consentimento LGPD (Art. 7º, I e V)
    this.db.recordConsent(
      tenantId,
      lead.id,
      'PAID_TRAFFIC_LANDING_PAGE',
      'LGPD_ART_7_I_V',
      'Atendimento jurídico preliminar e contato comercial autorizado via WhatsApp',
      'GRANTED'
    );

    // 6. Obter perguntas dinâmicas geradas pela IA e checklist de documentos
    const dynamicQuestions = AREA_QUESTION_CATALOG[resolvedArea] || AREA_QUESTION_CATALOG['TRABALHISTA'];
    const requiredDocs = AREA_DOCUMENT_CATALOG[resolvedArea] || AREA_DOCUMENT_CATALOG['TRABALHISTA'];

    // 7. Localizar serviço jurídico correspondente à área
    const service = this.db.findServiceForLegalArea(tenantId, resolvedArea);

    // 8. Criar oportunidade no CRM com stage INTAKE_IN_PROGRESS
    const opp = this.db.createOpportunity(
      tenantId,
      lead.id,
      service?.id || null,
      'INTAKE_IN_PROGRESS',
      'MEDIUM',
      service?.base_fee_brl || 3500.0,
      null,
      requiredDocs,
      `Captação via tráfego pago (${campaignData.utm_source} / ${campaignData.utm_campaign}). Área: ${resolvedArea}.`
    );

    const protocolNumber = `LAW-${new Date().getFullYear()}-${lead.id.slice(-6).toUpperCase()}`;

    return {
      lead_id: lead.id,
      opportunity_id: opp.id,
      tenant_id: tenantId,
      protocol_number: protocolNumber,
      legal_area: resolvedArea,
      service_name: service?.name || `Atendimento Especializado em Direito ${resolvedArea}`,
      dynamic_questions: dynamicQuestions,
      required_documents: requiredDocs,
      message: 'Atendimento iniciado com sucesso. Por favor, responda às perguntas dinâmicas e anexe os documentos necessários.',
    };
  }

  public async handlePublicDocumentUpload(params: {
    tenantId: string;
    leadId: string;
    documentType: string;
    originalFilename: string;
    fileBytes: Buffer;
    mimeType?: string;
    autoCloseContract?: boolean;
  }): Promise<{
    document_id: string;
    storage_uri: string;
    sha256_hash: string;
    byte_size: number;
    pending_documents: string[];
    all_documents_received: boolean;
    classification?: {
      document_type: string;
      confidence_score: number;
      is_legible: boolean;
      extracted_fields: Record<string, string>;
      notes: string;
    };
    contract?: {
      contract_id: string;
      signer_url: string;
      status: string;
      content_sha256: string;
      whatsapp_dispatched: boolean;
    } | null;
    appointment?: {
      id: string;
      scheduled_slot_iso: string;
      meeting_link: string;
      status: string;
    } | null;
  }> {
    const { tenantId, leadId, documentType, originalFilename, fileBytes, mimeType = 'application/pdf', autoCloseContract = true } = params;

    const lead = this.db.getLead(tenantId, leadId);
    let opp = this.db.getOpportunityByLeadId(tenantId, leadId);
    if (!opp) {
      opp = this.db.createOpportunity(tenantId, leadId, null, 'INTAKE_IN_PROGRESS');
    }

    // 1. Análise Visual Multimodal e Extração OCR com Gemini Vision
    let classificationResult;
    try {
      classificationResult = await this.visionClassifier.classifyDocument(fileBytes, mimeType, originalFilename);
    } catch {
      classificationResult = this.visionClassifier.fallbackHeuristicClassification(fileBytes, originalFilename);
    }

    // Resolver tipo do documento (prioriza classificação da IA se documentType for genérico ou foto)
    let resolvedDocType = documentType;
    const isGenericType =
      !documentType ||
      documentType === 'DOCUMENTO_GERAL' ||
      documentType === 'Documento Geral' ||
      documentType === 'documento' ||
      documentType.toLowerCase().startsWith('arquivo') ||
      documentType.toLowerCase().startsWith('img_') ||
      documentType.toLowerCase().startsWith('photo') ||
      documentType.toLowerCase().startsWith('scan');

    if (isGenericType && classificationResult && classificationResult.documentType) {
      resolvedDocType = classificationResult.documentType;
    } else if (classificationResult && classificationResult.confidenceScore >= 0.85) {
      let currentPending: string[] = [];
      try {
        currentPending = JSON.parse(opp.pending_documents_json);
      } catch {
        currentPending = [];
      }
      const matchInChecklist = currentPending.find((p) => {
        const cleanP = p.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanAI = classificationResult.documentType.toLowerCase().replace(/[^a-z0-9]/g, '');
        return cleanP.includes(cleanAI) || cleanAI.includes(cleanP);
      });
      if (matchInChecklist) {
        resolvedDocType = matchInChecklist;
      }
    }

    // 2. Extração OCR: Atualizar CPF e Nome do Lead caso extraídos e não preenchidos
    if (classificationResult?.extractedFields?.cpfCnpj && (!lead.document_cpf_cnpj || lead.document_cpf_cnpj.trim() === '')) {
      this.db.db.prepare('UPDATE leads SET document_cpf_cnpj = ? WHERE id = ? AND tenant_id = ?').run(
        classificationResult.extractedFields.cpfCnpj.trim(),
        leadId,
        tenantId
      );
    }

    // 3. Salvar no Cofre Seguro (DocumentStorageProvider)
    const stored = await this.storage.storeDocument(originalFilename, fileBytes);

    // 4. Registrar no banco com hash SHA-256 e tamanho
    const docRecord = this.db.saveLeadDocument(
      tenantId,
      leadId,
      resolvedDocType,
      originalFilename,
      stored.storageUri,
      stored.sha256Hex,
      fileBytes.length,
      mimeType,
      fileBytes.toString('base64')
    );

    // 5. Atualizar pendências da oportunidade
    let pendingDocs: string[] = [];
    try {
      pendingDocs = JSON.parse(opp.pending_documents_json);
    } catch {
      pendingDocs = [];
    }

    const typeA = resolvedDocType.toLowerCase().replace(/[^a-z0-9]/g, '');
    const typeB = (documentType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const hasExtractedCpf = Boolean(classificationResult?.extractedFields?.cpfCnpj);
    const remainingPending = pendingDocs.filter((p) => {
      const pClean = p.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matchResolved = pClean.includes(typeA) || (typeA.length > 2 && typeA.includes(pClean));
      const matchOriginal = typeB.length > 2 && (pClean.includes(typeB) || typeB.includes(pClean));
      const matchCpfInCnh = hasExtractedCpf && pClean === 'cpf';
      return !matchResolved && !matchOriginal && !matchCpfInCnh;
    });

    const allReceived = remainingPending.length === 0;
    const newStage: OpportunityStage = allReceived ? 'DOCUMENTS_RECEIVED' : opp.stage;

    this.db.updateOpportunityDetails(tenantId, opp.id, {
      stage: newStage,
      pending_documents: remainingPending,
      crm_situation_summary: allReceived
        ? `Todos os documentos foram salvos no cofre seguro com integridade SHA-256 (${docRecord.sha256_hash.slice(0, 10)}) e analisados por IA (${resolvedDocType}). Documentação completa, gerando minuta para fechamento.`
        : `Documento ${resolvedDocType} analisado por IA e salvo com hash SHA-256 (${docRecord.sha256_hash.slice(0, 8)}). Restam ${remainingPending.length} pendências.`,
    });

    if (allReceived) {
      this.db.completeFollowUpsForOpportunity(tenantId, opp.id);
    }

    // 6. Fechamento Automático: Agendamento da Reunião e Geração do Contrato com ZapSign quando todos os documentos estiverem completos
    let contractResult: any = null;
    let appointmentResult: any = null;

    if (allReceived) {
      // 6.1 Agendamento automático da Reunião pela IA (Google Calendar / Meet)
      try {
        const existingApt = this.db.db
          .prepare('SELECT * FROM appointments WHERE tenant_id = ? AND opportunity_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(tenantId, opp.id) as any;

        if (existingApt) {
          appointmentResult = existingApt;
        } else {
          const nextDay = new Date();
          nextDay.setDate(nextDay.getDate() + 1);
          if (nextDay.getDay() === 0) nextDay.setDate(nextDay.getDate() + 1);
          if (nextDay.getDay() === 6) nextDay.setDate(nextDay.getDate() + 2);
          nextDay.setHours(14, 0, 0, 0);
          const slotIso = nextDay.toISOString();

          const meetRes = await this.calendar.createMeetingSlot(
            `Consulta Jurídica e Alinhamento — ${lead.full_name}`,
            slotIso,
            lead.email
          );

          appointmentResult = this.db.createAppointment(
            tenantId,
            opp.id,
            lead.id,
            opp.assigned_lawyer_id || 'usr_fabricio_cardoso',
            slotIso,
            meetRes.meetingLink
          );
        }
      } catch (aptErr) {
        console.warn('[handlePublicDocumentUpload] Reunião não pôde ser agendada automaticamente:', aptErr);
      }

      // 6.2 Fechamento e Geração do Contrato com ZapSign
      if (autoCloseContract) {
        try {
          contractResult = await this.handlePublicContractGeneration({ tenantId, leadId });
        } catch (err) {
          console.warn('[handlePublicDocumentUpload] Contrato não pôde ser pré-gerado imediatamente:', err);
        }
      }
    }

    return {
      document_id: docRecord.id,
      storage_uri: docRecord.storage_uri,
      sha256_hash: docRecord.sha256_hash,
      byte_size: docRecord.byte_size,
      pending_documents: remainingPending,
      all_documents_received: allReceived,
      classification: {
        document_type: resolvedDocType,
        confidence_score: classificationResult.confidenceScore,
        is_legible: classificationResult.isLegible,
        extracted_fields: classificationResult.extractedFields,
        notes: classificationResult.notes || '',
      },
      contract: contractResult
        ? {
            contract_id: contractResult.contract_id,
            signer_url: contractResult.signer_url,
            status: contractResult.status,
            content_sha256: contractResult.content_sha256,
            whatsapp_dispatched: contractResult.whatsapp_dispatched,
          }
        : null,
      appointment: appointmentResult
        ? {
            id: appointmentResult.id,
            scheduled_slot_iso: appointmentResult.scheduled_slot_iso,
            meeting_link: appointmentResult.meeting_link,
            status: appointmentResult.status,
          }
        : null,
    };
  }

  public async handlePublicIntakeComplete(params: {
    tenantId: string;
    leadId: string;
    body: IntakeCompleteRequest;
  }): Promise<IntakeCompleteResponse> {
    const { tenantId, leadId, body } = params;

    // 1. Guardrails de Segurança e Ética OAB
    if (body.case_narrative) {
      PromptInjectionGuard.inspect(body.case_narrative);
      EthicalComplianceGuard.validate(body.case_narrative);
    }
    for (const val of Object.values(body.ai_collected_answers || {})) {
      if (typeof val === 'string') {
        PromptInjectionGuard.inspect(val);
      }
    }

    const lead = this.db.getLead(tenantId, leadId);
    let opp = this.db.getOpportunityByLeadId(tenantId, leadId);
    if (!opp) {
      opp = this.db.createOpportunity(tenantId, leadId, null, 'INTAKE_IN_PROGRESS');
    }

    const resolvedArea = lead.legal_area || 'TRABALHISTA';

    // 2. Roteamento para Advogado Especialista Titular (Dr. Fabricio Cardoso Gomes)
    const users = this.db.listUsers(tenantId);
    const lawyers = users.filter((u) => u.role === 'LAWYER');
    const specialistLawyer =
      lawyers.find((u) => u.specialties_json.includes(resolvedArea)) ||
      lawyers[0] || { id: 'usr_fabricio_cardoso', full_name: 'Dr. Fabricio Cardoso Gomes', oab_number: '41209', oab_uf: 'GO' };

    // 3. Atualizar CPF se fornecido
    if (body.document_cpf_cnpj && (!lead.document_cpf_cnpj || lead.document_cpf_cnpj.trim() === '')) {
      this.db.db.prepare('UPDATE leads SET document_cpf_cnpj = ? WHERE id = ? AND tenant_id = ?').run(
        body.document_cpf_cnpj.trim(),
        leadId,
        tenantId
      );
    }

    // 4. Calcular Score de Qualificação e Urgência
    let score = 75;
    if (body.case_narrative && body.case_narrative.length > 20) score += 15;
    if (body.document_cpf_cnpj) score += 10;
    const isUrgent =
      body.urgency_liminar === true ||
      Boolean(body.case_narrative && /urgente|liminar|bloqueio|pris[aã]o|prazo|despejo|reintegra/i.test(body.case_narrative));
    const priority = isUrgent ? 'HIGH' : 'NORMAL';

    // 5. Verificar status dos documentos no cofre
    const uploadedDocs = this.db.listLeadDocuments(tenantId, leadId);
    let pendingDocs: string[] = [];
    try {
      pendingDocs = JSON.parse(opp.pending_documents_json);
    } catch {
      pendingDocs = AREA_DOCUMENT_CATALOG[resolvedArea] || [];
    }

    const hasDocsPending = pendingDocs.length > 0;
    const stage: OpportunityStage = hasDocsPending ? 'AWAITING_DOCUMENTS' : 'DOCUMENTS_RECEIVED';

    this.db.updateOpportunityDetails(tenantId, opp.id, {
      stage,
      priority,
      assigned_lawyer_id: specialistLawyer.id,
      crm_situation_summary: `Triagem IA finalizada com score ${score}/100. Atribuído ao Dr. ${specialistLawyer.full_name}. ${
        hasDocsPending ? `Aguardando ${pendingDocs.length} documentos pendentes.` : 'Documentação completa no cofre seguro.'
      }`,
    });

    // 6. Contato Ativo Imediato no WhatsApp Oficial (MessagingProvider)
    let whatsappOutreachStatus = 'NOT_SENT';
    let whatsappMsgId: string | undefined;

    const firstName = lead.full_name.split(' ')[0] || 'Cliente';
    if (hasDocsPending) {
      // Mensagem oficial com a lista de pendências e agendamento de follow-up
      const pendingListText = pendingDocs.map((d, i) => `${i + 1}. ${d}`).join('\n');
      const text = `Olá, ${firstName}! Sou o assistente jurídico do Dr. Fabricio Cardoso Gomes (Cardoso & Associados Advocacia - OAB/GO 4.512).\n\nRecebemos suas respostas para o atendimento especializado em Direito ${resolvedArea}. Para que o Dr. Fabricio possa formalizar a análise técnica e minutar sua procuração, precisamos dos seguintes documentos pendentes:\n\n${pendingListText}\n\nVocê pode responder a esta mensagem enviando as fotos ou PDFs por aqui. Seus dados estão seguros e resguardados pelo sigilo profissional da OAB e pela LGPD.`;

      const sendRes = await this.messaging.sendMessage(lead.phone, text);
      whatsappOutreachStatus = sendRes.status;
      whatsappMsgId = sendRes.messageId;

      // Agendar follow-up automático para 24h
      const scheduledIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      this.db.createFollowUpTask(
        tenantId,
        opp.id,
        lead.id,
        'Envio de documentação pendente da captação online',
        pendingDocs,
        scheduledIso,
        'WHATSAPP_AUTO',
        `Olá, ${firstName}! O Dr. Fabricio Cardoso aguarda seus documentos para dar andamento ao seu caso.`
      );
    } else {
      // Confirmação de recebimento completo e preparação de minuta
      const text = `Olá, ${firstName}! O Dr. Fabricio Cardoso Gomes e a equipe da Cardoso & Associados Advocacia confirmam o recebimento completo de todos os seus documentos e relato do caso na área ${resolvedArea}.\n\nSeus documentos foram arquivados com chave criptográfica SHA-256 no nosso cofre digital. Estamos finalizando a minuta do seu Contrato de Honorários e Procuração com link oficial para assinatura eletrônica.`;

      const sendRes = await this.messaging.sendMessage(lead.phone, text);
      whatsappOutreachStatus = sendRes.status;
      whatsappMsgId = sendRes.messageId;
    }

    return {
      status: 'TRIAGE_COMPLETED',
      lead_id: lead.id,
      opportunity_id: opp.id,
      opportunity_stage: stage,
      assigned_lawyer_name: specialistLawyer.full_name,
      assigned_lawyer_oab: specialistLawyer.oab_number ? `OAB/${specialistLawyer.oab_uf || 'GO'} ${specialistLawyer.oab_number}` : 'OAB/GO 41.209',
      qualification_score: score,
      priority,
      documents_received_count: uploadedDocs.length,
      pending_documents: pendingDocs,
      whatsapp_outreach_status: whatsappOutreachStatus,
      whatsapp_message_id: whatsappMsgId,
      next_step: hasDocsPending ? 'AGUARDANDO_DOCUMENTOS_WHATSAPP' : 'GERACAO_CONTRATO_ASSINATURA',
    };
  }

  public async handlePublicContractGeneration(params: {
    tenantId: string;
    leadId: string;
  }): Promise<IntakeContractResponse> {
    const { tenantId, leadId } = params;
    const lead = this.db.getLead(tenantId, leadId);
    const opp = this.db.getOpportunityByLeadId(tenantId, leadId);
    if (!opp) {
      throw new Error(`Oportunidade para lead ${leadId} não encontrada.`);
    }

    // Se a oportunidade já tiver um contrato com envelope gerado, retornar o existente
    const existingContract = this.db.db
      .prepare(
        `SELECT c.id, c.content_sha256, c.fee_value_brl, e.signer_url
         FROM proposals_and_contracts c
         LEFT JOIN esignature_envelopes e ON e.contract_id = c.id
         WHERE c.tenant_id = ? AND c.opportunity_id = ?
         ORDER BY c.created_at DESC LIMIT 1`
      )
      .get(tenantId, opp.id) as { id: string; content_sha256: string; fee_value_brl: number; signer_url?: string } | undefined;

    if (existingContract && existingContract.signer_url) {
      const protocolNumber = `LAW-${new Date().getFullYear()}-${lead.id.slice(-6).toUpperCase()}`;
      return {
        contract_id: existingContract.id,
        status: 'SENT_FOR_SIGNATURE',
        signer_url: existingContract.signer_url,
        content_sha256: existingContract.content_sha256,
        fee_value_brl: existingContract.fee_value_brl,
        protocol_number: protocolNumber,
        whatsapp_dispatched: true,
      };
    }

    const resolvedArea = lead.legal_area || 'TRABALHISTA';
    const template = this.db.findTemplateForLegalArea(tenantId, resolvedArea);
    if (!template) {
      throw new Error(`Nenhum modelo contratual homologado encontrado para a área ${resolvedArea}.`);
    }

    const service = this.db.findServiceForLegalArea(tenantId, resolvedArea);
    const feeValue = service?.base_fee_brl || 3500.0;
    const successFee = service?.success_fee_pct || 20.0;

    // Renderizar minuta preenchendo variáveis institucionais
    const renderedContent = template.body_template
      .replace(/\{\{full_name\}\}/g, lead.full_name)
      .replace(/\{\{document_cpf_cnpj\}\}/g, lead.document_cpf_cnpj || 'Pendente de validação cadastral')
      .replace(/\{\{address\}\}/g, 'Endereço fornecido pelo cliente')
      .replace(/\{\{service_name\}\}/g, service?.name || `Atendimento Especializado em Direito ${resolvedArea}`)
      .replace(/\{\{fee_value_brl\}\}/g, feeValue.toFixed(2))
      .replace(/\{\{success_fee_pct\}\}/g, successFee.toString());

    const contentSha256 = createHash('sha256').update(renderedContent).digest('hex');

    // Registrar proposta de contrato
    const contract = this.db.createProposalContract(
      tenantId,
      opp.id,
      template.id,
      renderedContent,
      contentSha256,
      feeValue
    );

    // Pré-aprovação institucional por ser modelo padrão de adesão
    this.db.approveProposalContract(tenantId, contract.id, opp.assigned_lawyer_id || 'usr_fabricio_cardoso');

    // Criar envelope de assinatura eletrônica (ZapSign / Clicksign)
    const envRes = await this.esignature.createDocumentEnvelope(
      contract.id,
      lead.full_name,
      lead.email || 'cliente@atendimento.law.ai',
      lead.phone,
      renderedContent,
      'APPROVED'
    );

    this.db.createEsignatureEnvelope(
      tenantId,
      contract.id,
      opp.id,
      'zapsign',
      envRes.externalId,
      envRes.signerUrl,
      envRes.mode
    );

    this.db.updateOpportunityStage(tenantId, opp.id, 'SENT_FOR_SIGNATURE');

    // Disparar link de assinatura no WhatsApp do cliente
    const firstName = lead.full_name.split(' ')[0] || 'Cliente';
    const aptRow = this.db.db
      .prepare('SELECT * FROM appointments WHERE tenant_id = ? AND opportunity_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(tenantId, opp.id) as any;

    let meetingInfo = '';
    if (aptRow && aptRow.meeting_link) {
      const aptDate = new Date(aptRow.scheduled_slot_iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      meetingInfo = `\n\n📅 Reunião Confirmada com Advogado: ${aptDate}\nLink da videochamada (Google Meet): ${aptRow.meeting_link}`;
    }

    const whatsappMsg = `Prezado(a) ${firstName}, seu Contrato de Honorários Advocatícios e Procuração com a Cardoso & Associados Advocacia está pronto para assinatura digital com plena validade jurídica.\n\nAcesse o link seguro da plataforma ZapSign para assinar pelo celular:\n${envRes.signerUrl}${meetingInfo}\n\nAssim que assinado, o Dr. Fabricio Cardoso Gomes dará andamento imediato ao seu processo.`;

    await this.messaging.sendMessage(lead.phone, whatsappMsg);

    const protocolNumber = `LAW-${new Date().getFullYear()}-${lead.id.slice(-6).toUpperCase()}`;

    return {
      contract_id: contract.id,
      status: 'SENT_FOR_SIGNATURE',
      signer_url: envRes.signerUrl,
      content_sha256: contentSha256,
      fee_value_brl: feeValue,
      protocol_number: protocolNumber,
      whatsapp_dispatched: true,
    };
  }

  public getPublicIntakeStatus(tenantId: string, leadId: string): IntakeStatusResponse {
    const lead = this.db.getLead(tenantId, leadId);
    const opp = this.db.getOpportunityByLeadId(tenantId, leadId);
    if (!opp) {
      throw new Error(`Oportunidade para o lead ${leadId} não encontrada.`);
    }

    const uploadedDocs = this.db.listLeadDocuments(tenantId, leadId);

    let pendingDocs: string[] = [];
    try {
      pendingDocs = JSON.parse(opp.pending_documents_json);
    } catch {
      pendingDocs = [];
    }

    let assignedLawyerName = 'Dr. Fabricio Cardoso Gomes';
    let assignedLawyerOab = 'OAB/GO 41.209';
    if (opp.assigned_lawyer_id) {
      try {
        const lawyer = this.db.getUser(tenantId, opp.assigned_lawyer_id);
        assignedLawyerName = lawyer.full_name;
        assignedLawyerOab = lawyer.oab_number ? `OAB/${lawyer.oab_uf || 'GO'} ${lawyer.oab_number}` : 'OAB/GO 41.209';
      } catch {}
    }

    const contractStmt = this.db.db.prepare(
      'SELECT c.*, e.signer_url FROM proposals_and_contracts c LEFT JOIN esignature_envelopes e ON c.id = e.contract_id WHERE c.tenant_id = ? AND c.opportunity_id = ? ORDER BY c.created_at DESC LIMIT 1'
    );
    const contractRow = contractStmt.get(tenantId, opp.id) as { id: string; status: any; signer_url?: string } | undefined;

    const aptStmt = this.db.db.prepare(
      'SELECT id, scheduled_slot_iso, meeting_link, status FROM appointments WHERE tenant_id = ? AND opportunity_id = ? ORDER BY created_at DESC LIMIT 1'
    );
    const aptRow = aptStmt.get(tenantId, opp.id) as { id: string; scheduled_slot_iso: string; meeting_link: string; status: string } | undefined;

    return {
      lead_id: lead.id,
      opportunity_id: opp.id,
      full_name: lead.full_name,
      phone: lead.phone,
      legal_area: lead.legal_area || 'TRABALHISTA',
      document_cpf_cnpj: lead.document_cpf_cnpj || null,
      stage: opp.stage,
      assigned_lawyer_name: assignedLawyerName,
      assigned_lawyer_oab: assignedLawyerOab,
      uploaded_documents: uploadedDocs.map((d) => ({
        document_type: d.document_type,
        original_filename: d.original_filename,
        sha256_hash: d.sha256_hash,
        created_at: d.created_at,
      })),
      pending_documents: pendingDocs,
      contract: contractRow
        ? {
            contract_id: contractRow.id,
            status: contractRow.status,
            signer_url: contractRow.signer_url,
          }
        : undefined,
      appointment: aptRow
        ? {
            id: aptRow.id,
            scheduled_slot_iso: aptRow.scheduled_slot_iso,
            meeting_link: aptRow.meeting_link,
            status: aptRow.status,
          }
        : undefined,
    };
  }
}
