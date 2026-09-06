# Distribution OS — frontend

Seven apps, one per role, each talking to its own backend service. They stand on a shared kit: one design
system, one API client, one offline library. This workspace installs and builds **separately** from
`backend/`; the two are linked, not merged.

```
frontend/
  libs/config       tsconfig + eslint presets (deliberately a copy of the backend's, see below)
  libs/ui           @dos/ui      — the design system: tokens, strings, the UX-00 §6 components (web + native)
  libs/api-client   @dos/api-client — the typed oRPC client, session, cache, React layer
  libs/offline      @dos/offline — the offline write path (a later slice; untouched by the kit)
  owner-app         Vite web today, Expo later          -> owner-service    :3001
  admin-app         placeholder                          -> admin-service    :3007
  (manager, sales, warehouse, delivery, retailer apps arrive one slice at a time)
```

## How the pieces fit

```
  a screen
     |  imports @dos/ui (+ @dos/ui/web or /native), @dos/domain, @dos/contracts — nothing else
     v
  @dos/ui ----------------- tokens, strings, money/qty, chart geometry, the components
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

pnpm --filter @dos/owner-app dev      # http://localhost:5173, proxying /api -> :3001 and /auth -> :3000
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

| App                 | Split (one service per port)         | All-in-one (one port, path prefixes)        |
| ------------------- | ------------------------------------ | ------------------------------------------- |
| owner (Vite web)    | `VITE_API_URL=http://localhost:3001` | `VITE_API_URL=https://api.example.in/owner` |
| the Expo apps       | `EXPO_PUBLIC_API_URL=…:300{2..6}`    | `EXPO_PUBLIC_API_URL=…/{manager,sales,…}`   |
| every app's sign-in | `…_AUTH_URL=http://localhost:3000`   | `…_AUTH_URL=https://api.example.in/auth`    |

In dev the owner app needs neither: Vite proxies `/api` to :3001 and `/auth` to :3000, so the browser sees one
origin and there is no CORS.

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
- `react-native` and `react-native-svg` are **optional peers** of `@dos/ui`, present as devDependencies so the
  native layer typechecks and tests here. When the Expo apps arrive they pin their own versions from the
  template; the catalog's React versions are for the web builds.
- The node linker is `hoisted` because Expo expects a flat `node_modules`; Vite therefore dedupes `react` and
  `react-dom` explicitly.

## Where the design comes from

`docs/design/UX-00-design-system.md` is the contract (layout **A Ledger**, chosen by the founder on
2026-09-05). `docs/23-app-screens-and-api-gaps.md` is the binding screen inventory — a screen not listed there
is out of scope. `docs/22-source-of-truth.md` wins over both where they disagree.
