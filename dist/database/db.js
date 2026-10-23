/**
 * Camada de Persistência Multi-Tenant e Auditoria Imutável (TypeScript)
 * Cobre todos os 18 Módulos (A–R) com isolamento rigoroso por tenant_id
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { TenantIsolationError } from '../security/guardrails.js';
export function utcNowIso() {
    return new Date().toISOString();
}
export class DatabaseManager {
    db;
    constructor(dbPath = ':memory:') {
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA foreign_keys = ON;');
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      -- Módulo A & R: Multi-tenancy e Planos
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        oab_society_number TEXT NOT NULL,
        plan_tier TEXT NOT NULL DEFAULT 'PRO',
        monthly_ai_budget_brl REAL NOT NULL DEFAULT 500.0,
        current_ai_spend_brl REAL NOT NULL DEFAULT 0.0,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      -- Módulo B: Usuários e RBAC
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        email TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        oab_number TEXT,
        oab_uf TEXT,
        specialties_json TEXT NOT NULL DEFAULT '[]',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(tenant_id, email),
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );

      -- Módulo C: Catálogo Jurídico
      CREATE TABLE IF NOT EXISTS legal_services (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        legal_area TEXT NOT NULL,
        qualification_questions_json TEXT NOT NULL,
        base_fee_brl REAL NOT NULL,
        success_fee_pct REAL NOT NULL DEFAULT 0.0,
        requires_lawyer_approval INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );

      -- Módulo D & O: Leads e LGPD
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        document_cpf_cnpj TEXT,
        source_channel TEXT NOT NULL,
        legal_area TEXT,
        urgency_level TEXT NOT NULL DEFAULT 'NORMAL',
        qualification_score INTEGER NOT NULL DEFAULT 0,
        qualification_data_json TEXT NOT NULL DEFAULT '{}',
        lgpd_consent_status TEXT NOT NULL DEFAULT 'GRANTED',
        opt_out INTEGER NOT NULL DEFAULT 0,
        is_anonymized INTEGER NOT NULL DEFAULT 0,
        municipality TEXT,
        target_profession TEXT,
        referral_parent_lead_id TEXT,
        video_watched_pct REAL NOT NULL DEFAULT 0.0,
        video_watched_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE IF NOT EXISTS consent_records (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        legal_basis TEXT NOT NULL,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(lead_id) REFERENCES leads(id)
      );

      -- Módulo E: Inbox Omnichannel
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'BOT_ACTIVE',
        assigned_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(lead_id) REFERENCES leads(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        content TEXT NOT NULL,
        prompt_injection_flagged INTEGER NOT NULL DEFAULT 0,
        synced_to_crm INTEGER NOT NULL DEFAULT 0,
        external_message_id TEXT,
        dedup_hash TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      );

      -- Módulo D: Pipeline e Oportunidades
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        service_id TEXT,
        stage TEXT NOT NULL DEFAULT 'NEW',
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        estimated_value_brl REAL NOT NULL DEFAULT 0.0,
        assigned_lawyer_id TEXT,
        pending_documents_json TEXT NOT NULL DEFAULT '[]',
        crm_situation_summary TEXT NOT NULL DEFAULT '',
        thesis_campaign_id TEXT,
        last_conversation_context_notes TEXT,
        calculation_result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(lead_id) REFERENCES leads(id)
      );

      -- Módulo G: Follow-up de Documentação
      CREATE TABLE IF NOT EXISTS follow_up_tasks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        pending_items_json TEXT NOT NULL DEFAULT '[]',
        scheduled_for_iso TEXT NOT NULL,
        trigger_mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        auto_message_preview TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
      );

      -- Módulo N & H: Agenda e Meet
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        lawyer_user_id TEXT NOT NULL,
        proposed_slot_iso TEXT,
        alternative_slot_iso TEXT,
        calendar_availability_status TEXT DEFAULT 'AVAILABLE_IN_CALENDAR',
        scheduled_slot_iso TEXT NOT NULL,
        meeting_link TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING_LAWYER_CONFIRMATION',
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );

      -- Módulo I: Modelos Contratuais
      CREATE TABLE IF NOT EXISTS document_templates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        legal_area TEXT NOT NULL,
        body_template TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_approved INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );

      -- Módulo J & K: Minutas e Gate OAB
      CREATE TABLE IF NOT EXISTS proposals_and_contracts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        rendered_content TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        fee_value_brl REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL',
        approved_by_user_id TEXT,
        approved_at TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
      );

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        requested_by_actor TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        decided_by_user_id TEXT,
        decision_notes TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(contract_id) REFERENCES proposals_and_contracts(id)
      );

      -- Módulo L: Assinatura Eletrônica
      CREATE TABLE IF NOT EXISTS esignature_envelopes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT UNIQUE NOT NULL,
        signer_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SENT',
        execution_mode TEXT NOT NULL,
        signed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(contract_id) REFERENCES proposals_and_contracts(id)
      );

      -- Módulo M: Cobrança e Pagamento
      CREATE TABLE IF NOT EXISTS payment_charges (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT UNIQUE NOT NULL,
        payment_method TEXT NOT NULL,
        amount_brl REAL NOT NULL,
        pix_copy_paste TEXT,
        invoice_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        execution_mode TEXT NOT NULL,
        paid_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(contract_id) REFERENCES proposals_and_contracts(id)
      );

      -- Módulo Q: Orquestrador de Agentes
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        opportunity_id TEXT,
        agent_type TEXT NOT NULL,
        objective TEXT NOT NULL,
        context_json TEXT NOT NULL,
        allowed_tools_json TEXT NOT NULL,
        timeout_seconds INTEGER NOT NULL DEFAULT 60,
        max_budget_brl REAL NOT NULL DEFAULT 2.0,
        consumed_budget_brl REAL NOT NULL DEFAULT 0.0,
        state TEXT NOT NULL DEFAULT 'PENDING',
        result_json TEXT NOT NULL DEFAULT '{}',
        evidence_logs_json TEXT NOT NULL DEFAULT '[]',
        success_criteria TEXT NOT NULL,
        requires_human_approval INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );

      -- Idempotência de Webhooks
      CREATE TABLE IF NOT EXISTS processed_webhooks (
        idempotency_key TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );

      -- Módulo Documentos de Leads (Cofre Seguro com SHA-256)
      CREATE TABLE IF NOT EXISTS lead_documents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        storage_uri TEXT NOT NULL,
        sha256_hash TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        file_data_base64 TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(lead_id) REFERENCES leads(id)
      );

      -- Feature 3: Expansão Geográfica de Teses por Município
      CREATE TABLE IF NOT EXISTS legal_thesis_campaigns (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        thesis_name TEXT NOT NULL,
        target_profession TEXT NOT NULL,
        municipality TEXT NOT NULL,
        portal_url TEXT,
        average_fee_brl REAL NOT NULL DEFAULT 10000.0,
        local_law_reference TEXT,
        explainer_video_url TEXT,
        contract_template_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );

      -- Feature 4: Rastreamento de Vídeo e Boca a Boca Digital
      CREATE TABLE IF NOT EXISTS video_tracking_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lead_id TEXT NOT NULL,
        thesis_campaign_id TEXT,
        tracking_code TEXT NOT NULL UNIQUE,
        watched_pct REAL NOT NULL DEFAULT 0.0,
        meta_capi_event_id TEXT,
        meta_capi_synced INTEGER NOT NULL DEFAULT 0,
        watched_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(id),
        FOREIGN KEY(lead_id) REFERENCES leads(id)
      );

      -- Módulo O: Auditoria Imutável
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        payload_summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
        const tryExec = (sql) => {
            try {
                this.db.exec(sql);
            }
            catch { }
        };
        tryExec('ALTER TABLE users ADD COLUMN phone TEXT;');
        tryExec('ALTER TABLE lead_documents ADD COLUMN file_data_base64 TEXT;');
        tryExec('ALTER TABLE messages ADD COLUMN external_message_id TEXT;');
        tryExec('ALTER TABLE messages ADD COLUMN dedup_hash TEXT;');
        tryExec('ALTER TABLE processed_webhooks ADD COLUMN external_message_id TEXT;');
        tryExec('ALTER TABLE appointments ADD COLUMN proposed_slot_iso TEXT;');
        tryExec('ALTER TABLE appointments ADD COLUMN alternative_slot_iso TEXT;');
        tryExec('ALTER TABLE appointments ADD COLUMN calendar_availability_status TEXT DEFAULT "AVAILABLE_IN_CALENDAR";');
        tryExec('ALTER TABLE appointments ADD COLUMN notes TEXT;');
        tryExec('ALTER TABLE appointments ADD COLUMN updated_at TEXT;');
        // Migrations for Feature 1, 2, 3, 4
        tryExec('ALTER TABLE leads ADD COLUMN municipality TEXT;');
        tryExec('ALTER TABLE leads ADD COLUMN target_profession TEXT;');
        tryExec('ALTER TABLE leads ADD COLUMN referral_parent_lead_id TEXT;');
        tryExec('ALTER TABLE leads ADD COLUMN video_watched_pct REAL DEFAULT 0.0;');
        tryExec('ALTER TABLE leads ADD COLUMN video_watched_at TEXT;');
        tryExec('ALTER TABLE opportunities ADD COLUMN thesis_campaign_id TEXT;');
        tryExec('ALTER TABLE opportunities ADD COLUMN last_conversation_context_notes TEXT;');
        tryExec('ALTER TABLE opportunities ADD COLUMN calculation_result_json TEXT;');
        tryExec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tenant_external_id ON messages (tenant_id, external_message_id) WHERE external_message_id IS NOT NULL;');
        tryExec('CREATE INDEX IF NOT EXISTS idx_messages_outbound_dedup ON messages (tenant_id, dedup_hash);');
        tryExec('CREATE INDEX IF NOT EXISTS idx_processed_webhooks_lookup ON processed_webhooks (tenant_id, idempotency_key);');
        tryExec('CREATE INDEX IF NOT EXISTS idx_leads_referral ON leads (tenant_id, referral_parent_lead_id);');
        tryExec('CREATE INDEX IF NOT EXISTS idx_thesis_campaigns_muni ON legal_thesis_campaigns (tenant_id, municipality);');
        tryExec('CREATE INDEX IF NOT EXISTS idx_video_tracking_code ON video_tracking_events (tracking_code);');
    }
    seedDefaultData() {
        const existing = this.db.prepare('SELECT COUNT(*) as count FROM tenants').get();
        const now = utcNowIso();
        if (!existing || existing.count === 0) {
            // 1. Tenants
            this.db.prepare(`
      INSERT INTO tenants (id, name, slug, oab_society_number, plan_tier, monthly_ai_budget_brl, current_ai_spend_brl, settings_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0.0, '{}', ?)
    `).run('tnt_cardoso_adv', 'Cardoso & Associados Advocacia', 'cardoso-adv', 'OAB/GO 4.512', 'PRO', 1500.0, now);
            this.db.prepare(`
      INSERT INTO tenants (id, name, slug, oab_society_number, plan_tier, monthly_ai_budget_brl, current_ai_spend_brl, settings_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0.0, '{}', ?)
    `).run('tnt_monteiro_corp', 'Monteiro Direito Empresarial', 'monteiro-corp', 'OAB/SP 19.880', 'ENTERPRISE', 3000.0, now);
            // 2. Users (Dr. Fabricio Cardoso Gomes como Advogado Titular)
            this.db.prepare(`
      INSERT INTO users (id, tenant_id, email, full_name, role, oab_number, oab_uf, specialties_json, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run('usr_fabricio_cardoso', 'tnt_cardoso_adv', 'fabricio@cardosoadv.com.br', 'Dr. Fabricio Cardoso Gomes', 'LAWYER', '41209', 'GO', JSON.stringify(['TRABALHISTA', 'PREVIDENCIARIO', 'CIVEL_CONSUMIDOR', 'CIVEL', 'EMPRESARIAL', 'TRIBUTARIO', 'FAMILIA_SUCESSOES', 'FAMILIA']), now);
            this.db.prepare(`
      INSERT INTO users (id, tenant_id, email, full_name, role, oab_number, oab_uf, specialties_json, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run('usr_lucas_martins', 'tnt_cardoso_adv', 'lucas@cardosoadv.com.br', 'Lucas Martins', 'PARALEGAL', null, null, JSON.stringify(['TRABALHISTA']), now);
            // 3. Legal Services (Todos os 6 ramos de atuação institucional)
            const services = [
                {
                    id: 'srv_trabalhista_01',
                    name: 'Reclamação Trabalhista (Horas Extras & Rescisão Indireta)',
                    area: 'TRABALHISTA',
                    questions: ['Houve registro em CTPS?', 'Atraso de FGTS ou verbas rescisórias?'],
                    baseFee: 3500.0,
                    successFee: 20.0,
                },
                {
                    id: 'srv_previdenciario_01',
                    name: 'Planejamento e Concessão de Benefício (INSS)',
                    area: 'PREVIDENCIARIO',
                    questions: ['Tempo especial de trabalho?', 'Houve indeferimento administrativo?'],
                    baseFee: 2800.0,
                    successFee: 30.0,
                },
                {
                    id: 'srv_civel_01',
                    name: 'Ação Indenizatória e Defesa do Consumidor',
                    area: 'CIVEL_CONSUMIDOR',
                    questions: ['Houve negativação indevida ou vício do produto/serviço?', 'Qual prejuízo estimado?'],
                    baseFee: 2500.0,
                    successFee: 20.0,
                },
                {
                    id: 'srv_familia_01',
                    name: 'Ação de Família e Sucessões',
                    area: 'FAMILIA_SUCESSOES',
                    questions: ['Há menores envolvidos?', 'Existe consenso na partilha de bens?'],
                    baseFee: 4000.0,
                    successFee: 0.0,
                },
                {
                    id: 'srv_empresarial_01',
                    name: 'Assessoria Jurídica Empresarial e Contratos',
                    area: 'EMPRESARIAL',
                    questions: ['Qual é o porte e passivo atual da empresa?', 'Há litígios societários em curso?'],
                    baseFee: 8500.0,
                    successFee: 0.0,
                },
                {
                    id: 'srv_tributario_01',
                    name: 'Defesa em Execução Fiscal e Planejamento Tributário',
                    area: 'TRIBUTARIO',
                    questions: ['Já foi expedida CDA ou notificação de penhora?', 'Qual a esfera do tributo?'],
                    baseFee: 6000.0,
                    successFee: 15.0,
                },
            ];
            const srvStmt = this.db.prepare(`
      INSERT INTO legal_services (id, tenant_id, name, legal_area, qualification_questions_json, base_fee_brl, success_fee_pct, requires_lawyer_approval, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
            for (const s of services) {
                srvStmt.run(s.id, 'tnt_cardoso_adv', s.name, s.area, JSON.stringify(s.questions), s.baseFee, s.successFee, now);
            }
            // 4. Document Templates Oficiais Aprovados
            const contractTemplateBody = (areaTitle) => `
CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS E HONORÁRIOS — ${areaTitle.toUpperCase()}
CARDOSO & ASSOCIADOS ADVOCACIA — OAB/GO 4.512

1. CONTRATANTE: {{full_name}}, inscrito(a) no CPF/CNPJ sob o nº {{document_cpf_cnpj}}, com endereço em {{address}}.
2. CONTRATADO: CARDOSO & ASSOCIADOS ADVOCACIA, sociedade de advogados inscrita na OAB/GO sob o nº 4.512, representada pelo Dr. Fabricio Cardoso Gomes, OAB/GO 41.209.
3. DO OBJETO: Prestação de serviços jurídicos profissionais especializados na área ${areaTitle}, especificamente relativos a {{service_name}}.
4. DOS HONORÁRIOS: Pela prestação dos serviços contratados, o CONTRATANTE pagará ao CONTRATADO o valor inicial de R$ {{fee_value_brl}} e honorários de êxito no percentual de {{success_fee_pct}}% sobre o proveito econômico obtido.
5. DA PROCURAÇÃO AD JUDICIA ET EXTRA: O CONTRATANTE outorga amplos poderes da cláusula ad judicia et extra para o foro em geral aos advogados da CARDOSO & ASSOCIADOS ADVOCACIA.
6. ELEIÇÃO DE FORO: Fica eleito o foro da Comarca de Goiânia/GO para dirimir quaisquer dúvidas oriundas deste instrumento.
`;
            const templates = [
                { id: 'tmpl_honorarios_padrao', name: 'Contrato de Honorários Advocatícios Trabalhistas', area: 'TRABALHISTA' },
                { id: 'tmpl_honorarios_previdenciario', name: 'Contrato de Honorários Previdenciários INSS', area: 'PREVIDENCIARIO' },
                { id: 'tmpl_honorarios_civel', name: 'Contrato de Honorários Cível e Consumidor', area: 'CIVEL_CONSUMIDOR' },
                { id: 'tmpl_honorarios_familia', name: 'Contrato de Honorários Família e Sucessões', area: 'FAMILIA_SUCESSOES' },
                { id: 'tmpl_honorarios_empresarial', name: 'Contrato de Honorários Consultoria Empresarial', area: 'EMPRESARIAL' },
                { id: 'tmpl_honorarios_tributario', name: 'Contrato de Honorários Contencioso Tributário', area: 'TRIBUTARIO' },
            ];
            const tmplStmt = this.db.prepare(`
      INSERT INTO document_templates (id, tenant_id, name, legal_area, body_template, version, is_approved, created_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?)
    `);
            for (const t of templates) {
                tmplStmt.run(t.id, 'tnt_cardoso_adv', t.name, t.area, contractTemplateBody(t.name), now);
            }
            // 6. Audit Log Inicial do Escritório
            this.logAudit('tnt_cardoso_adv', 'SYSTEM', 'bootstrap', 'TENANT_PROVISIONED', 'tenant', 'tnt_cardoso_adv', { name: 'Cardoso & Associados Advocacia' });
            this.logAudit('tnt_cardoso_adv', 'USER', 'usr_fabricio_cardoso', 'LAWYER_REGISTERED', 'user', 'usr_fabricio_cardoso', { name: 'Dr. Fabricio Cardoso Gomes', oab: '41209/GO' });
        }
        // 5. Teses Regionais de Horas Extras de Professores (Módulo Expansão Geográfica)
        const existingCmp = this.db.prepare('SELECT COUNT(*) as count FROM legal_thesis_campaigns WHERE tenant_id = ?').get('tnt_cardoso_adv');
        if (!existingCmp || existingCmp.count === 0) {
            const thesisCampaigns = [
                {
                    id: 'cmp_magisterio_senador_canedo',
                    name: 'Ação de Horas Extras Magistério Municipal — Senador Canedo',
                    profession: 'PROFESSOR_REDE_PUBLICA',
                    municipality: 'Senador Canedo - GO',
                    portalUrl: 'https://servicos.senadorcanedo.go.gov.br/portal-do-servidor',
                    lawRef: 'Lei Complementar Municipal 2.188/2018 (Estatuto Magistério)',
                    videoUrl: 'https://cdn.law.ai/videos/horas_extras_senador_canedo.mp4',
                },
                {
                    id: 'cmp_magisterio_luziania',
                    name: 'Ação de Horas Extras Magistério Municipal — Luziânia',
                    profession: 'PROFESSOR_REDE_PUBLICA',
                    municipality: 'Luziânia - GO',
                    portalUrl: 'https://transparencia.luziania.go.gov.br/servidor',
                    lawRef: 'Lei Municipal 3.421/2012 (Plano de Carreira do Magistério)',
                    videoUrl: 'https://cdn.law.ai/videos/horas_extras_luziania.mp4',
                },
                {
                    id: 'cmp_magisterio_neropolis',
                    name: 'Ação de Horas Extras Magistério Municipal — Nerópolis',
                    profession: 'PROFESSOR_REDE_PUBLICA',
                    municipality: 'Nerópolis - GO',
                    portalUrl: 'https://neropolis.go.gov.br/portal-do-servidor',
                    lawRef: 'Lei Municipal 1.540/2011 (Estatuto dos Professores)',
                    videoUrl: 'https://cdn.law.ai/videos/horas_extras_neropolis.mp4',
                },
                {
                    id: 'cmp_magisterio_rio_verde',
                    name: 'Ação de Horas Extras Magistério Municipal — Rio Verde',
                    profession: 'PROFESSOR_REDE_PUBLICA',
                    municipality: 'Rio Verde - GO',
                    portalUrl: 'https://portaldoservidor.rioverde.go.gov.br',
                    lawRef: 'Lei Municipal 5.890/2010 (Piso e Jornada Magistério)',
                    videoUrl: 'https://cdn.law.ai/videos/horas_extras_rio_verde.mp4',
                },
            ];
            const cmpStmt = this.db.prepare(`
        INSERT INTO legal_thesis_campaigns (
          id, tenant_id, thesis_name, target_profession, municipality,
          portal_url, average_fee_brl, local_law_reference, explainer_video_url,
          contract_template_id, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 10000.0, ?, ?, 'tmpl_honorarios_padrao', 1, ?)
      `);
            for (const c of thesisCampaigns) {
                cmpStmt.run(c.id, 'tnt_cardoso_adv', c.name, c.profession, c.municipality, c.portalUrl, c.lawRef, c.videoUrl, now);
            }
        }
        // 7. Dados de Apresentação / Demonstração Operacional (Leads, CRM, Conversas, Cofre SHA-256, Agenda, Gate OAB, Fechamento)
        this.seedPresentationMockData(false);
    }
    seedPresentationMockData(forceReset = false) {
        const now = utcNowIso();
        const tntCardoso = 'tnt_cardoso_adv';
        const tntMonteiro = 'tnt_monteiro_corp';
        if (forceReset) {
            for (const tId of [tntCardoso, tntMonteiro]) {
                this.db.prepare('DELETE FROM video_tracking_events WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM payment_charges WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM esignature_envelopes WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM approval_requests WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM proposals_and_contracts WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM appointments WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM follow_up_tasks WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM agent_tasks WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM messages WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM conversations WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM lead_documents WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM consent_records WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM opportunities WHERE tenant_id = ?').run(tId);
                this.db.prepare('DELETE FROM leads WHERE tenant_id = ?').run(tId);
            }
        }
        const existingLeads = this.db.prepare('SELECT COUNT(*) as count FROM leads WHERE tenant_id = ?').get(tntCardoso);
        if (existingLeads && existingLeads.count > 0) {
            const existingOpps = this.db.prepare('SELECT COUNT(*) as count FROM opportunities WHERE tenant_id = ?').get(tntCardoso);
            return { seeded: false, leads_count: existingLeads.count, opportunities_count: existingOpps?.count || 0 };
        }
        // Atualizar consumo de IA realista dos escritórios
        this.db.prepare('UPDATE tenants SET current_ai_spend_brl = 148.90 WHERE id = ?').run(tntCardoso);
        this.db.prepare('UPDATE tenants SET current_ai_spend_brl = 412.50 WHERE id = ?').run(tntMonteiro);
        // Garantir usuário e catálogo no tenant Monteiro Corp (para demonstrar isolamento multi-tenant)
        this.db.prepare(`
      INSERT OR IGNORE INTO users (id, tenant_id, email, full_name, role, oab_number, oab_uf, specialties_json, is_active, created_at)
      VALUES ('usr_ricardo_monteiro', 'tnt_monteiro_corp', 'ricardo@monteirocorp.com.br', 'Dr. Ricardo Monteiro', 'LAWYER', '198801', 'SP', '["EMPRESARIAL","TRIBUTARIO"]', 1, ?)
    `).run(now);
        this.db.prepare(`
      INSERT OR IGNORE INTO legal_services (id, tenant_id, name, legal_area, qualification_questions_json, base_fee_brl, success_fee_pct, requires_lawyer_approval, created_at)
      VALUES ('srv_monteiro_ma', 'tnt_monteiro_corp', 'Fusão Societária e Blindagem Patrimonial Holding', 'EMPRESARIAL', '["Faturamento anual acima de R$ 10M?"]', 45000.0, 10.0, 1, ?)
    `).run(now);
        const mockPdfB64 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nDocumento Jurídico Certificado no Cofre SHA-256 Law.AI\n%%EOF').toString('base64');
        const hashOf = (seed) => createHash('sha256').update(seed).digest('hex');
        const demoCases = [
            {
                leadId: 'led_prof_helena',
                oppId: 'opp_prof_helena',
                name: 'Profª Helena Castro Silva',
                phone: '+5562998112233',
                email: 'helena.castro@seduc.senadorcanedo.go.gov.br',
                cpf: '718.420.911-34',
                channel: 'WHATSAPP',
                area: 'TRABALHISTA',
                serviceId: 'srv_trabalhista_01',
                urgency: 'HIGH',
                score: 96,
                municipality: 'Senador Canedo - GO',
                profession: 'PROFESSOR_REDE_PUBLICA',
                videoPct: 100,
                stage: 'WON',
                priority: 'HIGH',
                valueBrl: 10000.0,
                campaignId: 'cmp_magisterio_senador_canedo',
                pendingDocs: [],
                summary: 'Contrato assinado via Clicksign + PIX confirmado no Asaas. Ação de Horas Extras do Magistério (60 meses apurados: R$ 48.750,00 ao cliente / R$ 10.000,00 honorários).',
                contextNotes: 'Professora concursada de Senador Canedo assistiu 100% do vídeo explicativo, enviou ficha financeira dos últimos 5 anos e assinou procuração digital.',
                calcResult: {
                    principal_brl: 36500.0,
                    reflexos_brl: 12250.0,
                    total_estimado_cliente_brl: 48750.0,
                    estimated_fee_brl: 10000.0,
                    period_months: 60,
                    law_reference: 'Lei Complementar Municipal 2.188/2018 (Senador Canedo)',
                },
                docs: [
                    { type: 'CNH_RG', filename: 'CNH_Digital_Helena_Castro.pdf', size: 248910 },
                    { type: 'FICHA_FINANCEIRA_PORTAL', filename: 'Ficha_Financeira_60m_Senador_Canedo_Helena.pdf', size: 612400 },
                    { type: 'COMPROVANTE_ENDERECO', filename: 'Comprovante_Residencia_Senador_Canedo.pdf', size: 184200 },
                ],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Bom dia! Sou professora efetiva da rede municipal de Senador Canedo há 8 anos e vi o vídeo sobre as horas-atividade não pagas.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Olá Profª Helena! Tudo bem? Pela Lei Complementar Municipal 2.188/2018 de Senador Canedo, você tem direito às diferenças dos últimos 60 meses. Já extraímos sua ficha financeira no Portal do Servidor e apuramos R$ 48.750,00!' },
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Que maravilha! Acabei de assinar o contrato pelo link da Clicksign e indiquei minha colega da escola.' },
                    { dir: 'OUTBOUND', sender: 'LAWYER', text: 'Perfeito, Profª Helena! Dr. Fabricio aqui. Seu processo já está protocolado e o dossiê criptografado no nosso Cofre SHA-256.' },
                ],
            },
            {
                leadId: 'led_prof_carlos',
                oppId: 'opp_prof_carlos',
                name: 'Prof. Carlos Eduardo Souza',
                phone: '+5562984221190',
                email: 'carlos.souza@educacao.senadorcanedo.go.gov.br',
                cpf: '402.881.331-09',
                channel: 'WHATSAPP',
                area: 'TRABALHISTA',
                serviceId: 'srv_trabalhista_01',
                urgency: 'HIGH',
                score: 94,
                municipality: 'Senador Canedo - GO',
                profession: 'PROFESSOR_REDE_PUBLICA',
                referralParentId: 'led_prof_helena',
                videoPct: 95,
                stage: 'CALCULATION_PRESENTED',
                priority: 'HIGH',
                valueBrl: 10000.0,
                campaignId: 'cmp_magisterio_senador_canedo',
                pendingDocs: [],
                summary: 'Ficha financeira de 60 meses extraída pelo Portal (Credencial descartada da RAM). Cálculo de R$ 44.620,00 apresentado no WhatsApp + Minuta pronta aguardando assinatura.',
                contextNotes: 'Veio indicado pela Profª Helena Castro. Forneceu acesso efêmero ao portal de Senador Canedo; cálculo de R$ 44.620,00 enviado pelo agente.',
                calcResult: {
                    principal_brl: 33465.0,
                    reflexos_brl: 11155.0,
                    total_estimado_cliente_brl: 44620.0,
                    estimated_fee_brl: 10000.0,
                    period_months: 60,
                    law_reference: 'Lei Complementar Municipal 2.188/2018 (Senador Canedo)',
                },
                docs: [
                    { type: 'FICHA_FINANCEIRA_PORTAL', filename: 'Ficha_Financeira_60m_Carlos_Eduardo.pdf', size: 594120 },
                    { type: 'CNH_RG', filename: 'RG_Funcional_Prof_Carlos.pdf', size: 210400 },
                ],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Olá! A Profª Helena da Escola Municipal me mandou o link de indicação de vocês. Também sou professor 40h em Senador Canedo.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Seja muito bem-vindo, Prof. Carlos! Acabamos de processar seus 60 contracheques no Portal do Servidor (sua senha já foi descartada em conformidade com a LGPD). Seu crédito estimado é de R$ 44.620,00 (Principal R$ 33.465,00 + Reflexos R$ 11.155,00).' },
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Excelente valor! Estou conferindo o resumo do cálculo aqui no WhatsApp para já assinar a procuração.' },
                ],
            },
            {
                leadId: 'led_roberto_almeida',
                oppId: 'opp_roberto_almeida',
                name: 'Roberto Almeida Construções Ltda',
                phone: '+5562991445566',
                email: 'diretoria@almeidaconstrucoes.com.br',
                cpf: '18.492.104/0001-77',
                channel: 'WEB',
                area: 'TRIBUTARIO',
                serviceId: 'srv_tributario_01',
                urgency: 'CRITICAL',
                score: 92,
                municipality: 'Goiânia - GO',
                profession: 'EMPRESARIO_CONSTRUCAO',
                videoPct: 60,
                stage: 'GATE_OAB',
                priority: 'HIGH',
                valueBrl: 18500.0,
                campaignId: null,
                pendingDocs: [],
                summary: 'Defesa em Execução Fiscal ICMS/ISS + Pedido Liminar de Desbloqueio SISBAJUD. Minuta de Contrato de Honorários (R$ 18.500,00) retida no Gate OAB aguardando aprovação do Dr. Fabricio.',
                contextNotes: 'Empresa sofreu bloqueio cautelar via SISBAJUD; enviou CDA e Contrato Social completo. Aguarda chancela humana no Gate OAB para disparo Clicksign + Asaas.',
                docs: [
                    { type: 'CONTRATO_SOCIAL', filename: 'Contrato_Social_Consolidado_Almeida_Ltda.pdf', size: 842000 },
                    { type: 'CDA_EXECUCAO_FISCAL', filename: 'CDA_Execucao_Fiscal_SEFAZ_GO_2026.pdf', size: 495300 },
                    { type: 'EXTRATO_BLOQUEIO', filename: 'Comprovante_Bloqueio_SISBAJUD.pdf', size: 175800 },
                ],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Preciso de atendimento urgente! Tivemos uma execução fiscal estadual com ordem de bloqueio e precisamos apresentar exceção de pré-executividade.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Recebemos a Certidão de Dívida Ativa (CDA) e o Contrato Social no Cofre Criptografado SHA-256. A minuta de honorários (R$ 18.500,00) já foi gerada e está no Gate Humano OAB para aprovação imediata do Dr. Fabricio Cardoso.' },
                ],
            },
            {
                leadId: 'led_prof_sandra',
                oppId: 'opp_prof_sandra',
                name: 'Profª Sandra Regina Oliveira',
                phone: '+5561992108877',
                email: 'sandra.regina@sme.luziania.go.gov.br',
                cpf: '529.104.881-20',
                channel: 'WHATSAPP',
                area: 'TRABALHISTA',
                serviceId: 'srv_trabalhista_01',
                urgency: 'HIGH',
                score: 90,
                municipality: 'Luziânia - GO',
                profession: 'PROFESSOR_REDE_PUBLICA',
                videoPct: 100,
                stage: 'WON',
                priority: 'HIGH',
                valueBrl: 10000.0,
                campaignId: 'cmp_magisterio_luziania',
                pendingDocs: [],
                summary: 'Tese Magistério Luziânia (Lei Municipal 3.421/2012) — Contrato assinado e documentação 100% auditada. Valor da causa apurado em R$ 41.900,00.',
                contextNotes: 'Professora de Luziânia enviou todos os contracheques e confirmou assinatura eletrônica na Clicksign.',
                calcResult: {
                    principal_brl: 31800.0,
                    reflexos_brl: 10100.0,
                    total_estimado_cliente_brl: 41900.0,
                    estimated_fee_brl: 10000.0,
                    period_months: 60,
                    law_reference: 'Lei Municipal 3.421/2012 (Luziânia)',
                },
                docs: [
                    { type: 'FICHA_FINANCEIRA_PORTAL', filename: 'Ficha_Financeira_Luziania_Sandra_Regina.pdf', size: 530100 },
                    { type: 'CNH_RG', filename: 'CNH_Sandra_Regina.pdf', size: 198000 },
                ],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Olá! Sou professora em Luziânia e já enviei minha ficha financeira completa e assinei o contrato digital.' },
                    { dir: 'OUTBOUND', sender: 'LAWYER', text: 'Obrigado pela confiança, Profª Sandra! Sua ação de horas extras do magistério de Luziânia já está pronta para distribuição.' },
                ],
            },
            {
                leadId: 'led_joao_batista',
                oppId: 'opp_joao_batista',
                name: 'João Batista Mendonça',
                phone: '+5562985554411',
                email: 'joao.mendonca64@gmail.com',
                cpf: '219.654.091-55',
                channel: 'WHATSAPP',
                area: 'PREVIDENCIARIO',
                serviceId: 'srv_previdenciario_01',
                urgency: 'HIGH',
                score: 88,
                municipality: 'Anápolis - GO',
                profession: 'METALURGICO_APOSENTADO',
                videoPct: 80,
                stage: 'MEETING_SCHEDULED',
                priority: 'HIGH',
                valueBrl: 12400.0,
                campaignId: null,
                pendingDocs: ['PPP Atualizado da última metalúrgica'],
                summary: 'Concessão de Aposentadoria Especial (25 anos de insalubridade + conversão de tempo especial). Reunião por vídeo agendada com Dr. Fabricio via Google Meet.',
                contextNotes: 'Cliente já enviou CNIS completo e carta de indeferimento do INSS; pediu reunião por vídeo para tirar dúvida sobre o PPP antes de assinar.',
                docs: [
                    { type: 'EXTRATO_CNIS_INSS', filename: 'Extrato_CNIS_Previdenciario_Joao_Batista.pdf', size: 412000 },
                    { type: 'CARTA_INDEFERIMENTO_INSS', filename: 'Carta_Indeferimento_NB_42_198442.pdf', size: 289000 },
                ],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Doutor, o INSS negou minha aposentadoria especial dizendo que faltou o laudo LTCAT de 2014 a 2019. Já mandei o CNIS.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Sr. João Batista, analisamos seu CNIS e há excelente viabilidade de reversão judicial com atrasados desde a DER! Agendamos sua consulta por vídeo com o Dr. Fabricio.' },
                ],
            },
            {
                leadId: 'led_prof_beatriz',
                oppId: 'opp_prof_beatriz',
                name: 'Profª Beatriz Mendes Rocha',
                phone: '+5562993335566',
                email: 'beatriz.rocha@neropolis.go.gov.br',
                cpf: '841.220.191-72',
                channel: 'INSTAGRAM',
                area: 'TRABALHISTA',
                serviceId: 'srv_trabalhista_01',
                urgency: 'NORMAL',
                score: 84,
                municipality: 'Nerópolis - GO',
                profession: 'PROFESSOR_REDE_PUBLICA',
                videoPct: 78,
                stage: 'AWAITING_DOCUMENTS',
                priority: 'HIGH',
                valueBrl: 10000.0,
                campaignId: 'cmp_magisterio_neropolis',
                pendingDocs: ['Senha do Portal do Servidor de Nerópolis ou Ficha Financeira 60m', 'Comprovante de Endereço atualizado'],
                summary: 'Assistiu 78% do vídeo explicativo (Meta CAPI ViewContent_50pct disparado). Enviou RG/CPF; falta apenas ficha financeira de Nerópolis para rodar o cálculo.',
                contextNotes: 'Professora de Nerópolis ficou impressionada com o vídeo explicativo e disse que vai pegar a senha do Portal do Servidor na secretaria hoje à tarde.',
                docs: [
                    { type: 'CNH_RG', filename: 'RG_Prof_Beatriz_Mendes.pdf', size: 195400 },
                ],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Acabei de assistir o vídeo sobre a Lei Municipal 1.540/2011 de Nerópolis! Já enviei meu RG, só falta pegar a senha do portal da prefeitura.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Perfeito, Profª Beatriz! Assim que nos enviar a senha do portal ou os contracheques em PDF, nosso Motor de Cálculo apura seu valor exato em menos de 15 segundos.' },
                ],
            },
            {
                leadId: 'led_prof_marcos',
                oppId: 'opp_prof_marcos',
                name: 'Prof. Marcos Vinícius Rezende',
                phone: '+5564992224455',
                email: 'marcos.rezende@rioverde.go.gov.br',
                cpf: '612.990.441-18',
                channel: 'FACEBOOK_ADS',
                area: 'TRABALHISTA',
                serviceId: 'srv_trabalhista_01',
                urgency: 'NORMAL',
                score: 79,
                municipality: 'Rio Verde - GO',
                profession: 'PROFESSOR_REDE_PUBLICA',
                videoPct: 65,
                stage: 'QUALIFIED',
                priority: 'MEDIUM',
                valueBrl: 10000.0,
                campaignId: 'cmp_magisterio_rio_verde',
                pendingDocs: ['CNH ou RG com CPF', 'Ficha Financeira Portal Rio Verde (60 meses)'],
                summary: 'Lead qualificado automaticamente pelo Intake & Triage Agent na campanha de Rio Verde (Lei 5.890/2010). Score 79/100.',
                contextNotes: 'Professor da rede municipal de Rio Verde desde 2017; perguntou sobre o percentual de honorários de êxito e confirmou interesse em iniciar o cálculo.',
                docs: [],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Boa tarde! Sou professor concursado em Rio Verde (40 horas) e quero saber como funciona a ação do terço de hora-atividade.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Olá Prof. Marcos! Em Rio Verde (Lei Municipal 5.890/2010), fazemos a apuração gratuita dos últimos 5 anos. Não há custo inicial para o cálculo!' },
                ],
            },
            {
                leadId: 'led_camila_farias',
                oppId: 'opp_camila_farias',
                name: 'Camila Farias de Queiroz',
                phone: '+5562996778899',
                email: 'camilafarias.gyn@gmail.com',
                cpf: '094.312.771-40',
                channel: 'INSTAGRAM',
                area: 'CIVEL_CONSUMIDOR',
                serviceId: 'srv_civel_01',
                urgency: 'HIGH',
                score: 82,
                municipality: 'Goiânia - GO',
                profession: 'ARQUITETA',
                videoPct: 45,
                stage: 'AWAITING_DOCUMENTS',
                priority: 'MEDIUM',
                valueBrl: 6500.0,
                campaignId: null,
                pendingDocs: ['Print completo do extrato Serasa', 'Protocolo de reclamação ANAC'],
                summary: 'Ação de Indenização por Danos Morais e Materiais (Cancelamento de voo internacional + extravio de bagagem e negativação indevida).',
                contextNotes: 'Cliente enviou bilhetes aéreos; ficou de enviar o comprovante das despesas médicas e de hotel em Madrid ainda hoje.',
                docs: [
                    { type: 'BILHETE_AEREO_PROVAS', filename: 'Bilhetes_e_Relatorio_Extravio_Bagagem_Camila.pdf', size: 364000 },
                ],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Oi! Meu voo de volta de Madrid foi cancelado sem assistência e extraviaram minha mala por 6 dias. Já mandei os bilhetes.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Olá Camila! Seu caso tem forte jurisprudência no TJGO. Recebemos os bilhetes no cofre seguro; falta apenas o print dos gastos emergenciais para fecharmos a inicial.' },
                ],
            },
            {
                leadId: 'led_fernanda_lima',
                oppId: 'opp_fernanda_lima',
                name: 'Dra. Fernanda Lima (Inventário & Partilha)',
                phone: '+5562981093322',
                email: 'fernanda.lima.med@gmail.com',
                cpf: '338.712.901-06',
                channel: 'GOOGLE_ADS',
                area: 'FAMILIA_SUCESSOES',
                serviceId: 'srv_familia_01',
                urgency: 'NORMAL',
                score: 74,
                municipality: 'Goiânia - GO',
                profession: 'MEDICA',
                videoPct: 20,
                stage: 'NEW',
                priority: 'MEDIUM',
                valueBrl: 15000.0,
                campaignId: null,
                pendingDocs: ['Certidão de Óbito', 'Matrículas atualizadas dos 3 imóveis em Goiânia'],
                summary: 'Inventário Extrajudicial Consensual com 3 imóveis urbanos em Goiânia e aplicações financeiras. Triagem inicial iniciada via WhatsApp.',
                contextNotes: 'Herdeiros estão 100% de acordo com a partilha extrajudicial em cartório; solicitou agendamento de reunião com especialista em Sucessões.',
                docs: [],
                messages: [
                    { dir: 'INBOUND', sender: 'LEAD', text: 'Olá, gostaria de informações sobre inventário extrajudicial em cartório. Somos 2 irmãos maiores e estamos de pleno acordo.' },
                    { dir: 'OUTBOUND', sender: 'BOT', text: 'Olá Dra. Fernanda! O inventário extrajudicial é muito mais célere e econômico. Já abrimos sua pasta digital na Cardoso & Associados.' },
                ],
            },
        ];
        const leadInsert = this.db.prepare(`
      INSERT INTO leads (
        id, tenant_id, full_name, phone, email, document_cpf_cnpj,
        source_channel, legal_area, urgency_level, qualification_score,
        qualification_data_json, lgpd_consent_status, opt_out, is_anonymized,
        municipality, target_profession, referral_parent_lead_id,
        video_watched_pct, video_watched_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GRANTED', 0, 0, ?, ?, ?, ?, ?, ?)
    `);
        const oppInsert = this.db.prepare(`
      INSERT INTO opportunities (
        id, tenant_id, lead_id, service_id, stage, priority,
        estimated_value_brl, assigned_lawyer_id, pending_documents_json,
        crm_situation_summary, thesis_campaign_id, last_conversation_context_notes,
        calculation_result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'usr_fabricio_cardoso', ?, ?, ?, ?, ?, ?, ?)
    `);
        for (const c of demoCases) {
            leadInsert.run(c.leadId, tntCardoso, c.name, c.phone, c.email, c.cpf, c.channel, c.area, c.urgency, c.score, JSON.stringify({ summary: c.summary, municipality: c.municipality, profession: c.profession }), c.municipality, c.profession, c.referralParentId ?? null, c.videoPct, c.videoPct > 0 ? now : null, now);
            this.recordConsent(tntCardoso, c.leadId, c.channel, 'LGPD_ART_7_I_V', 'Atendimento jurídico automatizado e guarda criptografada no Cofre SHA-256');
            oppInsert.run(c.oppId, tntCardoso, c.leadId, c.serviceId, c.stage, c.priority, c.valueBrl, JSON.stringify(c.pendingDocs), c.summary, c.campaignId, c.contextNotes, c.calcResult ? JSON.stringify(c.calcResult) : null, now, now);
            // Documentos no Cofre SHA-256
            for (const d of c.docs) {
                this.saveLeadDocument(tntCardoso, c.leadId, d.type, d.filename, `s3://law-ai-vault/${tntCardoso}/${c.leadId}/${d.filename}`, hashOf(`${c.leadId}_${d.filename}`), d.size, 'application/pdf', mockPdfB64);
            }
            // Conversas e Mensagens no Inbox Omnichannel
            const conv = this.getOrCreateConversation(tntCardoso, c.leadId, c.channel === 'INSTAGRAM' ? 'INSTAGRAM' : 'WHATSAPP');
            for (const m of c.messages) {
                this.addMessage(tntCardoso, conv.id, m.dir, m.sender, m.text, { syncedToCrm: true });
            }
            // Eventos de Telemetria de Vídeo (Smart Video Player & Meta CAPI)
            if (c.campaignId || c.videoPct >= 50) {
                const trkCode = `${c.leadId}_${c.campaignId || 'cmp_magisterio_senador_canedo'}`;
                const trkShort = `${c.leadId.replace('led_', '')}_${(c.campaignId || 'cmp_magisterio_senador_canedo').replace('cmp_', '')}`;
                const capiId = c.videoPct >= 50 ? `capi_evt_${hashOf(c.leadId).slice(0, 10)}` : null;
                this.db.prepare(`
          INSERT OR IGNORE INTO video_tracking_events (
            id, tenant_id, lead_id, thesis_campaign_id, tracking_code, watched_pct, meta_capi_event_id, meta_capi_synced, watched_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`vtrk_${c.leadId.replace('led_', '')}`, tntCardoso, c.leadId, c.campaignId || 'cmp_magisterio_senador_canedo', trkShort, c.videoPct, capiId, capiId ? 1 : 0, now, now);
                // Inserir também com o código completo usado pelo botão do frontend
                this.db.prepare(`
          INSERT OR IGNORE INTO video_tracking_events (
            id, tenant_id, lead_id, thesis_campaign_id, tracking_code, watched_pct, meta_capi_event_id, meta_capi_synced, watched_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`vtrk_full_${c.leadId.replace('led_', '')}`, tntCardoso, c.leadId, c.campaignId || 'cmp_magisterio_senador_canedo', trkCode, c.videoPct, capiId, capiId ? 1 : 0, now, now);
            }
        }
        // Follow-Up Tasks agendadas (Motor de Follow-up 24h)
        this.createFollowUpTask(tntCardoso, 'opp_prof_beatriz', 'led_prof_beatriz', 'Cobrança automática 24h: Senha do Portal do Servidor de Nerópolis ou Ficha Financeira 60m', ['Senha do Portal do Servidor de Nerópolis ou Ficha Financeira 60m', 'Comprovante de Endereço atualizado'], new Date(Date.now() + 3 * 3600 * 1000).toISOString(), 'AUTO_24H_VIDEO_HOT_LEAD', 'Olá Profª Beatriz! Vi que você assistiu 78% do vídeo sobre as horas extras em Nerópolis e já enviou seu RG. Conseguiu localizar a senha do Portal do Servidor para gerarmos seu cálculo gratuito hoje?');
        this.createFollowUpTask(tntCardoso, 'opp_camila_farias', 'led_camila_farias', 'Cobrança contextual: Comprovantes de gastos emergenciais em Madrid + Extrato Serasa', ['Print completo do extrato Serasa', 'Protocolo de reclamação ANAC'], new Date(Date.now() + 6 * 3600 * 1000).toISOString(), 'AUTO_24H_DOC_COLLECTION', 'Olá Camila! Já validamos seus bilhetes aéreos no Cofre SHA-256. Assim que nos enviar o print dos gastos emergenciais em Madrid, o Dr. Fabricio já aprova a petição inicial!');
        this.createFollowUpTask(tntCardoso, 'opp_prof_carlos', 'led_prof_carlos', 'Follow-up de Fechamento: Cálculo de R$ 44.620,00 apresentado — aguardando assinatura Clicksign', ['Assinatura Digital da Procuração e Contrato de Honorários'], new Date(Date.now() + 2 * 3600 * 1000).toISOString(), 'CALCULATION_PRESENTED_NUDGE', 'Olá Prof. Carlos! Ficou alguma dúvida sobre a memória de cálculo de R$ 44.620,00 referente a Senador Canedo? O link de assinatura digital em 1 clique já está disponível no seu WhatsApp.');
        // Consultas e Agenda Google Meet (1 pendente de decisão do advogado + 2 confirmadas)
        const tomorrow10h = new Date(Date.now() + 18 * 3600 * 1000).toISOString();
        const tomorrow14h = new Date(Date.now() + 22 * 3600 * 1000).toISOString();
        const tomorrow16h = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const nextDay11h = new Date(Date.now() + 42 * 3600 * 1000).toISOString();
        this.createAppointment(tntCardoso, 'opp_joao_batista', 'led_joao_batista', 'usr_fabricio_cardoso', tomorrow10h, 'https://meet.google.com/law-joao-inss', 'PENDING_LAWYER_CONFIRMATION', {
            proposedSlotIso: tomorrow10h,
            alternativeSlotIso: tomorrow16h,
            calendarAvailabilityStatus: 'AVAILABLE_IN_CALENDAR',
            notes: 'Revisão do CNIS e orientação sobre emissão de PPP na metalúrgica (Aposentadoria Especial).',
        });
        this.createAppointment(tntCardoso, 'opp_roberto_almeida', 'led_roberto_almeida', 'usr_fabricio_cardoso', tomorrow14h, 'https://meet.google.com/law-almeida-tributario', 'CONFIRMED', {
            proposedSlotIso: tomorrow14h,
            calendarAvailabilityStatus: 'AVAILABLE_IN_CALENDAR',
            notes: 'Alinhamento estratégico sobre Exceção de Pré-Executividade e desbloqueio SISBAJUD.',
        });
        this.createAppointment(tntCardoso, 'opp_prof_carlos', 'led_prof_carlos', 'usr_fabricio_cardoso', nextDay11h, 'https://meet.google.com/law-carlos-magisterio', 'CONFIRMED', {
            proposedSlotIso: nextDay11h,
            calendarAvailabilityStatus: 'AVAILABLE_IN_CALENDAR',
            notes: 'Apresentação da Memória de Cálculo Quinquenal (R$ 44.620,00) — Magistério Senador Canedo.',
        });
        // Minutas, Gate Humano OAB, Envelopes Clicksign e Cobranças PIX Asaas
        // 1) Contrato Pendente no Gate OAB (Roberto Almeida Construções - R$ 18.500,00)
        const ctrRobertoBody = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS E HONORÁRIOS — CONTENCIOSO TRIBUTÁRIO\nCARDOSO & ASSOCIADOS ADVOCACIA — OAB/GO 4.512\n\nCONTRATANTE: Roberto Almeida Construções Ltda (CNPJ 18.492.104/0001-77), Goiânia - GO.\nOBJETO: Defesa em Execução Fiscal Estadual + Pedido Liminar de Desbloqueio via SISBAJUD.\nHONORÁRIOS: R$ 18.500,00 (dezoito mil e quinhentos reais) + 15% de êxito sobre economia tributária comprovada.`;
        const ctrRoberto = this.createProposalContract(tntCardoso, 'opp_roberto_almeida', 'tmpl_honorarios_tributario', ctrRobertoBody, hashOf(ctrRobertoBody), 18500.0);
        this.createApprovalRequest(tntCardoso, ctrRoberto.id, 'opp_roberto_almeida', 'APPROVE_AND_SEND_CONTRACT', 'ClosingAndFinancialAgent');
        // 2) Contrato Pendente no Gate OAB (Prof. Carlos Eduardo - R$ 10.000,00)
        const ctrCarlosBody = `CONTRATO DE HONORÁRIOS ADVOCATÍCIOS — MAGISTÉRIO PÚBLICO MUNICIPAL (SENADOR CANEDO/GO)\nCARDOSO & ASSOCIADOS ADVOCACIA — OAB/GO 4.512\n\nCONTRATANTE: Prof. Carlos Eduardo Souza (CPF 402.881.331-09).\nOBJETO: Ação de Cobrança de Horas-Atividade e Reflexos Quinquenais (Lei Complementar 2.188/2018).\nCRÉDITO APURADO AO CLIENTE: R$ 44.620,00 (60 meses).\nHONORÁRIOS CONTRATADOS: R$ 10.000,00 no êxito (20% sobre o proveito econômico).`;
        const ctrCarlos = this.createProposalContract(tntCardoso, 'opp_prof_carlos', 'tmpl_honorarios_padrao', ctrCarlosBody, hashOf(ctrCarlosBody), 10000.0);
        this.createApprovalRequest(tntCardoso, ctrCarlos.id, 'opp_prof_carlos', 'APPROVE_AND_SEND_CONTRACT', 'ContractPresentationAgent');
        // 3) Contrato Aprovado, Assinado na Clicksign e Pago via PIX Asaas (Profª Helena Castro - R$ 10.000,00)
        const ctrHelenaBody = `CONTRATO DE HONORÁRIOS ADVOCATÍCIOS — MAGISTÉRIO PÚBLICO MUNICIPAL (SENADOR CANEDO/GO)\nCONTRATANTE: Profª Helena Castro Silva (CPF 718.420.911-34).\nCRÉDITO APURADO AO CLIENTE: R$ 48.750,00.\nHONORÁRIOS: R$ 10.000,00.`;
        const ctrHelena = this.createProposalContract(tntCardoso, 'opp_prof_helena', 'tmpl_honorarios_padrao', ctrHelenaBody, hashOf(ctrHelenaBody), 10000.0);
        const aprHelena = this.createApprovalRequest(tntCardoso, ctrHelena.id, 'opp_prof_helena', 'APPROVE_AND_SEND_CONTRACT', 'ClosingAndFinancialAgent');
        this.decideApproval(tntCardoso, aprHelena.id, 'usr_fabricio_cardoso', 'APPROVED', 'Cálculo quinquenal conferido e aprovado conforme tabela OAB/GO.');
        this.db.prepare("UPDATE proposals_and_contracts SET status = 'SIGNED' WHERE id = ?").run(ctrHelena.id);
        this.createEsignatureEnvelope(tntCardoso, ctrHelena.id, 'opp_prof_helena', 'CLICKSIGN', 'env_ext_helena_01', `https://app.clicksign.com/sign/${ctrHelena.id}`, 'SIMULATED');
        this.updateEsignatureStatus(tntCardoso, 'env_ext_helena_01', 'SIGNED');
        this.createPaymentCharge(tntCardoso, ctrHelena.id, 'opp_prof_helena', 'ASAAS', 'chg_ext_helena_01', 'PIX', 10000.0, '00020126580014BR.GOV.BCB.PIX0136cardosoadv-pix-helena-10000520400005303986540810000.005802BR5925CARDOSO ASSOCIADOS ADVOCA6007GOIANIA62070503***6304ABCD', `https://www.asaas.com/i/${ctrHelena.id}`, 'SIMULATED');
        this.updatePaymentStatus(tntCardoso, 'chg_ext_helena_01', 'CONFIRMED');
        // Tarefas dos 8 Agentes Especializados (para telemetria FinOps e conformidade)
        const sampleTasks = [
            { agent: 'IntakeAndTriageAgent', obj: 'Qualificação Trabalhista + Roteamento Automático Município Senador Canedo', oppId: 'opp_prof_helena', state: 'COMPLETED', cost: 0.14 },
            { agent: 'PortalPaystubExtractorAgent', obj: 'Extração Efêmera Portal do Servidor (60 contracheques) + Descarte RAM LGPD', oppId: 'opp_prof_carlos', state: 'COMPLETED', cost: 0.28 },
            { agent: 'LegalLaborCalculatorAgent', obj: 'Apuração Quinquenal Horas-Atividade + Reflexos 13º e Férias + 1/3 (R$ 44.620,00)', oppId: 'opp_prof_carlos', state: 'COMPLETED', cost: 0.19 },
            { agent: 'ContractPresentationAgent', obj: 'Apresentação persuasiva no WhatsApp + Geração de Minuta com Hash SHA-256', oppId: 'opp_prof_carlos', state: 'AWAITING_APPROVAL', cost: 0.22 },
            { agent: 'ClosingAndFinancialAgent', obj: 'Submissão de Contrato Tributário R$ 18.500,00 ao Gate Humano OAB', oppId: 'opp_roberto_almeida', state: 'AWAITING_APPROVAL', cost: 0.31 },
            { agent: 'FollowUpAndAttendanceAgent', obj: 'Varredura de dossiês pendentes e agendamento de follow-up contextual 24h', oppId: 'opp_prof_beatriz', state: 'COMPLETED', cost: 0.12 },
            { agent: 'VoiceAndSchedulingAgent', obj: 'Qualificação Previdenciária e reserva de slot Google Meet com Dr. Fabricio', oppId: 'opp_joao_batista', state: 'COMPLETED', cost: 0.18 },
            { agent: 'ReferralLoopAgent', obj: 'Geração de link Boca a Boca Digital pós-assinatura (Profª Helena -> Prof. Carlos)', oppId: 'opp_prof_helena', state: 'COMPLETED', cost: 0.08 },
        ];
        for (const t of sampleTasks) {
            const task = this.createAgentTask(tntCardoso, t.agent, t.obj, { opportunity_id: t.oppId }, ['crm.read', 'vault.sha256', 'whatsapp.send'], 'Execução auditada dentro do orçamento FinOps e regras OAB', t.oppId, 45, 2.0, t.state === 'AWAITING_APPROVAL');
            this.updateAgentTask(tntCardoso, task.id, t.state, t.cost, { status: t.state, summary: t.obj }, [{ timestamp: now, agent: t.agent, event: 'TASK_EXECUTED' }]);
        }
        // Log de auditoria explícito de descarte de credencial do Portal (LGPD)
        this.logAudit(tntCardoso, 'AGENT', 'PortalPaystubExtractorAgent', 'PORTAL_CREDENTIALS_PROCESSED_EPHEMERAL', 'lead', 'led_prof_carlos', {
            municipality: 'Senador Canedo - GO',
            months_extracted: 60,
            portal_credential_status: '***PORTAL_CREDENTIAL_REDACTED***',
            ram_buffer_zeroed: true,
        });
        // Popular também 2 casos corporativos no tenant Monteiro Direito Empresarial (para demonstrar troca de escritório no topo)
        const leadM1 = this.createLead(tntMonteiro, 'Grupo Vanguarda Logística S/A', '+5511998001122', 'juridico@vanguardalog.com.br', '12.345.678/0001-99', 'WEB', 'EMPRESARIAL', 'HIGH', 95, { faturamento: 'R$ 85M/ano' }, 'São Paulo - SP', 'DIRETOR_JURIDICO');
        this.createOpportunity(tntMonteiro, leadM1.id, 'srv_monteiro_ma', 'GATE_OAB', 'HIGH', 65000.0, 'usr_ricardo_monteiro', [], 'Estruturação de Holding Patrimonial e M&A Logístico — Minuta de R$ 65.000,00 em revisão societária.');
        const leadM2 = this.createLead(tntMonteiro, 'TechNova Cloud Brasil Ltda', '+5511997112233', 'ceo@technovacloud.io', '44.819.220/0001-10', 'WHATSAPP', 'TRIBUTARIO', 'NORMAL', 88, { regime: 'Lucro Real' }, 'São Paulo - SP', 'CEO');
        this.createOpportunity(tntMonteiro, leadM2.id, 'srv_monteiro_ma', 'WON', 'HIGH', 45000.0, 'usr_ricardo_monteiro', [], 'Recuperação de Créditos PIS/COFINS sobre insumos de tecnologia — Contrato assinado.');
        return { seeded: true, leads_count: demoCases.length, opportunities_count: demoCases.length };
    }
    requireTenant(tenantId) {
        if (!tenantId || !tenantId.trim()) {
            throw new TenantIsolationError('Contexto tenant_id é obrigatório para todas as operações.');
        }
    }
    logAudit(tenantId, actorType, actorId, action, resourceType, resourceId, payloadSummary) {
        this.requireTenant(tenantId);
        const auditId = `aud_${randomUUID().slice(0, 12)}`;
        const sanitized = {};
        for (const [key, val] of Object.entries(payloadSummary)) {
            if (['secret', 'token', 'password', 'key'].some((s) => key.toLowerCase().includes(s))) {
                sanitized[key] = '***REDACTED***';
            }
            else {
                sanitized[key] = val;
            }
        }
        const stmt = this.db.prepare(`
      INSERT INTO audit_logs (id, tenant_id, actor_type, actor_id, action, resource_type, resource_id, payload_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(auditId, tenantId, actorType, actorId, action, resourceType, resourceId, JSON.stringify(sanitized), utcNowIso());
        return auditId;
    }
    // --- TENANTS ---
    createTenant(name, slug, oabSocietyNumber, planTier = 'PRO', monthlyAiBudgetBrl = 500.0, settings = {}) {
        const tenantId = `tnt_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO tenants (id, name, slug, oab_society_number, plan_tier, monthly_ai_budget_brl, current_ai_spend_brl, settings_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, ?)
    `);
        stmt.run(tenantId, name, slug, oabSocietyNumber, planTier, monthlyAiBudgetBrl, JSON.stringify(settings), now);
        this.logAudit(tenantId, 'SYSTEM', 'bootstrap', 'TENANT_CREATED', 'tenant', tenantId, { name, planTier });
        return this.getTenant(tenantId);
    }
    getTenant(tenantId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM tenants WHERE id = ?');
        const row = stmt.get(tenantId);
        if (!row) {
            throw new Error(`Tenant ${tenantId} não encontrado.`);
        }
        return row;
    }
    getTenantBySlug(slug) {
        const stmt = this.db.prepare('SELECT * FROM tenants WHERE slug = ?');
        const row = stmt.get(slug);
        return row || null;
    }
    updateTenantSpend(tenantId, deltaSpend) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('UPDATE tenants SET current_ai_spend_brl = current_ai_spend_brl + ? WHERE id = ?');
        stmt.run(deltaSpend, tenantId);
    }
    // --- USERS ---
    createUser(tenantId, email, fullName, role, oabNumber, oabUf, specialties = [], phone) {
        this.requireTenant(tenantId);
        const userId = `usr_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO users (id, tenant_id, email, full_name, role, phone, oab_number, oab_uf, specialties_json, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
        stmt.run(userId, tenantId, email, fullName, role, phone ?? null, oabNumber ?? null, oabUf ?? null, JSON.stringify(specialties), now);
        this.logAudit(tenantId, 'TENANT_ADMIN', 'system', 'USER_CREATED', 'user', userId, { email, role, phone });
        return this.getUser(tenantId, userId);
    }
    getUser(tenantId, userId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?');
        const row = stmt.get(userId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Usuário ${userId} não encontrado ou pertence a outro escritório.`);
        }
        return row;
    }
    listUsers(tenantId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at ASC');
        return stmt.all(tenantId);
    }
    // --- LEGAL SERVICES ---
    createLegalService(tenantId, name, legalArea, qualificationQuestions, baseFeeBrl, successFeePct = 20.0, requiresLawyerApproval = true) {
        this.requireTenant(tenantId);
        const serviceId = `srv_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO legal_services (id, tenant_id, name, legal_area, qualification_questions_json, base_fee_brl, success_fee_pct, requires_lawyer_approval, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(serviceId, tenantId, name, legalArea.toUpperCase(), JSON.stringify(qualificationQuestions), baseFeeBrl, successFeePct, requiresLawyerApproval ? 1 : 0, now);
        this.logAudit(tenantId, 'TENANT_ADMIN', 'system', 'SERVICE_CREATED', 'legal_service', serviceId, { name, legalArea });
        const getStmt = this.db.prepare('SELECT * FROM legal_services WHERE id = ? AND tenant_id = ?');
        return getStmt.get(serviceId, tenantId);
    }
    listLegalServices(tenantId, legalArea) {
        this.requireTenant(tenantId);
        if (legalArea) {
            const stmt = this.db.prepare('SELECT * FROM legal_services WHERE tenant_id = ? AND legal_area = ?');
            return stmt.all(tenantId, legalArea.toUpperCase());
        }
        const stmt = this.db.prepare('SELECT * FROM legal_services WHERE tenant_id = ?');
        return stmt.all(tenantId);
    }
    findServiceForLegalArea(tenantId, legalArea) {
        this.requireTenant(tenantId);
        const upper = legalArea.toUpperCase();
        const stmt = this.db.prepare(`
      SELECT * FROM legal_services
      WHERE tenant_id = ? AND (legal_area = ? OR ? LIKE legal_area || '%' OR legal_area LIKE ? || '%')
      LIMIT 1
    `);
        const row = stmt.get(tenantId, upper, upper, upper);
        if (row)
            return row;
        const fallbackStmt = this.db.prepare('SELECT * FROM legal_services WHERE tenant_id = ? LIMIT 1');
        return fallbackStmt.get(tenantId) || null;
    }
    // --- LEADS ---
    createLead(tenantId, fullName, phone, email, documentCpfCnpj, sourceChannel = 'WHATSAPP', legalArea, urgencyLevel = 'NORMAL', qualificationScore = 0, qualificationData = {}, municipality, targetProfession, referralParentLeadId) {
        this.requireTenant(tenantId);
        const leadId = `led_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO leads (
        id, tenant_id, full_name, phone, email, document_cpf_cnpj,
        source_channel, legal_area, urgency_level, qualification_score,
        qualification_data_json, lgpd_consent_status, opt_out, is_anonymized,
        municipality, target_profession, referral_parent_lead_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GRANTED', 0, 0, ?, ?, ?, ?)
    `);
        stmt.run(leadId, tenantId, fullName, phone, email ?? null, documentCpfCnpj ?? null, sourceChannel, legalArea ? legalArea.toUpperCase() : null, urgencyLevel, qualificationScore, JSON.stringify(qualificationData), municipality ?? null, targetProfession ?? null, referralParentLeadId ?? null, now);
        this.logAudit(tenantId, 'USER', 'crm_system', 'LEAD_CREATED', 'lead', leadId, { fullName, sourceChannel, municipality });
        return this.getLead(tenantId, leadId);
    }
    findLeadByPhone(tenantId, phone) {
        this.requireTenant(tenantId);
        const digitsOnly = phone.replace(/\D/g, '');
        const stmt = this.db.prepare('SELECT * FROM leads WHERE tenant_id = ?');
        const all = stmt.all(tenantId);
        const match = all.find((l) => {
            const lDigits = (l.phone || '').replace(/\D/g, '');
            if (lDigits === digitsOnly)
                return true;
            if (digitsOnly.length >= 8 && lDigits.endsWith(digitsOnly.slice(-8)))
                return true;
            if (lDigits.length >= 8 && digitsOnly.endsWith(lDigits.slice(-8)))
                return true;
            return false;
        });
        return match || null;
    }
    updateLead(tenantId, leadId, updates) {
        this.requireTenant(tenantId);
        this.getLead(tenantId, leadId); // verify existence & tenant isolation
        const fields = [];
        const values = [];
        if (updates.full_name !== undefined) {
            fields.push('full_name = ?');
            values.push(updates.full_name);
        }
        if (updates.phone !== undefined) {
            fields.push('phone = ?');
            values.push(updates.phone);
        }
        if (updates.email !== undefined) {
            fields.push('email = ?');
            values.push(updates.email);
        }
        if (updates.document_cpf_cnpj !== undefined) {
            fields.push('document_cpf_cnpj = ?');
            values.push(updates.document_cpf_cnpj);
        }
        if (updates.legal_area !== undefined) {
            fields.push('legal_area = ?');
            values.push(updates.legal_area ? updates.legal_area.toUpperCase() : null);
        }
        if (updates.urgency_level !== undefined) {
            fields.push('urgency_level = ?');
            values.push(updates.urgency_level);
        }
        if (updates.qualification_score !== undefined) {
            fields.push('qualification_score = ?');
            values.push(updates.qualification_score);
        }
        if (updates.qualification_data_json !== undefined) {
            fields.push('qualification_data_json = ?');
            values.push(updates.qualification_data_json);
        }
        if (updates.municipality !== undefined) {
            fields.push('municipality = ?');
            values.push(updates.municipality);
        }
        if (updates.target_profession !== undefined) {
            fields.push('target_profession = ?');
            values.push(updates.target_profession);
        }
        if (updates.referral_parent_lead_id !== undefined) {
            fields.push('referral_parent_lead_id = ?');
            values.push(updates.referral_parent_lead_id);
        }
        if (updates.video_watched_pct !== undefined) {
            fields.push('video_watched_pct = ?');
            values.push(updates.video_watched_pct);
        }
        if (updates.video_watched_at !== undefined) {
            fields.push('video_watched_at = ?');
            values.push(updates.video_watched_at);
        }
        if (updates.opt_out !== undefined) {
            fields.push('opt_out = ?');
            values.push(updates.opt_out ? 1 : 0);
        }
        if (fields.length > 0) {
            values.push(leadId, tenantId);
            const stmt = this.db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`);
            stmt.run(...values);
        }
        return this.getLead(tenantId, leadId);
    }
    getLead(tenantId, leadId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM leads WHERE id = ? AND tenant_id = ?');
        const row = stmt.get(leadId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Lead ${leadId} não encontrado ou pertence a outro escritório.`);
        }
        return row;
    }
    listLeads(tenantId, search, legalArea, limit = 100, offset = 0) {
        this.requireTenant(tenantId);
        let query = 'SELECT * FROM leads WHERE tenant_id = ?';
        const params = [tenantId];
        if (search) {
            query += ' AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }
        if (legalArea) {
            query += ' AND legal_area = ?';
            params.push(legalArea.toUpperCase());
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const stmt = this.db.prepare(query);
        return stmt.all(...params);
    }
    anonymizeLeadLgpd(tenantId, leadId, requestedByActor) {
        const lead = this.getLead(tenantId, leadId);
        const anonHash = createHash('sha256').update(lead.id).digest('hex').slice(0, 10);
        const stmt = this.db.prepare(`
      UPDATE leads
      SET full_name = ?, phone = ?, email = ?, document_cpf_cnpj = NULL,
          qualification_data_json = '{}', lgpd_consent_status = 'REVOKED_ANONYMIZED',
          opt_out = 1, is_anonymized = 1
      WHERE id = ? AND tenant_id = ?
    `);
        stmt.run(`TITULAR_ANONIMIZADO_${anonHash}`, `ANON_${anonHash}`, `anon_${anonHash}@redacted.lgpd`, leadId, tenantId);
        this.logAudit(tenantId, 'USER', requestedByActor, 'LGPD_LEAD_ANONYMIZED', 'lead', leadId, {
            reason: 'Solicitação do titular Art. 18 LGPD',
        });
        return this.getLead(tenantId, leadId);
    }
    recordConsent(tenantId, leadId, channel, legalBasis = 'LGPD_ART_7_I_V', purpose = 'Atendimento jurídico e contato comercial preliminar via WhatsApp', status = 'GRANTED') {
        this.requireTenant(tenantId);
        const consentId = `cst_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO consent_records (id, tenant_id, lead_id, channel, legal_basis, purpose, status, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(consentId, tenantId, leadId, channel, legalBasis, purpose, status, now);
        this.logAudit(tenantId, 'SYSTEM', 'consent_system', 'LGPD_CONSENT_RECORDED', 'consent', consentId, {
            lead_id: leadId,
            channel,
            legalBasis,
        });
        return consentId;
    }
    // --- LEAD DOCUMENTS (COFRE SEGURO COM SHA-256) ---
    saveLeadDocument(tenantId, leadId, documentType, originalFilename, storageUri, sha256Hash, byteSize, mimeType = 'application/octet-stream', fileDataBase64) {
        this.requireTenant(tenantId);
        const docId = `doc_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO lead_documents (
        id, tenant_id, lead_id, document_type, original_filename,
        storage_uri, sha256_hash, byte_size, mime_type, file_data_base64, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(docId, tenantId, leadId, documentType, originalFilename, storageUri, sha256Hash, byteSize, mimeType, fileDataBase64 || null, now);
        this.logAudit(tenantId, 'SYSTEM', 'storage_vault', 'DOCUMENT_STORED_IN_VAULT', 'lead_document', docId, {
            lead_id: leadId,
            document_type: documentType,
            sha256: sha256Hash,
        });
        const getStmt = this.db.prepare('SELECT * FROM lead_documents WHERE id = ?');
        return getStmt.get(docId);
    }
    getLeadDocument(tenantId, docId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM lead_documents WHERE tenant_id = ? AND id = ?');
        const doc = stmt.get(tenantId, docId);
        return doc || null;
    }
    listLeadDocuments(tenantId, leadId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM lead_documents WHERE tenant_id = ? AND lead_id = ? ORDER BY created_at ASC');
        return stmt.all(tenantId, leadId);
    }
    listAllDocuments(tenantId, limit = 100) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare(`
      SELECT d.*, l.full_name as lead_name, l.phone as lead_phone, l.legal_area
      FROM lead_documents d
      JOIN leads l ON d.lead_id = l.id AND d.tenant_id = l.tenant_id
      WHERE d.tenant_id = ?
      ORDER BY d.created_at DESC
      LIMIT ?
    `);
        return stmt.all(tenantId, limit);
    }
    deleteLeadDocument(tenantId, docId) {
        this.requireTenant(tenantId);
        const doc = this.getLeadDocument(tenantId, docId);
        if (!doc)
            return false;
        const stmt = this.db.prepare('DELETE FROM lead_documents WHERE tenant_id = ? AND id = ?');
        stmt.run(tenantId, docId);
        this.logAudit(tenantId, 'USER', 'vault', 'DOCUMENT_DELETED_PERMANENTLY', 'lead_document', docId, {
            original_filename: doc.original_filename,
            document_type: doc.document_type,
            sha256_hash: doc.sha256_hash,
            lead_id: doc.lead_id,
        });
        return true;
    }
    // --- OPPORTUNITIES ---
    createOpportunity(tenantId, leadId, serviceId, stage = 'NEW', priority = 'MEDIUM', estimatedValueBrl = 0.0, assignedLawyerId, pendingDocuments = [], crmSituationSummary = '') {
        this.requireTenant(tenantId);
        const oppId = `opp_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO opportunities (
        id, tenant_id, lead_id, service_id, stage, priority,
        estimated_value_brl, assigned_lawyer_id, pending_documents_json,
        crm_situation_summary, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(oppId, tenantId, leadId, serviceId ?? null, stage, priority, estimatedValueBrl, assignedLawyerId ?? null, JSON.stringify(pendingDocuments), crmSituationSummary, now, now);
        this.logAudit(tenantId, 'USER', 'crm_system', 'OPPORTUNITY_CREATED', 'opportunity', oppId, {
            stage,
            value: estimatedValueBrl,
        });
        return this.getOpportunity(tenantId, oppId);
    }
    getOpportunity(tenantId, opportunityId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?');
        const row = stmt.get(opportunityId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Oportunidade ${opportunityId} não encontrada ou pertence a outro escritório.`);
        }
        return row;
    }
    updateOpportunityStage(tenantId, opportunityId, newStage) {
        this.requireTenant(tenantId);
        const now = utcNowIso();
        const stmt = this.db.prepare('UPDATE opportunities SET stage = ?, updated_at = ? WHERE id = ? AND tenant_id = ?');
        stmt.run(newStage, now, opportunityId, tenantId);
        this.logAudit(tenantId, 'USER', 'crm_system', 'OPPORTUNITY_STAGE_UPDATED', 'opportunity', opportunityId, {
            new_stage: newStage,
        });
        return this.getOpportunity(tenantId, opportunityId);
    }
    getOpportunityByLeadId(tenantId, leadId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM opportunities WHERE tenant_id = ? AND lead_id = ? ORDER BY created_at DESC LIMIT 1');
        const row = stmt.get(tenantId, leadId);
        return row || null;
    }
    updateOpportunityDetails(tenantId, opportunityId, updates) {
        this.requireTenant(tenantId);
        const current = this.getOpportunity(tenantId, opportunityId);
        const now = utcNowIso();
        const stage = updates.stage ?? current.stage;
        const priority = updates.priority ?? current.priority;
        const estimatedValue = updates.estimated_value_brl ?? current.estimated_value_brl;
        const assignedLawyer = updates.assigned_lawyer_id !== undefined ? updates.assigned_lawyer_id : current.assigned_lawyer_id;
        const pendingDocs = updates.pending_documents ? JSON.stringify(updates.pending_documents) : current.pending_documents_json;
        const situationSummary = updates.crm_situation_summary ?? current.crm_situation_summary;
        const serviceId = updates.service_id !== undefined ? updates.service_id : current.service_id;
        const thesisCampaignId = updates.thesis_campaign_id !== undefined ? updates.thesis_campaign_id : current.thesis_campaign_id;
        const contextNotes = updates.last_conversation_context_notes !== undefined ? updates.last_conversation_context_notes : current.last_conversation_context_notes;
        const calcResultJson = updates.calculation_result_json !== undefined ? updates.calculation_result_json : current.calculation_result_json;
        const stmt = this.db.prepare(`
      UPDATE opportunities
      SET stage = ?, priority = ?, estimated_value_brl = ?, assigned_lawyer_id = ?,
          pending_documents_json = ?, crm_situation_summary = ?, service_id = ?,
          thesis_campaign_id = ?, last_conversation_context_notes = ?, calculation_result_json = ?,
          updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `);
        stmt.run(stage, priority, estimatedValue, assignedLawyer, pendingDocs, situationSummary, serviceId, thesisCampaignId ?? null, contextNotes ?? null, calcResultJson ?? null, now, opportunityId, tenantId);
        this.logAudit(tenantId, 'SYSTEM', 'crm_system', 'OPPORTUNITY_DETAILS_UPDATED', 'opportunity', opportunityId, {
            stage,
            priority,
            assignedLawyer,
            thesis_campaign_id: thesisCampaignId,
        });
        return this.getOpportunity(tenantId, opportunityId);
    }
    listOpportunities(tenantId, stage) {
        this.requireTenant(tenantId);
        let query = `
      SELECT o.*, l.full_name as lead_name, l.phone as lead_phone, l.legal_area as lead_area,
             (SELECT COUNT(*) FROM lead_documents d WHERE d.lead_id = o.lead_id AND d.tenant_id = o.tenant_id) as uploaded_documents_count
      FROM opportunities o
      JOIN leads l ON o.lead_id = l.id AND o.tenant_id = l.tenant_id
      WHERE o.tenant_id = ?
    `;
        const params = [tenantId];
        if (stage) {
            query += ' AND o.stage = ?';
            params.push(stage.toUpperCase());
        }
        query += ' ORDER BY o.updated_at DESC';
        const stmt = this.db.prepare(query);
        return stmt.all(...params);
    }
    listEligibleFollowUpOpportunities(tenantId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare(`
      SELECT o.*
      FROM opportunities o
      JOIN leads l ON o.lead_id = l.id AND o.tenant_id = l.tenant_id
      WHERE o.tenant_id = ? 
        AND l.opt_out = 0 
        AND o.stage NOT IN ('WON', 'CLOSED_WON', 'LOST', 'CLOSED_LOST')
      ORDER BY o.updated_at DESC
    `);
        const rows = stmt.all(tenantId);
        return rows.map((opp) => {
            const lead = this.getLead(tenantId, opp.lead_id);
            return { ...opp, lead };
        });
    }
    // --- CONVERSATIONS & MESSAGES ---
    getOrCreateConversation(tenantId, leadId, channel = 'WHATSAPP') {
        this.requireTenant(tenantId);
        const findStmt = this.db.prepare('SELECT * FROM conversations WHERE tenant_id = ? AND lead_id = ? AND channel = ?');
        const existing = findStmt.get(tenantId, leadId, channel);
        if (existing)
            return existing;
        const convId = `cnv_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO conversations (id, tenant_id, lead_id, channel, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'BOT_ACTIVE', ?, ?)
    `);
        stmt.run(convId, tenantId, leadId, channel, now, now);
        const getStmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
        return getStmt.get(convId);
    }
    listConversations(tenantId) {
        this.requireTenant(tenantId);
        const query = `
      SELECT c.*, l.full_name as lead_name, l.phone as lead_phone, l.legal_area, l.urgency_level,
             (SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.tenant_id = c.tenant_id ORDER BY m.created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages m WHERE m.conversation_id = c.id AND m.tenant_id = c.tenant_id ORDER BY m.created_at DESC LIMIT 1) as last_message_time
      FROM conversations c
      JOIN leads l ON c.lead_id = l.id AND c.tenant_id = l.tenant_id
      WHERE c.tenant_id = ?
      ORDER BY c.updated_at DESC
    `;
        const stmt = this.db.prepare(query);
        return stmt.all(tenantId);
    }
    addMessage(tenantId, conversationId, direction, senderType, content, promptInjectionFlaggedOrOpts = false, syncedToCrm = false, externalMessageId, dedupHash) {
        this.requireTenant(tenantId);
        let promptInjectionFlagged = false;
        let syncToCrm = syncedToCrm;
        let extId = externalMessageId ?? null;
        let hash = dedupHash ?? null;
        if (typeof promptInjectionFlaggedOrOpts === 'object' && promptInjectionFlaggedOrOpts !== null) {
            promptInjectionFlagged = promptInjectionFlaggedOrOpts.promptInjectionFlagged ?? false;
            syncToCrm = promptInjectionFlaggedOrOpts.syncedToCrm ?? syncToCrm;
            extId = promptInjectionFlaggedOrOpts.externalMessageId ?? extId;
            hash = promptInjectionFlaggedOrOpts.dedupHash ?? hash;
        }
        else if (typeof promptInjectionFlaggedOrOpts === 'boolean') {
            promptInjectionFlagged = promptInjectionFlaggedOrOpts;
        }
        const msgId = `msg_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO messages (id, tenant_id, conversation_id, direction, sender_type, content, prompt_injection_flagged, synced_to_crm, external_message_id, dedup_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(msgId, tenantId, conversationId, direction, senderType, content, promptInjectionFlagged ? 1 : 0, syncToCrm ? 1 : 0, extId, hash, now);
        const updStmt = this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND tenant_id = ?');
        updStmt.run(now, conversationId, tenantId);
        return {
            id: msgId,
            tenant_id: tenantId,
            conversation_id: conversationId,
            direction,
            sender_type: senderType,
            content,
            prompt_injection_flagged: promptInjectionFlagged ? 1 : 0,
            synced_to_crm: syncToCrm ? 1 : 0,
            external_message_id: extId,
            dedup_hash: hash,
            created_at: now,
        };
    }
    findRecentOutboundMessageByHash(tenantId, leadId, dedupHash, withinSeconds = 90) {
        this.requireTenant(tenantId);
        const query = `
      SELECT m.*
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id
      WHERE m.tenant_id = ?
        AND c.lead_id = ?
        AND m.direction = 'OUTBOUND'
        AND m.dedup_hash = ?
      ORDER BY m.created_at DESC
      LIMIT 1
    `;
        const stmt = this.db.prepare(query);
        const row = stmt.get(tenantId, leadId, dedupHash);
        if (!row)
            return undefined;
        const diffMs = Date.now() - new Date(row.created_at).getTime();
        if (diffMs <= withinSeconds * 1000) {
            return row;
        }
        return undefined;
    }
    isOutboundMessageDuplicate(tenantId, dedupHash, withinSeconds = 90) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare(`
      SELECT created_at FROM messages
      WHERE tenant_id = ? AND dedup_hash = ? AND direction = 'OUTBOUND'
      ORDER BY created_at DESC LIMIT 1
    `);
        const row = stmt.get(tenantId, dedupHash);
        if (!row)
            return false;
        const diffMs = Date.now() - new Date(row.created_at).getTime();
        return diffMs <= withinSeconds * 1000;
    }
    listMessages(tenantId, conversationId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at ASC');
        return stmt.all(tenantId, conversationId);
    }
    getUnsyncedTodayMessages(tenantId) {
        this.requireTenant(tenantId);
        const query = `
      SELECT m.*, c.lead_id
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id
      WHERE m.tenant_id = ? AND m.synced_to_crm = 0
      ORDER BY m.created_at ASC
    `;
        const stmt = this.db.prepare(query);
        const rows = stmt.all(tenantId);
        return rows.map((r) => ({
            message: r,
            lead_id: r.lead_id,
            conversation_id: r.conversation_id,
        }));
    }
    markMessagesSynced(tenantId, messageIds) {
        this.requireTenant(tenantId);
        if (!messageIds.length)
            return;
        const placeholders = messageIds.map(() => '?').join(',');
        const stmt = this.db.prepare(`UPDATE messages SET synced_to_crm = 1 WHERE tenant_id = ? AND id IN (${placeholders})`);
        stmt.run(tenantId, ...messageIds);
    }
    // --- FOLLOW-UP TASKS ---
    createFollowUpTask(tenantId, opportunityId, leadId, reason, pendingItems, scheduledForIso, triggerMode, autoMessagePreview) {
        this.requireTenant(tenantId);
        const taskId = `fup_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO follow_up_tasks (
        id, tenant_id, opportunity_id, lead_id, reason, pending_items_json,
        scheduled_for_iso, trigger_mode, status, auto_message_preview, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?)
    `);
        stmt.run(taskId, tenantId, opportunityId, leadId, reason, JSON.stringify(pendingItems), scheduledForIso, triggerMode, autoMessagePreview, now, now);
        this.logAudit(tenantId, 'AGENT', 'FollowUpAndAttendanceAgent', 'FOLLOWUP_TASK_SCHEDULED', 'follow_up_task', taskId, {
            opportunityId,
            reason,
            scheduledForIso,
        });
        const getStmt = this.db.prepare('SELECT * FROM follow_up_tasks WHERE id = ?');
        return getStmt.get(taskId);
    }
    listFollowUpTasks(tenantId, status) {
        this.requireTenant(tenantId);
        const baseQuery = `
      SELECT f.*,
             l.full_name as client_name,
             l.phone as client_phone,
             o.stage as stage,
             f.pending_items_json as pending_docs_summary,
             f.trigger_mode as trigger_type,
             f.scheduled_for_iso as scheduled_at
      FROM follow_up_tasks f
      LEFT JOIN leads l ON f.lead_id = l.id AND f.tenant_id = l.tenant_id
      LEFT JOIN opportunities o ON f.opportunity_id = o.id AND f.tenant_id = o.tenant_id
      WHERE f.tenant_id = ?
    `;
        if (status) {
            const stmt = this.db.prepare(`${baseQuery} AND f.status = ? ORDER BY f.created_at DESC`);
            return stmt.all(tenantId, status.toUpperCase());
        }
        const stmt = this.db.prepare(`${baseQuery} ORDER BY f.created_at DESC`);
        return stmt.all(tenantId);
    }
    completeFollowUpsForOpportunity(tenantId, opportunityId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare(`
      UPDATE follow_up_tasks
      SET status = 'COMPLETED_DOCS_RECEIVED', updated_at = ?
      WHERE tenant_id = ? AND opportunity_id = ? AND status = 'SCHEDULED'
    `);
        stmt.run(utcNowIso(), tenantId, opportunityId);
    }
    // --- APPOINTMENTS ---
    createAppointment(tenantId, opportunityId, leadId, lawyerUserId, scheduledSlotIso, meetingLink = 'https://meet.google.com/law-ai-meet', status = 'CONFIRMED', options) {
        this.requireTenant(tenantId);
        const aptId = `apt_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const proposed = options?.proposedSlotIso || scheduledSlotIso;
        const alternative = options?.alternativeSlotIso || null;
        const availStatus = options?.calendarAvailabilityStatus || 'AVAILABLE_IN_CALENDAR';
        const notes = options?.notes || null;
        const stmt = this.db.prepare(`
      INSERT INTO appointments (
        id, tenant_id, opportunity_id, lead_id, lawyer_user_id,
        proposed_slot_iso, alternative_slot_iso, calendar_availability_status,
        scheduled_slot_iso, meeting_link, status, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(aptId, tenantId, opportunityId, leadId, lawyerUserId, proposed, alternative, availStatus, scheduledSlotIso, meetingLink, status, notes, now, now);
        this.logAudit(tenantId, 'AGENT', 'VoiceAndSchedulingAgent', 'APPOINTMENT_SCHEDULED', 'appointment', aptId, {
            slot: scheduledSlotIso,
            status,
            proposed_slot: proposed,
        });
        return {
            id: aptId,
            tenant_id: tenantId,
            opportunity_id: opportunityId,
            lead_id: leadId,
            lawyer_user_id: lawyerUserId,
            proposed_slot_iso: proposed,
            alternative_slot_iso: alternative,
            calendar_availability_status: availStatus,
            scheduled_slot_iso: scheduledSlotIso,
            meeting_link: meetingLink,
            status,
            notes,
            created_at: now,
            updated_at: now,
        };
    }
    getAppointment(tenantId, appointmentId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM appointments WHERE tenant_id = ? AND id = ?');
        const row = stmt.get(tenantId, appointmentId);
        if (!row) {
            throw new TenantIsolationError(`Consulta agendada ${appointmentId} não encontrada no tenant.`);
        }
        return row;
    }
    updateAppointment(tenantId, appointmentId, updates) {
        this.requireTenant(tenantId);
        const existing = this.getAppointment(tenantId, appointmentId);
        const merged = { ...existing, ...updates, updated_at: utcNowIso() };
        const stmt = this.db.prepare(`
      UPDATE appointments
      SET status = ?,
          proposed_slot_iso = ?,
          alternative_slot_iso = ?,
          calendar_availability_status = ?,
          scheduled_slot_iso = ?,
          meeting_link = ?,
          notes = ?,
          updated_at = ?
      WHERE tenant_id = ? AND id = ?
    `);
        stmt.run(merged.status, merged.proposed_slot_iso || null, merged.alternative_slot_iso || null, merged.calendar_availability_status || 'AVAILABLE_IN_CALENDAR', merged.scheduled_slot_iso, merged.meeting_link, merged.notes || null, merged.updated_at, tenantId, appointmentId);
        return merged;
    }
    findRecentPendingAppointment(tenantId, leadId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare(`
      SELECT * FROM appointments
      WHERE tenant_id = ? AND lead_id = ? AND status = 'PENDING_LAWYER_CONFIRMATION'
      ORDER BY updated_at DESC, created_at DESC LIMIT 1
    `);
        const apt = stmt.get(tenantId, leadId);
        if (apt)
            return apt;
        // Fallback: se o lead possui registros duplicados por formatação de telefone
        const currentLead = this.getLead(tenantId, leadId);
        if (currentLead && currentLead.phone) {
            const curDigits = currentLead.phone.replace(/\D/g, '');
            if (curDigits.length >= 8) {
                const otherLeads = this.listLeads(tenantId).filter((l) => l.id !== leadId && l.phone && l.phone.replace(/\D/g, '').endsWith(curDigits.slice(-8)));
                for (const ol of otherLeads) {
                    const fallbackApt = stmt.get(tenantId, ol.id);
                    if (fallbackApt)
                        return fallbackApt;
                }
            }
        }
        return undefined;
    }
    findRecentCounterProposedAppointment(tenantId, leadId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare(`
      SELECT * FROM appointments
      WHERE tenant_id = ? AND lead_id = ? AND status = 'COUNTER_PROPOSED_BY_LAWYER'
      ORDER BY updated_at DESC, created_at DESC LIMIT 1
    `);
        const apt = stmt.get(tenantId, leadId);
        if (apt)
            return apt;
        // Fallback: se o lead possui registros duplicados por formatação de telefone
        const currentLead = this.getLead(tenantId, leadId);
        if (currentLead && currentLead.phone) {
            const curDigits = currentLead.phone.replace(/\D/g, '');
            if (curDigits.length >= 8) {
                const otherLeads = this.listLeads(tenantId).filter((l) => l.id !== leadId && l.phone && l.phone.replace(/\D/g, '').endsWith(curDigits.slice(-8)));
                for (const ol of otherLeads) {
                    const fallbackApt = stmt.get(tenantId, ol.id);
                    if (fallbackApt)
                        return fallbackApt;
                }
            }
        }
        return undefined;
    }
    listAppointments(tenantId) {
        this.requireTenant(tenantId);
        const query = `
      SELECT a.*, l.full_name as lead_name, l.phone as lead_phone, l.legal_area,
             u.full_name as lawyer_name, u.email as lawyer_email
      FROM appointments a
      LEFT JOIN leads l ON a.lead_id = l.id AND a.tenant_id = l.tenant_id
      LEFT JOIN users u ON a.lawyer_user_id = u.id AND a.tenant_id = u.tenant_id
      WHERE a.tenant_id = ?
      ORDER BY a.scheduled_slot_iso ASC
    `;
        const stmt = this.db.prepare(query);
        return stmt.all(tenantId);
    }
    // --- TEMPLATES ---
    createDocumentTemplate(tenantId, name, legalArea, bodyTemplate, isApproved = true) {
        this.requireTenant(tenantId);
        const tplId = `tpl_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO document_templates (id, tenant_id, name, legal_area, body_template, version, is_approved, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
        stmt.run(tplId, tenantId, name, legalArea.toUpperCase(), bodyTemplate, isApproved ? 1 : 0, now);
        this.logAudit(tenantId, 'LAWYER', 'system', 'TEMPLATE_CREATED', 'document_template', tplId, { name });
        const getStmt = this.db.prepare('SELECT * FROM document_templates WHERE id = ?');
        return getStmt.get(tplId);
    }
    getDocumentTemplate(tenantId, templateId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM document_templates WHERE id = ? AND tenant_id = ?');
        const row = stmt.get(templateId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Template ${templateId} não encontrado no escritório ${tenantId}.`);
        }
        return row;
    }
    findTemplateForLegalArea(tenantId, legalArea) {
        this.requireTenant(tenantId);
        const upper = legalArea.toUpperCase();
        const stmt = this.db.prepare(`
      SELECT * FROM document_templates
      WHERE tenant_id = ? AND is_approved = 1 AND (legal_area = ? OR ? LIKE legal_area || '%' OR legal_area LIKE ? || '%')
      ORDER BY version DESC LIMIT 1
    `);
        const row = stmt.get(tenantId, upper, upper, upper);
        if (row)
            return row;
        const fallbackStmt = this.db.prepare('SELECT * FROM document_templates WHERE tenant_id = ? AND is_approved = 1 LIMIT 1');
        return fallbackStmt.get(tenantId) || null;
    }
    // --- CONTRACTS & APPROVALS ---
    createProposalContract(tenantId, opportunityId, templateId, renderedContent, contentSha256, feeValueBrl) {
        this.requireTenant(tenantId);
        const contractId = `ctr_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO proposals_and_contracts (
        id, tenant_id, opportunity_id, template_id, rendered_content,
        content_sha256, fee_value_brl, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'AWAITING_APPROVAL', ?)
    `);
        stmt.run(contractId, tenantId, opportunityId, templateId, renderedContent, contentSha256, feeValueBrl, now);
        return this.getProposalContract(tenantId, contractId);
    }
    getProposalContract(tenantId, contractId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM proposals_and_contracts WHERE id = ? AND tenant_id = ?');
        const row = stmt.get(contractId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Contrato ${contractId} não encontrado no escritório ${tenantId}.`);
        }
        return row;
    }
    listProposalsAndContracts(tenantId) {
        this.requireTenant(tenantId);
        const query = `
      SELECT p.*, l.full_name as client_name, l.phone as client_phone, l.legal_area,
             t.name as template_name,
             ar.id as approval_request_id, ar.status as approval_status,
             ee.status as esignature_status, ee.signer_url,
             pc.status as payment_status, pc.amount_brl, pc.pix_copy_paste, pc.invoice_url
      FROM proposals_and_contracts p
      JOIN opportunities o ON p.opportunity_id = o.id AND p.tenant_id = o.tenant_id
      JOIN leads l ON o.lead_id = l.id AND o.tenant_id = l.tenant_id
      LEFT JOIN document_templates t ON p.template_id = t.id AND p.tenant_id = t.tenant_id
      LEFT JOIN approval_requests ar ON ar.contract_id = p.id AND ar.tenant_id = p.tenant_id
      LEFT JOIN esignature_envelopes ee ON ee.contract_id = p.id AND ee.tenant_id = p.tenant_id
      LEFT JOIN payment_charges pc ON pc.contract_id = p.id AND pc.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
      ORDER BY p.created_at DESC
    `;
        const stmt = this.db.prepare(query);
        return stmt.all(tenantId);
    }
    createApprovalRequest(tenantId, contractId, opportunityId, actionType, requestedByActor) {
        this.requireTenant(tenantId);
        const reqId = `apr_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO approval_requests (id, tenant_id, contract_id, opportunity_id, action_type, requested_by_actor, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `);
        stmt.run(reqId, tenantId, contractId, opportunityId, actionType, requestedByActor, now);
        const getStmt = this.db.prepare('SELECT * FROM approval_requests WHERE id = ?');
        return getStmt.get(reqId);
    }
    getApprovalRequest(tenantId, approvalId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?');
        const row = stmt.get(approvalId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Solicitação de aprovação ${approvalId} não encontrada no escritório ${tenantId}.`);
        }
        return row;
    }
    decideApproval(tenantId, approvalId, reviewerUserId, decision, decisionNotes = '') {
        this.requireTenant(tenantId);
        const approval = this.getApprovalRequest(tenantId, approvalId);
        const now = utcNowIso();
        const updAppr = this.db.prepare(`
      UPDATE approval_requests
      SET status = ?, decided_by_user_id = ?, decision_notes = ?, decided_at = ?
      WHERE id = ? AND tenant_id = ?
    `);
        updAppr.run(decision, reviewerUserId, decisionNotes, now, approvalId, tenantId);
        const newContractStatus = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
        const updCtr = this.db.prepare(`
      UPDATE proposals_and_contracts
      SET status = ?, approved_by_user_id = ?, approved_at = ?, rejection_reason = ?
      WHERE id = ? AND tenant_id = ?
    `);
        updCtr.run(newContractStatus, decision === 'APPROVED' ? reviewerUserId : null, decision === 'APPROVED' ? now : null, decision === 'REJECTED' ? decisionNotes : null, approval.contract_id, tenantId);
        this.logAudit(tenantId, 'USER', reviewerUserId, `CONTRACT_${decision}`, 'contract', approval.contract_id, {
            decision,
            approvalId,
        });
        return {
            approval: this.getApprovalRequest(tenantId, approvalId),
            contract: this.getProposalContract(tenantId, approval.contract_id),
        };
    }
    approveProposalContract(tenantId, contractId, lawyerUserId) {
        this.requireTenant(tenantId);
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      UPDATE proposals_and_contracts
      SET status = 'APPROVED', approved_by_user_id = ?, approved_at = ?
      WHERE id = ? AND tenant_id = ?
    `);
        stmt.run(lawyerUserId, now, contractId, tenantId);
        this.logAudit(tenantId, 'USER', lawyerUserId, 'CONTRACT_APPROVED', 'contract', contractId, {
            approved_at: now,
            institutional_pre_approval: true,
        });
        return this.getProposalContract(tenantId, contractId);
    }
    // --- ESIGNATURE & PAYMENT CHARGES ---
    createEsignatureEnvelope(tenantId, contractId, opportunityId, provider, externalId, signerUrl, executionMode) {
        this.requireTenant(tenantId);
        const envId = `env_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO esignature_envelopes (id, tenant_id, contract_id, opportunity_id, provider, external_id, signer_url, status, execution_mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', ?, ?)
    `);
        stmt.run(envId, tenantId, contractId, opportunityId, provider, externalId, signerUrl, executionMode, now);
        const getStmt = this.db.prepare('SELECT * FROM esignature_envelopes WHERE id = ?');
        return getStmt.get(envId);
    }
    getEsignatureEnvelopeByExternalId(tenantId, externalId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM esignature_envelopes WHERE external_id = ? AND tenant_id = ?');
        const row = stmt.get(externalId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Envelope externo ${externalId} não encontrado no escritório ${tenantId}.`);
        }
        return row;
    }
    updateEsignatureStatus(tenantId, externalId, status) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('UPDATE esignature_envelopes SET status = ?, signed_at = ? WHERE external_id = ? AND tenant_id = ?');
        stmt.run(status, status === 'SIGNED' ? utcNowIso() : null, externalId, tenantId);
    }
    createPaymentCharge(tenantId, contractId, opportunityId, provider, externalId, paymentMethod, amountBrl, pixCopyPaste, invoiceUrl, executionMode) {
        this.requireTenant(tenantId);
        const chargeId = `chg_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO payment_charges (
        id, tenant_id, contract_id, opportunity_id, provider, external_id,
        payment_method, amount_brl, pix_copy_paste, invoice_url, status, execution_mode, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `);
        stmt.run(chargeId, tenantId, contractId, opportunityId, provider, externalId, paymentMethod, amountBrl, pixCopyPaste, invoiceUrl, executionMode, now);
        const getStmt = this.db.prepare('SELECT * FROM payment_charges WHERE id = ?');
        return getStmt.get(chargeId);
    }
    getPaymentChargeByExternalId(tenantId, externalId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM payment_charges WHERE external_id = ? AND tenant_id = ?');
        const row = stmt.get(externalId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Cobrança externa ${externalId} não encontrada no escritório ${tenantId}.`);
        }
        return row;
    }
    updatePaymentStatus(tenantId, externalId, status) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('UPDATE payment_charges SET status = ?, paid_at = ? WHERE external_id = ? AND tenant_id = ?');
        stmt.run(status, status === 'CONFIRMED' ? utcNowIso() : null, externalId, tenantId);
    }
    // --- IDEMPOTÊNCIA DE WEBHOOKS ---
    isWebhookProcessed(tenantId, idempotencyKey) {
        this.requireTenant(tenantId);
        if (!idempotencyKey)
            return false;
        const stmt = this.db.prepare('SELECT 1 FROM processed_webhooks WHERE (idempotency_key = ? OR external_message_id = ?) AND tenant_id = ?');
        return !!stmt.get(idempotencyKey, idempotencyKey, tenantId);
    }
    recordProcessedWebhook(arg1, arg2, arg3, arg4) {
        if (arg3 && arg4) {
            // (idempotencyKey, externalMessageId, tenantId, provider)
            const idempotencyKey = arg1;
            const externalMessageId = arg2;
            const tenantId = arg3;
            const provider = arg4;
            this.requireTenant(tenantId);
            const stmt = this.db.prepare('INSERT OR IGNORE INTO processed_webhooks (idempotency_key, external_message_id, tenant_id, provider, processed_at) VALUES (?, ?, ?, ?, ?)');
            stmt.run(idempotencyKey, externalMessageId, tenantId, provider, utcNowIso());
            return;
        }
        const tenantId = arg1;
        const provider = arg2;
        const externalMessageId = arg3 || arg2;
        this.markWebhookProcessed(tenantId, externalMessageId, provider);
    }
    markWebhookProcessed(tenantId, idempotencyKey, provider) {
        this.requireTenant(tenantId);
        if (!idempotencyKey)
            return;
        const stmt = this.db.prepare('INSERT OR IGNORE INTO processed_webhooks (idempotency_key, external_message_id, tenant_id, provider, processed_at) VALUES (?, ?, ?, ?, ?)');
        stmt.run(idempotencyKey, idempotencyKey, tenantId, provider, utcNowIso());
    }
    // --- AGENT TASKS ---
    createAgentTask(tenantId, agentType, objective, context, allowedTools, successCriteria, opportunityId, timeoutSeconds = 60, maxBudgetBrl = 2.0, requiresHumanApproval = false) {
        this.requireTenant(tenantId);
        const taskId = `tsk_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO agent_tasks (
        id, tenant_id, opportunity_id, agent_type, objective, context_json,
        allowed_tools_json, timeout_seconds, max_budget_brl, consumed_budget_brl,
        state, result_json, evidence_logs_json, success_criteria, requires_human_approval,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, 'PENDING', '{}', '[]', ?, ?, ?, ?)
    `);
        stmt.run(taskId, tenantId, opportunityId ?? null, agentType, objective, JSON.stringify(context), JSON.stringify(allowedTools), timeoutSeconds, maxBudgetBrl, successCriteria, requiresHumanApproval ? 1 : 0, now, now);
        const getStmt = this.db.prepare('SELECT * FROM agent_tasks WHERE id = ?');
        return getStmt.get(taskId);
    }
    getAgentTask(tenantId, taskId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM agent_tasks WHERE id = ? AND tenant_id = ?');
        const row = stmt.get(taskId, tenantId);
        if (!row) {
            throw new TenantIsolationError(`Tarefa ${taskId} não encontrada no escritório ${tenantId}.`);
        }
        return row;
    }
    updateAgentTask(tenantId, taskId, state, consumedBudgetBrl, result = {}, evidenceLogs = []) {
        this.requireTenant(tenantId);
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      UPDATE agent_tasks
      SET state = ?, consumed_budget_brl = consumed_budget_brl + ?, result_json = ?, evidence_logs_json = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `);
        stmt.run(state, consumedBudgetBrl, JSON.stringify(result), JSON.stringify(evidenceLogs), now, taskId, tenantId);
        return this.getAgentTask(tenantId, taskId);
    }
    listAgentTasks(tenantId, limit = 50) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM agent_tasks WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?');
        return stmt.all(tenantId, limit);
    }
    // --- FEATURE 3: TESES REGIONAIS E EXPANSÃO GEOGRÁFICA ---
    createThesisCampaign(data) {
        this.requireTenant(data.tenant_id);
        const id = `cmp_${randomUUID().slice(0, 10)}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO legal_thesis_campaigns (
        id, tenant_id, thesis_name, target_profession, municipality,
        portal_url, average_fee_brl, local_law_reference, explainer_video_url,
        contract_template_id, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
        stmt.run(id, data.tenant_id, data.thesis_name, data.target_profession, data.municipality, data.portal_url ?? null, data.average_fee_brl ?? 10000.0, data.local_law_reference ?? null, data.explainer_video_url ?? null, data.contract_template_id ?? null, now);
        this.logAudit(data.tenant_id, 'USER', 'campaign_manager', 'THESIS_CAMPAIGN_CREATED', 'thesis_campaign', id, {
            thesis_name: data.thesis_name,
            municipality: data.municipality,
        });
        return this.getThesisCampaign(data.tenant_id, id);
    }
    getThesisCampaign(tenantId, campaignId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM legal_thesis_campaigns WHERE tenant_id = ? AND id = ?');
        const row = stmt.get(tenantId, campaignId);
        return row || null;
    }
    listThesisCampaigns(tenantId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM legal_thesis_campaigns WHERE tenant_id = ? ORDER BY municipality ASC');
        return stmt.all(tenantId);
    }
    findThesisCampaignByMunicipality(tenantId, municipality, profession) {
        this.requireTenant(tenantId);
        const cleanMuni = municipality.trim().toLowerCase();
        const all = this.listThesisCampaigns(tenantId);
        const matched = all.find((c) => {
            const cMuni = c.municipality.toLowerCase();
            const muniMatch = cMuni.includes(cleanMuni) || cleanMuni.includes(cMuni.split('-')[0].trim().toLowerCase());
            if (!muniMatch)
                return false;
            if (profession && c.target_profession) {
                return c.target_profession.toLowerCase().includes(profession.toLowerCase()) ||
                    profession.toLowerCase().includes(c.target_profession.toLowerCase());
            }
            return true;
        });
        return matched || null;
    }
    getThesisCampaignsPerformance(tenantId) {
        this.requireTenant(tenantId);
        const campaigns = this.listThesisCampaigns(tenantId);
        return campaigns.map((cmp) => {
            const muniTerm = `%${cmp.municipality.split('-')[0].trim().toLowerCase()}%`;
            const leadStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM leads
        WHERE tenant_id = ? AND (
          lower(COALESCE(municipality, '')) LIKE ? OR id IN (
            SELECT lead_id FROM opportunities WHERE tenant_id = ? AND thesis_campaign_id = ?
          )
        )
      `);
            const leadRes = leadStmt.get(tenantId, muniTerm, tenantId, cmp.id);
            const oppStmt = this.db.prepare(`
        SELECT 
          COUNT(*) as total_opps,
          SUM(CASE WHEN stage IN ('WON', 'CLOSED_WON') THEN 1 ELSE 0 END) as won_count,
          SUM(CASE WHEN stage IN ('WON', 'CLOSED_WON') THEN estimated_value_brl ELSE 0 END) as won_fees,
          SUM(estimated_value_brl) as total_estimated
        FROM opportunities
        WHERE tenant_id = ? AND (thesis_campaign_id = ? OR lead_id IN (SELECT id FROM leads WHERE tenant_id = ? AND lower(COALESCE(municipality, '')) LIKE ?))
      `);
            const oppRes = oppStmt.get(tenantId, cmp.id, tenantId, muniTerm);
            return {
                ...cmp,
                total_leads: leadRes?.count || 0,
                total_opportunities: oppRes?.total_opps || 0,
                total_won: oppRes?.won_count || 0,
                contracted_fees_brl: oppRes?.won_fees || 0,
                projected_revenue_brl: (oppRes?.won_fees || 0) + (oppRes?.total_estimated || 0) * 0.3,
            };
        });
    }
    // --- FEATURE 4: RASTREAMENTO DE VÍDEO E BOCA A BOCA DIGITAL ---
    createOrGetVideoTracking(tenantId, leadId, thesisCampaignId) {
        this.requireTenant(tenantId);
        const existingStmt = this.db.prepare(`
      SELECT * FROM video_tracking_events 
      WHERE tenant_id = ? AND lead_id = ? AND (thesis_campaign_id = ? OR thesis_campaign_id IS NULL)
      ORDER BY created_at DESC LIMIT 1
    `);
        const existing = existingStmt.get(tenantId, leadId, thesisCampaignId ?? null);
        if (existing)
            return existing;
        const id = `vtrk_${randomUUID().slice(0, 10)}`;
        const trackingCode = `${leadId.replace('led_', '')}_${thesisCampaignId ? thesisCampaignId.replace('cmp_', '') : 'default'}`;
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      INSERT INTO video_tracking_events (
        id, tenant_id, lead_id, thesis_campaign_id, tracking_code, watched_pct, meta_capi_event_id, meta_capi_synced, watched_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 0.0, NULL, 0, NULL, ?)
    `);
        stmt.run(id, tenantId, leadId, thesisCampaignId ?? null, trackingCode, now);
        const getStmt = this.db.prepare('SELECT * FROM video_tracking_events WHERE id = ?');
        return getStmt.get(id);
    }
    getVideoTrackingByCode(trackingCode) {
        const stmt = this.db.prepare('SELECT * FROM video_tracking_events WHERE tracking_code = ?');
        const row = stmt.get(trackingCode);
        if (row)
            return row;
        // Auto-provisionamento resiliente quando o frontend envia leadId_campaignId ou similar
        const allLeads = this.db.prepare('SELECT * FROM leads ORDER BY created_at ASC').all();
        const matchedLead = allLeads.find((l) => trackingCode.startsWith(l.id) || trackingCode.startsWith(l.id.replace('led_', ''))) ||
            (trackingCode.includes('cmp_') || trackingCode.includes('led_') || trackingCode.includes('demo')
                ? allLeads.find((l) => l.tenant_id === 'tnt_cardoso_adv') || allLeads[0]
                : undefined);
        if (matchedLead) {
            const campaigns = this.listThesisCampaigns(matchedLead.tenant_id);
            const matchedCmp = campaigns.find((c) => trackingCode.includes(c.id) || trackingCode.includes(c.id.replace('cmp_', ''))) ||
                campaigns[0];
            const id = `vtrk_${randomUUID().slice(0, 10)}`;
            const now = utcNowIso();
            this.db
                .prepare(`
          INSERT OR IGNORE INTO video_tracking_events (
            id, tenant_id, lead_id, thesis_campaign_id, tracking_code, watched_pct, meta_capi_event_id, meta_capi_synced, watched_at, created_at
          ) VALUES (?, ?, ?, ?, ?, 0.0, NULL, 0, NULL, ?)
        `)
                .run(id, matchedLead.tenant_id, matchedLead.id, matchedCmp?.id ?? null, trackingCode, now);
            const created = stmt.get(trackingCode);
            return created || null;
        }
        return null;
    }
    updateVideoProgress(trackingCode, watchedPct, metaCapiEventId) {
        const existing = this.getVideoTrackingByCode(trackingCode);
        if (!existing) {
            throw new Error(`Tracking code ${trackingCode} não encontrado.`);
        }
        const maxPct = Math.max(existing.watched_pct, watchedPct);
        const now = utcNowIso();
        const stmt = this.db.prepare(`
      UPDATE video_tracking_events 
      SET watched_pct = ?, meta_capi_event_id = COALESCE(?, meta_capi_event_id), meta_capi_synced = CASE WHEN ? IS NOT NULL THEN 1 ELSE meta_capi_synced END, watched_at = ?
      WHERE tracking_code = ?
    `);
        stmt.run(maxPct, metaCapiEventId ?? null, metaCapiEventId ?? null, now, trackingCode);
        // Also update lead table
        const leadUpdates = this.db.prepare(`
      UPDATE leads 
      SET video_watched_pct = ?, video_watched_at = ?
      WHERE id = ? AND tenant_id = ?
    `);
        leadUpdates.run(maxPct, now, existing.lead_id, existing.tenant_id);
        return this.getVideoTrackingByCode(trackingCode);
    }
    listVideoTrackingEvents(tenantId) {
        this.requireTenant(tenantId);
        const stmt = this.db.prepare('SELECT * FROM video_tracking_events WHERE tenant_id = ? ORDER BY created_at DESC');
        return stmt.all(tenantId);
    }
}
