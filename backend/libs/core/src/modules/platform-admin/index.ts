export { PlatformAdminModule } from './platform-admin.module.js'
export { PlatformTenantsService } from './tenants.service.js'
export { PlatformSubscriptionsService } from './subscriptions.service.js'
export { PlatformSupportService } from './support.service.js'
export { PlatformConsoleService, ACTIVE_WINDOW_DAYS } from './console.service.js'
/**
 * One support grant on the wire, in the shape both the console and the distributor's owner read
 * (`SupportGrantSchema`). `tenancy`'s own support service keeps its private copy of the same mapping
 * because the two modules must not import each other; if a third reader ever appears, move this one
 * into `@dos/domain` rather than adding a cross-module edge.
 */
export { toSupportGrant, statusOf as supportGrantStatus } from './support-grants.js'
/**
 * How big each distributor is, and how busy the platform is — COUNTS ONLY (see the header of
 * `counts.ts` for the rule every query there obeys). Plain functions, so a later worker rollup imports
 * them without Nest DI (coordination §3.9).
 */
export { tenantSizes, platformCounts, type TenantSize, type PlatformCounts } from './counts.js'
/**
 * The two ways module 13 reaches the database and why they differ. Exported for the spec, which
 * asserts that a console session under `withPlatform` reads ZERO rows of any distributor's business.
 */
export { withPlatform, platformContext } from './internals.js'
