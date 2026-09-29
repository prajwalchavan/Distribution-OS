import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { pages } from './helpers.js'
import { addDays, demoKey, isDemoId, unit } from './ids.js'
import { newPassword, testerPhone } from './people.js'
import {
  chooseCreditShop,
  chooseRepBeats,
  chooseSlotShops,
  creditLimitFor,
  offerStep,
  type ShopInfo,
} from './plan.js'
import type { World } from './world.js'

/**
 * THE STANDING PIECES a day of work needs, each made once and found on every later run: the tester logins,
 * two vans, a beat for each rep, a shop over its limit on each rep's beat, an offer, and each driver's GPS
 * consent. All are made through the API as the person who would make them — the owner, or the driver for his
 * own consent.
 */
export interface Standing {
  repBeats: Partial<Record<'sales1' | 'sales2', string>>
  creditShops: Partial<Record<'sales1' | 'sales2', string>>
  slotShops: string[]
  vans: Partial<Record<'driver1' | 'driver2', { id: string; locationId: string }>>
}

export const GPS_NOTICE_VERSION = 'gps-notice-2026-09'

/** The two vans' registration numbers: Kalyan's RTO series, a number that is the tenant's own. */
export function vanRegNo(tenantId: string, n: 1 | 2): string {
  const num = 1000 + Math.floor(unit(`van:${tenantId}:${String(n)}`) * 8999)
  return `MH05${n === 1 ? 'FJ' : 'FK'}${String(num)}`
}

/**
 * The standing changes a manager makes in the app — a van, a rep on a beat, a shop's credit limit, an offer —
 * are made by `tester.manager`, so the audit log names a tester login as the one who made them: a change the
 * tool made to a REAL shop (its credit limit) is found again by who made it (`check:demo-rows`).
 */
const manager = (ctx: Ctx) => (): ReturnType<Ctx['as']> => ctx.as('manager')

// ---------------------------------------------------------------------------------------------- people

export async function ensurePeople(ctx: Ctx, world: World, date: string): Promise<void> {
  const staff = await ctx.read(contract.tenancy.staff.list, {})
  const taken = new Set([...world.staffPhones, ...world.shopPhones])
  for (const t of ctx.testers) {
    const member = staff.items.find((m) => m.username === t.username)
    if (member) {
      ctx.userIds.set(t.key, member.userId)
      if (member.role !== t.role)
        ctx.summary.note(`${t.username} exists with another role (${member.role}); left alone`)
      if (member.status === 'disabled') {
        await ctx.write('people', 'login re-enabled', ctx.owner, contract.tenancy.staff.setStatus, {
          idempotencyKey: demoKey(date, 'person', t.username, 'enable'),
          userId: member.userId,
          status: 'active',
        })
      } else ctx.summary.foundOne('people', 'tester login')
      continue
    }
    const temporary = newPassword()
    const userId = ctx.id(date, 'person', t.username)
    const made = await ctx.write(
      'people',
      'tester login',
      ctx.owner,
      contract.tenancy.staff.create,
      {
        idempotencyKey: demoKey(date, 'person', t.username, 'create'),
        id: ctx.id(date, 'membership', t.username),
        userId,
        username: t.username,
        name: t.name,
        phone: testerPhone(ctx.tenantId, t.username, taken),
        role: t.role,
        locale: 'en-IN',
        temporaryPassword: temporary,
      },
    )
    if (!made) continue
    ctx.userIds.set(t.key, made.userId)
    if (made.userId !== userId)
      ctx.summary.note(
        `${t.username}: the API attached the login to an existing person ${made.userId}`,
      )
    const final = ctx.logins.get(t.username)?.password ?? newPassword()
    await ctx.finishPassword(t, temporary, final)
  }
}

// ----------------------------------------------------------------------------------------------- vans

async function ensureVans(ctx: Ctx, world: World, date: string): Promise<Standing['vans']> {
  const vans: Standing['vans'] = {}
  for (const n of [1, 2] as const) {
    const regNo = vanRegNo(ctx.tenantId, n)
    const have = world.vehicles.find((v) => v.regNo === regNo)
    const driver = n === 1 ? 'driver1' : 'driver2'
    if (have) {
      ctx.summary.foundOne('masters', 'van')
      vans[driver] = { id: have.id, locationId: have.locationId }
      continue
    }
    const made = await ctx.write(
      'masters',
      'van',
      manager(ctx),
      contract.delivery.vehicles.upsert,
      {
        idempotencyKey: demoKey(date, 'van', regNo),
        id: ctx.id(date, 'van', regNo),
        regNo,
        name: n === 1 ? 'Tata Ace' : 'Mahindra Supro',
        kind: 'tempo',
        capacityCases: 120,
        active: true,
      },
    )
    if (made) vans[driver] = { id: made.item.id, locationId: made.item.locationId }
  }
  return vans
}

// --------------------------------------------------------------------------------- beats and credit

async function ensureRepBeats(ctx: Ctx, world: World, from: string): Promise<Standing['repBeats']> {
  const existing: Standing['repBeats'] = {}
  for (const rep of ['sales1', 'sales2'] as const) {
    const userId = ctx.userIds.get(rep)
    if (!userId) continue
    const list = await ctx.read(contract.retailers.beats.assignments.list, {
      userId,
      on: from,
      currentOnly: true,
    })
    const first = list.items.find((a) => world.beatIds.includes(a.beatId))
    if (first) existing[rep] = first.beatId
  }
  const chosen = chooseRepBeats(world.shops, world.beatIds, existing)
  for (const rep of ['sales1', 'sales2'] as const) {
    const beatId = chosen[rep]
    const userId = ctx.userIds.get(rep)
    if (!beatId || !userId) continue
    if (existing[rep]) {
      ctx.summary.foundOne('masters', 'beat assignment')
      continue
    }
    await ctx.write('masters', 'beat assignment', manager(ctx), contract.retailers.beats.assign, {
      idempotencyKey: demoKey(from, 'beat', rep, beatId),
      id: beatId,
      assignmentId: ctx.id(from, 'beat', rep, beatId),
      userId,
      validFrom: from,
      validTo: null,
    })
  }
  return chosen
}

async function ensureCreditShops(
  ctx: Ctx,
  world: World,
  date: string,
  repBeats: Standing['repBeats'],
): Promise<Standing['creditShops']> {
  const out: Standing['creditShops'] = {}
  const chosenSoFar = new Set<string>()
  for (const rep of ['sales1', 'sales2'] as const) {
    const shop: ShopInfo | null = chooseCreditShop(world.shops, repBeats[rep], chosenSoFar)
    if (!shop) {
      ctx.summary.note(`no shop on ${rep}'s beat owes money: no shop is over its limit there`)
      continue
    }
    chosenSoFar.add(shop.id)
    out[rep] = shop.id
    const over =
      (shop.creditMode === 'strict' || shop.creditMode === 'stop') &&
      shop.outstandingPaise > shop.creditLimitPaise
    if (over) {
      ctx.summary.foundOne('masters', 'shop over its limit')
      continue
    }
    const current = await ctx.read(contract.retailers.get, { id: shop.id })
    const r = current.item
    if (!('code' in r)) continue
    const limit = creditLimitFor(shop.outstandingPaise)
    await ctx.write('masters', 'shop over its limit', manager(ctx), contract.retailers.setCredit, {
      idempotencyKey: demoKey(date, 'credit', shop.id, String(limit)),
      id: shop.id,
      tier: r.tier,
      creditLimitPaise: limit,
      creditLimitBills: 0,
      creditDays: r.creditDays,
      creditMode: 'strict',
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------- offer

/**
 * One offer, "buy 12, get 1 free" on the item the godown holds most of, for the three shops that stand for
 * the shopkeepers only: a real shop's order is priced as it was, and the offer is the tool's to see. When a
 * stand-in shop is replaced, the live offer is moved to today's three (the same offer, its shops changed).
 */
async function ensureOffer(
  ctx: Ctx,
  world: World,
  date: string,
  shops: readonly string[],
): Promise<void> {
  const live = await pages(
    (cursor) =>
      ctx.read(contract.pricing.schemes.list, {
        activeOnly: true,
        on: date,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      }),
    10,
  )
  const step = offerStep(
    live.map((s) => ({ id: s.id, retailerIds: s.applicability.retailerIds })),
    shops,
    isDemoId,
  )
  if (step.kind === 'none') {
    ctx.summary.note('no shop can stand in for the shopkeepers: no offer is made or moved')
    return
  }
  if (step.kind === 'keep') {
    ctx.summary.foundOne('masters', 'offer')
    return
  }
  if (step.kind === 'move') {
    const s = live.find((x) => x.id === step.id)
    if (!s) return
    const to = [...shops].sort()
    // The same offer, as the back office reads it, with only its shops changed; the dates stay its own.
    const back = 'fundingSource' in s ? s : null
    await ctx.write('masters', 'offer moved', manager(ctx), contract.pricing.schemes.upsert, {
      idempotencyKey: demoKey(date, 'offer', s.id, 'shops', ...to),
      id: s.id,
      name: s.name,
      brandId: s.brandId,
      scope: s.scope,
      triggerKind: s.triggerKind,
      triggerMin: s.triggerMin,
      triggerUnit: s.triggerUnit,
      slabs: s.slabs,
      rewardKind: s.rewardKind,
      rewardValue: s.rewardValue,
      freeVariantId: s.freeVariantId,
      applicability: { ...s.applicability, retailerIds: to },
      validFrom: s.validFrom,
      validTo: s.validTo,
      stackable: s.stackable,
      final: s.final,
      gstOnFreeGoods: s.gstOnFreeGoods,
      pricingDateMode: s.pricingDateMode,
      fundingSource: back?.fundingSource ?? 'distributor',
      claimable: back?.claimable ?? false,
      claimWindowDays: back?.claimWindowDays ?? null,
      sourceRef: back?.sourceRef ?? null,
      active: true,
    })
    return
  }
  // The priced item the godown holds most of: "buy 12, get 1 free" of the same item.
  const item = [...world.items]
    .filter((i) => i.ratePaise > 0 && i.available >= 60)
    .sort((a, b) => b.available - a.available || a.variantId.localeCompare(b.variantId))[0]
  if (!item) {
    ctx.summary.note('no priced item with stock for an offer')
    return
  }
  await ctx.write('masters', 'offer', manager(ctx), contract.pricing.schemes.upsert, {
    idempotencyKey: demoKey(date, 'offer', item.variantId),
    id: ctx.id(date, 'offer', item.variantId),
    name: 'Buy 12, get 1 free',
    scope: { variantIds: [item.variantId] },
    triggerKind: 'qty',
    triggerMin: 12,
    triggerUnit: 'pcs',
    rewardKind: 'free_qty',
    rewardValue: 1,
    freeVariantId: item.variantId,
    applicability: { retailerIds: [...shops] },
    validFrom: date,
    validTo: addDays(date, 30),
    fundingSource: 'distributor',
  })
}

// ------------------------------------------------------------------------------------------- consent

async function ensureConsents(ctx: Ctx, date: string): Promise<void> {
  for (const key of ['driver1', 'driver2'] as const) {
    const userId = ctx.userIds.get(key)
    if (!userId) continue
    const have = await ctx.read(contract.delivery.consents.get, { userId })
    if (have.item?.granted && have.item.withdrawnAt === null) {
      ctx.summary.foundOne('masters', 'gps consent')
      continue
    }
    await ctx.write('masters', 'gps consent', () => ctx.as(key), contract.delivery.consents.grant, {
      idempotencyKey: demoKey(date, 'consent', key),
      id: ctx.id(date, 'consent', key),
      granted: true,
      noticeVersion: GPS_NOTICE_VERSION,
      locale: 'en-IN',
    })
  }
}

// ---------------------------------------------------------------------------------------------- all

export async function ensureStanding(
  ctx: Ctx,
  world: World,
  date: string,
  earliest: string,
): Promise<Standing> {
  await ensurePeople(ctx, world, date)
  const vans = await ensureVans(ctx, world, date)
  const repBeats = await ensureRepBeats(ctx, world, earliest)
  const creditShops = await ensureCreditShops(ctx, world, date, repBeats)
  const slotShops = chooseSlotShops(ctx.tenantId, world.shops, new Set(Object.values(creditShops)))
  await ensureOffer(ctx, world, date, slotShops)
  await ensureConsents(ctx, date)
  return { repBeats, creditShops, slotShops, vans }
}
