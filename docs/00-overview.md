# Distribution OS — blueprint overview

Start here. These documents are the architecture and product plan for a distributor-owned, multi-brand
operating system for Indian FMCG distribution (manufacturer → distributor → retailer), built by one
developer first for the pilot tenant Tarsun Enterprises (Kalyan West, Thane) and designed to reach
lakhs of users without rewriting the ledgers, the tenancy model or the sync protocol.

## Read in this order

1. [Positioning and standout features](01-positioning-and-standout-features.md) — what this is and is not; the three "conversion truths" the pilot must prove.
2. [Five apps and surfaces](02-five-apps-and-surfaces.md) — five products, two store binaries (Team, Retailer) plus a web console; van sales resolved.
3. [Scope and must-not-build](03-scope-and-must-not-build.md) — pilot / v1 / later, the cut line, what is deliberately not built.
4. [System architecture and data model](04-system-architecture-and-data-model.md) — the modular monolith, module list, the eight irreversible ADRs, state vocabularies.
5. [Inbound invoice pipeline](05-inbound-invoice-pipeline.md) — photo → QR/IRN verify → structured pull → vision extraction → validators → SKU match → human review → GRN.
6. [Order-to-cash flows](06-order-to-cash-flows.md) — step by step per role.
7. [Offline sync](07-offline-sync.md) — PowerSync streams per role, write path, conflict rules, idempotency, GPS.
8. [Frontend architecture](08-frontend-architecture.md) · 9. [Backend architecture and API](09-backend-architecture-and-api.md)
9. [Integrations](10-integrations.md) — Tally XML, brand DMS coexistence (FieldAssist), WhatsApp, maps, OTP, GST e-invoice / e-way bill, imports, ONDC vocabulary.
10. [Infrastructure and cost](11-infra-and-cost.md) · 12. [Repository layout](12-repository-layout.md) (target tree; the skeleton is a subset)
11. [Solo-developer roadmap](13-roadmap-solo-dev.md) — 24-week P50 / 28-week P80, acceptance per slice, definition of production-grade, questions to answer before week 1.
12. [Risks](14-risks.md) · 15. [Decisions log](15-decisions-log.md)

Supporting material: [`adr/`](adr/0000-irreversibility-register.md) (one page per irreversible decision), [`domain/`](domain/glossary.md) (glossary, retailer-invoice field spec, ranked pain points), [`design/`](design/SYNTHESIS.md) (the frozen synthesis, the three proposals it merged, the shared context brief), [`research/`](research/) (R01–R10 evidence reports with sources, 2026-09-04).

## Ground truth used throughout

Six real documents from Tarsun (Aug 2026): a Guru Kripa (MOM makhana) Tally-style invoice without e-invoice QR; Reliance Retail (Campa) and Guiltfree Industries (Too Yumm) invoices with IRN + signed QR; a Sneha Logicare lorry receipt; Tarsun's own retailer bills from two systems — FieldAssist DMS (Too Yumm; beat, salesman, SO ids) and TradeEzee ERP (Windows desktop) — plus a thermal slip for Campa. They fix the document types, case-size conventions (x 90, _120, CS1), discount structures (secondary %, cash %, free qty, GST benefit) and the coexistence requirement.

## How the skeleton maps to the plan

`shared/domain` (paise, pieces, GST, UUIDv7, state machines, price precedence), `shared/contracts` (Zod + oRPC), `backend/db` (Drizzle schema with RLS as code; tenancy + platform tables from ADRs 0001/0002/0007), `backend/apps/api` (NestJS 12 on Fastify; health + tenancy; one folder per module), `backend/apps/worker` (pg-boss outbox relay), `frontend/apps/team` + `frontend/apps/retailer` (Expo SDK 57), `frontend/apps/console` (Vite + React 19), `frontend/packages/{ui,api-client,offline}`, `infra/`. `CLAUDE.md` at the root holds commands and the rules that keep the codebase honest.
