/**
 * `@dos/core/receivables` — what the pg-boss worker imports (coordination §3.9: plain functions, no
 * Nest DI). Kept separate from `index.ts` so the worker never resolves the controller or a Nest
 * module: tsx emits no `design:paramtypes`, and a Nest service instantiated there would silently
 * receive `undefined` dependencies.
 */
export { loadStatementSummary, type StatementSummary } from './documents.js'
export { ageingNeedsRebuild, rebuildTenantAgeing } from './ageing-rebuild.js'
