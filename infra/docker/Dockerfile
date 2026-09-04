# Builds one image that runs either the API (default) or the worker (CMD override).
# Not yet built on the founder's machine (no Docker installed there); CI builds it.
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY shared ./shared
COPY backend ./backend
RUN pnpm install --frozen-lockfile --filter "@dos/api..." --filter "@dos/worker..."

FROM deps AS build
RUN pnpm --filter "@dos/api..." --filter "@dos/worker..." run build
RUN pnpm --filter @dos/api deploy --prod /out/api && pnpm --filter @dos/worker deploy --prod /out/worker

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api /app/api
COPY --from=build /out/worker /app/worker
COPY --from=build /repo/backend/db/migrations /app/migrations
USER node
EXPOSE 3000
CMD ["node", "/app/api/dist/main.js"]
