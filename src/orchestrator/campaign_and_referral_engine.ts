/**
 * Feature 3 — Motor de Expansão Geográfica de Teses por Município (LegalThesisCampaignManager)
 * Feature 4 — Boca a Boca Digital, Rastreamento de Vídeo (Meta CAPI) e Gatilho Pós-Vídeo (WordOfMouthAndVideoTriggerEngine)
 */

import { randomUUID } from 'node:crypto';
import { DatabaseManager } from '../database/db.js';
import { TwilioWhatsAppProvider, calculateOutboundDedupHash } from '../connectors/providers.js';
import { StrictRecipientResolutionGuard } from '../security/guardrails.js';
import type {
  LeadRecord,
  LegalThesisCampaignRecord,
  VideoTrackingEventRecord,
} from '../types/index.js';

export interface CreateCampaignInput {
  tenant_id: string;
  thesis_name: string;
  target_profession: string;
  municipality: string;
  portal_url?: string;
  average_fee_brl?: number;
  local_law_reference?: string;
  explainer_video_url?: string;
  contract_template_id?: string;
}

/**
 * 3. Gerenciador de Campanhas e Expansão Geográfica de Teses Replicáveis
 */
export class LegalThesisCampaignManager {
  constructor(private db: DatabaseManager) {}

  public createCampaign(input: CreateCampaignInput): LegalThesisCampaignRecord {
    return this.db.createThesisCampaign(input);
  }

  public getCampaign(tenantId: string, campaignId: string): LegalThesisCampaignRecord | null {
    return this.db.getThesisCampaign(tenantId, campaignId);
  }

  public listCampaigns(tenantId: string): LegalThesisCampaignRecord[] {
    return this.db.listThesisCampaigns(tenantId);
  }

  public getPerformanceMetrics(tenantId: string) {
    return this.db.getThesisCampaignsPerformance(tenantId);
  }

  /**
   * Roteia o lead automaticamente para a tese regional de seu município
   */
  public routeLeadToMunicipalityCampaign(
    tenantId: string,
    leadId: string,
    rawTextOrMunicipality?: string
  ): {
    matched: boolean;
    campaign: LegalThesisCampaignRecord | null;
    municipality: string;
  } {
    this.db.requireTenant(tenantId);
    const lead = this.db.getLead(tenantId, leadId);
    const text = (rawTextOrMunicipality || lead.municipality || '').toLowerCase();

    let identifiedMunicipality = lead.municipality || '';
    if (!identifiedMunicipality) {
      if (text.includes('senador canedo')) identifiedMunicipality = 'Senador Canedo - GO';
      else if (text.includes('luziânia') || text.includes('luziania')) identifiedMunicipality = 'Luziânia - GO';
      else if (text.includes('nerópolis') || text.includes('neropolis')) identifiedMunicipality = 'Nerópolis - GO';
      else if (text.includes('rio verde')) identifiedMunicipality = 'Rio Verde - GO';
    }

    if (!identifiedMunicipality && rawTextOrMunicipality && rawTextOrMunicipality.length < 50) {
      identifiedMunicipality = rawTextOrMunicipality;
    }

    const campaign = identifiedMunicipality
      ? this.db.findThesisCampaignByMunicipality(tenantId, identifiedMunicipality, 'PROFESSOR')
      : null;

    if (identifiedMunicipality) {
      this.db.updateLead(tenantId, leadId, {
        municipality: identifiedMunicipality,
        target_profession: 'PROFESSOR_REDE_PUBLICA',
      });

      const opp = this.db.getOpportunityByLeadId(tenantId, leadId);
      if (opp && campaign) {
        this.db.updateOpportunityDetails(tenantId, opp.id, {
          thesis_campaign_id: campaign.id,
          estimated_value_brl: campaign.average_fee_brl || 10000.0,
        });
      }
    }

    return {
      matched: !!campaign,
      campaign,
      municipality: identifiedMunicipality || 'Não Identificado',
    };
  }
}

/**
 * 4. Motor de Vídeo Rastreável, Gatilho Pós-Visualização e Boca a Boca Digital
 */
export class WordOfMouthAndVideoTriggerEngine {
  constructor(
    private db: DatabaseManager,
    private twilioProvider: TwilioWhatsAppProvider,
    public campaignManager: LegalThesisCampaignManager
  ) {}

  /**
   * 4.1 Gera Link de Vídeo Rastreável por Lead
   */
  public generateTrackingLink(
    tenantId: string,
    leadId: string,
    campaignId?: string,
    baseUrl: string = 'https://law.ai'
  ): {
    tracking_code: string;
    video_url: string;
    record: VideoTrackingEventRecord;
  } {
    const record = this.db.createOrGetVideoTracking(tenantId, leadId, campaignId);
    const videoUrl = `${baseUrl.replace(/\/$/, '')}/v/${record.tracking_code}`;
    return {
      tracking_code: record.tracking_code,
      video_url: videoUrl,
      record,
    };
  }

  /**
   * 4.2 Webhook de Telemetria de Engajamento de Vídeo + Gatilho Automático Pós-Visualização
   * Dispara Meta CAPI e mensagem contextual no WhatsApp para >= 50% assistido.
   */
  public async handleVideoEngagementWebhook(params: {
    tracking_code: string;
    watched_pct: number;
    tenant_id?: string;
    event_source?: string;
  }): Promise<{
    success: boolean;
    watched_pct: number;
    lead_id: string;
    qualification_score: number;
    followup_dispatched: boolean;
    follow_up_triggered?: boolean;
    meta_capi_event_id: string;
    whatsapp_message_id?: string;
  }> {
    const tracking = this.db.getVideoTrackingByCode(params.tracking_code);
    if (!tracking) {
      throw new Error(`Código de rastreamento ${params.tracking_code} não localizado.`);
    }

    const tenantId = params.tenant_id || tracking.tenant_id;
    const metaCapiEventId = `capi_evt_${randomUUID().slice(0, 12)}`;

    // Atualiza progresso do vídeo e sincronização Meta CAPI
    const updatedTracking = this.db.updateVideoProgress(params.tracking_code, params.watched_pct, metaCapiEventId);

    const lead = this.db.getLead(tenantId, tracking.lead_id);
    let followupDispatched = false;
    let whatsappMessageId: string | undefined;

    // Se o cliente assistiu a >= 50% do vídeo (Gatilho Lead Quente)
    if (params.watched_pct >= 50) {
      const newScore = Math.max(lead.qualification_score + 25, 85);
      this.db.updateLead(tenantId, lead.id, {
        qualification_score: newScore,
      });

      // Disparo automático pós-vídeo no WhatsApp (respeita opt_out e dedup)
      if (!lead.opt_out) {
        const resolved = StrictRecipientResolutionGuard.resolve(this.db, {
          tenantId,
          leadId: lead.id,
          providedPhone: lead.phone,
        });
        const verifiedPhone = resolved.targetPhone;
        const municipality = lead.municipality || 'seu município';
        const firstName = lead.full_name.split(' ')[0] || 'Prof(a)';

        const messageContent =
          `Oi Prof(a). ${firstName}, tudo bem? Vi que você acabou de assistir ao nosso vídeo explicativo ` +
          `sobre o pagamento das horas extras dos professores de ${municipality}. Ficou alguma dúvida? ` +
          `Se quiser, você já pode me mandar por aqui os dados do Portal do Servidor (ou o último contracheque) ` +
          `que nosso sistema faz o cálculo exato de quanto você tem direito a receber!`;

        const dedup = calculateOutboundDedupHash(tenantId, lead.id, messageContent);
        const sendRes = await this.twilioProvider.sendMessage(verifiedPhone, messageContent, {
          tenantId,
          leadId: lead.id,
          dedupHash: dedup.hash,
        });

        whatsappMessageId = sendRes.messageId;
        followupDispatched = true;

        // Registra na conversa
        const conv = this.db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');
        this.db.addMessage(tenantId, conv.id, 'OUTBOUND', 'BOT', messageContent, {
          syncedToCrm: true,
          externalMessageId: sendRes.messageId,
          dedupHash: dedup.hash,
        });

        // Atualiza CRM
        const opp = this.db.getOpportunityByLeadId(tenantId, lead.id);
        if (opp) {
          this.db.updateOpportunityDetails(tenantId, opp.id, {
            priority: 'HIGH',
            crm_situation_summary: `Assistiu a ${params.watched_pct}% do vídeo explicativo. Mensagem contextual de WhatsApp enviada.`,
          });
        }
      }
    }

    this.db.logAudit(tenantId, 'SYSTEM', 'WordOfMouthAndVideoTriggerEngine', 'VIDEO_ENGAGEMENT_TELEMETRY_PROCESSED', 'video_tracking', tracking.id, {
      watched_pct: params.watched_pct,
      meta_capi_event_id: metaCapiEventId,
      followup_dispatched: followupDispatched,
    });

    return {
      success: true,
      watched_pct: updatedTracking.watched_pct,
      lead_id: lead.id,
      qualification_score: lead.qualification_score,
      followup_dispatched: followupDispatched,
      follow_up_triggered: followupDispatched,
      meta_capi_event_id: metaCapiEventId,
      whatsapp_message_id: whatsappMessageId,
    };
  }

  /**
   * 4.3 Motor de Indicação Automatizada ("Boca a Boca Digital" — ReferralLoopAgent)
   */
  public generateReferralInvite(params: {
    tenantId: string;
    parentLeadId: string;
    baseUrl?: string;
  }): {
    parent_lead: LeadRecord;
    referral_link: string;
    shareable_whatsapp_message: string;
  } {
    const { tenantId, parentLeadId, baseUrl = 'https://law.ai' } = params;
    const parentLead = this.db.getLead(tenantId, parentLeadId);
    const opp = this.db.getOpportunityByLeadId(tenantId, parentLeadId);

    const tracking = this.generateTrackingLink(tenantId, parentLeadId, opp?.thesis_campaign_id || undefined, baseUrl);
    const municipality = parentLead.municipality || 'sua rede municipal';
    const clientName = parentLead.full_name;

    const shareableMessage =
      `Prof(a). ${clientName}, seu contrato já está formalizado! Como essa mesma diferença de horas extras ` +
      `vale para os outros professores da rede de ${municipality}, se você tiver algum colega de escola ` +
      `que também queira fazer o cálculo gratuito da ficha financeira, basta encaminhar este vídeo abaixo para ele: ` +
      `${tracking.video_url}`;

    return {
      parent_lead: parentLead,
      referral_link: tracking.video_url,
      shareable_whatsapp_message: shareableMessage,
    };
  }

  /**
   * Vincula colega indicado ao lead que o indicou (referral_parent_lead_id)
   */
  public registerReferredLead(params: {
    tenantId: string;
    fullName: string;
    phone: string;
    parentLeadId: string;
  }): LeadRecord {
    const { tenantId, fullName, phone, parentLeadId } = params;
    const parentLead = this.db.getLead(tenantId, parentLeadId);

    const newLead = this.db.createLead(
      tenantId,
      fullName,
      phone,
      null,
      null,
      'REFERRAL_BOCA_A_BOCA',
      'TRABALHISTA',
      'HIGH',
      75,
      { referral_parent_name: parentLead.full_name },
      parentLead.municipality,
      'PROFESSOR_REDE_PUBLICA',
      parentLeadId
    );

    this.db.logAudit(tenantId, 'USER', 'ReferralLoopAgent', 'REFERRED_LEAD_ACQUIRED', 'lead', newLead.id, {
      parent_lead_id: parentLeadId,
      parent_lead_name: parentLead.full_name,
      municipality: parentLead.municipality,
    });

    return newLead;
  }
}
