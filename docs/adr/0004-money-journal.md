# ADR 0004: Money ledger

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

`accounts` seeded per tenant (AR, Cash, UPI clearing per VPA, Sales @ rate, Output CGST/SGST/IGST, Discounts, Sales returns, Round off, Scheme receivable per manufacturer, Claims receivable); `journal_entries` + `journal_lines` balancing to the paisa (service check plus deferred constraint trigger; `UNIQUE(tenant_id, idempotency_key)`); `receipts` + `allocations` — invoices are never mutated for payment state. Outstanding = AR balance per party; ageing = open invoices minus allocations. Cash discount is a conditional realised at receipt within the window (R09 §12.20). Credit notes reverse at the original rate.

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
