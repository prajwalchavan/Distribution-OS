/**
 * `@dos/core/reporting` — what the pg-boss worker imports (coordination §3.9: plain functions, no Nest
 * DI). Kept separate from `index.ts` so the worker never resolves the controller or a Nest module.
 */
export {
  activeTenantIds,
  rollupBehaviour,
  rollupTenant,
  rollupTenantDay,
  type RollupResult,
} from './rollup.js'
export { registerReportRenderers } from './renderers.js'
export { createReportingStack, type ReportingStack } from './worker-services.js'
