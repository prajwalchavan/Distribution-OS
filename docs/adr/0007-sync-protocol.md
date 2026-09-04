# ADR 0007: Sync write protocol

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

`POST /sync/upload` with `X-Sync-Protocol: 1`; 2xx + `sync_errors` for business rejections, 5xx only for transient faults; `sync_ops(tenant_id, device_id, op_id)` unique, retained ≥ 180 days (§7).

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
