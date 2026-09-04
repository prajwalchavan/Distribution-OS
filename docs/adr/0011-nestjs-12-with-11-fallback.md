# ADR 0011: NestJS 12 (fallback to 11 closed)

Status: accepted (2026-09-04); fallback clause retired the same day.

## Decision

NestJS 12.0.1 on Fastify 5 with the oRPC Nest adapter 1.15, Drizzle 0.45 and pg-boss 12. The original decision kept Nest 11 as a fallback if the ESM-native 12 line broke any of these integrations. The adversarial verification ran the stack in this repository: typecheck, build, the in-process Fastify + oRPC specs and the built `dist/main.js` all work on Nest 12, so the fallback is closed.

Two operational facts came out of it and are now conventions: esbuild-based runners (tsx, vitest's default transform) do not emit decorator metadata, so Nest constructor injection silently receives `undefined`; the api runs dev via `@swc-node/register` and tests via `unplugin-swc`. And oRPC's adapter writes the Fastify reply itself, so every `@Implement` method takes `@OwnsReply()` to stop Nest from replying a second time.

## Source

Synthesis §9 (docs/design/SYNTHESIS.md); verdicts on the NestJS 12 claim (docs/design/VERDICTS.md); E2/E3 in docs/15-decisions-log.md.
