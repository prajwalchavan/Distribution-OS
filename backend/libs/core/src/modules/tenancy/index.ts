export { TenancyModule } from './tenancy.module.js'
export { TenancyService } from './tenancy.service.js'
export { TenantConfigService } from './config.service.js'
/** The owner's half of platform support access (`tenancy.support.*`); the console's half is module 13. */
export { SupportAccessService } from './support.service.js'
/**
 * WHAT A SUPPORT GRANT IS, derived in exactly ONE place (DOS-110): both halves of the flow — the
 * owner's here and the console's in module 13 — read a status and filter a list through these, so
 * the two services can never disagree about whether an ask is still answerable. Plain functions.
 */
export { statusOf, openGrants, grantStatusPredicate } from './support-status.js'
export { TenantGuard, PLATFORM_SCOPE, type SupportAwareRequest } from './tenant.guard.js'
/**
 * THE WHITE-LABEL BLOCK every printed document and every app's chrome carries (docs/17 §D6). One
 * loader for billing (invoice, credit note), warehouse (challan), receivables (receipt), the worker's
 * PDF renderer and `tenancy.branding.get` — so a distributor's name and logo can never differ from
 * one document to the next. Plain functions: the worker calls them without Nest DI.
 */
export { sellerBranding, loadSettings, signedObjectUrl, LOGO_URL_TTL_SECONDS } from './branding.js'
/** User id → name, scoped to the current tenant's roster (reporting, coordination §4). Plain function. */
export { userLabels } from './user-labels.js'
/**
 * Active members of one role, name-ordered and bounded — delivery's trip planning board (QA DOS-131,
 * coordination §4). Plain function.
 */
export { activeMembersWithRole } from './user-labels.js'
