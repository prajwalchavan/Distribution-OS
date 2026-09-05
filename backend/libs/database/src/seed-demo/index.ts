/**
 * Demo dataset for the pilot tenant (Tarsun Enterprises): a browsable, realistic-looking 14-day slice of
 * an FMCG distribution business. Idempotent — every insert is `onConflictDoNothing()` against a
 * deterministic id (`demoId`), so re-running the seed adds nothing. Runs on the owner (BYPASSRLS)
 * connection; never uses `withTenant`.
 */
import type { Db } from '../client.js'
import { seedBilling } from './billing.js'
import { seedCatalog } from './catalog.js'
import { seedDelivery } from './delivery.js'
import { seedDeliveryRoad } from './delivery-road.js'
import { seedPeople, type PeopleResult } from './people.js'
import { seedPlatformGaps } from './platform-gaps.js'
import { seedPricing } from './pricing.js'
import { seedReceivables } from './receivables.js'
import { seedReporting } from './reporting.js'
import { seedRetailers } from './retailers.js'
import { seedSales } from './sales.js'
import { seedStock } from './stock.js'
import { seedTenantCatalog } from './tenant-catalog.js'
import { seedWarehouse } from './warehouse.js'

/**
 * The password of every seeded account, demo and pilot owner alike. Local dummy data only: the seed is
 * never run against a real deployment, and the first thing a real tenant does is set its own password.
 */
export const DEMO_PASSWORD = 'Dos@1234'

export interface SeedDemoOptions {
  /** Print the sign-in table to stderr at the end (default true). */
  printSignIn?: boolean
  /**
   * argon2id hash of DEMO_PASSWORD, hashed once by the caller and shared by every demo user — argon2 is
   * deliberately slow, and hashing thirteen identical passwords would add seconds to every seed run.
   */
  passwordHash: string
}

export async function seedDemo(db: Db, tenantId: string, opts: SeedDemoOptions): Promise<void> {
  const variants = await seedCatalog(db)
  const people = await seedPeople(db, tenantId, opts.passwordHash)
  const retailersRes = await seedRetailers(db, tenantId, people)
  const pricing = await seedPricing(db, tenantId, variants, retailersRes, people)
  const tenantCatalog = await seedTenantCatalog(db, tenantId, variants)
  const stock = await seedStock(db, tenantId, variants, tenantCatalog, people)
  const sales = await seedSales(db, tenantId, variants, retailersRes, pricing, stock, people)
  const delivery = await seedDelivery(db, tenantId, retailersRes, sales, people)
  // After delivery: the van sale below leaves a VEHICLE location, which `seedDelivery` creates.
  await seedBilling(db, tenantId, variants, retailersRes, sales, stock, people)
  // After billing: a pack confirmation carries the invoice id billing has just written, and a load
  // sheet's value is the sum of those invoices. After delivery: a sheet loads a VEHICLE location, and
  // `seedDelivery` is what creates them.
  await seedWarehouse(db, tenantId, sales, stock, people)
  await seedReceivables(db, tenantId, retailersRes, people)
  await seedReporting(db, tenantId, retailersRes, sales, people)
  // After warehouse: the parked packs and their pick lines exist; after stock: the godown balances.
  await seedPlatformGaps(db, tenantId, stock, people)
  // Last: the delivery module's road data reads the bills, orders and loads every seed above wrote.
  await seedDeliveryRoad(db, tenantId, sales, people, delivery)

  if (opts.printSignIn ?? true) printSignInTable(tenantId, people)
}

function printSignInTable(tenantId: string, people: PeopleResult): void {
  const row = (role: string, p: { name: string; id: string; username: string }) => ({
    role,
    name: p.name,
    username: p.username,
    userId: p.id,
  })
  const rows = [
    row('owner', people.owner),
    row('manager', people.manager),
    row('accountant', people.accountant),
    row('warehouse', people.warehouse),
    row('warehouse', people.warehouse2),
    row('salesperson', people.salespeople.rahul),
    row('salesperson', people.salespeople.amit),
    row('salesperson', people.salespeople.pooja),
    row('delivery', people.delivery.ganesh),
    row('delivery', people.delivery.raju),
    row('delivery', people.delivery.santosh),
    row('delivery', people.delivery.iqbal),
    row('retailer', people.retailerUsers[0]),
    row('retailer', people.retailerUsers[1]),
  ]
  const pad = (key: 'role' | 'name' | 'username', header: string) =>
    Math.max(header.length, ...rows.map((r) => r[key].length))
  const roleW = pad('role', 'role')
  const nameW = pad('name', 'name')
  const userW = pad('username', 'username')
  const passW = Math.max('password'.length, DEMO_PASSWORD.length)
  console.warn('')
  console.warn(`demo sign-in — tenant ${tenantId}`)
  console.warn(
    `${'role'.padEnd(roleW)}  ${'name'.padEnd(nameW)}  ${'username'.padEnd(userW)}  ${'password'.padEnd(passW)}  user id`,
  )
  for (const r of rows) {
    console.warn(
      `${r.role.padEnd(roleW)}  ${r.name.padEnd(nameW)}  ${r.username.padEnd(userW)}  ${DEMO_PASSWORD.padEnd(passW)}  ${r.userId}`,
    )
  }
  console.warn('')
}
