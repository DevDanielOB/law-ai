/**
 * Law.AI — Tipos de Domínio e Contratos TypeScript (Strict Mode)
 * Módulos A a R da Plataforma Jurídica Autônoma
 */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'LAWYER'
  | 'PARALEGAL'
  | 'COMMERCIAL_AGENT'
  | 'FINANCE';

export type LegalArea =
  | 'TRABALHISTA'
  | 'PREVIDENCIARIO'
  | 'CIVEL_CONSUMIDOR'
  | 'CIVEL'
  | 'EMPRESARIAL'
  | 'TRIBUTARIO'
  | 'FAMILIA_SUCESSOES'
  | 'FAMILIA';

export type OpportunityStage =
  | 'INTAKE_IN_PROGRESS'
  | 'NEW'
  | 'QUALIFIED'
  | 'AWAITING_DOCUMENTS'
  | 'DOCUMENTS_RECEIVED'
  | 'CALCULATION_PRESENTED'
  | 'MEETING_SCHEDULED'
  | 'GATE_OAB'
  | 'AWAITING_APPROVAL'
  | 'SENT_FOR_SIGNATURE'
  | 'WON'
  | 'LOST';

export type ContractStatus =
  | 'AWAITING_APPROVAL'
  | 'READY_FOR_LAWYER_SIGNATURE'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT_FOR_SIGNATURE'
  | 'SIGNED';

export type TaskState =
  | 'PENDING'
  | 'RUNNING'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED';

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  oab_society_number: string;
  plan_tier: string;
  monthly_ai_budget_brl: number;
  current_ai_spend_brl: number;
  settings_json: string;
  created_at: string;
}

export interface UserRecord {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone?: string | null;
  oab_number?: string | null;
  oab_uf?: string | null;
  specialties_json: string;
  is_active: number;
  created_at: string;
}

export interface ProcessedWebhookRecord {
  id: string;
  tenant_id: string;
  provider: string;
  external_message_id: string;
  processed_at: string;
  created_at: string;
}

export interface LegalServiceRecord {
  id: string;
  tenant_id: string;
  name: string;
  legal_area: string;
  qualification_questions_json: string;
  base_fee_brl: number;
  success_fee_pct: number;
  requires_lawyer_approval: number;
  created_at: string;
}

export interface LeadRecord {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string;
  email?: string | null;
  document_cpf_cnpj?: string | null;
  source_channel: string;
  legal_area?: string | null;
  urgency_level: string;
  qualification_score: number;
  qualification_data_json: string;
  lgpd_consent_status: string;
  opt_out: number;
  is_anonymized: number;
  municipality?: string | null;
  target_profession?: string | null;
  referral_parent_lead_id?: string | null;
  video_watched_pct?: number;
  video_watched_at?: string | null;
  created_at: string;
}

export interface ConversationRecord {
  id: string;
  tenant_id: string;
  lead_id: string;
  channel: string;
  status: string;
  assigned_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  tenant_id: string;
  conversation_id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender_type: 'LEAD' | 'BOT' | 'LAWYER';
  content: string;
  prompt_injection_flagged: number;
  synced_to_crm: number;
  external_message_id?: string | null;
  dedup_hash?: string | null;
  created_at: string;
}

export interface OpportunityRecord {
  id: string;
  tenant_id: string;
  lead_id: string;
  service_id?: string | null;
  stage: OpportunityStage;
  priority: string;
  estimated_value_brl: number;
  assigned_lawyer_id?: string | null;
  pending_documents_json: string;
  crm_situation_summary: string;
  thesis_campaign_id?: string | null;
  last_conversation_context_notes?: string | null;
  calculation_result_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpTaskRecord {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  lead_id: string;
  reason: string;
  pending_items_json: string;
  scheduled_for_iso: string;
  trigger_mode: string;
  status: string;
  auto_message_preview: string;
  created_at: string;
  updated_at: string;
}

export type LawyerAppointmentDecision = 'APPROVE_PROPOSED_SLOT' | 'PROPOSE_ALTERNATIVE_SLOT';

export interface AppointmentRecord {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  lead_id: string;
  lawyer_user_id: string;
  proposed_slot_iso?: string | null;
  alternative_slot_iso?: string | null;
  calendar_availability_status?: 'AVAILABLE_IN_CALENDAR' | 'CONFLICT_ALTERNATIVE_SUGGESTED' | string | null;
  scheduled_slot_iso: string;
  meeting_link: string;
  status: 'PENDING_LAWYER_CONFIRMATION' | 'CONFIRMED' | 'COUNTER_PROPOSED_BY_LAWYER' | string;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface DocumentTemplateRecord {
  id: string;
  tenant_id: string;
  name: string;
  legal_area: string;
  body_template: string;
  version: number;
  is_approved: number;
  created_at: string;
}

export interface ProposalContractRecord {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  template_id: string;
  rendered_content: string;
  content_sha256: string;
  fee_value_brl: number;
  status: ContractStatus;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  created_at: string;
}

export interface ApprovalRequestRecord {
  id: string;
  tenant_id: string;
  contract_id: string;
  opportunity_id: string;
  action_type: string;
  requested_by_actor: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decided_by_user_id?: string | null;
  decision_notes?: string | null;
  created_at: string;
  decided_at?: string | null;
}

export interface EsignatureEnvelopeRecord {
  id: string;
  tenant_id: string;
  contract_id: string;
  opportunity_id: string;
  provider: string;
  external_id: string;
  signer_url: string;
  status: string;
  execution_mode: string;
  signed_at?: string | null;
  created_at: string;
}

export interface PaymentChargeRecord {
  id: string;
  tenant_id: string;
  contract_id: string;
  opportunity_id: string;
  provider: string;
  external_id: string;
  payment_method: string;
  amount_brl: number;
  pix_copy_paste?: string | null;
  invoice_url: string;
  status: string;
  execution_mode: string;
  paid_at?: string | null;
  created_at: string;
}

export interface AgentTaskRecord {
  id: string;
  tenant_id: string;
  opportunity_id?: string | null;
  agent_type: string;
  objective: string;
  context_json: string;
  allowed_tools_json: string;
  timeout_seconds: number;
  max_budget_brl: number;
  consumed_budget_brl: number;
  state: TaskState;
  result_json: string;
  evidence_logs_json: string;
  success_criteria: string;
  requires_human_approval: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRecord {
  id: string;
  tenant_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  payload_summary: string;
  created_at: string;
}

export interface LeadDocumentRecord {
  id: string;
  tenant_id: string;
  lead_id: string;
  document_type: string;
  original_filename: string;
  storage_uri: string;
  sha256_hash: string;
  byte_size: number;
  mime_type: string;
  created_at: string;
  file_data_base64?: string;
}

export interface IntakeStartRequest {
  tenant_slug?: string;
  full_name: string;
  whatsapp_phone: string;
  service_interest_area: LegalArea | string;
  lgpd_consent: boolean;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
}

export interface IntakeQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'textarea';
  options?: string[];
  required: boolean;
  placeholder?: string;
}

export interface IntakeStartResponse {
  lead_id: string;
  opportunity_id: string;
  tenant_id: string;
  protocol_number: string;
  legal_area: string;
  service_name: string;
  dynamic_questions: IntakeQuestion[];
  required_documents: string[];
  message: string;
}

export interface IntakeCompleteRequest {
  ai_collected_answers: Record<string, unknown>;
  case_narrative?: string;
  document_cpf_cnpj?: string;
  address?: string;
  urgency_liminar?: boolean;
  estimated_value_brl?: number;
  company_name?: string;
}

export interface IntakeCompleteResponse {
  status: string;
  lead_id: string;
  opportunity_id: string;
  opportunity_stage: OpportunityStage;
  assigned_lawyer_name: string;
  assigned_lawyer_oab: string;
  qualification_score: number;
  priority: string;
  documents_received_count: number;
  pending_documents: string[];
  whatsapp_outreach_status: string;
  whatsapp_message_id?: string;
  next_step: string;
}

export interface IntakeContractResponse {
  contract_id: string;
  status: ContractStatus;
  signer_url: string;
  content_sha256: string;
  fee_value_brl: number;
  protocol_number: string;
  whatsapp_dispatched: boolean;
}

export interface IntakeStatusResponse {
  lead_id: string;
  opportunity_id: string;
  full_name: string;
  phone: string;
  legal_area: string;
  document_cpf_cnpj?: string | null;
  stage: OpportunityStage;
  assigned_lawyer_name?: string;
  assigned_lawyer_oab?: string;
  uploaded_documents: Array<{
    document_type: string;
    original_filename: string;
    sha256_hash: string;
    created_at: string;
  }>;
  pending_documents: string[];
  contract?: {
    contract_id: string;
    status: ContractStatus;
    signer_url?: string;
  };
  appointment?: {
    id: string;
    scheduled_slot_iso: string;
    meeting_link: string;
    status: string;
  };
}

export interface LegalThesisCampaignRecord {
  id: string;
  tenant_id: string;
  thesis_name: string;
  target_profession: string;
  municipality: string;
  portal_url?: string | null;
  average_fee_brl: number;
  local_law_reference?: string | null;
  explainer_video_url?: string | null;
  contract_template_id?: string | null;
  is_active: number;
  created_at: string;
}

export interface VideoTrackingEventRecord {
  id: string;
  tenant_id: string;
  lead_id: string;
  thesis_campaign_id?: string | null;
  campaign_id?: string | null;
  tracking_code: string;
  watched_pct: number;
  meta_capi_event_id?: string | null;
  meta_capi_synced?: number;
  watched_at?: string | null;
  created_at: string;
}

export interface PayStubMonthlyRecord {
  month_year: string;
  base_salary_brl: number;
  workload_hours: number;
  overtime_activity_hours_due: number;
  overtime_activity_hours_paid: number;
  difference_due_brl: number;
  bonus_brl: number;
  discounts_brl: number;
}

export interface PayStubData {
  lead_id?: string;
  employee_name?: string;
  matricula: string;
  municipality: string;
  target_profession?: string;
  history_months: PayStubMonthlyRecord[];
  extracted_at: string;
  source_portal?: string;
  storage_uri?: string;
}

export interface CalculationResult {
  lead_id?: string;
  municipality?: string;
  target_profession?: string;
  period_months: number;
  principal_brl: number;
  reflexos_brl: number;
  selic_juros_brl: number;
  total_estimado_cliente_brl: number;
  estimated_fee_brl: number;
  calculation_summary_text: string;
  calculated_at: string;
  memory_uri?: string;
}

export interface ServerCalculationPipelineResult {
  success: boolean;
  status?: 'SUCCESS' | 'ERROR';
  lead_id: string;
  opportunity_id: string;
  municipality: string;
  paystub_storage_uri: string;
  calculation: CalculationResult;
  contract_draft_id?: string;
  draft_task_state?: string;
  whatsapp_message_id?: string;
  presented_to_phone: string;
  whatsapp_dispatched_to?: string;
}
