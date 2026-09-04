<!-- Derived from the 2026-09-04 architecture synthesis (docs/design/SYNTHESIS.md §12). Edit here; the synthesis is the frozen source. -->

# Repository layout

```
distribution-os/
├─ package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  .nvmrc (24)  .editorconfig
├─ .github/workflows/        ci.yml  deploy-staging.yml  deploy-prod.yml  eas-update.yml  nightly.yml  restore-drill.yml
├─ docker-compose.yml        # postgres17 (wal_level=logical), minio, mailpit, powersync-oe (optional), whatsapp-stub
│
├─ frontend/
│  ├─ apps/
│  │  ├─ team/                     # Expo SDK 57 — ONE store binary, role-gated; carries location + camera permissions
│  │  │  ├─ app/
│  │  │  │  ├─ _layout.tsx              # session, role resolution, PowerSync provider, i18n, ability injection
│  │  │  │  ├─ (auth)/                  # phone OTP, org picker
│  │  │  │  ├─ (owner)/                 # dashboard, approvals, live map, price quick-edit, team, incentives
│  │  │  │  ├─ (sales)/                 # beat today, retailer, order (last/suggested/grid), bargain, my orders, performance
│  │  │  │  ├─ (warehouse)/             # inbox (capture), review, GRN, order queue, picklist, packing, load sheet
│  │  │  │  └─ (delivery)/              # trips, stops, deliver/partial, on-spot order, collect, returns, settlement
│  │  │  ├─ src/features/<module>/      # screens + hooks per module
│  │  │  ├─ src/powersync/              # schema (from shared/contracts), connector → /sync/upload, per-role streams
│  │  │  ├─ src/tasks/location.task.ts  # TaskManager.defineTask at module top level; local buffer → /gps/points
│  │  │  ├─ src/native/                 # camera, scanner, maps wrappers
│  │  │  ├─ app.config.ts  eas.json  maestro/
│  │  │  └─ store/                      # Play declaration text, disclosure video script, iOS purpose strings
│  │  ├─ retailer/                 # Expo Router — web output (PWA) first, native later; minimal permissions; ONLINE-FIRST
│  │  │  ├─ app/(onboard)/ (home)/ (orders)/ (ledger)/ (discover)/
│  │  │  ├─ src/features/               # reuses ui primitives + team's order editor / product search / invoice viewer
│  │  │  └─ app.config.ts  eas.json
│  │  └─ console/                  # Vite + React 19: owner console, billing desk, accountant exports, curation, imports, settings
│  │     ├─ src/routes/  src/features/{dashboard,approvals,pricing,billing-desk,retailers,coverage,live-map,integrations,imports,curation,claims,settings}
│  │     └─ vite.config.ts
│  └─ packages/
│     ├─ ui/                       # tokens.json → RN theme + Tailwind preset; RN primitives shared by team + retailer; fonts
│     ├─ api-client/               # oRPC client factory, auth plumbing, TanStack Query hooks, persisted cache
│     ├─ offline/                  # ONLY PowerSync-touching code: schema, streams, connector, attachment queue, sync_errors tray, UUIDv7
│     ├─ maps/                     # MapProvider: google.native.ts, maplibre.web.ts, navigation hand-off
│     └─ i18n/                     # en, hi (mr reserved), ICU plurals, formatters (keys shared with WhatsApp templates)
│
├─ backend/
│  ├─ apps/
│  │  ├─ api/                      # NestJS 12 (Fastify) modular monolith
│  │  │  └─ src/
│  │  │     ├─ main.ts  app.module.ts
│  │  │     ├─ common/                  # TenantContextGuard, TxManager (set_config), IdempotencyInterceptor, oRPC adapter, SSE hub, errors (hi/en)
│  │  │     ├─ sync/                    # POST /sync/upload (X-Sync-Protocol) → command mapper → module services
│  │  │     ├─ gps/                     # POST /gps/points → vehicle_positions + trip_points
│  │  │     ├─ webhooks/                # whatsapp, gsp (later), tally-connector polling endpoints
│  │  │     └─ modules/
│  │  │        ├─ platform/ identity/ retailers/ catalog/ tenant-catalog/ pricing/ orders/
│  │  │        ├─ inventory/ procurement/ warehouse/ billing/ receivables/ claims/ delivery/
│  │  │        ├─ docint/ notifications/ reporting/ integrations/ incentives/
│  │  │        └─ <module>/{domain,application,infrastructure,http,events.ts,<module>.module.ts}
│  │  ├─ worker/                   # same image, CMD worker: pg-boss consumers, crons, imports, exports
│  │  └─ tally-connector/          # Windows service, Node SEA (post-pilot): polls API, POSTs to localhost:9000, reports IMPORTRESULT
│  ├─ db/
│  │  ├─ schema/                   # drizzle schema per module; rls.ts (policies as code); roles.ts; views.ts (sell-side, per-stop, sellable_stock)
│  │  ├─ migrations/               # generated SQL, reviewed in PR, applied by one-shot ECS task (expand/contract)
│  │  ├─ seeds/                    # dated HSN rates, UQC, states, chart of accounts, global catalog seed, demo tenant
│  │  └─ powersync/                # sync-streams.yaml, publication.sql
│  ├─ docint/                      # LIBRARY called by the worker (no Nest dependency)
│  │  ├─ schema/                   # extraction JSON schema (R06 §8); prompt profiles: tally, sap-reliance, guiltfree-dms, marg-gst-local, brand-dms-secondary
│  │  ├─ validators/               # gstin.ts tax-split.ts hsn.ts rounding.ts irn-hash.ts qr-jwt.ts pack-size.ts page-completeness.ts
│  │  ├─ matcher/                  # alias, codes, structured filter, trgm, fusion, bands
│  │  ├─ engines/                  # ExtractionEngine interface: anthropic.ts, gemini.ts
│  │  └─ eval/                     # scoring harness CLI, disagreement tooling; fixtures in docs/fixtures (images gitignored)
│  └─ tests/
│     ├─ integration/              # testcontainers Postgres: RLS isolation, ledger invariants, idempotency replay, upload-log replay
│     ├─ role-leak/                # salesperson device dump + oRPC response dump: no cost/margin anywhere
│     └─ contracts/                # /sync/upload v1 snapshot, OpenAPI diff, Tally XML against a Tally sample
│
├─ shared/
│  ├─ domain/                      # pure TS, zero runtime deps: Money (paise), Qty/packs, GST split + rounding, pricing engine, scheme rules,
│  │                               # state machines (fulfilment/delivery/invoice/trip), credit control, suggested order, CASL abilities,
│  │                               # IRN hash, GSTIN checksum, case-size parser, en-IN formatter
│  ├─ contracts/                   # Zod 4 schemas, oRPC router types, events, docint JSON schema, PowerSync table schema,
│  │                               # sync-upload protocol v1, WhatsApp template registry types
│  └─ config/                      # tsconfig, eslint (boundaries), prettier, vitest presets
│
├─ infra/
│  ├─ sst.config.ts                # AWS Mumbai: vpc, rds (logical replication), ecs services, alb, s3 (docs, backups+object-lock), cloudfront, secrets/kms, alarms
│  ├─ docker/                      # Dockerfile (multi-stage node:24-alpine, non-root, pnpm deploy); compose.local.yml
│  ├─ kamal/                       # optional DigitalOcean BLR1 fallback
│  ├─ otel/                        # collector config
│  ├─ scripts/                     # backup.sh restore-drill.sh rotate-secrets.sh migrate.sh k6/
│  └─ runbooks/                    # restore, breach-72h, rotate-secrets, revoke-device, rollback, rederive-balances, powersync-resync, tally-connector
│
└─ docs/
   ├─ adr/                         # 0000-irreversibility-register, 0001-ids-uuidv7, 0002-tenancy-rls, 0003-stock-ledger-lots, 0004-money-journal,
   │                               # 0005-product-master, 0006-retailer-identity, 0007-sync-protocol, 0008-pricing-engine, 0009-two-binaries,
   │                               # 0010-powersync, 0011-nest12-or-11, 0012-no-websocket, ...
   ├─ domain/                      # glossary (R09 §11), invoice field spec (invoices A–G), scheme taxonomy, claim types, state machines
   ├─ fixtures/invoices/           # redacted real invoices + ground-truth JSON (docint eval set); never unredacted phones
   ├─ integrations/                # tally-xml.md, marg-excel-profile.md, whatsapp-templates.md, gsp.md, ondc-vocabulary.md, brand-dms.md
   ├─ compliance/                  # dpdp-notices (hi/en/mr), gps-consent.md, retention.md, security-note.md, play-store-declaration.md
   ├─ pilot/                       # Tarsun onboarding checklist, parallel-run scorecard, exit criteria, adoption metrics
   └─ pricing.md                   # public price page source + feature-request channel
```

Rules that keep it honest with one developer: `shared/domain` has zero runtime dependencies and is the only place business math lives; `backend/db` is the only place SQL schema lives; `shared/contracts` is the only place wire shapes live; `frontend/packages/offline` is the only PowerSync-touching code; modules never import another module's repository; every mutating contract carries `idempotencyKey`; every synced table has `id text` and `tenant_id`; ADRs are one page and written the same day as the decision.
