# Sign-in, roles and one store app — design (Fable, architect, 2026-09-21)

Founder, 2026-09-21: *"ok make changes as per your recommendation, you got my expectations, do things
accordingly. I was thinking of hosting only one app in app store to save cost and then role based
logins for different users."* Three decisions follow. Each is recorded in docs/22 §8; this file is the
design they point at. Nothing here changes the server's security model — that is the whole point.

## 0. What stays true

- **One service per role, and a service refuses every other role before business logic** (2026-09-04).
  The permission matrix, RLS and the seven `describePermissionMatrix` specs are unchanged by all three
  designs below. Isolation lives on the server; the designs only change what a *device* asks for.
- **White label inside the app** (2026-09-04): Distribution OS shows itself on the welcome and sign-in
  screens and nowhere else; after sign-in the distributor's own name and logo are the chrome.
- **The salesperson never collects money; the retailer only ever acts as a retailer; the warehouse
  role cannot depart a trip.** No election below can produce any of those.

## 1. Welcome and landing (build now — UI only, no contract change)

**Welcome** — the first screen of every app, shown until a session exists on the device:
the Distribution OS wordmark, one line — *"Connecting a distribution business through six apps."* —
this app's own name and icon ("Delivery"), and one button, **Sign in**, which opens today's form
unchanged. It is shown once per device, not on every launch: a driver at 6 am opens straight into the
trip. Implemented once as `Welcome` in `@dos/ui` (web and native), used by all seven `sign-in.tsx`
through the template, so the seven stay identical.

**Landing** — the first thing a signed-in person sees, for two seconds, then the app's home: the
distributor's logo and name (or the shop's for the retailer app; "Distribution OS" for the console),
the person's name, and *"Delivery app"* — which app, for whom. Not a screen to tap through; a
statement of where you are. The shell already holds all three facts (`session.tenant.displayName`,
`logoUrl`, `session.role`).

Acceptance: both render at 390 and 1280 in every app; `sign-in.tsx` in every app is byte-identical
to the template's; a signed-in device never sees Welcome again until sign-out.

## 2. Role election at sign-in, downward only (build on day 4 or after go-live — touches auth)

**The problem.** A membership is one (person, distributor, role). An owner in the delivery app gets a
403 and a screen saying so. Real distributorships do not work that way: the owner drives some mornings,
the warehouse man delivers on Tuesdays.

**The wrong fix.** Letting an owner token into the field apps. A van phone is a shared, droppable
device; an owner token on it reaches owner-service — every margin, every setting — for the life of its
refresh token. That throws away what seven services exist for.

**The design.** A device asks for the role it needs, and the auth service grants it only downward.

- `LoginInput` and `SwitchTenantInput` gain `actAs?: MembershipRole`. Each field app always sends its
  own role (`APP.role`); the owner and manager apps send nothing (their own role).
- The auth service grants `actAs` when it is the membership's own role, or when the membership's role
  **may elect** it under this table — fixed in code, not configurable in v1:

  | Membership role | May act as |
  |---|---|
  | owner | manager, accountant, warehouse, delivery, salesperson |
  | manager | warehouse, delivery, salesperson |
  | accountant, warehouse, delivery, salesperson | own role, plus each role in the membership's `extra_roles` |
  | retailer, platform_admin | never anything else |

- The access token's `role` claim is the **elected** role. `sub` stays the person. Every audit row,
  every `actor_id`, every receipt and delivery therefore records *who* did it; the token merely says
  *as what*. `auth_events` gains `acted_as` so a sign-in as a lower role is visible to the owner.
- A refused election is a 403 at sign-in with a sentence a person can act on, never a silent
  downgrade: *"Your login at Tarsun is a salesperson; ask the owner to add delivery to it."*
- **Extra roles**: `memberships.extra_roles membership_role[] not null default '{}'`, one expand
  migration; set by the owner or manager on the staff screen (owner app O-staff, manager app) —
  chips per role, saved through `tenancy.memberships.update`. The manager cannot grant owner or
  manager; only the owner can.
- Nothing else changes. Services keep their role lists; PERMISSIONS keeps its rows; RLS reads
  `app.actor_role` = the elected role, exactly as today.

Acceptance (test-first): the election table is a single exported constant with one spec that walks
every (from, to) pair; a delivery app sign-in by `sunil.tarsun` returns a token with `role: delivery`
and the delivery-service answers 200 on the trip list; the same for a salesperson login without
`extra_roles` returns 403 with the sentence; the receipt recorded by the elected driver carries
`actor_id = sunil`'s id and the day-end shows his name; `describePermissionMatrix` in all seven
services still passes untouched.

**Timing rule (binding).** This touches sign-in, so it does not land before the business simulation
(days 2–3 of `QA/10-DAY-PLAN.md`) or it invalidates the chain proof. Day 4 if the books balance and the
day is free; otherwise the first thing after go-live.

## 3. One app in the store (build after go-live; needs §2 first)

**The founder's aim** is right and the reason for it is half-right. The stores do not charge per app —
Google Play is a one-time $25 per developer account and Apple $99 a year per account, any number of
apps — so seven listings cost no more than one. What seven listings *do* cost is everything else: seven
builds, seven review queues, seven update cycles, and a distributor's new hire being told *which* of six
apps to install. One install that becomes the right app after sign-in is the better product for a
pilot, and it is what §2 makes possible.

**The design.** One store listing, **"Distribution OS"**, one Expo project (`frontend/dos-app`) whose
`app/` directory holds the six business apps' routes under role groups — `(owner)/`, `(manager)/`,
`(sales)/`, `(warehouse)/`, `(delivery)/`, `(retailer)/` — with one root layout that reads the token's
**elected** role and mounts that group's navigation, strings namespace and touch floor, exactly as the
per-role `_layout.tsx` files do today. The API client gets `serviceFor(role)` — one base URL per
service, the all-in-one's prefixes in a deployment — so the sales group talks only to sales-service,
as now. The console stays a separate app: platform staff are not the distributor's users.

Screens move, they do not change: every screen imports only `@dos/ui`, which is what makes the move
mechanical. The seven web apps stay as they are for the browser — one subdomain each is free and clear
— and share every screen file with the store app through the same packages, so nothing is written
twice. The bundle carries every group's code; that was never the security boundary (the server is), only
a size cost, and it is paid once.

Acceptance: the seven web apps and the one store app render the same screens from the same files (the
kit's parity guard extends to it); a delivery elected token in the store app cannot reach a single
owner-service route (the matrix specs already prove the server side; one app spec proves the client
never *asks*); the build is one `expo run:android` and one `expo run:ios`.

**Timing.** After go-live, and after §2. Store review alone takes days; it was never inside the five.

## 4. Order of work

1. §1 now — an Opus lane, test-first, verified, merged today; walked by the simulation on days 2–3.
2. §2 on day 4 or after go-live, per the timing rule; Fable reviews the auth change (it changes a
   contract and a permission surface).
3. §3 after go-live; Fable reviews the layout of the one app before the first screen moves.
