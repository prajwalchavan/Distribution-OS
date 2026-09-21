# Deploy runbook — a fresh Oracle VM to a live API and a live Pages site

Written 2026-09-21 by the deploy-plumbing lane. This is the deploy: nothing ships to production
automatically, and no workflow can reach the box. `.github/workflows/image.yml` builds the image and
pushes it to GHCR; a human or an agent runs the steps below.

**How to read a step.** Every command block carries a marker and what it proves:

- `[run here]` — this exact command, as written in the block, was run on the founder's Mac, and
  what it proves is what was observed. Not a paraphrase of it, not a test that covers it: the
  command in the block.
- `[not run here: needs the VM]` — it needs an Oracle VM, a Cloudflare account or a domain, none of
  which exist yet. It has not been run and is not claimed to work.
- `[not run here: needs a Docker daemon]` — docker and colima are installed here
  (`/opt/homebrew/bin`), but colima is not running and free memory measured 326 MB on the last
  check, against the ~1.5 GB an arm64 build of this image wants. Everything about the image that can
  be checked without a daemon is checked; the build itself has not been run anywhere yet.

Several steps have BOTH forms: the command as it will be run on the box, marked not-run, and beside
it the command that was actually run here and what it proved. They are separate blocks on purpose —
a proof on this Mac is not a proof on the VM, and collapsing the two is how a runbook starts lying.

Nothing below is a summary of something else: `backend/infra/` holds the files, and
`backend/all-in-one/src/deploy/*.spec.ts` holds the tests named DEP-01 … DEP-09.

---

## 0. What must be true before you start

| Owed by | What | Why |
| --- | --- | --- |
| Founder | An Oracle Cloud account, home region **Mumbai** (irreversible), with a real credit card — PIN-debit, prepaid and virtual cards are refused | The Always Free shape lives in the home region |
| Founder | A Cloudflare account and an API token with **Pages: Edit** and, for R2, **Object Read & Write** | Pages publishes the apps; R2 holds the backups |
| Founder | The domain **`distributionos.in`** bought, nameservers pointed at Cloudflare | `api.<domain>` and `www.<domain>` both come from it; the bare `distributionos.in` redirects to `www` (founder, 2026-09-21, docs/22 §8) |
| This repo | A green `ci.yml` on `main`, and one `image.yml` run that pushed a `sha-…` tag | The box only ever pulls |

**Go-live gate (founder, 2026-09-21 — docs/22 §8).** Role election at sign-in and the ONE merged app
land **before** go-live, *"for both APPS and website"*. So before §9 is run for real: the six
business apps are one Expo project (`frontend/dos-app`) that is one website, one Android app and one
iOS app; the seven per-role web apps are retired at that merge, not kept beside it; and the business
simulation has run on that merged app, so what was proven is what ships. The console stays separate.
`frontend/scripts/pages-deploy.sh` already accepts `dos` as an app name, so nothing in this runbook
changes on the day that project exists.

---

## 1. The VM

[not run here: needs the VM] Proves: an Ampere (arm64) instance exists in Mumbai with a public IP.

```bash
# In the Oracle console: Compute → Instances → Create
#   Shape:  VM.Standard.A1.Flex  —  2 OCPU, 12 GB  (the Always Free ARM allowance since 2026-06-15)
#   Image:  Oracle Linux 9 (aarch64)
#   Network: assign a public IPv4; add your SSH public key
# Then, from your Mac:
ssh opc@<public-ip> 'uname -m && free -g'     # expect: aarch64, ~12 GB
```

[not run here: needs the VM] Proves: 80 and 443 reach the box. Oracle blocks them TWICE — in the
VCN security list AND in the instance's own iptables — and forgetting the second is the classic
"Let's Encrypt cannot validate" failure.

```bash
# Oracle console: Networking → VCN → Security Lists → add ingress 0.0.0.0/0 tcp 80 and tcp 443
# On the VM:
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo service iptables save
```

## 2. Docker on the VM

[not run here: needs the VM] Proves: `docker compose version` prints v2, and `opc` can use Docker
without sudo.

```bash
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker opc && newgrp docker
docker compose version
```

## 3. The repo on the box

The box needs `compose.prod.yml`, the `Caddyfile` and the three scripts. It does NOT build anything:
building on a 12 GB free VM while it serves is how the box falls over (and `pnpm install` alone is
heavier than the whole running product).

[not run here: needs the VM] Proves: the four files are there.

```bash
sudo mkdir -p /opt/dos && sudo chown opc:opc /opt/dos
git clone --depth 1 https://github.com/prajwalchavan/Distribution-OS.git /opt/dos
cd /opt/dos/backend/infra && ls compose.prod.yml Caddyfile gen-secrets.sh backup.sh restore.sh
```

## 4. Secrets

[not run here: needs the VM] Proves: the box gets its own secrets, once. `/opt/dos` is the VM's
path — the clone of §3 — so this exact line cannot have run here. The script itself did; the block
below is what was run.

```bash
cd /opt/dos/backend/infra && ./gen-secrets.sh
```

[run here] Proves: `gen-secrets.sh` writes a real `.env.prod` and fills every secret in it.
Observed 2026-09-21, into a temporary file that was deleted afterwards: mode `600`, 55 variables, a
fresh Ed25519 pair whose public half carries `x` and no private `d` (the private half carries both),
`POSTGRES_PASSWORD` appearing inside `DATABASE_URL` so the two places that must agree do, and a
20-character `OWNER_PASSWORD` — and the password itself is not printed to the terminal, only its
location. `secrets.spec.ts` makes the same checks unattended (5 passed).

```bash
ENV_OUT=/tmp/envprod.test bash backend/infra/gen-secrets.sh
```

[not run here: needs the VM] Proves: the values only a human knows are in. The script prints this
list itself; every one of them is required.

```bash
# Edit .env.prod and set:
#   DOS_IMAGE                  ghcr.io/prajwalchavan/distribution-os:sha-xxxxxxx   (never :latest)
#   DOMAIN, ACME_EMAIL         distributionos.in, a mailbox you read
#   CORS_ORIGINS               https://www.distributionos.in  (the Pages hostname; NOT api.*)
#   OBJECT_STORAGE_PUBLIC_URL  https://api.distributionos.in
#   TENANT_LEGAL_NAME, TENANT_GSTIN, TENANT_STATE_CODE, OWNER_NAME, OWNER_USERNAME, OWNER_PHONE
#   BACKUP_S3_*                the R2 bucket, endpoint and API token
chmod 600 .env.prod && grep -c '=' .env.prod
```

`gen-secrets.sh` refuses to overwrite an existing `.env.prod`, and that refusal is the point:
re-running it replaces the EdDSA signing key, which signs every access and refresh token on every
phone in the distributorship. Rotating it is a deliberate act that signs the whole staff out.

## 5. DNS

[not run here: needs the VM] Proves: `api.<domain>` resolves to the VM before Caddy ever asks
Let's Encrypt. Do this BEFORE §6 — an HTTP-01 challenge against a name that does not resolve burns
a rate-limit slot.

```bash
# Cloudflare dashboard → DNS → add:
#   A     api    <public-ip>     Proxy status: DNS only (grey cloud)
# Grey cloud matters: Caddy terminates TLS itself, and Cloudflare's proxy in front of an
# unvalidated origin would answer the ACME challenge before Caddy sees it.
dig +short api.distributionos.in
```

## 6. First start

[not run here: needs the VM] Proves: the image pulls for the right architecture.

```bash
cd /opt/dos/backend/infra
docker compose -f compose.prod.yml --env-file .env.prod pull
docker image inspect "$(grep -m1 '^DOS_IMAGE=' .env.prod | cut -d= -f2-)" --format '{{.Os}}/{{.Architecture}}'
# expect: linux/arm64
```

[not run here: needs the VM] Proves: the database comes up healthy, the migrations run to completion
and only then does the app start. Compose enforces the order with
`condition: service_completed_successfully`, so a failed migration means no app, not a half-migrated
one serving traffic.

```bash
docker compose -f compose.prod.yml --env-file .env.prod up -d
docker compose -f compose.prod.yml --env-file .env.prod logs migrate | tail -5   # "migrations applied"
docker compose -f compose.prod.yml --env-file .env.prod ps
```

[not run here: needs the VM] Proves: the box gets one tenant and one owner, from the image. Run it
once. No `docker compose` command in this file has ever run anywhere (§12), so this is the image's
half of the step; what runs INSIDE it was run here, in the block below.

```bash
docker compose -f compose.prod.yml --env-file .env.prod run --rm app bootstrap
```

[run here] Proves: 57 migrations apply to an empty database and `bootstrapTenant()` leaves exactly
one tenant, one user and one membership — and none of the dev seed. Same migrate entry point and
same `bootstrap.mjs` the image's entrypoint runs, out of a real `pnpm deploy --prod --legacy` tree,
against a database dropped and recreated first. What it does NOT exercise is Docker, compose or the
image itself. Observed 2026-09-21 on `dos_test_b2_deploy`: 57 rows in
`drizzle.__drizzle_migrations`, 140 tables, 1 tenant, 1 user, 1 membership, 30 accounts, 3
locations, 10 numbering series, 5 feature flags, 10 tenant settings, and zero rows in
`sales_orders`, `invoices`, `retailers`, `retailer_identities`, `tenant_products` and
`auth_sessions`. Re-running the bootstrap changed nothing.

```bash
cd backend && DOS_DEPLOY_PROOF=1 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_b2_deploy \
  pnpm --filter @dos/all-in-one exec vitest run src/deploy/migrate-bootstrap.spec.ts
```

**Never `pnpm db:seed` on this database.** The seed writes three demo distributors, roughly thirty
demo accounts all on the password `Dos@1234`, a demo catalogue, a month of demo orders and a demo
platform-console admin, and `pnpm smoke` leaves its own calls behind (docs/23 §10). `bootstrap` is
the production path and writes only the tenant, its owner, the membership and `bootstrapTenant()`.

[not run here: needs the VM] Proves: TLS is live and the API answers as itself. The first request
can take thirty seconds while Caddy gets its certificate.

```bash
curl -fsS https://api.distributionos.in/health | head -c 200
curl -fsS https://api.distributionos.in/owner/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://api.distributionos.in/nope     # expect 404, not an index.html
```

## 7. Sign in once, as the owner

[not run here: needs the VM] Proves: the auth service issues a token for the bootstrapped owner, and
the owner service accepts it. `OWNER_USERNAME` and `OWNER_PASSWORD` are the two lines in `.env.prod`.

```bash
curl -fsS -X POST https://api.distributionos.in/auth/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"<OWNER_USERNAME>","password":"<OWNER_PASSWORD>"}' | head -c 200
```

Hand that password over out of band and have the owner change it at first sign-in. It is in
`.env.prod` and nowhere else; it is never printed by `bootstrap` and never written to `docker logs`.

## 8. Backups, and a restore drill on the same day

[not run here: needs the VM] Proves: a dump, the cluster globals and a tar of the object store land
in R2 every night at 02:00 IST.

```bash
cd /opt/dos/backend/infra && ./backup.sh          # once by hand first; it must print "backup complete"
( crontab -l 2>/dev/null; echo '0 2 * * * cd /opt/dos/backend/infra && ./backup.sh >> /var/log/dos-backup.log 2>&1' ) | crontab -
```

[not run here: needs the VM] Proves: the drill on the box itself. `/var/backups/dos` is the VM's
path and `<stamp>` is one of the VM's own files, so this line could not have run here. Do it the
same week the box goes live, against a scratch database; a restore nobody has run is not a restore.
The round trip the two scripts perform WAS run here — the block below.

```bash
RESTORE_CONFIRM=dos ./restore.sh /var/backups/dos/daily/db-<stamp>.dump \
                                 /var/backups/dos/daily/storage-<stamp>.tar.gz
```

[run here] Proves: `backup.sh` and `restore.sh` make a round trip that loses nothing — not the rows,
and not the privileges that make the rows readable. Observed 2026-09-21 on `dos_test_b2_deploy`:
backup.sh wrote the custom-format dump, the cluster globals and the storage tar; then
`DROP DATABASE` + `CREATE DATABASE` left 0 tables; then restore.sh brought back 140 tables with
every counted row identical (tenants 1, users 1, memberships 1, accounts 30, locations 3,
numbering_series 10, feature_flags 5, tenant_settings 10) — and `app_rw` could still read `accounts`
through `withTenant`, with the table's GRANTs to `app_rw` and `app_worker` intact. The second half
is load-bearing: adding `--no-acl` to backup.sh's `pg_dump` makes this same run fail on the
privileges — "permission denied for table accounts" — with every row count still matching to the
row. That mutation was made, the failure observed, and backup.sh put back.

```bash
cd backend && DOS_DEPLOY_PROOF=1 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_b2_deploy \
  pnpm --filter @dos/all-in-one exec vitest run src/deploy/backup.spec.ts
```

`restore.sh` applies `globals-<stamp>.sql` first without being asked: `app_rw` and `app_worker` are
cluster-wide roles, they are not in a database dump, and every GRANT and every RLS policy names
them. It refuses to run until `RESTORE_CONFIRM` spells the database it is about to overwrite.

## 9. The web apps on Cloudflare Pages

Read the go-live gate in §0 first: at go-live this is ONE app, not seven.

[not run here: needs a Cloudflare account] Proves: the Pages project exists and holds the token.

```bash
export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...
pnpm dlx wrangler pages project create dos-web --production-branch main
```

[run here, as a dry run] Proves: the build is pointed at `api.<domain>` with the right prefix before
Metro runs, the SPA redirect is written, and wrangler is called with the named project. Observed
2026-09-21 for `dos`: `EXPO_PUBLIC_API_URL=https://api.distributionos.in`,
`EXPO_PUBLIC_API_PREFIX=` — the empty string, exported as one, because the merged app elects its
role and its service at sign-in — `EXPO_PUBLIC_AUTH_URL=https://api.distributionos.in/auth`, and
`wrangler pages deploy … --project-name dos-web --branch main`. The same script run with `owner`
prints `EXPO_PUBLIC_API_PREFIX=/owner` and `--project-name dos-owner`. `PAGES_DRY_RUN=1` is what
makes it print instead of build: the real `expo export` has NOT been run here — see §12.

```bash
cd frontend && PAGES_DRY_RUN=1 DOMAIN=distributionos.in PAGES_PROJECT=dos-web ./scripts/pages-deploy.sh dos
```

[not run here: needs a Cloudflare account] Proves: the site answers on the website hostname and a
deep link survives a hard refresh.

```bash
# Cloudflare dashboard → Pages → dos-web → Custom domains → www.distributionos.in
#   and a redirect rule sending the bare distributionos.in to https://www.distributionos.in
curl -fsS -o /dev/null -w '%{http_code}\n' https://www.distributionos.in/orders/does-not-exist
# expect 200 (the SPA's own not-found screen), not Cloudflare's 404
```

`CORS_ORIGINS` in `.env.prod` must list exactly this hostname. The apps and the API are different
origins on purpose, and the API answers CORS itself — Caddy adds no such header, so widening it
there is not an option anyone can reach for in a hurry.

## 10. Rollback

The rollback is one line, because `DOS_IMAGE` is pinned to a `sha-` tag and nothing on the box
follows a moving tag.

[not run here: needs the VM] Proves: the previous image is serving again, with the database
untouched.

```bash
cd /opt/dos/backend/infra
sed -i "s|^DOS_IMAGE=.*|DOS_IMAGE=ghcr.io/prajwalchavan/distribution-os:sha-<previous>|" .env.prod
docker compose -f compose.prod.yml --env-file .env.prod pull
docker compose -f compose.prod.yml --env-file .env.prod up -d
curl -fsS https://api.distributionos.in/health | head -c 120
```

**What rollback does NOT undo: the migrations.** They are expand-only from 0004 onward and the old
image runs against the new schema by design — that is what expand-only buys. If a migration itself
is the fault, the recovery is a restore from §8, not a downgrade.

## 11. Day-to-day

[not run here: needs the VM] Proves: what the box is doing.

```bash
cd /opt/dos/backend/infra
docker compose -f compose.prod.yml --env-file .env.prod ps
docker compose -f compose.prod.yml --env-file .env.prod logs -f --tail 100 app
docker compose -f compose.prod.yml --env-file .env.prod exec db psql -U dos -d dos -c '\dt' | tail -5
docker stats --no-stream
```

To move to a new build: `git -C /opt/dos pull` (for compose and the scripts), edit `DOS_IMAGE` to the
new `sha-` tag, `pull`, `up -d`. The `migrate` one-shot runs again on the way up and is a no-op when
there is nothing new.

## 12. What has NOT been run, anywhere

Said plainly so nobody reads this file as a record of a working deployment:

1. **`docker build` has never been run** — not here, not anywhere, and the Dockerfile's own header
   says so. Its faults were found by reading it against what Docker does and by reproducing the
   pieces outside a daemon — the `pnpm deploy --prod --legacy` tree, its
   `node_modules/@dos/db/migrations`, the missing musl prebuild for argon2 — and the fixes are
   checked by `dockerfile.spec.ts`. The build-and-run proof is written and opt-in:
   `docker-image.proof.spec.ts`. Checked 2026-09-21: `docker` and `colima` are both on PATH at
   `/opt/homebrew/bin`, colima is NOT running, and free memory measured 326 MB against the ~1.5 GB
   an arm64 build of this image wants. So it is one command away only once the machine is quiet:
   `colima start --cpu 2 --memory 4 --arch aarch64` then `DOS_DOCKER_PROOF=1 … vitest run`. Until
   that has been done, the 377 MB idle figure in docs/26 §7 is a measurement of the process, not of
   a container, and no line in this file may say the image was built.
2. **No `expo export` was run for a Pages build.** `pages-deploy.sh` was exercised with
   `PAGES_DRY_RUN=1` only, which prints the commands and builds nothing; Metro on this machine
   would have taken the other runs down with it.
3. **Nothing has touched Oracle, Cloudflare or a domain.** None of the three accounts exist yet.
4. **`image.yml` has never run.** It triggers on a push to `main` (and `workflow_dispatch`), and
   the file does not exist on `main` or on `origin/main` — it arrives with this branch.
5. **No `docker compose` command in this file has ever run**, here or anywhere: §6, §10 and §11 are
   all the box's, and there is no box.

## 13. The tests behind this file

| Id | What it proves | Where |
| --- | --- | --- |
| DEP-01 | The image's shape: no `COPY *-service ./` collapse, `pnpm deploy --legacy`, argon2's toolchain, non-root, HEALTHCHECK | `backend/all-in-one/src/deploy/dockerfile.spec.ts` |
| DEP-01 | Build, run, `/health` with all eight services and the worker, RSS under 500 MB (opt-in, needs a daemon) | `backend/all-in-one/src/deploy/docker-image.proof.spec.ts` |
| DEP-02 | `compose.prod.yml` resolves, orders migrate before app, publishes only 80/443 | `backend/all-in-one/src/deploy/compose.spec.ts` |
| DEP-03 | The Caddyfile is one `caddy validate` accepts, with automatic TLS and no CORS of its own | `backend/all-in-one/src/deploy/caddy.spec.ts` |
| DEP-04 | 57 migrations on a fresh database, then one tenant and one owner and no demo rows | `backend/all-in-one/src/deploy/migrate-bootstrap.spec.ts` |
| DEP-05 | Dump, drop, restore: every row count comes back AND `app_rw` can still read them (the `--no-acl` failure mode) | `backend/all-in-one/src/deploy/backup.spec.ts` |
| DEP-06 | Every variable is declared, every secret is generated, `.env.prod` is refused by git | `backend/all-in-one/src/deploy/secrets.spec.ts` |
| DEP-07 | The Pages build is pointed at `api.<domain>`, the banner prints the prefix it exports; `image.yml` builds arm64 and deploys nothing | `backend/all-in-one/src/deploy/pages.spec.ts` |
| DEP-08/09 | This runbook marks every command, and docs/26 records what changed | `backend/all-in-one/src/deploy/runbook.spec.ts` |
