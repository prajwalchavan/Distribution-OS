# One image per backend service: `cd backend && docker build --build-arg SERVICE=owner -f infra/docker/Dockerfile .`
# SERVICE is one of auth | owner | manager | sales | warehouse | delivery | retailer | worker. Each runs as N stateless replicas (docs/20).
# Not yet built on the founder's machine (no Docker installed there); CI builds it.
ARG SERVICE=owner
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

FROM base AS deps
ARG SERVICE
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY libs ./libs
COPY *-service ./
COPY worker ./worker
RUN if [ "$SERVICE" = "worker" ]; then PKG=@dos/worker; else PKG=@dos/${SERVICE}-service; fi \
 && pnpm install --frozen-lockfile --filter "${PKG}..."

FROM deps AS build
ARG SERVICE
RUN if [ "$SERVICE" = "worker" ]; then PKG=@dos/worker; else PKG=@dos/${SERVICE}-service; fi \
 && pnpm --filter "${PKG}..." run build \
 && pnpm --filter "${PKG}" deploy --prod /out/app

FROM node:24-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production SERVICE=${SERVICE}
WORKDIR /app
COPY --from=build /out/app /app
COPY --from=build /repo/libs/database/migrations /app/migrations
USER node
# auth 3000, owner 3001, manager 3002, sales 3003, warehouse 3004, delivery 3005, retailer 3006 (override with <NAME>_SERVICE_PORT)
EXPOSE 3000 3001 3002 3003 3004 3005 3006
CMD ["node", "/app/dist/main.js"]
