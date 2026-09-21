# syntax=docker/dockerfile:1.7
#
# One image, four ways to run it (founder decision 2026-09-05, docs/26 §7).
#
# NOT YET BUILT HERE as of this commit. This file has never been through `docker build` on any
# machine: the faults it fixes were found by reading it against what Docker does, and the checks
# that hold its shape are `backend/all-in-one/src/deploy/dockerfile.spec.ts`. The build-and-run
# proof is `backend/all-in-one/src/deploy/docker-image.proof.spec.ts`, opt-in behind
# DOS_DOCKER_PROOF=1, and `docs/30-deploy-runbook.md` records the date it first ran — until that
# line says otherwise, nothing here has been observed working in a container.
#
# It is built `--platform linux/arm64` because that is the Oracle VM's architecture; an amd64 image
# will not start there.
#
# Build context is `backend/`:
#     cd backend && docker build --platform linux/arm64 -f infra/docker/Dockerfile -t dos:local .
#
# The entrypoint takes a verb, so one image carries the whole deployment (see infra/docker/entrypoint.sh):
#     docker run ... dos:local serve       # the default: the HTTP process
#     docker run ... dos:local migrate     # apply libs/database/migrations, then exit
#     docker run ... dos:local bootstrap   # create one tenant + its owner (bootstrapTenant), then exit
#     docker run ... dos:local sh          # anything else is exec'd as given
#
#   ALL-IN-ONE (the default, and what stage 0 and stage 1 deploy):
#     docker run -e DATABASE_URL=... -p 3100:3100 dos:local
#   every service behind a path prefix on :3100 — /auth /owner /manager /sales /warehouse /delivery
#   /retailer /admin — and the pg-boss worker in the same process. One small VM carries the product.
#
#   ONE SERVICE PER IMAGE (the scale path, docs/20; nothing in the code changes):
#     docker build --build-arg SERVICE=owner -f infra/docker/Dockerfile .
#   SERVICE is all-in-one | auth | owner | manager | sales | warehouse | delivery | retailer | admin | worker.
#   Each runs as N stateless replicas. Set HEALTH_PORT to that service's port so HEALTHCHECK follows.
ARG SERVICE=all-in-one

FROM node:24-alpine AS base
# CI=true so pnpm never asks a question no one is there to answer.
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

# Every workspace package, each in ITS OWN directory. The previous `COPY *-service ./` expanded to
# eight source directories and a single destination, so Docker copied the CONTENTS of each on top of
# the others: eight package.json files collapsed into /repo and `pnpm install --filter
# @dos/owner-service...` could not find a single service. One COPY per package, no globs.
FROM base AS src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY libs ./libs
COPY auth-service ./auth-service
COPY owner-service ./owner-service
COPY manager-service ./manager-service
COPY sales-service ./sales-service
COPY warehouse-service ./warehouse-service
COPY delivery-service ./delivery-service
COPY retailer-service ./retailer-service
COPY admin-service ./admin-service
COPY all-in-one ./all-in-one
COPY worker ./worker
COPY tools ./tools

FROM src AS build
ARG SERVICE
# argon2 (the password hasher) ships prebuilds for linux-arm64/x64 against glibc and NONE for musl,
# so on alpine node-gyp-build falls through to compiling it. The toolchain lives in this stage only;
# the runtime stage below inherits the compiled .node and no compiler.
RUN apk add --no-cache python3 make g++
# `pnpm deploy --legacy` is REQUIRED, not cosmetic: pnpm 10+ refuses to deploy from a workspace that
# does not set inject-workspace-packages, and this workspace is `nodeLinker: hoisted`
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE). The legacy path copies each workspace dependency in as a
# real directory, which is why @dos/db arrives with its `files` — dist/ AND migrations/ — so
# migrate.js finds the SQL where it already looks (`../migrations` beside its own dist/).
# The three `test`s fail the BUILD, not the first `docker run`, if that tree is not what the
# entrypoint expects.
RUN set -eu; \
    if [ "$SERVICE" = "worker" ]; then PKG=@dos/worker; \
    elif [ "$SERVICE" = "all-in-one" ]; then PKG=@dos/all-in-one; \
    else PKG=@dos/${SERVICE}-service; fi; \
    pnpm install --frozen-lockfile --filter "${PKG}..."; \
    pnpm --filter "${PKG}..." run build; \
    pnpm --filter "${PKG}" deploy --prod --legacy /out/app; \
    rm -rf /out/app/src /out/app/vitest.config.ts /out/app/eslint.config.js /out/app/tsconfig.json /out/app/tsconfig.build.json; \
    test -f /out/app/dist/main.js; \
    test -f /out/app/node_modules/@dos/db/dist/migrate.js; \
    test -d /out/app/node_modules/@dos/db/migrations

FROM node:24-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production \
    SERVICE=${SERVICE} \
    ALL_IN_ONE_PORT=3100 \
    HEALTH_PORT=3100 \
    OBJECT_STORAGE_DRIVER=local \
    OBJECT_STORAGE_DIR=/data/storage \
    DOCINT_ENGINE=stub
# All-in-one mode by default; a per-service image ignores both (its own main.ts listens on its port).
ENV DOS_MODE=all WORKER_INLINE=1
# The local object-storage driver writes here. Compose mounts a volume over it; Docker seeds a fresh
# named volume from the image, ownership included, so `node` can still write after the mount.
RUN mkdir -p /data/storage && chown -R node:node /data
WORKDIR /app
COPY --from=build --chown=node:node /out/app /app
COPY --chown=node:node infra/docker/bootstrap.mjs /app/bootstrap.mjs
COPY infra/docker/entrypoint.sh /usr/local/bin/dos
RUN chmod +x /usr/local/bin/dos
USER node
# all-in-one 3100; split out: auth 3000, owner 3001, manager 3002, sales 3003, warehouse 3004,
# delivery 3005, retailer 3006, admin 3007 (override with ALL_IN_ONE_PORT / <NAME>_SERVICE_PORT)
EXPOSE 3100 3000 3001 3002 3003 3004 3005 3006 3007
# Node 24 has global fetch, so the health probe needs no curl, no wget and no extra layer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/dos"]
CMD ["serve"]
