# Product Success Metrics (KPIs)

## Document Information

| Property     | Value                          |
| ------------ | ------------------------------ |
| Document     | Product Success Metrics (KPIs) |
| Product      | Distribution OS                |
| Version      | 2.2                            |
| Status       | Active                         |
| Owner        | Prajwal Chavan                 |
| Last Updated | 29 September 2026              |

---

# Purpose

This document defines the Key Performance Indicators (KPIs) used to measure the success of Distribution OS: whether the platform improves distributor operations, increases productivity, reduces manual effort, and delivers measurable business value.

Each KPI states **whether it can be measured from the data the product records**, and names the table or procedure that answers it. A KPI that no table can answer is a wish, not a metric, and is marked as such.

The measurability answers below are read from the database schema and the contract procedures, not from intent. KPIs are grouped **by role** (owner; manager + accountant; sales; warehouse; delivery; retailer; platform admin), because each role reaches its own backend service and sees only the numbers that service serves. The six business roles share one app that becomes the right app after sign-in, so the grouping is by who is signed in. Inside each section the KPIs keep a functional grouping.

---

# How to Read the Measurability Column

| Marker       | Meaning                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| **Measured** | The data is recorded in the product's database. The table or procedure is named.           |
| **Partial**  | Some inputs are recorded; the KPI cannot be computed exactly from them. The gap is stated. |
| **Not yet**  | Nothing is recorded, or the metric lives outside the product database.                     |

- **Measured means visible.** A "Measured" KPI below generally has a screen behind it, not only a query.
- **The reporting module serves the numbers.** Everything named `reporting.*` below — the owner dashboard, the daily stats, the registers and the series behind the charts — is live, alongside the per-module registers.

---

# 1. Owner — Business Operations and Growth

| KPI                                   | Measurable | Source                                                                                   |
| ------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| Order processing time                 | Measured   | `sales_orders.submitted_at` → `order_state_transitions` → `invoices.issued_at`           |
| Orders received / processed           | Measured   | `sales_orders.state`, `orders.list`; rollup `daily_tenant_stats`                         |
| Order completion rate                 | Measured   | states delivered / partially_delivered / closed vs cancelled                             |
| Average order value                   | Measured   | `invoices.total_paise`, `billing.registers.salesRegister`                                |
| Sales growth (month over month)       | Measured   | `invoices` by month; the month-grain growth chart is served by `reporting.series.growth` |
| Gross margin / profitability          | Measured   | `reporting.series.grossMargin`, owner and money desk only                                |
| Orders processed per operator per day | Measured   | `sales_orders.created_by` / `salesperson_id`                                             |
| Workflow automation rate              | Partial    | auto-confirmed orders vs `approvals` raised; no single automation ratio                  |
| Manual data entry time                | Partial    | `docint.stats` (edits and latency per bill); nothing for orders                          |
| Paper-based activities %              | Not yet    | Qualitative; deliberately not a system data point — assessed by review                   |
| Attendance and activity               | Partial    | `auth_events` sign-ins, `devices.last_seen_at`; no attendance model in v1                |

The owner's screens show graphs wherever possible — growth and how the distributorship is performing. Cost, landed cost and margin are readable only by owner, manager, accountant and system — a database policy with tests, not an app rule — so margin KPIs never appear on the sales, warehouse, delivery or retailer screens.

One tenant is one distributorship. There is no branch dimension in v1, so no KPI is grouped by branch; multi-branch (each branch its own tenant plus an owner group view) comes after version 1.

# 2. Manager and Accountant — Finance, Collections and Registers

| KPI                                   | Measurable | Source                                                                                    |
| ------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| Outstanding amount                    | Measured   | `retailer_outstanding_summary`, `receivables.outstanding.list`                            |
| Collection rate                       | Measured   | `receipts` + `allocations` vs `invoices`; `reporting.registers.collections`               |
| Average collection period             | Measured   | allocation date − invoice date; `reporting.retailers.behaviour`                           |
| Overdue customers                     | Measured   | ageing buckets 0-7 / 8-15 / 16-30 / 31-60 / 61-90 / 90+, `ageing_snapshots`               |
| Credit utilisation                    | Measured   | `retailers.credit_limit_paise` vs outstanding, `receivables.creditCheck`                  |
| Cash collection accuracy              | Measured   | `trip_settlements.cash_variance_paise`, `has_variance`                                    |
| Payment recording time                | Measured   | `receipts.received_at` vs `created_at`; `sync_ops` for offline lag                        |
| Order accuracy (no correction needed) | Partial    | `credit_notes.reason`, `pick_lines.short_reason`; no explicit "corrected" flag            |
| GST registers (sales / purchase)      | Measured   | `billing.registers.salesRegister`, plus the GST sales and purchase registers in reporting |

The accountant is the **money desk plus reads** — office receipts, deposits, cheque bounces, write-offs, and every export — with no prices, schemes, credit limits, approvals or settings. Credit-approval KPIs are therefore the owner's and the manager's, not the accountant's. The manager also approves load-out from the manager's screens, so time-to-approve is measurable from the load sheet timestamps.

# 3. Sales — Productivity and Coverage

| KPI                                         | Measurable | Source                                                                                    |
| ------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| Sales orders per salesperson                | Measured   | `sales_orders.salesperson_id`; `reporting.registers.repDaily`                             |
| Salesman productivity (value booked)        | Measured   | orders and invoices by `salesperson_id`; `reporting.registers.repProductivity`            |
| Customer visit completion (planned vs done) | Partial    | `visits` recorded; planned visits are `pjp` + `beat_assignments`, no procedure joins them |
| Shops covered / lapsed shops                | Partial    | order history per retailer; `reporting.retailers.lapsed`                                  |
| Target achievement                          | Measured   | the incentives module — plans, targets, slabs, statements                                 |
| Collections by salesperson                  | Not a KPI  | The salesperson never records a receipt                                                   |

Only the delivery crew collects money, or the shop pays online. Collections belong to Delivery and the money desk, and the sales service carries no receipt endpoint at all. The rep may **see** a shop's outstanding and run a credit check before booking — that is a read, and it is deliberate.

# 4. Warehouse — Inventory and Task Throughput

| KPI                                     | Measurable | Source                                                                                                                                                                                                        |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory accuracy (system vs physical) | Measured   | `cycle_count_lines` expected vs counted, `inventory.cycleCounts.post`                                                                                                                                         |
| Inventory age                           | Measured   | `stock_lots.mfg_date` and GRN date; near-expiry view in `reporting.registers.stockValue`                                                                                                                      |
| Expired inventory value                 | Measured   | `stock_lots.expiry_date` × `tenant_product_costs` — **owner/manager/accountant only; never shown on the warehouse screens**, because row-level security blocks the warehouse role from `tenant_product_costs` |
| Warehouse tasks completed               | Measured   | `picklists`, `pack_confirmations`, `load_sheets`, each with actor and timestamps                                                                                                                              |
| Average task completion time            | Measured   | `picklists.started_at` / `completed_at`; GRN count and post times                                                                                                                                             |
| Stock availability %                    | Partial    | `stock_balances` and the `sellable_stock` view give now; no availability history                                                                                                                              |
| Out-of-stock events                     | Partial    | no stockout event is recorded; `pick_lines.short_reason` and unfilled `reservations` approximate it                                                                                                           |
| Picking accuracy                        | Partial    | requested vs picked with a short reason; wrong-item picks are not captured                                                                                                                                    |
| Loading accuracy                        | Partial    | `load_sheets.expected_packages` / `counted_packages`, `variance_note`; no per-item variance                                                                                                                   |
| Inventory turnover                      | Partial    | derivable from `stock_ledger` + `stock_balances`; no procedure computes it                                                                                                                                    |

The product records no **stockout event**, so out-of-stock is inferred rather than counted, and no **per-item load variance**, so loading accuracy is counted by package.

# 5. Document Intake Quality

Zero manual entry is a headline promise — a supplier bill becomes a GRN with no typing except the blind gate count — and it has KPIs of its own.

| KPI                                                | Measurable | Source                                               |
| -------------------------------------------------- | ---------- | ---------------------------------------------------- |
| Line recall (lines extracted vs lines on the bill) | Measured   | `docint.stats`                                       |
| Edits per ten extracted lines                      | Measured   | `docint.stats` — the honest measure of "zero typing" |
| Bill-to-GRN latency (p95)                          | Measured   | `docint.stats`                                       |
| Bills verified by e-invoice QR / IRN               | Measured   | `docint.stats`                                       |
| SKU auto-match rate before human review            | Measured   | `docint.stats`                                       |

The document-intake module records all five for every supplier bill it reads. A human always reviews before a GRN is committed — that is a non-negotiable, so "fully automatic commits" is not and will never be a KPI.

# 6. Delivery — Delivery Performance

| KPI                                           | Measurable | Source                                                                                                            |
| --------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| On-time delivery rate                         | Measured   | `trip_stops.eta_at` vs `arrived_at`; `reporting.registers.deliveryPerformance`                                    |
| Delivery completion rate                      | Measured   | `trip_stops.state` delivered / partial / failed; `deliveries.outcome`                                             |
| Average delivery time                         | Measured   | `load_sheets.confirmed_at` / `trips.started_at` → `deliveries.delivered_at`                                       |
| Failed deliveries                             | Measured   | `trip_stops.failure_reason` (shop closed, refused, no cash, wrong address)                                        |
| GPS tracking coverage                         | Measured   | `trip_points` per trip, `location_consents`                                                                       |
| Delivery proof completion                     | Measured   | `pod_evidence` per delivery; the proof-of-delivery coverage chart                                                 |
| Deliveries per driver                         | Measured   | `trips.driver_id` / `helper_id`, `deliveries.delivered_by`                                                        |
| Doorstep collection accuracy                  | Measured   | `trip_settlements.cash_variance_paise` at trip close                                                              |
| Delivery route efficiency (planned vs actual) | Measured   | actual from `trips.start_odometer_km` / `end_odometer_km` and `trip_points`; planned distance from the route plan |

Route sequencing (stop sequencing by distance and time windows, the driver may override) is what makes "route efficiency" measurable — it creates the planned distance the KPI needs.

# 7. Retailer — Customer Management

| KPI                       | Measurable | Source                                                                                                       |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Active retailers          | Measured   | `sales_orders` by retailer; `reporting.retailers.behaviour`                                                  |
| New customers onboarded   | Measured   | `retailers.created_at`, `onboarded_by`                                                                       |
| Repeat order rate         | Measured   | `sales_orders` per retailer over time                                                                        |
| Customer retention        | Measured   | derived from order history; `reporting.retailers.lapsed`                                                     |
| Online payment share      | Measured   | `receipts` by mode (cash / UPI / cheque / online)                                                            |
| Complaint resolution time | Not yet    | no complaint entity exists; nearest is `inbound_messages.handled` in notifications, with no resolution clock |
| Customer satisfaction     | Not yet    | no feedback capture                                                                                          |

The shop places orders itself and pays online, and one shop login can be linked to several distributors — so retailer KPIs are per distributor, never pooled across tenants. Complaint resolution time needs a complaint or issue entity, which the product does not have.

# 8. Platform Admin App — Adoption and Business Growth

A separate app and service, "Distribution OS - Admin" (`platform_admin`, admin-service :3007), covers organisation onboarding, plans and subscription state, and time-boxed, owner-approved, audited support access. The numbers below come from it.

| KPI                          | Measurable | Source                                                                |
| ---------------------------- | ---------- | --------------------------------------------------------------------- |
| Organizations onboarded      | Measured   | `tenants` (`plan`, `status`)                                          |
| Active organizations         | Measured   | `auth_sessions.last_used_at` per tenant                               |
| Daily / monthly active users | Measured   | `auth_events` (kind = login), `auth_sessions`                         |
| User retention               | Measured   | derived from `auth_sessions` over time                                |
| Customer acquisition rate    | Measured   | `tenants.created_at`                                                  |
| Feature adoption rate        | Partial    | `audit_log`, `feature_flags`; no per-procedure usage counter          |
| Mobile app adoption          | Partial    | `devices.platform`, `auth_sessions.platform`                          |
| Customer churn rate          | Measured   | subscription state in the platform console, cancellation included     |
| Monthly recurring revenue    | Measured   | plan and subscription state in the platform console                   |
| ARPO, CLV, CAC, CLV:CAC      | Not yet    | outside the product database; kept in a finance sheet                 |
| Revenue model                | —          | Distributor subscription only; no payments aggregation and no lending |

# 9. Platform Performance and Reliability

| KPI                         | Measurable | Source                                                    |
| --------------------------- | ---------- | --------------------------------------------------------- |
| Background job success rate | Measured   | pg-boss `job` / `archive` tables                          |
| Failed transactions         | Partial    | `sync_errors`, `auth_events`, unpublished `outbox_events` |
| System availability         | Not yet    | `/health` on every service; no uptime store               |
| Average API response time   | Not yet    | no APM or request log                                     |
| Mobile app crash rate       | Not yet    | no crash reporter                                         |

Availability, latency and crash rate become measurable once an uptime store, an APM and a crash reporter are in place.

# Owner Day View — Tiles and Their Sources

| Tile group | Tiles                                                                    | Data                                                                            |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Sales      | Today's orders, today's sales, pending orders, cancelled orders          | All present; tile served by `reporting.dashboard.owner`                         |
| Inventory  | Stock value, low stock, out of stock, expiring                           | Stock value and expiry present; "out of stock" is inferred, not an event        |
| Delivery   | Pending, in transit, delivered today, failed                             | All present from `trips` and `trip_stops`                                       |
| Finance    | Outstanding, today's collections, overdue customers, cash reconciliation | All present from receivables and `trip_settlements`                             |
| Workforce  | Active reps, active drivers, warehouse activity, productivity            | Present from orders, trips and warehouse tasks; `reporting.registers.repDaily`  |
| Platform   | Active users, system health, background jobs, API status                 | Active users and jobs present; system health and API status have no data source |

---

# The Data Behind the KPI Set

1. **The reporting series** — one procedure serving month and week grain, year-over-year comparison, and grouping by brand, beat, salesperson, payment mode or vehicle. The owner's growth, brand-mix and margin charts run on it.
2. **`by_beat` on the daily tenant statistics**, so sales-by-beat needs no live scan.
3. **Ageing history and per-retailer series**, from nightly ageing snapshots.
4. **Subscription state and cancellations** in the platform console, so MRR and churn are measurable.
5. **Planned route distance**, from the AI route sequencing, giving route efficiency its denominator.
6. **Stockout events and per-item load variance** are not recorded — the two Partial rows above.
7. **A complaint or issue entity** does not exist and is not part of version 1, so complaint resolution time is not a KPI.

---

# Targets and Baselines

No numeric target is set on this page, and that is deliberate: **a target without a baseline is a guess.** In a distributor's first two weeks on the product, the baseline for every "Measured" KPI is recorded from the system itself; targets are then set against that baseline with the distributor, one KPI group at a time, and revised quarterly. The only standing target is the long-term platform goal of 99.9 % availability.

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

| KPI group                           | Owner in the product                   | Role               |
| ----------------------------------- | -------------------------------------- | ------------------ |
| Business operations and growth      | Distributor owner                      | Owner              |
| Order flow, finance and collections | Manager and accountant                 | Manager            |
| Sales productivity and coverage     | Manager (rep-level), owner             | Manager, Owner     |
| Inventory and warehouse             | Manager (supervision), warehouse staff | Manager, Warehouse |
| Delivery performance                | Manager (day-end), delivery crew       | Manager, Delivery  |
| Customer activity                   | Owner and manager                      | Owner, Manager     |
| Adoption, subscription, growth      | Distribution OS platform team          | Platform Admin     |
| Platform performance                | Distribution OS engineering            | —                  |

Sales Manager, Warehouse Manager and Logistics Manager are not separate roles in the product: the `manager` role absorbs all three, and the accountant shares the manager screens with a money-desk-plus-reads permission set.

---

# Guiding Principles

- Measure outcomes, not just activity.
- Prioritise actionable metrics over vanity metrics.
- Automate KPI collection wherever possible.
- **Every KPI names the table or procedure that answers it.** If nothing does, it is marked "Not yet" and stays that way until a module makes it true.
- **No KPI may expose purchase cost or margin to a role that is not allowed to see it** — that boundary is enforced in the database, and a report is not an exception to it.
- Review KPIs regularly and refine as the product evolves.
