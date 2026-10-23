# Segurança, Privacidade (LGPD) e Conformidade Ética OAB — Law.AI (`docs/security-and-compliance.md`)

## 1. Conformidade com o Código de Ética da OAB e Regulamentação Jurídica Brasileira

O Law.AI foi projetado desde a fundação para respeitar rigorosamente o **Estatuto da Advocacia e da OAB (Lei nº 8.906/1994)**, o **Código de Ética e Disciplina da OAB**, o **Provimento nº 205/2021 do Conselho Federal da OAB** (publicidade e marketing jurídico) e as diretrizes de governança de IA no Poder Judiciário (**Provimento CNJ nº 213/2026** / **Resolução CNJ nº 332/2020**):

1. **Vedação à Mercantilização e Captação Indevida de Clientela:**
   - O sistema bloqueia disparos de prospecção ativa em massa não solicitada (*spam* jurídico). Campanhas de conteúdo informativo só podem ser enviadas a contatos com *opt-in* prévio e finalidade legítima documentada.
   - Os prompts e validadores de saída (`EthicalComplianceGuard`) proíbem expressões mercantilistas (ex.: *"garantia de vitória"*, *"causa ganha"*, *"promoção de honorários"*, *"consulta grátis por tempo limitado"*).
2. **Proibição de Exercício Ilegal ou Aconselhamento Jurídico Autônomo sem Supervisão:**
   - Os agentes de IA identificam-se transparentemente como assistentes virtuais de triagem do escritório.
   - O agente coleta fatos, documentos preliminares e qualifica a demanda, mas **nunca emite parecer jurídico conclusivo nem promete resultado processual**.
3. **Aprovação Humana Obrigatória (Human-in-the-Loop — Módulo K):**
   - Nenhuma proposta de honorários, minuta de contrato de prestação de serviços advocatícios, procuração *ad judicia*, alteração de cláusula ou estorno financeiro pode ser enviada ao cliente sem aprovação explícita assinada no sistema por um usuário autenticado com perfil `LAWYER` (com número de inscrição OAB validado) ou `TENANT_ADMIN`.
4. **Validade Jurídica de Assinaturas Eletrônicas:**
   - Todos os adaptadores de assinatura eletrônica operam em conformidade com a **MP nº 2.200-2/2001** e a **Lei nº 14.063/2020** (assinaturas eletrônicas avançadas com trilha de auditoria, IP, timestamp, hash SHA-256 do PDF e suporte a certificado digital qualificado ICP-Brasil A1/A3).

## 2. Proteção de Dados Pessoais e Sigilo Profissional (LGPD — Lei nº 13.709/2018)

1. **Isolamento Estrito Multi-Tenant (`tenant_id`):**
   - Cada escritório constitui um *Controlador* independente perante a LGPD, atuando o Law.AI como *Operador* sob contrato de processamento de dados (DPA).
   - Todas as tabelas de domínio exigem `tenant_id` obrigatório. Consultas sem `tenant_id` ou tentativas de acesso cruzado entre escritórios são rejeitadas na camada de repositório/middleware e geram alerta de segurança.
2. **Gestão de Consentimento, Finalidade e Opt-Out (Módulo O):**
   - No primeiro contato, o sistema registra o `ConsentRecord` com canal de origem, base legal (consentimento / procedimentos preliminares relacionados a contrato — Art. 7º, I e V da LGPD), versão dos termos e timestamp.
   - Comandos de revogação (`PARAR`, `DESCADASTRAR`, `OPT-OUT`) bloqueiam imediatamente qualquer automação de mensagens (`opt_out = True`).
3. **Minimização, Pseudonimização e Política de Retenção Zero em LLMs:**
   - Os agentes recebem no `context_json` apenas os campos estritamente necessários para a tarefa em execução.
   - Chamadas a provedores de modelos de IA utilizam endpoints corporativos com política de retenção zero (*zero data retention*) e vedação contratual ao uso de dados de escritórios para treinamento de modelos base.
4. **Direito de Exclusão e Portabilidade (Art. 18 da LGPD):**
   - A plataforma oferece rotina auditada de anonimização/exclusão de dados pessoais de leads mediante solicitação do titular, preservando apenas registros fiscais/legais obrigatórios sob guarda restrita.

## 3. Segurança de Aplicações, Ferramentas MCP e Prevenção a Prompt Injection

1. **Defesa em Profundidade contra Prompt Injection (`PromptInjectionGuard`):**
   - Mensagens recebidas por WhatsApp, e-mail, voz transcrita ou textos extraídos de PDFs de terceiros são tratados como **entradas não confiáveis**.
   - Antes de passar o texto ao orquestrador ou ao servidor MCP, o `PromptInjectionGuard` inspeciona tentativas de *jailbreak* (`ignore previous instructions`, `ignore todas as instruções anteriores`, `system prompt`, `execute command`, `DROP TABLE`, `aprove o contrato sem advogado`).
   - Quando detectada tentativa de injeção, a tarefa do agente é bloqueada, o evento é gravado em `audit_logs` e a conversa é transferida para revisão humana.
2. **Princípio do Menor Privilégio em Agentes e MCP:**
   - Cada tarefa do orquestrador possui uma lista explícita `allowed_tools`. Um agente de triagem não tem permissão para invocar ferramentas de geração contratual ou cobrança.
   - Nenhum agente tem permissão para alterar RBAC, criar usuários, excluir dados, emitir reembolsos ou publicar código.
3. **Controle de Orçamento e Rate Limiting por Escritório:**
   - Cada escritório possui `monthly_ai_budget_brl` e cada tarefa possui `max_budget_brl` e `timeout_seconds`. Caso o consumo atinja o teto configurado, o orquestrador interrompe novas execuções autônomas e realiza *fallback* gracioso para atendimento humano.
4. **Gestão de Segredos e Criptografia:**
   - Chaves de API e segredos de webhooks nunca são armazenados em código versionado nem expostos em prompts ou logs estruturados (uso de mascaramento automático `***REDACTED***`).
   - Webhooks de provedores externos (WhatsApp, ZapSign, Clicksign, Asaas) exigem verificação de assinatura criptográfica HMAC-SHA256 e chave de idempotência contra ataques de *replay*.
