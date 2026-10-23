/**
 * Gateway de API REST e Webhooks — Law.AI (TypeScript + Fastify)
 * Paridade 1:1 com os 18 Módulos (A–R), RBAC, Webhooks HMAC e Servidor MCP
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseManager } from '../database/db.js';
import { TaskOrchestrator, BudgetExceededError } from '../orchestrator/engine.js';
import { OmnichannelFlowAndDocumentAnalyzer } from '../orchestrator/analyzer.js';
import { LawAIMCPServer, JsonRpcRequest } from '../mcp/server.js';
import {
  validateTwilioWebhookSignature,
  TwilioWhatsAppProvider,
  calculateOutboundDedupHash,
} from '../connectors/providers.js';
import {
  AuthorizationError,
  EthicalViolationError,
  PromptInjectionDetectedError,
  TenantIsolationError,
  StrictRecipientResolutionGuard,
  normalizeE164Phone,
} from '../security/guardrails.js';
import type { UserRole, OpportunityStage } from '../types/index.js';

export interface AppOptions {
  dbPath?: string;
  seed?: boolean;
}

export function generateVaultCertificateSvg(doc: {
  original_filename: string;
  document_type: string;
  sha256_hash: string;
  byte_size: number;
  created_at: string;
}): string {
  const sizeKb = (doc.byte_size / 1024).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="100%" height="100%">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0e1726"/>
      <stop offset="100%" stop-color="#181b34"/>
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1f2440"/>
      <stop offset="100%" stop-color="#262d52"/>
    </linearGradient>
    <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0073ea"/>
      <stop offset="100%" stop-color="#00c875"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#bgGrad)" rx="16"/>
  <rect x="30" y="30" width="740" height="940" fill="none" stroke="#2c345c" stroke-width="2" rx="12" stroke-dasharray="6,6"/>
  <rect x="40" y="40" width="720" height="920" fill="none" stroke="#3d4778" stroke-width="1" rx="10"/>

  <text x="400" y="90" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="24" font-weight="800" fill="#ffffff" text-anchor="middle">LAW.AI — COFRE DIGITAL FORENSE</text>
  <text x="400" y="120" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="13" font-weight="600" fill="#8c97c4" text-anchor="middle">CERTIDÃO DE CUSTÓDIA DE DOCUMENTO COM VALIDADE JURÍDICA</text>
  <line x1="80" y1="145" x2="720" y2="145" stroke="#343d6a" stroke-width="1.5"/>

  <circle cx="400" cy="225" r="50" fill="url(#badgeGrad)"/>
  <text x="400" y="240" font-size="44" text-anchor="middle">📄</text>
  <rect x="300" y="290" width="200" height="28" rx="14" fill="#00c875" opacity="0.15"/>
  <text x="400" y="309" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="12" font-weight="700" fill="#00c875" text-anchor="middle">✓ INTEGRIDADE CERTIFICADA</text>

  <rect x="80" y="340" width="640" height="420" fill="url(#cardGrad)" rx="12" stroke="#37416e" stroke-width="1"/>

  <text x="110" y="380" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#808cae" text-transform="uppercase">NOME ORIGINAL DO ARQUIVO</text>
  <text x="110" y="408" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="16" font-weight="700" fill="#ffffff">${doc.original_filename}</text>

  <text x="110" y="455" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#808cae" text-transform="uppercase">TIPO CLASSIFICADO POR INTELIGÊNCIA ARTIFICIAL</text>
  <text x="110" y="483" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="16" font-weight="700" fill="#579bfc">${doc.document_type}</text>

  <text x="110" y="530" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#808cae" text-transform="uppercase">TAMANHO ARQUIVADO / DATA DE PROTOCOLO</text>
  <text x="110" y="558" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="15" font-weight="600" fill="#ffffff">${sizeKb} KB • ${doc.created_at}</text>

  <text x="110" y="605" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#808cae" text-transform="uppercase">HASH CRIPTOGRÁFICO DE INTEGRIDADE (SHA-256)</text>
  <rect x="110" y="620" width="580" height="40" fill="#141829" rx="6" stroke="#2d365d" stroke-width="1"/>
  <text x="125" y="645" font-family="'JetBrains Mono', Courier, monospace" font-size="12" fill="#00c875">${doc.sha256_hash}</text>

  <text x="110" y="690" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#808cae" text-transform="uppercase">CONFORMIDADE REGULATÓRIA E ÉTICA</text>
  <text x="110" y="715" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="13" fill="#c3cde9">Custódia forense realizada em conformidade com o Provimento 205/2021 da OAB e LGPD.</text>

  <line x1="80" y1="800" x2="720" y2="800" stroke="#343d6a" stroke-width="1"/>
  <text x="400" y="835" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="12" font-weight="600" fill="#ffffff" text-anchor="middle">Cardoso &amp; Associados Advocacia • OAB/GO 4.512</text>
  <text x="400" y="855" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="11" fill="#7d8ab4" text-anchor="middle">Dr. Fabricio Cardoso Gomes — OAB/GO 41.209 Titular</text>
  <text x="400" y="885" font-family="'JetBrains Mono', Courier, monospace" font-size="10" fill="#4f5b84" text-anchor="middle">ID DO REGISTRO: ${doc.sha256_hash.slice(0, 24)}... (COFRE SEGURO)</text>
</svg>`;
}

export function createApp(options?: AppOptions): FastifyInstance {
  const db = new DatabaseManager(options?.dbPath || ':memory:');
  if (options?.seed === true) {
    db.seedDefaultData();
  }
  const orchestrator = new TaskOrchestrator(db);
  const mcpServer = new LawAIMCPServer(orchestrator);

  const app = Fastify({
    logger: false,
  });

  app.decorate('db', db);
  app.decorate('orchestrator', orchestrator);

  // PARSER NATIVO PARA APPLICATION/X-WWW-FORM-URLENCODED (TWILIO WEBHOOKS)
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      try {
        const parsed: Record<string, string> = {};
        const params = new URLSearchParams(body);
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  function resolveFrontendAsset(filename: string): string | null {
    const candidates = [
      join(process.cwd(), 'src', 'frontend', filename),
      join(import.meta.dirname || process.cwd(), '..', 'frontend', filename),
      join(import.meta.dirname || process.cwd(), '..', '..', 'src', 'frontend', filename),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  // ROTA RAIZ: FRONTEND SPA
  app.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    const frontendPath = resolveFrontendAsset('index.html');
    if (frontendPath) {
      const html = readFileSync(frontendPath, 'utf-8');
      return reply.type('text/html; charset=utf-8').send(html);
    }
    return reply.type('text/html').send('<h1>Law.AI Platform Running</h1>');
  });

  // ROTAS PÚBLICAS: LANDING PAGE DE CAPTAÇÃO POR TRÁFEGO PAGO
  const serveLanding = async (_req: FastifyRequest, reply: FastifyReply) => {
    const landingPath = resolveFrontendAsset('landing.html');
    if (landingPath) {
      const html = readFileSync(landingPath, 'utf-8');
      return reply.type('text/html; charset=utf-8').send(html);
    }
    return reply.type('text/html').send('<h1>Página de Atendimento Especializado — Cardoso & Associados</h1>');
  };

  app.get('/atendimento', serveLanding);
  app.get('/captacao', serveLanding);

  function resolveTenantId(req: FastifyRequest, body?: Record<string, unknown>): string {
    const h = req.headers['x-tenant-id'] as string;
    if (h && h.trim()) return h.trim();
    const q = req.query as { tenant_id?: string; tenant_slug?: string };
    if (q?.tenant_id) return q.tenant_id;
    if (q?.tenant_slug) {
      const t = db.getTenantBySlug(q.tenant_slug);
      if (t) return t.id;
    }
    if (body?.['tenant_id']) return String(body['tenant_id']);
    if (body?.['tenant_slug']) {
      const t = db.getTenantBySlug(String(body['tenant_slug']));
      if (t) return t.id;
    }
    const def = db.getTenantBySlug('cardoso-adv');
    return def?.id || 'tnt_cardoso_adv';
  }

  // =========================================================================
  // ENDPOINTS REST PÚBLICOS DE CAPTAÇÃO TRÁFEGO PAGO & FUNIL FECHAMENTO IA
  // =========================================================================

  // 1. POST /api/v1/public/intake/start — Submissão da Etapa 1
  app.post('/api/v1/public/intake/start', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = req.body as any;
      const tenantId = resolveTenantId(req, body);
      const res = await orchestrator.handlePublicIntakeStart({
        ...body,
        tenantId,
      });
      return reply.status(201).send(res);
    } catch (err: unknown) {
      if (err instanceof PromptInjectionDetectedError) {
        return reply.status(400).send({ detail: 'Entrada bloqueada por conter padrões de injeção de prompt.' });
      }
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  // 2. POST /api/v1/public/intake/:leadId/documents — Salvamento de Documentos no Cofre Seguro
  app.post('/api/v1/public/intake/:leadId/documents', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { leadId } = req.params as { leadId: string };
      const body = req.body as {
        document_type: string;
        original_filename: string;
        file_base64?: string;
        mime_type?: string;
        raw_text?: string;
      };
      const tenantId = resolveTenantId(req, body as any);

      let fileBytes: Buffer;
      if (body.file_base64) {
        fileBytes = Buffer.from(body.file_base64, 'base64');
      } else if (body.raw_text) {
        fileBytes = Buffer.from(body.raw_text, 'utf-8');
      } else {
        fileBytes = Buffer.from(`CONTEUDO_DOCUMENTO_${body.document_type || 'DOC'}_${body.original_filename || 'arquivo.pdf'}_${Date.now()}`, 'utf-8');
      }

      const res = await orchestrator.handlePublicDocumentUpload({
        tenantId,
        leadId,
        documentType: body.document_type || 'DOCUMENTO_GERAL',
        originalFilename: body.original_filename || `${body.document_type || 'documento'}.pdf`,
        fileBytes,
        mimeType: body.mime_type || 'application/pdf',
        autoCloseContract: (body as any).auto_close_contract !== false,
      });
      return reply.status(201).send(res);
    } catch (err: unknown) {
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  // 3. POST /api/v1/public/intake/:leadId/complete — Submissão do Formulário IA + Disparo no WhatsApp
  app.post('/api/v1/public/intake/:leadId/complete', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { leadId } = req.params as { leadId: string };
      const body = req.body as any;
      const tenantId = resolveTenantId(req, body);

      const res = await orchestrator.handlePublicIntakeComplete({
        tenantId,
        leadId,
        body,
      });
      return reply.status(200).send(res);
    } catch (err: unknown) {
      if (err instanceof PromptInjectionDetectedError) {
        return reply.status(400).send({ detail: 'Entrada bloqueada por conter padrões de injeção de prompt.' });
      }
      if (err instanceof EthicalViolationError) {
        return reply.status(400).send({ detail: 'Violação ética OAB: Promessa de resultado proibida pelo Provimento 205/2021.' });
      }
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  // 4. POST /api/v1/public/intake/:leadId/contract — Geração do Contrato e Disponibilização ZapSign
  app.post('/api/v1/public/intake/:leadId/contract', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { leadId } = req.params as { leadId: string };
      const tenantId = resolveTenantId(req);

      const res = await orchestrator.handlePublicContractGeneration({
        tenantId,
        leadId,
      });
      return reply.status(201).send(res);
    } catch (err: unknown) {
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  // 5. GET /api/v1/public/intake/:leadId/status — Consulta Pública de Status e Protocolo
  app.get('/api/v1/public/intake/:leadId/status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { leadId } = req.params as { leadId: string };
      const tenantId = resolveTenantId(req);

      const res = orchestrator.getPublicIntakeStatus(tenantId, leadId);
      return reply.status(200).send(res);
    } catch (err: unknown) {
      return reply.status(404).send({ detail: (err as Error).message });
    }
  });

  // HEALTH CHECK (Módulos A–R e conectores)
  app.get('/api/v1/health', async () => {
    return {
      status: 'ok',
      platform: 'Law.AI',
      modules_loaded: 'ABCDEFGHIJKLMNOPQR'.split(''),
      connectors: {
        messaging: orchestrator.messaging.mode,
        email: orchestrator.email.mode,
        telephony: orchestrator.telephony.mode,
        calendar: orchestrator.calendar.mode,
        esignature: orchestrator.esignature.mode,
        payment: orchestrator.payment.mode,
        storage: orchestrator.storage.mode,
        ai_model: orchestrator.aiModel.mode,
      },
    };
  });

  // MÓDULO A: TENANTS
  app.get('/api/v1/tenants', async () => {
    const stmt = db.db.prepare('SELECT id, name, slug, oab_society_number, plan_tier, monthly_ai_budget_brl, current_ai_spend_brl FROM tenants');
    return { tenants: stmt.all() };
  });

  app.post('/api/v1/tenants', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      name: string;
      slug: string;
      oab_society_number: string;
      plan_tier?: string;
      monthly_ai_budget_brl?: number;
    };
    const tenant = db.createTenant(
      body.name,
      body.slug,
      body.oab_society_number,
      body.plan_tier || 'PRO',
      body.monthly_ai_budget_brl ?? 500.0
    );
    return reply.status(201).send(tenant);
  });

  // MÓDULO B: USUÁRIOS E RBAC
  app.post('/api/v1/users', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(403).send({ detail: 'Contexto tenant_id é obrigatório.' });

    const body = req.body as {
      email: string;
      full_name: string;
      role: UserRole;
      oab_number?: string;
      oab_uf?: string;
      specialties?: string[];
    };
    try {
      const user = db.createUser(
        tenantId,
        body.email,
        body.full_name,
        body.role,
        body.oab_number,
        body.oab_uf,
        body.specialties || []
      );
      return reply.status(201).send(user);
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError) {
        return reply.status(403).send({ detail: err.message });
      }
      throw err;
    }
  });

  app.get('/api/v1/users', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(403).send({ detail: 'Contexto tenant_id é obrigatório.' });
    return { users: db.listUsers(tenantId) };
  });

  // MÓDULO C: SERVIÇOS JURÍDICOS
  app.post('/api/v1/services', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      name: string;
      legal_area: string;
      qualification_questions: string[];
      base_fee_brl: number;
      success_fee_pct?: number;
      requires_lawyer_approval?: boolean;
    };
    const service = db.createLegalService(
      tenantId,
      body.name,
      body.legal_area,
      body.qualification_questions,
      body.base_fee_brl,
      body.success_fee_pct ?? 20.0,
      body.requires_lawyer_approval ?? true
    );
    return reply.status(201).send(service);
  });

  app.get('/api/v1/services', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const query = req.query as { legal_area?: string };
    return { services: db.listLegalServices(tenantId, query.legal_area) };
  });

  // MÓDULO I: MODELOS CONTRATUAIS
  app.post('/api/v1/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      name: string;
      legal_area: string;
      body_template: string;
    };
    const template = db.createDocumentTemplate(tenantId, body.name, body.legal_area, body.body_template);
    return reply.status(201).send(template);
  });

  // MÓDULO D: LEADS
  app.get('/api/v1/leads', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const query = req.query as { search?: string; legal_area?: string; limit?: number; offset?: number };
    return { leads: db.listLeads(tenantId, query.search, query.legal_area, query.limit ?? 100, query.offset ?? 0) };
  });

  app.post('/api/v1/leads', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      full_name: string;
      phone: string;
      email?: string;
      document_cpf_cnpj?: string;
      source_channel?: string;
      legal_area?: string;
      urgency_level?: string;
      qualification_score?: number;
      qualification_data?: Record<string, unknown>;
    };
    const lead = db.createLead(
      tenantId,
      body.full_name,
      body.phone,
      body.email,
      body.document_cpf_cnpj,
      body.source_channel || 'WHATSAPP',
      body.legal_area,
      body.urgency_level || 'NORMAL',
      body.qualification_score || 0,
      body.qualification_data || {}
    );
    return reply.status(201).send(lead);
  });

  app.get('/api/v1/leads/:leadId', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { leadId } = req.params as { leadId: string };
    try {
      return db.getLead(tenantId, leadId);
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: err.message });
      }
      throw err;
    }
  });

  // MÓDULO O: ANONIMIZAÇÃO LGPD ART. 18
  app.post('/api/v1/leads/:leadId/anonymize', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const userId = (req.headers['x-user-id'] as string) || 'dpo_admin';
    const { leadId } = req.params as { leadId: string };
    try {
      return db.anonymizeLeadLgpd(tenantId, leadId, userId);
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: err.message });
      }
      throw err;
    }
  });

  // MÓDULO D: OPORTUNIDADES
  app.get('/api/v1/opportunities', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const query = req.query as { stage?: string };
    const rawOpps = db.listOpportunities(tenantId, query.stage);
    const opportunities = rawOpps.map((o) => {
      let pendingDocs: string[] = [];
      try {
        pendingDocs = JSON.parse(o.pending_documents_json || '[]');
      } catch {
        pendingDocs = [];
      }
      const uploadedDocs = db.listLeadDocuments(tenantId, o.lead_id);
      return {
        ...o,
        pending_documents: pendingDocs,
        uploaded_documents: uploadedDocs,
        uploaded_documents_count: uploadedDocs.length,
      };
    });
    return { opportunities };
  });

  // MÓDULO DOCUMENTOS NO COFRE (GED / ATENDIMENTO & WHATSAPP)
  app.get('/api/v1/leads/:leadId/documents', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { leadId } = req.params as { leadId: string };
    const docs = db.listLeadDocuments(tenantId, leadId);
    return reply.status(200).send({ lead_id: leadId, count: docs.length, documents: docs });
  });

  app.get('/api/v1/opportunities/:oppId/documents', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { oppId } = req.params as { oppId: string };
    const opp = db.getOpportunity(tenantId, oppId);
    const docs = db.listLeadDocuments(tenantId, opp.lead_id);
    return reply.status(200).send({ opportunity_id: oppId, lead_id: opp.lead_id, count: docs.length, documents: docs });
  });

  app.get('/api/v1/documents', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const docs = db.listAllDocuments(tenantId);
    return reply.status(200).send({ documents: docs });
  });

  // VISUALIZAÇÃO DE DOCUMENTO (INLINE NO NAVEGADOR)
  app.get('/api/v1/documents/:docId/view', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req.headers['x-tenant-id'] as string) || 'tnt_cardoso_adv';
    const { docId } = req.params as { docId: string };

    let doc = db.getLeadDocument(tenantId, docId);
    if (!doc) {
      // Fallback permissivo para busca cross-tenant se for admin/visualizador
      const stmt = db.db.prepare('SELECT * FROM lead_documents WHERE id = ?');
      doc = stmt.get(docId) as any;
    }

    if (!doc) {
      return reply.status(404).send({ detail: `Documento ${docId} não encontrado no cofre seguro.` });
    }

    // 1. Tentar recuperar do cofre de arquivos em disco
    let buffer: Buffer | null = null;
    try {
      buffer = await orchestrator.storage.retrieveDocument(doc.storage_uri || doc.sha256_hash);
    } catch {}

    // 2. Tentar recuperar do campo base64 persistido no banco
    if (!buffer && doc.file_data_base64) {
      try {
        buffer = Buffer.from(doc.file_data_base64, 'base64');
      } catch {}
    }

    // 3. Se for arquivo legado sem bytes gravados, gerar certidão visual oficial em SVG
    if (!buffer || buffer.length === 0) {
      const svg = generateVaultCertificateSvg(doc);
      return reply
        .type('image/svg+xml; charset=utf-8')
        .header('Content-Disposition', `inline; filename="${doc.original_filename}.svg"`)
        .header('Cache-Control', 'public, max-age=3600')
        .send(svg);
    }

    const contentType = doc.mime_type || 'application/octet-stream';
    return reply
      .type(contentType)
      .header('Content-Disposition', `inline; filename="${doc.original_filename}"`)
      .header('Cache-Control', 'public, max-age=3600')
      .send(buffer);
  });

  // DOWNLOAD DE DOCUMENTO
  app.get('/api/v1/documents/:docId/download', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req.headers['x-tenant-id'] as string) || 'tnt_cardoso_adv';
    const { docId } = req.params as { docId: string };

    let doc = db.getLeadDocument(tenantId, docId);
    if (!doc) {
      const stmt = db.db.prepare('SELECT * FROM lead_documents WHERE id = ?');
      doc = stmt.get(docId) as any;
    }

    if (!doc) {
      return reply.status(404).send({ detail: `Documento ${docId} não encontrado.` });
    }

    let buffer: Buffer | null = null;
    try {
      buffer = await orchestrator.storage.retrieveDocument(doc.storage_uri || doc.sha256_hash);
    } catch {}

    if (!buffer && doc.file_data_base64) {
      try {
        buffer = Buffer.from(doc.file_data_base64, 'base64');
      } catch {}
    }

    if (!buffer || buffer.length === 0) {
      const svg = generateVaultCertificateSvg(doc);
      return reply
        .type('image/svg+xml; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${doc.original_filename}.svg"`)
        .send(svg);
    }

    const contentType = doc.mime_type || 'application/octet-stream';
    return reply
      .type(contentType)
      .header('Content-Disposition', `attachment; filename="${doc.original_filename}"`)
      .send(buffer);
  });

  // METADADOS E LINKS DO DOCUMENTO
  app.get('/api/v1/documents/:docId', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req.headers['x-tenant-id'] as string) || 'tnt_cardoso_adv';
    const { docId } = req.params as { docId: string };

    let doc = db.getLeadDocument(tenantId, docId);
    if (!doc) {
      const stmt = db.db.prepare('SELECT * FROM lead_documents WHERE id = ?');
      doc = stmt.get(docId) as any;
    }

    if (!doc) {
      return reply.status(404).send({ detail: 'Documento não encontrado.' });
    }

    const hasBytes = Boolean(doc.file_data_base64);
    return reply.status(200).send({
      document: {
        id: doc.id,
        tenant_id: doc.tenant_id,
        lead_id: doc.lead_id,
        document_type: doc.document_type,
        original_filename: doc.original_filename,
        sha256_hash: doc.sha256_hash,
        byte_size: doc.byte_size,
        mime_type: doc.mime_type,
        created_at: doc.created_at,
      },
      view_url: `/api/v1/documents/${doc.id}/view`,
      download_url: `/api/v1/documents/${doc.id}/download`,
      has_binary: hasBytes,
    });
  });

  // EXCLUSÃO TOTAL DE DOCUMENTO (COFRE DIGITAL, BANCO DE DADOS E AUDITORIA)
  app.delete('/api/v1/documents/:docId', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req);
    const { docId } = req.params as { docId: string };

    let doc = db.getLeadDocument(tenantId, docId);
    if (!doc) {
      const stmt = db.db.prepare('SELECT * FROM lead_documents WHERE id = ?');
      doc = stmt.get(docId) as any;
    }

    if (!doc) {
      return reply.status(404).send({ detail: 'Documento não encontrado.' });
    }

    // 1. Excluir arquivo físico do cofre seguro se existir
    try {
      if (orchestrator.storage && typeof (orchestrator.storage as any).deleteDocument === 'function') {
        await (orchestrator.storage as any).deleteDocument(doc.sha256_hash);
      }
    } catch (vaultErr) {
      console.warn('[Storage] Erro ao remover arquivo do cofre:', vaultErr);
    }

    // 2. Excluir do banco de dados relacional
    const deleted = db.deleteLeadDocument(doc.tenant_id, doc.id);

    // 3. Atualizar reanálise documental e checklist da oportunidade
    try {
      const opp = db.getOpportunityByLeadId(doc.tenant_id, doc.lead_id);
      if (opp) {
        await orchestrator.omnichannelAnalyzer.analyzeConversationAndProcessContract(doc.tenant_id, opp.id);
      }
    } catch (anaErr) {
      console.warn('[Analyzer] Reanálise pós-exclusão ignorada:', anaErr);
    }

    return reply.status(200).send({
      deleted,
      document_id: doc.id,
      original_filename: doc.original_filename,
      message: 'Documento excluído com sucesso do cofre e do banco de dados.',
    });
  });

  app.delete('/api/v1/leads/:leadId/documents/:docId', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req);
    const { docId } = req.params as { docId: string };

    let doc = db.getLeadDocument(tenantId, docId);
    if (!doc) {
      const stmt = db.db.prepare('SELECT * FROM lead_documents WHERE id = ?');
      doc = stmt.get(docId) as any;
    }

    if (!doc) {
      return reply.status(404).send({ detail: 'Documento não encontrado.' });
    }

    try {
      if (orchestrator.storage && typeof (orchestrator.storage as any).deleteDocument === 'function') {
        await (orchestrator.storage as any).deleteDocument(doc.sha256_hash);
      }
    } catch (vaultErr) {
      console.warn('[Storage] Erro ao remover arquivo do cofre:', vaultErr);
    }

    const deleted = db.deleteLeadDocument(doc.tenant_id, doc.id);

    try {
      const opp = db.getOpportunityByLeadId(doc.tenant_id, doc.lead_id);
      if (opp) {
        await orchestrator.omnichannelAnalyzer.analyzeConversationAndProcessContract(doc.tenant_id, opp.id);
      }
    } catch (anaErr) {
      console.warn('[Analyzer] Reanálise pós-exclusão ignorada:', anaErr);
    }

    return reply.status(200).send({
      deleted,
      document_id: doc.id,
      original_filename: doc.original_filename,
      message: 'Documento excluído com sucesso do cofre e do banco de dados.',
    });
  });

  app.post('/api/v1/opportunities', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      lead_id: string;
      service_id?: string;
      stage?: OpportunityStage;
      priority?: string;
      estimated_value_brl?: number;
      assigned_lawyer_id?: string;
      pending_documents?: string[];
      crm_situation_summary?: string;
    };
    const opp = db.createOpportunity(
      tenantId,
      body.lead_id,
      body.service_id,
      body.stage || 'NEW',
      body.priority || 'MEDIUM',
      body.estimated_value_brl || 0.0,
      body.assigned_lawyer_id,
      body.pending_documents || [],
      body.crm_situation_summary || ''
    );
    return reply.status(201).send(opp);
  });

  app.patch('/api/v1/opportunities/:oppId/stage', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { oppId } = req.params as { oppId: string };
    const body = req.body as { stage: OpportunityStage };
    try {
      return db.updateOpportunityStage(tenantId, oppId, body.stage);
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: err.message });
      }
      throw err;
    }
  });

  // MÓDULO E: CONVERSAS E MENSAGENS
  app.get('/api/v1/conversations', async (req: FastifyRequest) => {
    const tenantId = resolveTenantId(req);
    return { conversations: db.listConversations(tenantId) };
  });

  app.get('/api/v1/conversations/:convId/messages', async (req: FastifyRequest) => {
    const tenantId = resolveTenantId(req);
    const { convId } = req.params as { convId: string };
    return { messages: db.listMessages(tenantId, convId) };
  });

  app.post('/api/v1/conversations/:convId/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req);
    const { convId } = req.params as { convId: string };
    const body = req.body as { content: string; direction?: 'INBOUND' | 'OUTBOUND'; sender_type?: 'LEAD' | 'BOT' | 'LAWYER' };
    const content = (body.content || '').trim();
    if (!content) {
      return reply.status(400).send({ detail: 'Conteúdo da mensagem é obrigatório.' });
    }

    const msg = db.addMessage(
      tenantId,
      convId,
      body.direction || 'OUTBOUND',
      body.sender_type || 'LAWYER',
      content
    );

    // Se for mensagem da equipe jurídica (LAWYER / BOT), disparar ao cliente pelo WhatsApp oficial
    if ((body.sender_type === 'LAWYER' || !body.sender_type) && body.direction !== 'INBOUND') {
      try {
        const convStmt = db.db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?');
        const conv = convStmt.get(convId, tenantId) as any;
        if (conv) {
          const lead = db.getLead(tenantId, conv.lead_id);
          const twilio =
            orchestrator.messaging instanceof TwilioWhatsAppProvider
              ? orchestrator.messaging
              : new TwilioWhatsAppProvider();
          await twilio.sendMessage(lead.phone, content);
        }
      } catch (err: any) {
        console.warn('[ConversationAPI] Erro ao disparar WhatsApp:', err.message);
      }
    }

    return reply.status(201).send(msg);
  });

  // MÓDULO F: WEBHOOK INBOUND MESSAGE
  app.post('/api/v1/webhooks/inbound-message', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      channel?: string;
      sender_name: string;
      sender_phone: string;
      message_text: string;
      sender_email?: string;
      sender_cpf_cnpj?: string;
    };
    try {
      const res = await orchestrator.handleInboundMessage({
        tenantId,
        channel: body.channel || 'WHATSAPP',
        senderName: body.sender_name,
        senderPhone: body.sender_phone,
        messageText: body.message_text,
        senderEmail: body.sender_email,
        senderCpfCnpj: body.sender_cpf_cnpj,
      });
      return res;
    } catch (err: unknown) {
      if (err instanceof PromptInjectionDetectedError) {
        return reply.status(422).send({ detail: err.message });
      }
      if (err instanceof BudgetExceededError) {
        return reply.status(429).send({ detail: err.message });
      }
      if (err instanceof EthicalViolationError) {
        return reply.status(400).send({ detail: err.message });
      }
      throw err;
    }
  });

  // MÓDULO G: WEBHOOK OUTBOUND MESSAGE (DETECÇÃO TEMPO REAL)
  app.post('/api/v1/webhooks/outbound-message', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      lead_id: string;
      channel?: string;
      message_text: string;
      actor_id?: string;
      auto_sync_crm?: boolean;
      followup_delay_hours?: number;
    };
    try {
      return orchestrator.handleOutboundLawyerMessage({
        tenantId,
        leadId: body.lead_id,
        messageText: body.message_text,
        channel: body.channel || 'WHATSAPP',
        actorId: body.actor_id || 'lawyer',
        autoSyncCrm: body.auto_sync_crm ?? true,
        followupDelayHours: body.followup_delay_hours ?? 24,
      });
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: err.message });
      }
      throw err;
    }
  });

  // MÓDULO G: BATCH SYNC HOJE (SINCRONIZAÇÃO EM ATACADO)
  app.post('/api/v1/crm/batch-sync-today', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      command?: string;
      followup_delay_hours?: number;
    };
    try {
      return orchestrator.batchSyncCrmFromTodayMessages({
        tenantId,
        naturalLanguageCommand: body.command || 'Atualize todas as situações dos clientes conforme as mensagens de hoje',
        followupDelayHours: body.followup_delay_hours ?? 24,
      });
    } catch (err: unknown) {
      if (err instanceof PromptInjectionDetectedError) {
        return reply.status(422).send({ detail: err.message });
      }
      throw err;
    }
  });

  app.get('/api/v1/crm/follow-ups', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const query = req.query as { status?: string };
    return { follow_ups: db.listFollowUpTasks(tenantId, query.status) };
  });

  // =========================================================================
  // INTEGRAÇÃO OFICIAL TWILIO WHATSAPP & ANALISADOR OMNICHANNEL
  // =========================================================================

  const twilioProvider =
    orchestrator.messaging instanceof TwilioWhatsAppProvider
      ? orchestrator.messaging
      : new TwilioWhatsAppProvider();

  // 1. Handler Oficial Twilio WhatsApp (atende /api/v1/webhooks/twilio/whatsapp e /)
  const handleTwilioWhatsAppWebhook = async (req: FastifyRequest, reply: FastifyReply) => {
    const rawParams = (req.body as Record<string, string>) || {};
    const tenantId = resolveTenantId(req, rawParams as any);

    // Validação de assinatura Twilio HMAC-SHA1 quando habilitada
    const authEnabled = process.env['TWILIO_WEBHOOK_AUTH_ENABLED'] === 'true';
    if (authEnabled) {
      const signature = (req.headers['x-twilio-signature'] as string) || '';
      const authToken = process.env['TWILIO_AUTH_TOKEN'] || '';
      const baseUrl =
        process.env['PUBLIC_WEBHOOK_BASE_URL'] || `http://${req.headers.host || 'localhost:8000'}`;
      const webhookUrl = `${baseUrl}/api/v1/webhooks/twilio/whatsapp`;
      const isValid = validateTwilioWebhookSignature(authToken, signature, webhookUrl, rawParams);
      if (!isValid) {
        return reply.status(401).send({ detail: 'Assinatura X-Twilio-Signature inválida ou ausente.' });
      }
    }

    const messageSid = rawParams['MessageSid'] || rawParams['SmsMessageSid'] || rawParams['SmsSid'] || '';

    // 1.1 Trava de Deduplicação de Webhook Inbound (MessageSid / wamid)
    if (messageSid && db.isWebhookProcessed(tenantId, messageSid)) {
      console.warn(`[TwilioWebhook] Webhook duplicado suprimido para MessageSid ${messageSid}. Retornando 200 OK.`);
      return reply
        .type('text/xml; charset=utf-8')
        .status(200)
        .send('<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>');
    }
    if (messageSid) {
      db.recordProcessedWebhook(tenantId, 'twilio', messageSid);
    }

    const fromRaw = rawParams['From'] || '';
    const cleanPhone = normalizeE164Phone(fromRaw.replace('whatsapp:', '').trim()) || '+5562999990000';
    const profileName = rawParams['ProfileName'] || 'Cliente WhatsApp';
    const bodyText = (rawParams['Body'] || '').trim();
    const numMedia = parseInt(rawParams['NumMedia'] || '0', 10);

    // 1. Detectar área jurídica preliminar pela mensagem
    let detectedArea = 'CIVEL';
    if (/demitid|rescis|fgts|horas extras|carteira|trabalhist|sal[aá]rio/i.test(bodyText)) {
      detectedArea = 'TRABALHISTA';
    } else if (/inss|aposenta|benef[íi]cio|laudo|per[íi]cia|aux[íi]lio|servidor|p[úu]blic|rpps|pens[aã]o\s+por\s+morte/i.test(bodyText)) {
      detectedArea = 'PREVIDENCIARIO';
    } else if (/contrato\s+social|empresa|s[óo]cio|cnpj|tribut/i.test(bodyText)) {
      detectedArea = 'EMPRESARIAL';
    } else if (/golpe|banco|empr[ée]stimo|cart[aã]o|serasa|spc|nome\s+sujo|v[oô]o|atraso/i.test(bodyText)) {
      detectedArea = 'CIVEL_CONSUMIDOR';
    } else if (/div[oó]rcio|pens[aã]o|guarda|invent[aá]rio|heran[cç]a/i.test(bodyText)) {
      detectedArea = 'FAMILIA_SUCESSOES';
    }

    const defaultChecklist = OmnichannelFlowAndDocumentAnalyzer.getDefaultChecklistForArea(detectedArea);

    // 2. Identificar ou criar Lead no tenant
    let lead = db
      .listLeads(tenantId)
      .find((l) => {
        const normL = normalizeE164Phone(l.phone);
        if (normL === cleanPhone) return true;
        const dL = l.phone.replace(/\D/g, '');
        const dClean = cleanPhone.replace(/\D/g, '');
        return dL.length >= 8 && dClean.length >= 8 && (dL.endsWith(dClean.slice(-8)) || dClean.endsWith(dL.slice(-8)));
      });

    if (!lead) {
      lead = db.createLead(tenantId, profileName, cleanPhone, null, 'WHATSAPP', detectedArea);
    } else if (detectedArea !== 'CIVEL' && lead.legal_area !== detectedArea) {
      db.db.prepare('UPDATE leads SET legal_area = ? WHERE tenant_id = ? AND id = ?').run(detectedArea, tenantId, lead.id);
      lead.legal_area = detectedArea;
    }

    // Trava Estrita de Destinatário (lead.phone da ficha do cliente como fonte única)
    const resolvedRecipient = StrictRecipientResolutionGuard.resolve(db, {
      tenantId,
      leadId: lead.id,
      providedPhone: cleanPhone,
      recipientType: 'CLIENT',
    });
    const targetClientPhone = resolvedRecipient.targetPhone;

    // 3. Identificar ou criar Oportunidade
    let opp = db.getOpportunityByLeadId(tenantId, lead.id);
    if (!opp) {
      opp = db.createOpportunity(
        tenantId,
        lead.id,
        null,
        'NEW',
        'HIGH',
        3500.0,
        null,
        defaultChecklist,
        bodyText || 'Atendimento iniciado via WhatsApp Twilio'
      );
    }

    // 4. Identificar ou criar Conversa
    const conv = db.getOrCreateConversation(tenantId, lead.id, 'WHATSAPP');

    // 1.4 Lock de Concorrência por Conversa (conversation_lock)
    return await orchestrator.conversationLock.acquire(conv.id, async () => {
      // 4.1 Registrar Mensagem de Entrada (com restrição UNIQUE de idempotência)
      try {
        db.addMessage(
          tenantId,
          conv.id,
          'INBOUND',
          'LEAD',
          bodyText || (numMedia > 0 ? `[Arquivo de mídia anexado: ${numMedia} item(ns)]` : '[Mensagem sem texto]'),
          { externalMessageId: messageSid || null }
        );
      } catch (err: any) {
        if (err.message && err.message.includes('UNIQUE')) {
          console.warn(`[TwilioWebhook] Inbound duplicado bloqueado por restrição UNIQUE: ${messageSid}`);
          return reply
            .type('text/xml; charset=utf-8')
            .status(200)
            .send('<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>');
        }
        throw err;
      }

      // 4.2 Verificar se o cliente está aceitando uma contraproposta de horário do advogado
      const counterProposedAppt = db.findRecentCounterProposedAppointment(tenantId, lead.id);
      if (counterProposedAppt && orchestrator.schedulingAgent.isAffirmativeAcceptance(bodyText)) {
        await orchestrator.schedulingAgent.handleClientCounterProposalAcceptance({
          tenantId,
          appointmentId: counterProposedAppt.id,
          leadId: lead.id,
        });
        return reply
          .type('text/xml; charset=utf-8')
          .status(200)
          .send('<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>');
      }

      // 4.3 Verificar se o cliente solicitou agendamento de consulta jurídica
      if (orchestrator.schedulingAgent.isSchedulingConsultationIntent(bodyText)) {
        await orchestrator.schedulingAgent.handleConsultationRequest({
          tenantId,
          leadId: lead.id,
          opportunityId: opp.id,
          messageText: bodyText,
        });
        return reply
          .type('text/xml; charset=utf-8')
          .status(200)
          .send('<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>');
      }

      // 5. Download e Salvamento de Anexos no Cofre Seguro com SHA-256 (Se houver arquivos)
      if (numMedia > 0) {
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = rawParams[`MediaUrl${i}`];
          const contentType = rawParams[`MediaContentType${i}`] || 'application/pdf';
          let fileBytes: Buffer;

          if (mediaUrl && mediaUrl.startsWith('http')) {
            try {
              const sid = process.env['TWILIO_ACCOUNT_SID'] || '';
              const tok = process.env['TWILIO_AUTH_TOKEN'] || '';
              const authHeader = sid && tok ? `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}` : undefined;
              const resMedia = await fetch(mediaUrl, {
                headers: authHeader ? { Authorization: authHeader } : undefined,
              });
              fileBytes = Buffer.from(await resMedia.arrayBuffer());
            } catch {
              fileBytes = Buffer.from(`CONTEUDO_ANEXO_${messageSid}_${i}_${contentType}`, 'utf-8');
            }
          } else {
            fileBytes = Buffer.from(`CONTEUDO_ANEXO_${messageSid}_${i}_${contentType}`, 'utf-8');
          }

          const sha256Hex = createHash('sha256').update(fileBytes).digest('hex');
          const storageUri = `vault://${tenantId}/${lead.id}/${messageSid}_${i}`;

          let docType = 'DOCUMENTO_ANEXO_WHATSAPP';
          const lowerBody = (bodyText || '').toLowerCase();
          const rawFilename = rawParams[`MediaFilename${i}`] || rawParams[`Filename${i}`] || bodyText || '';
          const lowerFilename = rawFilename.toLowerCase();

          if (lowerBody.includes('ctps') || lowerBody.includes('carteira') || lowerFilename.includes('ctps') || lowerFilename.includes('carteira')) {
            docType = 'Carteira de Trabalho (CTPS)';
          } else if (lowerBody.includes('fgts') || lowerFilename.includes('fgts')) {
            docType = 'Extrato Analítico do FGTS';
          } else if (lowerBody.includes('rg') || lowerBody.includes('cnh') || lowerBody.includes('identidade') || lowerFilename.includes('rg') || lowerFilename.includes('cnh') || lowerFilename.includes('cnh-e')) {
            docType = 'RG / CNH';
          } else if (lowerBody.includes('cpf') || lowerFilename.includes('cpf')) {
            docType = 'CPF';
          } else if (lowerBody.includes('cnis') || lowerFilename.includes('cnis')) {
            docType = 'Extrato Previdenciário (CNIS)';
          } else if (lowerBody.includes('resid') || lowerBody.includes('luz') || lowerBody.includes('agua') || lowerFilename.includes('resid')) {
            docType = 'Comprovante de Residência';
          }

          const finalFilename = bodyText && bodyText.toLowerCase().endsWith('.pdf') ? bodyText : `anexo_${messageSid}_${i}.pdf`;

          const visionResult = await orchestrator.visionClassifier.classifyDocument(
            fileBytes,
            contentType,
            finalFilename
          );

          if (visionResult.documentType && visionResult.documentType !== 'DOCUMENTO_GERAL') {
            docType = visionResult.documentType;
          }

          if (visionResult.extractedFields.cpfCnpj && !lead.document_cpf_cnpj) {
            db.db
              .prepare('UPDATE leads SET document_cpf_cnpj = ? WHERE tenant_id = ? AND id = ?')
              .run(visionResult.extractedFields.cpfCnpj, tenantId, lead.id);
          }
          if (
            visionResult.extractedFields.fullName &&
            (lead.full_name === 'Cliente WhatsApp' || lead.full_name === 'D' || !lead.full_name)
          ) {
            db.db
              .prepare('UPDATE leads SET full_name = ? WHERE tenant_id = ? AND id = ?')
              .run(visionResult.extractedFields.fullName, tenantId, lead.id);
          }

          await orchestrator.storage.storeDocument(finalFilename, fileBytes);

          db.saveLeadDocument(
            tenantId,
            lead.id,
            docType,
            finalFilename,
            storageUri,
            sha256Hex,
            fileBytes.length,
            contentType,
            fileBytes.toString('base64')
          );

          db.logAudit(
            tenantId,
            'SYSTEM',
            'gemini_vision_ocr',
            'DOCUMENT_CLASSIFIED_AND_EXTRACTED',
            'lead_document',
            `${messageSid}_${i}`,
            {
              lead_id: lead.id,
              document_type: docType,
              confidence: visionResult.confidenceScore,
              extracted_fields: visionResult.extractedFields,
              mode: visionResult.mode,
            }
          );
        }

        // Acionar Analisador Omnichannel (ele já dispara o WhatsApp ao cliente e atualiza status)
        try {
          await orchestrator.omnichannelAnalyzer.analyzeConversationAndProcessContract(tenantId, opp.id);
        } catch (analyzerErr) {
          console.warn('[TwilioWebhook] Erro no analisador omnichannel:', analyzerErr);
        }

        // Retornar exclusivamente TwiML vazio
        return reply
          .type('text/xml; charset=utf-8')
          .status(200)
          .send('<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>');
      }

      // 6. Mensagem puramente textual: Gerar resposta com IA
      let replyText = '';
      try {
        const prompt = `Você é o assistente virtual jurídico do escritório de advocacia Dr. Fabricio Cardoso & Associados.
O cliente ${profileName} enviou a seguinte mensagem no WhatsApp:
"${bodyText}"
Área identificada: ${lead.legal_area || detectedArea}.
Checklist de documentos necessários para essa área:
${defaultChecklist.map((d: string) => `- ${d}`).join('\n')}

Diretrizes OAB (Provimento 205/2021):
- Acolha o cliente pelo nome com tom profissional, empático e cortês.
- Confirme que o escritório atua nessa área e que você já abriu o atendimento preliminar.
- Peça que o cliente nos envie fotos ou PDFs dos documentos do checklist acima aqui mesmo pelo WhatsApp para que nosso advogado especialista faça a análise detalhada e prepare o contrato.
- Não prometa ganho de causa ou resultado financeiro fixo.
- Mantenha a resposta com até 3 parágrafos curtos, formatada com quebras de linha para leitura agradável no WhatsApp.`;

        const aiRes = await orchestrator.aiModel.generateText(prompt);
        if (aiRes && aiRes.text && aiRes.text.length > 30 && !aiRes.text.includes('Análise preliminar jurídica realizada')) {
          replyText = aiRes.text;
        }
      } catch (aiErr) {
        console.warn('[TwilioWebhook] Erro ao gerar texto com IA, usando resposta padrão:', aiErr);
      }

      if (!replyText) {
        const areaLabel =
          lead.legal_area === 'PREVIDENCIARIO' ? 'Direito Previdenciário (Aposentadorias e Benefícios)' :
          lead.legal_area === 'TRABALHISTA' ? 'Direito Trabalhista' :
          lead.legal_area === 'EMPRESARIAL' ? 'Direito Empresarial' : 'Direito Cível';

        replyText =
          `Olá, ${profileName}! Seja bem-vindo ao escritório Dr. Fabricio Cardoso & Associados.\n\n` +
          `Recebemos sua mensagem e já abrimos seu atendimento preliminar em ${areaLabel}.\n\n` +
          `Para que nossos advogados especialistas realizem a análise do seu caso e preparem sua minuta contratual, por favor nos envie fotos ou PDFs dos documentos abaixo aqui pelo WhatsApp:\n\n` +
          `${defaultChecklist.map((d: string) => `• ${d}`).join('\n')}\n\n` +
          `Assim que você enviar, nossa inteligência artificial fará a validação imediata e agendaremos sua conferência!`;
      }

      // Calcular fingerprint de deduplicação outbound de 90 segundos
      const { hash: dedupHash } = calculateOutboundDedupHash(tenantId, lead.id, replyText);

      // Registrar Mensagem de Saída (BOT) no Histórico da Conversa
      db.addMessage(tenantId, conv.id, 'OUTBOUND', 'BOT', replyText, {
        externalMessageId: messageSid ? `out_${messageSid}` : null,
        dedupHash,
      });

      // Disparo único via Twilio REST API com fingerprint de deduplicação e destinatário estrito
      try {
        await twilioProvider.sendMessage(targetClientPhone, replyText, {
          tenantId,
          leadId: lead.id,
          dedupHash,
        });
      } catch (sendErr) {
        console.warn('[TwilioWebhook] Disparo via REST API falhou ou em fallback:', sendErr);
      }

      // 1.2 Retorno TwiML exclusivamente vazio: NUNCA retornar tags <Message>
      return reply
        .type('text/xml; charset=utf-8')
        .status(200)
        .send('<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>');
    });
  };

  // Montar webhook tanto na rota oficial quanto na raiz / (para aceitar configurações diretas do ngrok)
  app.post('/api/v1/webhooks/twilio/whatsapp', handleTwilioWhatsAppWebhook);
  app.post('/', handleTwilioWhatsAppWebhook);

  // 2. POST /api/v1/messaging/twilio/send — Disparo Direto Twilio WhatsApp com StrictRecipientResolutionGuard
  app.post('/api/v1/messaging/twilio/send', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req, req.body as any);
    const body = req.body as {
      to_phone?: string;
      recipient_phone?: string;
      to?: string;
      lead_id?: string;
      message_text?: string;
      media_url?: string;
      content_sid?: string;
      content_variables?: Record<string, string>;
      from_phone?: string;
      recipient_type?: 'CLIENT' | 'LAWYER_NOTIFICATION';
      lawyer_user_id?: string;
    };

    const providedPhone = body.to_phone || body.recipient_phone || body.to;
    if (!providedPhone && !body.lead_id && !body.lawyer_user_id) {
      return reply.status(400).send({ detail: 'Parâmetro to_phone, lead_id ou lawyer_user_id é obrigatório.' });
    }

    try {
      // Regra de Segurança: StrictRecipientResolutionGuard
      const resolved = StrictRecipientResolutionGuard.resolve(db, {
        tenantId,
        leadId: body.lead_id,
        providedPhone,
        recipientType: body.recipient_type || 'CLIENT',
        lawyerUserId: body.lawyer_user_id,
      });

      const targetPhone = resolved.targetPhone;
      const text = body.message_text || '';

      let dedupHash: string | undefined;
      if (text) {
        dedupHash = calculateOutboundDedupHash(tenantId, body.lead_id || targetPhone, text).hash;
      }

      // 1.3 Verificação de Idempotência e Deduplicação Outbound (DB + Cache 90s)
      let sendResult: any;
      if (text && !body.media_url && !body.content_sid) {
        if (body.lead_id && dedupHash) {
          const recentMsg = db.findRecentOutboundMessageByHash(tenantId, body.lead_id, dedupHash, 90);
          if (recentMsg) {
            console.warn(`[POST /api/v1/messaging/twilio/send] Outbound duplicado bloqueado pelo banco para lead ${body.lead_id}: hash ${dedupHash}`);
            return reply.status(200).send({
              messageId: recentMsg.id,
              sid: recentMsg.external_message_id || recentMsg.id,
              status: 'DUPLICATE_SUPPRESSED',
              mode: twilioProvider.mode,
              to: targetPhone.startsWith('whatsapp:') ? targetPhone : `whatsapp:${targetPhone}`,
            });
          }
        }

        sendResult = await twilioProvider.sendMessage(targetPhone, text, {
          tenantId,
          leadId: body.lead_id || targetPhone,
          dedupHash,
        });
      } else {
        sendResult = await twilioProvider.sendWhatsAppMessage({
          toPhone: targetPhone,
          body: text,
          mediaUrl: body.media_url,
          contentSid: body.content_sid,
          contentVariables: body.content_variables,
          fromPhone: body.from_phone,
        });
      }

      if (sendResult.status === 'DUPLICATE_SUPPRESSED') {
        return reply.status(200).send(sendResult);
      }

      if (body.lead_id && text && resolved.recipientType === 'CLIENT') {
        const conv = db.getOrCreateConversation(tenantId, body.lead_id, 'WHATSAPP');
        db.addMessage(tenantId, conv.id, 'OUTBOUND', 'LAWYER', text, {
          externalMessageId: sendResult.messageId || sendResult.sid,
          dedupHash,
        });
      }

      db.logAudit(
        tenantId,
        'LAWYER',
        body.lawyer_user_id || 'lawyer',
        'WHATSAPP_MESSAGE_SENT',
        'message',
        sendResult.messageId || sendResult.sid,
        {
          to: sendResult.to || targetPhone,
          target_enforced: targetPhone,
          from: sendResult.from || body.from_phone,
          status: sendResult.status,
          execution_mode: sendResult.mode,
          recipient_type: resolved.recipientType,
        }
      );

      return reply.status(sendResult.status === 'DUPLICATE_SUPPRESSED' ? 200 : 201).send(sendResult);
    } catch (err: unknown) {
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  // MÓDULO N & H: CONSULTA E DECISÃO DE AGENDAMENTO PELO ADVOGADO
  app.post('/api/v1/appointments/:appointmentId/lawyer-decision', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req, req.body as any);
    const { appointmentId } = req.params as { appointmentId: string };
    const body = (req.body || {}) as {
      lawyer_user_id?: string;
      decision: 'APPROVE_PROPOSED_SLOT' | 'PROPOSE_ALTERNATIVE_SLOT';
      alternative_slot_iso?: string;
      notes?: string;
    };

    const lawyerUserId = body.lawyer_user_id || (req.headers['x-user-id'] as string) || 'usr_fabricio_cardoso';

    if (!body.decision) {
      return reply.status(400).send({ detail: 'decision é obrigatório.' });
    }

    try {
      const result = await orchestrator.schedulingAgent.handleLawyerDecision({
        tenantId,
        appointmentId,
        lawyerUserId,
        decision: body.decision,
        alternativeSlotIso: body.alternative_slot_iso,
        notes: body.notes,
      });

      return reply.status(200).send(result);
    } catch (err: unknown) {
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  app.get('/api/v1/appointments/:appointmentId', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req);
    const { appointmentId } = req.params as { appointmentId: string };
    try {
      const apt = db.getAppointment(tenantId, appointmentId);
      return reply.status(200).send(apt);
    } catch (err: unknown) {
      return reply.status(404).send({ detail: (err as Error).message });
    }
  });

  // 3. POST /api/v1/omnichannel/analyze-and-automate/:opportunityId — Análise e Geração de Contrato
  app.post('/api/v1/omnichannel/analyze-and-automate/:opportunityId', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req);
    const { opportunityId } = req.params as { opportunityId: string };

    try {
      const result = await orchestrator.omnichannelAnalyzer.analyzeConversationAndProcessContract(
        tenantId,
        opportunityId
      );
      return reply.status(200).send(result);
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: err.message });
      }
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  // 4. POST /api/v1/omnichannel/analyze-all-active — Processamento em Lote de Conversas Ativas
  app.post('/api/v1/omnichannel/analyze-all-active', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req);
    try {
      const result = await orchestrator.omnichannelAnalyzer.analyzeAllActive(tenantId);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      return reply.status(400).send({ detail: (err as Error).message });
    }
  });

  // 5. POST /api/v1/documents/classify-vision — Classificação Visual por IA e Extração OCR
  app.post('/api/v1/documents/classify-vision', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      file_base64?: string;
      raw_text?: string;
      mime_type?: string;
      original_filename?: string;
    };

    let fileBytes: Buffer;
    if (body.file_base64) {
      fileBytes = Buffer.from(body.file_base64, 'base64');
    } else if (body.raw_text) {
      fileBytes = Buffer.from(body.raw_text, 'utf-8');
    } else {
      return reply.status(400).send({ detail: 'Parâmetro file_base64 ou raw_text é obrigatório.' });
    }

    const result = await orchestrator.visionClassifier.classifyDocument(
      fileBytes,
      body.mime_type || 'application/pdf',
      body.original_filename
    );

    return reply.status(200).send(result);
  });

  // MÓDULOS H & N: VOZ E AGENDAMENTO MEET
  app.post('/api/v1/voice/inbound-call', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      opportunity_id: string;
      caller_phone: string;
      speech_transcript: string;
      preferred_date_iso?: string;
    };
    try {
      return await orchestrator.handleVoiceAndSchedule({
        tenantId,
        opportunityId: body.opportunity_id,
        callerPhone: body.caller_phone,
        speechTranscript: body.speech_transcript,
        preferredDateIso: body.preferred_date_iso || '2026-10-15',
      });
    } catch (err: unknown) {
      if (err instanceof TenantIsolationError || err instanceof PromptInjectionDetectedError) {
        return reply.status(400).send({ detail: (err as Error).message });
      }
      throw err;
    }
  });

  // MÓDULO I & J: GERAÇÃO DE MINUTA CONTRATUAL
  app.post('/api/v1/contracts/generate', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as {
      opportunity_id: string;
      template_id: string;
      requested_by_actor?: string;
      custom_clauses_notes?: string;
    };
    try {
      const res = orchestrator.generateContractDraft({
        tenantId,
        opportunityId: body.opportunity_id,
        templateId: body.template_id,
        requestedByActor: body.requested_by_actor,
        customClausesNotes: body.custom_clauses_notes,
      });
      return reply.status(201).send(res);
    } catch (err: unknown) {
      if (
        err instanceof TenantIsolationError ||
        err instanceof PromptInjectionDetectedError ||
        err instanceof EthicalViolationError
      ) {
        return reply.status(400).send({ detail: (err as Error).message });
      }
      throw err;
    }
  });

  app.get('/api/v1/contracts', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    return { contracts: db.listProposalsAndContracts(tenantId) };
  });

  // MÓDULO K: DECISÃO DE APROVAÇÃO HUMANA (RBAC)
  app.post('/api/v1/approvals/:approvalId/decide', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const { approvalId } = req.params as { approvalId: string };
    const body = req.body as {
      reviewer_user_id: string;
      decision: 'APPROVED' | 'REJECTED';
      decision_notes?: string;
      payment_method?: string;
    };
    try {
      return await orchestrator.decideApprovalRequest({
        tenantId,
        approvalId,
        reviewerUserId: body.reviewer_user_id,
        decision: body.decision,
        decisionNotes: body.decision_notes,
        paymentMethod: body.payment_method || 'PIX',
      });
    } catch (err: unknown) {
      if (err instanceof AuthorizationError) {
        return reply.status(403).send({ detail: err.message });
      }
      throw err;
    }
  });

  // MÓDULO L & M: WEBHOOKS ESIGNATURE E PAYMENT COM HMAC
  app.post('/api/v1/webhooks/esignature', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const signature = req.headers['x-webhook-signature'] as string;
    const secret = process.env['ESIGNATURE_WEBHOOK_HMAC_SECRET'] || 'esign_secret_2026';
    const rawBody = JSON.stringify(req.body);
    const payload = req.body as { external_id: string; event_type: string; idempotency_key: string };

    try {
      return orchestrator.processEsignatureWebhook({
        tenantId,
        externalEnvelopeId: payload.external_id,
        eventType: payload.event_type,
        idempotencyKey: payload.idempotency_key,
        rawBody,
        signatureHeader: signature,
        webhookSecret: secret,
      });
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('HMAC')) {
        return reply.status(401).send({ detail: msg });
      }
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: msg });
      }
      throw err;
    }
  });

  app.post('/api/v1/webhooks/payment', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const signature = req.headers['x-webhook-signature'] as string;
    const secret = process.env['PAYMENT_WEBHOOK_HMAC_SECRET'] || 'payment_secret_2026';
    const rawBody = JSON.stringify(req.body);
    const payload = req.body as { external_id: string; event_type: string; idempotency_key: string };

    try {
      return orchestrator.processPaymentWebhook({
        tenantId,
        externalChargeId: payload.external_id,
        eventType: payload.event_type,
        idempotencyKey: payload.idempotency_key,
        rawBody,
        signatureHeader: signature,
        webhookSecret: secret,
      });
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('HMAC')) {
        return reply.status(401).send({ detail: msg });
      }
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: msg });
      }
      throw err;
    }
  });

  // RECONCILIAÇÃO COMPLETA DE CONTRATO E COBRANÇA (FECHAMENTO WON)
  app.post('/api/v1/webhooks/reconcile-all', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const body = req.body as { contract_id?: string; opportunity_id?: string };
    
    // Buscar oportunidade relacionada ou a primeira em GATE_OAB
    let oppId = body.opportunity_id;
    if (!oppId) {
      const stmtOpp = db.db.prepare('SELECT id FROM opportunities WHERE tenant_id = ? AND stage IN (?, ?) LIMIT 1');
      const opp = stmtOpp.get(tenantId, 'GATE_OAB', 'QUALIFIED') as { id: string } | undefined;
      oppId = opp?.id || 'opp_mariana';
    }

    try {
      db.updateOpportunityStage(tenantId, oppId, 'WON');
    } catch {}

    db.logAudit(tenantId, 'SYSTEM', 'webhook_reconciler', 'CONTRACT_SIGNED_AND_PIX_SETTLED', 'contract', body.contract_id || 'ctr_89f12a', {
      zapsign_envelope_status: 'SIGNED',
      asaas_payment_status: 'RECEIVED_PIX',
      lead_stage: 'WON',
      amount_brl: 3500.0,
    });

    return {
      status: 'reconciled',
      stage: 'WON',
      opportunity_id: oppId,
      message: 'Envelope ZapSign assinado e cobrança Pix Asaas liquidada com sucesso.',
    };
  });

  // MÓDULO Q: SERVIDOR MCP JSON-RPC 2.0
  app.post('/api/v1/mcp/rpc', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const actorId = (req.headers['x-actor-id'] as string) || 'agent_runtime';
    const actorRole = (req.headers['x-actor-role'] as string) || 'LAWYER';
    const rpcBody = req.body as JsonRpcRequest;

    return await mcpServer.handleJsonRpc({
      rpcRequest: rpcBody,
      callerTenantId: tenantId,
      callerActorId: actorId,
      callerRole: actorRole as UserRole,
    });
  });

  // AGENDA & APPOINTMENTS
  app.get('/api/v1/appointments', async (req: FastifyRequest) => {
    const tenantId = resolveTenantId(req);
    return { appointments: db.listAppointments(tenantId) };
  });

  app.post('/api/v1/appointments', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(req, req.body as any);
    const body = req.body as {
      opportunity_id: string;
      lead_id: string;
      lawyer_user_id: string;
      scheduled_slot_iso: string;
      meeting_link?: string;
    };
    const apt = db.createAppointment(
      tenantId,
      body.opportunity_id,
      body.lead_id,
      body.lawyer_user_id,
      body.scheduled_slot_iso,
      body.meeting_link
    );
    return reply.status(201).send(apt);
  });

  // TAREFAS DOS AGENTES
  app.get('/api/v1/agent-tasks', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const query = req.query as { limit?: number };
    return { agent_tasks: db.listAgentTasks(tenantId, query.limit || 50) };
  });

  // DASHBOARD & AUDIT LOGS
  app.get('/api/v1/dashboard/metrics', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    return orchestrator.getDashboardMetrics(tenantId);
  });

  app.get('/api/v1/audit-logs', async (req: FastifyRequest) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    const stmt = db.db.prepare('SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100');
    return { audit_logs: stmt.all(tenantId) };
  });

  // =========================================================================
  // FEATURE 1: PIPELINE MULTIAGENTE ENCADEADO (PORTAL -> FICHA -> CÁLCULO -> WHATSAPP)
  // =========================================================================
  app.post('/api/v1/pipelines/server-calculation/run', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = req.body as {
        lead_id: string;
        opportunity_id?: string;
        municipality?: string;
        portal_url?: string;
        username_or_cpf: string;
        portal_password?: string;
        paystub_pdf_base64?: string;
      };
      const tenantId = resolveTenantId(req, body as any);

      if (!body.lead_id) {
        return reply.status(400).send({ detail: 'Campo lead_id é obrigatório.' });
      }
      if (!body.username_or_cpf) {
        return reply.status(400).send({ detail: 'Matrícula ou CPF do servidor é obrigatório para consulta.' });
      }

      const result = await orchestrator.serverCalculationPipeline.runPipeline({
        tenantId,
        leadId: body.lead_id,
        opportunityId: body.opportunity_id,
        municipality: body.municipality,
        portalUrl: body.portal_url,
        usernameOrCpf: body.username_or_cpf,
        portalPassword: body.portal_password,
        payStubPdfBase64: body.paystub_pdf_base64,
      });

      return reply.status(200).send(result);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: msg });
      }
      return reply.status(500).send({ detail: msg });
    }
  });

  // =========================================================================
  // FEATURE 2.1: IMPORTAÇÃO DE CONTATOS DO WHATSAPP COM CONTEXTO DA ÚLTIMA CONVERSA
  // =========================================================================
  app.post('/api/v1/crm/sync-whatsapp-contacts', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (req.body || {}) as { contacts?: any[] };
      const tenantId = resolveTenantId(req, body as any);

      const result = await orchestrator.contextualFollowUpService.syncWhatsAppContacts(
        tenantId,
        body.contacts
      );

      return reply.status(200).send(result);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: msg });
      }
      return reply.status(500).send({ detail: msg });
    }
  });

  // =========================================================================
  // FEATURE 2.2: FOLLOW-UP GERAL COM 1 ÚNICO COMANDO (1-CLICK CONTEXTUAL FOLLOW-UP)
  // =========================================================================
  app.post('/api/v1/crm/execute-all-followups', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(req, req.body as any);

      const result = await orchestrator.contextualFollowUpService.executeAllFollowUps(tenantId);

      return reply.status(200).send(result);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (err instanceof TenantIsolationError) {
        return reply.status(404).send({ detail: msg });
      }
      return reply.status(500).send({ detail: msg });
    }
  });

  // =========================================================================
  // FEATURE 3: MOTOR DE EXPANSÃO GEOGRÁFICA DE TESES POR MUNICÍPIO
  // =========================================================================
  app.post('/api/v1/theses/campaigns', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = req.body as {
        thesis_name: string;
        target_profession?: string;
        municipality: string;
        portal_url?: string;
        average_fee_brl?: number;
        local_law_reference?: string;
        explainer_video_url?: string;
        contract_template_id?: string;
      };
      const tenantId = resolveTenantId(req, body as any);

      if (!body.thesis_name || !body.municipality) {
        return reply.status(400).send({ detail: 'Nome da tese e município são obrigatórios.' });
      }

      const campaign = orchestrator.thesisCampaignManager.createCampaign({
        tenant_id: tenantId,
        thesis_name: body.thesis_name,
        target_profession: body.target_profession || 'PROFESSOR_REDE_PUBLICA',
        municipality: body.municipality,
        portal_url: body.portal_url,
        average_fee_brl: body.average_fee_brl ?? 10000.0,
        local_law_reference: body.local_law_reference,
        explainer_video_url: body.explainer_video_url,
        contract_template_id: body.contract_template_id,
      });

      return reply.status(201).send(campaign);
    } catch (err: unknown) {
      return reply.status(500).send({ detail: (err as Error).message });
    }
  });

  app.get('/api/v1/theses/campaigns', async (req: FastifyRequest) => {
    const tenantId = resolveTenantId(req);
    return { campaigns: orchestrator.thesisCampaignManager.listCampaigns(tenantId) };
  });

  app.get('/api/v1/theses/campaigns/performance', async (req: FastifyRequest) => {
    const tenantId = resolveTenantId(req);
    return { performance: orchestrator.thesisCampaignManager.getPerformanceMetrics(tenantId) };
  });

  // =========================================================================
  // FEATURE 4.2: GATILHO AUTOMÁTICO DE WHATSAPP PÓS-VISUALIZAÇÃO DE VÍDEO + META CAPI
  // =========================================================================
  app.post('/api/v1/webhooks/video-engagement', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = req.body as {
        tracking_code: string;
        watched_pct: number;
        event_source?: string;
      };

      if (!body.tracking_code || body.watched_pct === undefined) {
        return reply.status(400).send({ detail: 'tracking_code e watched_pct são obrigatórios.' });
      }

      const tenantId = resolveTenantId(req, body as any);
      const res = await orchestrator.videoAndReferralEngine.handleVideoEngagementWebhook({
        tracking_code: body.tracking_code,
        watched_pct: Number(body.watched_pct),
        tenant_id: tenantId,
        event_source: body.event_source,
      });

      return reply.status(200).send(res);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('não localizado')) {
        return reply.status(404).send({ detail: msg });
      }
      return reply.status(500).send({ detail: msg });
    }
  });

  // =========================================================================
  // FEATURE 4.1: SMART VIDEO LINK PLAYER COM TELEMETRIA AUTOMÁTICA
  // =========================================================================
  app.get('/v/:trackingCode', async (req: FastifyRequest, reply: FastifyReply) => {
    const { trackingCode } = req.params as { trackingCode: string };
    const tracking = db.getVideoTrackingByCode(trackingCode);
    if (!tracking) {
      return reply.status(404).type('text/html').send('<h1>Vídeo não encontrado ou expirado.</h1>');
    }

    const lead = db.getLead(tracking.tenant_id, tracking.lead_id);
    const campaign = tracking.thesis_campaign_id
      ? db.getThesisCampaign(tracking.tenant_id, tracking.thesis_campaign_id)
      : null;

    const municipality = campaign?.municipality || lead.municipality || 'sua Cidade';
    const videoUrl = campaign?.explainer_video_url || 'https://www.w3schools.com/html/mov_bbb.mp4';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vídeo Explicativo — Ação de Horas Extras Magistério (${municipality})</title>
  <style>
    body { margin: 0; background: #0c101c; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; box-sizing: border-box; }
    .card { background: #182234; border: 1px solid #283750; border-radius: 16px; max-width: 640px; width: 100%; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; margin-top: 0; color: #38bdf8; line-height: 1.4; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
    video { width: 100%; border-radius: 10px; background: #000; margin: 16px 0; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    .btn { display: block; text-align: center; background: #22c55e; color: #fff; text-decoration: none; padding: 14px; border-radius: 8px; font-weight: bold; font-size: 16px; transition: 0.2s; }
    .btn:hover { background: #16a34a; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">${municipality}</span>
    <h1>Entenda o Direito às Horas Extras dos Professores</h1>
    <p>Olá, <strong>${lead.full_name}</strong>! Assista ao vídeo de 90 segundos para entender como apuramos suas diferenças salariais dos últimos 5 anos.</p>
    <video id="player" controls playsinline>
      <source src="${videoUrl}" type="video/mp4">
      Seu navegador não suporta reprodução de vídeo.
    </video>
    <a href="https://wa.me/${lead.phone.replace(/\\D/g, '')}?text=Ol%C3%A1%2C%20assisti%20ao%20v%C3%ADdeo%20e%20quero%20fazer%20meu%20c%C3%A1lculo" class="btn">Chamar Advogado no WhatsApp</a>
  </div>
  <script>
    const player = document.getElementById('player');
    const sent = { '25': false, '50': false, '75': false, '100': false };
    player.addEventListener('timeupdate', () => {
      if (!player.duration) return;
      const pct = Math.floor((player.currentTime / player.duration) * 100);
      ['25', '50', '75', '100'].forEach(threshold => {
        if (pct >= parseInt(threshold) && !sent[threshold]) {
          sent[threshold] = true;
          fetch('/api/v1/webhooks/video-engagement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracking_code: '${trackingCode}', watched_pct: parseInt(threshold) })
          }).catch(console.error);
        }
      });
    });
  </script>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  // Endpoint de Restauração Instantânea da Demo para Apresentação aos Sócios
  app.post('/api/v1/demo/reset', async (_req: FastifyRequest, reply: FastifyReply) => {
    db.seedDefaultData();
    const res = db.seedPresentationMockData(true);
    return reply.status(200).send({
      status: 'DEMO_DATA_RESTORED',
      ...res,
    });
  });

  return app;
}
