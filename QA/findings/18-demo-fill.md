# Demo fill lane — what the API could not do for the dummy activity (brief `docs/plans/demo-activity-fill.md`)

Found 2026-09-29 while building `pnpm fill:demo` (lane `feat/demo-fill`), on look-alike tenants built from
nothing (`dos_test_fill`, `dos_test_fill_live`, `dos_test_fill_chaos`, `dos_test_fill_spec`) and on the ordinary
demo seed (`dos_test_fill_seed`), all-in-one API on :3850 with `NODE_ENV=production`. Every write was an API call
the app makes, as the person who makes it; nothing here was worked around with SQL or a new procedure.

Ids DOS-400 … DOS-419.

| Id      | Priority | Category        | One line                                                                                                                       |
| ------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| DOS-400 | P2       | missing-feature | No procedure gives a shopkeeper a login: `tester.shop1…3` cannot be made through the API                                       |
| DOS-401 | P1       | safety          | Nothing lets a writer keep an action quiet: with a message channel on, the dummy activity would message real shopkeepers       |
| DOS-402 | P3       | record          | Dummy work changes real master data that no row can mark: two real shops' credit limits, real stock, dummy bills on real shops |
| DOS-403 | P3       | record          | Bills, receipts and journal entries are dated by the server's clock: a run for an earlier business date dates them today       |

### DOS-400 — No procedure gives a shopkeeper a login

Category: missing-feature | Priority: P2 | Role that would need it: Owner or Manager (the onboarders) | Platform: API

```
User: Owner (owner.<slug>) via owner-service /owner
Steps:
  1. POST /owner/tenancy/staff {role: 'retailer', …} → 400: StaffRoleSchema excludes 'retailer' by design
     ("A retailer is never staff — it arrives through retailers.linkIdentity").
  2. POST /owner/retailers/{id}/link {phone} → 200: a retailer identity is created for the phone and linked to
     the shop, but with no user (identity.userId is null unless a login with that phone already exists and is
     visible to this distributor) and no membership of role 'retailer'.
  3. Memberships are inserted only by tenancy.staff.create (never 'retailer') and by the platform console's
     onboarding (the owner). No procedure of any role creates a retailer membership or sets its password.
Expected: the desk can give a shop a sign-in (a username and a temporary password, like staff), so a tester can
open the shopkeeper's app on a real shop.
Actual: impossible through the API; the seed makes shopkeeper logins with SQL.
What the tool does instead: three real shops with no login (and a phone, when there are enough) STAND IN for
tester.shop1…3. Each day each of them gets a bill delivered on credit (dues), a bill on a van still to come, the
tool's offer ("buy 12, get 1 free", for these three shops only) and a last order to repeat. check:demo-coverage
reads their row as the owner and prints "known gap DOS-400" for the login; the tool reports the shopkeeper row
"partly" and still exits 0. When a procedure exists, the tool can link tester.shop1…3 to these same three shops.
```

### DOS-401 — Nothing lets a writer keep an action quiet: dummy activity would message real shopkeepers

Category: safety | Priority: P1 | Role that would need it: Owner (a tenant setting, or a per-write "do not announce") | Platform: API + worker

```
Steps (read in the code, not sent: the lane has no provider credentials):
  1. The tool's writes emit the same outbox events as a person's: OrderConfirmed, InvoiceIssued (at pack),
     DeliveryRecorded, ReceiptRecorded, TripDeparted.
  2. worker/src/jobs/notifications.ts turns each into a queued message to the shop's phone of record, TripDeparted
     into a "delivery today" message per pending stop at 07:00 IST, and the dues of every overdue shop into a
     reminder at 09:00 IST. The shops the tool bills are REAL shops (the pilot's own, with real phones).
  3. createProviders() sends through Meta (WHATSAPP_ACCESS_TOKEN) or MSG91 (MSG91_AUTH_KEY) as soon as either is
     set; today neither is set on the server (vm-setup.sh), so the stub provider swallows them.
Expected: a way to mark the tool's work as not to be announced (or a tenant-wide "no messages" switch the owner
turns on while testers use the real data).
Actual: none. The moment a channel is switched on, every nightly fill messages real shopkeepers about dummy
orders, bills, deliveries, payments and dues; the tester logins' profile phones (+91 70… numbers the tool picks)
may also belong to real people.
What the tool does instead: backend/infra/oracle-vm/fill-demo.sh and the nightly script it writes REFUSE to run
while WHATSAPP_ACCESS_TOKEN or MSG91_AUTH_KEY is set in /opt/dos/env/live.env ("a message channel is switched
on … nothing made").
```

### DOS-402 — Dummy work changes real master data that no row can mark

Category: record | Priority: P3 | Role: Manager (the change is the desk's) | Platform: API

```
The brief's table needs "one shop over its credit limit" on each rep's beat; the imported shops carry no limits.
The tool sets a strict limit (half the shop's real opening dues) on one real shop per rep beat, as tester.manager
(retailers.setCredit). There is no field to mark that change as dummy; audit_log keeps before/after with the
tester as actor, and check:demo-rows counts the shops ("shops whose credit terms a tester login set").
Likewise the tool's orders take real stock down and its supplier bills (typed at the desk, posted through the
gate count) put stock back as new lots at the register's own purchase rate; the tool's bills on real shops are
dummy dues on real shops until the tool's own receipts clear them (a week at most).
Accepted by the founder's decision of 2026-09-28 (the database is rebuilt from the extracts before the first real
business day). Recorded so the rebuild is not skipped.
```

### DOS-403 — The API dates bills, receipts and journal entries by the server's clock

Category: record | Priority: P3 | Role: none (by design: no one may back-date a bill) | Platform: API

```
fill:demo --date names the business date whose work is made; the keys, the ids, the trips' dates, the visits'
times, the cheques' dates and the supplier bills' dates carry it. The bills (issued at pack), receipts and journal
entries are dated by the server when they are written. So the first run (which makes yesterday before today) and
a run after a night the server was down make yesterday's bills dated today. Nightly runs at 06:00 IST make
today's work, so the dates agree every day after the first.
```
