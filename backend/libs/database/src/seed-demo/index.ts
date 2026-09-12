/**
 * Demo dataset for one distributor: a browsable, realistic-looking slice of an FMCG distribution
 * business. Idempotent — every insert is `onConflictDoNothing()` against a deterministic id
 * (`demoId`), so re-running the seed adds nothing. Runs on the owner (BYPASSRLS) connection; never
 * uses `withTenant`.
 *
 * The database holds THREE of these (founder requirement, docs/22 §8 2026-09-04). The pilot tenant
 * (Tarsun Enterprises) seeds at the root id scope and gets every module's demo data; the other two
 * (`seed-demo/tenants.ts`) seed under their own scope and get the core order-to-cash month plus the
 * surfaces that are v1 for EVERY distributor — the AI drafts, forecasts and route plans, and the
 * support request its owner has to answer. What separates them is `inDemoScope`: the same builders
 * below, the same catalog, different ids.
 */
import { and, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { memberships, salesOrders, tenants, tenantSettings, users } from '../schema/index.js'
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
import { seedPilotBranding } from './branding.js'
import { seedNotifications } from './notifications.js'
import { seedPeople, type PeopleResult, type PeopleRoster } from './people.js'
import { seedPlatformGaps } from './platform-gaps.js'
import { seedPricing } from './pricing.js'
import { seedReceivables } from './receivables.js'
import { seedReporting, seedReportingClose } from './reporting.js'
import { seedRetailers, TARSUN_NETWORK, type RetailerNetwork } from './retailers.js'
import { seedSales } from './sales.js'
import { seedStock } from './stock.js'
import { seedTenantCatalog } from './tenant-catalog.js'
import { defaultDemoToday, isoDate, lastWorkingDayOnOrBefore, setDemoToday, TODAY } from './util.js'
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
   * rollups over them, which is what the other distributors exist to prove. Whichever depth is asked
   * for, the AI surfaces and the pending support request are written — they are v1 for every
   * distributor, not a pilot extra (see the block below the `full` gate).
   */
  depth?: 'full' | 'core'
  /** Calendar days of order history (default 90; the smaller distributors run 60 and 45). */
  historyDays?: number
}

export interface SeedDemoResult {
  tenantId: string
  label: string
  people: PeopleResult
}

/**
 * PUT THE DEMO BACK ON ITS FEET — the half of `pnpm db:seed` that no `insert … onConflictDoNothing()`
 * can do.
 *
 * `pnpm smoke --destructive` presses the sharpest switches in the product on purpose:
 * `admin.tenants.suspend` refuses every sign-in for a whole distributorship with 423,
 * `admin.users.disable` locks one global identity out of every distributor it belongs to, and
 * `tenancy.staff.setStatus` disables a membership. CLAUDE.md's recovery for all of that is one line —
 * "idempotent, re-run after `pnpm smoke --destructive`" — but every other statement in this file
 * inserts a row that already exists and therefore restores NOTHING. On 2026-09-06 that gap left the
 * pilot tenant suspended and every one of the seven sign-ins answering 423 until the column was set
 * by hand. These three UPDATEs are that line's implementation.
 *
 * It only ever moves a row TOWARDS usable and only inside a demo distributor: nothing under
 * `seed-demo/` writes a `suspended`, `closed`, `disabled` or `invited` status, so `active` IS the
 * seeded state, and on a healthy database all three statements match zero rows.
 */
async function restoreDemoAccess(db: Db, tenantId: string): Promise<void> {
  const now = new Date()
  await db
    .update(tenants)
    .set({ status: 'active', updatedAt: now })
    .where(and(eq(tenants.id, tenantId), ne(tenants.status, 'active')))
  await db
    .update(memberships)
    .set({ status: 'active', updatedAt: now })
    .where(and(eq(memberships.tenantId, tenantId), ne(memberships.status, 'active')))
  await db
    .update(users)
    .set({ status: 'active', updatedAt: now })
    .where(
      and(
        ne(users.status, 'active'),
        sql`exists (select 1 from ${memberships} m
                    where m.user_id = ${users.id} and m.tenant_id = ${tenantId})`,
      ),
    )
}

/** The `tenant_settings` key that remembers the live day a database was first seeded on. */
export const DEMO_ANCHOR_KEY = 'demo.anchor_date'
/**
 * The `tenant_settings` key a seed run writes FIRST and removes LAST: the live day it is building
 * towards. Present after the run means the run died half way; the next run resumes on the same day.
 */
export const DEMO_SEED_IN_PROGRESS_KEY = 'demo.seed_in_progress'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function readSetting(db: Db, tenantId: string | null, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: tenantSettings.value })
    .from(tenantSettings)
    .where(
      tenantId
        ? and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, key))
        : eq(tenantSettings.key, key),
    )
    .orderBy(tenantSettings.createdAt, tenantSettings.tenantId)
    .limit(1)
  return typeof row?.value === 'string' && DATE_RE.test(row.value) ? row.value : null
}

/**
 * THE LIVE DAY. A fresh database is seeded with today (IST) as the day every screen opens on; the
 * date is written to `tenant_settings` so every later `pnpm db:seed` on the same database rebuilds
 * the exact same rows (idempotency needs the same anchor, and a date-keyed order id must not change
 * under a row that already exists). `DEMO_TODAY=YYYY-MM-DD` in the environment wins on a fresh
 * database and must agree with the stored anchor on a seeded one.
 *
 * The anchor (`demo.anchor_date`) is committed only AFTER the whole seed has succeeded
 * (`commitDemoAnchor`). Until then the run leaves `demo.seed_in_progress` behind: a run that dies
 * half way — a bug on one weekday, a lost connection — is resumed by the next run on the same live
 * day (every insert is keyed on a deterministic id, so the rows already written are skipped and the
 * rest are filled in), instead of being a database nobody can seed again (2026-09-08 review: the
 * anchor used to be written before a single business row).
 *
 * REFUSES a database that already carries demo rows from a seed that predates the anchor (neither
 * key anywhere, yet the tenant has orders): every date-keyed id would differ, the invoice numbers
 * would collide on their unique index, `onConflictDoNothing` would drop the headers and the lines
 * would fail their foreign key half way through — leaving the founder's database with two order
 * books. The only honest answer is a fresh database (`docs/28-running-it-locally.md` §3).
 */
async function resolveDemoToday(db: Db, tenantId: string): Promise<void> {
  const pinned = process.env.DEMO_TODAY
  const pinnedValid = pinned !== undefined && DATE_RE.test(pinned)
  const stored =
    (await readSetting(db, tenantId, DEMO_ANCHOR_KEY)) ??
    (await readSetting(db, null, DEMO_ANCHOR_KEY))
  const inProgress = stored
    ? null
    : ((await readSetting(db, tenantId, DEMO_SEED_IN_PROGRESS_KEY)) ??
      (await readSetting(db, null, DEMO_SEED_IN_PROGRESS_KEY)))
  if (!stored && !inProgress) {
    const [seededBefore] = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(eq(salesOrders.tenantId, tenantId))
      .limit(1)
    if (seededBefore) {
      throw new Error(
        [
          'pnpm db:seed: this database was seeded by an earlier demo seed (it has orders but no',
          `\`${DEMO_ANCHOR_KEY}\` setting). The realistic dataset cannot be layered on top of it —`,
          'its ids and document numbers would collide half way through. Drop and recreate the database',
          'once: `dropdb dos && createdb dos && pnpm db:migrate && pnpm db:seed`',
          '(docs/28-running-it-locally.md §3). Only the bootstrap ran: the tenant row, the pilot',
          'owner and the chart of accounts were (re)written; no demo row was.',
        ].join(' '),
      )
    }
  }
  const remembered = stored ?? inProgress
  let anchor: Date
  if (pinnedValid) {
    const pinnedDay = isoDate(lastWorkingDayOnOrBefore(new Date(`${pinned}T00:00:00.000Z`)))
    if (remembered && remembered !== pinnedDay) {
      throw new Error(
        `pnpm db:seed: DEMO_TODAY=${pinned} (live day ${pinnedDay}) but this database was ${stored ? 'seeded' : 'part-seeded by a run that did not finish'} with ${remembered}; a seeded database keeps its anchor. Unset DEMO_TODAY, or use a fresh database. Only the bootstrap ran; no demo row was written.`,
      )
    }
    anchor = defaultDemoToday()
  } else if (remembered) anchor = new Date(`${remembered}T00:00:00.000Z`)
  else anchor = defaultDemoToday()
  setDemoToday(anchor)
  if (!stored)
    await db
      .insert(tenantSettings)
      .values({ tenantId, key: DEMO_SEED_IN_PROGRESS_KEY, value: isoDate(TODAY) })
      .onConflictDoNothing()
}

/** The last statement of a successful seed: the live day is now this database's anchor. */
async function commitDemoAnchor(db: Db, tenantId: string): Promise<void> {
  await db
    .insert(tenantSettings)
    .values({ tenantId, key: DEMO_ANCHOR_KEY, value: isoDate(TODAY) })
    .onConflictDoNothing()
  await db
    .delete(tenantSettings)
    .where(
      and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, DEMO_SEED_IN_PROGRESS_KEY)),
    )
}

export async function seedDemo(
  db: Db,
  tenantId: string,
  opts: SeedDemoOptions,
): Promise<SeedDemoResult> {
  // Before anything is written: put the distributorship and its people back on their feet, and
  // settle which day is "today".
  await resolveDemoToday(db, tenantId)
  await restoreDemoAccess(db, tenantId)
  // The catalog is global and curated (ADR 0005): one row per manufacturer, brand, product, variant
  // for the whole platform, seeded once at the root scope whichever tenant is being written. The
  // pilot is named as the proposer of the two `proposed` products; the other tenants' calls are
  // no-ops on rows that already exist.
  const allVariants = await seedCatalog(
    db,
    (opts.scope ?? '') === '' ? { proposerTenantId: tenantId } : {},
  )
  const historyDays = opts.historyDays ?? 90

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
    const tenantCatalog = await seedTenantCatalog(db, tenantId, variants, people)
    // The order book comes first; the godown is written from the plan it produces (stock-plan.ts):
    // every supplier bill sized from what was sold, every sold line picked from a batch that was on
    // the rack and in date that day.
    const sales = await seedSales(db, tenantId, variants, retailersRes, pricing, people, {
      historyDays,
      commitStock: (plan) => seedStock(db, tenantId, variants, tenantCatalog, people, plan),
    })
    const stock = sales.stock
    const delivery = await seedDelivery(db, tenantId, retailersRes, sales, people, { historyDays })
    // After delivery: the van sale below leaves a VEHICLE location, which `seedDelivery` creates.
    await seedBilling(db, tenantId, variants, retailersRes, sales, stock, people, pricing, {
      historyDays,
    })
    // After billing: a pack confirmation carries the invoice id billing has just written, and a load
    // sheet's value is the sum of those invoices. After delivery: a sheet loads a VEHICLE location, and
    // `seedDelivery` is what creates them.
    await seedWarehouse(db, tenantId, sales, stock, people)
    // After warehouse: the freshest load sheet has put real stock on Tempo 1, so the one van-sale order
    // still waiting to be billed can be fulfilled from it (inside `seedBilling` the van was still empty
    // on the first seed of a fresh database and the order only appeared on the second run).
    await seedPendingVanSaleOrder(db, tenantId, variants, retailersRes, stock, people, pricing)
    await seedReceivables(db, tenantId, retailersRes, people, {
      protectedRetailerIds: sales.protectedRetailerIds,
    })
    await seedReporting(db, tenantId, variants, tenantCatalog, retailersRes, sales, people, {
      historyDays,
      pricing,
    })

    const full = (opts.depth ?? 'full') === 'full'
    if (full) {
      // After warehouse: the parked packs and their pick lines exist; after stock: the godown balances.
      await seedPlatformGaps(db, tenantId, stock, people)
      // After stock: the document readings equal the supplier invoices it booked (docs/plans/docint.md §6).
      await seedDocint(db, tenantId, variants, tenantCatalog, people)
      // After receivables and billing: the confirmed imports point at rows those seeds wrote (the shops,
      // the listings, billing's brand-DMS bill); the Tally sync ledger names the first week's bills.
      await seedIntegrations(db, tenantId, variants, retailersRes, stock, sales, people)
    }
    // EVERY distributor: tomorrow's planned trip is what today's draft load sheet points at, and the
    // delivery app of each distributor opens on a plan. Reads the bills, orders and loads every seed
    // above wrote.
    await seedDeliveryRoad(db, tenantId, sales, people, delivery)
    // EVERY distributor claims its scheme money from the brands (the founder's second stated problem):
    // after sales and stock, the claims read every scheme bill of the quarter, the damaged-bin ledger
    // rows and the gate-count shortage back from the database (docs/plans/claims.md §6).
    await seedClaims(db, tenantId, variants, tenantCatalog, stock, people)
    if (full) {
      // Last of all: the message log points at the orders, bills, deliveries and receipts every seed
      // above wrote, and reads the shops' opt-ins the retailers seed recorded (docs/plans/notifications.md §6).
      await seedNotifications(db, tenantId, retailersRes, sales, people)
      // The leaf of the module chain: targets read back the orders, visits and receipts every seed above
      // wrote, so a rep's progress bar, the leaderboard and the payout register all agree
      // (docs/plans/incentives.md §6).
      await seedIncentives(db, tenantId, people)
    }

    // EVERY distributor from here down, not only the pilot (founder requirement, docs/22 §8
    // 2026-09-04: three distributors, and the assistive surfaces are v1 for all of them). Placed
    // AFTER the `full` block rather than inside it so the pilot's order is unchanged: the AI seed
    // prefers the shop's real `inbound_messages` row when the notifications seed has written one,
    // and files the same sentence against the shop directly when it has not.
    //
    // Module 12 (docs/22 §8, 2026-09-05): a draft in every status, reorder suggestions read out of
    // this distributor's own served orders, and one unapplied route plan per plannable trip. Late,
    // because every one of those rows points at what the seeds above wrote.
    await seedAi(db, tenantId, variants, retailersRes, stock, sales, people)
    // The owner's half of platform support access (module 13's console is the other half): the
    // Distribution OS staff account and one PENDING request against this distributor, so every
    // owner app has a decision to take and `tenancy.support.*` answers a real row.
    await seedPlatformSupport(db, tenantId, opts.passwordHash)
    // The pilot's real letterhead (founder, 2026-09-06): name, address, GSTIN and logo, so every
    // document and every app header shows Tarsun Enterprise rather than a placeholder. Only the
    // pilot: the other two distributors keep the branding `seed-demo/tenants.ts` gives them.
    if (!(opts.scope ?? '')) await seedPilotBranding(db, tenantId)
    // The owner's home tile and the closing stock at cost, from the tables every seed above has
    // finished with — the last rows written, so they tie to everything else.
    await seedReportingClose(db, tenantId, tenantCatalog, { historyDays })

    // Everything is in: remember the live day, and clear the in-progress marker.
    await commitDemoAnchor(db, tenantId)

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
    ...people.extra.map((p) => row(p.role, p)),
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
