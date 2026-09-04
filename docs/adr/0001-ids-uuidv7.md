# ADR 0001: IDs

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

UUIDv7 as `id text` on every synced table, generated on the client for offline creation (PowerSync requires text ids, R07 §3.2). Human numbers (`GL/1686`, `GRN-0042`) are separate server-assigned columns from `numbering_series(tenant_id, series_code, fy, next_no)` under `SELECT … FOR UPDATE` at commit, ≤ 16 characters, unique per series per FY (IRN-ready, R05 §4).

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
