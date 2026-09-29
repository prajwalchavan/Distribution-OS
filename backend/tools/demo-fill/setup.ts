import { contract } from '@dos/contracts'
import { ApiRefusal } from './client.js'
import type { Ctx } from './context.js'
import { pages } from './helpers.js'
import { addDays, demoKey, isDemoId, unit } from './ids.js'
import {
  TESTERS,
  crewKeyOf,
  newPassword,
  personId,
  personParts,
  plainUsername,
  sortStaff,
  testerPhone,
  usernameCandidates,
  type Tester,
} from './people.js'
import {
  chooseCreditShop,
  chooseRepBeats,
  chooseSlotShops,
  creditLimitFor,
  offerShops,
  offerStep,
  slotShopsOnVans,
  type ShopInfo,
} from './plan.js'
import { readTrip } from './road.js'
import type { World } from './world.js'

/**
 * THE STANDING PIECES a day of work needs, each made once and found on every later run: the tester logins,
 * two vans, a beat for each rep, a shop over its limit on each rep's beat, an offer, and each driver's GPS
 * consent. All are made through the API as the person who would make them — the owner, the manager, or the
 * driver for his own consent.
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
 * are made by the tester manager login, so the audit log names a tester login as the one who made them: a change the
 * tool made to a REAL shop (its credit limit) is found again by who made it (`check:demo-rows`).
 */
const manager = (ctx: Ctx) => (): ReturnType<Ctx['as']> => ctx.as('manager')

// ---------------------------------------------------------------------------------------------- people

/**
 * The tester logins (brief rule 4 as decided on 2026-09-29). The crew is found by the tool's mark (`sortStaff`),
 * never by a username; a tester the crew lacks is made by the owner with a temporary password, and the person
 * then changes it to the demo password (`finishPassword`). A plain username someone else holds is never taken:
 * the next free plain one is (D5). The logins the tool made for testers before are listed as former, and
 * `switchOffFormer` switches them off at the end of the run (D6).
 */
export async function ensurePeople(ctx: Ctx, world: World, date: string): Promise<void> {
  const staff = await ctx.read(contract.tenancy.staff.list, {})
  const { crew, former } = sortStaff(ctx.tenantId, staff.items, ctx.suffix)
  ctx.former = former
  const phones = new Set([...world.staffPhones, ...world.shopPhones])
  // Every username of this distributor is someone's: the crew's own, or one the tool must not take (D5).
  const taken = new Set(staff.items.map((m) => m.username).filter((u): u is string => !!u))
  for (const t of TESTERS) {
    const member = crew.get(t.key)
    if (!member) {
      await makeTester(ctx, t, date, taken, phones)
      continue
    }
    ctx.userIds.set(t.key, member.userId)
    if (member.username) ctx.usernames.set(t.key, member.username)
    if (member.role !== t.role)
      ctx.summary.note(`${member.username ?? t.key} exists with another role (${member.role}); left alone`)
    if (member.status === 'disabled') {
      await ctx.write('people', 'login re-enabled', ctx.owner, contract.tenancy.staff.setStatus, {
        idempotencyKey: demoKey(date, 'person', member.userId, 'enable'),
        userId: member.userId,
        status: 'active',
      })
    } else ctx.summary.foundOne('people', 'tester login')
  }
  const live = former.filter((f) => f.member.status !== 'disabled')
  if (live.length > 0)
    ctx.summary.note(
      `${String(live.length)} login(s) the tool made for testers before (${live.map((f) => f.member.username ?? f.member.userId).join(', ')}) are switched off at the end of this run; their open work is finished or carried by the testers of today (D6)`,
    )
}

/**
 * Make one tester: the owner adds the login with a temporary password under the first plain username nobody
 * holds, and the person changes it to the demo password. `staff.create` looks a person up by username OR phone
 * across the whole platform and, when one matches, gives the new login to that person: an answer carrying a user id
 * that is not the tool's means the username (or the phone) belonged to someone on another distributor, whom the
 * API could not show before. That login is switched off at once and the next plain name is asked (D5).
 */
async function makeTester(
  ctx: Ctx,
  t: Tester,
  date: string,
  taken: Set<string>,
  phones: ReadonlySet<string>,
): Promise<void> {
  const plain = plainUsername(t.key, ctx.suffix)
  const userId = personId(ctx.tenantId, date, t.key, ctx.suffix)
  const said = (username: string): void => {
    if (username !== plain)
      ctx.summary.note(
        `the plain username ${plain} belongs to someone the tool did not make: its ${t.key} is ${username}`,
      )
  }
  for (const username of usernameCandidates(t.key, ctx.suffix, taken)) {
    if (!ctx.commit) {
      ctx.summary.wouldOne('people', 'tester login')
      said(username)
      return
    }
    const temporary = newPassword()
    let made: { userId: string }
    try {
      made = await ctx.api.call(ctx.owner, contract.tenancy.staff.create, {
        idempotencyKey: demoKey(date, ...personParts(t.key, ctx.suffix), 'create', username),
        id: ctx.id(date, 'membership', t.key, username),
        userId,
        username,
        name: t.name,
        phone: testerPhone(ctx.tenantId, username, phones),
        role: t.role,
        locale: 'en-IN',
        temporaryPassword: temporary,
      })
    } catch (e) {
      if (!(e instanceof ApiRefusal)) throw e
      if (e.status === 409) {
        // The username and the phone belong to two other people, or to someone already in this distributor.
        taken.add(username)
        ctx.log(`  people: ${username} is someone else's (${e.label}); the next plain name is asked`)
        continue
      }
      ctx.summary.refusedOne('people', `tester login ${t.key}`, e.label)
      return
    }
    ctx.summary.madeOne('people', 'tester login')
    taken.add(username)
    if (made.userId !== userId && crewKeyOf(ctx.tenantId, made.userId, ctx.suffix) !== t.key) {
      await ctx.write(
        'people',
        'login given to someone else switched off',
        ctx.owner,
        contract.tenancy.staff.setStatus,
        {
          idempotencyKey: demoKey(date, 'person', t.key, 'attached', made.userId),
          userId: made.userId,
          status: 'disabled',
        },
      )
      ctx.summary.note(
        `the username ${username} belongs to someone the tool did not make: the API gave them the new ${t.key} login, which the tool switched off at once`,
      )
      continue
    }
    ctx.userIds.set(t.key, made.userId)
    ctx.usernames.set(t.key, username)
    said(username)
    await ctx.finishPassword(t.key, temporary)
    return
  }
  ctx.summary.refusedOne('people', `tester login ${t.key}`, 'no free plain username')
}

/**
 * D6: the logins the tool made for testers and uses no more — the `tester.<role>` logins of the tool before
 * 2026-09-29, a crew of another login suffix — are switched off the way a staff member who left is (the owner,
 * `staff.setStatus`), after their open work was finished or carried in this run. Nobody else is touched.
 */
export async function switchOffFormer(ctx: Ctx, date: string): Promise<void> {
  for (const f of ctx.former) {
    if (f.member.status === 'disabled') continue
    await ctx.write(
      'people',
      'former tester login switched off',
      ctx.owner,
      contract.tenancy.staff.setStatus,
      {
        idempotencyKey: demoKey(date, 'person', f.member.userId, 'off'),
        userId: f.member.userId,
        status: 'disabled',
      },
    )
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
      ctx.vanIds.set(driver, have.id)
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
    if (made) {
      vans[driver] = { id: made.item.id, locationId: made.item.locationId }
      ctx.vanIds.set(driver, made.item.id)
    }
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
  // D6: a beat a former tester rep still walks is carried to the rep of today, and the former rep's assignment
  // ends the day before (`beats.assign` again, with an end date: the product's way to take a rep off a beat).
  const carried: Standing['repBeats'] = {}
  const ending: {
    id: string
    beatId: string
    userId: string
    validFrom: string
    validTo: string | null
  }[] = []
  for (const f of ctx.former.filter((x) => x.member.role === 'salesperson')) {
    const list = await ctx.read(contract.retailers.beats.assignments.list, {
      userId: f.member.userId,
      on: from,
      currentOnly: true,
    })
    for (const a of list.items) {
      ending.push(a)
      const rep = f.key === 'sales1' || f.key === 'sales2' ? f.key : null
      if (rep && !existing[rep] && !carried[rep] && world.beatIds.includes(a.beatId))
        carried[rep] = a.beatId
    }
  }
  const chosen = chooseRepBeats(world.shops, world.beatIds, { ...carried, ...existing })
  for (const rep of ['sales1', 'sales2'] as const) {
    const beatId = chosen[rep]
    const userId = ctx.userIds.get(rep)
    if (!beatId || !userId) continue
    if (existing[rep]) {
      ctx.summary.foundOne('masters', 'beat assignment')
      continue
    }
    await ctx.write('masters', 'beat assignment', manager(ctx), contract.retailers.beats.assign, {
      idempotencyKey: demoKey(from, 'beat', rep, beatId, userId),
      id: beatId,
      assignmentId: ctx.id(from, 'beat', rep, beatId, userId),
      userId,
      validFrom: from,
      validTo: null,
    })
  }
  const dayBefore = addDays(from, -1)
  for (const a of ending) {
    const validTo = a.validFrom > dayBefore ? a.validFrom : dayBefore
    if (a.validTo !== null && a.validTo <= validTo) continue
    await ctx.write('masters', 'former rep taken off a beat', manager(ctx), contract.retailers.beats.assign, {
      idempotencyKey: demoKey(from, 'beat', 'end', a.id),
      id: a.beatId,
      assignmentId: a.id,
      userId: a.userId,
      validFrom: a.validFrom,
      validTo,
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
 * One offer, "buy 12, get 1 free" on the item the godown holds most of, for the shops that stand for the
 * shopkeepers only (`offerShops`): a real shop's order is priced as it was, and the offer is the tool's to
 * see. When a stand-in shop is replaced, the live offer is moved (the same offer, its shops changed).
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
  // A shop the vans of `date` already carry as a stand-in keeps the offer until that day is over.
  const onVans = slotShopsOnVans({
    driver1: (await readTrip(ctx, ctx.tripId(date, 'driver1')))?.stops ?? null,
    driver2: (await readTrip(ctx, ctx.tripId(date, 'driver2')))?.stops ?? null,
  })
  await ensureOffer(ctx, world, date, offerShops(slotShops, onVans))
  await ensureConsents(ctx, date)
  return { repBeats, creditShops, slotShops, vans }
}
