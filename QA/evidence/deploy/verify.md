# Deploy-plumbing verification — qa/b2-deploy-plumbing @ 39a802d

Run 2026-09-21 in the worktree `.claude/worktrees/b2-deploy-plumbing`, against
`dos_test_b2_deploy` on 127.0.0.1:5439, `DATABASE_POOL_MAX=3`, Node 24.

**Verdict: pass.** Every sentence in the repair report that says something was RUN was re-run here
and produced the number it claims. Nothing was taken on trust; where a proof was claimed to go red,
the mutation was re-made and the red re-observed. Three minor findings below, none of them a
fabricated run.

This lane exists because the previous build shipped a Dockerfile comment saying the image was
"built and run for the first time 2026-09-21 on colima" when it never was (never-list #12,
docs/22 §9). That comment is gone; its replacement is truthful, and the machine state that makes it
truthful was checked directly (no Docker daemon has ever existed here).

Logs for everything below: `/tmp/dep-verify/*.log`.

---

## 1. Deploy specs, one file at a time

`cd backend && pnpm --filter @dos/all-in-one exec vitest run src/deploy/<file>`

| File | Claimed | Observed here | Log |
| --- | --- | --- | --- |
| `dockerfile.spec.ts` | 7 passed | **7 passed** | `dockerfile.log` |
| `compose.spec.ts` | 6 passed | **6 passed** | `compose.log` |
| `caddy.spec.ts` | 5 passed | **5 passed** | `caddy.log` |
| `secrets.spec.ts` | 5 passed | **5 passed** | `secrets.log` |
| `pages.spec.ts` | 7 passed | **7 passed** | `pages.log` |
| `runbook.spec.ts` | 8 passed | **8 passed** | `runbook.log` |
| `backup.spec.ts` (no opt-in) | — | 5 passed \| 1 skipped | `backup.noopt.log` |
| `migrate-bootstrap.spec.ts` (no opt-in) | — | 3 passed \| 1 skipped | `migrate-bootstrap.noopt.log` |
| `docker-image.proof.spec.ts` (no opt-in) | 1 skipped file | 1 file skipped, 1 test skipped | `docker-image.proof.noopt.log` |

Totals reconcile with the claimed "8 files passed | 1 skipped; 46 passed | 3 skipped":
7+6+5+5+7+8 = 38, +5 +3 = 46 passed; 1+1+1 = 3 skipped.

Two specs gate on a binary rather than skipping silently in a way that would hide a claim, and both
really ran here: `caddy` v2.11.4 is on PATH (so `caddy validate --adapter caddyfile` genuinely ran —
5 passed, not 4 passed | 1 skipped), and Docker Compose v5.5.1 is on PATH (so `docker compose config`
genuinely resolved `compose.prod.yml` — 6 passed under `describe.runIf(hasCompose)`; `config` needs
no daemon).

`pnpm test` in `backend/` reaches these files (all-in-one's vitest `include` is
`src/**/*.{test,spec}.ts`, and ci.yml runs `pnpm test`), so the guards hold in CI with the opt-ins
skipping.

## 2. The opt-in database proofs

Run one file at a time, as the spec headers require.

**DEP-04** `DOS_DEPLOY_PROOF=1 … migrate-bootstrap.spec.ts` → **4 passed** (89 s).
`migrate-bootstrap.proof.log`.

Every number docs/30 §6 states, read back with psql immediately afterwards:

| | claimed | observed |
| --- | --- | --- |
| `drizzle.__drizzle_migrations` | 57 | **57** (and 57 entries in `_journal.json`) |
| tables in `public` | 140 | **140** |
| tenants / users / memberships | 1 / 1 / 1 | **1 / 1 / 1** |
| accounts / locations / numbering_series | 30 / 3 / 10 | **30 / 3 / 10** |
| feature_flags / tenant_settings | 5 / 10 | **5 / 10** |
| sales_orders, invoices, retailers, retailer_identities, tenant_products, auth_sessions | 0 | **all 0** |

**DEP-05** `DOS_DEPLOY_PROOF=1 … backup.spec.ts` → **6 passed** (69 s). `backup.proof.log`.

## 3. The red proofs, re-made

### `--no-acl` (DEP-05) — the one the lane was told to check

Added `--no-acl` to backup.sh's `pg_dump` (line 63) and re-ran the file alone:

```
× DEP-05 keeps ownership and ACLs in the dump, because every RLS policy names app_rw
× DEP-05 dump, drop, restore: every row count comes back, and app_rw can still read it
AssertionError: the rows came back but the application cannot read them:
  permission denied for table accounts (Failed query: SELECT count(*)::int AS n FROM "accounts")
Tests  2 failed | 4 passed (6)
```

**2 failed | 4 passed, exactly as claimed**, and the failure lands where it matters: after the row
counts have already matched. `backup.red.log`. The damaged database then really had no `relacl`
entries on `accounts` at all — checked with psql before rebuilding.

backup.sh restored from a pre-mutation copy (`git status` clean), database rebuilt with the DEP-04
proof (**4 passed**), backup proof green again (**6 passed**). `backup.green2.log`.

### `(unset)` banner (DEP-07)

Reverted pages-deploy.sh's empty-prefix banner to the old `(unset)` wording:

```
FAIL  DEP-07 prints the prefix it exports, empty string included
AssertionError: dos: the banner and the build command disagree: expected '(unset)' to be ''
Tests  1 failed | 6 passed (7)
```

**1 failed | 6 passed, as claimed.** `pages.red.log`. Script restored; `git status` clean.

## 4. Every `[run here]` block in docs/30, walked

22 fenced `bash` blocks, all `bash`-fenced (no unfenced command escapes runbook.spec.ts's marker
check): **4 `[run here]`, 18 `[not run here: …]`** — the claimed split, counted directly.

All four were run verbatim in this session:

1. **§4** `ENV_OUT=/tmp/envprod.test bash backend/infra/gen-secrets.sh` → exit 0. Mode **`600`** ✓;
   public JWK carries `crv,x,kty,kid,alg,use` — **`x` and no `d`** ✓; private JWK carries `d` **and**
   `x` ✓; `POSTGRES_PASSWORD` appears inside `DATABASE_URL` ✓; `OWNER_PASSWORD` is **20 characters**
   ✓; the password does **not** appear in stdout ✓. Variable count is **52**, not 55 — see finding 1.
   Temp file deleted.
2. **§6** `DOS_DEPLOY_PROOF=1 … migrate-bootstrap.spec.ts` → 4 passed, numbers in §2 above. The
   block's own caveat ("What it does NOT exercise is Docker, compose or the image itself") is
   accurate.
3. **§8** `DOS_DEPLOY_PROOF=1 … backup.spec.ts` → 6 passed.
4. **§9** `cd frontend && PAGES_DRY_RUN=1 DOMAIN=distributionos.in PAGES_PROJECT=dos-web
   ./scripts/pages-deploy.sh dos` → prints exactly what §9 quotes:
   `EXPO_PUBLIC_API_URL=https://api.distributionos.in`, `EXPO_PUBLIC_API_PREFIX=` (the empty string,
   exported as `''` in the build line), `EXPO_PUBLIC_AUTH_URL=…/auth`,
   `wrangler pages deploy … --project-name dos-web --branch main`, and
   `(dry run: nothing was built and nothing was published)`. The `owner` variant also checked:
   `EXPO_PUBLIC_API_PREFIX=/owner`, `--project-name dos-owner` — as §9 says. `pages-dos.log`.

`frontend/dos-app` does not exist yet; §0's go-live gate says so in as many words ("nothing in this
runbook changes on the day that project exists"), so the `dos` example is honest rather than
aspirational.

## 5. §12 "what has NOT been run" — checked, not assumed

- `docker` and `colima` are at `/opt/homebrew/bin` ✓; **`colima is not running`** (its own fatal
  message) ✓; `docker info` and `docker images` both fail with *no such file or directory* on
  `/var/run/docker.sock` — **there is no daemon and no image, here or anywhere** ✓.
- Free memory now measures 3 342 pages × 16 KiB ≈ **55 MB**, tighter than the 326 MB recorded; the
  measurement is not contradicted and the conclusion holds.
- `image.yml` is on **neither `main` nor `origin/main`** (`git ls-tree`), only on this branch ✓.
- `docker-image.proof.spec.ts` was read end to end: it is a **real** proof — `docker build
  --platform linux/arm64`, `docker run`, poll `/health`, assert all eight prefixes plus
  `worker started in-process`, then `docker stats` under 500 MB. Not a stub that would pass
  vacuously.

**Not run here, and correctly declared not-run:** `docker build` and
`DOS_DOCKER_PROOF=1 docker-image.proof.spec.ts` (the Prove stage reports no build, so the
conditional in this lane's brief was not triggered; colima was not started); every `docker compose`
command in docs/30 §§6/10/11; a real `expo export`; anything touching Oracle, Cloudflare or the
domain.

## 6. Housekeeping verified

- Worktree `git status` clean at start and at end; backup.sh and pages-deploy.sh byte-identical to
  their committed versions after my mutations.
- No `backend/infra/.env.prod` left behind; `/tmp/envprod.test` deleted.
- `dos_test_b2_deploy` left healthy: 140 tables, 57 migrations, 1 tenant, 30 accounts, and
  `accounts` ACLs back to `app_rw, app_worker, dos`.
- `pnpm --filter @dos/all-in-one typecheck` → clean; `lint` → clean; `pnpm format:check` in
  `backend/` → clean.
- Each of the five commits touches exactly the files its message claims.

---

## Findings

**1 — MINOR. docs/30 §4 says "55 variables"; the file it generates has 52.**
The `[run here]` proof sentence at docs/30:112 reports `55 variables`. Counting assignments in the
generated `.env.prod` gives **52**; 55 is the number of *lines containing an `=`*, three of which are
prose comments (`… 9 x 4 = 36`, `max_connections=100`, `NODE_ENV=production`). The run happened and
every other number in that sentence is exact, so this is a loose count rather than an invented one —
but it is a number in a run-here block that a variable count does not produce, and this lane's whole
point is that such numbers be reproducible. Fix: say 52, or say "55 lines".

**2 — MINOR. `app.distributionos.in` still survives in `QA/10-DAY-PLAN.md:34`** as the day-7 go-live
hostname. The repair flagged it rather than touching it (it is not in this branch's diff and belongs
to the QA lane), which is the right call for authorship, but the lane's check "no `app.<domain>`
survives" does not pass repo-wide: someone following the 10-day plan on go-live day would stand up
the wrong Pages custom domain. One line, one owner, worth closing before day 7.
`docs/26:78` also still reads `app.<domain>` / `app-test.<domain>`, but that is the dated §5 plan of
2026-09-05, the file opens with **"Read §9 first if you are deploying"**, and §9's domain row names
that exact table as superseded — that one I consider correctly handled, not a survivor.
(`backend/.env.example:22`'s `https://app.example.com` is a generic placeholder, unrelated.)

**3 — MINOR. Nothing guards the Dockerfile's own honesty.** `runbook.spec.ts` asserts that docs/30
§12 still contains "`docker build` has never been run", so the *runbook* cannot quietly lose that
sentence. But the lie that caused this lane was written in `backend/infra/docker/Dockerfile`'s
header, and `dockerfile.spec.ts`'s seven tests check COPY layout, `--legacy`, argon2, non-root,
HEALTHCHECK, the node:24-alpine pin and the dockerignore — none of them the header. Re-adding
"built and run for the first time … on colima" to that file today would pass every test in the
repo. A one-line assertion (the header says never-built until `docs/30` records a date, or: the
Dockerfile contains no "built and run" claim) would close never-list #12 mechanically instead of by
vigilance.

None of the three is a blocker: no claim in this branch was made without a run, and every walk the
repair said it took, it took.
