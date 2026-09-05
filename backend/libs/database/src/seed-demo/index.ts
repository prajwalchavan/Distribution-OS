/**
 * Demo dataset for one distributor: a browsable, realistic-looking slice of an FMCG distribution
 * business. Idempotent — every insert is `onConflictDoNothing()` against a deterministic id
 * (`demoId`), so re-running the seed adds nothing. Runs on the owner (BYPASSRLS) connection; never
 * uses `withTenant`.
 *
 * The database holds THREE of these (founder requirement, docs/22 §8 2026-09-04). The pilot tenant
 * (Tarsun Enterprises) seeds at the root id scope and gets every module's demo data; the other two
 * (`seed-demo/tenants.ts`) seed under their own scope and get the core order-to-cash month. What
 * separates them is `inDemoScope`: the same builders below, the same catalog, different ids.
 */
import type { Db } from '../client.js'
import { seedAi } from './ai.js'
import { seedPlatformSupport } from './platform-admin.js'
import { seedBilling, seedPendingVanSaleOrder } from './billing.js'
import { seedCatalog, type VariantRow } from './catalog.js'
import { seedClaims } from './claims.js'
import { seedDelivery } from './delivery.js'
import { seedDeliveryRoad } from './delivery-road.js'
import { seedDocint } from './docint.js'
import { inDemoScope } from './ids.js'
import { seedIncentives } from './incentives.js'
import { seedIntegrations } from './integrations.js'
import { seedNotifications } from './notifications.js'
import { seedPeople, type PeopleResult, type PeopleRoster } from './people.js'
import { seedPlatformGaps } from './platform-gaps.js'
import { seedPricing } from './pricing.js'
import { seedReceivables } from './receivables.js'
import { seedReporting } from './reporting.js'
import { seedRetailers, TARSUN_NETWORK, type RetailerNetwork } from './retailers.js'
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
  /**
   * Id namespace for this tenant's rows, e.g. `'sai:'`. Empty (the default) is the pilot, whose ids
   * every `/docs` example, spec and `pnpm smoke` probe quotes — never scope it.
   */
  scope?: string
  /** Name shown in the sign-in table header. */
  label?: string
  /** Who works here. Defaults to the pilot's team. */
  roster?: PeopleRoster
  /** Its shops, beats and the shops it shares with another distributor. Defaults to the pilot's. */
  network?: RetailerNetwork
  /** The brands it lists; its catalog overlay is these brands' variants. Default: the whole catalog. */
  brandKeys?: readonly string[]
  /**
   * `full` (default) writes every module's demo data — the pilot, which `pnpm smoke` calls end to end.
   * `core` stops after reporting: a month of orders, invoices, receipts, trips, deliveries and the
   * rollups over them, which is what the other distributors exist to prove.
   */
  depth?: 'full' | 'core'
}

export interface SeedDemoResult {
  tenantId: string
  label: string
  people: PeopleResult
}

export async function seedDemo(
  db: Db,
  tenantId: string,
  opts: SeedDemoOptions,
): Promise<SeedDemoResult> {
  // The catalog is global and curated (ADR 0005): one row per manufacturer, brand, product, variant
  // for the whole platform, seeded once at the root scope whichever tenant is being written.
  const allVariants = await seedCatalog(db)

  return inDemoScope(opts.scope ?? '', async () => {
    const roster = opts.roster
    const network = opts.network ?? TARSUN_NETWORK
    const label = opts.label ?? 'demo'
    const variants: VariantRow[] = opts.brandKeys
      ? allVariants.filter((v) => opts.brandKeys?.includes(v.brandKey))
      : allVariants

    const people = roster
      ? await seedPeople(db, tenantId, opts.passwordHash, roster)
      : await seedPeople(db, tenantId, opts.passwordHash)
    const retailersRes = await seedRetailers(db, tenantId, people, network)
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
    // After warehouse: the freshest load sheet has put real stock on Tempo 1, so the one van-sale order
    // still waiting to be billed can be fulfilled from it (inside `seedBilling` the van was still empty
    // on the first seed of a fresh database and the order only appeared on the second run).
    await seedPendingVanSaleOrder(db, tenantId, variants, retailersRes, people)
    await seedReceivables(db, tenantId, retailersRes, people)
    await seedReporting(db, tenantId, variants, tenantCatalog, retailersRes, sales, people)

    if ((opts.depth ?? 'full') === 'full') {
      // After warehouse: the parked packs and their pick lines exist; after stock: the godown balances.
      await seedPlatformGaps(db, tenantId, stock, people)
      // After stock: the document readings equal the supplier invoices it booked (docs/plans/docint.md §6).
      await seedDocint(db, tenantId, variants, tenantCatalog, people)
      // After receivables and billing: the confirmed imports point at rows those seeds wrote (the shops,
      // the listings, billing's brand-DMS bill); the Tally sync ledger names the first week's bills.
      await seedIntegrations(db, tenantId, variants, retailersRes, stock, sales, people)
      // Last: the delivery module's road data reads the bills, orders and loads every seed above wrote.
      await seedDeliveryRoad(db, tenantId, sales, people, delivery)
      // After sales, stock and integrations: the claims read the August scheme bills, the damaged-bin
      // ledger rows and the gate-count shortage back from the database (docs/plans/claims.md §6).
      await seedClaims(db, tenantId, variants, tenantCatalog, stock, people)
      // Last of all: the message log points at the orders, bills, deliveries and receipts every seed
      // above wrote, and reads the shops' opt-ins the retailers seed recorded (docs/plans/notifications.md §6).
      await seedNotifications(db, tenantId, retailersRes, sales, people)
      // The leaf of the module chain: targets read back the orders, visits and receipts every seed above
      // wrote, so a rep's progress bar, the leaderboard and the payout register all agree
      // (docs/plans/incentives.md §6).
      await seedIncentives(db, tenantId, people)
      // Module 12 (docs/22 §8, 2026-09-05): drafts off the inbound texts the notifications seed
      // wrote, reorder suggestions read out of the stock ledger, and one unapplied route plan for
      // the open trip. Last, because every one of those rows points at what the seeds above wrote.
      await seedAi(db, tenantId, variants, retailersRes, stock, delivery, people)
      // The owner's half of platform support access (module 13's console is the other half): one
      // Distribution OS staff account and one PENDING request against this distributor, so the owner
      // app has a decision to take and `tenancy.support.*` answers a real row.
      await seedPlatformSupport(db, tenantId, opts.passwordHash)
    }

    if (opts.printSignIn ?? true) printSignInTable(tenantId, label, people)
    return { tenantId, label, people }
  })
}

export function printSignInTable(tenantId: string, label: string, people: PeopleResult): void {
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
  console.warn(`demo sign-in — ${label} — tenant ${tenantId}`)
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
