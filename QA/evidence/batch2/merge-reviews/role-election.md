# Merge review — lane `qa/b2-role-election` (docs/29 §2)

**First review.** No earlier review file existed for this lane — this is the first, written against
4 commits (47c2c9b, 1e53519, 2907cb5, 6a798b7), 53 files, after the repair's own round-2 re-verification.

**Decision: MERGE AFTER FIXES** — one blocker, all in this lane's own files. The security model is
intact: I confirmed `tenant.guard.ts:179-183` reads the ELECTED role for `requireServed()` and
`isAllowed()`, and `enterTenant()` (`tenant.guard.ts:268`) sets `actorId = claims.sub` = the person, so
RLS narrows to the elected role while every audit row still names who did it. `memberships_write_update`
(migration 0012) is a second gate the handler cannot bypass. Migration 0057 is two `ADD COLUMN`s and
nothing else — no policy, GRANT, role or trigger line moves. `ExtraRoleSchema` excludes owner/manager/
retailer and `platform_admin` is not in `MembershipRoleSchema` at all, so a way up is refused by the
schema before any handler. Every defect the repair was asked to close is closed at the cause, red-proven,
and I found no weakened test (the only removed spec lines are an import and a type).

## Blockers

1. **A manager can never save extras for anyone the owner gave `accountant` to.**
   `backend/libs/core/src/modules/tenancy/tenancy.service.ts:251-257` refuses when *any element of the
   submitted set* is outside `MANAGER_MAY_ADMINISTER`, but `frontend/manager-app/app/staff/index.tsx:60`
   seeds the state from `selected.extraRoles` (the whole server set) and `:36` shows chips for only the
   three — so a warehouse man carrying owner-granted `accountant` makes every manager save a 403 reading
   *"A manager may only grant salesperson, warehouse, delivery. Ask the owner for accountant."* for a role
   the manager never touched. Stripping it client-side is worse (it would silently revoke the owner's
   grant), so fix it on the server: compare the **delta**, not the set —
   `const touched = [...new Set([...before.extraRoles, ...input.extraRoles])].filter(r => before.extraRoles.includes(r) !== input.extraRoles.includes(r))`
   then refuse only `touched.filter(r => !MANAGER_MAY_ADMINISTER.includes(r))`. That needs the `before`
   read (today at `:262-266`) moved above the manager check. Add the spec case: owner grants
   `['accountant']`, manager adds `delivery`, save succeeds and the row reads `{accountant, delivery}`.

## Minors

- `tenancy.service.ts:221-226` — `updateMembership` was inserted **between** `updateStaff`'s JSDoc and
  `updateStaff`. The "`users_self_update` only lets a person edit itself" paragraph now sits above the
  wrong function. Move it back.
- `frontend/manager-app/app/staff/index.tsx:66-67` — `mine` filters on `isGrantableExtraRole`, which
  admits the **accountant**, while the comment above says "these three and nobody else". Behaviour is
  safe (`mayGrant` is false, `m22.askOwner` renders, server refuses) but the comment is wrong and the row
  should not be on a manager's floor list. Use `MANAGER_MAY_GRANT` for the filter.
- `auth.service.ts:335` — a withdrawn election grant revokes with reason `'membership_disabled'`.
  Nothing was disabled; `auth_sessions.revoked_reason` will read wrong in an audit. Add
  `'election_withdrawn'`.
- `auth.service.ts:247-248` — a refused election is written as `kind: 'login_failed'` with `actedAs` set.
  The password was correct; any future "failed sign-ins" view will show a legitimate person as a failure.
  `actedAs` disambiguates it, but a distinct kind would be honest.
- `auth.service.ts:230-250` — the refusal returns **before** the `failedLoginCount`/`lockedUntil` reset
  block, so a correct password that is refused an election leaves a stale failure count on the user.
- `switchTenant` (`auth.service.ts:426`) refuses with no `auth_events` row, unlike login. An owner
  withdrawing a grant leaves no trace of the switch that was then refused.
- `tenancy.service.ts:248` — *"A owner membership carries no extra roles"*. Unreachable from either
  screen, but it is an API sentence; "An owner".
- `frontend/owner-app/app/staff/index.tsx:91-93` — the chips `useEffect` keys on the `selected` object,
  which the invalidation does not replace, so after a save the panel shows what was typed rather than what
  the server stored (the server drops the membership's own role at `tenancy.service.ts:261`). Key on
  `selected?.userId` and re-read from `staffRows`.
- Report miscount, already caught in re-verification: `auth-retry.test.ts` has 5 tests, not 6.
- Ten generated READMEs (4 services, 6 apps) are in the diff and absent from the repair's `filesChanged`.
  Pure `pnpm docs:readme` output; correct, but the list should have said so.

## Conflicts

- **A behaviour change nobody asked for and nobody wrote down: a role CHANGE now revokes the session.**
  Refresh used to adopt `current.membership.role`; it now re-elects the held role (`auth.service.ts:327`).
  A manager demoted to salesperson is now logged out with *"Your login at X is a manager; ask the owner to
  add salesperson to it."* — a sentence written for a withdrawn extra, wrong-voiced for a demotion. And a
  salesperson **promoted** to manager keeps a salesperson token until they sign out, because a manager may
  elect salesperson. Both are defensible under docs/29's "never a silent downgrade" amendment; neither is
  recorded. Needs a docs/22 §8 as-built line, and the demotion refusal deserves its own sentence.
- **Cost visibility via extras is real and is the one place election changes who can read cost.**
  `GRANTABLE_EXTRA_ROLES` includes `accountant`, so an owner may give a salesperson's membership an
  accountant extra; acting as accountant that login reads `tenant_product_costs` under BACK_OFFICE RLS.
  docs/29 §2 row 3 and docs/22 §8 line 343 both permit it explicitly and only the owner may grant it, so it
  is not a defect — but CLAUDE.md's "purchase cost never in anything a salesperson can read" now holds
  role-wise, not person-wise. Say so in docs/22 or drop `accountant` from the grantable four.
- **§3 will need more than this lane shipped.** `actAs` is fixed at `createApiClient()` construction
  (`client.ts:92`), but docs/29 §2's amendment says in the one app *the person* elects and "changing role
  is a fresh election" — that needs `signIn({ actAs })` per call. And `MembershipSummarySchema`
  (`contracts/src/auth.ts:95-105`) carries no `extraRoles` and no electable list, so the "Continue as …"
  chooser cannot be rendered from the login response. Both are cheap now, expensive after the merge.

## Walks still owed

- **Browser, against running services (the founder's priority, docs/22 §8 2026-09-21):** sunil.tarsun into
  the delivery app → trips list 200; a receipt taken on that trip → `actor_id` = sunil, day-end shows his
  name; rahul.deshmukh into the delivery app → the refusal sentence on the sign-in screen (the path
  through `toApiError` is right, but nobody has seen it rendered); dinesh.patil into the delivery app.
  These are docs/29 §2's own acceptance clauses and the only ones still unexercised.
- `pnpm smoke --destructive` — `POST /tenancy/memberships/update` has never been called over HTTP.
- **Android (Pixel 7), in the complete pass, not now** (docs/22 §8 2026-09-21): owner and manager chips,
  and a refused field-app sign-in. iOS: boot only.

## Defects outside this lane

- **The one store app (docs/29 §3) is not built** — no `frontend/dos-app`, no `serviceFor(role)`. The
  founder's sentence asks for role election **and** one store app for apps and website before go-live
  (docs/22 §8 line 345); half of it is in this branch. Next lane, and it depends on this one.
- docs/22 §8 and docs/18 need the as-built rows (this lane is forbidden to write them), including the
  refresh re-election behaviour above.
- `backend/libs/core/src/docs/sample.ts` needs an `extraRoles -> []` hint: the generated staff example
  shows an `owner` carrying an `accountant` extra, which the rules forbid.
