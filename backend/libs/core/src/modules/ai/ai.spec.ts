import { and, eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@dos/domain'
import {
  aiForecasts,
  aiOrderDrafts,
  beatAssignments,
  beats,
  bootstrapTenant,
  createDb,
  createPool,
  hsnRates,
  inboundMessages,
  locations,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  products,
  productVariants,
  retailerIdentities,
  retailerLinks,
  retailers,
  routePlans,
  tenantProducts,
  tenants,
  tripStops,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { registerStubTranscript, tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { DeliveryModule, TripsService } from '../delivery/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { AiModule, parseInboundMessage, parseMessage, savingMetres } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type DraftLine = {
  lineNo: number
  rawText: string
  status: 'matched' | 'ambiguous' | 'unmatched'
  variantId: string | null
  variantName: string | null
  packSize: number | null
  qtyPcs: number
  cases: number | null
  unit: string
  confidenceBps: number
  candidates: { variantId: string; variantName: string; scoreBps: number }[]
}
type Draft = {
  id: string
  source: string
  status: string
  retailerId: string | null
  retailerName: string | null
  preview: string
  lineCount: number
  matchedLineCount: number
  unmatchedLineCount: number
  confidenceBps: number
  needsHumanConfirmation: true
  orderId: string | null
  orderNo: string | null
  createdBy: string | null
  reviewedBy: string | null
  rejectReason: string | null
  rawText: string | null
  transcript: string | null
  lines: DraftLine[]
}
type OrderDetail = {
  id: string
  orderNo: string | null
  state: string
  retailerId: string
  source: string
  totalPaise: number
  lines: { variantId: string; qtyPcs: number; lineTotalPaise: number }[]
}
type Suggestion = {
  variantId: string
  variantName: string
  locationId: string
  horizonDays: number
  expectedQtyPcs: number
  onHandPcs: number
  reorderQtyPcs: number
  reorderCases: number | null
  daysCover: number | null
  belowCover: boolean
  method: string
  confidenceBps: number
  needsHumanConfirmation: true
}
type PlanStop = {
  stopId: string
  sequence: number
  currentSequence: number | null
  retailerId: string
  retailerName: string
  lat: number | null
  lng: number | null
  distanceM: number
  etaAt: string | null
}
type Plan = {
  id: string
  tripId: string
  status: string
  method: string
  stopCount: number
  unpinnedStops: number
  totalDistanceM: number
  totalDurationS: number
  confidenceBps: number
  needsHumanConfirmation: true
  appliedAt: string | null
  appliedBy: string | null
  overridden: boolean
  stops: PlanStop[]
}

/**
 * `modules/ai` (docs/22 §8, founder 2026-09-05). What the spec is really testing is the module's one
 * rule: NOTHING HERE DECIDES ANYTHING. A parse writes a draft and never an order; a confirmed draft
 * becomes an order through `OrdersService` and is priced by the same engine as a typed one; a
 * forecast is a suggestion the godown may read and nobody may write from a request; a route plan
 * reaches the trip only through `delivery.stops.reorder`.
 *
 * NOTHING IN THIS FILE OPENS A SOCKET. `NODE_ENV=test` pins the deterministic LLM driver
 * (`platform/llm.ts`), so every parse below is the rule-based tokeniser plus the SKU matcher reading
 * this tenant's own listing — which is exactly what runs in production until the founder sets
 * `ANTHROPIC_API_KEY`.
 *
 * The three messages in the first test are the shapes a Kalyan shop actually sends: plain English,
 * Hinglish with number words, and a mixed case/pieces list.
 */
describeDb('ai (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `9${Date.now().toString().slice(-6)}`
  const tenantId = uuidv7()
  const otherTenantId = uuidv7()

  const ownerId = uuidv7()
  const managerId = uuidv7()
  const repId = uuidv7() // works beat A
  const otherRepId = uuidv7() // works beat B
  const driverId = uuidv7()
  const packerId = uuidv7()
  const shopUserId = uuidv7()
  const otherShopUserId = uuidv7()

  const beatA = uuidv7()
  const beatB = uuidv7()
  const shopA = uuidv7() // beat A, linked to shopUserId
  const shopB = uuidv7() // beat B — the rep on A must never see its drafts
  const shopC = uuidv7() // beat A, no login

  const cola1L = uuidv7()
  const cola750 = uuidv7()
  const karare = uuidv7()
  const makhana = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const otherRep: Actor = { tenantId, actorId: otherRepId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const otherShop: Actor = { tenantId, actorId: otherShopUserId, role: 'retailer' }

  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const systemCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'system' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))
  const asSystemTx = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(systemCtx, () => withTenant(db, systemCtx, fn))

  let godown = ''
  let tripId = ''
  const stopIds: string[] = []
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `ai-${run}`, legalName: 'AI test', stateCode: '27' },
      { id: otherTenantId, slug: `ai-o-${run}`, legalName: 'Other', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91931${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91931${run}2`, name: 'Manager' },
      { id: repId, phone: `+91931${run}3`, name: 'Rep A' },
      { id: otherRepId, phone: `+91931${run}4`, name: 'Rep B' },
      { id: driverId, phone: `+91931${run}5`, name: 'Driver' },
      { id: packerId, phone: `+91931${run}6`, name: 'Packer' },
      { id: shopUserId, phone: `+91931${run}7`, name: 'Shopkeeper A' },
      { id: otherShopUserId, phone: `+91931${run}8`, name: 'Shopkeeper B' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: otherRepId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: otherShopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)

    // A small, realistic catalog: two sizes of the same cola (so "campa 1L" has a near-miss to beat),
    // a chips SKU and a makhana. The tenant sells cola in 12s though the maker prints 24 (docs/17 B).
    const manufacturerId = uuidv7()
    const colaProduct = uuidv7()
    const chipsProduct = uuidv7()
    const makhanaProduct = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker ai ${run}` })
    await db.insert(products).values([
      { id: colaProduct, manufacturerId, name: 'Campa Cola', category: 'beverages' },
      { id: chipsProduct, manufacturerId, name: 'Too Yumm Karare', category: 'snacks' },
      { id: makhanaProduct, manufacturerId, name: 'MOM Makhana Peri Peri', category: 'snacks' },
    ])
    await db.insert(productVariants).values([
      {
        id: cola1L,
        productId: colaProduct,
        name: '1 L',
        netQty: 1000,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 5000,
      },
      {
        id: cola750,
        productId: colaProduct,
        name: '750 ml',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 4000,
      },
      {
        id: karare,
        productId: chipsProduct,
        name: '60 g',
        netQty: 60,
        netUnit: 'g',
        defaultCaseSize: 60,
        hsnCode: hsn,
        mrpPaise: 2000,
      },
      {
        id: makhana,
        productId: makhanaProduct,
        name: '60 g',
        netQty: 60,
        netUnit: 'g',
        defaultCaseSize: 30,
        hsnCode: hsn,
        mrpPaise: 9900,
      },
    ])
    await db.insert(tenantProducts).values([
      { id: uuidv7(), tenantId, variantId: cola1L, caseSizeOverride: 12 },
      { id: uuidv7(), tenantId, variantId: cola750, caseSizeOverride: 12 },
      { id: uuidv7(), tenantId, variantId: karare },
      { id: uuidv7(), tenantId, variantId: makhana },
    ])
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, effectiveFrom: '2020-04-01' })

    await db.insert(beats).values([
      { id: beatA, tenantId, name: `Station Road ${run}` },
      { id: beatB, tenantId, name: `Market ${run}` },
    ])
    await db.insert(beatAssignments).values([
      { id: uuidv7(), tenantId, beatId: beatA, userId: repId, validFrom: '2020-01-01' },
      { id: uuidv7(), tenantId, beatId: beatB, userId: otherRepId, validFrom: '2020-01-01' },
    ])

    const identityA = uuidv7()
    const identityB = uuidv7()
    await db.insert(retailerIdentities).values([
      { id: identityA, phone: `+91932${run}1`, userId: shopUserId, shopName: `Shop A ${run}` },
      { id: identityB, phone: `+91932${run}2`, userId: otherShopUserId, shopName: `Shop B ${run}` },
    ])
    // Coordinates put the three shops on a line 0..2 km east, so the optimal round is unambiguous
    // and a spec can assert on the sequence rather than on "it got a bit shorter".
    await db.insert(retailers).values([
      {
        id: shopA,
        tenantId,
        identityId: identityA,
        code: `A-${run}`,
        name: `Shop A ${run}`,
        phone: `+91932${run}1`,
        stateCode: '27',
        beatId: beatA,
        lat: 19.24,
        lng: 73.13,
      },
      {
        id: shopB,
        tenantId,
        identityId: identityB,
        code: `B-${run}`,
        name: `Shop B ${run}`,
        phone: `+91932${run}2`,
        stateCode: '27',
        beatId: beatB,
        lat: 19.24,
        lng: 73.15,
      },
      {
        id: shopC,
        tenantId,
        code: `C-${run}`,
        name: `Shop C ${run}`,
        phone: `+91932${run}3`,
        stateCode: '27',
        beatId: beatA,
        lat: 19.24,
        lng: 73.14,
      },
    ])
    await db.insert(retailerLinks).values([
      {
        id: uuidv7(),
        tenantId,
        identityId: identityA,
        retailerId: shopA,
        userId: shopUserId,
        linkedBy: 'rep_onboarding',
        status: 'active',
      },
      {
        id: uuidv7(),
        tenantId,
        identityId: identityB,
        retailerId: shopB,
        userId: otherShopUserId,
        linkedBy: 'rep_onboarding',
        status: 'active',
      },
    ])

    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db.insert(priceListItems).values([
      { id: uuidv7(), tenantId, priceListId, variantId: cola1L, ratePaise: 3500 },
      { id: uuidv7(), tenantId, priceListId, variantId: cola750, ratePaise: 2800 },
      { id: uuidv7(), tenantId, priceListId, variantId: karare, ratePaise: 1400 },
      { id: uuidv7(), tenantId, priceListId, variantId: makhana, ratePaise: 7000 },
    ])

    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''

    app = await bootTestApp([AiModule, OrdersModule, DeliveryModule, InventoryModule])

    // Opening stock and a fortnight of sales out of the godown, so the forecast has history to read.
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const { lot } = await inventory.findOrCreateLot(tx, {
        variantId: cola1L,
        batchNo: 'OPENING',
        mrpPaise: 5000,
      })
      await inventory.post(tx, [
        {
          lotId: lot.id,
          locationId: godown,
          qtyDelta: 600,
          reason: 'opening',
          idempotencyKey: `ai-open-${run}-cola`,
        },
      ])
      // 14 days × 12 pieces a day leaving the godown: a steady seller with thin cover.
      for (let day = 1; day <= 14; day++)
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: -12,
            reason: 'sale',
            occurredAt: new Date(Date.now() - day * 86_400_000),
            idempotencyKey: `ai-sale-${run}-${String(day)}`,
          },
        ])
      const { lot: chipsLot } = await inventory.findOrCreateLot(tx, {
        variantId: karare,
        batchNo: 'OPENING',
        mrpPaise: 2000,
      })
      await inventory.post(tx, [
        {
          lotId: chipsLot.id,
          locationId: godown,
          qtyDelta: 900,
          reason: 'opening',
          idempotencyKey: `ai-open-${run}-chips`,
        },
      ])
      // The makhana is the one that RUNS OUT: 320 in, 280 sold over the fortnight, 40 left against a
      // rate of about three a day — twelve days of cover, which is what puts it on the buyer's list.
      const { lot: makhanaLot } = await inventory.findOrCreateLot(tx, {
        variantId: makhana,
        batchNo: 'OPENING',
        mrpPaise: 9900,
      })
      await inventory.post(tx, [
        {
          lotId: makhanaLot.id,
          locationId: godown,
          qtyDelta: 320,
          reason: 'opening',
          idempotencyKey: `ai-open-${run}-makhana`,
        },
      ])
      for (let day = 1; day <= 14; day++)
        await inventory.post(tx, [
          {
            lotId: makhanaLot.id,
            locationId: godown,
            qtyDelta: -20,
            reason: 'sale',
            occurredAt: new Date(Date.now() - day * 86_400_000),
            idempotencyKey: `ai-sale-mk-${run}-${String(day)}`,
          },
        ])
    })

    // A trip with three stops in a deliberately bad order: A (0 km) → B (2 km) → C (1 km), so the
    // optimiser has something real to fix and the saving is a number, not a rounding artefact.
    const vehicleId = uuidv7()
    tripId = uuidv7()
    const vehicle = await call<{ item: { id: string; locationId: string } }>(
      app,
      owner,
      'POST',
      '/delivery/vehicles',
      {
        idempotencyKey: `ai-vehicle-${run}`,
        id: vehicleId,
        regNo: `MH-05-AI-${run.slice(-4)}`,
        name: 'Tempo AI',
        kind: 'tempo',
        capacityCases: 120,
      },
    )
    expect(vehicle.status).toBe(200)
    const created = await call<{
      item: { id: string; stops: { id: string; retailerId: string }[] }
    }>(app, owner, 'POST', '/delivery/trips', {
      idempotencyKey: `ai-trip-${run}`,
      id: tripId,
      tripDate: new Date().toISOString().slice(0, 10),
      vehicleId,
      driverId,
      stops: [
        { id: uuidv7(), sequence: 1, retailerId: shopA },
        { id: uuidv7(), sequence: 2, retailerId: shopB },
        { id: uuidv7(), sequence: 3, retailerId: shopC },
      ],
    })
    expect(created.status).toBe(200)
    const rows = await asOwner((tx) =>
      tx
        .select({ id: tripStops.id, sequence: tripStops.sequence })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(tripStops.sequence),
    )
    stopIds.push(...rows.map((r) => r.id))
    expect(stopIds).toHaveLength(3)
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // -------------------------------------------------------------------------------------------------------------
  // intake

  const draftEnglish = uuidv7()
  const draftHinglish = uuidv7()
  const draftMixed = uuidv7()
  const draftUnknown = uuidv7()

  it('reads three real shop messages into the right variants and quantities', async () => {
    // 1. plain English, cases and pieces
    const one = await call<{ item: Draft }>(app, rep, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-en-${run}`,
      id: draftEnglish,
      source: 'text',
      retailerId: shopA,
      text: '2 case campa cola 1L, 10 pc too yumm karare',
    })
    expect(one.status).toBe(200)
    expect(one.body.item.needsHumanConfirmation).toBe(true)
    expect(one.body.item.status).toBe('parsed')
    expect(one.body.item.lines).toHaveLength(2)
    const [colaLine, chipsLine] = one.body.item.lines
    expect(colaLine).toMatchObject({
      variantId: cola1L,
      status: 'matched',
      unit: 'case',
      cases: 2,
      // the TENANT'S pack size, not the manufacturer's: 2 × 12, never 2 × 24 (docs/17 B)
      qtyPcs: 24,
      packSize: 12,
    })
    expect(chipsLine).toMatchObject({
      variantId: karare,
      status: 'matched',
      unit: 'piece',
      qtyPcs: 10,
    })

    // 2. Hinglish number words and "aur" as the separator
    const two = await call<{ item: Draft }>(app, rep, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-hi-${run}`,
      id: draftHinglish,
      source: 'whatsapp',
      retailerId: shopA,
      text: 'bhai kal do peti campa cola 750ml aur teen case mom makhana peri peri bhej dena',
    })
    expect(two.status).toBe(200)
    expect(two.body.item.lines.map((l) => ({ v: l.variantId, q: l.qtyPcs, u: l.unit }))).toEqual([
      { v: cola750, q: 24, u: 'case' }, // "do peti" = 2 cases of 12
      { v: makhana, q: 90, u: 'case' }, // "teen case" = 3 × 30
    ])

    // 3. a mixed list, with a pack size that must not be read as a quantity
    const three = await call<{ item: Draft }>(app, rep, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-mix-${run}`,
      id: draftMixed,
      source: 'text',
      retailerId: shopA,
      text: 'campa cola 1L - 3 cs\n5 pcs mom makhana peri peri 60g',
    })
    expect(three.status).toBe(200)
    expect(three.body.item.lines.map((l) => ({ v: l.variantId, q: l.qtyPcs }))).toEqual([
      { v: cola1L, q: 36 },
      { v: makhana, q: 5 },
    ])
  })

  it('never creates an order, whatever the confidence', async () => {
    const orders = await asOwner((tx) =>
      tx.execute(sql`select count(*)::int as n from sales_orders where tenant_id = ${tenantId}`),
    )
    expect(Number((orders.rows[0] as { n: number }).n)).toBe(0)
  })

  it('puts an unknown SKU in needs_review with candidates, and matches nothing that is not listed', async () => {
    const res = await call<{ item: Draft }>(app, rep, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-unknown-${run}`,
      id: draftUnknown,
      source: 'whatsapp',
      retailerId: shopA,
      text: '2 case campa cola 1L, 5 pc zzqx wafers',
    })
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('needs_review')
    const unknown = res.body.item.lines[1]
    expect(unknown?.variantId).toBeNull()
    expect(unknown?.status === 'unmatched' || unknown?.status === 'ambiguous').toBe(true)
    expect(res.body.item.matchedLineCount).toBe(1)
    // The gibberish never resolves to a SKU: a candidate list is a suggestion, never a choice.
    expect(unknown?.candidates.every((c) => c.scoreBps < 6_500)).toBe(true)
  })

  it('is idempotent on the key: a replayed capture answers the first draft, never a second', async () => {
    const again = await call<{ item: Draft }>(app, rep, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-en-${run}`,
      id: draftEnglish,
      source: 'text',
      retailerId: shopA,
      text: '2 case campa cola 1L, 10 pc too yumm karare',
    })
    expect(again.status).toBe(200)
    expect(again.body.item.id).toBe(draftEnglish)
    const count = await asOwner((tx) =>
      tx.execute(
        sql`select count(*)::int as n from ai_order_drafts where tenant_id = ${tenantId} and id = ${draftEnglish}`,
      ),
    )
    expect(Number((count.rows[0] as { n: number }).n)).toBe(1)
  })

  it('transcribes a voice note with the deterministic driver and parses the transcript', async () => {
    const key = `tenant/${tenantId}/voice/${run}/note.m4a`
    registerStubTranscript(key, 'do case campa cola 1L bhej dena')
    const res = await call<{ item: Draft; transcript: string }>(
      app,
      rep,
      'POST',
      '/ai/intake/voice',
      {
        idempotencyKey: `ai-voice-${run}`,
        id: uuidv7(),
        audioObjectKey: key,
        retailerId: shopA,
        language: 'en-IN',
        durationMs: 4200,
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.transcript).toBe('do case campa cola 1L bhej dena')
    expect(res.body.item.source).toBe('voice')
    expect(res.body.item.lines[0]).toMatchObject({ variantId: cola1L, qtyPcs: 24 })
  })

  it('refuses an audio key that belongs to another distributor', async () => {
    const res = await call(app, rep, 'POST', '/ai/intake/voice', {
      idempotencyKey: `ai-voice-foreign-${run}`,
      id: uuidv7(),
      audioObjectKey: `tenant/${otherTenantId}/voice/x/note.m4a`,
      retailerId: shopA,
      language: 'en-IN',
    })
    expect(res.status).toBe(400)
  })

  // -------------------------------------------------------------------------------------------------------------
  // who sees which draft

  it('shows a rep the drafts of its own beats and none of another rep’s', async () => {
    // A draft for shop B, which is on beat B: rep A never captured it and never works that shop.
    const otherDraft = uuidv7()
    const created = await call<{ item: Draft }>(app, otherRep, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-beatb-${run}`,
      id: otherDraft,
      source: 'text',
      retailerId: shopB,
      text: '1 case campa cola 750ml',
    })
    expect(created.status).toBe(200)

    const mine = await call<{ items: Draft[] }>(app, rep, 'GET', '/ai/drafts', { limit: 50 })
    expect(mine.status).toBe(200)
    expect(mine.body.items.map((d) => d.id)).not.toContain(otherDraft)
    expect(mine.body.items.map((d) => d.id)).toContain(draftEnglish)

    // …and at the database, so RLS is the guarantee and not the query above.
    const repCtx: TenantContext = { tenantId, actorId: repId, actorRole: 'salesperson' }
    const rows = await tenantStorage.run(repCtx, () =>
      withTenant(db, repCtx, (tx) =>
        tx
          .select({ id: aiOrderDrafts.id })
          .from(aiOrderDrafts)
          .where(eq(aiOrderDrafts.id, otherDraft)),
      ),
    )
    expect(rows).toHaveLength(0)

    // The desk sees both.
    const desk = await call<{ items: Draft[] }>(app, manager, 'GET', '/ai/drafts', { limit: 50 })
    expect(desk.body.items.map((d) => d.id)).toContain(otherDraft)
  })

  it('shows a shop only its own drafts, and refuses one it captures for another shop', async () => {
    const own = await call<{ items: Draft[] }>(app, shop, 'GET', '/ai/drafts', { limit: 50 })
    expect(own.status).toBe(200)
    expect(own.body.items.every((d) => d.retailerId === shopA)).toBe(true)

    const stolen = await call(app, shop, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-steal-${run}`,
      id: uuidv7(),
      source: 'text',
      retailerId: shopB,
      text: '1 case campa cola 1L',
    })
    expect(stolen.status).toBe(403)
  })

  it('speaks for this distributor’s shop when the same shopkeeper also buys from another one', async () => {
    // The founder's own demo requirement is one identity linked to shops under SEVERAL distributors
    // (docs/22 §8, 2026-09-04), and `retailer_links_read` lets a shopkeeper read all of those rows by
    // design (it is the switch-distributor screen). So the link lookup must be scoped to the tenant
    // of the request: without the predicate the planner decided which distributor's shop a shopkeeper
    // was speaking for, which 403'd its own order here and, when no shop was named, wrote ANOTHER
    // tenant's retailer id onto a draft in this one.
    const otherTenantId = uuidv7()
    const otherShopId = uuidv7()
    await db.insert(tenants).values({
      id: otherTenantId,
      slug: `ai-other-${run}`,
      legalName: 'Another distributor',
      stateCode: '27',
    })
    await db.insert(retailers).values({
      id: otherShopId,
      tenantId: otherTenantId,
      code: `X-${run}`,
      name: `Shop X ${run}`,
      phone: `+91932${run}9`,
      stateCode: '27',
    })
    // The SAME global identity: one person, two distributors — which is exactly the shape that broke.
    const [ownLink] = await db
      .select({ identityId: retailerLinks.identityId })
      .from(retailerLinks)
      .where(eq(retailerLinks.retailerId, shopA))
      .limit(1)
    // Its id sorts BEFORE every uuidv7 (which is time-ordered), so this row wins any `order by id`
    // that is not scoped to the tenant: the test fails on the bug rather than on the row order.
    await db.insert(retailerLinks).values({
      id: `00000000-0000-7000-8000-${run.padStart(12, '0')}`,
      tenantId: otherTenantId,
      identityId: ownLink?.identityId ?? '',
      retailerId: otherShopId,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })

    // Naming its own shop is allowed...
    const named = await call<{ item: Draft }>(app, shop, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-multi-named-${run}`,
      id: uuidv7(),
      source: 'whatsapp',
      retailerId: shopA,
      text: '1 case campa cola 1L',
    })
    expect(named.status, JSON.stringify(named.body)).toBe(200)
    expect(named.body.item.retailerId).toBe(shopA)

    // ...and naming nothing resolves to the shop it holds HERE, never the one it holds elsewhere.
    const implied = await call<{ item: Draft }>(app, shop, 'POST', '/ai/intake/text', {
      idempotencyKey: `ai-parse-multi-implied-${run}`,
      id: uuidv7(),
      source: 'whatsapp',
      text: '1 case campa cola 1L',
    })
    expect(implied.status, JSON.stringify(implied.body)).toBe(200)
    expect(implied.body.item.retailerId).toBe(shopA)
  })

  it('refuses the godown and the crew every draft procedure', async () => {
    expect((await call(app, packer, 'GET', '/ai/drafts', { limit: 10 })).status).toBe(403)
    expect((await call(app, driver, 'GET', '/ai/drafts', { limit: 10 })).status).toBe(403)
  })

  it('answers 401 without a token', async () => {
    expect((await call(app, null, 'GET', '/ai/drafts', { limit: 10 })).status).toBe(401)
  })

  // -------------------------------------------------------------------------------------------------------------
  // confirm

  const confirmedOrderId = uuidv7()
  const typedOrderId = uuidv7()

  it('confirms a draft into a submitted order priced exactly like a typed one', async () => {
    const detail = await call<{ item: Draft }>(app, rep, 'GET', `/ai/drafts/${draftEnglish}`)
    expect(detail.status).toBe(200)
    const lines = detail.body.item.lines
      .filter((l) => l.variantId)
      .map((l) => ({
        id: uuidv7(),
        variantId: l.variantId as string,
        enteredQty: l.cases ?? l.qtyPcs,
        enteredUnit: l.unit,
        draftLineNo: l.lineNo,
      }))

    const res = await call<{ item: Draft; order: OrderDetail }>(
      app,
      rep,
      'POST',
      `/ai/drafts/${draftEnglish}/confirm`,
      {
        idempotencyKey: `ai-confirm-${run}`,
        id: draftEnglish,
        orderId: confirmedOrderId,
        lines,
        deviceId: `dev-${run}`,
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('confirmed')
    expect(res.body.item.orderId).toBe(confirmedOrderId)
    expect(res.body.item.reviewedBy).toBe(repId)
    // The order went through the ordinary path: it has a number and left `draft`.
    expect(res.body.order.orderNo).not.toBeNull()
    expect(['submitted', 'confirmed']).toContain(res.body.order.state)

    // The same lines typed straight into `orders.create` price to the same rupee.
    const typed = await call<{ item: OrderDetail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `ai-typed-${run}`,
      id: typedOrderId,
      retailerId: shopA,
      source: 'salesperson',
      lines: lines.map((l) => ({
        id: uuidv7(),
        variantId: l.variantId,
        enteredQty: l.enteredQty,
        enteredUnit: l.enteredUnit,
      })),
    })
    expect(typed.status).toBe(200)
    expect(res.body.order.totalPaise).toBe(typed.body.item.totalPaise)
    expect(res.body.order.lines.map((l) => l.qtyPcs)).toEqual(
      typed.body.item.lines.map((l) => l.qtyPcs),
    )
  })

  it('replays a second confirm and never creates a second order', async () => {
    const detail = await call<{ item: Draft }>(app, rep, 'GET', `/ai/drafts/${draftEnglish}`)
    const lines = detail.body.item.lines
      .filter((l) => l.variantId)
      .map((l) => ({
        id: uuidv7(),
        variantId: l.variantId as string,
        enteredQty: l.cases ?? l.qtyPcs,
        enteredUnit: l.unit,
        draftLineNo: l.lineNo,
      }))
    // Same key, same payload shape: the stored response comes back. (The line ids differ, so this
    // also proves the request hash is over the payload the CLIENT sends — a fresh replay would 409.)
    const replay = await call<{ item: Draft; order: OrderDetail }>(
      app,
      rep,
      'POST',
      `/ai/drafts/${draftEnglish}/confirm`,
      {
        idempotencyKey: `ai-confirm-replay-${run}`,
        id: draftEnglish,
        orderId: uuidv7(),
        lines,
        deviceId: `dev-${run}`,
      },
    )
    // A draft already confirmed is a clear 409 naming the order, never a second order.
    expect(replay.status).toBe(409)
    const orders = await asOwner((tx) =>
      tx.execute(
        sql`select count(*)::int as n from sales_orders where tenant_id = ${tenantId} and retailer_id = ${shopA}`,
      ),
    )
    // exactly two: the confirmed draft's order and the typed comparison order
    expect(Number((orders.rows[0] as { n: number }).n)).toBe(2)
  })

  it('refuses a shop confirming another shop’s draft', async () => {
    const res = await call(app, otherShop, 'POST', `/ai/drafts/${draftMixed}/confirm`, {
      idempotencyKey: `ai-confirm-foreign-${run}`,
      id: draftMixed,
      orderId: uuidv7(),
      lines: [{ id: uuidv7(), variantId: cola1L, enteredQty: 1, enteredUnit: 'case' }],
    })
    // 404 (RLS hid the draft) or 403 (it was visible and the shop check refused) — never 200.
    expect([403, 404]).toContain(res.status)
  })

  it('rejects a draft with a reason and refuses to reject it twice', async () => {
    const res = await call<{ item: Draft }>(
      app,
      manager,
      'POST',
      `/ai/drafts/${draftUnknown}/reject`,
      {
        idempotencyKey: `ai-reject-${run}`,
        id: draftUnknown,
        reason: 'The shop meant a brand we do not stock',
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.item).toMatchObject({
      status: 'rejected',
      rejectReason: 'The shop meant a brand we do not stock',
      reviewedBy: managerId,
    })
    const again = await call(app, manager, 'POST', `/ai/drafts/${draftUnknown}/reject`, {
      idempotencyKey: `ai-reject-2-${run}`,
      id: draftUnknown,
      reason: 'again',
    })
    expect(again.status).toBe(409)
  })

  // -------------------------------------------------------------------------------------------------------------
  // the inbound WhatsApp path

  it('turns an inbound message into a draft once, however often the relay redelivers it', async () => {
    const messageId = uuidv7()
    await db.insert(inboundMessages).values({
      id: messageId,
      tenantId,
      channel: 'whatsapp',
      from: `+91932${run}1`,
      retailerId: shopA,
      body: 'do case campa cola 1L kal bhej dena',
      handled: false,
    })
    const first = await asSystemTx((tx) => parseInboundMessage(tx, messageId))
    expect(first?.created).toBe(true)
    expect(first?.lineCount).toBe(1)
    const second = await asSystemTx((tx) => parseInboundMessage(tx, messageId))
    expect(second?.created).toBe(false)
    expect(second?.draftId).toBe(first?.draftId)

    const rows = await asOwner((tx) =>
      tx
        .select({ id: aiOrderDrafts.id })
        .from(aiOrderDrafts)
        .where(eq(aiOrderDrafts.inboundMessageId, messageId)),
    )
    expect(rows).toHaveLength(1)
  })

  // -------------------------------------------------------------------------------------------------------------
  // forecast

  it('computes reorder suggestions the godown may read, and lists what is below cover', async () => {
    const queued = await call<{ item: { status: string }; created: boolean }>(
      app,
      owner,
      'POST',
      '/ai/forecast/run',
      { idempotencyKey: `ai-forecast-${run}`, id: uuidv7(), horizonDays: 14, lookbackDays: 90 },
    )
    expect(queued.status).toBe(200)
    // Under NODE_ENV=test the pass runs inline, so the numbers are readable in the same test.
    expect(queued.body.item.status).toBe('ready')

    const list = await call<{ items: Suggestion[]; lastComputedAt: string | null }>(
      app,
      owner,
      'GET',
      '/ai/forecast',
      { horizonDays: 14, coverDays: 21, limit: 50 },
    )
    expect(list.status).toBe(200)
    expect(list.body.lastComputedAt).not.toBeNull()
    const cola = list.body.items.find((i) => i.variantId === cola1L)
    expect(cola).toBeDefined()
    // 14 days × 12 pieces over a 90-day lookback ≈ 1.87 a day → about 26 pieces over the horizon.
    expect(cola?.expectedQtyPcs).toBeGreaterThan(0)
    expect(cola?.onHandPcs).toBe(600 - 14 * 12)
    expect(cola?.daysCover).toBeGreaterThan(0)
    expect(cola?.needsHumanConfirmation).toBe(true)
    // NO MONEY on the wire, which is what lets the godown read this at all (docs/22 §9).
    for (const key of Object.keys(cola ?? {}))
      expect(key).not.toMatch(/paise|cost|margin|rate|value/i)

    // The godown reads the list; the field and the shop do not.
    expect((await call(app, packer, 'GET', '/ai/forecast', { limit: 5 })).status).toBe(200)
    expect((await call(app, rep, 'GET', '/ai/forecast', { limit: 5 })).status).toBe(403)
    expect((await call(app, shop, 'GET', '/ai/forecast', { limit: 5 })).status).toBe(403)
    // …and only the desk may ask for a pass.
    expect(
      (
        await call(app, packer, 'POST', '/ai/forecast/run', {
          idempotencyKey: `ai-forecast-packer-${run}`,
          id: uuidv7(),
        })
      ).status,
    ).toBe(403)

    // The buyer's working list at the default three weeks of cover: the makhana, which has twelve
    // days left at the rate it is selling, and not the cola, which has months.
    const below = await call<{ items: Suggestion[] }>(app, owner, 'GET', '/ai/forecast', {
      horizonDays: 14,
      coverDays: 21,
      belowCover: true,
      limit: 50,
    })
    expect(below.status).toBe(200)
    expect(below.body.items.every((i) => i.belowCover)).toBe(true)
    expect(below.body.items.map((i) => i.variantId)).toContain(makhana)
    expect(below.body.items.map((i) => i.variantId)).not.toContain(cola1L)
    // And it says how many to buy, in pieces and in cases of the tenant's own pack.
    const short = below.body.items.find((i) => i.variantId === makhana)
    expect(short?.reorderQtyPcs).toBeGreaterThan(0)
    expect(short?.reorderCases).toBe(Math.ceil((short?.reorderQtyPcs ?? 0) / 30))
  })

  it('refuses a request-path write to ai_forecasts: the table is system-only', async () => {
    const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
    await expect(
      tenantStorage.run(ctx, () =>
        withTenant(db, ctx, (tx) =>
          tx.insert(aiForecasts).values({
            id: uuidv7(),
            tenantId,
            variantId: cola1L,
            locationId: godown,
            horizonDays: 7,
            method: 'by_hand',
          }),
        ),
      ),
    ).rejects.toThrow()
  })

  // -------------------------------------------------------------------------------------------------------------
  // routing

  const planId = uuidv7()

  it('plans a shorter route than the trip holds, and writes nothing on the trip', async () => {
    const before = await asOwner((tx) =>
      tx
        .select({ id: tripStops.id, sequence: tripStops.sequence })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(tripStops.sequence),
    )

    const res = await call<{ item: Plan }>(app, owner, 'POST', `/ai/routing/trips/${tripId}/plan`, {
      idempotencyKey: `ai-plan-${run}`,
      id: planId,
      tripId,
    })
    expect(res.status).toBe(200)
    expect(res.body.item).toMatchObject({
      status: 'draft',
      method: 'nearest_neighbour_2opt',
      stopCount: 3,
      unpinnedStops: 0,
      appliedAt: null,
      overridden: false,
      needsHumanConfirmation: true,
    })
    // Every shop is pinned, so the plan is fully confident about the coordinates it had.
    expect(res.body.item.confidenceBps).toBe(10_000)
    // A → C → B beats A → B → C on three points strung out along a line.
    expect(res.body.item.stops.map((s) => s.retailerId)).toEqual([shopA, shopC, shopB])

    const after = await asOwner((tx) =>
      tx
        .select({ id: tripStops.id, sequence: tripStops.sequence })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(tripStops.sequence),
    )
    expect(after).toEqual(before)

    // The saving is real, measured with the same model on both orderings.
    const stops = await asOwner((tx) => app.get(TripsService).routingStops(tx, tripId))
    const saved = savingMetres(
      stops,
      res.body.item.stops.map((s) => ({
        stopId: s.stopId,
        seq: s.sequence,
        etaAt: s.etaAt,
        distanceM: s.distanceM,
      })),
    )
    expect(saved).toBeGreaterThan(0)
  })

  it('applies the plan through delivery’s own reorder, and only then do the stops move', async () => {
    const res = await call<{ item: Plan; stops: { id: string; sequence: number }[] }>(
      app,
      owner,
      'POST',
      `/ai/routing/trips/${tripId}/plan/apply`,
      { idempotencyKey: `ai-apply-${run}`, id: planId, tripId },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('applied')
    expect(res.body.item.appliedBy).toBe(ownerId)

    const rows = await asOwner((tx) =>
      tx
        .select({
          id: tripStops.id,
          sequence: tripStops.sequence,
          retailerId: tripStops.retailerId,
        })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(tripStops.sequence),
    )
    expect(rows.map((r) => r.retailerId)).toEqual([shopA, shopC, shopB])

    // Reading it back: still applied, and the plan is the trip's current one.
    const read = await call<{ item: Plan | null }>(
      app,
      owner,
      'GET',
      `/ai/routing/trips/${tripId}/plan`,
    )
    expect(read.body.item?.status).toBe('applied')
    expect(read.body.item?.overridden).toBe(false)
  })

  it('reads the plan as overridden once the crew re-sequences by hand', async () => {
    const rows = await asOwner((tx) =>
      tx
        .select({ id: tripStops.id, sequence: tripStops.sequence })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(tripStops.sequence),
    )
    const [first, second] = rows
    if (!first || !second) throw new Error('expected two stops')
    const res = await call(app, driver, 'POST', `/delivery/trips/${tripId}/stops/reorder`, {
      idempotencyKey: `ai-override-${run}`,
      id: tripId,
      order: [
        { stopId: first.id, sequence: second.sequence },
        { stopId: second.id, sequence: first.sequence },
      ],
    })
    expect(res.status).toBe(200)
    const read = await call<{ item: Plan | null }>(
      app,
      owner,
      'GET',
      `/ai/routing/trips/${tripId}/plan`,
    )
    expect(read.body.item?.overridden).toBe(true)
    expect(read.body.item?.status).toBe('overridden')
  })

  /**
   * `ai.routing.get` is granted to `warehouse` by the permission matrix: the van is loaded in the
   * order it will be emptied. Until migration 0035 `route_plans_read` stopped at BACK_OFFICE_ROLES,
   * so the godown's screen answered 200 with `item: null` for ever — a refusal nobody could see and
   * a screen nobody could use. The app-level check and the policy have to agree, so this case reads
   * the plan through the API as the packer AND straight out of the database under its own role.
   */
  it('lets the godown read the plan it must load the van by', async () => {
    const res = await call<{ item: Plan | null }>(
      app,
      packer,
      'GET',
      `/ai/routing/trips/${tripId}/plan`,
    )
    expect(res.status).toBe(200)
    expect(res.body.item?.id).toBe(planId)
    expect(res.body.item?.stops.length).toBeGreaterThan(0)

    const packerCtx: TenantContext = { tenantId, actorId: packerId, actorRole: 'warehouse' }
    const rows = await tenantStorage.run(packerCtx, () =>
      withTenant(db, packerCtx, (tx) =>
        tx.select({ id: routePlans.id }).from(routePlans).where(eq(routePlans.id, planId)),
      ),
    )
    expect(rows.map((r) => r.id)).toEqual([planId])
  })

  /**
   * `ai.routing.plan` is granted to `delivery`, and the crew's row is written AS THE CREW — not
   * escalated to `system`. Migration 0035 added the crew-of-this-trip branch to `route_plans_insert`
   * (the same one the read and update policies already carried), so the database refuses a driver
   * who is not on the trip on its own, rather than trusting the two application checks above it.
   */
  it('lets the crew of the trip ask for a plan, written under its own role', async () => {
    const id = uuidv7()
    const res = await call<{ item: Plan }>(
      app,
      driver,
      'POST',
      `/ai/routing/trips/${tripId}/plan`,
      { idempotencyKey: `ai-plan-crew-${run}`, id, tripId },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.id).toBe(id)

    // Written by the driver, and refused to a driver who is not on this trip: the policy, not the code.
    const strangerCtx: TenantContext = { tenantId, actorId: uuidv7(), actorRole: 'delivery' }
    await expect(
      tenantStorage.run(strangerCtx, () =>
        withTenant(db, strangerCtx, (tx) =>
          tx.insert(routePlans).values({
            id: uuidv7(),
            tenantId,
            tripId,
            method: 'manual',
            sequence: [],
          }),
        ),
      ),
    ).rejects.toThrow()
  })

  it('refuses a rep and a shop every routing procedure', async () => {
    expect(
      (
        await call(app, rep, 'POST', `/ai/routing/trips/${tripId}/plan`, {
          idempotencyKey: `ai-plan-rep-${run}`,
          id: uuidv7(),
          tripId,
        })
      ).status,
    ).toBe(403)
    expect((await call(app, shop, 'GET', `/ai/routing/trips/${tripId}/plan`)).status).toBe(403)
  })

  it('hides another distributor’s drafts, forecasts and plans entirely', async () => {
    const stranger: Actor = { tenantId: otherTenantId, actorId: ownerId, role: 'owner' }
    expect(
      (await call<{ items: Draft[] }>(app, stranger, 'GET', '/ai/drafts', { limit: 50 })).body
        .items,
    ).toEqual([])
    expect(
      (await call<{ items: Suggestion[] }>(app, stranger, 'GET', '/ai/forecast', { limit: 50 }))
        .body.items,
    ).toEqual([])
    expect((await call(app, stranger, 'GET', `/ai/routing/trips/${tripId}/plan`)).status).toBe(404)

    // At the database too, so RLS is the guarantee.
    const ctx: TenantContext = { tenantId: otherTenantId, actorId: ownerId, actorRole: 'owner' }
    const rows = await tenantStorage.run(ctx, () =>
      withTenant(db, ctx, (tx) =>
        tx.select({ id: routePlans.id }).from(routePlans).where(eq(routePlans.id, planId)),
      ),
    )
    expect(rows).toHaveLength(0)
  })

  // -------------------------------------------------------------------------------------------------------------
  // the tokeniser, without a database

  it('reads the quantity, the unit and the product out of a shopkeeper’s sentence', () => {
    expect(parseMessage('bhai kal 5 case mom makhana bhej dena', 60)).toEqual([
      {
        rawText: 'bhai kal 5 case mom makhana bhej dena',
        phrase: 'mom makhana',
        qty: 5,
        unit: 'case',
        qtyStated: true,
        unitStated: true,
      },
    ])
    // "1 L" is a pack size, not a count: the quantity is the 3.
    const [line] = parseMessage('campa 1L 3 cs', 60)
    expect(line).toMatchObject({ qty: 3, unit: 'case', phrase: 'campa 1 l' })
    // A message with no order in it produces no lines rather than a phantom one.
    expect(parseMessage('thanks bhai', 60)).toEqual([])
  })

  it('keeps every idempotency guarantee the definition of done asks for', async () => {
    // same key, DIFFERENT payload → 409 (a client bug, never a silent second draft)
    const key = `ai-clash-${run}`
    const first = await call(app, rep, 'POST', '/ai/intake/text', {
      idempotencyKey: key,
      id: uuidv7(),
      source: 'text',
      retailerId: shopA,
      text: '1 case campa cola 1L',
    })
    expect(first.status).toBe(200)
    const clash = await call(app, rep, 'POST', '/ai/intake/text', {
      idempotencyKey: key,
      id: uuidv7(),
      source: 'text',
      retailerId: shopA,
      text: '9 case campa cola 1L',
    })
    expect(clash.status).toBe(409)
  })

  it('never lets a draft reach confirmed without a human, at the database', async () => {
    await expect(
      asSystemTx((tx) =>
        tx
          .update(aiOrderDrafts)
          .set({ status: 'confirmed' })
          .where(and(eq(aiOrderDrafts.id, draftHinglish), eq(aiOrderDrafts.tenantId, tenantId))),
      ),
    ).rejects.toThrow()
  })
})
