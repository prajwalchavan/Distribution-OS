import { createHash, randomBytes } from 'node:crypto'
import { bootstrapTenant, hashPassword, memberships, tenants, users, type Db } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { and, eq } from 'drizzle-orm'
import type { LegacySupplier } from '../legacy/bak-data.js'
import type { Plan, PlannedBill, PlannedItem, PlannedRetailer } from '../legacy/plan.js'
import { gstin } from '../legacy/testing.js'
import { findTenant, writePlan, type TenantHandle, type WriteResult } from '../legacy/writer.js'

/**
 * THE LOOK-ALIKE TENANT (test only). A distributor built exactly the way the real one was built —
 * `bootstrapTenant`, then the legacy importer's own writer (`legacy/writer.ts`) fed a plan — except that
 * the plan is SYNTHETIC: every shop, item, maker, supplier and bill below is invented here, from a seed,
 * and nothing is read from anybody's files. It has the real one's shape: about 120 shops (a third
 * without a phone), 84 items on 13 HSN headings (36 priced at cost, 8 without a price), 15 beats,
 * opening bills on about 30 shops, opening stock for 83 items, five suppliers, ONE owner login and
 * nothing else — no staff, no shopkeeper login, no rep on a beat, no order, no trip.
 *
 * Deterministic: the same slug gives the same plan, so a second build finds everything (the writer is
 * idempotent by legacy key) and writes nothing.
 */

export interface LookalikeOptions {
  slug: string
  legalName?: string
  ownerUsername: string
  ownerPassword: string
  /** Six digits; the 13 headings are `<stem>01` … `<stem>13`. A spec on a shared database passes its own. */
  hsnStem?: string
  shops?: number
  /** Today (IST): the books open as of this day. */
  asOf: string
}

export interface LookalikeResult {
  tenantId: string
  ownerId: string
  write: WriteResult
  counts: {
    shops: number
    shopsWithoutPhone: number
    items: number
    unpriced: number
    atCost: number
    withStock: number
    beats: number
    bills: number
    shopsWithBills: number
    suppliers: number
    headings: number
  }
}

/** A small seeded generator (mulberry32) so the plan is the same on every run for the same slug. */
export function seeded(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BEATS = [
  'Station Road',
  'Kalyan West Market',
  'Khadakpada',
  'Adharwadi',
  'Birla College Road',
  'Shivaji Chowk',
  'Kalyan East',
  'Tisgaon',
  'Chikan Ghar',
  'Gandhari',
  'Barave',
  'Wayle Nagar',
  'Ramdas Wadi',
  'Mohone',
  'Titwala',
]

const SHOP_FIRST = [
  'Shree Ganesh',
  'Om Sai',
  'Jai Ambe',
  'Mahalaxmi',
  'Navratna',
  'Gajanan',
  'Siddhivinayak',
  'Saraswati',
  'Laxmi Narayan',
  'Balaji',
  'Vighnaharta',
  'Swami Samarth',
  'Ekvira',
  'Datta Krupa',
  'Mauli',
]
const SHOP_LAST = [
  'Kirana Stores',
  'General Stores',
  'Provision Stores',
  'Traders',
  'Super Market',
  'Mart',
  'Enterprises',
  'Kirana and General',
  'Cold Drinks House',
  'Daily Needs',
]
const OWNER_NAMES = [
  'Ramesh Patil',
  'Suresh Jadhav',
  'Anil Shinde',
  'Prakash More',
  'Vijay Pawar',
  'Santosh Gaikwad',
  'Nitin Kale',
  'Deepak Salunkhe',
  'Mahesh Chavan',
  'Rajesh Kulkarni',
]

const MAKERS = [
  'Sahyadri Snacks',
  'Konkan Beverages',
  'Deccan Biscuits',
  'Western Ghats Foods',
  'Ulhas Dairy Products',
  'Thane Confectioners',
]
const ITEM_BASES: { title: string; maker: number; gst: number; sizes: string[] }[] = [
  { title: 'Glucose Biscuit', maker: 2, gst: 500, sizes: ['70g', '150g', '250g'] },
  { title: 'Cream Biscuit Orange', maker: 2, gst: 1800, sizes: ['60g', '120g'] },
  { title: 'Marie Biscuit', maker: 2, gst: 500, sizes: ['100g', '200g'] },
  { title: 'Salted Peanuts', maker: 0, gst: 500, sizes: ['40g', '150g'] },
  { title: 'Masala Chips', maker: 0, gst: 500, sizes: ['25g', '52g', '90g'] },
  { title: 'Banana Wafers', maker: 0, gst: 500, sizes: ['30g', '100g'] },
  { title: 'Farsan Mix', maker: 0, gst: 500, sizes: ['40g', '200g', '400g'] },
  { title: 'Mango Drink', maker: 1, gst: 500, sizes: ['160ml', '250ml', '600ml', '1.2L'] },
  { title: 'Cola', maker: 1, gst: 4000, sizes: ['250ml', '600ml', '1.25L', '2L'] },
  { title: 'Lemon Soda', maker: 1, gst: 4000, sizes: ['200ml', '600ml'] },
  { title: 'Jeera Soda', maker: 1, gst: 4000, sizes: ['200ml', '500ml'] },
  { title: 'Packaged Water', maker: 1, gst: 1800, sizes: ['500ml', '1L', '2L'] },
  { title: 'Rusk Toast', maker: 3, gst: 500, sizes: ['100g', '300g'] },
  { title: 'Instant Noodles', maker: 3, gst: 1800, sizes: ['70g', '280g'] },
  { title: 'Poha Thick', maker: 3, gst: 500, sizes: ['500g', '1kg'] },
  { title: 'Vermicelli', maker: 3, gst: 500, sizes: ['200g', '450g'] },
  { title: 'Tomato Ketchup', maker: 3, gst: 500, sizes: ['200g', '500g', '1kg'] },
  { title: 'Mixed Pickle', maker: 3, gst: 1200, sizes: ['200g', '500g'] },
  { title: 'Toned Milk', maker: 4, gst: 500, sizes: ['200ml', '500ml'] },
  { title: 'Masala Chaas', maker: 4, gst: 500, sizes: ['180ml', '500ml'] },
  { title: 'Lassi', maker: 4, gst: 500, sizes: ['180ml', '250ml'] },
  { title: 'Paneer', maker: 4, gst: 500, sizes: ['200g', '1kg'] },
  { title: 'Butter', maker: 4, gst: 1200, sizes: ['100g', '500g'] },
  { title: 'Milk Toffee', maker: 5, gst: 1800, sizes: ['Jar 100 pcs', 'Pouch 50 pcs'] },
  { title: 'Mint Candy', maker: 5, gst: 1800, sizes: ['Jar 150 pcs', 'Pouch 60 pcs'] },
  { title: 'Chocolate Bar', maker: 5, gst: 1800, sizes: ['13g', '40g', '110g'] },
  { title: 'Lollipop Assorted', maker: 5, gst: 1800, sizes: ['Box 50 pcs', 'Box 100 pcs'] },
  { title: 'Chikki Peanut', maker: 5, gst: 500, sizes: ['30g', '100g', '250g'] },
  { title: 'Soan Papdi', maker: 5, gst: 500, sizes: ['250g', '500g'] },
  { title: 'Namkeen Sev', maker: 0, gst: 500, sizes: ['50g', '200g', '400g'] },
  { title: 'Chakli', maker: 0, gst: 500, sizes: ['100g', '200g'] },
  { title: 'Orange Drink', maker: 1, gst: 500, sizes: ['200ml', '1L'] },
]

const HEADING_RATES = [500, 500, 500, 500, 500, 1800, 1800, 1800, 1200, 1200, 4000, 4000, 500]

/** The synthetic plan: invented names, the real one's shape. Pure — no database. */
export function lookalikePlan(options: LookalikeOptions): {
  plan: Plan
  suppliers: LegacySupplier[]
} {
  const rnd = seeded(`lookalike:${options.slug}`)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)] as T
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const stem = (options.hsnStem ?? '881100').slice(0, 6).padEnd(6, '0')
  const heading = (n: number): string => `${stem}${String(n + 1).padStart(2, '0')}`
  const shopCount = options.shops ?? 120

  // ------------------------------------------------------------------------------------ items (84)
  const titles: { title: string; maker: number; gst: number }[] = []
  for (const base of ITEM_BASES)
    for (const size of base.sizes) titles.push({ ...base, title: `${base.title} ${size}` })
  const items: PlannedItem[] = []
  const headingOfRate = new Map<number, number[]>()
  HEADING_RATES.forEach((rate, n) =>
    headingOfRate.set(rate, [...(headingOfRate.get(rate) ?? []), n]),
  )
  for (let i = 0; i < 84; i++) {
    const t = titles[i % titles.length] ?? { title: 'Assorted Item', maker: 0, gst: 500 }
    const title = i < titles.length ? t.title : `${t.title} Family Pack`
    const choices = headingOfRate.get(t.gst) ?? [0]
    const hsn = heading(choices[i % choices.length] ?? 0)
    // 8 items without a price (the last eight), 36 of the 76 priced ones priced at cost
    const priced = i < 76
    const salePaise = priced ? int(5, 300) * 100 : null
    const atCost = priced && i % 2 === 0 && i < 72
    const cost =
      salePaise === null ? int(4, 250) * 100 : atCost ? salePaise : Math.round(salePaise * 0.88)
    const mrpPaise = Math.round(((salePaise ?? cost) * 1.18) / 100) * 100 + 100
    items.push({
      code: `IT${String(i + 1).padStart(3, '0')}`,
      title,
      mfgName: MAKERS[t.maker] ?? 'Sahyadri Snacks',
      hsn,
      hsnAssumed: false,
      gstBps: t.gst,
      salePaise,
      mrpPaise,
      listed: priced,
      unitKind: 'each',
      purchaseRatePaise: cost,
      landedCostPaise: cost,
      supplierCode: `S${String((i % 5) + 1)}`,
      // one priced item has no stock at all (index 75): the tool must skip it, never force it
      openingQty: i === 75 ? null : int(24, 480),
    })
  }

  // ------------------------------------------------------------------------------- shops (about 120)
  const retailers: PlannedRetailer[] = []
  const used = new Set<string>()
  for (let i = 0; i < shopCount; i++) {
    let name = `${pick(SHOP_FIRST)} ${pick(SHOP_LAST)}`
    while (used.has(name)) name = `${pick(SHOP_FIRST)} ${pick(SHOP_LAST)} ${String(int(2, 9))}`
    used.add(name)
    const noPhone = i % 3 === 2
    const beat = BEATS[i % BEATS.length] ?? 'Station Road'
    retailers.push({
      code: `C${String(i + 1).padStart(4, '0')}`,
      name,
      phone: noPhone ? '' : `+9198${String(20_000_000 + i * 7919).padStart(8, '0')}`,
      altPhone: null,
      ownerName: i % 4 === 0 ? pick(OWNER_NAMES) : null,
      gstin: i % 17 === 0 ? gstin(`27ABCDE${String(1000 + i).slice(-4)}F1Z`) : null,
      pan: null,
      stateCode: '27',
      address: {
        line1: `Shop ${String(int(1, 40))}, Lane ${String(int(1, 12))}`,
        area: beat,
        pincode: '421301',
      },
      beatName: beat,
    })
  }

  // ------------------------------------------------------------------ opening bills (about 30 shops)
  const bills: PlannedBill[] = []
  const asOf = Date.parse(`${options.asOf}T00:00:00Z`)
  const dayOf = (daysAgo: number): string =>
    new Date(asOf - daysAgo * 86_400_000).toISOString().slice(0, 10)
  let billNo = 4100
  retailers.forEach((r, i) => {
    if (i % 4 !== 1) return
    const count = int(1, 3)
    for (let b = 0; b < count; b++) {
      billNo += int(3, 40)
      const original = int(800, 25_000) * 100
      const received = rnd() < 0.3 ? Math.round(original * 0.4) : 0
      const age = int(12, 170)
      bills.push({
        key: `GL|2026|${String(billNo)}`,
        bookCode: 'GL',
        salYear: '2026',
        billNo: String(billNo),
        invoiceNo: `GL/${String(billNo)}`,
        cashAcc: r.code,
        invoiceDate: dayOf(age),
        dueDate: dayOf(Math.max(0, age - 15)),
        originalPaise: original,
        receivedPaise: received,
        openPaise: original - received,
      })
    }
  })

  const suppliers: LegacySupplier[] = [0, 1, 2, 3, 4].map((n) => ({
    code: `S${String(n + 1)}`,
    name: `${MAKERS[n] ?? 'Sahyadri Snacks'} Distribution`,
    gstinRaw: gstin(`27SUPPL${String(5000 + n)}R1Z`),
    phoneRaw: `9867${String(100_000 + n * 37).padStart(6, '0')}`,
    stateCode: '27',
  }))

  const plan: Plan = {
    manufacturers: MAKERS.map((name, n) => ({ name, code: `M${String(n + 1)}` })),
    items,
    hsnRates: HEADING_RATES.map((gstBps, n) => ({
      hsn: heading(n),
      gstBps,
      items: items.filter((it) => it.hsn === heading(n)).length,
    })).filter((h) => h.items > 0),
    beats: BEATS,
    retailers,
    bills,
    issues: [],
  }
  return { plan, suppliers }
}

/**
 * Tenant row + owner + membership + `bootstrapTenant` (what `infra/docker/bootstrap.mjs` does on a
 * production database), then the writer. Idempotent: every write is keyed.
 */
export async function buildLookalikeTenant(
  db: Db,
  options: LookalikeOptions,
): Promise<LookalikeResult> {
  const ownerPhone = `+9197${createHash('sha256').update(options.slug).digest().readUInt32LE(0).toString().padStart(8, '0').slice(-8)}`
  // The owner connection, exactly as `infra/docker/bootstrap.mjs` does it on a fresh production database.
  await db
    .insert(tenants)
    .values({
      id: uuidv7(),
      slug: options.slug,
      legalName: options.legalName ?? 'Look-alike Distributors',
      stateCode: '27',
      plan: 'pilot',
    })
    .onConflictDoNothing()
  const passwordHash = await hashPassword(options.ownerPassword)
  const tenantId = await db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.slug, options.slug))
    if (!tenant) throw new Error('the tenant row did not land')
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.username, options.ownerUsername))
    const ownerId = existing?.id ?? uuidv7()
    if (!existing)
      await tx.insert(users).values({
        id: ownerId,
        phone: ownerPhone,
        name: 'Prakash Joshi',
        locale: 'en-IN',
        username: options.ownerUsername,
        passwordHash,
        passwordChangedAt: new Date(),
      })
    const [member] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.userId, ownerId)))
    if (!member)
      await tx
        .insert(memberships)
        .values({ id: uuidv7(), tenantId: tenant.id, userId: ownerId, role: 'owner' })
    return tenant.id
  })
  await bootstrapTenant(db, tenantId)
  const handle: TenantHandle = await findTenant(db, options.slug)
  const { plan, suppliers } = lookalikePlan(options)
  const write = await writePlan(db, handle, plan, {
    asOf: options.asOf,
    ratesFrom: '2025-09-22',
    openingStock: true,
    suppliers,
    log: () => undefined,
  })
  const shopsWithBills = new Set(plan.bills.map((b) => b.cashAcc)).size
  return {
    tenantId,
    ownerId: handle.ownerId,
    write,
    counts: {
      shops: plan.retailers.length,
      shopsWithoutPhone: plan.retailers.filter((r) => r.phone === '').length,
      items: plan.items.length,
      unpriced: plan.items.filter((i) => i.salePaise === null).length,
      atCost: plan.items.filter((i) => i.salePaise !== null && i.salePaise === i.purchaseRatePaise)
        .length,
      withStock: plan.items.filter((i) => (i.openingQty ?? 0) > 0).length,
      beats: plan.beats.length,
      bills: plan.bills.length,
      shopsWithBills,
      suppliers: suppliers.length,
      headings: plan.hsnRates.length,
    },
  }
}

/** A password that satisfies the product's policy (letters and digits, 20 characters). */
export function newPassword(): string {
  const raw = randomBytes(24)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
  return `${raw.slice(0, 16)}Dq7${raw.slice(16, 17) || 'x'}`
}

/** The database name in a connection string, or null. */
export function databaseName(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, '') || null
  } catch {
    return null
  }
}
