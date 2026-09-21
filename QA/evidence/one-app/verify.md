# Blind verification of the one-app merge — `qa/one-app` @ `5c309b2`

Verifier: a session that read the lanes' structured claims and the branch, not their narratives.
No commits made. Every command below was run in the worktree
`.claude/worktrees/one-app` against `dos_test_one_app`; every exit code quoted was seen.

Base of the branch: `8b880ee` (merge-base with `main`). All "before" comparisons are against that
commit, not against today's `main`, which has moved on (`710ff4d`).

**Verdict: FAIL on one item.** Route parity is exact, every gate is green, and thirteen of the
fourteen ruling points are satisfied in code. One binding ruling (B3) ships materially short of what
it says, and that shortfall is a capability the six apps had and the one app does not. It is recorded
in a code comment on the branch but appears in none of the claims handed to this verifier. Everything
else below is evidence that the merge is sound.

---

## 1. Route parity — PASS, exactly

Every route file that existed under the six retired apps at `8b880ee` exists under
`frontend/dos-app/app/<group>/`. Diffed by file list, per group, excluding `sign-in.tsx` and
`change-password.tsx` (§1.2: one of each at the root):

| group | files at `8b880ee` | files in `dos-app` | missing | extra |
| --- | --- | --- | --- | --- |
| owner | 27 | 27 | — | — |
| manager | 26 | 26 | — | — |
| sales | 17 | 17 | — | — |
| warehouse | 18 | 18 | — | — |
| delivery | 13 | 13 | — | — |
| retailer | 16 | 16 | — | — |

`src/**` likewise: every per-app `src` file is present under `src/groups/<g>/**`. The only files not
carried over are the six `src/api.ts` and five of the six `src/config.ts`, which fold into the root's
(§1.4). `delivery/config.ts` survives on purpose, holding only `GPS_NOTICE_VERSION` — a DPDP notice
version that belongs to no other group.

**Screens moved; they did not change.** 117 moved route files were diffed one by one against their
`8b880ee` originals. Not one is byte-identical (every file's import depth changed), and the two
largest screen diffs were read in full — `delivery/stop/[id]/collect.tsx` (43 lines) and
`sales/orders/new.tsx` (33 lines). Both are exclusively: import-path re-depth, `useRouter` → `useGo`,
and route literals wrapped in `go.href` / `go.replace`. No behaviour edit was found in either.

**Dependencies.** The union of the six apps' `dependencies` at `8b880ee` is 44 packages;
`dos-app/package.json` carries 44, with nothing missing and nothing extra.

---

## 2. The four blockers and the rulings

| item | satisfied by | verdict |
| --- | --- | --- |
| **B1** elected role survives a refresh | `backend/libs/core/src/modules/auth/auth.service.ts:325-346` — a refresh reads `session.role ?? membership.role`, re-runs `electRole` against the membership and its `extraRoles` **as they are now**, and on refusal revokes with `election_withdrawn` and returns `electionRefused(...)` rather than reverting | PASS |
| **B2** `platform` is the device kind, never the app | `AuthPlatformSchema = z.enum(['web','android','ios'])` (`backend/libs/contracts/src/auth.ts:55`) is unchanged; `dos-app/src/api.ts:109` passes `platform: os`; the election travels only as `actAs` | PASS |
| **B3** the person is the elector | chooser at `dos-app/app/sign-in.tsx:173-215` calling `useSession().electRole`; `src/election.ts` (`permittedRoles`, `needsChooser`, `preselectedRole`, `lastRole`/`rememberRole`/`forgetRole`, and the `choosing` flag the root's ladder reads); `client.ts` gains `SignInOptions.actAs` and `electRole()` = `switchTenant` against the tenant already signed into | **PARTIAL — see §5** |
| **B4** §1.3/§1.4 re-derived from HEAD | `80845c6`, and the built root layout matches the re-derived text (two components, one redirect effect, three pre-election branches) | PASS |
| **Q1** visible segments + no-duplicate-route spec | `frontend/libs/ui/src/one-app-routes.test.ts` — no two route files resolve to one path, no route hides in a parenthesised directory, every group's screens sit under its own base, and the counterfactual (segments back in parentheses) still reports the thirteen collisions the invisible spelling would have shipped, with `/` claimed by 7 files | PASS |
| **Q2** a foreign group paints nothing | every group layout gates on `groupOf(session.role) === GROUP` and returns `null` / renders no chrome otherwise (owner `:103`, manager `:101`, sales `:84`+`:139`, warehouse `:79`, delivery `:91`, retailer `:92`); the root signs an unmapped role out (`app/_layout.tsx:146-148`) rather than redirecting to `/undefined`; asserted in `dos-app/src/root-layout.test.ts` | PASS |
| **strings swapped, never merged** | six `<ThemeProvider strings={…}>` each importing `src/groups/<g>/strings`; the root's own record covers only the pre-election screens and the chooser; `dos-app/src/config.test.ts:119-150` asserts each group has its own record and that both words survive where two groups disagree | PASS |
| **store prefix by group** | `GROUPS.{sales,warehouse,delivery}.offline` = `dos-sales` / `dos-warehouse` / `dos-delivery`, read by each field layout as `STORE_PREFIX`; owner, manager and retailer are `false` and mount no engine (`config.test.ts:56`) | PASS |
| **device-wide sign-out** | all three field layouts call `SyncEngine.sweepDeviceStores(openStore, FIELD_STORE_PREFIXES, deviceIdentities(session))` (sales `:331`, warehouse `:333`, delivery `:404`), and `deviceIdentities` now includes THIS distributorship as well as the person's others; `libs/offline/src/docs31-device-wide-sign-out.test.ts` pins the three prefixes and the sweep | PASS |
| **`apiUrlFor` pinned per request** | `libs/api-client/src/client.ts` — the interceptor computes `currentApiBase()` once, hands it down on oRPC's own options object under `__dosApiBase`, and the link's `url` function reads it back, so the 401 replay leaves for the service the first attempt did; `election.test.ts:189-230` replays after a mid-flight re-election and asserts the original origin | PASS |
| **`GROUP_OF` total** | `libs/api-client/src/groups.ts` — `Record<MembershipRole, GroupName>`, accountant → manager per Q5; `groups.test.ts` walks `MembershipRoleSchema.options` so the enum and the table cannot drift | PASS |
| **Q3** maps | `app/owner/map.tsx:147` keeps `listOnly={process.env.EXPO_OS === 'android'}`; `dos-app/env.d.ts:22` declares `EXPO_OS` | PASS |
| **Q4** identity | `app.json`: name `Distribution OS`, slug/scheme `dos`, `in.distributionos.app` on both platforms | PASS |
| **Q6** no de-duplication in this slice | owner's and manager's duplicated `lib/` helpers moved as copies | PASS |
| **Q7** welcome device-scoped | one `clearWelcomeSeen()` in the root, on the render `landing.signedOut` is true | PASS |
| **R4** the `.wasm` block | `dos-app/metro.config.js` is byte-identical to the template's (`diff` clean), `wasm` appended to `assetExts` at `:65-66` | PASS |
| **R9** cross-group wall | `libs/ui/src/one-app-groups.guard.test.ts` — no group imports another group's files, writes a route literal outside its own base (four pre-election routes exempt, and the exemption list is itself pinned), or calls `serviceFor`; only `src/api.ts` and `src/config.ts` may | PASS |
| **R10** one `EXPO_PUBLIC_API_URL` | `dos-app/.env.example` documents it as the ALL-IN-ONE base only; `serviceFor(role, base)` derives each group's prefix | PASS |

Route safety checked independently of the guards: the only raw `router.replace` with a string literal
anywhere in `app/**` or `src/**` is `app/change-password.tsx:59` → `/`, a root route the ladder then
resolves. 197 `routeFor(` sites, 86 `useGo()` sites, 2 `goTo(`; no `<Link href="/…">` literal. All 26
non-root `absoluteUrl(` call sites name their group (`'owner'`, `GROUP`, …); none is groupless.

---

## 3. Gates re-run from the outside

| gate | command | result |
| --- | --- | --- |
| named guards | `pnpm --filter @dos/ui exec vitest run one-app-groups / one-app-parity / one-app-routes / root-layout-redirects / welcome / docs29-field-app-role / nav-active / route-for` | exit 0 — 8 files, 118 tests |
| offline guards | `pnpm --filter @dos/offline exec vitest run identity / docs31-device-wide-sign-out / dos-179-keep-claims` | exit 0 — 3 files, 39 tests |
| whole frontend | `pnpm exec turbo run test --continue --concurrency=1 --force` | exit 0 — 5/5 packages: ui 435, dos-app 464, api-client 130, offline 110, admin-app 14 |
| typecheck | `pnpm exec turbo run typecheck --continue --concurrency=1 --force` | exit 0 — 6/6, 0 cached |
| lint | `pnpm exec turbo run lint --continue --concurrency=1 --force` | exit 0 — 6/6, 0 cached |
| format | `pnpm format:check` | exit 0 |
| build | `pnpm exec turbo run build --continue --concurrency=1 --force` | exit 0 — dos-app web export 3.4 MB entry + 1.1 MB maplibre chunk; admin-app and app-template also exported |
| backend | `pnpm docs:readme:check` | exit 0 |

Not run by this verifier, and not claimed: any browser or device walk, `pnpm smoke`, the backend test
suite. The gate commit `5c309b2` carries browser evidence for six sign-ins and the chooser; this
verification corroborates it from the code and the gates, not by repeating the walk.

---

## 4. Retired-path sweep

`frontend/{owner,manager,sales,warehouse,delivery,retailer}-app/` are gone; `frontend/` holds
`admin-app`, `dos-app`, `libs`. `.claude/launch.json` has one `dos-app` entry on 5173 (5174-5178
released; `app-template` 5170 and `admin-app` 5179 kept). `backend/tools/generate-readmes.mts` has one
`ONE_APP` entry with six group headings, and `docs:readme:check` is green.

`git grep` over tracked files for `frontend/<role>-app` and `@dos/<role>-app` outside `QA/` returns
only: history documents (`docs/02`, `docs/18` dated entries, `docs/19`, `docs/design/UX-00/02/03`),
`docs/31 §7` naming what it deleted, prose comments in moved files that cite where a pattern came
from, and one test fixture string in `backend/libs/core/src/docs/readme.test.ts:167` (`renderAppReadme`
is still used for `admin-app` and the template). Nothing live resolves to a retired path.

---

## 5. The one failing item, and one docs miss

### 5.1 Ruling B3 is short: four of the seven roles can never elect a granted extra role — MAJOR

B3 says the chooser shows "one row per permitted role — its own plus what the election table **and
`extra_roles`** allow."

`ROLE_ELECTION` (`backend/libs/domain/src/roles.ts:64-73`) gives `accountant`, `salesperson`,
`warehouse` and `delivery` an empty downward list, so for those four roles `extra_roles` is the *only*
source of a second role. And `MembershipSummarySchema`
(`backend/libs/contracts/src/auth.ts:95-105`) carries no `extraRoles` field — the wire does not
transmit them. `dos-app/src/election.ts:54-59` reads the field defensively and therefore always gets
`[]`, so `permittedRoles()` returns exactly one role for those four, `needsChooser()` is false, and
the chooser never opens. `lastRole()` is written only by `rememberRole(next.role)` after a *successful*
sign-in, so it can never hold a role the person has not already been signed in as. There is no path on
the device to ask for a granted extra role.

This is a capability the six apps had. At `8b880ee`, each field app sent a constant
(`frontend/delivery-app/src/api.ts:80`, `actAs: ELECTED_ROLE`), so a salesperson granted `delivery`
installed the delivery app and the server granted the election against the membership's `extra_roles`.
After the merge that install is gone and nothing asks in its place. The owner and the manager are
unaffected — their rows in `ROLE_ELECTION` are non-empty and `electableRoles` ignores extras for them
by construction — which is why the browser walk of `sunil.tarsun` showed a full chooser and did not
surface this.

The move lane recorded it honestly in `dos-app/src/election.ts:42-59` as a backend gap. It appears in
none of the claims handed to this verifier, and the ruling's own instruction on an item that cannot be
built as written is to stop on it and say why, not to ship it short.

The fix is a backend contract change, not a frontend one: add `extraRoles` to `MembershipSummarySchema`
and populate it from the membership row in the auth service's memberships read. `election.ts` then
works with no edit. It belongs with the fifteen queued backend gaps, and the merge should either carry
it or the architect should accept the gap explicitly.

### 5.2 `docs/29 §3` was not updated — MINOR

docs/31 §7 names, among the docs the retirement lane updates, "**docs/29 §3** (a note that the web apps
are retired per docs/22 §8 line 345, superseding 'the seven web apps stay')". The branch touches
`docs/{18,19,22,23,28,31}` and `CLAUDE.md`, but not `docs/29`.

`docs/29-sign-in-roles-and-one-store-app.md:114` therefore still describes the layout as
"`app/` directory holds the six business apps' routes under role groups — `(owner)/`, `(manager)/`, …"
— the invisible-group spelling that ruling Q1 explicitly overturned — and `:127` still states
acceptance as "the seven web apps and the one store app render the same screens". A reader who starts
from docs/29 is told the opposite of what was built, on the one point the architect ruled on.

One paragraph in docs/29 §3 closes it.

---

## 6. Two observations, neither a finding

- **`src/api.ts` imports a group file.** `LAST_TENANT_KEY` comes from
  `./groups/retailer/lib/last-distributor` so the storage prime list cannot drift from the key the
  retailer group writes (DOS-102). The cross-group guard does not cover install-level files, so this
  is not a violation; it is a deliberate coupling with its reason written at the import.
- **The retailer group's landing title changed** from `Distribution OS - Retailer` to
  `Distribution OS - Shop`, so `<Landing>` prints "Shop" where it printed "Retailer". It is written
  into `docs/31:215`, so it is a recorded decision, not drift.
