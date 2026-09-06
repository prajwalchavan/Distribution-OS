# One image, two ways to run it (founder decision 2026-09-05, docs/26 §7).
#
#   ALL-IN-ONE (the default, and what stage 0 and stage 1 deploy):
#     cd backend && docker build -f infra/docker/Dockerfile .
#     docker run -e DATABASE_URL=... -e DOS_MODE=all -e WORKER_INLINE=1 -p 3100:3100 <image>
#   every service behind a path prefix on :3100 — /auth /owner /manager /sales /warehouse /delivery
#   /retailer /admin — and the pg-boss worker in the same process. One 2 GB VM carries the product.
#
#   ONE SERVICE PER IMAGE (the scale path, docs/20; nothing in the code changes):
#     docker build --build-arg SERVICE=owner -f infra/docker/Dockerfile .
#   SERVICE is all-in-one | auth | owner | manager | sales | warehouse | delivery | retailer | admin | worker.
#   Each runs as N stateless replicas.
#
# Not yet built on the founder's machine (no Docker installed there); CI builds it.
ARG SERVICE=all-in-one
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

FROM base AS deps
ARG SERVICE
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY libs ./libs
COPY *-service ./
COPY all-in-one ./all-in-one
COPY worker ./worker
RUN if [ "$SERVICE" = "worker" ]; then PKG=@dos/worker; \
    elif [ "$SERVICE" = "all-in-one" ]; then PKG=@dos/all-in-one; \
    else PKG=@dos/${SERVICE}-service; fi \
 && pnpm install --frozen-lockfile --filter "${PKG}..."

FROM deps AS build
ARG SERVICE
RUN if [ "$SERVICE" = "worker" ]; then PKG=@dos/worker; \
    elif [ "$SERVICE" = "all-in-one" ]; then PKG=@dos/all-in-one; \
    else PKG=@dos/${SERVICE}-service; fi \
 && pnpm --filter "${PKG}..." run build \
 && pnpm --filter "${PKG}" deploy --prod /out/app

FROM node:24-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production SERVICE=${SERVICE}
# All-in-one mode by default; a per-service image ignores both (its own main.ts listens on its port).
ENV DOS_MODE=all WORKER_INLINE=1
WORKDIR /app
COPY --from=build /out/app /app
COPY --from=build /repo/libs/database/migrations /app/migrations
USER node
# all-in-one 3100; split out: auth 3000, owner 3001, manager 3002, sales 3003, warehouse 3004,
# delivery 3005, retailer 3006, admin 3007 (override with ALL_IN_ONE_PORT / <NAME>_SERVICE_PORT)
EXPOSE 3100 3000 3001 3002 3003 3004 3005 3006 3007
CMD ["node", "/app/dist/main.js"]
