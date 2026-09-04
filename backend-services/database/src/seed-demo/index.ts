/**
 * Demo dataset for the pilot tenant (Tarsun Enterprises): a browsable, realistic-looking 14-day slice of
 * an FMCG distribution business. Idempotent — every insert is `onConflictDoNothing()` against a
 * deterministic id (`demoId`), so re-running the seed adds nothing. Runs on the owner (BYPASSRLS)
 * connection; never uses `withTenant`.
 */
import type { Db } from '../client.js'
import { seedCatalog } from './catalog.js'
import { seedDelivery } from './delivery.js'
import { seedPeople, type PeopleResult } from './people.js'
import { seedPricing } from './pricing.js'
import { seedReporting } from './reporting.js'
import { seedRetailers } from './retailers.js'
import { seedSales } from './sales.js'
import { seedStock } from './stock.js'
import { seedTenantCatalog } from './tenant-catalog.js'

export interface SeedDemoOptions {
  /** Print the sign-in table to stderr at the end (default true). */
  printSignIn?: boolean
}

export async function seedDemo(
  db: Db,
  tenantId: string,
  opts: SeedDemoOptions = {},
): Promise<void> {
  const variants = await seedCatalog(db)
  const people = await seedPeople(db, tenantId)
  const retailersRes = await seedRetailers(db, tenantId, people)
  const pricing = await seedPricing(db, tenantId, variants, retailersRes, people)
  const tenantCatalog = await seedTenantCatalog(db, tenantId, variants)
  const stock = await seedStock(db, tenantId, variants, tenantCatalog, people)
  const sales = await seedSales(db, tenantId, variants, retailersRes, pricing, stock, people)
  await seedDelivery(db, tenantId, retailersRes, sales, people)
  await seedReporting(db, tenantId, retailersRes, sales, people)

  if (opts.printSignIn ?? true) printSignInTable(tenantId, people)
}

function printSignInTable(tenantId: string, people: PeopleResult): void {
  const rows: { role: string; name: string; userId: string }[] = [
    { role: 'owner', name: people.owner.name, userId: people.owner.id },
    { role: 'manager', name: people.manager.name, userId: people.manager.id },
    { role: 'accountant', name: people.accountant.name, userId: people.accountant.id },
    {
      role: 'salesperson',
      name: people.salespeople.rahul.name,
      userId: people.salespeople.rahul.id,
    },
    { role: 'salesperson', name: people.salespeople.amit.name, userId: people.salespeople.amit.id },
    {
      role: 'salesperson',
      name: people.salespeople.pooja.name,
      userId: people.salespeople.pooja.id,
    },
    { role: 'delivery', name: people.delivery.ganesh.name, userId: people.delivery.ganesh.id },
    { role: 'delivery', name: people.delivery.raju.name, userId: people.delivery.raju.id },
    { role: 'delivery', name: people.delivery.santosh.name, userId: people.delivery.santosh.id },
    { role: 'delivery', name: people.delivery.iqbal.name, userId: people.delivery.iqbal.id },
    { role: 'retailer', name: people.retailerUsers[0].name, userId: people.retailerUsers[0].id },
    { role: 'retailer', name: people.retailerUsers[1].name, userId: people.retailerUsers[1].id },
  ]
  const roleW = Math.max(4, ...rows.map((r) => r.role.length))
  const nameW = Math.max(4, ...rows.map((r) => r.name.length))
  console.warn('')
  console.warn(`demo sign-in — tenant ${tenantId}`)
  console.warn(`${'role'.padEnd(roleW)}  ${'name'.padEnd(nameW)}  user id`)
  for (const r of rows) {
    console.warn(`${r.role.padEnd(roleW)}  ${r.name.padEnd(nameW)}  ${r.userId}`)
  }
  console.warn('')
}
