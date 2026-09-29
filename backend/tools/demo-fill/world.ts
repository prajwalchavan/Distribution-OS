import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { isDemoId } from './ids.js'
import type { ItemInfo, ShopInfo } from './plan.js'

/**
 * WHAT THE API SAYS ABOUT THE DISTRIBUTOR, read as the owner through the same list procedures the apps use.
 * Nothing here writes. The plan is made from this and nothing else.
 */
export interface World {
  shops: ShopInfo[]
  beatIds: string[]
  items: ItemInfo[]
  godownId: string
  damagedId: string | null
  suppliers: { id: string; active: boolean }[]
  staffPhones: Set<string>
  shopPhones: Set<string>
  vehicles: { id: string; regNo: string; locationId: string; active: boolean }[]
}

/** Every page of a cursor list. */
async function allPages<T>(
  fetch: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  cap = 50,
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < cap; page++) {
    const r = await fetch(cursor)
    out.push(...r.items)
    if (!r.nextCursor) break
    cursor = r.nextCursor
  }
  return out
}

/** The most rows one read of the costs register answers (the procedure has no cursor). */
export const COSTS_PAGE = 500

/**
 * Each item's purchase rate: its item-level row of the costs register (no lot). The register answers its
 * newest rows first and has no cursor, and every goods receipt adds a row per lot, so after months of them
 * the item-level rows fall off one read: when the first read comes back full, each item still without a rate
 * is read on its own (`variantId`).
 */
export async function itemCosts(
  ctx: Pick<Ctx, 'read'>,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  const costOf = new Map<string, number>()
  const take = (
    items: readonly { variantId: string; lotId: string | null; purchaseRatePaise: number }[],
  ) => {
    for (const c of items) if (c.lotId === null) costOf.set(c.variantId, c.purchaseRatePaise)
  }
  const first = await ctx.read(contract.tenantCatalog.costs, { limit: COSTS_PAGE })
  take(first.items)
  if (first.items.length < COSTS_PAGE) return costOf
  for (const variantId of variantIds) {
    if (costOf.has(variantId)) continue
    const one = await ctx.read(contract.tenantCatalog.costs, { variantId, limit: COSTS_PAGE })
    take(one.items)
  }
  return costOf
}

/**
 * Whose money is where (rule 3b), per shop: what the tool's own receipts hold on account, what the shop owes on
 * bills the tool did not make, and which shops have a bill written off. The product applies money on account to
 * a shop's oldest open bills by itself (DOS-312) and recovers write-offs first (DOS-311), so the plan needs these
 * to keep real money off the tool's bills and the tool's money off real bills.
 */
export async function moneyOfShops(ctx: Pick<Ctx, 'read'>): Promise<{
  toolOnAccount: Map<string, number>
  foreignOpen: Map<string, number>
  writtenOff: Set<string>
}> {
  const toolOnAccount = new Map<string, number>()
  const unallocated = await allPages((cursor) =>
    ctx.read(contract.receivables.receipts.list, {
      unallocatedOnly: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  for (const r of unallocated)
    if (isDemoId(r.id) && r.unallocatedPaise > 0)
      toolOnAccount.set(r.retailerId, (toolOnAccount.get(r.retailerId) ?? 0) + r.unallocatedPaise)
  const foreignOpen = new Map<string, number>()
  const open = await allPages((cursor) =>
    ctx.read(contract.billing.invoices.list, {
      openOnly: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  for (const b of open)
    if (!isDemoId(b.orderId) && b.amountDuePaise > 0)
      foreignOpen.set(b.retailerId, (foreignOpen.get(b.retailerId) ?? 0) + b.amountDuePaise)
  const writtenOff = new Set<string>()
  const written = await allPages((cursor) =>
    ctx.read(contract.billing.invoices.list, {
      state: 'written_off',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  for (const b of written) writtenOff.add(b.retailerId)
  return { toolOnAccount, foreignOpen, writtenOff }
}

export async function readWorld(ctx: Ctx): Promise<World> {
  const shopsRaw = await allPages((cursor) =>
    ctx.read(contract.retailers.list, {
      limit: 500,
      activeOnly: true,
      ...(cursor ? { cursor } : {}),
    }),
  )
  const owing = await allPages((cursor) =>
    ctx.read(contract.receivables.outstanding.list, {
      limit: 200,
      sort: 'outstanding',
      ...(cursor ? { cursor } : {}),
    }),
  )
  const owes = new Map(owing.map((o) => [o.retailerId, o.outstandingPaise]))
  const money = await moneyOfShops(ctx)
  const onAccount = new Map(owing.map((o) => [o.retailerId, o.unallocatedCreditPaise]))
  const shops: ShopInfo[] = shopsRaw.map((r) => {
    const staff = 'code' in r ? r : null
    return {
      id: r.id,
      beatId: r.beatId,
      active: r.active,
      hasLogin: staff?.identityId !== null && staff?.identityId !== undefined,
      hasPhone: r.phone.length > 0,
      creditMode: staff?.creditMode ?? 'indicate',
      creditLimitPaise: staff?.creditLimitPaise ?? 0,
      paymentTerms: r.paymentTerms,
      outstandingPaise: owes.get(r.id) ?? 0,
      foreignOnAccountPaise: Math.max(
        0,
        (onAccount.get(r.id) ?? 0) - (money.toolOnAccount.get(r.id) ?? 0),
      ),
      foreignOpenPaise: money.foreignOpen.get(r.id) ?? 0,
      writtenOff: money.writtenOff.has(r.id),
      toolOnAccountPaise: money.toolOnAccount.get(r.id) ?? 0,
    }
  })
  const beats = await ctx.read(contract.retailers.beats.list, { activeOnly: true })
  const catalog = await allPages((cursor) =>
    ctx.read(contract.tenantCatalog.list, {
      listedOnly: true,
      limit: 500,
      ...(cursor ? { cursor } : {}),
    }),
  )
  const locations = await ctx.read(contract.inventory.locations.list, { activeOnly: true })
  const godown = locations.items
    .filter((l) => l.kind === 'warehouse')
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  if (!godown) throw new Error('the distributor has no active godown')
  const damaged = locations.items.find((l) => l.kind === 'damaged') ?? null
  const sellable = await allPages((cursor) =>
    ctx.read(contract.inventory.stock.sellable, {
      locationId: godown.id,
      limit: 500,
      ...(cursor ? { cursor } : {}),
    }),
  )
  const available = new Map<string, number>()
  for (const row of sellable)
    available.set(row.variantId, (available.get(row.variantId) ?? 0) + row.available)
  // One rate per item, off the price list, for a shop of the distributor: the pool of priced items.
  const refShop = shops[0]
  const rates = refShop
    ? await ctx.read(contract.pricing.rates, { retailerId: refShop.id })
    : { items: [] }
  const rateOf = new Map(rates.items.map((r) => [r.variantId, r.listRatePaise]))
  const costOf = await itemCosts(
    ctx,
    catalog.map((c) => c.variantId),
  )
  const hsnCodes = [...new Set(catalog.map((c) => c.hsnCode).filter((h) => /^\d{4,8}$/.test(h)))]
  const gstOf = new Map<string, number>()
  for (let at = 0; at < hsnCodes.length; at += 50) {
    const chunk = hsnCodes.slice(at, at + 50)
    const rows = await ctx.read(contract.catalog.hsnRates, { codes: chunk.join(',') })
    for (const r of rows.items) gstOf.set(r.hsnCode, r.gstBps)
  }
  const items: ItemInfo[] = catalog.map((c) => ({
    variantId: c.variantId,
    ratePaise: rateOf.get(c.variantId) ?? 0,
    available: available.get(c.variantId) ?? 0,
    minOrderQty: c.minOrderQty,
    orderIncrement: c.orderIncrement,
    maxPerOrder: c.maxPerOrder,
    costPaise: costOf.get(c.variantId) ?? null,
    mrpPaise: c.mrpPaise,
    gstBps: gstOf.get(c.hsnCode) ?? null,
    hsnCode: c.hsnCode,
  }))
  const suppliers = await ctx.read(contract.tenantCatalog.suppliers, {})
  const staff = await ctx.read(contract.tenancy.staff.list, {})
  const vehicles = await ctx.read(contract.delivery.vehicles.list, { activeOnly: false })
  return {
    shops,
    beatIds: beats.items.map((b) => b.id),
    items,
    godownId: godown.id,
    damagedId: damaged?.id ?? null,
    suppliers: suppliers.items.map((s) => ({ id: s.id, active: s.active })),
    staffPhones: new Set(staff.items.map((m) => m.phone)),
    shopPhones: new Set(shopsRaw.map((r) => r.phone).filter((p) => p.length > 0)),
    vehicles: vehicles.items.map((v) => ({
      id: v.id,
      regNo: v.regNo,
      locationId: v.locationId,
      active: v.active,
    })),
  }
}
