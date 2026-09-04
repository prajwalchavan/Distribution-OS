# ADR 0011: nestjs 12 with 11 fallback

Status: accepted (2026-09-04).

## Decision

NestJS 12 on the Fastify adapter, adopted only if the week-1 compatibility spike (Better Auth, oRPC Nest adapter, pg-boss, Drizzle 0.45, Sentry on ESM) passes; otherwise NestJS 11 with an upgrade ADR. The skeleton already runs Nest 12 + oRPC + Drizzle + pg-boss on ESM (2026-09-04). Every version is pinned in pnpm-workspace.yaml `catalog`; upgrades happen once per quarter with the native release. Decision D24.
