# ADR 0006: Retailer identity

Status: accepted (2026-09-04). Irreversible after first real data; changing it means a migration of ledgers, ids or the sync wire protocol.

## Decision

`retailer_identities` (global; E.164 phone unique; optional GSTIN/FSSAI; consent version and timestamps) ↔ `retailers` (tenant private record: code, tier, credit limit amount/bills/days, `credit_mode enum[indicate, strict, stop]`, `payment_terms enum[PRE, ON, POST_FULFILLMENT]`, beat, lat/lng from device, `gst_reg_type`, `tally_ledger_name`, brand-DMS ids) ↔ `retailer_links(identity_id, tenant_id, retailer_id, linked_by enum[rep_onboarding, directory_optin, import], status)`. Better Auth memberships list a retailer's tenants; the PWA shows one card each. Credit, tier, band and code are absent from every retailer-role write contract and from the retailer `WITH CHECK` policy. Directory links start `stop`/`PRE`.

## Source

Synthesis §4.2 (docs/design/SYNTHESIS.md); research R07 §3.2, R08 §2–3.
