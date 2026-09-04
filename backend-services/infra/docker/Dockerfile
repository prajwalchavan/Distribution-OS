# One image per backend service: `docker build --build-arg SERVICE=owner -f backend-services/infra/docker/Dockerfile .`
# SERVICE is one of owner | sales | warehouse | delivery | retailer | worker. Each runs as N stateless replicas (docs/20).
# Not yet built on the founder's machine (no Docker installed there); CI builds it.
ARG SERVICE=owner
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

FROM base AS deps
ARG SERVICE
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared ./shared
COPY backend-services ./backend-services
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
COPY --from=build /repo/backend-services/database/migrations /app/migrations
USER node
# owner 3001, sales 3002, warehouse 3003, delivery 3004, retailer 3005 (override with <NAME>_SERVICE_PORT)
EXPOSE 3001 3002 3003 3004 3005
CMD ["node", "/app/dist/main.js"]
