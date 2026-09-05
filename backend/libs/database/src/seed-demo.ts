/** Entry point kept at the top level per convention; the implementation lives in `seed-demo/`. */
export {
  seedDemo,
  DEMO_PASSWORD,
  type SeedDemoOptions,
  type SeedDemoResult,
} from './seed-demo/index.js'
export { seedExtraTenants, EXTRA_TENANTS, type TenantProfile } from './seed-demo/tenants.js'
