/**
 * Law.AI — Agente de Agendamento e Gestão de Calendário (SchedulingAndCalendarAgent)
 * Módulo H & N: Detecção de Intenção, Consulta à Agenda e Decisão Humana do Advogado
 */

import { TaskOrchestrator } from './engine.js';
import { StrictRecipientResolutionGuard } from '../security/guardrails.js';
import type { OpportunityStage } from '../types/index.js';

import { calculateOutboundDedupHash } from '../connectors/providers.js';

export function formatSlotPortuguese(slotIso: string): string {
  try {
    const date = new Date(slotIso);
    if (isNaN(date.getTime())) return slotIso;
    const days = [
      'domingo',
      'segunda-feira',
      'terça-feira',
      'quarta-feira',
      'quinta-feira',
      'sexta-feira',
      'sábado',
    ];
    const dayOfWeek = days[date.getUTCDay()];
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    return `${dayOfWeek}, ${dd}/${mm}/${yyyy} às ${hh}:${min}`;
  } catch {
    return slotIso;
  }
}

export function extractProposedSlot(
  text: string,
  referenceDateIso: string = '2026-10-15'
): { slotIso: string; formattedSlot: string; explicitTimeGiven: boolean } {
  const refIso = referenceDateIso || '2026-10-15';

  // 1. Formato ISO direto (ex: 2026-10-15T14:30:00Z)
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\b/);
  if (isoMatch && isoMatch[1]) {
    const raw = isoMatch[1];
    const slotIso = raw.endsWith('Z') ? raw : `${raw}Z`;
    return {
      slotIso,
      formattedSlot: formatSlotPortuguese(slotIso),
      explicitTimeGiven: true,
    };
  }

  // 2. Extração de Horário (ex: 14:30, 14h30, 15h, às 10:00, para as 16, 17 horas, etc.)
  let hour = 14;
  let minute = 30;
  let explicitTimeGiven = false;

  const timeMatch =
    text.match(/(?:às|as|para\s+as|para\s+às)?\s*(\d{1,2})(?::(\d{2})|h(?:oras?|rs?)?(\d{2})?|\s*(?:horas?|hrs?))\b/i) ||
    text.match(/(?:às|as|para\s+as|para\s+às)\s*(\d{1,2})\b/i);

  if (timeMatch && timeMatch[1]) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    explicitTimeGiven = true;
  }

  // 3. Extração de Data
  const refDate = new Date(`${refIso.slice(0, 10)}T12:00:00Z`);
  let targetDate = refIso.slice(0, 10);

  const lower = text.toLowerCase();
  if (lower.includes('amanhã') || lower.includes('amanha')) {
    const next = new Date(refDate.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    targetDate = next.toISOString().slice(0, 10);
  } else if (lower.includes('depois de amanhã') || lower.includes('depois de amanha')) {
    const after = new Date(refDate.getTime());
    after.setUTCDate(after.getUTCDate() + 2);
    targetDate = after.toISOString().slice(0, 10);
  } else if (lower.includes('hoje')) {
    targetDate = refIso.slice(0, 10);
  } else {
    // Dias da semana relativos (segunda a sexta)
    const currentDow = refDate.getUTCDay(); // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
    const dayMap: Record<string, number> = {
      segunda: 1,
      terça: 2,
      terca: 2,
      quarta: 3,
      quinta: 4,
      sexta: 5,
      sábado: 6,
      sabado: 6,
    };
    let foundDow: number | null = null;
    for (const [name, dow] of Object.entries(dayMap)) {
      if (lower.includes(name)) {
        foundDow = dow;
        break;
      }
    }

    if (foundDow !== null) {
      let diff = (foundDow - currentDow + 7) % 7;
      if (diff === 0 && !lower.includes('hoje')) {
        diff = 0;
      }
      const target = new Date(refDate.getTime());
      target.setUTCDate(target.getUTCDate() + diff);
      targetDate = target.toISOString().slice(0, 10);
    } else {
      const dateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
      if (dateMatch && dateMatch[1] && dateMatch[2]) {
        const d = String(dateMatch[1]).padStart(2, '0');
        const m = String(dateMatch[2]).padStart(2, '0');
        const y = dateMatch[3] || refIso.slice(0, 4);
        targetDate = `${y}-${m}-${d}`;
      }
    }
  }

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const slotIso = `${targetDate}T${hh}:${mm}:00Z`;

  return {
    slotIso,
    formattedSlot: formatSlotPortuguese(slotIso),
    explicitTimeGiven,
  };
}

export function isSchedulingConsultationIntent(text: string): boolean {
  if (!text) return false;
  return /agend|marcar|consult|reuni[aã]o|hor[aá]rio|disponib|conversar\s+com|falar\s+com\s+(?:o|a|o\(a\))?\s*(?:advogad|doutor|dr\b|dra\b)|podemos\s+conversar|tem\s+hor[aá]rio|tem\s+vaga/i.test(
    text
  );
}

export function isAffirmativeAcceptance(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (/^(sim|confirmo|pode ser|ok|combinado|confirmado|est[áa] [oó]timo|perfeito|fechado|aceito|t[aá] bom|com certeza|marcado)[\s.!]*$/i.test(trimmed)) {
    return true;
  }
  return /\b(sim|confirmo|confirmado|combinado|pode ser|est[áa] [oó]timo|perfeito|fechado|aceito|t[aá] bom|com certeza|marcado)\b/i.test(trimmed);
}

export class SchedulingAndCalendarAgent {
  constructor(private orchestrator: TaskOrchestrator) {}

  public isSchedulingConsultationIntent(text: string): boolean {
    return isSchedulingConsultationIntent(text);
  }

  public isAffirmativeAcceptance(text: string): boolean {
    return isAffirmativeAcceptance(text);
  }

  public formatSlotPortuguese(slotIso: string): string {
    return formatSlotPortuguese(slotIso);
  }

  public extractProposedSlot(text: string, referenceDateIso: string = '2026-10-15') {
    return extractProposedSlot(text, referenceDateIso);
  }

  /**
   * 3.1 Detecção de Intenção e Criação de Solicitação de Agendamento
   */
  public async handleConsultationRequest(params: {
    tenantId: string;
    leadId: string;
    opportunityId?: string;
    messageText: string;
    referenceDateIso?: string;
  }): Promise<{
    status: 'PENDING_LAWYER_CONFIRMATION';
    appointment_id: string;
    proposed_slot_iso: string;
    proposed_slot_formatted: string;
    alternative_slot_iso: string | null;
    calendar_availability_status: 'AVAILABLE_IN_CALENDAR' | 'CONFLICT_ALTERNATIVE_SUGGESTED';
    reply_text: string;
  }> {
    const { tenantId, leadId, messageText, referenceDateIso = '2026-10-15' } = params;

    // 1. Resolução estrita do cliente
    const lead = this.orchestrator.db.getLead(tenantId, leadId);
    const targetPhone = StrictRecipientResolutionGuard.resolve(this.orchestrator.db, {
      tenantId,
      leadId: lead.id,
      recipientType: 'CLIENT',
    }).targetPhone;

    // 2. Identificar ou obter Oportunidade
    let opp = params.opportunityId
      ? this.orchestrator.db.getOpportunity(tenantId, params.opportunityId)
      : this.orchestrator.db.getOpportunityByLeadId(tenantId, lead.id);

    if (!opp) {
      opp = this.orchestrator.db.createOpportunity(
        tenantId,
        lead.id,
        null,
        'NEW',
        'HIGH',
        3500.0,
        null,
        [],
        'Agendamento de consulta jurídica solicitado pelo cliente'
      );
    }

    // 3. Advogado especialista responsável
    const users = this.orchestrator.db.listUsers(tenantId);
    const assigned = opp.assigned_lawyer_id
      ? users.find((u) => u.id === opp.assigned_lawyer_id)
      : null;
    const specialist = assigned || users.find((u) => u.role === 'LAWYER') || users[0];
    const lawyerId = specialist ? specialist.id : 'usr_default_lawyer';
    const lawyerName = specialist ? specialist.full_name : 'Dr. Fabricio Cardoso Gomes';

    // 4. Extração do horário desejado
    const { slotIso, explicitTimeGiven } = extractProposedSlot(messageText, referenceDateIso);
    const dateOnly = slotIso.slice(0, 10);

    // 5. Consulta da disponibilidade na agenda do advogado
    const availableSlots = await this.orchestrator.calendar.listAvailableSlots(lawyerId, dateOnly);

    let proposedSlotIso = slotIso;
    let alternativeSlotIso: string | null = null;
    let calendarStatus: 'AVAILABLE_IN_CALENDAR' | 'CONFLICT_ALTERNATIVE_SUGGESTED' = 'AVAILABLE_IN_CALENDAR';

    if (explicitTimeGiven) {
      proposedSlotIso = slotIso;
      if (availableSlots.includes(slotIso)) {
        calendarStatus = 'AVAILABLE_IN_CALENDAR';
        alternativeSlotIso = availableSlots.find((s) => s !== slotIso) || null;
      } else {
        // Horário solicitado com conflito na agenda
        calendarStatus = 'CONFLICT_ALTERNATIVE_SUGGESTED';
        alternativeSlotIso = availableSlots[0] || `${dateOnly}T14:30:00Z`;
      }
    } else {
      // Cliente não deu horário explícito: seleciona o primeiro disponível
      proposedSlotIso = availableSlots[0] || `${dateOnly}T14:30:00Z`;
      alternativeSlotIso = availableSlots[1] || `${dateOnly}T16:00:00Z`;
      calendarStatus = 'AVAILABLE_IN_CALENDAR';
    }

    // 6. Criar ou atualizar agendamento no estado PENDING_LAWYER_CONFIRMATION
    let apt = this.orchestrator.db.findRecentPendingAppointment(tenantId, lead.id);
    if (apt) {
      apt = this.orchestrator.db.updateAppointment(tenantId, apt.id, {
        proposed_slot_iso: proposedSlotIso,
        alternative_slot_iso: alternativeSlotIso,
        calendar_availability_status: calendarStatus,
        scheduled_slot_iso: proposedSlotIso,
        status: 'PENDING_LAWYER_CONFIRMATION',
      });
    } else {
      apt = this.orchestrator.db.createAppointment(
        tenantId,
        opp.id,
        lead.id,
        lawyerId,
        proposedSlotIso,
        '',
        'PENDING_LAWYER_CONFIRMATION',
        {
          proposedSlotIso,
          alternativeSlotIso,
          calendarAvailabilityStatus: calendarStatus,
        }
      );
    }

    const proposedSlotFormatted = formatSlotPortuguese(proposedSlotIso);

    // 7. Mensagem cordial ao cliente (exclusivamente para lead.phone)
    const replyText = `Verifiquei a agenda do(a) Dr(a). ${lawyerName} para ${proposedSlotFormatted}. Já enviei sua solicitação de consulta para confirmação final do(a) advogado(a) e te retorno aqui mesmo em instantes!`;

    // Persistir mensagem de saída no histórico de mensagens da conversa
    const conv = this.orchestrator.db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');
    const dedupHash = calculateOutboundDedupHash(tenantId, lead.id, replyText).hash;
    this.orchestrator.db.addMessage(tenantId, conv.id, 'OUTBOUND', 'BOT', replyText, { dedupHash });

    try {
      await this.orchestrator.messaging.sendMessage(targetPhone, replyText, {
        tenantId,
        leadId: lead.id,
        dedupHash,
      });
    } catch (sendErr) {
      console.warn('[SchedulingAgent] Falha ao enviar WhatsApp ao cliente:', sendErr);
    }

    // 8. Notificação imediata ao advogado no painel / auditoria
    this.orchestrator.db.logAudit(
      tenantId,
      'AGENT',
      'SchedulingAndCalendarAgent',
      'APPOINTMENT_REQUESTED_PENDING_LAWYER',
      'appointment',
      apt.id,
      {
        lead_id: lead.id,
        lead_name: lead.full_name,
        lawyer_user_id: lawyerId,
        lawyer_name: lawyerName,
        proposed_slot_iso: proposedSlotIso,
        calendar_availability_status: calendarStatus,
        alternative_slot_iso: alternativeSlotIso,
      }
    );

    return {
      status: 'PENDING_LAWYER_CONFIRMATION',
      appointment_id: apt.id,
      proposed_slot_iso: proposedSlotIso,
      proposed_slot_formatted: proposedSlotFormatted,
      alternative_slot_iso: alternativeSlotIso,
      calendar_availability_status: calendarStatus,
      reply_text: replyText,
    };
  }

  /**
   * 3.2 Decisão do Advogado sobre a Consulta (POST /api/v1/appointments/:appointmentId/lawyer-decision)
   */
  public async handleLawyerDecision(params: {
    tenantId: string;
    appointmentId: string;
    lawyerUserId: string;
    decision: 'APPROVE_PROPOSED_SLOT' | 'PROPOSE_ALTERNATIVE_SLOT';
    alternativeSlotIso?: string;
    notes?: string;
  }): Promise<{
    status: string;
    appointment_id: string;
    meeting_link?: string;
    scheduled_slot_iso?: string;
    scheduled_slot_formatted?: string;
    alternative_slot_iso?: string;
    alternative_slot_formatted?: string;
    opportunity_stage?: OpportunityStage;
    client_notified: boolean;
  }> {
    const { tenantId, appointmentId, lawyerUserId, decision, notes } = params;

    const apt = this.orchestrator.db.getAppointment(tenantId, appointmentId);
    const lead = this.orchestrator.db.getLead(tenantId, apt.lead_id);
    const users = this.orchestrator.db.listUsers(tenantId);
    const lawyer = users.find((u) => u.id === lawyerUserId) || users[0];
    const lawyerName = lawyer ? lawyer.full_name : 'Dr. Fabricio Cardoso Gomes';

    // Destinatário estritamente na ficha do cliente (lead.phone)
    const clientPhone = StrictRecipientResolutionGuard.resolve(this.orchestrator.db, {
      tenantId,
      leadId: lead.id,
      recipientType: 'CLIENT',
    }).targetPhone;

    if (decision === 'APPROVE_PROPOSED_SLOT') {
      const slotToBook = apt.proposed_slot_iso || apt.scheduled_slot_iso;
      const meetRes = await this.orchestrator.calendar.bookSlot(
        lawyer ? lawyer.id : lawyerUserId,
        slotToBook,
        `Consulta Jurídica — ${lead.full_name}`,
        lead.email
      );

      this.orchestrator.db.updateAppointment(tenantId, apt.id, {
        status: 'CONFIRMED',
        scheduled_slot_iso: slotToBook,
        meeting_link: meetRes.meetingLink,
        notes: notes || apt.notes,
      });

      this.orchestrator.db.updateOpportunityStage(tenantId, apt.opportunity_id, 'MEETING_SCHEDULED');

      const scheduledSlotFormatted = formatSlotPortuguese(slotToBook);
      const confirmationMsg = `Olá, ${lead.full_name}! O(A) Dr(a). ${lawyerName} confirmou sua consulta para **${scheduledSlotFormatted}**. Link da reunião: ${meetRes.meetingLink}.`;

      // Persistir mensagem no histórico da conversa
      const conv = this.orchestrator.db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');
      const dedupHash = calculateOutboundDedupHash(tenantId, lead.id, confirmationMsg).hash;
      this.orchestrator.db.addMessage(tenantId, conv.id, 'OUTBOUND', 'LAWYER', confirmationMsg, { dedupHash });

      let clientNotified = false;
      try {
        await this.orchestrator.messaging.sendMessage(clientPhone, confirmationMsg, {
          tenantId,
          leadId: lead.id,
          dedupHash,
        });
        clientNotified = true;
      } catch (err) {
        console.warn('[SchedulingAgent] Falha ao enviar WhatsApp de confirmação:', err);
      }

      this.orchestrator.db.logAudit(
        tenantId,
        'LAWYER',
        lawyerUserId,
        'LAWYER_DECISION_APPROVED_SLOT',
        'appointment',
        apt.id,
        {
          scheduled_slot_iso: slotToBook,
          meeting_link: meetRes.meetingLink,
        }
      );

      return {
        status: 'CONFIRMED',
        appointment_id: apt.id,
        meeting_link: meetRes.meetingLink,
        scheduled_slot_iso: slotToBook,
        scheduled_slot_formatted: scheduledSlotFormatted,
        opportunity_stage: 'MEETING_SCHEDULED',
        client_notified: clientNotified,
      };
    }

    if (decision === 'PROPOSE_ALTERNATIVE_SLOT') {
      const newSlot = params.alternativeSlotIso || apt.alternative_slot_iso;
      if (!newSlot) {
        throw new Error('alternative_slot_iso é obrigatório para propor outro horário.');
      }

      this.orchestrator.db.updateAppointment(tenantId, apt.id, {
        status: 'COUNTER_PROPOSED_BY_LAWYER',
        alternative_slot_iso: newSlot,
        notes: notes || apt.notes,
      });

      const alternativeFormatted = formatSlotPortuguese(newSlot);
      const counterMsg = `Olá, ${lead.full_name}! O(A) Dr(a). ${lawyerName} analisou sua solicitação de consulta e propôs o horário **${alternativeFormatted}**. Esse novo horário fica bom para você? Responda SIM para confirmarmos.`;

      // Persistir mensagem no histórico da conversa
      const conv = this.orchestrator.db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');
      const dedupHash = calculateOutboundDedupHash(tenantId, lead.id, counterMsg).hash;
      this.orchestrator.db.addMessage(tenantId, conv.id, 'OUTBOUND', 'LAWYER', counterMsg, { dedupHash });

      let clientNotified = false;
      try {
        await this.orchestrator.messaging.sendMessage(clientPhone, counterMsg, {
          tenantId,
          leadId: lead.id,
          dedupHash,
        });
        clientNotified = true;
      } catch (err) {
        console.warn('[SchedulingAgent] Falha ao enviar WhatsApp de contraproposta:', err);
      }

      this.orchestrator.db.logAudit(
        tenantId,
        'LAWYER',
        lawyerUserId,
        'LAWYER_DECISION_COUNTER_PROPOSAL',
        'appointment',
        apt.id,
        {
          alternative_slot_iso: newSlot,
        }
      );

      return {
        status: 'COUNTER_PROPOSED_BY_LAWYER',
        appointment_id: apt.id,
        alternative_slot_iso: newSlot,
        alternative_slot_formatted: alternativeFormatted,
        client_notified: clientNotified,
      };
    }

    throw new Error(`Decisão desconhecida: ${decision}`);
  }

  /**
   * 3.3 Aceite da Contraproposta pelo Cliente (quando responde "SIM" ou "Confirmo")
   */
  public async handleClientCounterProposalAcceptance(params: {
    tenantId: string;
    appointmentId: string;
    leadId: string;
  }): Promise<{
    status: 'CONFIRMED';
    appointment_id: string;
    meeting_link: string;
    scheduled_slot_iso: string;
    scheduled_slot_formatted: string;
    client_notified: boolean;
    reply_text: string;
  }> {
    const { tenantId, appointmentId, leadId } = params;

    const apt = this.orchestrator.db.getAppointment(tenantId, appointmentId);
    const lead = this.orchestrator.db.getLead(tenantId, leadId);
    const slotToBook = apt.alternative_slot_iso || apt.proposed_slot_iso || apt.scheduled_slot_iso;

    const users = this.orchestrator.db.listUsers(tenantId);
    const lawyer = users.find((u) => u.id === apt.lawyer_user_id) || users[0];
    const lawyerName = lawyer ? lawyer.full_name : 'Dr. Fabricio Cardoso Gomes';

    const meetRes = await this.orchestrator.calendar.bookSlot(
      lawyer ? lawyer.id : apt.lawyer_user_id,
      slotToBook,
      `Consulta Jurídica — ${lead.full_name}`,
      lead.email
    );

    this.orchestrator.db.updateAppointment(tenantId, apt.id, {
      status: 'CONFIRMED',
      scheduled_slot_iso: slotToBook,
      meeting_link: meetRes.meetingLink,
    });

    this.orchestrator.db.updateOpportunityStage(tenantId, apt.opportunity_id, 'MEETING_SCHEDULED');

    const scheduledFormatted = formatSlotPortuguese(slotToBook);
    const clientMsg = `Olá, ${lead.full_name}! Sua consulta com o(a) Dr(a). ${lawyerName} foi confirmada com sucesso para **${scheduledFormatted}**! Link da reunião: ${meetRes.meetingLink}.`;

    // Persistir mensagem no histórico da conversa
    const conv = this.orchestrator.db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');
    const dedupHash = calculateOutboundDedupHash(tenantId, lead.id, clientMsg).hash;
    this.orchestrator.db.addMessage(tenantId, conv.id, 'OUTBOUND', 'BOT', clientMsg, { dedupHash });

    const clientPhone = StrictRecipientResolutionGuard.resolve(this.orchestrator.db, {
      tenantId,
      leadId: lead.id,
      recipientType: 'CLIENT',
    }).targetPhone;

    let clientNotified = false;
    try {
      await this.orchestrator.messaging.sendMessage(clientPhone, clientMsg, {
        tenantId,
        leadId: lead.id,
        dedupHash,
      });
      clientNotified = true;
    } catch (err) {
      console.warn('[SchedulingAgent] Falha ao enviar WhatsApp de aceite:', err);
    }

    this.orchestrator.db.logAudit(
      tenantId,
      'LEAD',
      leadId,
      'CLIENT_ACCEPTED_COUNTER_PROPOSAL',
      'appointment',
      apt.id,
      {
        scheduled_slot_iso: slotToBook,
        meeting_link: meetRes.meetingLink,
      }
    );

    return {
      status: 'CONFIRMED',
      appointment_id: apt.id,
      meeting_link: meetRes.meetingLink,
      scheduled_slot_iso: slotToBook,
      scheduled_slot_formatted: scheduledFormatted,
      client_notified: clientNotified,
      reply_text: clientMsg,
    };
  }
}
