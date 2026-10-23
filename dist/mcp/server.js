/**
 * Servidor MCP (Model Context Protocol) JSON-RPC 2.0 (TypeScript)
 * Cobre Módulos Q, MCP Tools e Seções 7/8 da Arquitetura Law.AI
 */
import { PromptInjectionGuard } from '../security/guardrails.js';
export class LawAIMCPServer {
    orchestrator;
    static AVAILABLE_TOOLS = [
        {
            name: 'legal_catalog.list_services',
            description: 'Consulta o catálogo de serviços jurídicos e tabelas de honorários do escritório.',
            parameters: {
                type: 'object',
                properties: {
                    legal_area: { type: 'string', description: 'Área do direito (ex: TRABALHISTA, PREVIDENCIARIO)' },
                },
            },
            required_permission: 'crm:read',
        },
        {
            name: 'crm.get_lead_status',
            description: 'Consulta a situação, score e documentos de um lead no CRM.',
            parameters: {
                type: 'object',
                properties: {
                    lead_id: { type: 'string', description: 'ID do lead' },
                },
                required: ['lead_id'],
            },
            required_permission: 'crm:read',
        },
        {
            name: 'crm.batch_sync_from_conversations',
            description: 'Executa a sincronização em atacado do CRM a partir de comando em linguagem natural.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Instrução do advogado (ex: "Atualize todas as situações...")' },
                    followup_delay_hours: { type: 'number', description: 'Horas de intervalo para agendamento do follow-up' },
                },
                required: ['command'],
            },
            required_permission: 'crm:write',
        },
        {
            name: 'calendar.check_slots',
            description: 'Consulta disponibilidade de horários na agenda dos advogados especialistas.',
            parameters: {
                type: 'object',
                properties: {
                    target_date: { type: 'string', description: 'Data desejada (YYYY-MM-DD)' },
                },
            },
            required_permission: 'crm:read',
        },
        {
            name: 'contracts.prepare_draft_for_approval',
            description: 'Prepara minuta contratual com hash SHA-256 e submete para aprovação de advogado inscrito na OAB.',
            parameters: {
                type: 'object',
                properties: {
                    opportunity_id: { type: 'string', description: 'ID da oportunidade' },
                    template_id: { type: 'string', description: 'ID do modelo contratual' },
                },
                required: ['opportunity_id', 'template_id'],
            },
            required_permission: 'contracts:generate',
        },
        {
            name: 'finance.check_payment_status',
            description: 'Verifica o status de cobranças Pix Asaas associadas a contratos.',
            parameters: {
                type: 'object',
                properties: {
                    charge_id: { type: 'string', description: 'ID externo da cobrança' },
                },
                required: ['charge_id'],
            },
            required_permission: 'crm:read',
        },
    ];
    constructor(orchestrator) {
        this.orchestrator = orchestrator;
    }
    async handleJsonRpc(params) {
        const { rpcRequest, callerTenantId, callerRole = 'LAWYER' } = params;
        const reqId = rpcRequest.id ?? null;
        if (rpcRequest.jsonrpc !== '2.0') {
            return {
                jsonrpc: '2.0',
                id: reqId,
                error: { code: -32600, message: "Versão inválida: esperado jsonrpc: '2.0'." },
            };
        }
        try {
            if (rpcRequest.method === 'tools/list') {
                return {
                    jsonrpc: '2.0',
                    id: reqId,
                    result: {
                        tools: LawAIMCPServer.AVAILABLE_TOOLS.map((t) => ({
                            name: t.name,
                            description: t.description,
                            parameters: t.parameters,
                        })),
                    },
                };
            }
            if (rpcRequest.method === 'tools/call') {
                const toolName = rpcRequest.params?.['name'];
                const toolArgs = rpcRequest.params?.['arguments'] || {};
                const toolDef = LawAIMCPServer.AVAILABLE_TOOLS.find((t) => t.name === toolName);
                if (!toolDef) {
                    return {
                        jsonrpc: '2.0',
                        id: reqId,
                        error: { code: -32601, message: `Ferramenta MCP '${toolName}' não encontrada.` },
                    };
                }
                // 1. Verificação de Permissão RBAC
                this.orchestrator.authManager.checkPermission(callerRole, toolDef.required_permission);
                // 2. Proteção Cross-Tenant no MCP
                if (toolArgs['tenant_id'] && toolArgs['tenant_id'] !== callerTenantId) {
                    return {
                        jsonrpc: '2.0',
                        id: reqId,
                        error: {
                            code: -32001,
                            message: `TenantIsolationError: Tentativa de consulta a recurso do tenant '${toolArgs['tenant_id']}' bloqueada para o chamador '${callerTenantId}'.`,
                        },
                    };
                }
                // 3. Inspeção contra Prompt Injection em todos os argumentos string
                for (const val of Object.values(toolArgs)) {
                    if (typeof val === 'string') {
                        PromptInjectionGuard.inspect(val);
                    }
                }
                // 4. Execução da Ferramenta
                let toolResult;
                switch (toolName) {
                    case 'legal_catalog.list_services': {
                        const area = toolArgs['legal_area'];
                        const services = this.orchestrator.db.listLegalServices(callerTenantId, area);
                        toolResult = { services: services.map((s) => s.name) };
                        break;
                    }
                    case 'crm.get_lead_status': {
                        const leadId = toolArgs['lead_id'];
                        const lead = this.orchestrator.db.getLead(callerTenantId, leadId);
                        toolResult = {
                            lead_id: lead.id,
                            name: lead.full_name,
                            area: lead.legal_area,
                            score: lead.qualification_score,
                        };
                        break;
                    }
                    case 'crm.batch_sync_from_conversations': {
                        const command = toolArgs['command'];
                        const delay = toolArgs['followup_delay_hours'] || 24;
                        toolResult = this.orchestrator.batchSyncCrmFromTodayMessages({
                            tenantId: callerTenantId,
                            naturalLanguageCommand: command,
                            followupDelayHours: delay,
                        });
                        break;
                    }
                    case 'calendar.check_slots': {
                        toolResult = {
                            available_slots: [
                                '2026-10-15T14:30:00Z',
                                '2026-10-15T16:00:00Z',
                                '2026-10-16T10:00:00Z',
                            ],
                        };
                        break;
                    }
                    case 'contracts.prepare_draft_for_approval': {
                        const oppId = toolArgs['opportunity_id'];
                        const tplId = toolArgs['template_id'];
                        toolResult = this.orchestrator.generateContractDraft({
                            tenantId: callerTenantId,
                            opportunityId: oppId,
                            templateId: tplId,
                            requestedByActor: 'MCP_Agent',
                        });
                        break;
                    }
                    case 'finance.check_payment_status': {
                        const chargeId = toolArgs['charge_id'];
                        const charge = this.orchestrator.db.getPaymentChargeByExternalId(callerTenantId, chargeId);
                        toolResult = { charge_id: charge.external_id, status: charge.status, amount: charge.amount_brl };
                        break;
                    }
                    default:
                        toolResult = { status: 'UNKNOWN' };
                }
                return {
                    jsonrpc: '2.0',
                    id: reqId,
                    result: toolResult,
                };
            }
            return {
                jsonrpc: '2.0',
                id: reqId,
                error: { code: -32601, message: `Método '${rpcRequest.method}' não implementado.` },
            };
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            return {
                jsonrpc: '2.0',
                id: reqId,
                error: { code: -32000, message: errMsg },
            };
        }
    }
}
