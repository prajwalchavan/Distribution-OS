# ADR 0002: Tenancy

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

Shared schema, `tenant_id uuid NOT NULL` on every tenant table, `ENABLE` + `FORCE ROW LEVEL SECURITY`, two DB roles (`app_owner` for migrations, `app_rw` for API/worker with no `BYPASSRLS`), every unit of work inside a transaction that starts with `set_config('app.tenant_id'|'app.actor_role'|'app.actor_id', …, true)`; policies read `(SELECT current_setting(...))`; every index leads with `tenant_id`; Drizzle adds `WHERE tenant_id = ?` as defence in depth (R08 §2.2). Global tables have no `tenant_id`; writes only under `actor_role = 'curator'` or the identity service. `tenant_product_costs` carries an extra role predicate so the Vyapar failure is a database guarantee; CI dumps a salesperson device after full sync and every oRPC response for that role and asserts no cost or margin column or value appears.

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
