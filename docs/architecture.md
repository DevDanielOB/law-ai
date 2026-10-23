# Arquitetura Técnica e Modelo de Dados — Law.AI (`docs/architecture.md`)

## 1. Avaliação Crítica de Tecnologias e Capacidades Reais do Ambiente

Conforme exigido nas Seções 5, 11 e 14, inspecionamos o ambiente de execução atual e avaliamos as tecnologias candidatas sob os critérios de latência, custo operacional, segurança multi-tenant, dependência de fornecedores e facilidade de manutenção.

### 1.1 Capacidades Realmente Disponíveis no Ambiente (Antigravity Sandbox VM)
- **Sistema Operacional e Runtimes:** Linux Debian/Ubuntu x86_64 com **Python 3.11.2** e **Node.js v18.20.4** (`npm` 9.2.0, `git`).
- **Bibliotecas e Frameworks Pré-Instalados Verificados:**
  - **Backend e APIs:** `FastAPI`, `Uvicorn`, `Pydantic`, `HTTPX`, `Requests`, `SQLite3` nativo com suporte a transações ACID, JSON e FTS (Full-Text Search).
  - **Processamento de Documentos e Dados:** `python-docx`, `openpyxl`, `xlsxwriter`, `pypdf`, `pdfplumber`, `pypdfium2`, `pandas`, `matplotlib`, `Pillow`, `LibreOffice` headless e `Chromium`.
- **Restrições Operacionais do Sandbox:** Sem acesso de saída à internet a partir da VM (`pip install` ou `npm install` externos bloqueados por política de segurança do sandbox) e sem daemon Docker em execução local.
- **Decisão Arquitetural Pragmática (ADR-001):**
  - Para que a plataforma **Law.AI seja 100% funcional, executável e testável imediatamente no workspace atual** (sem depender de pacotes externos inacessíveis no sandbox offline) e, ao mesmo tempo, esteja pronta para deploy cloud em escala (Google Cloud Run + Cloud SQL PostgreSQL + Redis), adotamos uma **Arquitetura Hexagonal em Monólito Modular (Clean / Ports & Adapters)**:
    - **Camada de Aplicação e API Executável:** Implementada em **Python 3.11 + FastAPI + Pydantic + SQLite3/PostgreSQL-ready** (`src/`), com suporte nativo a assincronismo, validação estrita de schemas OpenAPI 3.1, isolamento multi-tenant (`tenant_id`) e suíte de testes automatizados (`tests/`).
    - **Camada de Experiência (Frontend SPA):** Painel administrativo completo, CRM Kanban, Inbox Omnichannel, Central de Aprovação Humana (HITL), Configurador de Agentes e Dashboard Financeiro em **HTML5/CSS3/TypeScript-compatible JS moderno** servido diretamente pela plataforma (`src/frontend/index.html`) e compatível com evolução em Next.js/React.
    - **Infraestrutura Cloud e Contratos Prisma/PostgreSQL:** Fornecemos o schema declarativo completo (`prisma/schema.prisma`), `docker-compose.yml` (PostgreSQL 16 + pgvector + Redis 7 + API + Worker) e pipeline `.github/workflows/ci.yml` para ambientes de homologação e produção.

### 1.2 Comparativo de Alternativas de Hospedagem e Stack Cloud

| Critério | Opção A: Google Cloud (Cloud Run + Cloud SQL PG + Cloud Tasks/Memorystore + GCS) — **Recomendada** | Opção B: AWS (ECS Fargate + RDS PostgreSQL + SQS/ElastiCache + S3) | Opção C: VPS / Kubernetes Auto-Gerenciado (GKE / EKS / Hetzner) |
| :--- | :--- | :--- | :--- |
| **Custo Inicial (MVP)** | **Baixo (~US$ 45–90/mês):** Cloud Run escala a zero ou mínimo de 1 instância; faturamento em BRL na região `southamerica-east1` (São Paulo). | Médio (~US$ 110–180/mês): custo fixo de NAT Gateway, ALB e instâncias Fargate/RDS sempre ativas. | Médio/Alto em operação (exige SRE dedicado para manutenção de cluster, patches e backups). |
| **Latência no Brasil** | **Excelente (< 25 ms em SP):** Região `southamerica-east1` (São Paulo) com baixa latência para webhooks de WhatsApp, Asaas e ZapSign. | Excelente (`sa-east-1` São Paulo), porém com tarifas de transferência de dados historicamente mais elevadas. | Variável conforme datacenter local; maior risco de indisponibilidade sem multi-AZ gerenciado. |
| **Soberania de Dados (LGPD)** | **Nativa:** Dados em repouso e trânsito permanecem em território nacional (`southamerica-east1`), atendendo ao Art. 33 da LGPD e exigências de sigilo da OAB. | Nativa em `sa-east-1`. | Depende de configuração manual de replicação e criptografia de disco. |
| **Integração com IA** | **Nativa via Vertex AI / Gemini API:** Governança corporativa sem uso de dados de clientes para treino de modelos base. | Bedrock (Anthropic/Llama). | Via APIs externas. |

## 2. Diagrama de Arquitetura (Monólito Modular Evolutivo)

```
+---------------------------------------------------------------------------------------------------+
|                                  CANAIS EXTERNOS E CLIENTES                                       |
|  [WhatsApp Business API]   [ Webforms / Landing Pages ]   [ Telefonia / Voz ]   [ E-mail / Gmail ] |
+-------------+---------------------------+--------------------------+--------------------+---------+
              | Webhooks (HMAC)           | REST / JSON              | SIP / Webhooks     | OAuth2
              v                           v                          v                    v
+---------------------------------------------------------------------------------------------------+
|                           CAMADA DE BORDA E GATEWAY DE SEGURANÇA                                  |
|  • Rate Limiting por Tenant/IP   • Verificação de Assinatura de Webhooks   • Sanitização Prompt   |
|  • Autenticação JWT / API Key    • Contexto Multi-Tenant (X-Tenant-ID)     • RBAC Enforcer        |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                       NÚCLEO DA PLATAFORMA LAW.AI (MONÓLITO MODULAR)                              |
|                                                                                                   |
|  +---------------------------+  +---------------------------+  +-------------------------------+  |
|  | Módulos de Fundação       |  | Módulos Comerciais & CRM  |  | Módulos Jurídicos & Fechamento|  |
|  | [A] Multi-Tenancy         |  | [D] CRM, Leads & Pipeline |  | [I] Biblioteca de Modelos     |  |
|  | [B] Usuários, Equipes/RBAC|  | [E] Inbox Omnichannel     |  | [J] Geração de Propostas/Min. |  |
|  | [C] Catálogo de Serviços  |  | [N] Agenda & Distribuição |  | [K] Gate Aprovação Humana OAB |  |
|  | [O] Auditoria & LGPD      |  | [P] Dashboard Com./Fin.   |  | [L] Assinatura Eletrônica     |  |
|  | [R] Admin & Planos SaaS   |  +---------------------------+  | [M] Cobranças & Conciliação   |  |
|  +---------------------------+                                 +-------------------------------+  |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | ORQUESTRADOR DE AGENTES & SERVIDOR MCP INTERNO (Módulos F, G, H, Q)                         |  |
|  | • Máquina de Estados Persistida (PENDING -> RUNNING -> AWAITING_APPROVAL -> COMPLETED)      |  |
|  | • Controle de Orçamento (Budget/Tokens) • Timeout & Retries • Guardrails Éticos OAB/LGPD    |  |
|  | • Agentes: [F] Triagem/Qualificação  [G] Atendimento/Follow-up  [H] Voz/Agendamento         |  |
|  | • Servidor MCP (JSON-RPC 2.0): Ferramentas isoladas por tenant com validação de schema      |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
         |                                        |                                       |
         v (Portas / Interfaces)                  v (Persistência Isolada)                v
+----------------------------------+   +-----------------------------------+   +--------------------+
| ADAPTADORES DE CONECTORES        |   | CAMADA DE DADOS E EVENTOS         |   | OBSERVABILIDADE    |
| • MessagingProvider (WhatsApp)   |   | • Banco Relacional (PostgreSQL /  |   | • OpenTelemetry    |
| • TelephonyProvider (Twilio/Vapi)|   |   SQLite ACID com tenant_id)      |   | • Logs Estruturados|
| • ESignatureProvider (ZapSign/   |   | • Filas/Eventos Assíncronos       |   | • Métricas de Custo|
|   Clicksign/SignDocs)            |   | • Armazenamento de Documentos     |   |   e Latência por   |
| • PaymentProvider (Asaas/Stripe) |   |   (GCS / S3 / Vault Local)        |   |   Escritório       |
| • Calendar & Email (Google)      |   | • Trilha de Auditoria Imutável    |   +--------------------+
+----------------------------------+   +-----------------------------------+
```

## 3. Diagrama de Sequência do Atendimento Comercial Ponta a Ponta

```
Potencial Cliente      Inbox / WhatsApp      Orquestrador / Agente IA       Advogado (Humano)      Assinatura & Pagamento
       |                      |                         |                           |                        |
       | 1. Envia mensagem    |                         |                           |                        |
       |--------------------->|                         |                           |                        |
       |                      | 2. Registra Lead +      |                           |                        |
       |                      |    Consentimento LGPD   |                           |                        |
       |                      |------------------------>|                           |                        |
       |                      |                         | 3. Classifica Área Juríd. |                        |
       |                      |                         |    e executa perguntas de |                        |
       | 4. Perguntas de      |                         |    qualificação (Mód. F)  |                        |
       |    qualificação      |<------------------------|                           |                        |
       |<---------------------|                         |                           |                        |
       | 5. Envia respostas e |                         |                           |                        |
       |    documentos        |------------------------>|                           |                        |
       |                      |                         | 6. Calcula score, cria    |                        |
       |                      |                         |    Oportunidade e agenda  |                        |
       |                      |                         |    reunião (Mód. D, H, N) |                        |
       |                      |                         |-------------------------->|                        |
       |                      |                         | 7. Prepara Minuta/Proposta|                        |
       |                      |                         |    a partir de Modelo     |                        |
       |                      |                         |    aprovado (Mód. I, J)   |                        |
       |                      |                         |                           |                        |
       |                      |                         | 8. TRAVA OBRIGATÓRIA:     |                        |
       |                      |                         |    Solicita Aprovação     |                        |
       |                      |                         |    Humana (Mód. K)        |                        |
       |                      |                         |-------------------------->|                        |
       |                      |                         |                           | 9. Revisa cláusulas e  |
       |                      |                         |<--------------------------|    APROVA envio        |
       |                      |                         |                           |                        |
       |                      |                         | 10. Aciona ESignature +   |                        |
       |                      |                         |     PaymentProvider       |                        |
       |                      |                         |--------------------------------------------------->|
       | 11. Recebe link de assinatura (ZapSign/Clicksign) e cobrança Pix/Boleto (Asaas)                     |
       |<----------------------------------------------------------------------------------------------------|
       | 12. Assina contrato e realiza pagamento Pix    |                           |                        |
       |---------------------------------------------------------------------------------------------------->|
       |                      |                         | 13. Webhooks autenticados atualizam status:        |
       |                      |                         |     Contrato SIGNED + Pagamento CONFIRMED -> WON   |
       |                      |                         |<---------------------------------------------------|
       |                      |                         | 14. Notifica Advogado e registra Auditoria (Mód. O)|
       |                      |                         |-------------------------->|                        |
```

## 4. Modelo de Domínio e Modelo Entidade-Relacionamento (DER)

Todas as entidades operacionais possuem a coluna obrigatória `tenant_id` indexada para garantir isolamento lógico estrito entre escritórios.

```
[tenants] 1 --- * [users]
   |      1 --- * [legal_services]
   |      1 --- * [document_templates]
   |      1 --- * [agent_configs]
   |      1 --- * [leads]
   |                 | 1 --- * [consent_records]
   |                 | 1 --- * [conversations] 1 --- * [messages]
   |                 | 1 --- * [appointments]
   |                 | 1 --- * [opportunities]
   |                              | 1 --- * [agent_tasks]
   |                              | 1 --- * [proposals_and_contracts]
   |                                           | 1 --- * [approval_requests]
   |                                           | 1 --- * [esignature_envelopes]
   |                                           | 1 --- * [payment_charges]
   +------ 1 --- * [audit_logs] (Imutável / Append-Only)
```

### Principais Tabelas e Invariantes de Domínio
1. **`tenants` (Módulos A, R):** `id`, `name`, `slug`, `oab_society_number`, `plan_tier` (`STARTER`, `PRO`, `ENTERPRISE`), `monthly_ai_budget_brl`, `current_ai_spend_brl`, `settings_json`, `created_at`.
2. **`users` (Módulo B):** `id`, `tenant_id`, `email`, `full_name`, `role` (`SUPER_ADMIN`, `TENANT_ADMIN`, `LAWYER`, `PARALEGAL`, `COMMERCIAL_AGENT`, `FINANCE`), `oab_number`, `oab_uf`, `specialties_json`, `is_active`.
3. **`legal_services` (Módulo C):** `id`, `tenant_id`, `name`, `legal_area` (`TRABALHISTA`, `PREVIDENCIARIO`, `CIVEL`, `EMPRESARIAL`, `TRIBUTARIO`, `FAMILIA`), `qualification_questions_json`, `base_fee_brl`, `success_fee_pct`, `requires_lawyer_approval`.
4. **`leads` & `consent_records` (Módulos D, O):** `id`, `tenant_id`, `full_name`, `phone`, `email`, `document_cpf_cnpj`, `source_channel`, `legal_area`, `urgency_level`, `qualification_score`, `qualification_data_json`, `lgpd_consent_status`, `opt_out`.
5. **`conversations` & `messages` (Módulo E):** `id`, `tenant_id`, `lead_id`, `channel` (`WHATSAPP`, `EMAIL`, `VOICE`, `WEBFORM`), `status` (`BOT_ACTIVE`, `HUMAN_ASSIGNED`, `CLOSED`), `assigned_user_id`; mensagens com `direction`, `sender_type` (`CLIENT`, `AI_AGENT`, `HUMAN_AGENT`), `content`, `prompt_injection_flagged`.
6. **`opportunities` (Módulo D):** `id`, `tenant_id`, `lead_id`, `service_id`, `stage` (`NEW`, `QUALIFYING`, `QUALIFIED`, `MEETING_SCHEDULED`, `PROPOSAL_DRAFT`, `AWAITING_APPROVAL`, `SENT_FOR_SIGNATURE`, `AWAITING_PAYMENT`, `WON`, `LOST`), `estimated_value_brl`, `assigned_lawyer_id`.
7. **`agent_tasks` (Seção 8 + Módulo Q):** `id`, `tenant_id`, `opportunity_id`, `agent_type`, `objective`, `context_json`, `allowed_tools_json`, `timeout_seconds`, `max_budget_brl`, `consumed_budget_brl`, `state` (`PENDING`, `RUNNING`, `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`, `CANCELLED`), `result_json`, `evidence_logs_json`, `requires_human_approval`.
8. **`document_templates`, `proposals_and_contracts` & `approval_requests` (Módulos I, J, K):** Modelos parametrizados (`{{client_name}}`, `{{service_name}}`, `{{fee_value}}`), minutas geradas com controle de versão, hash SHA-256 de integridade e registro de aprovação/rejeição assinado por usuário com perfil `LAWYER` ou `TENANT_ADMIN`.
9. **`esignature_envelopes` & `payment_charges` (Módulos L, M):** Rastreamento de envelopes externos (`provider`, `external_id`, `status`, `signer_url`, `signed_at`) e cobranças (`provider`, `external_id`, `payment_method`, `amount_brl`, `status`, `pix_copy_paste`, `invoice_url`, `paid_at`).
10. **`audit_logs` (Módulo O):** `id`, `tenant_id`, `actor_type` (`USER`, `AI_AGENT`, `WEBHOOK`, `SYSTEM`), `actor_id`, `action`, `resource_type`, `resource_id`, `payload_Summary`, `ip_address`, `created_at`.

## 5. Contratos de API e Estratégia de Autenticação/Autorização

### 5.1 Autenticação e Autorização (RBAC + Isolamento Multi-Tenant)
- **Autenticação:** Suporte a cabeçalhos `X-Tenant-ID`, `X-User-ID` e `Authorization: Bearer <token>` (assinado via HMAC-SHA256 com expiração e claims `sub`, `tenant_id`, `role`, `oab_number`).
- **Matriz RBAC de Ações Sensíveis:**
  - `LAWYER` / `TENANT_ADMIN`: Únicos perfis autorizados a aprovar propostas/minutas contratuais (`POST /api/v1/approvals/{id}/decide`), editar cláusulas jurídicas e autorizar envio para assinatura eletrônica.
  - `PARALEGAL` / `COMMERCIAL_AGENT`: Podem operar o CRM, atender no Inbox, agendar reuniões e solicitar geração de minutas, mas **são bloqueados (`403 Forbidden`)** ao tentar aprovar minutas jurídicas ou estornar cobranças.
  - `FINANCE` / `TENANT_ADMIN`: Autorizados a gerenciar cobranças e conciliação financeira.

### 5.2 Principais Endpoints REST (`src/api/app.py`)
- `GET /api/v1/health` — Status da plataforma, módulos e conectores.
- `POST /api/v1/tenants` & `GET /api/v1/tenants/{tenant_id}` — Gestão de escritórios e planos SaaS (Módulos A, R).
- `POST /api/v1/users` & `GET /api/v1/users` — Gestão de usuários, equipes e RBAC (Módulo B).
- `POST /api/v1/services` & `GET /api/v1/services` — Catálogo de serviços jurídicos e regras de qualificação (Módulo C).
- `POST /api/v1/webhooks/inbound-message` — Recebimento omnichannel (WhatsApp, Webform, E-mail), registro de consentimento LGPD e disparo automático do Agente de Triagem (Módulos D, E, F, O).
- `POST /api/v1/voice/inbound-call` — Atendimento por Agente de Voz IA, transcrição e agendamento automático (Módulos H, N).
- `POST /api/v1/tasks/orchestrate` & `GET /api/v1/tasks` — Execução e monitoramento de tarefas do Orquestrador de Agentes (Seção 8, Módulo Q).
- `POST /api/v1/contracts/generate` — Geração assistida de minuta contratual com criação automática de `ApprovalRequest` (Módulos I, J, K).
- `POST /api/v1/approvals/{approval_id}/decide` — Aprovação ou rejeição humana por advogado inscrito na OAB; quando aprovado, permite disparo para Assinatura Eletrônica e Cobrança (Módulos K, L, M).
- `POST /api/v1/webhooks/esignature` & `POST /api/v1/webhooks/payment` — Conciliação autenticada por HMAC de eventos de assinatura (ZapSign/Clicksign) e pagamento (Asaas Pix/Boleto), movendo a oportunidade para `WON` (Módulos L, M).
- `POST /api/v1/mcp/rpc` — Endpoint JSON-RPC 2.0 do Servidor MCP Jurídico/Comercial (Seção 7).
- `GET /api/v1/dashboard/metrics` & `GET /api/v1/audit-logs` — Indicadores comerciais/financeiros e auditoria completa (Módulos O, P).

## 6. Plano de Implantação, Recuperação de Falhas e Estimativa de Custos

### 6.1 Recuperação de Falhas (Resiliência e RPO/RTO)
- **Persistência de Tarefas e Idempotência:** Toda tarefa de agente e todo webhook externo possuem chave de idempotência (`external_event_id` / `task_id`). Se um worker falhar, tarefas em `RUNNING` além do `timeout_seconds` sofrem *lease recovery* ou transição segura para escalonamento humano (`HUMAN_ASSIGNED`).
- **Backups e Restauração:** Snapshots automáticos diários do banco de dados com Point-in-Time Recovery (PITR) de 7 a 35 dias (RPO < 5 min, RTO < 30 min) e retenção versionada de contratos assinados em Object Storage.

### 6.2 Estimativa de Custos Mensais por Faixa de Utilização

Premissas de referência (preços verificados em outubro de 2026):
- Tarifa oficial da Meta WhatsApp Business no Brasil: R$ 0,035 por mensagem de serviço/utilidade (após 1.000 mensagens grátis/mês por número) e R$ 0,3217 por template de marketing.
- Custo de assinatura eletrônica: R$ 0,50 a R$ 1,50 por envelope (SignDocs Brasil / ZapSign).
- Custo de LLM (Gemini 2.5 Flash / Pro via API com cache de contexto): ~R$ 0,04 a R$ 0,18 por atendimento completo de qualificação + geração de minuta.

| Faixa / Porte do Escritório | Volume Mensal Estimado | Infraestrutura Cloud (Cloud Run + DB + Storage) | Consumo de IA (Triagem + Minutas) | Mensageria WhatsApp (Meta) + Voz | Assinatura Eletrônica (Contratos) | Custo Total Operacional Estimado / Mês |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Faixa 1: Escritório Boutique / Inicial** | Até 150 leads/mês, 1.500 msgs, 20 contratos | R$ 180,00 | R$ 25,00 | R$ 17,50 (500 msgs excedentes à franquia grátis) | R$ 15,00 a R$ 30,00 | **R$ 237,50 a R$ 252,50 / mês** |
| **Faixa 2: Escritório em Crescimento (PME)** | Até 800 leads/mês, 8.000 msgs, 100 min voz, 80 contratos | R$ 420,00 | R$ 140,00 | R$ 245,00 (msgs) + R$ 95,00 (voz) | R$ 40,00 a R$ 80,00 | **R$ 940,00 a R$ 980,00 / mês** |
| **Faixa 3: Banca de Alta Escala / Massificado** | Até 5.000 leads/mês, 50.000 msgs, 1.000 min voz, 500 contratos | R$ 1.450,00 (Multi-AZ + Read Replica) | R$ 850,00 | R$ 1.715,00 (msgs) + R$ 890,00 (voz) | R$ 250,00 a R$ 600,00 | **R$ 5.155,00 a R$ 5.505,00 / mês** |
