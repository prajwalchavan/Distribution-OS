/** Beats, retailers, a handful of app-linked retailer identities, and beat coverage. */
import { inArray, sql } from 'drizzle-orm'
import { isValidGstin } from '@dos/domain'
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
import { demoId, scopedDemoId } from './ids.js'
import {
  atIstTime,
  daysAgo,
  FY,
  jitter,
  makeGstin,
  makeRng,
  nth,
  pick,
  pickWeighted,
} from './util.js'

/** When the shops were signed up: lazy, because `TODAY` is settled per seed run. */
const onboardedAt = (): Date => atIstTime(daysAgo(90), 11, 0)

/**
 * Shopkeeper names, drawn per shop as a given name and a surname from the SAME community — Kalyan's
 * mix is Marathi first, then the Hindi belt, the Gujarati and Marwari traders, the Muslim shops and
 * a few families from the south. A cross product of two flat lists is what gave the last dataset
 * away ("Abdul Karve", "Salim Yadav"); a shop named after a family ("Sharma Kirana") keeps it.
 */
interface NamePool {
  weight: number
  first: readonly string[]
  surnames: readonly string[]
}
const NAME_POOLS: readonly NamePool[] = [
  {
    weight: 52,
    first: [
      'Ramesh',
      'Suresh',
      'Mahesh',
      'Vijay',
      'Sanjay',
      'Dinesh',
      'Prakash',
      'Santosh',
      'Anil',
      'Sunil',
      'Ganesh',
      'Nitin',
      'Sachin',
      'Mangesh',
      'Kishor',
      'Yogesh',
      'Pravin',
      'Balkrishna',
      'Dattatray',
      'Vasant',
      'Hemant',
      'Sangeeta',
      'Vandana',
      'Shobha',
      'Sadashiv',
      'Vishwas',
    ],
    surnames: [
      'Patil',
      'More',
      'Joshi',
      'Kadam',
      'Pawar',
      'Bhosale',
      'Chavan',
      'Deshmukh',
      'Gavhane',
      'Karve',
      'Jadhav',
      'Shinde',
      'Sawant',
      'Gaikwad',
      'Mhatre',
      'Bhoir',
      'Naik',
      'Rane',
      'Salvi',
      'Kulkarni',
      'Wagh',
      'Sonawane',
      'Kamble',
      'Patkar',
      'Thakare',
    ],
  },
  {
    weight: 18,
    first: [
      'Rajesh',
      'Manoj',
      'Rajendra',
      'Deepak',
      'Ashok',
      'Shankar',
      'Vikram',
      'Rekha',
      'Sunita',
      'Ramkishan',
      'Omprakash',
      'Dinanath',
    ],
    surnames: ['Sharma', 'Yadav', 'Mishra', 'Gupta', 'Singh', 'Thakur', 'Chaudhary', 'Tiwari'],
  },
  {
    weight: 14,
    first: ['Bhavesh', 'Jayesh', 'Kirti', 'Nilesh', 'Hitesh', 'Paresh', 'Dhiren', 'Hemlata'],
    surnames: ['Agarwal', 'Jain', 'Shah', 'Prajapati', 'Patel', 'Mehta', 'Bafna'],
  },
  {
    weight: 12,
    first: ['Abdul', 'Salim', 'Irfan', 'Farhan', 'Imran', 'Nasreen', 'Javed', 'Aslam'],
    surnames: ['Khan', 'Ansari', 'Sayyed', 'Shaikh', 'Qureshi', 'Momin'],
  },
  {
    weight: 4,
    first: ['Venkatesh', 'Raghavan', 'Murali', 'Lakshmi'],
    surnames: ['Iyer', 'Reddy', 'Nair', 'Pillai'],
  },
]
/** Every surname a shop can be named after, mapped to its community's pool. */
const POOL_BY_SURNAME = new Map<string, NamePool>(
  NAME_POOLS.flatMap((pool) => pool.surnames.map((name) => [name, pool] as const)),
)
const MUSLIM_POOL = nth(NAME_POOLS, 3)
/**
 * A shop named for a deity, a saint or a Hindu blessing is a Hindu family's; one named Khan, Ansari,
 * Madina or Bismillah is a Muslim family's (2026-09-08 review: "Shree Ganesh Kirana / Salim Ansari"
 * across a dozen rows read as a shuffled column). Anything else — Friends Corner, City Light, New
 * Bombay — draws from the whole town.
 */
const DEVOTIONAL_WORDS = new Set([
  'shree',
  'shri',
  'om',
  'sai',
  'jai',
  'ganesh',
  'ganpati',
  'krishna',
  'balaji',
  'mahalaxmi',
  'laxmi',
  'ambika',
  'ekvira',
  'vitthal',
  'hariom',
  'gurukrupa',
  'shivshakti',
  'bhavani',
  'tulja',
  'datta',
  'swami',
  'sant',
  'tirupati',
  'vighnaharta',
  'mauli',
  'morya',
  'renuka',
  'hanuman',
  'dnyaneshwar',
  'dnyandeep',
  'jhulelal',
  'guru',
  'trimurti',
  'rameshwar',
  'shantai',
  'ashirwad',
  'mangal',
  'shubhalabh',
  'rukmini',
  'sahyadri',
  'nakshatra',
  'anand',
  'navjeevan',
  'sadguru',
  'vaishnavi',
  'prabhu',
  'rajhans',
  'nakoda',
  'jain',
  'shubham',
  'sanjivani',
  'yashodhan',
  'chhatrapati',
  'shivneri',
  'kailash',
  'bharat',
  'jyoti',
  'netaji',
  'sindhi',
  'sonal',
  'suvarna',
  'aditya',
  'nutan',
  'meghana',
  'sujata',
  'vaibhav',
  'prerna',
])
const MUSLIM_WORDS = new Set(['khan', 'ansari', 'madina', 'bismillah', 'noor', 'al', 'mumtaz'])

/** A shopkeeper's name: the community first, then a given name and surname from it. */
function ownerNameFor(rng: () => number, shopName: string): string {
  const words = shopName.toLowerCase().split(' ')
  const firstWord = shopName.split(' ')[0] ?? ''
  const named = POOL_BY_SURNAME.get(firstWord)
  const hindu = words.some((w) => DEVOTIONAL_WORDS.has(w))
  const muslim = words.some((w) => MUSLIM_WORDS.has(w))
  const pool =
    named ??
    (muslim
      ? MUSLIM_POOL
      : pickWeighted(
          rng,
          NAME_POOLS.filter((p) => !hindu || p !== MUSLIM_POOL).map((p) => [p.weight, p] as const),
        ))
  return `${pick(rng, pool.first)} ${named ? firstWord : pick(rng, pool.surnames)}`
}

/**
 * Mobile numbers the way a shop's contact list actually reads: a spread of the prefixes the Mumbai
 * circle hands out (Jio, Vi, Airtel, BSNL blocks), never one block with the number counting up.
 */
const MOBILE_PREFIXES = [
  '98200',
  '98210',
  '98920',
  '99200',
  '99300',
  '98670',
  '97690',
  '97020',
  '93220',
  '91670',
  '90040',
  '88790',
  '86550',
  '84520',
  '77380',
  '70210',
  '96190',
  '89760',
  '82910',
  '80800',
] as const

/**
 * A proprietor's PAN: three letters, `P` (an individual), the surname's initial, four digits, a
 * letter — the shape every registered kirana's GSTIN carries, one per shop. Draws from its own
 * stream so the coordinates and the shopkeepers' names stay where they were (rule G6).
 */
function proprietorPan(rng: () => number, ownerName: string): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ'
  const letter = () => letters[Math.floor(rng() * letters.length)] ?? 'A'
  const surname = ownerName.trim().split(' ').pop() ?? 'K'
  const initial = /^[A-Z]$/.test(surname[0] ?? '') ? (surname[0] ?? 'K') : 'K'
  const digits = String(1000 + Math.floor(rng() * 9000))
  return `${letter()}${letter()}${letter()}P${initial}${digits}${letter()}`
}

/** One number per shop, unique across the three networks (the seed keeps the seeds apart). */
function shopPhone(seed: number, i: number): string {
  const prefix = nth(
    MOBILE_PREFIXES,
    (i * 7 + Math.floor(seed / 1_000_000)) % MOBILE_PREFIXES.length,
  )
  const tail = (seed + i * 1531 + ((i * i) % 97)) % 100_000
  return `+91${prefix}${String(tail).padStart(5, '0')}`
}

export type Tier = 'A' | 'B' | 'C' | 'D'

/**
 * The kind of shop a row is (spec §2.6). Every downstream seed selects shops BY ARCHETYPE, never by
 * array index, so a network of any size gives every screen the case it needs: the shop near its
 * credit limit, the one that pays at the door, the one that has never ordered.
 */
export type ArchetypeKey =
  | 'kirana_small'
  | 'grocery_medium'
  | 'supermarket'
  | 'high_volume'
  | 'cash_only'
  | 'prepaid'
  | 'new_shop'
  | 'credit_near_limit'
  | 'overdue_mild'
  | 'overdue_hard'
  | 'bad_debt'
  | 'blocked_link'
  | 'closed_shop'

export interface Archetype {
  tier: Tier
  creditLimitPaise: number
  creditDays: number
  creditMode: 'indicate' | 'strict' | 'stop'
  paymentTerms: 'PRE' | 'ON' | 'POST_FULFILLMENT'
  cashDiscountBps: number
  cashDiscountDays: number
  active: boolean
  linkStatus: 'active' | 'blocked'
  gstRegistered: boolean
}

const POST = 'POST_FULFILLMENT' as const
export const ARCHETYPES: Readonly<Record<ArchetypeKey, Archetype>> = {
  kirana_small: {
    tier: 'C',
    creditLimitPaise: 5_000_000,
    creditDays: 7,
    creditMode: 'strict',
    paymentTerms: POST,
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'active',
    gstRegistered: false,
  },
  grocery_medium: {
    tier: 'B',
    creditLimitPaise: 18_000_000,
    creditDays: 14,
    creditMode: 'indicate',
    paymentTerms: POST,
    cashDiscountBps: 200,
    cashDiscountDays: 7,
    active: true,
    linkStatus: 'active',
    gstRegistered: true,
  },
  supermarket: {
    tier: 'A',
    creditLimitPaise: 60_000_000,
    creditDays: 21,
    creditMode: 'indicate',
    paymentTerms: POST,
    cashDiscountBps: 200,
    cashDiscountDays: 7,
    active: true,
    linkStatus: 'active',
    gstRegistered: true,
  },
  high_volume: {
    tier: 'A',
    creditLimitPaise: 100_000_000,
    creditDays: 21,
    creditMode: 'indicate',
    paymentTerms: POST,
    cashDiscountBps: 250,
    cashDiscountDays: 7,
    active: true,
    linkStatus: 'active',
    gstRegistered: true,
  },
  cash_only: {
    tier: 'D',
    creditLimitPaise: 0,
    creditDays: 0,
    creditMode: 'stop',
    paymentTerms: 'ON',
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'active',
    gstRegistered: false,
  },
  prepaid: {
    tier: 'D',
    creditLimitPaise: 0,
    creditDays: 0,
    creditMode: 'stop',
    paymentTerms: 'PRE',
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'active',
    gstRegistered: false,
  },
  new_shop: {
    tier: 'C',
    creditLimitPaise: 1_000_000,
    creditDays: 7,
    creditMode: 'strict',
    paymentTerms: POST,
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'active',
    gstRegistered: false,
  },
  credit_near_limit: {
    tier: 'B',
    creditLimitPaise: 15_000_000,
    creditDays: 14,
    creditMode: 'indicate',
    paymentTerms: POST,
    cashDiscountBps: 200,
    cashDiscountDays: 7,
    active: true,
    linkStatus: 'active',
    gstRegistered: true,
  },
  overdue_mild: {
    tier: 'C',
    creditLimitPaise: 5_000_000,
    creditDays: 7,
    creditMode: 'strict',
    paymentTerms: POST,
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'active',
    gstRegistered: false,
  },
  overdue_hard: {
    tier: 'B',
    creditLimitPaise: 15_000_000,
    creditDays: 14,
    creditMode: 'stop',
    paymentTerms: POST,
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'active',
    gstRegistered: true,
  },
  bad_debt: {
    tier: 'C',
    creditLimitPaise: 4_000_000,
    creditDays: 7,
    creditMode: 'stop',
    paymentTerms: POST,
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'active',
    gstRegistered: false,
  },
  blocked_link: {
    tier: 'C',
    creditLimitPaise: 4_000_000,
    creditDays: 7,
    creditMode: 'stop',
    paymentTerms: POST,
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    linkStatus: 'blocked',
    gstRegistered: false,
  },
  closed_shop: {
    tier: 'D',
    creditLimitPaise: 1_000_000,
    creditDays: 0,
    creditMode: 'stop',
    paymentTerms: 'ON',
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: false,
    linkStatus: 'active',
    gstRegistered: false,
  },
}

/** Archetypes that trade: the ones the order generator may pick a shop from. */
export const TRADING_ARCHETYPES: ReadonlySet<ArchetypeKey> = new Set<ArchetypeKey>([
  'kirana_small',
  'grocery_medium',
  'supermarket',
  'high_volume',
  'cash_only',
  'prepaid',
  'credit_near_limit',
  'overdue_mild',
  'overdue_hard',
])

/**
 * The accounts an old limit never kept up with (2026-09-08 review: not one shop over its limit):
 * the sixth mid-size grocery and the second supermarket of a network, on a third of the
 * archetype's limit — set when the shop was small and never revised.
 */
const OVER_LIMIT_PICKS: readonly (readonly [ArchetypeKey, number])[] = [
  ['grocery_medium', 5],
  ['supermarket', 1],
]

/** The `n`-th shop of an archetype in network order; throws when the network has none. */
export function byArchetype(rows: readonly RetailerRow[], key: ArchetypeKey, n = 0): RetailerRow {
  const matches = rows.filter((r) => r.archetype === key)
  const row = matches[n]
  if (!row) throw new Error(`network has no ${key} shop at position ${n} (${matches.length} found)`)
  return row
}

export interface RetailerRow {
  id: string
  code: string
  name: string
  ownerName: string
  archetype: ArchetypeKey
  tier: Tier
  active: boolean
  linkStatus: 'active' | 'blocked'
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
  /** The proprietor's PAN, the one inside the GSTIN; null for an unregistered shop. */
  pan: string | null
  /**
   * An account whose limit was set when it was small and never revised as its trade grew: it runs
   * past the limit on `indicate` terms, and the owner sees it on the over-limit screen.
   */
  overLimit: boolean
  address: { line1: string; area: string; city: string; pincode: string }
  lat: number
  lng: number
}

export interface RetailersResult {
  beats: { id: string; key: string; name: string; visitDays: number[] }[]
  retailers: RetailerRow[]
  /** Retailer codes that got a retailer_identity + retailer_link. */
  linkedRetailerCodes: string[]
  /** The shops whose keeper signs in to the retailer app, in `retailerUsers` order. */
  appLoginRetailerCodes: string[]
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
/** One beat: its schedule and the locality its shops print on a bill. */
export interface BeatDef {
  key: string
  name: string
  visitDays: number[]
  /** The locality of the beat; the network's `area` when absent. */
  area?: string
  pincode?: string
  /** Streets and landmarks the shop addresses are spread over. */
  landmarks?: readonly string[]
  /**
   * Where the beat actually is: its shops sit within half a kilometre of this point. Station Road,
   * Khadakpada, Godrej Hill and Kolsewadi are separate parts of Kalyan two to five kilometres apart,
   * and a route planner working on six beats jittered around one point is working on noise
   * (2026-09-08 review). Falls back to the network's centre.
   */
  centre?: { lat: number; lng: number }
}
/** Half a kilometre or so: how far a beat's shops spread from its centre. */
const BEAT_SPREAD = 0.0045

export interface RetailerNetwork {
  beats: readonly BeatDef[]
  area: string
  city: string
  pincode: string
  stateCode: string
  centre: { lat: number; lng: number }
  names: readonly string[]
  /** One archetype per shop, in `names` order; same length as `names`. */
  archetypePattern: readonly ArchetypeKey[]
  /** Shops per beat; `names.length` must be `beats.length * perBeat`. */
  perBeat: number
  /** Retailer code prefix, also the `RET` numbering-series prefix, e.g. `R-`. */
  codePrefix: string
  /** Phone seed: its millions pick the prefix block, the rest the number; one phone per shop. */
  phoneSeed: number
  rngSeed: string
  /** Shops that get a `retailer_identity` + `retailer_link` (i.e. exist on the retailer app). */
  linkedIndices: readonly number[]
  /**
   * Shops with a GSTIN. Derived from the archetype pattern when absent (the `gstRegistered` column of
   * §2.6), never re-listed by hand: a shop's tax status must not move between seeds, because that
   * would change tax already computed on invoices the seed wrote on an earlier run.
   */
  registeredIndices?: readonly number[]
  /** Of the linked shops, the ones that also get a users row + membership (matched positionally to
   *  the roster's `retailerUsers`). */
  appLoginIndices: readonly number[]
  /** Shops that get an external (FieldAssist) outlet code. */
  externalCodeIndices: readonly number[]
  /** Shop index -> the same physical shop, already on another distributor's books. */
  shared?: Readonly<Record<number, SharedShop>>
}

const TARSUN_BEATS: BeatDef[] = [
  {
    key: 'station-road',
    name: 'Station Road',
    visitDays: [1, 4],
    area: 'Station Road, Kalyan West',
    pincode: '421301',
    centre: { lat: 19.2352, lng: 73.13 },
    landmarks: ['Station Road', 'Shivaji Chowk', 'Murbad Road', 'Bail Bazar', 'Tilak Chowk'],
  },
  {
    key: 'kalyan-west-market',
    name: 'Kalyan West Market',
    visitDays: [2, 5],
    area: 'Bazarpeth, Kalyan West',
    pincode: '421301',
    centre: { lat: 19.2418, lng: 73.1262 },
    landmarks: ['Bazarpeth', 'Subhash Chowk', 'Parnaka', 'Dudh Naka', 'Ahilyabai Chowk'],
  },
  {
    key: 'khadakpada',
    name: 'Khadakpada',
    visitDays: [3, 6],
    area: 'Khadakpada, Kalyan West',
    pincode: '421301',
    centre: { lat: 19.2588, lng: 73.1228 },
    landmarks: ['Khadakpada Circle', 'Wayle Nagar', 'Gandhari Road', 'Adharwadi', 'Lal Chowki'],
  },
  {
    key: 'godrej-hill',
    name: 'Godrej Hill',
    visitDays: [1, 3, 5],
    area: 'Godrej Hill, Kalyan West',
    pincode: '421301',
    centre: { lat: 19.2506, lng: 73.1162 },
    landmarks: ['Godrej Hill Road', 'Rambaug Lane 4', 'Barave Road', 'Gauripada', 'Syndicate'],
  },
  {
    key: 'kolsewadi',
    name: 'Kolsewadi',
    visitDays: [2, 5],
    area: 'Kolsewadi, Kalyan East',
    pincode: '421306',
    centre: { lat: 19.2338, lng: 73.1446 },
    landmarks: [
      'Kolsewadi Naka',
      'Chinchpada Road',
      'Tisgaon Naka',
      'Katemanivali',
      'Nandivli Road',
    ],
  },
  {
    key: 'birla-college-road',
    name: 'Birla College Road',
    visitDays: [4, 6],
    area: 'Birla College Road, Kalyan West',
    pincode: '421301',
    centre: { lat: 19.2468, lng: 73.1382 },
    landmarks: [
      'Birla College Road',
      'Lok Gram',
      'Sahajanand Chowk',
      'Mohone Road',
      'Khadegolavali',
    ],
  },
]

/**
 * Names follow the archetype at the position (2026-09-08 review): the supermarkets and the
 * high-volume accounts read like supermarkets and wholesalers, "Kirana / General Stores" stays
 * with the kirana tiers. Positions keep their `demoId('retailer', code)` (rule G4); only the
 * label moves.
 */
const TARSUN_RETAILER_NAMES = [
  'Shree Ganesh Kirana',
  'Om Sai Provision Store',
  'Mahalaxmi General Stores',
  'Sai Krupa Super Bazar',
  'Jai Bhavani Stores',
  'Shivshakti Traders',
  'Ganesh General Store',
  'Krishna Kirana Stores',
  'Ambika Provision Store',
  'Balaji Wholesale Stores',
  'Sai Baba Kirana',
  'Vitthal Traders',
  'Laxmi Narayan Stores',
  'Ekvira Kirana',
  'Ganpati General Stores',
  'Navjeevan Super Bazar',
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
  'Prerna Super Market',
  'Ansari Kirana Stores',
  'New Bombay Stores',
  'City Light Provision',
  'Metro Kirana Bazar',
  'Friends Corner Stores',
  // 36-59: the two beats the pilot opened in 2026 (Kolsewadi, Birla College Road).
  'Sharma Kirana Stores',
  'Rukmini Provision',
  'Gavhane Kirana',
  'Shubhalabh Stores',
  'Trimurti General Store',
  'Vaibhav Kirana Mart',
  'Anand Bhavan Provision',
  'Sujata Stores',
  'Kolsewadi Corner Store',
  'Khan General Store',
  'Mangal Traders',
  'Dnyandeep Stores',
  'Shantai Provision Store',
  'Nakshatra Kirana',
  'Rameshwar General Store',
  'Karve Provision',
  'Sahyadri Super Bazar',
  'Nutan Kirana Stores',
  'Ashirwad Provision',
  'Meghana General Store',
  'Hariom Kirana Bhandar',
  'Birla Road Kirana Mart',
  'Gurukrupa Provision',
  'Vasudha Stores',
]

/** Ten shops per beat, repeated with the hand-placed exceptions of spec §2.6. */
const K = 'kirana_small'
const G = 'grocery_medium'
const TARSUN_ARCHETYPES: readonly ArchetypeKey[] = [
  // beat 0 Station Road
  K,
  G,
  K,
  'supermarket',
  K,
  'overdue_mild',
  G,
  'cash_only',
  K,
  'high_volume',
  // beat 1 Kalyan West Market
  G,
  K,
  'credit_near_limit',
  K,
  G,
  'supermarket',
  K,
  'overdue_hard',
  K,
  G,
  // beat 2 Khadakpada
  K,
  K,
  G,
  K,
  'bad_debt',
  K,
  G,
  K,
  'prepaid',
  K,
  // beat 3 Godrej Hill
  'supermarket',
  K,
  G,
  K,
  K,
  'blocked_link',
  K,
  G,
  K,
  'overdue_mild',
  // beat 4 Kolsewadi
  K,
  G,
  K,
  'new_shop',
  K,
  'cash_only',
  K,
  G,
  'closed_shop',
  K,
  // beat 5 Birla College Road
  G,
  K,
  'high_volume',
  K,
  'new_shop',
  K,
  'overdue_hard',
  K,
  G,
  'bad_debt',
]

/**
 * The pilot distributor's network: 60 shops over six Kalyan West beats. The first ten are also on
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
  archetypePattern: TARSUN_ARCHETYPES,
  perBeat: 10,
  codePrefix: 'R-',
  phoneSeed: 2_000_001,
  rngSeed: 'dos-demo:retailers',
  // the ten shared shops, the three the earlier seed linked, then every big account, the shop at
  // its limit, the two brand-new shops, the two hard-overdue ones and three mid-size groceries
  // ...and the shop whose link the owner blocked, which is only a fact if the link exists
  linkedIndices: [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 18, 27, 3, 15, 30, 52, 12, 43, 54, 17, 56, 14, 22, 35,
  ].filter((v, i, a) => a.indexOf(v) === i),
  appLoginIndices: [0, 9],
  externalCodeIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
}

/** GST-registered shops: the archetype says so, unless the network pins the list by hand. */
export function registeredIndicesOf(network: RetailerNetwork): number[] {
  if (network.registeredIndices) return [...network.registeredIndices]
  return network.archetypePattern.flatMap((a, i) => (ARCHETYPES[a].gstRegistered ? [i] : []))
}

/**
 * The shops of one network, derived from the config alone — no database. Called by `seedRetailers`
 * and, at the ROOT demo scope, by the multi-tenant seed to learn the pilot's shops (phone, name,
 * GSTIN, identity id) before handing them to another distributor as `SharedShop`s.
 */
export function buildRetailerRows(network: RetailerNetwork): RetailerRow[] {
  if (network.archetypePattern.length !== network.names.length) {
    throw new Error(
      `network ${network.codePrefix}: ${network.archetypePattern.length} archetypes for ${network.names.length} shops`,
    )
  }
  const rng = makeRng(network.rngSeed)
  // its own stream: the coordinates above were drawn before shopkeepers had names (rule G6)
  const ownerRng = makeRng(`${network.rngSeed}:owners`)
  /** No two shopkeepers of one network share a name: redraw a handful of times before giving up. */
  const ownerNames = new Set<string>()
  const uniqueOwnerName = (shopName: string): string => {
    let name = ownerNameFor(ownerRng, shopName)
    for (let attempt = 0; attempt < 6 && ownerNames.has(name); attempt++)
      name = ownerNameFor(ownerRng, shopName)
    ownerNames.add(name)
    return name
  }
  const registeredIndices = new Set(registeredIndicesOf(network))
  const panRng = makeRng(`${network.rngSeed}:pan`)
  const pans = new Set<string>()
  const overLimitIndices = new Set(
    OVER_LIMIT_PICKS.map(([key, n]) => {
      const matches = network.archetypePattern.flatMap((a, i) => (a === key ? [i] : []))
      return matches[n] ?? -1
    }).filter((i) => i >= 0),
  )
  return network.names.map((name, i) => {
    const beatIndex = Math.floor(i / network.perBeat)
    const beat = network.beats[beatIndex]
    if (!beat) throw new Error(`no beat for retailer index ${i}`)
    const archetype = nth(network.archetypePattern, i)
    const econ = ARCHETYPES[archetype]
    const tier = econ.tier
    const overLimit = overLimitIndices.has(i) && econ.creditMode === 'indicate'
    const code = `${network.codePrefix}${String(i + 1).padStart(4, '0')}`
    const shared = network.shared?.[i]
    const registered = registeredIndices.has(i)
    const ownerName = uniqueOwnerName(name)
    let ownGstin: string | null = null
    if (registered) {
      // its own PAN — never one stem with a counter, which read as one taxpayer with 22 shops
      let pan = proprietorPan(panRng, ownerName)
      while (pans.has(pan)) pan = proprietorPan(panRng, ownerName)
      pans.add(pan)
      ownGstin = makeGstin(network.stateCode, pan)
      if (!isValidGstin(ownGstin)) throw new Error(`seed built an invalid GSTIN ${ownGstin}`)
    }
    const landmarks = beat.landmarks ?? [`${beat.name}`]
    const address = {
      line1: `Shop ${3 + ((i * 7) % 38)}, ${nth(landmarks, (i * 3 + beatIndex) % landmarks.length)}`,
      area: beat.area ?? network.area,
      city: network.city,
      pincode: beat.pincode ?? network.pincode,
    }
    return {
      id: demoId('retailer', code),
      code,
      name: shared?.shopName ?? name,
      ownerName: shared?.ownerName ?? ownerName,
      archetype,
      tier,
      active: econ.active,
      linkStatus: econ.linkStatus,
      beatKey: beat.key,
      beatIndex,
      seqInBeat: (i % network.perBeat) + 1,
      creditLimitPaise: overLimit ? Math.round(econ.creditLimitPaise / 3) : econ.creditLimitPaise,
      creditDays: econ.creditDays,
      creditMode: econ.creditMode,
      paymentTerms: econ.paymentTerms,
      cashDiscountBps: econ.cashDiscountBps,
      cashDiscountDays: econ.cashDiscountDays,
      // spread over the number range the way real numbers are, one per shop, never consecutive
      phone: shared?.phone ?? shopPhone(network.phoneSeed, i),
      gstin: shared ? shared.gstin : ownGstin,
      pan: (shared ? shared.gstin : ownGstin)?.slice(2, 12) ?? null,
      overLimit,
      address,
      lat: jitter(rng, (beat.centre ?? network.centre).lat, BEAT_SPREAD),
      lng: jitter(rng, (beat.centre ?? network.centre).lng, BEAT_SPREAD),
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
      area: b.area ?? network.area,
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
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      beatId: demoId('beat', r.beatKey),
      tier: r.tier,
      gstRegType: r.gstin ? ('regular' as const) : ('unregistered' as const),
      gstin: r.gstin,
      pan: r.pan,
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
      active: r.active,
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
      consentedAt: onboardedAt(),
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
  if (claims.length > 0) {
    // One statement for every claim (a `VALUES` list, as `backfillCredentials` does), not one round
    // trip per linked shop.
    const values = sql.join(
      claims.map(({ retailer, userId }) => sql`(${retailer.phone}, ${userId})`),
      sql`, `,
    )
    await db.execute(sql`
      UPDATE retailer_identities ri SET user_id = v.user_id, updated_at = now()
        FROM (VALUES ${values}) AS v(phone, user_id)
       WHERE ri.phone = v.phone AND ri.user_id IS NULL`)
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
      status: retailer.linkStatus,
      preferredLang: 'mr',
      consentVersion: 'v1',
      consentedAt: onboardedAt(),
      whatsappOptinAt: onboardedAt(),
    })),
  )

  // The shop row names its platform identity too (the read side of `retailers.linkIdentity`), for a
  // database seeded before the column was filled as much as for a fresh one.
  await db.execute(sql`
    UPDATE retailers r SET identity_id = l.identity_id
      FROM retailer_links l
     WHERE l.tenant_id = ${tenantId} AND l.retailer_id = r.id AND r.tenant_id = ${tenantId}
       AND r.identity_id IS NULL`)

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
  // The extra reps (spec §2.7) each take two beats, spread so every beat has a second rep.
  const extraReps = (people.extra ?? []).filter((p) => p.role === 'salesperson')
  const extraAssignments = extraReps.flatMap((rep, k) => {
    const n = network.beats.length
    const picks = [...new Set([(k * 2) % n, (k * 2 + 4) % n])]
    return assignmentsFor(
      rep,
      picks.map((i) => nth(network.beats, i)),
    )
  })
  await insertMany(db, beatAssignments, [
    ...assignmentsFor(people.salespeople.rahul, network.beats.slice(0, half)),
    ...assignmentsFor(people.salespeople.amit, network.beats.slice(half)),
    ...assignmentsFor(people.salespeople.pooja, network.beats),
    ...extraAssignments,
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
    beats: network.beats.map((b) => ({
      id: demoId('beat', b.key),
      key: b.key,
      name: b.name,
      visitDays: b.visitDays,
    })),
    retailers: retailerRows,
    linkedRetailerCodes,
    appLoginRetailerCodes: network.appLoginIndices.map((i) => nth(retailerRows, i).code),
  }
}

/** The shops of `network` as `SharedShop`s, ready to hand to another distributor. */
export function sharedShopsFrom(
  network: RetailerNetwork,
  rows: RetailerRow[],
  indices: readonly number[],
  userByIndex: Readonly<Record<number, string>> = {},
  /** The id scope the OWNING distributor wrote its identity rows under ('' for the pilot). */
  ownerScope = '',
): SharedShop[] {
  return indices.map((i) => {
    const r = nth(rows, i)
    return {
      identityId: scopedDemoId(ownerScope, 'retailer-identity', r.code),
      phone: r.phone,
      shopName: r.name,
      ownerName: r.ownerName,
      gstin: r.gstin,
      userId: userByIndex[i] ?? null,
    }
  })
}
