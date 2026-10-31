# Organização Multiagente do Projeto e da Plataforma — Law.AI (`AGENTS.md`)

Este documento define as duas camadas de agentes do ecossistema **Law.AI**:
1. **Esquadrão de Engenharia e Produto (10 Agentes Especializados de Construção e Governança):** organização responsável pela pesquisa, arquitetura, implementação, segurança e validação contínua da plataforma.
2. **Agentes Operacionais em Runtime (Agentes de Atendimento e Automação Comercial por Escritório):** agentes executados pelo Orquestrador de Tarefas do Law.AI para atender leads, qualificar demandas, agendar reuniões e preparar minutas sob supervisão humana.

## 1. Os Dez Agentes Especializados de Engenharia e Produto

| ID | Agente Especializado | Missão e Responsabilidades Principais | Entregáveis Verificáveis no Repositório | Regras de Coordenação e Critérios de Aceite |
| :--- | :--- | :--- | :--- | :--- |
| **Agente 1** | **Líder de Pesquisa e Produto** | Coordena o esquadrão, define critérios de qualidade, consolida a matriz de priorização, arbitra conflitos entre módulos e mantém o backlog principal e o roadmap. | `README.md`, `AGENTS.md`, `docs/roadmap.md`, `artifacts/planner/task.md` | Nenhuma funcionalidade avança sem critério objetivo de aceite, alinhamento ético (OAB/LGPD) e revisão de escopo para evitar duplicação. |
| **Agente 2** | **Inteligência Competitiva** | Investiga concorrentes nacionais e globais (IA jurídica, softwares jurídicos, CRMs, BSPs WhatsApp, voz, CLM, assinatura e pagamentos), documenta preços e lacunas. | `docs/market-research.md` (Seções 1 a 4, tabelas comparativas e matriz priorizada) | Todas as afirmações sobre concorrentes exigem URL verificada, data de consulta e distinção explícita entre fato confirmado e hipótese. |
| **Agente 3** | **Especialista em Operações Jurídicas (Legal Ops)** | Mapeia a jornada do cliente do primeiro contato ao contrato assinado, desenha roteiros de qualificação por área do Direito e define quais atos exigem revisão exclusiva de advogado inscrito na OAB. | Catálogo de serviços jurídicos, templates de qualificação e contratos-base em `src/domain/legal_ops.py` e `docs/security-and-compliance.md` | Proibição estrita de promessa de resultado jurídico, mercantilização (Provimento 205/2021 OAB) ou envio de minuta sem gate `AWAITING_APPROVAL`. |
| **Agente 4** | **Arquiteto de Software** | Define o estilo arquitetural (Monólito Modular Evolutivo), fronteiras entre os 18 módulos (A–R), modelo de domínio, DER, contratos de API REST/Webhook e ADRs. | `docs/architecture.md`, `docs/decisions/001-modular-monolith.md`, `docs/decisions/002-multi-tenancy-isolation.md`, `docs/decisions/003-human-in-the-loop-oab.md` | Baixo acoplamento entre módulos, injeção de dependência para provedores externos e zero microsserviços prematuros sem necessidade demonstrada. |
| **Agente 5** | **Especialista em Agentes de IA** | Projeta o Orquestrador de Tarefas com máquina de estados explícita, memória controlada por caso, limites de tempo/orçamento, sanitização contra *prompt injection* e escalonamento humano. | `src/orchestrator/engine.py`, `src/agents/runtime_agents.py` (Triagem, Qualificação, Follow-up, Voz/Agendamento, Redação Assistida) | Toda tarefa de agente deve persistir estado, custo estimado, evidências, score de confiança e respeitar limites de orçamento do escritório (`tenant_id`). |
| **Agente 6** | **Especialista em Integrações e MCPs** | Projeta interfaces padronizadas (`MessagingProvider`, `EmailProvider`, `TelephonyProvider`, `CalendarProvider`, `ESignatureProvider`, `PaymentProvider`, `DocumentStorageProvider`, `AIModelProvider`) e o Servidor MCP. | `docs/connectors.md`, `src/connectors/interfaces.py`, `src/connectors/adapters.py`, `src/mcp/server.py` | Adaptadores devem validar assinaturas HMAC de webhooks, garantir idempotência de eventos e separar claramente credenciais reais de adaptadores simulados. |
| **Agente 7** | **Especialista em Backend e Dados** | Implementa o banco de dados relacional, isolamento multi-tenant (`tenant_id`), RBAC, autenticação por token/sessão, log de auditoria imutável e rotas da API para os módulos A–R. | `src/database/db.py`, `src/security/auth_rbac.py`, `src/api/app.py` | Nenhuma consulta SQL/ORM de domínio pode executar sem filtro obrigatório de `tenant_id`; todas as mutações geram registro em `audit_logs`. |
| **Agente 8** | **Especialista em Frontend e Experiência (UX)** | Desenvolve o painel administrativo multi-tenant, pipeline Kanban do CRM, Inbox Omnichannel, central de aprovação humana de minutas, biblioteca de modelos e dashboard financeiro/comercial. | `src/frontend/index.html` (servido pela aplicação e exportado para visualização direta) | Interface responsiva, acessível (WCAG AA), com visibilidade imediata de tarefas aguardando aprovação do advogado e status de contratos/cobranças. |
| **Agente 9** | **Segurança, Privacidade e Conformidade** | Avalia e implementa controles da LGPD (consentimento, finalidade, retenção/exclusão, pseudonimização), segurança de ferramentas MCP, RBAC e prevenção contra *prompt injection*. | `docs/security-and-compliance.md`, `src/security/guardrails.py` | Bloqueio automático de instruções maliciosas em mensagens/documentos recebidos e validação de saída para impedir aconselhamento jurídico autônomo proibido. |
| **Agente 10** | **QA, DevOps e Integração Contínua** | Implementa suíte de testes automatizados (unitários, integração multi-tenant, segurança/RBAC, aprovação humana, webhooks e MCP), configuração de containers e pipeline de CI/CD. | `tests/test_law_ai_platform.py`, `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml` | 100% dos testes automatizados devem executar e passar no ambiente real antes de qualquer entrega ser considerada concluída. |

## 2. Agentes Operacionais da Plataforma Law.AI (Runtime)

Os agentes abaixo operam dentro da plataforma atendendo aos escritórios clientes (tenants), sempre subordinados ao **Orquestrador de Tarefas (`TaskOrchestrator`)** e às políticas de governança do escritório:

### 2.1 `TriageAndQualificationAgent` (Módulo F)
- **Objetivo:** Receber o contato inicial no Inbox Omnichannel (WhatsApp, Webform, E-mail), registrar consentimento LGPD, identificar a área jurídica (ex.: Direito Trabalhista, Direito Previdenciário, Direito Cível/Consumidor, Direito Empresarial) e conduzir as perguntas de qualificação configuradas pelo escritório.
- **Ferramentas Permitidas (`allowed_tools`):** `crm.read_lead`, `crm.update_qualification`, `catalog.list_legal_services`, `compliance.check_output_safety`.
- **Limites e Guardrails:** Nunca emite parecer jurídico definitivo nem promete ganho de causa; se detectar prazo fatal iminente, prisão, medida liminar de urgência ou baixa confiança (`confidence < 0.70`), interrompe a automação e aciona `handoff.escalate_to_human`.

### 2.2 `FollowUpAndAttendanceAgent` (Módulo G)
- **Objetivo:** Manter o relacionamento com leads qualificados, responder dúvidas operacionais (documentos pendentes, horários, endereço do escritório) e realizar follow-up de propostas ou assinaturas pendentes.
- **Ferramentas Permitidas:** `inbox.send_routine_message`, `crm.read_opportunity`, `document.request_checklist`.
- **Limites e Guardrails:** Respeita a janela de 24 horas da API oficial do WhatsApp; exige aprovação humana para disparo inicial de campanhas ativas; cessa imediatamente qualquer contato caso o lead envie comando de *opt-out* (`PARAR`, `CANCELAR`, `SAIR`).

### 2.3 `VoiceAndSchedulingAgent` (Módulo H)
- **Objetivo:** Conduzir chamadas telefônicas receptivas ou ativas autorizadas via `TelephonyProvider`, transcrever o diálogo no histórico do lead, consultar disponibilidade na agenda dos advogados especialistas e reservar horário de reunião.
- **Ferramentas Permitidas:** `calendar.check_availability`, `calendar.book_meeting`, `telephony.transfer_call`, `crm.log_call_transcript`.
- **Limites e Guardrails:** Informa no início da chamada que o atendimento inicial é assistido por IA do escritório; oferece transferência imediata para atendente humano a qualquer momento.

### 2.4 `ProposalAndContractDraftingAgent` (Módulos I, J, K)
- **Objetivo:** Selecionar o modelo contratual e de procuração aprovado pelo escritório para o serviço jurídico identificado, preencher variáveis estruturadas do lead/oportunidade, calcular a proposta de honorários dentro da tabela do escritório e submeter a minuta para revisão humana.
- **Ferramentas Permitidas:** `templates.get_approved_template`, `contracts.generate_draft`, `approvals.request_lawyer_approval`.
- **Limites e Guardrails:** **Jamais envia o contrato diretamente ao cliente ou ao provedor de assinatura eletrônica.** A tarefa entra obrigatoriamente no estado `AWAITING_APPROVAL` até que um usuário com papel `LAWYER` ou `TENANT_ADMIN` aprove ou edite a minuta.

## 3. Protocolo de Revisão e Prevenção de Conflitos

1. **Fonte Única de Verdade para Contratos de Dados:** Todos os modelos de domínio, estados de tarefas e interfaces de conectores são centralizados e tipados.
2. **Isolamento de Escopo:** Ferramentas de desenvolvimento do ambiente (terminal, edição de código) nunca são expostas aos agentes operacionais que conversam com clientes dos escritórios.
3. **Verificação Obrigatória por Testes:** Nenhuma implementação dos Agentes 4 a 9 é aceita pelo Agente 1 sem validação automatizada executada pelo Agente 10.

## Token-efficient context and skill synchronization
Start with `SKILL.md`, then read only the applicable AGENTS.md section and relevant files. For each PR, update affected `SKILL.md` files in the same change when contracts, workflows, architecture, stack, paths, compliance gates or commands change; otherwise include “Skills reviewed; no update needed” in the PR description. Validate the actual runtime against package.json and source before relying on historical README/agent descriptions.
