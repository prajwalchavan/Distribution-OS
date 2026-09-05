/** Beats, retailers, a handful of app-linked retailer identities, and beat coverage. */
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
import type { PeopleResult } from './people.js'
import { demoId } from './ids.js'
import { atIstTime, daysAgo, FY, jitter, makeGstin, makeRng } from './util.js'

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
  /** Retailer codes that got a retailer_identity + retailer_link (6 of them). */
  linkedRetailerCodes: string[]
}

const BEATS = [
  { key: 'station-road', name: 'Station Road', visitDays: [1, 4] },
  { key: 'kalyan-west-market', name: 'Kalyan West Market', visitDays: [2, 5] },
  { key: 'khadakpada', name: 'Khadakpada', visitDays: [3, 6] },
  { key: 'godrej-hill', name: 'Godrej Hill', visitDays: [1, 3, 5] },
]

const RETAILER_NAMES = [
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

/** [A,B,B,B,C,C,C,D,D] repeated per 9-retailer beat -> 4 A / 12 B / 12 C / 8 D across 36 retailers. */
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

/** Indices (into the 36-name list) that get a retailer_identity + retailer_link back to the phone app. */
const LINKED_INDICES = [0, 4, 9, 13, 18, 27]
/** Of those, the two that also get a real users row + membership so the retailer app can sign in. */
const APP_LOGIN_INDICES = [0, 9]
/** Indices that get an external (FieldAssist) outlet code. */
const EXTERNAL_CODE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export async function seedRetailers(
  db: Db,
  tenantId: string,
  people: PeopleResult,
): Promise<RetailersResult> {
  const rng = makeRng('dos-demo:retailers')

  await insertMany(
    db,
    beats,
    BEATS.map((b) => ({
      id: demoId('beat', b.key),
      tenantId,
      name: b.name,
      area: 'Kalyan West',
      visitDays: b.visitDays,
    })),
  )

  const retailerRows: RetailerRow[] = RETAILER_NAMES.map((name, i) => {
    const beatIndex = Math.floor(i / 9)
    const seqInBeat = (i % 9) + 1
    const beat = BEATS[beatIndex]
    if (!beat) throw new Error(`no beat for retailer index ${i}`)
    const tier = TIER_PATTERN[i % TIER_PATTERN.length] ?? 'C'
    const econ = TIER_ECONOMICS[tier]
    const code = `R-${String(i + 1).padStart(4, '0')}`
    const registered = [0, 4, 9, 13, 18, 27].includes(i)
    return {
      id: demoId('retailer', code),
      code,
      name,
      ownerName: name.split(' ').slice(0, 2).join(' ') + ' (Prop.)',
      tier,
      beatKey: beat.key,
      beatIndex,
      seqInBeat,
      creditLimitPaise: econ.creditLimitPaise,
      creditDays: econ.creditDays,
      creditMode: econ.creditMode,
      paymentTerms: econ.paymentTerms,
      cashDiscountBps: tier === 'A' || tier === 'B' ? 200 : 0,
      cashDiscountDays: tier === 'A' || tier === 'B' ? 7 : 0,
      phone: `+9182${String(2_000_001 + i).padStart(8, '0')}`,
      gstin: registered
        ? makeGstin('27', `AAKPT${String(3000 + i)}`.padEnd(9, 'A').slice(0, 9) + 'M')
        : null,
      lat: jitter(rng, 19.24, 0.02),
      lng: jitter(rng, 73.13, 0.02),
    }
  })

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
        area: 'Kalyan West',
        city: 'Kalyan',
        pincode: '421301',
      },
      lat: r.lat,
      lng: r.lng,
      beatId: demoId('beat', r.beatKey),
      tier: r.tier,
      gstRegType: r.gstin ? ('regular' as const) : ('unregistered' as const),
      gstin: r.gstin,
      stateCode: '27',
      creditLimitPaise: r.creditLimitPaise,
      creditDays: r.creditDays,
      creditMode: r.creditMode,
      paymentTerms: r.paymentTerms,
      cashDiscountBps: r.cashDiscountBps,
      cashDiscountDays: r.cashDiscountDays,
      tallyLedgerName: `${r.name} (${r.code})`,
      onboardedBy: r.beatIndex < 2 ? people.salespeople.rahul.id : people.salespeople.amit.id,
      active: true,
    })),
  )

  const linkedRetailerCodes: string[] = []
  const identityRows = LINKED_INDICES.map((i) => {
    const r = retailerRows[i]
    if (!r) throw new Error(`no retailer at linked index ${i}`)
    linkedRetailerCodes.push(r.code)
    const loginIdx = APP_LOGIN_INDICES.indexOf(i)
    const loginUser = loginIdx >= 0 ? people.retailerUsers[loginIdx] : undefined
    return { retailer: r, loginUser }
  })

  await insertMany(
    db,
    retailerIdentities,
    identityRows.map(({ retailer, loginUser }) => ({
      id: demoId('retailer-identity', retailer.code),
      phone: retailer.phone,
      userId: loginUser?.id ?? null,
      shopName: retailer.name,
      gstin: retailer.gstin,
      consentVersion: 'v1',
      consentedAt: ONBOARDED_AT,
    })),
  )

  await insertMany(
    db,
    retailerLinks,
    identityRows.map(({ retailer, loginUser }) => ({
      id: demoId('retailer-link', retailer.code),
      tenantId,
      identityId: demoId('retailer-identity', retailer.code),
      retailerId: retailer.id,
      userId: loginUser?.id ?? null,
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
    EXTERNAL_CODE_INDICES.map((i) => {
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

  await insertMany(db, beatAssignments, [
    {
      id: demoId('beat-assignment', 'rahul:station-road'),
      tenantId,
      beatId: demoId('beat', 'station-road'),
      userId: people.salespeople.rahul.id,
      validFrom: '2026-01-01',
    },
    {
      id: demoId('beat-assignment', 'rahul:kalyan-west-market'),
      tenantId,
      beatId: demoId('beat', 'kalyan-west-market'),
      userId: people.salespeople.rahul.id,
      validFrom: '2026-01-01',
    },
    {
      id: demoId('beat-assignment', 'amit:khadakpada'),
      tenantId,
      beatId: demoId('beat', 'khadakpada'),
      userId: people.salespeople.amit.id,
      validFrom: '2026-01-01',
    },
    {
      id: demoId('beat-assignment', 'amit:godrej-hill'),
      tenantId,
      beatId: demoId('beat', 'godrej-hill'),
      userId: people.salespeople.amit.id,
      validFrom: '2026-01-01',
    },
    ...BEATS.map((b) => ({
      id: demoId('beat-assignment', `pooja:${b.key}`),
      tenantId,
      beatId: demoId('beat', b.key),
      userId: people.salespeople.pooja.id,
      validFrom: '2026-01-01',
    })),
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
      prefix: 'R-',
      nextNo: RETAILER_NAMES.length + 1,
      allocationMode: 'server' as const,
      startingNo: 1,
    },
  ])

  return {
    beats: BEATS.map((b) => ({ id: demoId('beat', b.key), key: b.key, name: b.name })),
    retailers: retailerRows,
    linkedRetailerCodes,
  }
}
