# Product Success Metrics (KPIs)

## Document Information

| Property     | Value                          |
| ------------ | ------------------------------ |
| Document     | Product Success Metrics (KPIs) |
| Product      | Distribution OS                |
| Version      | 2.0                            |
| Status       | Active                         |
| Owner        | Product Management             |
| Last Updated | September 2026                 |

---

# Purpose

This document defines the Key Performance Indicators (KPIs) used to measure the success of Distribution OS: whether the platform improves distributor operations, increases productivity, reduces manual effort, and delivers measurable business value.

Version 2.0 keeps the KPI set of version 1.0 and adds the one thing it was missing — **whether each KPI can actually be measured from the system today**, and if not, which module will make it measurable. A KPI that no table can answer is a wish, not a metric, and is now marked as such.

**Decided 2026-09-05:** the repository file `docs/22-source-of-truth.md` is the single source of truth for product shape and founder decisions; this space mirrors it. Measurability answers below come from the alignment audit `docs/24-confluence-alignment.md` §2.2, which checked every KPI on this page against the database schema and the contract procedures, not against intent. KPIs are now grouped **by app** (owner; manager + accountant; sales; warehouse; delivery; retailer; platform admin), because each role signs into its own app on its own backend service and sees only the numbers that app serves; the version 1.0 functional grouping is preserved inside each section.

---

# How to Read the Measurability Column

| Marker       | Meaning                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Measured** | The data is recorded in the working database today. The table or procedure is named. A dashboard or chart for it may still be planned. |
| **Partial**  | Some inputs exist; the KPI cannot yet be computed exactly. The gap is stated.                                                          |
| **Not yet**  | Nothing is recorded. The module that will make it measurable is named, or the metric lives outside the product database.               |

- **Measurable is not visible.** As at 2026-09-05 13:45 IST: **14 backend modules verified, 1,442 automated tests, 1,004 endpoint calls exercised, 0 broken** (Build Status & Roadmap mirrors `docs/18-build-log.md`). No app screen exists yet. Most "Measured" KPIs today are answered by a query or a register endpoint, not by a tile.
- **The reporting module is module 9 of the current build chain and is not built.** Everything named `reporting.*` below — `reporting.dashboard.owner`, `reporting.dailyStats.*`, `reporting.registers.*`, `reporting.series.get` — is planned, not live. Until it lands, KPI reporting is per-module registers.

---

# 1. Owner App — Business Operations and Growth

| KPI                                   | Measurable | Source today                                                                     |
| ------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| Order processing time                 | Measured   | `sales_orders.submitted_at` → `order_state_transitions` → `invoices.issued_at`   |
| Orders received / processed           | Measured   | `sales_orders.state`, `orders.list`; rollup `daily_tenant_stats` planned         |
| Order completion rate                 | Measured   | states delivered / partially_delivered / closed vs cancelled                     |
| Average order value                   | Measured   | `invoices.total_paise`, `billing.registers.salesRegister`                        |
| Sales growth (month over month)       | Measured   | `invoices` by month; the **month-grain chart** needs `reporting.series.get`      |
| Gross margin / profitability          | Partial    | `owner_summary` is month-to-date only; margin by month and by brand missing      |
| Orders processed per operator per day | Measured   | `sales_orders.created_by` / `salesperson_id`                                     |
| Workflow automation rate              | Partial    | auto-confirmed orders vs `approvals` raised; no single automation ratio          |
| Manual data entry time                | Partial    | `docint.stats.summary` (edits and latency per bill, planned); nothing for orders |
| Paper-based activities %              | Not yet    | Qualitative; deliberately not a system data point — assessed at the pilot review |
| Attendance and activity               | Partial    | `auth_events` sign-ins, `devices.last_seen_at`; no attendance model in v1        |

**Decided 2026-09-04:** the owner app must show graphs wherever possible — growth and how the distributorship is performing. `docs/23-app-screens-and-api-gaps.md` §1.2 lists 23 charts the owner screens need and the series behind each; the gaps that block them are in "What must be built" below. Cost, landed cost and margin are readable only by owner, manager, accountant and system — a database policy with tests, not an app rule — so margin KPIs never appear in the sales, warehouse, delivery or retailer apps.

**Decided 2026-09-05:** one tenant = one distributorship. There is no branch dimension in v1, so no KPI is grouped by branch; multi-branch (each branch its own tenant plus an owner group view) is v2.

# 2. Manager and Accountant App — Finance, Collections and Registers

| KPI                                   | Measurable | Source today                                                                               |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Outstanding amount                    | Measured   | `retailer_outstanding_summary`, `receivables.outstanding.list`                             |
| Collection rate                       | Measured   | `receipts` + `allocations` vs `invoices`; `registers.collections` planned                  |
| Average collection period             | Measured   | allocation date − invoice date; `retailer_behaviour.avgDaysToPay` planned                  |
| Overdue customers                     | Measured   | ageing buckets 0-7 / 8-15 / 16-30 / 31-60 / 61-90 / 90+, `ageing_snapshots`                |
| Credit utilisation                    | Measured   | `retailers.credit_limit_paise` vs outstanding, `receivables.creditCheck`                   |
| Cash collection accuracy              | Measured   | `trip_settlements.cash_variance_paise`, `has_variance`                                     |
| Payment recording time                | Measured   | `receipts.received_at` vs `created_at`; `sync_ops` for offline lag                         |
| Order accuracy (no correction needed) | Partial    | `credit_notes.reason`, `pick_lines.short_reason`; no explicit "corrected" flag             |
| GST registers (sales / purchase)      | Partial    | `billing.registers.salesRegister` built; `reporting.registers.gstPurchaseRegister` planned |

**Decided 2026-09-05:** the accountant is the **money desk plus reads** — office receipts, deposits, cheque bounces, write-offs, and every export — with no prices, schemes, credit limits, approvals or settings. Credit-approval KPIs are therefore the owner's and the manager's, not the accountant's (version 1.0 listed credit approvals under the accountant; superseded). The manager also approves load-out from the manager app, so time-to-approve is measurable from the load sheet timestamps and should become a manager KPI at the pilot.

# 3. Sales App — Productivity and Coverage

| KPI                                         | Measurable  | Source today                                                                              |
| ------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Sales orders per salesperson                | Measured    | `sales_orders.salesperson_id`; `reporting.dailyStats.rep` planned                         |
| Salesman productivity (value booked)        | Measured    | orders and invoices by `salesperson_id`; `registers.repProductivity` planned              |
| Customer visit completion (planned vs done) | Partial     | `visits` recorded; planned visits are `pjp` + `beat_assignments`, no procedure joins them |
| Shops covered / lapsed shops                | Partial     | order history per retailer; `reporting.retailers.lapsed` planned                          |
| Target achievement                          | Not yet     | incentives module (10 in the chain) — plans, targets, slabs, statements                   |
| Collections by salesperson                  | **Removed** | Decided 2026-09-04: the salesperson never records a receipt                               |

**Decided 2026-09-04:** only the delivery crew collects money, or the shop pays online. Version 1.0 listed "Collections" as a Sales KPI; it now belongs to Delivery and the money desk, and the sales service carries no receipt endpoint at all. The rep may **see** a shop's outstanding and run a credit check before booking — that is a read, and it is deliberate.

# 4. Warehouse App — Inventory and Task Throughput

| KPI                                     | Measurable | Source today                                                                                                                                                                                              |
| --------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory accuracy (system vs physical) | Measured   | `cycle_count_lines` expected vs counted, `inventory.cycleCounts.post`                                                                                                                                     |
| Inventory age                           | Measured   | `stock_lots.mfg_date` and GRN date; near-expiry view in `registers.stockValue` (planned)                                                                                                                  |
| Expired inventory value                 | Measured   | `stock_lots.expiry_date` × `tenant_product_costs` — **owner/manager/accountant only; never shown in the Warehouse app**, because row-level security blocks the warehouse role from `tenant_product_costs` |
| Warehouse tasks completed               | Measured   | `picklists`, `pack_confirmations`, `load_sheets`, each with actor and timestamps                                                                                                                          |
| Average task completion time            | Measured   | `picklists.started_at` / `completed_at`; GRN count and post times                                                                                                                                         |
| Stock availability %                    | Partial    | `stock_balances` and the `sellable_stock` view give now; no availability history                                                                                                                          |
| Out-of-stock events                     | Partial    | no stockout event is recorded; `pick_lines.short_reason` and unfilled `reservations` approximate it                                                                                                       |
| Picking accuracy                        | Partial    | requested vs picked with a short reason; wrong-item picks are not captured                                                                                                                                |
| Loading accuracy                        | Partial    | `load_sheets.expected_packages` / `counted_packages`, `variance_note`; no per-item variance                                                                                                               |
| Inventory turnover                      | Partial    | derivable from `stock_ledger` + `stock_balances`; no procedure planned in any module                                                                                                                      |

Two gaps worth a decision before the pilot: a **stockout event** (so out-of-stock is counted, not inferred) and **per-item load variance**. Neither is in a module brief today.

# 5. Document Intake Quality (new in 2.0)

Zero manual entry is a headline promise — a supplier bill becomes a GRN with no typing except the blind gate count — and it needs KPIs of its own, which version 1.0 did not have.

| KPI                                                | Measurable | Source                                                 |
| -------------------------------------------------- | ---------- | ------------------------------------------------------ |
| Line recall (lines extracted vs lines on the bill) | Not yet    | docint module (5 in the chain), `docint.stats.summary` |
| Edits per ten extracted lines                      | Not yet    | docint module — the honest measure of "zero typing"    |
| Bill-to-GRN latency (p95)                          | Not yet    | docint module                                          |
| Bills verified by e-invoice QR / IRN               | Not yet    | docint module                                          |
| SKU auto-match rate before human review            | Not yet    | docint module                                          |

Target proposal for the pilot: **line recall ≥ 98 %**, and edits per ten lines trending down week over week. A human always reviews before a GRN is committed — that is a non-negotiable, so "fully automatic commits" is not and will never be a KPI.

# 6. Delivery App — Delivery Performance

| KPI                                           | Measurable | Source today                                                                                                       |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| On-time delivery rate                         | Measured   | `trip_stops.eta_at` vs `arrived_at`; `registers.deliveryPerformance` planned                                       |
| Delivery completion rate                      | Measured   | `trip_stops.state` delivered / partial / failed; `deliveries.outcome`                                              |
| Average delivery time                         | Measured   | `load_sheets.confirmed_at` / `trips.started_at` → `deliveries.delivered_at`                                        |
| Failed deliveries                             | Measured   | `trip_stops.failure_reason` (shop closed, refused, no cash, wrong address)                                         |
| GPS tracking coverage                         | Measured   | `trip_points` per trip, `location_consents`                                                                        |
| Delivery proof completion                     | Measured   | `pod_evidence` per delivery; `podCoverageRate` chart planned                                                       |
| Deliveries per driver                         | Measured   | `trips.driver_id` / `helper_id`, `deliveries.delivered_by`                                                         |
| Doorstep collection accuracy                  | Measured   | `trip_settlements.cash_variance_paise` at trip close                                                               |
| Delivery route efficiency (planned vs actual) | Partial    | actual is `trips.start_odometer_km` / `end_odometer_km` and `trip_points`; **planned distance does not exist yet** |

**Decided 2026-09-05:** route sequencing is in v1 (AI module 12: stop sequencing by distance and time windows, driver may override). That decision is what makes "route efficiency" measurable — it creates the planned distance the KPI needs. Until module 12 lands, only actual distance exists. This supersedes the earlier "route optimisation is not planned" position.

# 7. Retailer App — Customer Management

| KPI                       | Measurable | Source today                                                                                                        |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Active retailers          | Measured   | `sales_orders` by retailer; `retailer_behaviour.ordersLast30` planned                                               |
| New customers onboarded   | Measured   | `retailers.created_at`, `onboarded_by`                                                                              |
| Repeat order rate         | Measured   | `sales_orders` per retailer over time                                                                               |
| Customer retention        | Measured   | derived from order history; `retailers.lapsed` planned                                                              |
| Online payment share      | Measured   | `receipts` by mode (cash / UPI / cheque / online)                                                                   |
| Complaint resolution time | Not yet    | no complaint entity exists; nearest is `inbound_messages.handled` (notifications, planned) with no resolution clock |
| Customer satisfaction     | Not yet    | no feedback capture; still a future item                                                                            |

**Decided 2026-09-05:** the retailer app is in scope now, not "future" as version 1.0 said. The shop places orders itself and pays online, and one shop login can be linked to several distributors — so retailer KPIs are per distributor, never pooled across tenants. If complaint resolution time is to be a pilot KPI, it needs a complaint or issue entity that no module brief covers today; that is scope to raise, not assume.

# 8. Platform Admin App — Adoption and Business Growth

**Decided 2026-09-05:** a seventh app and service, "Distribution OS - Admin" (`platform_admin`, admin-service :3007), is in v1 — organisation onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access. Version 1.0 assumed these numbers existed; they did not, and module 13 is what will produce them.

| KPI                          | Measurable | Source today                                                                               |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Organizations onboarded      | Measured   | `tenants` (`plan`, `status`)                                                               |
| Active organizations         | Measured   | `auth_sessions.last_used_at` per tenant                                                    |
| Daily / monthly active users | Measured   | `auth_events` (kind = login), `auth_sessions`                                              |
| User retention               | Measured   | derived from `auth_sessions` over time                                                     |
| Customer acquisition rate    | Measured   | `tenants.created_at`                                                                       |
| Feature adoption rate        | Partial    | `audit_log`, `feature_flags`; no per-procedure usage counter                               |
| Mobile app adoption          | Partial    | `devices.platform`, `auth_sessions.platform`; no app shipped yet                           |
| Customer churn rate          | Partial    | `tenants.status`; no cancellation record — module 13 adds it                               |
| Monthly recurring revenue    | Not yet    | `tenants.plan` is an enum (pilot / starter / growth); no subscription billing — module 13  |
| ARPO, CLV, CAC, CLV:CAC      | Not yet    | outside the product database; tracked by the founder in a finance sheet                    |
| Revenue model                | —          | Distributor subscription only; no payments aggregation and no lending — non-goal unchanged |

# 9. Platform Performance and Reliability

| KPI                         | Measurable | Source today                                                                         |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| Background job success rate | Measured   | pg-boss `job` / `archive` tables                                                     |
| Failed transactions         | Partial    | `sync_errors`, `auth_events`, unpublished `outbox_events`                            |
| System availability         | Not yet    | `/health` on every service; no uptime store — deployment comes after the pilot build |
| Average API response time   | Not yet    | no APM or request log yet                                                            |
| Mobile app crash rate       | Not yet    | no app shipped yet                                                                   |

Availability, latency and crash rate become measurable once the product is deployed and an APM and crash reporter are chosen. Until then, quality is measured by the build gate: every module must pass the full test suite plus a smoke run that calls every published endpoint of every service with real seeded data and reports zero broken calls.

# Owner Day View — Tiles and Their Sources

| Tile group | Tiles                                                                    | Data today                                                                      |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Sales      | Today's orders, today's sales, pending orders, cancelled orders          | All present; tile served by `reporting.dashboard.owner` (planned)               |
| Inventory  | Stock value, low stock, out of stock, expiring                           | Stock value and expiry present; "out of stock" is inferred, not an event        |
| Delivery   | Pending, in transit, delivered today, failed                             | All present from `trips` and `trip_stops`                                       |
| Finance    | Outstanding, today's collections, overdue customers, cash reconciliation | All present from receivables and `trip_settlements`                             |
| Workforce  | Active reps, active drivers, warehouse activity, productivity            | Present from orders, trips and warehouse tasks; `daily_rep_stats` planned       |
| Platform   | Active users, system health, background jobs, API status                 | Active users and jobs present; system health and API status have no data source |

---

# What Must Be Built for the KPI Set to Be Complete

1. **`reporting.series.get`** — one procedure serving month and week grain, year-over-year comparison, and grouping by brand, beat, salesperson, payment mode or vehicle. Without it there is no growth chart, no brand mix and no margin trend (`docs/23` §1.2).
2. **`by_beat` on `daily_tenant_stats`** — added before the reporting module is built, or sales-by-beat is impossible without a live scan.
3. **Ageing history** (`receivables.ageing.history`) and **per-retailer series** — both missing today.
4. **Stockout events** and **per-item load variance** — to turn two Partial rows into Measured.
5. **Planned route distance** (AI module 12) — the denominator of route efficiency.
6. **Subscription state and cancellations** (module 13) — MRR and churn.
7. **A complaint or issue entity** — if complaint resolution time is to be a pilot KPI at all.

---

# Targets and Baselines

No numeric target is set on this page yet, and that is deliberate: **a target without a baseline is a guess.** In the first two weeks of the Tarsun Enterprises pilot, the baseline for every "Measured" KPI is recorded from the system itself; targets are then set against that baseline with the distributor, one KPI group at a time, and revised quarterly. The only standing target today is the long-term platform goal of 99.9 % availability, which cannot be measured before deployment.

---

# KPI Review Process

| Frequency | Purpose                                                     |
| --------- | ----------------------------------------------------------- |
| Daily     | Operational monitoring (owner and manager day views)        |
| Weekly    | Team performance review (sales, warehouse, delivery)        |
| Monthly   | Business performance analysis (growth, margin, collections) |
| Quarterly | Product strategy review and target revision                 |
| Annually  | Strategic planning and roadmap alignment                    |

---

# Ownership

| KPI group                           | Owner in the product                   | App                |
| ----------------------------------- | -------------------------------------- | ------------------ |
| Business operations and growth      | Distributor owner                      | Owner              |
| Order flow, finance and collections | Manager and accountant                 | Manager            |
| Sales productivity and coverage     | Manager (rep-level), owner             | Manager, Owner     |
| Inventory and warehouse             | Manager (supervision), warehouse staff | Manager, Warehouse |
| Delivery performance                | Manager (day-end), delivery crew       | Manager, Delivery  |
| Customer activity                   | Owner and manager                      | Owner, Manager     |
| Adoption, subscription, growth      | Distribution OS platform team          | Platform Admin     |
| Platform performance                | Distribution OS engineering            | —                  |

Version 1.0 assigned owners to a Sales Manager, a Warehouse Manager and a Logistics Manager. Those are not separate roles in the product: the `manager` role absorbs all three, and the accountant shares the manager app with a money-desk-plus-reads permission set (decided 2026-09-05).

---

# Guiding Principles

- Measure outcomes, not just activity.
- Prioritise actionable metrics over vanity metrics.
- Automate KPI collection wherever possible.
- **Every KPI names the table or procedure that answers it.** If nothing does, it is marked "Not yet" and stays that way until a module makes it true.
- **No KPI may expose purchase cost or margin to a role that is not allowed to see it** — that boundary is enforced in the database, and a report is not an exception to it.
- Review KPIs regularly and refine as the product evolves.

---

**Sources:** `docs/22-source-of-truth.md` (product shape and the dated decisions register), `docs/24-confluence-alignment.md` §2.2 (per-KPI measurability audit), `docs/23-app-screens-and-api-gaps.md` §1.2 (charts and the series behind them), `docs/18-build-log.md` (build status and verification numbers, 2026-09-05).
