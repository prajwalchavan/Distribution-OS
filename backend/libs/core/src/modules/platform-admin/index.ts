export { PlatformAdminModule } from './platform-admin.module.js'
export { PlatformTenantsService } from './tenants.service.js'
export { PlatformSubscriptionsService } from './subscriptions.service.js'
export { PlatformSupportService } from './support.service.js'
export { PlatformConsoleService, ACTIVE_WINDOW_DAYS } from './console.service.js'
/**
 * One support grant on the wire, in the shape both the console and the distributor's owner read
 * (`SupportGrantSchema`). The STATUS it carries is not derived here: `statusOf` lives in
 * `modules/tenancy/support-status.ts` and is read by both halves of the flow, so the two services
 * can never disagree about whether an ask is still answerable (DOS-110).
 */
export { toSupportGrant } from './support-grants.js'
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
