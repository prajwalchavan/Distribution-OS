# Distribution OS (`@dos/dos-app`)

**The one app** (docs/31, docs/29 §3): ONE Expo codebase that is the website, the Android app and the
iOS app for all six business roles. The elected role in the token (docs/29 §2) decides which route
group opens — `app/owner/`, `app/manager/`, `app/sales/`, `app/warehouse/`, `app/delivery/`,
`app/retailer/` — and each group talks to its own service. The platform console (`admin-app`, :5179,
:3007) stays a separate app and is not part of this merge.

```bash
cd backend  && pnpm --filter @dos/auth-service dev        # :3000, sign-in
cd backend  && pnpm dev                                   # the six role services, :3001-:3006
cd frontend && pnpm --filter @dos/dos-app web             # http://localhost:5173
cd frontend && pnpm --filter @dos/dos-app ios             # the iOS simulator
cd frontend && pnpm --filter @dos/dos-app android         # Pixel_7_API_36 (boot it with -memory 3072)
```

Screens are written against the `@dos/ui` contract only; `react-native` and `react-dom` are
unimportable here (ESLint). Platform behaviour goes through `@dos/ui/platform`. A screen never writes
a group base into a route literal — `useGo()` / `routeFor(group, path)` from `@dos/ui` do that.

## State of this directory

**Skeleton.** `app/` holds a PLACEHOLDER `_layout.tsx` and nothing else; the six move lanes fill the
groups, the root lane replaces the layout per docs/31 §1.3, and the retirement lane deletes the six
per-role apps and re-points `backend/tools/generate-readmes.mts` (which still names them, so this
README is hand-written until it does).
