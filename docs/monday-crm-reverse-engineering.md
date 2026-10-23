# Engenharia Reversa do Monday.com CRM & Especificação de Interface SaaS para Law.AI

> **Documento de Auditoria, Padrões Visuais e Arquitetura de Interface**  
> **Data:** 14 de Outubro de 2026  
> **Referência Analisada:** [Monday.com Brasil](https://monday.com/lang/pt) & Monday Sales CRM  
> **Aplicação Destino:** Law.AI Platform (Ecossistema Multi-tenant de Advocacia e CRM Jurídico)

---

## 1. Descobertas da Engenharia Reversa do Monday.com

A análise profunda do Monday.com (tanto de sua camada institucional pública quanto de suas interfaces de demonstração e produtos do Sales CRM) revelou os pilares fundamentais que tornam a plataforma uma das referências mundiais em engajamento, clareza e produtividade visual:

### 1.1 Camada A — Identidade Visual, Geometria e Design Tokens

| Dimensão | Especificação Observada no Monday.com | Aplicação Semântica no Law.AI CRM |
| :--- | :--- | :--- |
| **Cor Primária (Brand)** | `#0073ea` (Monday Blue) / Hover `#0060b9` / Fundo `#e5f2ff` | Botões de ação principal (`+ Novo Item`), itens selecionados, links ativos |
| **Status "Concluído / Ganho"** | `#00c875` (Done Green) / Texto branco em badge retangular arredondado | Contratos assinados, clientes ganhos (`WON`), faturas pagas |
| **Status "Em Andamento / Triagem"**| `#fdab3d` (Working on it Orange) | Qualificação IA em curso, documentos em análise, follow-up ativo |
| **Status "Estagnado / Alerta / Urgência"**| `#e2445c` (Stuck Red) / `#ff3d57` (Coral Red) | Prazo fatal iminente, urgência alta, contrato rejeitado ou perda (`LOST`) |
| **Status "Aguardando / Gate OAB"**| `#a25ddc` (Purple) / `#784bd1` | Minuta contratual aguardando aprovação ética do advogado titular |
| **Status "Novo Lead / Inicial"** | `#579bfc` (Sky Blue) | Primeiro contato WhatsApp, lead recém-chegado via tráfego pago |
| **Fundos de Aplicação** | `#f5f6f8` (Canvas neutro) / `#ffffff` (Cards e Tabela) / `#181b34` (Sidebar Dark opcional) | Canvas limpo sem fadiga visual, cards destacados com sombras ultra-leves |
| **Bordas & Divisórias** | `1px solid #e6e9ef` (Tabelas e Células) / `#c3c6d4` (Foco) | Grade de tabela perfeitamente alinhada, dando sensação de planilha viva |
| **Tipografia & Escala** | `Poppins, Figtree, -apple-system, sans-serif` (600/700 títulos, 400/500 dados) | `Plus Jakarta Sans` e `Inter` para clareza em dados numéricos e nomes |
| **Elevação & Raios** | Células de status: `border-radius: 4px`; Cards Kanban: `8px`; Gavetas: `16px` | Micro-sombras suaves `0 2px 6px rgba(0,0,0,0.06)`, evitando visual pesado |

### 1.2 Camada B — Padrões de Interação e Experiência do CRM

O Monday Sales CRM se diferencia de CRMs legados por transformar o banco de dados em uma **superfície viva de colaboração**:

1. **Agrupamento com Barras Coloridas (Grouped Tables):**
   - Os negócios e leads são divididos em seções colapsáveis (`Novos Contatos`, `Qualificados & Docs`, `Agendados & Minutas`, `Contratos Assinados`).
   - Cada grupo possui uma cor de destaque no cabeçalho e na borda esquerda, contador de itens e somatório de valores no rodapé da coluna.
2. **Células de Status com Troca em 1 Clique (Inline Status Pickers):**
   - Ao clicar no badge de status, um popover colorido surge imediatamente com as opções disponíveis, permitindo avançar de etapa sem abrir modais burocráticos.
3. **Múltiplas Visões Integradas (View Switcher Tabs):**
   - No topo do quadro, o usuário alterna instantaneamente entre:
     - 📊 **Tabela Principal (Main Table):** visão de alta densidade, perfeita para triagem rápida e edição inline.
     - 📋 **Kanban Pipeline:** cards arrastáveis com valor do negócio, responsável e prazos.
     - 📈 **Dashboard & Gráficos:** KPIs executivos, taxa de conversão e valor total do pipeline.
     - 📅 **Agenda / Linha do Tempo:** videoconferências e reuniões marcadas.
4. **Barra de Ferramentas de Alta Produtividade:**
   - Campo de busca instantânea (filtra todas as colunas conforme digita).
   - Filtro por responsável e área jurídica.
   - Botão de colunas ocultas e ordenação rápida.
   - Botão principal destacado em azul Monday: `+ Novo Lead / Item`.
5. **Gaveta Lateral de Atualizações & Ficha do Item (Slide-over Item Details):**
   - Ao clicar no nome do item ou no ícone de balão de conversa (`💬`), uma gaveta lateral desliza suavemente da direita.
   - Aba **Atualizações (Updates)**: histórico colaborativo com menções, notas internas e logs da IA.
   - Aba **Ficha & Campos**: edição de dados cadastrais, qualificação, área jurídica e valores.
   - Aba **WhatsApp**: histórico da conversa original com balões do lead e do assistente.

---

## 2. Diagnóstico Técnico do Projeto Law.AI

### 2.1 Pontos Fortes Existentes
- **Backend Robusto & Confiável:** Fastify com TypeScript estrito, banco SQLite parametrizado com isolamento multi-tenant real (`tenant_id`), RBAC (`LAWYER`, `PARALEGAL`, `TENANT_ADMIN`), e 100% de cobertura de testes E2E.
- **Riqueza de Recursos:** Módulos de captação por tráfego pago, cofre de documentos com hash SHA-256, motor de orquestração de IA, aprovação ética OAB (Provimento 205/2021) e reconciliação ZapSign/Pix.
- **Frontend SPA Integrado:** Servido na raiz `/` sem necessidade de processo Node adicional de build para desenvolvimento.

### 2.2 Oportunidades de Refatoração no Frontend
1. **Estrutura da Tabela do CRM:** Elevar a visualização de tabela para o padrão Monday com grupos coloridos colapsáveis, células com preenchimento colorido para status e somatórios automáticos.
2. **Alternância Unificada de Visões:** Unificar Tabela, Kanban, Dashboard e Agenda como visões integradas no topo do Quadro de CRM.
3. **Gaveta Lateral de Detalhes:** Aprimorar com tabs de Atualizações (Updates feed), Detalhes, WhatsApp e Ações OAB.
4. **Design Tokens & Micro-interações:** Aplicar a paleta exata do Monday.com com sombras suaves, botões com dropdown e tooltips contextuais.
