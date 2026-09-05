/** Beats, retailers, a handful of app-linked retailer identities, and beat coverage. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { insertMany } from './db-helpers.js'
import {
  beatAssignments,
  beats,
  externalPartyCodes,
  numberingSeries,
  pjp,
  retailerIdentities,
  retailerLinks,
  retailers,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { shortKey, type PeopleResult, type PersonRef } from './people.js'
import { demoId } from './ids.js'
import { atIstTime, daysAgo, FY, jitter, makeGstin, makeRng, nth } from './util.js'

const ONBOARDED_AT = atIstTime(daysAgo(90), 11, 0)

export type Tier = 'A' | 'B' | 'C' | 'D'

export interface RetailerRow {
  id: string
  code: string
  name: string
  ownerName: string
  tier: Tier
  beatKey: string
  beatIndex: number
  seqInBeat: number
  creditLimitPaise: number
  creditDays: number
  creditMode: 'indicate' | 'strict' | 'stop'
  paymentTerms: 'PRE' | 'ON' | 'POST_FULFILLMENT'
  cashDiscountBps: number
  cashDiscountDays: number
  phone: string
  gstin: string | null
  lat: number
  lng: number
}

export interface RetailersResult {
  beats: { id: string; key: string; name: string }[]
  retailers: RetailerRow[]
  /** Retailer codes that got a retailer_identity + retailer_link. */
  linkedRetailerCodes: string[]
}

/**
 * One shop that two (or three) distributors both sell to. In the database that is ONE
 * `retailer_identities` row — the shop, its phone, its GSTIN, the shopkeeper's platform user — with a
 * `retailers` row and a `retailer_links` row PER TENANT, because each distributor keeps its own code,
 * tier, credit terms and beat for the same shop. Founder requirement (docs/22 §8, 2026-09-04):
 * "shops linked to more than one distributor".
 */
export interface SharedShop {
  /** The identity row already written by the distributor that onboarded the shop first. */
  identityId: string
  phone: string
  shopName: string
  ownerName: string
  gstin: string | null
  /** The shopkeeper's platform user, when the shop signs in to the retailer app. */
  userId: string | null
}

/** One distributor's shop network: its beats, its shops, and which of them another tenant also sells to. */
export interface RetailerNetwork {
  beats: readonly { key: string; name: string; visitDays: number[] }[]
  area: string
  city: string
  pincode: string
  stateCode: string
  centre: { lat: number; lng: number }
  names: readonly string[]
  /** Shops per beat; `names.length` must be `beats.length * perBeat`. */
  perBeat: number
  /** Retailer code prefix, also the `RET` numbering-series prefix, e.g. `R-`. */
  codePrefix: string
  /** First shop phone: `+9182` + this number, zero-padded to eight digits, one per shop. */
  phoneSeed: number
  /** PAN-shaped stem the GSTIN check digit is computed from. */
  gstinPanStem: string
  rngSeed: string
  /** Shops that get a `retailer_identity` + `retailer_link` (i.e. exist on the retailer app). */
  linkedIndices: readonly number[]
  /**
   * Shops with a GSTIN. Deliberately separate from `linkedIndices`: a shop can be on the app without
   * being registered, and putting more shops on the app must never rewrite a shop's tax status —
   * which would change tax already computed on invoices the seed wrote on an earlier run.
   */
  registeredIndices: readonly number[]
  /** Of the linked shops, the ones that also get a users row + membership (matched positionally to
   *  the roster's `retailerUsers`). */
  appLoginIndices: readonly number[]
  /** Shops that get an external (FieldAssist) outlet code. */
  externalCodeIndices: readonly number[]
  /** Shop index -> the same physical shop, already on another distributor's books. */
  shared?: Readonly<Record<number, SharedShop>>
}

const TARSUN_BEATS = [
  { key: 'station-road', name: 'Station Road', visitDays: [1, 4] },
  { key: 'kalyan-west-market', name: 'Kalyan West Market', visitDays: [2, 5] },
  { key: 'khadakpada', name: 'Khadakpada', visitDays: [3, 6] },
  { key: 'godrej-hill', name: 'Godrej Hill', visitDays: [1, 3, 5] },
]

const TARSUN_RETAILER_NAMES = [
  'Shree Ganesh Kirana',
  'Om Sai Provision Store',
  'Mahalaxmi General Stores',
  'Sharma Kirana Stores',
  'Jai Bhavani Stores',
  'Shivshakti Traders',
  'Ganesh General Store',
  'Krishna Kirana Stores',
  'Ambika Provision Store',
  'Balaji Stores',
  'Sai Baba Kirana',
  'Vitthal Traders',
  'Laxmi Narayan Stores',
  'Ekvira Kirana',
  'Ganpati General Stores',
  'Navjeevan Stores',
  'Deshmukh Kirana',
  'Patil General Store',
  'More Provision Store',
  'Joshi Kirana Stores',
  'Kadam Stores',
  'Pawar General Store',
  'Bhosale Traders',
  'Chavan Kirana Stores',
  'Yadav General Store',
  'Mishra Provision Store',
  'Gupta Kirana Stores',
  'Singh General Store',
  'Iyer Provision Store',
  'Reddy Traders',
  'Khan General Store',
  'Ansari Kirana Stores',
  'New Bombay Stores',
  'City Light Provision',
  'Metro Kirana Bazar',
  'Friends Corner Stores',
]

/**
 * The pilot distributor's network: 36 shops over four Kalyan West beats. The first ten are also on
 * Sai Distributors' books (and the first five on Kalyan Agencies' as well), which is why all ten are
 * on the app: a shop can only be shared through its identity row.
 */
export const TARSUN_NETWORK: RetailerNetwork = {
  beats: TARSUN_BEATS,
  area: 'Kalyan West',
  city: 'Kalyan',
  pincode: '421301',
  stateCode: '27',
  centre: { lat: 19.24, lng: 73.13 },
  names: TARSUN_RETAILER_NAMES,
  perBeat: 9,
  codePrefix: 'R-',
  phoneSeed: 2_000_001,
  gstinPanStem: 'AAKPT',
  rngSeed: 'dos-demo:retailers',
  linkedIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 18, 27],
  registeredIndices: [0, 4, 9, 13, 18, 27],
  appLoginIndices: [0, 9],
  externalCodeIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
}

/** [A,B,B,B,C,C,C,D,D] repeated per beat -> 4 A / 12 B / 12 C / 8 D across 36 retailers. */
const TIER_PATTERN: Tier[] = ['A', 'B', 'B', 'B', 'C', 'C', 'C', 'D', 'D']

const TIER_ECONOMICS: Record<
  Tier,
  {
    creditLimitPaise: number
    creditDays: number
    creditMode: 'indicate' | 'strict' | 'stop'
    paymentTerms: 'PRE' | 'ON' | 'POST_FULFILLMENT'
  }
> = {
  A: {
    creditLimitPaise: 10_000_000,
    creditDays: 21,
    creditMode: 'indicate',
    paymentTerms: 'POST_FULFILLMENT',
  },
  B: {
    creditLimitPaise: 5_000_000,
    creditDays: 14,
    creditMode: 'indicate',
    paymentTerms: 'POST_FULFILLMENT',
  },
  C: {
    creditLimitPaise: 2_500_000,
    creditDays: 7,
    creditMode: 'strict',
    paymentTerms: 'POST_FULFILLMENT',
  },
  D: { creditLimitPaise: 1_000_000, creditDays: 0, creditMode: 'stop', paymentTerms: 'ON' },
}

/**
 * The shops of one network, derived from the config alone — no database. Called by `seedRetailers`
 * and, at the ROOT demo scope, by the multi-tenant seed to learn the pilot's shops (phone, name,
 * GSTIN, identity id) before handing them to another distributor as `SharedShop`s.
 */
export function buildRetailerRows(network: RetailerNetwork): RetailerRow[] {
  const rng = makeRng(network.rngSeed)
  return network.names.map((name, i) => {
    const beatIndex = Math.floor(i / network.perBeat)
    const beat = network.beats[beatIndex]
    if (!beat) throw new Error(`no beat for retailer index ${i}`)
    const tier = TIER_PATTERN[i % TIER_PATTERN.length] ?? 'C'
    const econ = TIER_ECONOMICS[tier]
    const code = `${network.codePrefix}${String(i + 1).padStart(4, '0')}`
    const shared = network.shared?.[i]
    const registered = network.registeredIndices.includes(i)
    const ownGstin = registered
      ? makeGstin(
          network.stateCode,
          `${network.gstinPanStem}${String(3000 + i)}`.padEnd(9, 'A').slice(0, 9) + 'M',
        )
      : null
    return {
      id: demoId('retailer', code),
      code,
      name: shared?.shopName ?? name,
      ownerName: shared?.ownerName ?? name.split(' ').slice(0, 2).join(' ') + ' (Prop.)',
      tier,
      beatKey: beat.key,
      beatIndex,
      seqInBeat: (i % network.perBeat) + 1,
      creditLimitPaise: econ.creditLimitPaise,
      creditDays: econ.creditDays,
      creditMode: econ.creditMode,
      paymentTerms: econ.paymentTerms,
      cashDiscountBps: tier === 'A' || tier === 'B' ? 200 : 0,
      cashDiscountDays: tier === 'A' || tier === 'B' ? 7 : 0,
      phone: shared?.phone ?? `+9182${String(network.phoneSeed + i).padStart(8, '0')}`,
      gstin: shared ? shared.gstin : ownGstin,
      lat: jitter(rng, network.centre.lat, 0.02),
      lng: jitter(rng, network.centre.lng, 0.02),
    }
  })
}

export async function seedRetailers(
  db: Db,
  tenantId: string,
  people: PeopleResult,
  network: RetailerNetwork = TARSUN_NETWORK,
): Promise<RetailersResult> {
  await insertMany(
    db,
    beats,
    network.beats.map((b) => ({
      id: demoId('beat', b.key),
      tenantId,
      name: b.name,
      area: network.area,
      visitDays: b.visitDays,
    })),
  )

  const retailerRows = buildRetailerRows(network)

  await insertMany(
    db,
    retailers,
    retailerRows.map((r) => ({
      id: r.id,
      tenantId,
      code: r.code,
      name: r.name,
      ownerName: r.ownerName,
      phone: r.phone,
      address: {
        line1: `${r.name} Building`,
        area: network.area,
        city: network.city,
        pincode: network.pincode,
      },
      lat: r.lat,
      lng: r.lng,
      beatId: demoId('beat', r.beatKey),
      tier: r.tier,
      gstRegType: r.gstin ? ('regular' as const) : ('unregistered' as const),
      gstin: r.gstin,
      stateCode: network.stateCode,
      creditLimitPaise: r.creditLimitPaise,
      creditDays: r.creditDays,
      creditMode: r.creditMode,
      paymentTerms: r.paymentTerms,
      cashDiscountBps: r.cashDiscountBps,
      cashDiscountDays: r.cashDiscountDays,
      tallyLedgerName: `${r.name} (${r.code})`,
      onboardedBy:
        r.beatIndex < network.beats.length / 2
          ? people.salespeople.rahul.id
          : people.salespeople.amit.id,
      active: true,
    })),
  )

  const linkedRetailerCodes: string[] = []
  const identityRows = network.linkedIndices.map((i) => {
    const r = retailerRows[i]
    if (!r) throw new Error(`no retailer at linked index ${i}`)
    linkedRetailerCodes.push(r.code)
    const loginIdx = network.appLoginIndices.indexOf(i)
    const loginUser = loginIdx >= 0 ? people.retailerUsers[loginIdx] : undefined
    const shared = network.shared?.[i]
    // A shared shop keeps the identity row (and the shopkeeper's user) the first distributor wrote.
    return {
      retailer: r,
      identityId: shared?.identityId ?? demoId('retailer-identity', r.code),
      userId: shared ? shared.userId : (loginUser?.id ?? null),
      shared: shared !== undefined,
    }
  })

  await insertMany(
    db,
    retailerIdentities,
    // `retailer_identities.phone` is globally unique; for a shared shop this insert is a no-op on the
    // row the other distributor already wrote, which is exactly the point.
    identityRows.map(({ retailer, identityId, userId }) => ({
      id: identityId,
      phone: retailer.phone,
      userId,
      shopName: retailer.name,
      gstin: retailer.gstin,
      consentVersion: 'v1',
      consentedAt: ONBOARDED_AT,
    })),
  )

  // A shop identity is keyed by phone across the whole platform, and the insert above is
  // `ON CONFLICT DO NOTHING`: a phone that already has an identity — the shop was onboarded through
  // `retailers.linkIdentity` on a running service, or by whichever distributor got there first —
  // keeps the id it has. Read the ids back so the links below point at the real rows.
  const identityIdByPhone = new Map(
    (
      await db
        .select({ id: retailerIdentities.id, phone: retailerIdentities.phone })
        .from(retailerIdentities)
        .where(
          inArray(
            retailerIdentities.phone,
            identityRows.map(({ retailer }) => retailer.phone),
          ),
        )
    ).map((r) => [r.phone, r.id]),
  )

  // The shopkeeper's platform user is attached to an identity that does not have one yet; an identity
  // that already names a user keeps it (that user is the shopkeeper, whichever distributor linked it).
  const claims = identityRows.filter(({ userId }) => userId !== null)
  for (const { retailer, userId } of claims) {
    await db
      .update(retailerIdentities)
      .set({ userId, updatedAt: sql`now()` })
      .where(and(eq(retailerIdentities.phone, retailer.phone), isNull(retailerIdentities.userId)))
  }

  await insertMany(
    db,
    retailerLinks,
    identityRows.map(({ retailer, identityId, userId }) => ({
      id: demoId('retailer-link', retailer.code),
      tenantId,
      identityId: identityIdByPhone.get(retailer.phone) ?? identityId,
      retailerId: retailer.id,
      userId,
      role: 'owner' as const,
      linkedBy: 'rep_onboarding' as const,
      status: 'active' as const,
      preferredLang: 'mr',
      consentVersion: 'v1',
      consentedAt: ONBOARDED_AT,
      whatsappOptinAt: ONBOARDED_AT,
    })),
  )

  await insertMany(
    db,
    externalPartyCodes,
    network.externalCodeIndices.map((i) => {
      const r = retailerRows[i]
      if (!r) throw new Error(`no retailer at external-code index ${i}`)
      return {
        id: demoId('external-party-code', r.code),
        tenantId,
        system: 'field_assist',
        code: `FA-OUT-${String(i + 1).padStart(4, '0')}`,
        retailerId: r.id,
      }
    }),
  )

  // The first rep covers the first half of the beats, the second rep the rest, and the
  // manufacturer-employed third rep rides along on all of them.
  const half = Math.ceil(network.beats.length / 2)
  const assignmentsFor = (rep: PersonRef, keys: readonly { key: string }[]) =>
    keys.map((b) => ({
      id: demoId('beat-assignment', `${shortKey(rep)}:${b.key}`),
      tenantId,
      beatId: demoId('beat', b.key),
      userId: rep.id,
      validFrom: '2026-01-01',
    }))
  await insertMany(db, beatAssignments, [
    ...assignmentsFor(people.salespeople.rahul, network.beats.slice(0, half)),
    ...assignmentsFor(people.salespeople.amit, network.beats.slice(half)),
    ...assignmentsFor(people.salespeople.pooja, network.beats),
  ])

  await insertMany(
    db,
    pjp,
    retailerRows.map((r) => ({
      id: demoId('pjp', r.code),
      tenantId,
      beatId: demoId('beat', r.beatKey),
      retailerId: r.id,
      sequence: r.seqInBeat,
    })),
  )

  await insertMany(db, numberingSeries, [
    {
      tenantId,
      seriesCode: 'RET',
      fy: FY,
      prefix: network.codePrefix,
      nextNo: network.names.length + 1,
      allocationMode: 'server' as const,
      startingNo: 1,
    },
  ])

  return {
    beats: network.beats.map((b) => ({ id: demoId('beat', b.key), key: b.key, name: b.name })),
    retailers: retailerRows,
    linkedRetailerCodes,
  }
}

/** The shops of `network` as `SharedShop`s, ready to hand to another distributor. */
export function sharedShopsFrom(
  network: RetailerNetwork,
  rows: RetailerRow[],
  indices: readonly number[],
  userByIndex: Readonly<Record<number, string>> = {},
): SharedShop[] {
  return indices.map((i) => {
    const r = nth(rows, i)
    return {
      identityId: demoId('retailer-identity', r.code),
      phone: r.phone,
      shopName: r.name,
      ownerName: r.ownerName,
      gstin: r.gstin,
      userId: userByIndex[i] ?? null,
    }
  })
}
