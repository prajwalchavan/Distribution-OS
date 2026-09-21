# backend/infra — everything the deployment is made of

The ordered procedure is **`docs/30-deploy-runbook.md`**; the reasoning behind the choices is
**docs/26 §9 (as-built, 2026-09-21)**. The tests that hold these files honest are
`backend/all-in-one/src/deploy/*.spec.ts`, named DEP-01 … DEP-09.

| File                                  | What it is                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker/Dockerfile`                   | One image, built `linux/arm64` (the Oracle VM is Ampere). `--build-arg SERVICE=` picks all-in-one (default), any one service, or the worker. Runs as `node` with a HEALTHCHECK on `/health`.                                                  |
| `docker/Dockerfile.dockerignore`      | The ignore rules for that build. BuildKit prefers this over a context-root `.dockerignore`, so they live beside the image that needs them.                                                                                                    |
| `docker/entrypoint.sh`                | The image's verbs: `serve` (default), `migrate`, `bootstrap`; anything else is exec'd as given.                                                                                                                                               |
| `docker/bootstrap.mjs`                | Creates ONE tenant, its owner and `bootstrapTenant()` on a migrated database. The production counterpart of `pnpm db:seed`, and deliberately not it — the seed writes demo distributors, demo staff and a month of demo orders (docs/23 §10). |
| `compose.prod.yml`                    | What the VM runs: `db`, a one-shot `migrate` the app waits on, `app`, `caddy`. Postgres is never published; only 80 and 443 leave the box.                                                                                                    |
| `Caddyfile`                           | `api.<domain>` with automatic Let's Encrypt. No static root and no SPA fallback: the web apps are on Cloudflare Pages.                                                                                                                        |
| `.env.prod.example`                   | Every variable the image reads. The real `.env.prod` is written by `gen-secrets.sh` and is git-ignored.                                                                                                                                       |
| `gen-secrets.sh`                      | Writes `.env.prod` with a fresh EdDSA pair, database password, storage signing secret and the first owner's password, mode 600. Refuses to overwrite an existing one — rotating the signing key signs every phone out.                        |
| `backup.sh` / `restore.sh`            | Nightly `pg_dump` + cluster globals + a tar of the object store, rotated 7 daily / 4 weekly, uploaded to any S3-compatible store (Cloudflare R2 is the decided one). The restore has been run: dump, drop, restore, row counts identical.     |
| `docker-compose.yml`                  | **Local only**: a bare Postgres for `pnpm db:up` on a developer's machine. It deploys nothing and is not `compose.prod.yml`'s smaller sibling.                                                                                                |
| `scripts/git-auto-push.sh` + `.plist` | The founder's launchd agent that pushes committed work every 30 minutes. Unrelated to deployment.                                                                                                                                             |

Migrations run as a one-shot before the new version takes traffic, and they are expand-only from
0004 onward, so the previous image keeps working against the new schema — which is what makes the
rollback in docs/30 §10 a one-line change to `DOS_IMAGE`.
