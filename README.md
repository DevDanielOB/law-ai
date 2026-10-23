# Law.AI — Autonomous Legal Business Platform

Plataforma SaaS multi-tenant para advogados e escritórios de advocacia, focada em aquisição ética de clientes, triagem e qualificação por agentes de IA, CRM jurídico omnichannel, geração assistida de propostas/minutas com **Gate Obrigatório de Aprovação Humana (OAB)**, assinatura eletrônica (MP 2.200-2/2001 e Lei 14.063/2020) e conciliação automatizada de pagamentos (Pix/Boleto/Cartão).

## 1. Arquitetura e Estrutura do Projeto

```
.
├── AGENTS.md                        # Organização dos 10 Agentes de Engenharia + Agentes de Runtime
├── README.md                        # Documentação principal e guia rápido de execução
├── .env.example                     # Variáveis de ambiente documentadas (zero segredos expostos)
├── Dockerfile                       # Build de container da aplicação
├── docker-compose.yml               # Orquestração local/homologação (API + PostgreSQL 16 pgvector + Redis 7)
├── .github/workflows/ci.yml         # Pipeline de CI, varredura de segredos e testes automatizados
├── prisma/
│   └── schema.prisma                # Schema declarativo Prisma ORM para PostgreSQL + pgvector
├── docs/
│   ├── market-research.md           # Pesquisa competitiva 2026 verificada e Matriz de Funcionalidades
│   ├── architecture.md              # Diagramas de arquitetura, sequência, DER, API e custos
│   ├── connectors.md                # Conectores padronizados e especificação do Servidor MCP
│   ├── security-and-compliance.md   # Conformidade LGPD, Provimento 205/2021 OAB e segurança de IA
│   ├── roadmap.md                   # Roadmap de entrega em 6 fases com critérios de aceite
│   └── decisions/
│       └── 001-003-decisions.md     # Architecture Decision Records (ADRs 001, 002 e 003)
├── src/
│   ├── api/app.py                   # Aplicação FastAPI REST, Webhooks HMAC e servidor do Console
│   ├── connectors/providers.py      # Interfaces e Adaptadores (WhatsApp, Voz, Agenda, Assinatura, Asaas, IA)
│   ├── database/db.py               # Persistência relacional multi-tenant (tenant_id) e Audit Log imutável
│   ├── frontend/index.html          # Console Operacional SPA (Dashboard, Kanban, Inbox, Gate OAB, MCP)
│   ├── mcp/server.py                # Servidor MCP JSON-RPC 2.0 com validação de schema e proteção anti-injection
│   ├── orchestrator/engine.py       # Orquestrador de Tarefas com máquina de estados, orçamento e conciliação
│   └── security/guardrails.py       # Autenticação HMAC, RBAC, PromptInjectionGuard e EthicalComplianceGuard
└── tests/
    └── test_law_ai_platform.py      # Suíte de testes unitários, multi-tenant, RBAC, OAB e ponta a ponta
```

## 2. Módulos Implementados (A a R)

- **A. Multi-tenancy e gestão de escritórios:** Isolamento lógico estrito por `tenant_id` em todas as tabelas e queries (`src/database/db.py`).
- **B. Usuários, equipes, funções e permissões:** Matriz RBAC (`SUPER_ADMIN`, `TENANT_ADMIN`, `LAWYER`, `PARALEGAL`, `COMMERCIAL_AGENT`, `FINANCE`) em `src/security/guardrails.py`.
- **C. Cadastro de serviços jurídicos e modelos comerciais:** Configuração de áreas jurídicas, perguntas de qualificação e honorários (`legal_services`).
- **D. CRM de leads, contatos, oportunidades e pipeline:** Gestão de estágios (`NEW` → `QUALIFIED` → `MEETING_SCHEDULED` → `AWAITING_APPROVAL` → `SENT_FOR_SIGNATURE` → `AWAITING_PAYMENT` → `WON`).
- **E. Inbox omnichannel com histórico centralizado:** Registro unificado de conversas e mensagens (WhatsApp, E-mail, Voz, Webform).
- **F. Agente de triagem e qualificação de leads:** `TriageAndQualificationAgent` com classificação jurídica, detecção de urgência e conformidade ética OAB.
- **G. Agente de atendimento e follow-up:** Automação controlada com respeito imediato a comandos de *opt-out* (`PARAR`, `SAIR`, `CANCELAR`).
- **H. Agente de voz e agendamento:** `VoiceAndSchedulingAgent` com transcrição, detecção de emergência (*warm transfer*) e reserva de agenda.
- **I. Biblioteca de documentos e modelos contratuais:** Templates versionados com variáveis seguras (`document_templates`).
- **J. Geração assistida de propostas e minutas:** Renderização parametrizada com hash de integridade `SHA-256` e armazenamento em cofre.
- **K. Revisão e aprovação humana obrigatória:** Trava em código e banco (`ApprovalRequest`) que impede envio de contratos ou cobranças sem aprovação de um `LAWYER` ou `TENANT_ADMIN`.
- **L. Assinatura eletrônica:** `ESignatureProvider` (ZapSign, Clicksign v3, SignDocs Brasil ICP-Brasil) com conciliação via webhook HMAC.
- **M. Cobranças, pagamentos e conciliação de status:** `PaymentProvider` (Asaas Pix Copia e Cola, Boleto, Cartão) com reconciliação automática para `WON`.
- **N. Agenda e distribuição de atendimentos:** Integração `CalendarProvider` e atribuição por especialidade.
- **O. Auditoria, consentimentos e gestão de preferências:** Trilha `audit_logs` imutável, registro `consent_records` e anonimização Art. 18 LGPD.
- **P. Dashboard comercial e financeiro:** KPIs de conversão, pipeline, receita contratada, caixa liquidado e consumo de IA.
- **Q. Configuração de agentes, prompts, ferramentas e políticas:** Orquestrador com estados persistidos, `allowed_tools`, timeout e limite de orçamento (`max_budget_brl`).
- **R. Administração da plataforma e gestão de planos SaaS:** Controle de planos (`STARTER`, `PRO`, `ENTERPRISE`) e tetos mensais de orçamento de IA por escritório.

## 3. Como Executar e Testar

### Executar a Suíte Completa de Testes Automatizados
```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```

### Iniciar o Servidor da Plataforma Localmente
```bash
uvicorn src.api.app:app --host 0.0.0.0 --port 8000
```
Acesse `http://localhost:8000` para abrir o Console Operacional SPA ou `http://localhost:8000/docs` para a especificação interativa OpenAPI 3.1.
