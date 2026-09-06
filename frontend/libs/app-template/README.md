# `@dos/app-template` — the universal-app skeleton

Every Distribution OS role app is generated from this package, and then diverges only in its screens.
It is a **working Expo app in its own right** (that is the point: `pnpm build` here runs
`expo export --platform web`, so the skeleton cannot rot), pointed at owner-service on :3001 and
served on port 5170.

## Make an app

```bash
cd frontend
pnpm --filter @dos/app-template new owner       # -> frontend/owner-app, web 5173, api :3001
pnpm install                                    # the new package joins the workspace
pnpm --filter @dos/owner-app web                # http://localhost:5173
```

> **After generating an app, run `pnpm docs:readme` in `backend/`.** The backend's README generator
> (`backend/tools/generate-readmes.mts`) OWNS `frontend/<role>-app/README.md` for the seven known roles —
> it writes the endpoint table from the contract — and `pnpm docs:readme:check` is part of the backend CI
> job. The README this generator writes is a placeholder that the backend's will replace.

Roles and ports the generator knows (docs/22 §8, 2026-09-06): owner 5173/:3001 · manager 5174/:3002 ·
sales 5175/:3003 · warehouse 5176/:3004 · delivery 5177/:3005 · retailer 5178/:3006 · admin 5179/:3007.
Pass a port to override. It refuses to overwrite an app that already exists.

The generator rewrites **six** things and copies everything else byte-identical: the package name and
its `web` port; `app.json` (name, slug, scheme, bundle ids); `src/config.ts` (role, title, ports, the
UX-00 §5.2 touch floor, density); every `link:` path (an app sits one directory shallower than the
template, and a copied path would point above the repo — silently making every contract type `any`);
`.env.example`; and the README.

## What is in here

| File               | What it is                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/_layout.tsx`  | The root layout, identical in all seven apps: `boot()` → `ApiProvider` → `ThemeProvider` → `AppShell`, the session gate, and the hand-off of expo-router's navigation to the kit. |
| `app/index.tsx`    | Home. Reads `tenancy.me` + `tenancy.branding.get` and draws them with `KpiStrip`, `Register`, `Button`.                                                                           |
| `app/sign-in.tsx`  | Username + password against auth-service (docs/22 §7). `tenantId` is deliberately not asked for.                                                                                  |
| `app/settings.tsx` | A second route, so the rail and the tab bar have somewhere to go.                                                                                                                 |
| `src/config.ts`    | The only file that says which app this is.                                                                                                                                        |
| `src/nav.ts`       | Navigation as data: sections → the desk rail ≥ 1024 px, the phone tabs below.                                                                                                     |
| `src/api.ts`       | The API client over `@dos/ui/platform`'s token store (SecureStore on a phone, `localStorage` on the web).                                                                         |
| `src/strings.ts`   | This app's string namespace. English only for the pilot, every word already keyed.                                                                                                |
| `metro.config.js`  | Two workspaces, one repo: watches `backend/libs`, pins the lookup paths, package exports on.                                                                                      |

## The rules this package enforces

- A screen imports from `@dos/ui`, `@dos/api-client`, `@dos/contracts` and `@dos/domain`. **Never**
  `react-native`, `react-dom`, `@dos/ui/web` or `@dos/ui/native` — ESLint refuses all four
  (`@dos/config/eslint/app`), because naming a renderer forks the app into two codebases.
- **No hex colours.** Read a semantic colour from the theme (`useColors()`); UX-00 §16.
- Money is integer paise in state and props, formatted only by `<Money>` / `<RupeeInput>`.
- Every mutation carries a client-generated UUIDv7 `id` and an `idempotencyKey` — `useMutation`'s
  `meta` is one intent, and a retry of that intent reuses both.

## Environment

`EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_URL` (see `.env.example`). Expo inlines them at build
time. `EXPO_PUBLIC_API_PREFIX` is for the all-in-one process of docs/26 §7, where every service sits
behind one origin under its own prefix.
