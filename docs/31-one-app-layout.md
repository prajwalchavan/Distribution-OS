# 31 — The one app: layout plan (planner, 2026-09-21)

The plan the architect approves before a single screen moves. Executes docs/22 §8 line 345 (role
election and the one app land BEFORE go-live; **the seven per-role web apps are RETIRED at the
merge**) and `docs/29-sign-in-roles-and-one-store-app.md` §3. docs/29 §0 is untouched: the server keeps
one service per role; this changes only what a device asks for.

Counted from the tree: **128 route files** in the six business apps (6 `_layout.tsx`, 12
sign-in/change-password, **110 group screens**), 106 non-test `src/` files, **98 tests** of which **77
assert a file path**, **3 135 distinct string keys**, **112 hard-coded route literals** across the 71
screens that import `expo-router` directly.

---

## 1. Target layout of `frontend/dos-app`

### 1.1 The blocker: route collisions

Fourteen resolved paths are claimed by more than one app: `/`, `/sign-in`, `/change-password`,
`/settings` (six apps each), `/orders` (four), `/stock`, `/shops` (three), `/prices`, `/money`,
`/billing`, `/billing/credit-notes`, `/money/claims`, `/orders/[id]`, `/bills/[id]` (two each). An
expo-router **group** segment is invisible in the URL, so `(owner)/index.tsx` and `(delivery)/index.tsx`
both resolve to `/`. expo-router does not reject that — the only duplicate check,
`frontend/node_modules/expo-router/build/getRoutesCore.js:592`, rejects duplicate group _names_ inside
array syntax and nothing else — so a bare `/` or `/orders` resolves to whichever branch matched first,
never to the elected one, and a browser reload (the only front door left after retirement) lands a
manager on an owner screen.

**Decision (architect must bless — §10 Q1): the role segment is VISIBLE.** Plain directories
`app/owner/ manager/ sales/ warehouse/ delivery/ retailer/`, not parenthesised. Paths become
`/owner/orders`, `/delivery/stop/[id]/collect`. No ambiguity by construction, role-scoped bookmarkable
URLs, and §6.4's guard states the rule in one line. This is the only deviation from docs/29 §3's
literal `(owner)/` spelling.

### 1.2 The tree and the moves

```
frontend/dos-app/app/   _layout.tsx (ROOT, new) · index.tsx (elected-role redirect, new)
                        welcome.tsx · sign-in.tsx · change-password.tsx   ← pre-election, root level
                        owner/ (26) manager/ (25) sales/ (17) warehouse/ (18) delivery/ (13) retailer/ (16)
frontend/dos-app/src/   config.ts · api.ts · groups/<g>/{nav.ts, strings.ts, lib/**}
```

For each app `A` and its group `g`:

| old                                                     | new                                                     |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `frontend/A-app/app/<path>` (all but the three below)   | `frontend/dos-app/app/g/<path>`                         |
| `frontend/A-app/app/_layout.tsx`                        | `frontend/dos-app/app/g/_layout.tsx`, stripped per §1.4 |
| `frontend/A-app/app/sign-in.tsx`, `change-password.tsx` | deleted — the **template's** copies land at the root    |
| `frontend/A-app/src/{nav.ts,strings.ts,lib/**}`         | `frontend/dos-app/src/groups/g/**`                      |
| `frontend/A-app/src/{config.ts,api.ts}`                 | deleted — folded into `src/config.ts` / `src/api.ts`    |

Owner ships `app/settings/index.tsx` (a directory), the other five `app/settings.tsx` (a file). Under
visible segments those are `/owner/settings` and `/manager/settings` — different paths, so both shapes
survive unchanged. Second reason for §1.1.

### 1.3 The root `_layout.tsx`, in order

**Re-derived from HEAD (`frontend/libs/app-template/app/_layout.tsx`, 286 lines, after the Welcome and
landing merge `9391c17`) by lane 0 on 2026-09-21, per ruling B4.** Line numbers below are that file as
it stands; the six app layouts are the same file plus their own chrome (owner 474 lines, manager 478,
sales 583, warehouse 588, delivery 632, retailer 390).

**What the merge changed, and the plan had wrong.** _The Welcome is not a route._ `<Welcome>` is a kit
component that WRAPS the sign-in screen's own content (`app/sign-in.tsx:49`, `libs/ui/src/web/welcome.tsx:50`);
it reads `dos.welcome.seen` from `platform.storage` (synchronously on web, awaited on native), renders
the wordmark until **Sign in** is pressed, and then renders its children — today's form, unchanged.
There is no `/welcome` file in any app and `dos-app` must not invent one: the pre-election routes are
`sign-in.tsx` and `change-password.tsx`, and nothing else. The root layout's ONLY welcome duty is to
re-arm the flag (`clearWelcomeSeen()`) on the one render `landing.signedOut` is true.

The file is two components, and the split survives the merge:

**`RootLayout()` — outside the provider (template 38-89).**

1. `boot()` the client into state, and hold the tree while it is `null` (42-50).
2. `setRouterNavigate` so `<Link>` and the shell can move; torn down on unmount (52-60).
3. `client === null` → `<ThemeProvider touch density strings>` over `<Screen><Skeleton rows={4}/></Screen>`
   (62-70). This is the first of three **pre-election** branches: no session, therefore no elected role,
   therefore the fallback pair of §5 (`phone` / `desk`) and the KIT's own catalogue — **no group
   strings**, because which group is not yet known.
4. `<ApiProvider client>` wrapping `<StatusBar style="dark" />` and `<Shell/>` (73-88). ONE provider,
   ONE client, for the life of the app (§2). **`<StatusBar style="dark" />` is at template `:85`**, and
   on HEAD it is present in warehouse (`:108`), delivery (`:103`), retailer (`:85`) and the template, and
   ABSENT in owner and manager — so those two gain it at the merge. Without it Android paints a white
   clock over `#F2F2EF`.

**`Shell()` — inside the provider (template 95-286), where `useSession()` can be called.**

5. `session`, `hydrating`, `signOut`, `switchDistributor` from `useSession()`; `onSignIn`,
   `onChangePassword` from `usePathname()`; `mustChangePassword` from
   `session?.user.mustChangePassword` (96-107).
6. `tenantBrand` — the distributor's name and `absoluteUrl(session.tenant.logoUrl)` (110-116). In
   `dos-app` this becomes `absoluteUrl(GROUP_OF[session.role], session.tenant.logoUrl)`: by the time
   there is a session there IS an elected role, so the group is always known here.
7. The redirect LADDER, a `const`, not an effect (152-164). Today: `hydrating` → null; no session →
   `/sign-in` unless already there; `mustChangePassword` → `/change-password` unless already there; on
   `/sign-in` with a session → `'/'`. In `dos-app` the last arm's `'/'` becomes `/<group>`, and ONE arm
   is added: a signed-in pathname outside the elected group → `/<group>`. `GROUP_OF` is
   `Record<MembershipRole, GroupName>`, **total** (ruling Q2); an unmapped role signs out rather than
   redirecting to `/undefined`.
8. `navigatorReady` from `useRootNavigationState()?.key !== undefined` (174-175), then the ONE redirect
   effect (185-193): guard on `!navigatorReady || redirectTo === null || redirectTo === pathname`,
   `setTimeout(() => router.replace(redirectTo), 0)`, `clearTimeout` on cleanup. These are the five
   assertions of `libs/ui/src/root-layout-redirects.test.ts:68-89`, satisfied once instead of eight
   times.
9. The landing gate (214-230): `useLandingGate(hydrating, sessionKey)` where the key is the tenant id
   and the user id joined by a colon, so a switch and a different sign-in both count as an arrival;
   `useEffect` clearing the welcome flag on `landing.signedOut`; and `landingPanel` — a `<Landing
tenantName logoUrl personName appTitle onDone>` that **covers** (fixed, `zIndex: 60`) rather than
   replacing, so the navigator underneath stays mounted and the redirect this sign-in started is not
   stranded behind two seconds of introduction.
10. Three render branches: `hydrating` → themed skeleton (232-240); `session === null || onSignIn ||
mustChangePassword` → themed `<Slot/>` + `landingPanel`, **no chrome** (244-251) — the second and
    third pre-election branches; otherwise `<AppShell …><Slot/></AppShell>` + `landingPanel` (253-285),
    which in `dos-app` is what the GROUP layout renders instead (§1.4).

**Two consequences the move lanes must not decide for themselves.**

- **`<Welcome role>` is a required `string` prop** (`libs/ui/src/types.ts:871`) and its only effect is
  `role === 'platform_admin' ? 'welcome.console' : 'welcome.tagline'`. `dos-app` is never the console,
  so the merged `sign-in.tsx` passes a constant; `APP.role` is gone with the six configs (ruling B3).
- **`<Landing appTitle>` renders `landing.app` with `appShortName(appTitle)`** (`welcome.tsx:193`,
  `strings.ts:279` — the part after the last `-`). With one `APP.title` of `'Distribution OS'` every
  group's landing would read the product's name where docs/29 §1 promised "which app this is". The
  elected group is known at that point, so the root passes that group's own title (`GROUPS[g].title`,
  e.g. `'Distribution OS - Sales'`) and the line keeps its meaning. **Root lane, one line; flagged
  here rather than settled, because it is the one place the merge could silently lose a founder
  requirement.**

**The wrong-role screen is deleted.** `app.wrongRoleTitle` / `app.wrongRoleBody` and a `WrongRole`
component exist in sales (`_layout.tsx:132,325-345`), warehouse (`:133,176`), delivery (`:128,164`) and
retailer (`:112,163`). With a group per role there is no wrong app to be in; step 7 moves the person to
their own group, and ruling B3 puts the refusal at the chooser. Those four key pairs go **in the same
commit** that re-points `libs/ui/src/docs29-field-app-role.guard.test.ts`.

### 1.4 Group layouts, and what lifts to the root

Re-derived from the six layouts on HEAD. Corrections to the table as first written: **all six** apps
have a `<Chrome>` sub-component (not owner and manager alone), **`<LeaveSheet>` is in three** apps
(sales `:566`, warehouse `:571`, delivery `:615` — not "sales, delivery"), and retailer carries a badge
query of its own (`inbox`, `:349`).

| Stays in `app/<g>/_layout.tsx`                                                                                                                                                                                                                      | Lifts to the root, written once                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<ThemeProvider>` — this group's touch/density (§5), `tenant={tenantBrand}` and its own `strings` (§3)                                                                                                                                              | `boot()`, `setRouterNavigate`, `<ApiProvider>`, `<StatusBar style="dark" />` |
| the whole `<AppShell>` call: `sections` from `src/groups/g/nav.ts`, `can()` over `PERMISSIONS`, `activeHref`, `onNavigate`, **and its `tenant` switcher and `account` menu / sign-out props**                                                       | the session gate and the redirect ladder (§1.3 steps 7-8)                    |
| the `<Chrome>` sub-component (all six) and its badge queries — owner 3 + 3 search, manager 2 + 3 search, delivery 1 (`consent`), retailer 1 (`inbox`) — plus `<Search>` (owner `:439`, manager `:433`) and the `<ConnectionStrip>` source (all six) | the landing panel and the welcome re-arm (§1.3 step 9)                       |
| `<OfflineProvider storePrefix>` — sales, warehouse, delivery only (§4), mounted ABOVE the gate and switched with `enabled`; `<LeaveSheet>` + `sweepIdentityStores` — the same three                                                                 | `tenantBrand`'s `absoluteUrl` for the landing and the change-password branch |

**Why the tenant switcher and the account menu do NOT lift.** They are `tenant=` and `account=` props of
the single `<AppShell>` (template 262-279), and `<AppShell>` stays with the group because `sections` and
the badge counts are the group's. `useSession()` is available anywhere under the provider, so the data
could be read at either level; the ELEMENT cannot be split. Lifting them would mean splitting
`AppShell`, which this slice does not do.

`src/config.ts`:

```ts
export const APP = { title: 'Distribution OS', webPort: 5173 } as const
export const GROUPS = {
  owner: {
    role: 'owner',
    title: 'Distribution OS - Owner',
    port: 3001,
    touch: 'phone',
    density: 'desk',
    offline: false,
  },
  manager: {
    role: 'manager',
    title: 'Distribution OS - Manager',
    port: 3002,
    touch: 'phone',
    density: 'desk',
    offline: false,
  },
  sales: {
    role: 'salesperson',
    title: 'Distribution OS - Sales',
    port: 3003,
    touch: 'field',
    density: 'field',
    offline: 'dos-sales',
  },
  warehouse: {
    role: 'warehouse',
    title: 'Distribution OS - Warehouse',
    port: 3004,
    touch: 'floor',
    density: 'field',
    offline: 'dos-warehouse',
  },
  delivery: {
    role: 'delivery',
    title: 'Distribution OS - Delivery',
    port: 3005,
    touch: 'field',
    density: 'field',
    offline: 'dos-delivery',
  },
  retailer: {
    role: 'retailer',
    title: 'Distribution OS - Shop',
    port: 3006,
    touch: 'field',
    density: 'field',
    offline: false,
  },
} as const
export const AUTH_URL = process.env.EXPO_PUBLIC_AUTH_URL ?? 'http://127.0.0.1:3000'
export const API_BASE = process.env.EXPO_PUBLIC_API_URL // undefined locally → per-port (§2)
```

`absoluteUrl(url)` becomes `absoluteUrl(group, url)`, closing over `serviceFor(GROUPS[group].role)`.
**Counted on HEAD: 32 call sites across the six apps** — owner 7, manager 9, sales 4, warehouse 5,
delivery 4, retailer 3 (excluding each app's own `src/config.ts` definition and two comment mentions).
Twelve of the 32 are the two in each of the six root layouts, which collapse into the merged root's
two; the other 20 live in screens and `src/lib` and each gains its group. Getting it wrong 404s tenant
logos and invoice PDFs silently in five of six groups — R2. (The plan first said "12 call sites (6
owner, 6 manager)": that was the count before the landing merge added one per layout, and it never
counted the four field apps at all.)

### 1.5 Project files, from the template

`package.json` (`@dos/dos-app`, `web --port 5173`), `app.json` (name `Distribution OS`, slug/scheme
`dos`, bundle id `in.distributionos.app`), `metro.config.js`, `babel.config.js`, `tsconfig.json`,
`eslint.config.mjs`, `env.d.ts`, `.env.example`, `scripts/sync-fonts.mjs` — all from
`frontend/libs/app-template/`, **never from an existing app**: owner's and manager's `metro.config.js`
lack the `.wasm` `assetExts` block (template lines 54-69) and the three offline groups' web store fails
at bundle time without it. `frontend/pnpm-workspace.yaml:9` globs `'*-app'`, so `dos-app` joins the
workspace with no edit. Dependencies are the union: the template's set plus `expo-sqlite`,
`@react-native-community/netinfo`, `expo-image-manipulator` (delivery today), `maplibre-gl` +
`react-native-maps` (owner today — R3), `vitest`.

**The console is left alone.** `frontend/admin-app` keeps its project, package, port 5179, service
:3007, `app.json` and store listing. It and `dos-app` are then the only `*-app` directories, so
`libs/ui/src/document-urls.test.ts:46,95` — which globs `readdirSync(frontend).filter(n => n.endsWith('-app'))`
— needs no edit and covers both.

---

## 2. `serviceFor(role)`

New `frontend/libs/api-client/src/services.ts`, re-exported from `src/index.ts`:

```ts
export const SERVICE_OF: Record<MembershipRole, { port: number; prefix: string }> = {
  owner: { port: 3001, prefix: '/owner' },
  manager: { port: 3002, prefix: '/manager' },
  accountant: { port: 3002, prefix: '/manager' },
  salesperson: { port: 3003, prefix: '/sales' },
  warehouse: { port: 3004, prefix: '/warehouse' },
  delivery: { port: 3005, prefix: '/delivery' },
  retailer: { port: 3006, prefix: '/retailer' },
}
export function serviceFor(role: MembershipRole, base?: string): string {
  return base === undefined
    ? `http://127.0.0.1:${SERVICE_OF[role].port}` // split mode, this Mac
    : `${base}${SERVICE_OF[role].prefix}` // all-in-one, docs/26 §7
}
```

The prefixes are docs/26 §7's table verbatim; `/auth` stays the auth service's own and `AUTH_URL` is
unchanged.

**How ONE provider re-points.** `createApiClient` builds `apiLink` with
`url: join(options.apiUrl, options.prefix)` (`libs/api-client/src/client.ts:345`). oRPC types that
option `Value<Promisable<string | URL>, [options, path, input]>`
(`node_modules/@orpc/client/dist/shared/client.BFAVy68H.d.mts:47`) — **it may be a function evaluated
per request.** So `CreateApiClientOptions` gains `apiUrlFor?: () => string` and the link's `url`
becomes `() => apiUrlFor?.() ?? join(options.apiUrl, options.prefix)`, reading the current
`session.role` each call. One `<ApiProvider>` at the root, one client, one refresh single-flight, one
in-memory access token — and a switch-distributor or re-election that changes the role re-points the
next request with no rebuild. Rebuilding the client instead would drop the in-memory access token and
the single-flight state; do not. `platform: AuthPlatform` sent at login (`client.ts:89`) becomes the
elected group, so `auth_sessions` still names the device honestly.

---

## 3. Strings — a swap, not a concatenation

`<ThemeProvider strings>` takes one flat `Readonly<Record<string,string>>` (`libs/ui/src/theme.tsx:75`)
and merges it over the kit catalogue once (line 130). **Each group layout passes its own group's
record** — `src/groups/<g>/strings.ts`, moved byte-for-byte. Nothing concatenates; no key is renamed;
all 3 135 keys stay where they are.

Measured, so the alternative is rejected on evidence: of 3 135 distinct keys, **295 are shared by two
or more apps and 71 of those carry different values** — `word.` 44, `app.` 8, `x4.` 8, `tray.` 6,
`ai.` 5. They are not drift but audience. `word.POST_FULFILLMENT` is _Credit_ to an owner and _Pay
after delivery_ to a shopkeeper; `word.PRE` has four values across four apps; `word.pcs` is _pc_ in a
desk table and _pieces_ in a rep's sentence; `tray.waiting` is _Waiting to send_ to a driver and
_WAITING TO SEND_ to a godown. One flat record silently picks whichever spread last — a product
regression in 71 places. Per-group records cost nothing and lose nothing, so there is no "handle
later": **every colliding key keeps both values, in its own group's file.** The only deletions are the
four wrong-role keys (§1.3); the only additions are the Welcome/landing keys, which live in `@dos/ui`'s
own catalogue per docs/29 §1, not in a group.

---

## 4. Offline and the device store

`storeNameFor(prefix, identity)` (`libs/offline/src/engine.ts:94-98`) keys the SQLite file on
`prefix + userId + tenantId` and **deliberately ignores `role`** (`libs/offline/src/identity.test.ts:252`).
The prefix is a per-app constant today: `sales-app/app/_layout.tsx:57` `'dos-sales'`,
`warehouse-app/app/_layout.tsx:56` `'dos-warehouse'`, `delivery-app/app/_layout.tsx:60` `'dos-delivery'`.

**The key does not change; its source does.** Those three prefixes already name a ROLE, not a codebase,
so `STORE_APP_LETTERS` (`engine.ts:62-67`: `s d w`, plus `h` for the harness) and
`STORE_NAME = /^([sdwh])…/` (line 75) stay exactly as they are. The one edit: the group layout reads
its prefix from `GROUPS[g].offline` instead of a file-local constant. A phone that is owner in the
morning and driver in the afternoon therefore gets **person + distributor + role-group** — two clean
files, by the mechanism already there. `sweepIdentityStores(openStore, PREFIX, otherIdentities(session))`
(sales `:425`, warehouse `:427`, delivery `:471`) moves unchanged.

**Which groups mount the engine: sales, warehouse, delivery — and no others.** **Retailer never does**:
it declares `@dos/offline` and `expo-sqlite` (`retailer-app/package.json:25,48`) and imports neither in
`app/` or `src/` (docs/22: online only). Owner and manager never do either — owner declares
`@dos/offline` with zero imports and feeds `<ConnectionStrip>` from the dashboard query's error
(`owner-app/app/_layout.tsx:419-427`), manager from `ApiError.kind === 'network'` (`:424-430`). Both
keep that. **The engine is mounted by the GROUP layout, never the root**: an owner must run with no
store opened at all, as today; one root engine switching prefixes would open a file for a group that
never asked for one.

---

## 5. Touch floor and density per group (UX-00 §5.2)

Set by the group layout from `GROUPS[g]`, on every branch that layout owns: **owner, manager** `phone`
(63 px) / `desk`; **sales, delivery, retailer** `field` (69) / `field`; **warehouse** `floor` (76) /
`field`. The root's three pre-election branches (client null, hydrating, Welcome/sign-in/change-password)
have no elected role and use `phone` / `desk` — the template's own pair, and the pair those chrome
screens are drawn at today. The shell still follows the **viewport**: `useViewport()` with
`layout.deskBreakpoint` 1024 is what `AppShell` and `KpiStrip` read (docs/08 §0), so a salesperson on a
laptop still gets the desk rail and an owner on a phone still gets the tabs. `density` governs only
table-vs-card and whether `text.tertiary` is allowed.

---

## 6. Guards and tests

**6.1 `root-layout-redirects.test.ts`.** `LAYOUTS` (lines 32-41) is a hard-coded list of eight
directories and `read()` (line 45) opens `join(frontend, app, 'app', '_layout.tsx')` — on the day the
six apps are deleted it fails on a **missing file**, not a bad assertion. It becomes
`['libs/app-template', 'dos-app', 'admin-app']`; its five assertions are unchanged and the merged root
must satisfy all five (§1.3 step 7). Add one case: each `app/<g>/_layout.tsx` contains **no** redirect
effect — the ladder lives in one place now.

**6.2 `parity.test.ts` needs no edit, and is not the guard docs/29 §3 asks for.** It asserts `@dos/ui`
web↔native export parity and the `platform` `.web.ts`/`.native.ts` pairs; it names no app. "The kit's
parity guard extends to it" is therefore a **new** guard beside it, `libs/ui/src/one-app-parity.test.ts`:
every file under `dos-app/app/**` imports only `@dos/ui`, `@dos/ui/platform`, `@dos/api-client`,
`@dos/offline`, `@dos/contracts`, `@dos/domain`, `expo-router` and its own `src/**` — never
`react-native`, `react-dom`, `@dos/ui/web`, `@dos/ui/native`. That is what makes one file serve the
website, Android and iOS, and nothing asserts it today.

**6.3 Kit guards that name a retired app** — re-point one segment deeper, no rewrite: `dos-046`
(`warehouse-app/app/pick/attention.tsx`), `dos-053` (`warehouse-app` `settings.tsx`), `dos-068`
(`delivery-app/src/lib/ui.tsx` → `src/groups/delivery/lib/ui.tsx`), `dos-089` (`sales-app`), `dos-101`,
`dos-105`, `dos-124`, `dos-144`, `dos-154` (all `retailer-app/app/**`). `document-urls.test.ts` needs
none (§1.5).

**6.4 The two new guards this design owes.** (a) _No group reaches another_: no file under `app/<g>/`
or `src/groups/<g>/` imports from another group, and no route literal in `app/<g>/` names a path
outside `/<g>` (the pre-election four — `/`, `/welcome`, `/sign-in`, `/change-password` — allowed).
This is the client half of docs/29 §3's acceptance: a sales screen never even _asks_ for another
service. (b) _One service per group_: `app/<g>/**` and `src/groups/<g>/**` reference `GROUPS.<g>` and
no other key; `serviceFor` is called only from `src/api.ts`.

**6.5 The 98 app tests.** 21 are pure logic on a sibling module and move untouched. **77 assert a file
path** through `new URL(relative, import.meta.url)` and are re-pathed mechanically (the lane computes
the new depth once). Eight need attention rather than a prefix:

- `owner-app/src/lib/dos-011-receipt-settles.guard.test.ts:69` reads `../../../manager-app/app/money/index.tsx`;
  `sales-app/src/lib/dos-093-new-shop.test.ts:128-129` reads `../../../owner-app/{app/shops/index.tsx,src/strings.ts}`;
  `sales-app/src/lib/dos-179-keep-words.guard.test.ts:245-246` reads `../../../delivery-app/**`. All
  three become intra-project source reads — keep them, re-pathed, with a header line saying they read
  and never import, so §6.4(a) is not contradicted.
- `manager-app/src/lib/dos-145-bill-search.guard.test.ts:43` asserts on the ROOT layout's search box;
  the search moves to the manager group layout (§1.4), so re-point it at `app/manager/_layout.tsx`,
  not at the new root.
- `sales-app/src/lib/leave.test.ts:576` and `delivery-app/src/lib/leave.test.ts:531` walk the whole
  `../../app` directory — re-point each at its own group or it sweeps all six.
- `owner-app/src/lib/dos-017-live-map.guard.test.ts:87-88` asserts `maplibre-gl` and
  `react-native-maps` are dependencies — re-point at `dos-app/package.json`.
- `owner-app/src/settings-views.test.ts` checks every `SETTINGS_VIEWS` labelKey exists in `strings.ts`;
  it passes unchanged **because §3 swaps rather than merges**.

**6.6 Duplicated helpers, recorded not fixed.** `src/lib/keys.ts` and `words.ts` are byte-identical
between owner and manager; `src/api.ts` is byte-identical in owner, manager and the template;
`owner/src/lib/refusal.tsx:4` and `bargain-order.ts:4` say in their own headers they are manager's file
"copied word for word … because apps cannot import each other". **Do not de-duplicate in this slice**
— a move plus a de-duplication makes every failure ambiguous. Follow-up after the gates (§8 step 6).

---

## 7. Retirement

Deleted in the same commit as the last green gate, never before:

- `frontend/{owner,manager,sales,warehouse,delivery,retailer}-app/` — whole directories, including
  `package.json`, `app.json`, `.env.example`, `metro.config.js`, `eslint.config.mjs`, `tsconfig.json`,
  the generated `README.md`, `dist/` and `.expo/`.
- `.claude/launch.json` entries `owner-app` (:122), `manager-app` (:131), `sales-app` (:140),
  `warehouse-app` (:149), `delivery-app` (:158), `retailer-app` (:167) → one `dos-app` entry
  (`pnpm --filter @dos/dos-app web`). `admin-app` (:176) and `app-template` (:113) stay.
- Web ports 5174-5178 released; **the one app takes 5173**. 5170 (template) and 5179 (console) stay.
- `backend/tools/generate-readmes.mts:41-47` and its five siblings hard-code
  `dir: '../frontend/<role>-app'`, `name: '@dos/<role>-app'` and a per-app `run:` block; the six
  collapse into one `dos` entry (dir `../frontend/dos-app`, one `run:` block, the screens list under
  six headings). **`pnpm docs:readme:check` is a CI step** — a backend edit inside a frontend slice
  that cannot be deferred.
- `frontend/libs/app-template/scripts/new-app.mjs:26-50` — the `ROLES` table's six business rows become
  a comment pointing here; the template stays generatable for the console and a future app.

Docs updated in the same commit: **docs/22 §2** (app column of rows 1-6 → `frontend/dos-app` + group,
plus a §11 change-log line); **docs/19** (:32, :60, :73); **docs/23** (§1's `frontend/owner-app`
headings and every `frontend/<role>-app/...` reference in the §10 gap table); **docs/28** (:110, :131,
:143 — seven `pnpm --filter … web` lines become one); **CLAUDE.md** Commands block (the
`@dos/owner-app web` line and the port list) and Layout block (`frontend/<role>-app` →
`frontend/dos-app`); **docs/29 §3** (a note that the web apps are retired per docs/22 §8 line 345,
superseding "the seven web apps stay"); **docs/18** RESUME HERE.

---

## 8. Order of work

1. **Scaffold (one lane, first, alone).** `frontend/dos-app` from the template per §1.5: project files,
   `app/` with the root `_layout.tsx` (§1.3), `src/config.ts`, `src/api.ts`, `pnpm install`. Gate:
   `pnpm --filter @dos/dos-app build`.
2. **`serviceFor` (one lane, parallel with 1).** §2 in `@dos/api-client`, with its own spec: every role
   maps to its port in split mode and to its docs/26 §7 prefix with a base; the link's `url` is a
   function and re-points when `session.role` changes. Gate: `pnpm --filter @dos/api-client test`.
3. **Six move lanes, in parallel, one per group.** Copy the routes and `src/**`, strip the layout to
   §1.4, rewrite that group's route literals to its base, re-path its own tests (§6.5). A lane never
   touches the root layout, `src/config.ts`, `src/api.ts`, another group, or `libs/**`. Gate per lane:
   `pnpm --filter @dos/dos-app typecheck` plus that group's specs.
4. **Root lane (one, after all six).** Wire `GROUPS`, the elected-role redirect, `<ApiProvider>`,
   Welcome/landing, `absoluteUrl(group, …)`; delete the four wrong-role strings.
5. **Guards lane.** §6.1-§6.4; the eight tests of §6.5.
6. **Retirement lane (last).** §7, including `generate-readmes.mts` and the doc edits. Record §6.6.

**Gate commands.** From `frontend/`:
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`.
From `backend/`: `pnpm docs:readme && pnpm docs:readme:check`. Then, with auth :3000 and the six
services up, `pnpm --filter @dos/dos-app web` on :5173 and a walk of one screen per group at 1280 and
390 signing in as each of the six demo users; then `expo run:android` on `Pixel_7_API_36` (`-memory
3072`) and one elected-role sign-in on the device.

---

## 9. Risks, ranked

| #   | Risk                                                                                                                                                                                                                                                                                                                         | How the verifier catches it                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **Route ambiguity** if Q1 goes the other way: a reload on `/orders` lands the wrong group.                                                                                                                                                                                                                                   | A spec enumerating every route file, resolving its URL, asserting no duplicate — fails today on 14 paths, must pass after.                             |
| R2  | **`absoluteUrl` against the wrong service**: logos and invoice PDFs 404 silently in five groups.                                                                                                                                                                                                                             | `libs/ui/src/document-urls.test.ts` (exists, globs `*-app`) plus a new case that no call site omits its group.                                         |
| R3  | **`react-native-maps` in every install.** Owner alone depends on it (`owner-app/package.json:52,57`); it is linked at build time, so a driver's install carries the Google Maps SDK and Android needs a key the repo lacks — which is why `owner-app/app/map.tsx:142` passes `listOnly={process.env.EXPO_OS === 'android'}`. | `expo run:android` must succeed on a clean tree; `/owner/map` renders the list on Android, the map on web. Q3.                                         |
| R4  | **The `.wasm` block lost** by basing metro on owner's or manager's config — the three offline groups' web store falls back to memory with no error.                                                                                                                                                                          | `pnpm build` (every group's web export) plus a store-open assertion in the sales web walk; `ConnectionStrip` must not say "not saved on this browser". |
| R5  | **Strings merged instead of swapped** — 71 keys take another audience's wording.                                                                                                                                                                                                                                             | A spec that each group layout passes its own record and the six are never spread into one object.                                                      |
| R6  | **Store-file collision** if the prefix collapses to one app identity: a shared van phone gives one person one file for sales and delivery.                                                                                                                                                                                   | `libs/offline/src/identity.test.ts:248-252` extended: two elected roles, same person, same distributor → two names.                                    |
| R7  | **DOS-055 redirect regresses** while six layouts fold into one.                                                                                                                                                                                                                                                              | `root-layout-redirects.test.ts` re-pointed (§6.1) + the "no redirect effect in a group layout" case.                                                   |
| R8  | **`pnpm docs:readme:check` fails in CI** because the backend generator still names six frontend apps.                                                                                                                                                                                                                        | The backend gate command in §8.                                                                                                                        |
| R9  | **A group reaches another group's service or files** — the one thing the merge newly allows.                                                                                                                                                                                                                                 | §6.4's two guards.                                                                                                                                     |
| R10 | **`.env` drift**: one `EXPO_PUBLIC_API_URL` no longer means one service.                                                                                                                                                                                                                                                     | `.env.example` documents it as the ALL-IN-ONE base only; `serviceFor`'s spec covers both shapes.                                                       |

---

## 10. Open for the architect

**Q1 — visible role segment, or invisible expo-router groups?** docs/29 §3 writes `(owner)/`. Fourteen
paths collide and expo-router does not reject duplicates (§1.1), so with invisible groups a bare URL —
which is every URL after a reload, now the only front door — resolves by tree order, not by the elected
role. _Recommend visible segments (`/owner/orders`)._ Cost: the 112 route literals gain a base,
mitigated by a `useGo()` helper whose base comes from a group context, making the edit one rename per
call site and checkable by §6.4(a). **Settle before lane 3 starts; all six move lanes depend on it.**

**Q2 — does the root mount one group or all six?** docs/29 §3 says "mounts that group's navigation" and
also "the bundle carries every group's code" — consistent for code-splitting, inconsistent for the
router if all six trees register, and expo-router registers the whole `app/` tree statically with no
supported way to hide a branch. _Recommend: all six register (they must); the elected role is enforced
by the root redirect (§1.3 step 7) and by the server's 403. "Mounts that group" means the shell,
strings, theme and store — not the route table._ Safe under Q1's recommendation, not otherwise.

**Q3 — maps in every install (R3).** (a) ship it and get an Android Maps key before go-live; (b) keep
`listOnly` on Android for the pilot and ship the native module unused; (c) make the owner live map
web-only (MapLibre) with a list on native. _Recommend (b): it is today's behaviour, needs no key, and
is one line to revisit._ A product and cost call, not the planner's.

**Q4 — store listing name and bundle id.** §1.5 proposes `Distribution OS` / `dos` /
`in.distributionos.app`. The six existing ids are unpublished so nothing is orphaned, but the id is
permanent once submitted. _Recommend as proposed; confirm before the first `eas build`._

**Q5 — does the accountant get its own group?** Today the manager app serves both and the split is
entirely `PERMISSIONS` (`manager-app/src/nav.ts:12-18`). §1.3 maps `accountant → manager`. _Recommend
one group; the matrix already hides `/fulfilment` and `/prices`._

**Q6 — the six duplicated helper files (§6.6).** The merge finally makes one copy possible. _Recommend
not in this slice; follow-up immediately after the gates, and only after checking each copy's strings
agree (owner's and manager's `bargain-order.ts` differ by ~23 lines)._

**Q7 — Welcome once per device, across six groups.** docs/29 §1 says once per device until a session
exists. With one install, signing out of sales and in as delivery is the same device. _Recommend
device-scoped, not role-scoped — one `dos.welcome.seen` key in `platform.storage`. It is a wordmark,
not a gate._

---

## Architect's ruling (Fable, 2026-09-21 evening) — binding on every lane that executes this plan

Both skeptics returned _sound with amendments_; between them they raised four blockers. All four are
upheld. The plan proceeds with the rulings below, which win over any sentence above that disagrees.

### The four blockers

**B1 — The elected role must survive a refresh.** `auth.service.ts` re-derives the role from the
membership on every refresh and on `switchTenant`, so an elected role would silently revert to the
membership role fifteen minutes after sign-in. This is a defect in the role-election design as first
written, not in this plan. Ruling, added to docs/29 §2: `auth_sessions` stores the **elected** role;
refresh re-validates the election against the membership _and its `extra_roles` as they are now_ and
re-mints the elected role — if the election is no longer permitted (the owner removed the extra role),
the refresh fails closed and the person signs in again; `switchTenant` carries `actAs` and re-validates
the same way. The role-election lane is held to this at its review before it merges.

**B2 — `platform` is the device kind, never the app.** The sentence in §2 that reuses `platform:
AuthPlatform` for the elected group is struck. `AuthPlatformSchema` is `web | android | ios` and every
app sends the OS. The elected role travels ONLY as `actAs`.

**B3 — In one app, the person is the elector.** With the six `src/config.ts` gone there is no `APP.role`
to send. Ruling: election happens at sign-in, chosen by the person. After username and password, if the
membership permits more than one role (its own plus what the election table and `extra_roles` allow),
the app shows **"Continue as …"** — one row per permitted role, the last-chosen role on this device
preselected (`dos.lastRole` in `platform.storage`); a membership that permits exactly one role goes
straight in. The choice is sent as `actAs` on login and on `switchTenant`. **Changing role is a fresh
election that mints a new token** — never a client-side group change under the same token. This
replaces "each field app sends its own role" in docs/29 §2 for the one app; the wrong-role screen and
its four string pairs are deleted **in the same commit** that re-points the kit guard which asserts
them (`docs29-field-app-role.guard.test.ts` is re-targeted at the chooser: the elected role always maps
to the group that renders, and a refused election is the docs/29 sentence at the chooser, not a screen
after sign-in).

**B4 — §1.3 and §1.4 are re-derived from HEAD before any move.** The root layout on main now carries
the Welcome and the landing (`9391c17`). Lane 0 of the execution rewrites those two sections from the
file as it is, not as it was, and every later lane reads the rewritten sections.

### The planner's questions

- **Q1 — visible role segments. Yes.** `app/owner/…` → `/owner/orders`. The website is the only front
  door after retirement and a URL that resolves by tree order is not acceptable. Every route literal goes
  through one helper (`routeFor(group, path)` / `useGo()`), and the count is what the skeptic measured —
  about 347 sites across `router.*` calls, `nav.ts` hrefs and keys, and `<PageTabs group/active>` —
  not 112. Size lane 3 to that. Fix the kit's `isActive` home special-case first, with a spec, so
  `/owner` does not light for every `/owner/*` route.
- **Q2 — all six groups register; the root redirect and the server's 403 enforce.** With one addition
  from the skeptic: a group layout whose group ≠ the session's elected group renders the redirect and
  **nothing else** — no data is painted for a foreign role even for one frame. `GROUP_OF` is
  `Record<MembershipRole, GroupName>`, total, and an unmapped role signs out rather than redirecting to
  `/undefined`.
- **Q3 — maps: (b).** Keep `listOnly` on Android for the pilot and ship the module unused. The pilot is
  Android-first and has no Maps key; one line to revisit.
- **Q4 — "Distribution OS", slug `dos`, bundle id `in.distributionos.app`.** Approved; it is confirmed
  with the founder in writing before the first store build, because it is permanent once submitted.
- **Q5 — the accountant shares the manager group.** Yes; the matrix already hides what the accountant may
  not see.
- **Q6 — no de-duplication in this slice.** Yes. A move plus a merge makes every failure ambiguous.
- **Q7 — Welcome is device-scoped, one key.** Yes.

### Amendments upheld from the skeptics, in one line each

Strings are **swapped per group**, never merged into one record (71 keys carry different values for
different audiences). The DOS-167 store prefix comes from the **elected group** (`dos-sales`,
`dos-warehouse`, `dos-delivery`), so one person on a shared phone keeps one clean store per role —
and **sign-out is device-wide**: the leave flow enumerates all three field prefixes for this person and
distributor, not only the current engine's. `apiUrlFor` is evaluated **once per request** and the base
is pinned for that request's replay. One origin means **one session per browser profile**: changing
role or distributor is the way, never a second sign-in beside the first. `welcome.test.ts`,
`root-layout-redirects.test.ts` and `dos-179-keep-claims.guard.test.ts` join the re-point list;
`warehouse-app/src/lib/leave.test.ts` joins the three that walk a whole `app/` directory; the
route-literal guard covers `src/groups/<g>/**` as well as `app/<g>/**`. The `.wasm` assetExts block
comes from the template's `metro.config.js`, not owner's or manager's. `backend/tools/generate-readmes`
is edited in the same slice or CI's `docs:readme:check` goes red.

### Order of execution (replaces §8 where they differ)

0. Re-derive §1.3/§1.4 from HEAD; land the `isActive` kit fix and the `routeFor` helper with their specs.
1. Six move lanes in parallel, one per group, touching only `app/<g>/**` and `src/groups/<g>/**`.
2. Root layout + chooser + config + strings swap + api-client (`serviceFor`, `apiUrlFor`, `actAs` from the
   chooser) — one lane, after 1.
3. Guards, re-points, retirement of the six apps, launch.json, generate-readmes, docs — one lane, after 2.
4. Gates on the whole tree, then the blind verifier, then the architect reads the diff before merge.

Waits for: the role-election lane merged with B1 applied. Nothing moves before that.
