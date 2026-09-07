# 28 — Running the whole thing on this Mac

Everything below has been run on the founder's machine. Nothing here needs the internet after the first
`pnpm install`, and nothing here needs a password except starting Postgres the very first time.

**Every shell starts with this line.** Non-login shells (Claude's Bash tool, `.claude/launch.json`) come up on
the system Node 22; the repo needs 24.

```bash
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24
```

## 1. The database

Postgres 17 runs as a Homebrew service on **127.0.0.1:5439** (port 5432 is an unrelated Postgres 14 that is too
old — the schema needs 15+).

```bash
brew services start postgresql@17
/opt/homebrew/opt/postgresql@17/bin/psql -h 127.0.0.1 -p 5439 -U dos -d dos -c "select count(*) from tenants"
```

`backend/.env` already carries `DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos`. To look at the data by
hand, point DBeaver or pgAdmin at the same host/port/user/password (`dos` / `dos`, database `dos`) — the steps
with screenshots are in `docs/21-local-database-setup.md`.

## 2. Install and build

Two independent workspaces. There is no root `package.json`; run pnpm inside one of them.

```bash
cd backend && pnpm install && pnpm build
cd ../frontend && pnpm install
```

The frontend links `@dos/contracts` and `@dos/domain` out of `backend/libs` through a symlink, so **backend
builds first** or the frontend cannot typecheck.

## 3. Schema and demo data

```bash
cd backend
pnpm db:migrate     # 34 migrations, expand-only; a no-op on an up-to-date database
pnpm db:seed        # idempotent — safe to re-run, and the way to undo `pnpm smoke --destructive`
```

The seed builds three distributorships: **Tarsun Enterprise** (the pilot, with its real GSTIN, address and
logo), **Sai Distributors** and **Kalyan Agencies** — with staff under each and shops that buy from more than
one of them, which is what makes the tenant-boundary tests meaningful. It prints every sign-in it created.

## 4. Start the services

Eight services and a worker. Each runs alone; start only the ones the app you are opening needs, plus auth.

```bash
cd backend
pnpm --filter @dos/auth-service dev        # :3000  sign-in, refresh, switch distributor  (ALWAYS)
pnpm --filter @dos/owner-service dev       # :3001
pnpm --filter @dos/manager-service dev     # :3002  manager + accountant
pnpm --filter @dos/sales-service dev       # :3003
pnpm --filter @dos/warehouse-service dev   # :3004
pnpm --filter @dos/delivery-service dev    # :3005
pnpm --filter @dos/retailer-service dev    # :3006
pnpm --filter @dos/admin-service dev       # :3007  platform console
pnpm --filter @dos/worker dev              # pg-boss: outbox relay, PDF rendering, docint, retention
```

**The worker is not optional if you want a document.** A bill, credit note, challan or receipt PDF is rendered
by the `documents.pdf.render` job; with the worker down the app correctly answers "the bill is being printed"
for ever.

Or run all of it in one process — this is also the shape the first cloud deployment uses (docs/26 §7):

```bash
cd backend && DOS_MODE=all pnpm --filter @dos/owner-service dev    # :3100, every service under a path prefix
```

Each service serves `/health`, `/swagger` (Swagger UI) and `/docs` (Scalar) with real examples built from the
seeded rows, so `http://localhost:3001/docs` is a working API console for the owner service.

Check everything at once:

```bash
cd backend && pnpm smoke        # signs in per role and calls every operation of every RUNNING service
```

It must end **0 BROKEN**. It writes as it goes, so re-run `pnpm db:seed` afterwards to clear its leftovers.

## 5. Start an app

Seven apps, one Expo codebase each, serving website + Android + iOS.

```bash
cd frontend
pnpm --filter @dos/owner-app web       # http://localhost:5173
```

| App       | URL                     | Service | Sign in as       |
| --------- | ----------------------- | ------- | ---------------- |
| Owner     | <http://localhost:5173> | :3001   | `sunil.tarsun`   |
| Manager   | <http://localhost:5174> | :3002   | `vikas.kadam`    |
| Sales     | <http://localhost:5175> | :3003   | `rahul.deshmukh` |
| Warehouse | <http://localhost:5176> | :3004   | `dinesh.patil`   |
| Delivery  | <http://localhost:5177> | :3005   | `ganesh.more`    |
| Retailer  | <http://localhost:5178> | :3006   | `ramesh.gupta`   |
| Admin     | <http://localhost:5179> | :3007   | `dos.admin`      |

**Password for every demo account: `Dos@1234`.** Leave the distributor field empty unless the person belongs to
more than one — `ramesh.gupta` (a shop buying from all three) and the admin accounts are the interesting ones.

The platform console signs in somewhere else on purpose: `dos.admin` and `dos.support` hold no membership, so
`/auth/login` refuses them and they go to `POST /auth/platform/login`. The other two distributorships sign in
normally with their own owners, `prakash.salunkhe` (Sai) and `nitin.bhoir` (Kalyan Agencies).

In the Claude desktop app, `.claude/launch.json` has an entry for each of these (`owner-service`, `worker`,
`owner-app`, …) so the Browser pane can start them by name.

## 6. The same app on a phone

Android — the SDK is installed, no Android Studio project needed:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"
emulator -avd Pixel_7_API_36 -memory 3072 -no-snapshot-save &
adb wait-for-device && adb shell getprop sys.boot_completed        # 1 = ready
cd frontend && pnpm --filter @dos/owner-app android
```

`-memory 3072` is not optional: at the default 2 GB the emulator thrashes on a dev bundle this size and throws
ANR dialogs that swallow input.

iOS — Xcode 16.2 and the iOS 18.0 runtime are installed and the apps boot and render in Expo Go, but
`expo run:ios` currently fails on a simulator-SDK mismatch (the build wants 18.2, the runtime is 18.0), and
there is no headless way to _tap_ an iOS simulator on this Mac (`xcrun simctl` has no input verb and
`idb-companion` requires macOS 26). Android exercises the same native renderer, which is why the gates used it.
Screenshots without tapping:

```bash
xcrun simctl io booted screenshot /tmp/shot.png
```

## 7. Checking the code

```bash
cd backend  && pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm docs:readme:check && pnpm db:migrate && pnpm test
cd frontend && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

That is exactly what CI runs, in that order. `pnpm build` in the frontend runs `expo export --platform web` for
every app, so it is the real proof that all seven still ship as websites.

## 8. When something looks wrong

| What you see                                        | What it is                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| "The bill is being printed. Try again in a moment." | the worker is down — `pnpm --filter @dos/worker dev`                                          |
| An app says "Offline since …" with a live network   | that app's service is down; check `/health` on its port                                       |
| 403 on every screen after sign-in                   | signed in to the wrong app for that role; each service refuses roles it does not serve        |
| A screen full of ₹1 receipts or 400 approvals       | `pnpm smoke` leftovers in the pilot tenant — `pnpm db:seed` sweeps them                       |
| `pnpm` runs on Node 22 and fails                    | the `fnm` line at the top of this file was not run in that shell                              |
| A library change is invisible to a service          | libraries are consumed from `dist/` — `pnpm --filter <pkg> build`, or keep `pnpm dev` running |
| Postgres refuses on 5432                            | wrong instance; this project is on **5439**                                                   |

## 9. What is not here yet

Nothing is deployed. Everything above is local, against the local Postgres, with demo data. The cloud shape,
its three cost stages and what has to be bought are in `docs/26-environments-and-configuration.md`; the backend
gaps the frontend gates found are queued in `docs/23-app-screens-and-api-gaps.md` §10.
