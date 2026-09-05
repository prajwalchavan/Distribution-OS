export { TenancyModule } from './tenancy.module.js'
export { TenancyService } from './tenancy.service.js'
export { TenantConfigService } from './config.service.js'
export { TenantGuard } from './tenant.guard.js'
/**
 * THE WHITE-LABEL BLOCK every printed document and every app's chrome carries (docs/17 §D6). One
 * loader for billing (invoice, credit note), warehouse (challan), receivables (receipt), the worker's
 * PDF renderer and `tenancy.branding.get` — so a distributor's name and logo can never differ from
 * one document to the next. Plain functions: the worker calls them without Nest DI.
 */
export { sellerBranding, loadSettings, signedObjectUrl, LOGO_URL_TTL_SECONDS } from './branding.js'
