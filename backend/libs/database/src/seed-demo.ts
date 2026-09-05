/** Entry point kept at the top level per convention; the implementation lives in `seed-demo/`. */
export {
  seedDemo,
  DEMO_PASSWORD,
  type SeedDemoOptions,
  type SeedDemoResult,
} from './seed-demo/index.js'
export { seedExtraTenants, EXTRA_TENANTS, type TenantProfile } from './seed-demo/tenants.js'
/**
 * Module 13's console data (the `dos.admin` super account, a subscription per distributor, one live
 * and one lapsed support window). Runs ONCE for the whole database, after every distributor exists,
 * because everything it writes is global or spans tenants.
 */
export {
  seedPlatformConsole,
  DEMO_PLATFORM_ADMIN_USERNAME,
  type PlatformConsoleSeedResult,
} from './seed-demo/platform-admin.js'
