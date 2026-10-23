# Roadmap de Entrega em 6 Fases e Critérios de Aceite — Law.AI (`docs/roadmap.md`)

## Visão Geral das Fases

| Fase | Nome da Fase | Esforço Estimado | Dependências | Status no Projeto Atual |
| :--- | :--- | :---: | :--- | :--- |
| **Fase 1** | Pesquisa de Mercado, Engenharia Reversa e Especificação Arquitetural | 1 semana | Acesso a fontes públicas e diagnóstico do ambiente | **Concluída (100%)** |
| **Fase 2** | Fundação Técnica (Multi-tenancy, Auth/RBAC, Banco de Dados, Auditoria) | 2 semanas | Especificação da Fase 1 | **Implementada e Verificada (MVP)** |
| **Fase 3** | CRM Jurídico, Pipeline, Inbox Omnichannel, Triagem IA e Agendamento | 2 semanas | Fundação Técnica (Fase 2) | **Implementada e Verificada (MVP)** |
| **Fase 4** | Biblioteca de Modelos, Minutas Assistidas, Gate Humano, Assinatura e Pagamentos | 2 semanas | CRM e Triagem (Fase 3) | **Implementada e Verificada (MVP)** |
| **Fase 5** | Orquestrador Avançado de Agentes, Voz IA, Servidor MCP e Observabilidade | 2 semanas | Fases 2 a 4 | **Implementada e Verificada (MVP)** |
| **Fase 6** | Homologação, Testes Ponta a Ponta, Validação Ética/Segurança e Lançamento | 1 semana | Fases 1 a 5 | **Suíte Automatizada Executada** |

---

## Detalhamento por Fase: Entregáveis, Riscos e Critérios Objetivos de Aceite

### Fase 1 — Pesquisa e Especificação
- **Entregáveis:** `docs/market-research.md`, `AGENTS.md`, `docs/architecture.md`, `docs/connectors.md`, `docs/security-and-compliance.md`, `docs/roadmap.md` e ADRs em `docs/decisions/`.
- **Riscos:** Assumir funcionalidades inexistentes em concorrentes ou escolher arquitetura excessivamente complexa (microsserviços prematuros).
- **Critérios de Aceite:** 100% dos concorrentes documentados com fontes públicas verificadas em 2026; matriz de funcionalidades priorizada por impacto comercial, dificuldade técnica, risco jurídico e custo; modelo de dados e diagramas completos.

### Fase 2 — Fundação Técnica (Módulos A, B, C, O, R)
- **Entregáveis:** Camada de persistência relacional (`src/database/db.py`), isolamento por `tenant_id`, autenticação e RBAC (`src/security/auth_rbac.py`), catálogo de serviços jurídicos, gestão de planos SaaS e trilha de auditoria imutável (`audit_logs`).
- **Riscos:** Vazamento de dados entre escritórios (*cross-tenant data leak*) ou escalação de privilégio por perfis não autorizados.
- **Critérios de Aceite:** Testes automatizados comprovando que o Escritório A jamais consegue ler ou modificar leads, contratos ou logs do Escritório B (`404`/`403`), e que todas as mutações geram registro em `audit_logs`.

### Fase 3 — CRM e Atendimento Omnichannel (Módulos D, E, F, G, N)
- **Entregáveis:** Gestão de leads e oportunidades em pipeline Kanban, Inbox Omnichannel unificado, registro de consentimento LGPD e *opt-out*, Agente de Triagem e Qualificação Jurídica, Agente de Follow-up e distribuição de agenda por especialidade.
- **Riscos:** Bloqueio de número no WhatsApp por uso fora das regras da Meta; alucinação ou promessa de resultado jurídico pelo agente de triagem.
- **Critérios de Aceite:** Recebimento de mensagem via webhook cria lead, registra consentimento LGPD, classifica área jurídica corretamente, executa perguntas de qualificação, respeita comando `PARAR` (*opt-out*) e agenda reunião com advogado especialista.

### Fase 4 — Contratos, Aprovação Humana e Fechamento (Módulos I, J, K, L, M)
- **Entregáveis:** Biblioteca de modelos contratuais parametrizados, geração assistida de propostas/minutas com hash de integridade SHA-256, Gate Obrigatório de Aprovação Humana (`ApprovalRequest`), adaptadores `ESignatureProvider` (ZapSign/Clicksign/SignDocs) e `PaymentProvider` (Asaas Pix/Boleto/Cartão) com conciliação via webhooks.
- **Riscos:** Envio acidental de minuta jurídica sem revisão de advogado inscrito na OAB; falsificação de webhook de pagamento.
- **Critérios de Aceite:** Tentativa de enviar contrato para assinatura enquanto `status != APPROVED` ou tentativa de aprovação por perfil `PARALEGAL`/`COMMERCIAL_AGENT` deve falhar com erro explícito (`403 Forbidden` / `409 Conflict`); após aprovação de `LAWYER` e recebimento dos webhooks autenticados de assinatura e pagamento, a oportunidade avança automaticamente para `WON`.

### Fase 5 — Agentes, Voz IA e Servidor MCP (Módulos H, Q + Seção 7 e 8)
- **Entregáveis:** Orquestrador de Tarefas com máquina de estados persistida (`PENDING`, `RUNNING`, `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`), controle de orçamento (`max_budget_brl`) e timeout, Agente de Voz IA (`TelephonyProvider`), Servidor MCP JSON-RPC 2.0 (`src/mcp/server.py`) e guardrails contra *prompt injection*.
- **Riscos:** Abuso de ferramentas via *prompt injection* em mensagens de leads; estouro de orçamento de API de IA.
- **Critérios de Aceite:** Bloqueio comprovado em teste de payloads contendo *prompt injection*; interrupção de tarefa quando o orçamento do escritório é excedido; execução JSON-RPC 2.0 validada nas ferramentas do servidor MCP.

### Fase 6 — Homologação, Dashboard e Lançamento (Módulo P + QA/CI)
- **Entregáveis:** Painel Administrativo e Dashboard Comercial/Financeiro (`src/frontend/index.html`), `docker-compose.yml`, `.env.example`, pipeline CI (`.github/workflows/ci.yml`) e suíte completa de testes ponta a ponta (`tests/test_law_ai_platform.py`).
- **Riscos:** Regressões entre módulos ou divergência entre métricas financeiras e eventos do CRM.
- **Critérios de Aceite:** Execução limpa de 100% da suíte de testes automatizados (unitários, integração, segurança e fluxo ponta a ponta da conversa ao contrato assinado e pago).
