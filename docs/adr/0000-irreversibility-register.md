# ADR 0000: irreversibility register

Status: living document.

Decisions that cannot be changed after the first real tenant data without a migration of ledgers, ids or the sync wire protocol. Each has its own ADR; change one only with a written migration plan.

| ADR  | Decision                                                                                      | Why irreversible                                                      |
| ---- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 0001 | Client-generated UUIDv7 `id text` on every synced table; human numbers server-assigned        | Ids are embedded in devices' local databases and on printed documents |
| 0002 | Shared schema + `tenant_id` + forced RLS; `app_rw` runtime role; `set_config` per transaction | Every policy, index and query assumes it                              |
| 0003 | Append-only stock ledger with lots (batch + MRP + expiry) and derived balances                | History cannot be reconstructed from mutable rows                     |
| 0004 | Double-entry money journal; invoices never mutated for payment state                          | Same                                                                  |
| 0005 | Global product master + tenant overlay + supplier pack configs; merges via `merged_into`      | Ledger rows reference variants and lots                               |
| 0006 | Global retailer identity + tenant retailer record + links                                     | Retailer logins span distributors                                     |
| 0007 | `/sync/upload` protocol v1: never 4xx, `sync_ops` durable ≥180 days, `sync_errors`            | Old app versions in the field speak it                                |
| 0008 | Pricing engine as a pure function run on device and server; `applied_rules` stamped per line  | Printed invoices and claims depend on the stamp                       |

Reversible (evolve freely): hosting provider, sync-engine vendor behind `frontend/packages/offline`, extraction engine behind `ExtractionEngine`, UI kits, map/OTP/WhatsApp providers, NestJS major version.
