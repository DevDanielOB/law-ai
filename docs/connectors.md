# Arquitetura de Conectores e Plano de Servidores MCP — Law.AI (`docs/connectors.md`)

## 1. Avaliação e Seleção de Provedores de Integração

Seguindo as diretrizes da Seção 7, comparamos os provedores com operação no Brasil quanto a cobertura funcional, APIs oficiais, suporte a webhooks, custo, facilidade de homologação e portabilidade:

| Interface Padronizada (`Port`) | Provedor Primário Recomendado | Alternativas Avaliadas | Justificativa Técnica e Comercial (Brasil) | Eventos de Webhook Suportados |
| :--- | :--- | :--- | :--- | :--- |
| **`MessagingProvider`** | **WhatsApp Cloud API Oficial (Meta) / Twilio** | Zenvia, Blip, SendPulse | Evita bloqueio de números (proibido usar APIs não oficiais em operação jurídica séria); repasse direto da tabela oficial da Meta (1.000 msgs de serviço grátis/mês; R$ 0,035/msg adicional) e suporte a botões interativos e WhatsApp Flows. | `message.received`, `message.delivered`, `message.read`, `opt_out.requested` |
| **`EmailProvider`** | **Gmail API / Google Workspace (OAuth2) + SMTP/SendGrid** | Amazon SES, Microsoft Graph | Padrão dominante em escritórios de advocacia; permite envio de propostas formais com anexo PDF e rastreamento de thread por `threadId`. | `email.received`, `email.bounced`, `email.opened` |
| **`TelephonyProvider`** | **Twilio Voice + ElevenLabs Conversational AI / Retell AI** | Vapi, Bland AI, Zenvia Voice | Baixa latência em português brasileiro, suporte a SIP trunking nacional, transcrição automática da chamada e *warm transfer* (transferência assistida) para o ramal/celular do advogado plantonista. | `call.initiated`, `call.transcribed`, `call.transferred`, `call.completed` |
| **`CalendarProvider`** | **Google Calendar API** | Microsoft Outlook Calendar, Cal.com | Sincronização bidirecional de disponibilidade dos sócios e advogados especialistas, geração automática de link Google Meet e convites com lembretes. | `event.created`, `event.updated`, `event.cancelled` |
| **`ESignatureProvider`** | **ZapSign API / Clicksign API v3.0 / SignDocs Brasil** | Docusign, D4Sign | Plena validade jurídica no Brasil (MP 2.200-2/2001 e Lei 14.063/2020). **ZapSign** oferece excelente experiência de assinatura via WhatsApp; **Clicksign v3.0** entrega envelopes corporativos robustos; **SignDocs Brasil** oferece ICP-Brasil A1 gratuito e menor custo por documento (R$ 0,50–0,75). | `envelope.created`, `document.viewed`, `document.signed`, `document.refused`, `envelope.expired` |
| **`PaymentProvider`** | **Asaas API v3** | Pagar.me, Stripe Brasil, Iugu | Suporte nativo a **Pix (QR Code dinâmico, Copia e Cola e Pix Automático)**, Boleto Registrado, Cartão de Crédito, **Split de Pagamento** (divisão automática de honorários entre escritório e advogado parceiro) e emissão de NFS-e. | `PAYMENT_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED` |
| **`DocumentStorageProvider`** | **Google Cloud Storage (GCS) / S3-Compatible + Google Drive** | AWS S3, Cloudflare R2 | Criptografia em repouso na região `southamerica-east1` (São Paulo), URLs pré-assinadas temporárias e integração opcional com pastas autorizadas do Google Drive do escritório. | `object.finalized`, `object.archived` |
| **`AIModelProvider`** | **Google Gemini (Vertex AI / Gemini API)** | OpenAI Enterprise, Anthropic Claude | Janela de contexto ampla para análise de documentos, suporte nativo a *structured outputs* (JSON Schema), baixa latência no modelo Flash para triagem e garantia contratual de não treinamento com dados dos tenants. | Respostas síncronas/streaming com telemetria de tokens e custo. |

## 2. Contratos das Interfaces Padronizadas (`src/connectors/interfaces.py`)

Todos os conectores implementam contratos explícitos que isolam o domínio do Law.AI das particularidades de cada fornecedor:
- **Modo Credenciado (Real):** Ativado automaticamente quando as variáveis de ambiente do provedor (`ASAAS_API_KEY`, `ZAPSIGN_API_TOKEN`, `WHATSAPP_CLOUD_TOKEN`, etc.) estão configuradas para o escritório ou ambiente.
- **Modo Sandbox Verificável (Simulado Explícito):** Enquanto não houver credenciais de produção configuradas no ambiente, o sistema utiliza adaptadores determinísticos que registram explicitamente `mode: "SANDBOX_SIMULATED"`, validam todos os payloads, assinaturas HMAC de webhooks e transições de estado sem jamais mascarar uma simulação como chamada externa real.

## 3. Plano de Servidores MCP (Model Context Protocol): Desenvolvimento vs. Produção

Distinguimos rigorosamente as ferramentas internas de engenharia (IDE/Desenvolvimento) das ferramentas disponibilizadas aos agentes operacionais em produção:

### 3.1 MCPs de Desenvolvimento (Exclusivos para Engenharia / CI)
- **Escopo:** Inspeção de schemas de banco de dados, execução de testes automatizados, lint de segurança e consulta de documentação técnica.
- **Isolamento:** Jamais são carregados pelo runtime da aplicação nem acessíveis por agentes que interagem com leads ou clientes.

### 3.2 Servidor MCP de Produção do Law.AI (`LawAIMCPServer` — `src/mcp/server.py`)
O servidor MCP de produção expõe ferramentas estritamente delimitadas via protocolo **JSON-RPC 2.0**, exigindo contexto autenticado (`tenant_id`, `actor_id`, `role`) e aplicando **validação de argumentos, limites de execução (rate limit/budget) e sanitização contra prompt injection**.

#### Catálogo de Ferramentas do `LawAIMCPServer`

| Nome da Ferramenta (`tool_name`) | Objetivo e Escopo | Schema de Entrada (Argumentos Obrigatórios) | Permissões Exigidas | Guardrails e Limites de Segurança |
| :--- | :--- | :--- | :--- | :--- |
| **`legal_catalog.list_services`** | Consulta os serviços jurídicos, áreas de atuação e perguntas de qualificação do escritório. | `{"tenant_id": "string", "legal_area": "string (optional)"}` | `AI_AGENT`, `COMMERCIAL_AGENT`, `LAWYER`, `TENANT_ADMIN` | Somente leitura; retorna exclusivamente serviços ativos do próprio `tenant_id`. |
| **`crm.get_lead_status`** | Consulta dados cadastrais, consentimento LGPD, score de qualificação e estágio da oportunidade de um lead. | `{"tenant_id": "string", "lead_id": "string"}` | `AI_AGENT`, `COMMERCIAL_AGENT`, `LAWYER`, `TENANT_ADMIN` | Mascara dados bancários/sensíveis não necessários; verifica isolamento de tenant. |
| **`calendar.check_slots`** | Consulta horários livres na agenda dos advogados especialistas da área jurídica selecionada. | `{"tenant_id": "string", "legal_area": "string", "date_iso": "YYYY-MM-DD"}` | `AI_AGENT`, `COMMERCIAL_AGENT`, `LAWYER` | Somente leitura; não expõe detalhes privados de outros compromissos dos advogados. |
| **`contracts.prepare_draft_for_approval`** | Gera rascunho de proposta e minuta contratual a partir de modelo aprovado e cria requisição de aprovação humana. | `{"tenant_id": "string", "opportunity_id": "string", "template_id": "string", "custom_notes": "string"}` | `AI_AGENT`, `PARALEGAL`, `LAWYER`, `TENANT_ADMIN` | **Nunca envia o contrato ao cliente.** Cria registro com status `AWAITING_APPROVAL` exigindo chancela de um `LAWYER`. |
| **`finance.check_payment_status`** | Consulta o status de assinatura eletrônica e de pagamento (Pix/Boleto/Cartão) de uma oportunidade. | `{"tenant_id": "string", "opportunity_id": "string"}` | `AI_AGENT`, `FINANCE`, `LAWYER`, `TENANT_ADMIN` | Somente leitura; não permite estornar valores nem alterar conta bancária de destino. |

### 3.3 Proteção contra Prompt Injection e Abuso de Ferramentas no MCP
1. **Inspeção de Argumentos (`PromptInjectionGuard`):** Todo argumento textual enviado a uma ferramenta MCP passa por um detector de padrões de injeção (tentativas de sobrescrever instruções de sistema, exfiltrar variáveis de ambiente, acessar outro `tenant_id`, injetar SQL/ comandos shell ou burlar a aprovação humana da OAB).
2. **Contexto Imutável de Tenant:** O `tenant_id` é injetado pelo token de sessão autenticado do orquestrador e comparado com o recurso alvo; tentativas de *cross-tenant access* são bloqueadas imediatamente e registradas como alerta crítico em `audit_logs`.
3. **Auditoria de Invocação:** Cada chamada JSON-RPC ao MCP registra timestamp, ferramenta, hash dos argumentos, latência e resultado na trilha de auditoria.
