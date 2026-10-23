/**
 * Módulo de Segurança, RBAC, Anti-Prompt Injection e Conformidade Ética OAB (TypeScript)
 * Cobre Módulos A, B, K e O da Plataforma Law.AI
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '../types/index.js';

export class TenantIsolationError extends Error {
  constructor(message: string = 'Contexto tenant_id é obrigatório para todas as operações.') {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string = 'Acesso não autorizado para o perfil solicitado.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class EthicalViolationError extends Error {
  constructor(message: string = 'Violação ética detectada conforme Provimento 205/2021 da OAB.') {
    super(message);
    this.name = 'EthicalViolationError';
  }
}

export class PromptInjectionDetectedError extends Error {
  constructor(message: string = 'Tentativa de Prompt Injection detectada e bloqueada.') {
    super(message);
    this.name = 'PromptInjectionDetectedError';
  }
}

export interface TokenPayload {
  sub: string;
  tenant_id: string;
  role: UserRole;
  oab_number?: string | null;
  exp: number;
}

export class AuthAndRbacManager {
  private static readonly ROLE_PERMISSIONS: Record<UserRole, string[]> = {
    SUPER_ADMIN: ['*'],
    TENANT_ADMIN: [
      'tenant:manage',
      'users:manage',
      'services:manage',
      'templates:manage',
      'crm:read',
      'crm:write',
      'contracts:generate',
      'contracts:approve',
      'finance:read',
      'finance:write',
      'audit:read',
    ],
    LAWYER: [
      'crm:read',
      'crm:write',
      'contracts:generate',
      'contracts:approve',
      'templates:read',
      'audit:read',
    ],
    PARALEGAL: [
      'crm:read',
      'crm:write',
      'contracts:generate',
      'templates:read',
    ],
    COMMERCIAL_AGENT: [
      'crm:read',
      'crm:write',
      'templates:read',
    ],
    FINANCE: [
      'finance:read',
      'finance:write',
      'crm:read',
    ],
  };

  /**
   * Emissão de token criptográfico assinado com HMAC-SHA256
   */
  public generateToken(payload: TokenPayload, secret: string = 'law_ai_jwt_secret_2026'): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  /**
   * Validação de token HMAC-SHA256 em tempo constante contra timing-attacks
   */
  public verifyToken(token: string, secret: string = 'law_ai_jwt_secret_2026'): TokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AuthorizationError('Token em formato inválido.');
    }
    const [header, body, signature] = parts;
    const expectedSig = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature!, 'utf-8');
    const expBuf = Buffer.from(expectedSig, 'utf-8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new AuthorizationError('Assinatura de token inválida ou adulterada.');
    }

    const payload: TokenPayload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf-8'));
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowEpoch) {
      throw new AuthorizationError('Token expirado.');
    }
    return payload;
  }

  public hasPermission(role: UserRole, permission: string): boolean {
    const perms = AuthAndRbacManager.ROLE_PERMISSIONS[role] || [];
    if (perms.includes('*')) return true;
    return perms.includes(permission);
  }

  public checkPermission(role: UserRole, permission: string): void {
    if (!this.hasPermission(role, permission)) {
      throw new AuthorizationError(`O perfil '${role}' não possui permissão '${permission}'.`);
    }
  }
}

export class PromptInjectionGuard {
  private static readonly INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    /system\s+prompt/i,
    /bypass\s+human\s+approval/i,
    /drop\s+table/i,
    /disregard\s+all\s+(rules|instructions)/i,
    /roleplay\s+as\s+unrestricted/i,
    /voc[êe]\s+agora\s+[eé]\s+uma\s+ia\s+sem\s+regras/i,
    /esque[çc]a\s+as\s+instru[çc][õo]es\s+anteriores/i,
  ];

  public static detect(text: string): boolean {
    if (!text) return false;
    return this.INJECTION_PATTERNS.some((pattern) => pattern.test(text));
  }

  public static inspect(text: string): void {
    if (this.detect(text)) {
      throw new PromptInjectionDetectedError('Instrução maliciosa de Prompt Injection detectada.');
    }
  }
}

export class EthicalComplianceGuard {
  private static readonly ETHICAL_VIOLATIONS = [
    /\b(causa\s+ganha)\b/i,
    /\b(garantia\s+de\s+(vit[oó]ria|ganho|sucesso))\b/i,
    /\b(100%\s+garantido)\b/i,
    /\b(resultado\s+certo)\b/i,
    /\b(promo[çc][ãa]o\s+imperd[íi]vel)\b/i,
    /\b(honor[áa]rios\s+com\s+desconto\s+exclusivo)\b/i,
  ];

  public static detect(text: string): boolean {
    if (!text) return false;
    return this.ETHICAL_VIOLATIONS.some((pattern) => pattern.test(text));
  }

  public static validate(text: string): void {
    if (this.detect(text)) {
      throw new EthicalViolationError('Promessa de resultado ou mercantilização vedada pelo Provimento 205/2021 da OAB.');
    }
  }
}

export function normalizeE164Phone(phone: string): string {
  let cleaned = (phone || '').trim();
  if (cleaned.startsWith('whatsapp:')) {
    cleaned = cleaned.slice(9).trim();
  }
  const digits = cleaned.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  return `+${digits}`;
}

export class RecipientMismatchError extends Error {
  constructor(message: string = 'Destinatário informado diverge do WhatsApp cadastrado na ficha do cliente.') {
    super(message);
    this.name = 'RecipientMismatchError';
  }
}

export interface StrictRecipientParams {
  tenantId: string;
  leadId?: string;
  providedPhone?: string;
  recipientType?: 'CLIENT' | 'LAWYER_NOTIFICATION';
  lawyerUserId?: string;
}

/**
 * Trava Estrita de Destinatário (StrictRecipientResolutionGuard):
 * Garante que mensagens direcionadas ao cliente usem EXCLUSIVAMENTE o WhatsApp gravado
 * na ficha do cliente (lead.phone), bloqueando e sobrescrevendo números divergentes.
 */
export class StrictRecipientResolutionGuard {
  public static resolve(
    db: any,
    params: StrictRecipientParams
  ): { targetPhone: string; enforcedLeadPhone?: string; recipientType: 'CLIENT' | 'LAWYER_NOTIFICATION' } {
    const recipientType = params.recipientType || 'CLIENT';

    if (recipientType === 'LAWYER_NOTIFICATION') {
      if (params.lawyerUserId) {
        const user = db.getUser(params.tenantId, params.lawyerUserId);
        if (user && user.phone) {
          return { targetPhone: normalizeE164Phone(user.phone), recipientType };
        }
      }
      if (params.providedPhone) {
        return { targetPhone: normalizeE164Phone(params.providedPhone), recipientType };
      }
      throw new Error('Telefone do advogado responsável não informado para notificação interna.');
    }

    // Default: CLIENT message
    if (params.leadId) {
      const lead = db.getLead(params.tenantId, params.leadId);
      if (!lead) {
        throw new TenantIsolationError(`Lead ${params.leadId} não encontrado no tenant ${params.tenantId}.`);
      }
      const canonicalPhone = normalizeE164Phone(lead.phone);
      if (params.providedPhone) {
        const providedNorm = normalizeE164Phone(params.providedPhone);
        if (providedNorm !== canonicalPhone) {
          console.warn(
            `[StrictRecipientResolutionGuard] Bloqueio de número divergente (${providedNorm}). Sobrescrevendo estritamente para o lead.phone da ficha (${canonicalPhone}).`
          );
        }
      }
      return {
        targetPhone: canonicalPhone,
        enforcedLeadPhone: canonicalPhone,
        recipientType: 'CLIENT',
      };
    }

    if (params.providedPhone) {
      const providedNorm = normalizeE164Phone(params.providedPhone);
      const leads = db.listLeads(params.tenantId, providedNorm);
      const matched = leads.find((l: any) => normalizeE164Phone(l.phone) === providedNorm);
      if (matched) {
        const canonicalPhone = normalizeE164Phone(matched.phone);
        return {
          targetPhone: canonicalPhone,
          enforcedLeadPhone: canonicalPhone,
          recipientType: 'CLIENT',
        };
      }
      return { targetPhone: providedNorm, recipientType: 'CLIENT' };
    }

    throw new Error('Parâmetros insuficientes para resolução de destinatário (leadId ou telefone ausente).');
  }
}

/**
 * Lock de Concorrência por Conversa (ConversationLockManager):
 * Impede que múltiplos webhooks ou mensagens simultâneas da mesma conversa
 * disparem múltiplos fluxos de processamento concorrentes na IA.
 */
export class ConversationLockManager {
  private activeLocks = new Map<string, Promise<void>>();

  public async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.activeLocks.has(key)) {
      try {
        await this.activeLocks.get(key);
      } catch {}
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.activeLocks.set(key, lockPromise);

    try {
      return await fn();
    } finally {
      this.activeLocks.delete(key);
      releaseLock();
    }
  }
}
