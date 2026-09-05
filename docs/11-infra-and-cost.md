<!-- Derived from the 2026-09-04 architecture synthesis (docs/design/SYNTHESIS.md §11). Edit here; the synthesis is the frozen source. -->

# Infrastructure, environments and cost

> **Superseded 2026-09-05 for the start (founder, docs/26):** least cost first — Lightsail Mumbai, Postgres in a container, all-in-one process mode, no PowerSync. The shape below (RDS, Fargate, ALB) is the scale target reached with revenue; the cost table remains the reference for that shape.

**Hosting (AWS ap-south-1 from day one).** RDS PostgreSQL 17 **`db.t4g.small`** Single-AZ, 20 GB gp3, 14-day PITR, `rds.logical_replication = 1`, `max_slot_wal_keep_size` set (resolved: 1 GiB on `t4g.micro` is marginal with a replication slot, pg-boss, pg_trgm and LISTEN/NOTIFY on the primary); ECS Fargate ARM `api` (0.5 vCPU/1 GB) and `worker` (0.25/0.5) from one image; ALB + ACM; CloudFront for both PWAs and signed image URLs; S3 `docs` (pre-signed, IA at 90 days) and `backups` (Object Lock); Secrets Manager with per-tenant KMS envelopes; SST v3. R2 rejected (no India jurisdiction, R08 §5.3). DigitalOcean BLR1 with Kamal is the same image if AWS setup time is unacceptable.

**Environments.** `local` (Compose: Postgres 17 `wal_level=logical`, MinIO, optional PowerSync OE, WhatsApp stub, Tarsun-shaped seed); `staging` (Mumbai, smallest sizes, anonymised data, EAS `preview`, WhatsApp test number, GSP/IRP sandboxes, separate Anthropic key); `prod`. Staging never points at production WhatsApp or GST endpoints.

**CI/CD.** GitHub Actions + Turborepo cache: PR → lint, typecheck, unit, integration on a Postgres container (RLS negatives, ledger invariants, idempotency and upload-log replay, role-leak dump), contract snapshots (OpenAPI, PowerSync schema, `/sync/upload` v1), retailer bundle budget; `main` → multi-arch image → ECR → one-shot migration task (expand/contract only) → ECS blue/green with 10-minute bake and auto-rollback; EAS Update on merge for JS-only changes; EAS Build on tag; nightly dependency audit; monthly restore-drill ticket.

**Observability.** OTel → Grafana Cloud Free; pino JSON logs with tenant/actor/request/idempotency ids; Sentry on all four surfaces; synthetic `/health` from inside and outside India. Alarms: 5xx rate, p95, pg-boss queue age, replication-slot lag and WAL retention, RDS storage/CPU, ledger drift, `sync_errors` rate per tenant, docint escalation rate and cost per page, WhatsApp delivery failures, monthly SMS/WhatsApp/Anthropic spend. Internal admin dashboard with per-tenant cost lines from week 1.

**Backups and DR.** PITR + nightly `pg_dump` to the Object-Locked bucket + `backup.verify` + monthly restore drill into a scratch instance with a checksum of `stock_balances` and AR totals — **the first drill in week 3, before any real data**. Stated **RPO 5 min / RTO 2 h**. S3 versioning. Cross-region copies to ap-south-2 at 10 tenants. Runbooks: restore, breach-72h, rotate secrets, revoke device, rollback, re-derive balances, PowerSync resync, Tally connector. k6 at 10× Tarsun volume in week 21.

### 11.1 Cost (USD/month, on-demand, ₹84/USD; infra from R08 §6.4, variable costs from R06 §4, R07 §8–10)

| Item                                                | 1 distributor  | 10                                | 100                                                            |
| --------------------------------------------------- | -------------- | --------------------------------- | -------------------------------------------------------------- |
| RDS Postgres                                        | 31 (t4g.small) | 148 (t4g.medium Multi-AZ, 100 GB) | 657 (m7g.large Multi-AZ + replica)                             |
| Fargate api + worker                                | 11             | 64                                | 255                                                            |
| ALB + CloudFront + Route 53                         | 22             | 25                                | 35                                                             |
| S3 + egress                                         | 2              | 12                                | 122                                                            |
| PowerSync (staff clients only)                      | 0 (Free)       | 49 (Pro)                          | ~250 (Pro + ~1,500 clients + data)                             |
| EAS                                                 | 0–19           | 19                                | 199                                                            |
| Observability                                       | 0              | 45                                | 150                                                            |
| Document intelligence (~120 pages/tenant, Sonnet 5) | 4              | 36                                | 360 (+30% with second opinion always on)                       |
| WhatsApp — included quota (3,000 msgs/tenant)       | 4              | 40                                | 400                                                            |
| WhatsApp beyond quota                               | pass-through   | pass-through                      | pass-through (an 11k-message tenant ≈ $15, billed in the plan) |
| OTP (WhatsApp auth first, long sessions)            | 3              | 30                                | 250                                                            |
| Maps / Routes; GSP (post-pilot)                     | 0              | ~30                               | ~200                                                           |
| **Total platform**                                  | **≈ $80–100**  | **≈ $500**                        | **≈ $2,900**                                                   |
| Per tenant                                          | $80–100        | ~$50                              | ~$29 (≈ ₹2,450)                                                |

Against R10 §4: a Tarsun-sized tenant at ₹2,500 base + ₹250 × 8 seats ≈ ₹4,500 (~$54); 100 such tenants ≈ ₹4.5 lakh revenue vs ≈ ₹2.5 lakh platform cost plus passed-through messaging. Positive but thin below ~30 tenants; marginal cost covered from roughly tenant 15. Hence: never price below ₹2,000/month, include a WhatsApp quota and meter beyond it, push OTP to WhatsApp auth with long staff sessions, buy reserved instances (30–40% off) once volume is predictable.
