# 20 — What the shop sign-in lane (DOS-400) leaves open

Recorded 2026-09-29, by the second repair of the lane `feat/shop-login` (the desk gives a shop its app sign-in), after the
architect's ruling of the same day that a sign-in is never shared between distributors on the strength of a phone number
(docs/22 §8). Sources: the lane's build report with its two repair sections, and its two blind checks. Those reports live in
the session scratchpad, not in the repository. This file holds what the checks and the repair left on purpose; nothing here
is on the live server, because the lane is not merged.

Ids DOS-420 … DOS-428.

| Id | Priority | Category | One line |
| --- | --- | --- | --- |
| DOS-420 | P3 | security | The retailer role can read four tenant tables at the database level (not through the API) |
| DOS-421 | P2 | business-logic | A person shared across businesses who forgets the password has no desk that may reset it |
| DOS-422 | P3 | privacy | The audit row of a shop's sign-in shows the shopkeeper's user id to the back office |
| DOS-423 | P2 | product | One login for every distributor a shop buys from waits for sign-in by OTP |
| DOS-424 | P2 | security | Hiring by phone still shares a login between distributors on the strength of a number |
| DOS-425 | P3 | business-logic | A shop the data already shares cannot be given its sign-in again after a stop |
| DOS-426 | P3 | security | An access token issued before a desk's reset is not walled until it expires |
| DOS-427 | P3 | coverage | The shop sign-in screens were walked in a browser only, not on a phone build |
| DOS-428 | P2 | ux | The desk is told to change the shop's mobile "on the shop", and its shop page has no place for it |

### DOS-420 — The retailer role can read four tenant tables at the database level (not through the API)
Category: security | Priority: P3 | Role: Retailer | Platform: database (`app_rw` with the shopkeeper's settings) | Found by: blind check 2, minor 8

```
What happens: connected as app_rw with a shopkeeper's settings (app.actor_role = retailer), SQL can read the tenant's
  idempotency_keys, memberships, users (the rows the tenant policy lets a member see) and retailer_links, including rows
  that are not the shop's own. No API procedure exposes them to the retailer role, so nothing leaks today; the rows are
  one policy away from it.
What it should do: the retailer role reads only the rows that name its own login or its own shop, as the other shop
  tables already do (`tenantOrOwnRetailerPolicy`).
Pre-existing; not changed by the lane.
```

### DOS-421 — A person shared across businesses who forgets the password has no desk that may reset it
Category: business-logic | Priority: P2 | Role: Shopkeeper, staff of two businesses | Platform: API, all apps | Found by: build report §7, repair 1 "not done", repair 2

```
What happens: the rule that keeps one business from taking over another's login (a new password, name or mobile only for a
  person who belongs to this business alone) also means that no desk may reset the password of a shopkeeper who buys from
  two distributors, or of a person who works for two. `auth.forgotPassword` exists, but its token has no delivery channel
  (it is written to the service log outside production and sent nowhere in production).
What it should do: the self-service reset reaches the person (SMS / WhatsApp, the OTP layer docs/22 §7 defers), or the
  console gets an audited reset for this case.
```

### DOS-422 — The audit row of a shop's sign-in shows the shopkeeper's user id to the back office
Category: privacy | Priority: P3 | Role: Owner / Manager / Accountant | Platform: API (`tenancy.audit.list`) | Found by: blind checks 1 and 2, kept unchanged by repair 1

```
What happens: `audit_log` rows `retailer.sign_in.give`, `.password` and `.stop` carry the login's global user id, which the
  back office reads in the audit list. The same id is already on the shop's link the desk reads, it is scoped to this
  distributor's own audit, and it names no other business; the checks called it not a leak.
What it should do: name the login by its username in the audit, and keep the id out of what a desk reads.
```

### DOS-423 — One login for every distributor a shop buys from waits for sign-in by OTP
Category: product | Priority: P2 | Role: Shopkeeper | Platform: all | Found by: the architect's ruling of 2026-09-29 (R1, item 4)

```
What happens now (by the ruling): a number whose sign-in another business made — another distributor's shopkeeper or
  staff, or a console account — gets no sign-in from this desk. The desk is told the number already has a Distribution OS
  sign-in that cannot be shared yet and to use another mobile number of the shopkeeper; a shopkeeper who buys from two
  distributors then has two logins. Shops the data already shares (the demo seed's) keep working as they are.
What it should be later: one login for every distributor the shop buys from, once the platform can prove who holds a phone
  (sign-in by OTP), at which point the desk's "existing" answer can attach a proven number again.
```

### DOS-424 — Hiring by phone still shares a login between distributors on the strength of a number
Category: security | Priority: P2 | Role: Owner / Manager (staff screen) | Platform: API (`tenancy.staff.create`) | Found by: repair 2, reading the staff door against ruling R1

```
What happens: `tenancy.staff.create` looks the person up by username or phone across the platform and, when found, adds a
  membership here without touching the person's password. If that login was made by another business's desk and its first
  password has not been changed yet, the desk that made it still knows it: it can sign in (at this distributor, as this
  distributor's staff), is held at "Change your password" by the server's wall (R2), changes it — the wall lets it — and
  then works as this distributor's staff. The shop door refuses exactly this since R1; the staff door does not.
What it should do (needs a ruling): the same rule for the staff door as for the shop door — refuse to add a person whose
  login another business made — or at least refuse while that person's password is a desk's first password.
Not changed by the lane: it is a product decision about who may hire whom.
```

### DOS-425 — A shop the data already shares cannot be given its sign-in again after a stop
Category: business-logic | Priority: P3 | Role: Owner / Manager | Platform: API, desk shop page | Found by: repair 2 (ruling R1 read strictly)

```
What happens: a shopkeeper the demo data shares between distributors (ramesh.gupta, fatima.shaikh) keeps signing in, keeps
  the distributor switcher and can be stopped at one distributor, as the ruling says. Given again at that distributor after a
  stop, the desk hears the ruling's 409 ("… cannot be shared yet"), because the login belongs to another business too.
  Proven over the API (Tarsun stops ramesh.gupta, Sai and Kalyan still take him, the give again is refused).
What it should do: as ruled, until sign-in by OTP (DOS-423); recorded so the next lane reads "keep working as they are" the
  same way. The live site has no such shared shop (the product could not give a shop a sign-in before this lane).
```

### DOS-426 — An access token issued before a desk's reset is not walled until it expires
Category: security | Priority: P3 | Role: all | Platform: API | Found by: repair 2

```
What happens: the first-password wall rides in the access token (`pwc`), because every service verifies the token without a
  database read. A desk's new first password revokes every refresh token of the person at once, but an access token issued
  before the reset keeps working, unwalled, until it expires (15 minutes, the access-token lifetime). Every token issued
  after the reset carries the wall. Pre-existing: the same delay applies to a stopped membership or a disabled user.
What it should do: accept the delay as the price of stateless services (as today), or shorten the access-token lifetime.
```

### DOS-427 — The shop sign-in screens were walked in a browser only, not on a phone build
Category: coverage | Priority: P3 | Role: Owner / Manager / Shopkeeper | Platform: Android, iOS | Found by: build report, repairs 1 and 2

```
What happens: the give dialog, the one-button telling dialogs, Copy and Share with their failure words, the shops list's
  phone rows and the change-password screen's "not the one you have now" were walked in a web browser at 390 px and
  1280 px. No Android or iOS build was run in this lane. The native halves exist (`share.native.ts` says a share sheet is
  there; `clipboard.native.ts`; the native Dialog draws one button when `cancelLabel` is null) but are unproven on a device.
What it should do: one walk on the Pixel 7 and one on the iOS simulator before release.
```

### DOS-428 — The desk is told to change the shop's mobile "on the shop", and its shop page has no place for it
Category: ux | Priority: P2 | Role: Owner / Manager | Platform: web, Android, iOS | Found by: repair 2

```
What happens: when the shop's own mobile already has a sign-in made at another business (R1), or the desk types a mobile for
  a shop that has one, the words say to use another mobile number of the shopkeeper and change it on the shop. The owner's
  and the manager's shop page shows the phone but has no way to change it; only the salesperson's shop form edits a shop
  (`retailers.upsert`, which the owner and the manager may also call).
What it should do: the desk's shop page lets the owner and the manager change the shop's mobile, or the sign-in dialog
  takes another number and saves it on the shop (keeping the old one as the second number, as it now does for a landline).
```
