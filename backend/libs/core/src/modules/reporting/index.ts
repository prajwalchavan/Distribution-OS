/**
 * Reporting's only entry point (`eslint-plugin-boundaries`). Reporting is a LEAF: it is called by no
 * other module (docs/plans/reporting.md §1) — what is exported here is for the SERVICES that mount it
 * and for the pg-boss worker, never for another bounded context.
 *
 *   services   `ReportingModule` (owner, manager, sales, warehouse, delivery — coordination §6)
 *   worker     the rollup jobs and the `report_*` renderer registration, as plain functions with no
 *              Nest DI (coordination §3.9); the worker imports them through `@dos/core/reporting`
 */
export { ReportingModule } from './reporting.module.js'
export { ReportingService } from './reporting.service.js'
export { ReportingRegistersService } from './registers.service.js'
export { ReportExportsService } from './exports.service.js'
export { registerReportRenderers } from './renderers.js'
export {
  activeTenantIds,
  rollupBehaviour,
  rollupTenant,
  rollupTenantDay,
  type RollupResult,
} from './rollup.js'
export { createReportingStack, type ReportingStack } from './worker-services.js'
export { REGISTER_SPECS, type RegisterSpec } from './register-specs.js'
