# Distribution OS — frontend

Seven apps, one per role, each talking to its own backend service. They stand on a shared kit: one design
system, one API client, one offline library. This workspace installs and builds **separately** from
`backend/`; the two are linked, not merged.

**Every app is universal** — website + Android + iOS from ONE Expo codebase per role (founder,
2026-09-06; docs/22 §8, docs/08 §0). A screen is written against the `@dos/ui` contract and Metro swaps
the renderer per platform: a real DOM on the web, React Native views on a phone. The shell is chosen by
VIEWPORT (desk rail ≥ 1024 px, phone tabs below), not by app.

```
frontend/
  libs/config       tsconfig + eslint presets (deliberately a copy of the backend's, see below)
  libs/ui           @dos/ui      — the design system: tokens, strings, the UX-00 §6 components, the layout
                                   primitives, AppShell, and @dos/ui/platform (camera, GPS, print, files, …)
  libs/api-client   @dos/api-client — the typed oRPC client, session, cache, React layer
  libs/offline      @dos/offline — the offline write path (a later slice; untouched by the kit)
  libs/app-template @dos/app-template — the skeleton every role app is generated from, and a running app itself
  admin-app         placeholder                          -> admin-service    :3007
  (owner, manager, sales, warehouse, delivery, retailer apps are generated from the template, one slice at a time)
```

## Making an app

```bash
cd frontend
pnpm --filter @dos/app-template new owner    # -> frontend/owner-app, web 5173, api :3001
pnpm install
pnpm --filter @dos/owner-app web             # http://localhost:5173
pnpm --filter @dos/owner-app ios             # the iOS simulator (development build)
pnpm --filter @dos/owner-app android         # a device or emulator
```

Ports: owner 5173/:3001 · manager 5174/:3002 · sales 5175/:3003 · warehouse 5176/:3004 ·
delivery 5177/:3005 · retailer 5178/:3006 · admin 5179/:3007.

## How the pieces fit

```
  a screen
     |  imports @dos/ui, @dos/api-client, @dos/domain, @dos/contracts — nothing else.
     |  NEVER react-native, react-dom, @dos/ui/web or @dos/ui/native (ESLint refuses all four).
     v
  @dos/ui ----------------- tokens, strings, money/qty, chart geometry, the components, the layout
                            primitives, AppShell; Metro picks ./web or ./native per platform
  @dos/ui/platform -------- storage, documents, camera, location, files, haptics, share, crypto
                            (a .web.ts / .native.ts pair each, one signature)
  @dos/api-client --------- session + typed client + query cache
     |  types from @dos/contracts (link: ../../backend/libs/contracts)
     |  money / quantity / date maths from @dos/domain (link: ../../backend/libs/domain)
     v
  auth-service :3000   +   this app's own service (owner :3001, manager :3002, sales :3003,
                            warehouse :3004, delivery :3005, retailer :3006, admin :3007)
     v
  one Postgres, tenant_id + forced RLS
```

**The backend is the contract.** `@dos/contracts` and `@dos/domain` are linked from `backend/libs` by
`link:` — a symlink, not a copy — so a wire shape is never re-declared on this side. Build them in `backend/`
before a frontend typecheck if a type is missing:

```bash
cd backend && pnpm --filter @dos/contracts build && pnpm --filter @dos/domain build
```

**A service serves only its roles.** An owner token is refused at `/sales` before any business logic, and
every endpoint has a row in the permission matrix. An app therefore never has to decide whether a role may
call something — but it must still never _display_ a field it happens to receive: purchase cost, landed cost
and margin are invisible to salesperson, warehouse, delivery and retailer roles by database policy, and a
screen for those roles carries no cost string at all.

## Running it

Node 24 through fnm, pnpm 11. Every non-login shell starts on the system Node, so:

```bash
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24
```

```bash
cd frontend && pnpm install
pnpm lint && pnpm typecheck && pnpm build && pnpm test    # the CI frontend job

pnpm --filter @dos/app-template web   # http://localhost:5170 — the skeleton, running
pnpm --filter @dos/ui gallery         # http://localhost:5199 — every component, every state
```

The services it talks to (start from `backend/`, or use the `.claude/launch.json` entries):

```bash
cd backend && pnpm --filter @dos/auth-service dev     # :3000
cd backend && pnpm --filter @dos/owner-service dev    # :3001
```

Sign in with a demo user from `pnpm db:seed` — every password is `Dos@1234`; `docs/18-build-log.md` lists one
username per role (owner `sunil.tarsun`, manager `vikas.kadam`, sales `rahul.deshmukh`, …).

## Configuration

One base URL per app, plus the auth origin. Nothing else changes between the two deployment shapes
(`docs/26` §7):

| Variable                 | Split (one service per port) | All-in-one (one port, path prefixes) |
| ------------------------ | ---------------------------- | ------------------------------------ |
| `EXPO_PUBLIC_API_URL`    | `http://127.0.0.1:300{1..7}` | `https://api.example.in`             |
| `EXPO_PUBLIC_API_PREFIX` | unset                        | `/owner`, `/manager`, `/sales`, …    |
| `EXPO_PUBLIC_AUTH_URL`   | `http://127.0.0.1:3000`      | `https://api.example.in`             |

Expo inlines every `EXPO_PUBLIC_*` variable at BUILD time, so nothing secret may be named there. In dev the
services answer any localhost origin (`corsOptions()`), so there is no proxy to configure.

## The rules a reviewer checks

- **Money is integer paise** in every prop and every piece of state; it is formatted only at the edge, by
  `<Money>` / `<RupeeInput>`. No arithmetic on a formatted string, ever.
- **Quantity is integer pieces** plus a case size, printed dual-unit and never toggled.
- **Every mutation carries a client UUIDv7 `id` and an `idempotencyKey`**, and a retry of the same intent
  re-sends both (`useMutation`'s `meta`).
- **No hex outside `@dos/ui`'s `tokens.ts`.** Screens name semantic tokens.
- **Every user-visible string has a locale key** (`@dos/ui`'s `strings.ts` plus the app's own namespace).
  English only for the pilot; a second language is a file, not a refactor.
- **48 dp is not our floor**: 69 dp in sales/retailer, 76 dp on every warehouse target and the delivery stop
  actions, 63 dp on the owner and manager phone surfaces, 32 px on desk (UX-00 §5.2).
- **The distributor's own name and logo** appear inside every app and on every document; the Distribution OS
  mark appears on the sign-in screen and nowhere else.

## Toolchain notes

- Exactly **one** TypeScript version (6.0.x) per workspace, from the `catalog:` in `pnpm-workspace.yaml`.
  Two copies make typescript-eslint's type-aware rules crash or report nonsense.
- `libs/config` duplicates ~60 lines of the backend presets **on purpose**: the two workspaces install
  separately, and a `link:` to the backend config would make the frontend lint with the backend's copy of
  typescript-eslint.
- **The Expo SDK decides `react`, `react-native` and every `expo-*` version** in the catalog — never the other
  way round (docs/08 §0). Today: **Expo SDK 57.0.20 · React Native 0.86.3 · React 19.2.3 · expo-router 57.0.19**,
  taken from `expo@57.0.20`'s own `bundledNativeModules.json`. To move SDK, read that file again.
- `react-native`, `react-native-safe-area-context`, `react-native-svg` and the `expo-*` modules the platform
  layer uses are **optional peers** of `@dos/ui`, present as devDependencies so the native half typechecks and
  tests here without forcing a browser-only consumer to install Expo.
- The node linker is `hoisted` because Expo expects a flat `node_modules`.
- Metro does **not** rewrite a `./thing.js` specifier to `./thing.ts` the way `tsc` and Vite do, and the repo
  writes relative imports Node's way because the backend emits real `.js`. Each app's `metro.config.js`
  carries a `resolveRequest` that tries the extensionless form first; see the comment there.

## Where the design comes from

`docs/design/UX-00-design-system.md` is the contract (layout **A Ledger**, chosen by the founder on
2026-09-05). `docs/23-app-screens-and-api-gaps.md` is the binding screen inventory — a screen not listed there
is out of scope. `docs/22-source-of-truth.md` wins over both where they disagree.
