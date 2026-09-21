# Deploy runbook — a fresh Oracle VM to a live API and a live Pages site

Written 2026-09-21 by the deploy-plumbing lane. This is the deploy: nothing ships to production
automatically, and no workflow can reach the box. `.github/workflows/image.yml` builds the image and
pushes it to GHCR; a human or an agent runs the steps below.

**How to read a step.** Every command block carries a marker and what it proves:

- `[run here]` — this exact command was run on the founder's Mac while writing this file, and what
  it proves is what was observed.
- `[not run here: needs the VM]` — it needs an Oracle VM, a Cloudflare account or a domain, none of
  which exist yet. It has not been run and is not claimed to work.
- `[not run here: needs a Docker daemon]` — this Mac has colima and the Docker CLI installed, but at
  the time of writing free memory sat under 100 MB with three other runs live (QA/STATE.md sizes
  work to this machine), so no Linux VM was started. Everything about the image that can be checked
  without a daemon was checked; the build itself has not been run anywhere yet.

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

[run here] Proves: a real `.env.prod` appears, mode 600, with a fresh EdDSA pair whose public half
carries no private `d`, the database password in both the places that must agree, and an owner
password of at least 12 characters. Observed on this Mac into a temporary directory.

```bash
cd /opt/dos/backend/infra && ./gen-secrets.sh
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

[run here] Proves: 57 migrations apply to an empty database and `bootstrapTenant()` leaves exactly
one tenant, one user and one membership — and none of the dev seed. Observed on
`dos_test_b2_deploy` after `DROP DATABASE`: 57 rows in `drizzle.__drizzle_migrations`, 140 tables,
30 accounts, 3 locations, 10 numbering series, 5 feature flags, 10 tenant settings, and zero rows in
`sales_orders`, `invoices`, `retailers`, `retailer_identities`, `tenant_products` and
`auth_sessions`. Run it once, from the image, on the box.

```bash
docker compose -f compose.prod.yml --env-file .env.prod run --rm app bootstrap
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

[run here] Proves: a restore really restores. Observed on `dos_test_b2_deploy`: backup, then
`DROP DATABASE` + `CREATE DATABASE` (0 tables), then restore — 140 tables back and every counted row
identical (tenants 1, users 1, memberships 1, accounts 30, locations 3, numbering_series 10,
feature_flags 5, tenant_settings 10). Do the drill on the box too, against a scratch database, the
same week the box goes live; a restore nobody has run is not a restore.

```bash
RESTORE_CONFIRM=dos ./restore.sh /var/backups/dos/daily/db-<stamp>.dump \
                                 /var/backups/dos/daily/storage-<stamp>.tar.gz
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
Metro runs, the SPA redirect is written, and wrangler is called with the named project. Observed:
`EXPO_PUBLIC_API_URL=https://api.distributionos.in`, `EXPO_PUBLIC_API_PREFIX=/owner`,
`EXPO_PUBLIC_AUTH_URL=https://api.distributionos.in/auth`. The real `expo export` has NOT been run
here — see §12.

```bash
cd frontend && DOMAIN=distributionos.in PAGES_PROJECT=dos-web ./scripts/pages-deploy.sh dos
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

1. **`docker build` has never been run.** The Dockerfile's faults were found by reading it against
   what Docker does and by reproducing the pieces outside a daemon — the `pnpm deploy --prod
   --legacy` tree, its `node_modules/@dos/db/migrations`, the missing musl prebuild for argon2 — and
   the fixes are checked by `dockerfile.spec.ts`. The build-and-run proof exists as
   `docker-image.proof.spec.ts` and is one command away the moment this Mac has 1.5 GB free:
   `colima start --cpu 2 --memory 4 --arch aarch64` then `DOS_DOCKER_PROOF=1 … vitest run`.
   Until then the 377 MB idle figure in docs/26 §7 is a measurement of the process, not of a
   container.
2. **No `expo export` was run for a Pages build.** `pages-deploy.sh` was exercised as a dry run only;
   Metro on a machine with 60 MB free would have taken the other runs down with it.
3. **Nothing has touched Oracle, Cloudflare or a domain.** None of the three accounts exist yet.
4. **`image.yml` has never run**, because it only triggers on a push to `main`.

## 13. The tests behind this file

| Id | What it proves | Where |
| --- | --- | --- |
| DEP-01 | The image's shape: no `COPY *-service ./` collapse, `pnpm deploy --legacy`, argon2's toolchain, non-root, HEALTHCHECK | `backend/all-in-one/src/deploy/dockerfile.spec.ts` |
| DEP-01 | Build, run, `/health` with all eight services and the worker, RSS under 500 MB (opt-in, needs a daemon) | `backend/all-in-one/src/deploy/docker-image.proof.spec.ts` |
| DEP-02 | `compose.prod.yml` resolves, orders migrate before app, publishes only 80/443 | `backend/all-in-one/src/deploy/compose.spec.ts` |
| DEP-03 | The Caddyfile is one `caddy validate` accepts, with automatic TLS and no CORS of its own | `backend/all-in-one/src/deploy/caddy.spec.ts` |
| DEP-04 | 57 migrations on a fresh database, then one tenant and one owner and no demo rows | `backend/all-in-one/src/deploy/migrate-bootstrap.spec.ts` |
| DEP-05 | Dump, drop, restore, and every row count comes back the same | `backend/all-in-one/src/deploy/backup.spec.ts` |
| DEP-06 | Every variable is declared, every secret is generated, `.env.prod` is refused by git | `backend/all-in-one/src/deploy/secrets.spec.ts` |
| DEP-07 | The Pages build is pointed at `api.<domain>`; `image.yml` builds arm64 and deploys nothing | `backend/all-in-one/src/deploy/pages.spec.ts` |
| DEP-08/09 | This runbook marks every command, and docs/26 records what changed | `backend/all-in-one/src/deploy/runbook.spec.ts` |
