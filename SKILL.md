# SKILL.md — Law.AI
## Purpose
Multi-tenant legal CRM and assisted client-intake platform: omnichannel messaging, lead qualification, contract drafts, mandatory human legal approval, e-signature and payments. Respect OAB professional rules, LGPD, tenant isolation and consent. Do not assume README feature claims mean an integration is production-ready.
## Current stack
The root package.json currently specifies Node 22, TypeScript 5, Fastify 5 and Prisma 6. The README and parts of AGENTS.md also describe earlier Python/FastAPI paths; verify actual files before implementing and resolve documentation drift rather than treating both stacks as active. Commands: `npm run build`, `npm test`; inspect package.json before adding new commands.
## Selective context map
- `package.json`: runtime and scripts (authoritative for Node).
- `README.md`: product overview; validate implementation claims against source.
- `AGENTS.md`: construction-agent roles, runtime-agent responsibilities and compliance gates.
- `prisma/schema.prisma`: data model; verify tenancy and approval constraints.
- `docs/architecture.md`, `docs/connectors.md`, `docs/security-and-compliance.md`: read only relevant sections.
- `src/`, `test/` or `tests/`: discover actual current paths before editing; do not assume historical Python paths exist.
## Non-negotiable rules
Scope all data access by authenticated tenant and enforce RBAC. No autonomous legal advice or promise of outcomes. Contracts, sensitive outbound communications and payments require the appropriate human approval gate. Respect opt-out, audit actions, secure webhook verification and idempotency; avoid leaking credentials or client PII. Keep development mocks clearly distinguished from real providers.
## Token-efficient workflow
1. Read this SKILL.md and the relevant AGENTS.md section, then inspect only impacted source and tests.
2. Identify current stack and source-of-truth before changing files; do not load the full README or unrelated docs into every agent.
3. Specify acceptance criteria, change minimal files, test the impacted behavior and summarize results.
4. Prefer focused checks, with `npm test` and `npm run build` before PR completion when feasible.
## Mandatory skill maintenance
For every code PR, review this file and relevant module-level SKILL.md files. Update in the SAME PR if architecture, business rules, agent behavior, integrations, contracts, paths, scripts or compliance gates changed. Otherwise explicitly say “Skills reviewed; no update needed” in the PR description. Keep skills short, accurate, without secrets or accumulated changelogs. AGENTS.md describes agent roles; SKILL.md is a concise operational map.
