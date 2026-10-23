# ADR 001: Adoção de Monólito Modular Evolutivo e Arquitetura Hexagonal

- **Status:** Aprovado
- **Data:** 13 de outubro de 2026
- **Contexto:** O Law.AI possui 18 módulos funcionais (A–R) que abrangem desde multi-tenancy e CRM até orquestração de agentes de IA, assinatura eletrônica e conciliação de pagamentos. Adotar microsserviços distribuídos na Fase 1/MVP introduziria sobrecarga operacional (latência de rede interna, transações distribuídas complexas, custo fixo elevado de infraestrutura e dificuldade de testes locais).
- **Decisão:** Adotar um **Monólito Modular Evolutivo com Arquitetura Hexagonal (Ports & Adapters)**. Todos os 18 módulos compartilham o mesmo processo transacional e banco relacional com fronteiras de domínio claras, enquanto todas as integrações externas (`MessagingProvider`, `ESignatureProvider`, `PaymentProvider`, `TelephonyProvider`, `CalendarProvider`, `EmailProvider`, `DocumentStorageProvider`, `AIModelProvider`) são desacopladas por interfaces formais.
- **Consequências:**
  - **Positivas:** Transações ACID consistentes entre CRM, Aprovação Humana, Assinatura e Auditoria; custo inicial mínimo em Cloud Run; execução e testes 100% determinísticos no ambiente local/sandbox; facilidade de extrair o Orquestrador de Agentes ou o gateway de Webhooks para serviços dedicados no futuro caso o volume escale para dezenas de milhares de escritórios.
  - **Negativas:** Exige disciplina arquitetural para impedir acoplamento direto entre tabelas de módulos distintos sem passar pelos serviços de domínio.

---

# ADR 002: Isolamento Multi-Tenant Lógico Estrito com Contexto Obrigatório

- **Status:** Aprovado
- **Data:** 13 de outubro de 2026
- **Contexto:** Escritórios de advocacia manipulam dados protegidos pelo sigilo profissional (Art. 34 do Estatuto da OAB) e pela LGPD. Provisionar um banco de dados físico por escritório no plano Starter/Pro tornaria o custo inviável, mas um banco compartilhado sem proteções rígidas representaria risco de vazamento cruzado.
- **Decisão:** Implementar multi-tenancy por coluna discriminadora obrigatória (`tenant_id`) em todas as tabelas de domínio, combinada com validação obrigatória de contexto de tenant na camada de serviço/repositório e índices compostos `(tenant_id, id)`. Para clientes do plano `ENTERPRISE` que exijam isolamento físico, a arquitetura hexagonal permite apontar a conexão do tenant para uma instância dedicada do Cloud SQL.
- **Consequências:**
  - **Positivas:** Onboarding instantâneo de novos escritórios em milissegundos, custo compartilhado eficiente e segurança verificada por testes automatizados de isolamento cruzado.

---

# ADR 003: Gate Obrigatório de Aprovação Humana (HITL) para Atos Jurídicos e Comerciais Sensíveis

- **Status:** Aprovado
- **Data:** 13 de outubro de 2026
- **Contexto:** A automação comercial jurídica no Brasil está sujeita ao Código de Ética da OAB e ao Provimento 205/2021. Agentes de IA podem alucinar cláusulas ou aplicar valores incorretos se tiverem permissão direta para enviar minutas contratuais aos clientes.
- **Decisão:** Implementar uma trava em nível de máquina de estados no banco de dados e no Orquestrador (`state = AWAITING_APPROVAL`). O conector de assinatura eletrônica (`ESignatureProvider`) e o conector de cobrança (`PaymentProvider`) recusam em nível de código qualquer execução cujo contrato/proposta associado não possua um registro `ApprovalRequest` com `status = APPROVED` assinado por um usuário com `role IN ('LAWYER', 'TENANT_ADMIN')`.
- **Consequências:**
  - **Positivas:** Conformidade ética integral com a OAB, mitigação de responsabilidade civil do escritório e rastreabilidade completa de qual advogado aprovou cada minuta enviada.
