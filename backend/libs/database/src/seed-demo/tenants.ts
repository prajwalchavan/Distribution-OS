/**
 * The three distributors in the demo database (founder requirement, docs/22 §8 2026-09-04: "demo data
 * must cover three distributors, staff under each, shops linked to more than one distributor").
 *
 * - **Tarsun Enterprise** (Kalyan West) — the pilot. Seeded in full by `seed.ts`; its ids are
 *   unscoped, so every example in `/docs`, every spec and `pnpm smoke` keep quoting the same rows.
 * - **Sai Distributors** (Dombivli East) — 32 shops, of which the first ten are the SAME shops Tarsun
 *   sells to: one `retailer_identities` row, a `retailers` row and a `retailer_links` row per tenant.
 * - **Kalyan Agencies** (Ulhasnagar) — 32 shops, of which the first five are shops Tarsun AND Sai also
 *   sell to, so those five sit on three distributors' books at once.
 *
 * Ramesh Gupta (`ramesh.gupta`) owns the shop shared by all three, so he is ONE platform user with
 * three memberships — what the retailer app's switch-distributor flow needs something to switch
 * between. Fatima Shaikh (`fatima.shaikh`) has two.
 *
 * Idempotent like the rest of the seed: every id comes from `demoId()` under the tenant's own scope
 * and every insert is `onConflictDoNothing()`, so `pnpm db:seed` twice adds nothing.
 */
import { sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import { numberingSeries, tenants, tenantSettings } from '../schema/index.js'
import { bootstrapTenant, TENANT_SETTING_KEYS } from '../tenant-bootstrap.js'
import { demoId } from './ids.js'
import type { PeopleRoster } from './people.js'
import {
  buildRetailerRows,
  sharedShopsFrom,
  TARSUN_NETWORK,
  type RetailerNetwork,
  type SharedShop,
} from './retailers.js'
import { seedDemo, type SeedDemoResult } from './index.js'
import { FY, makeGstin } from './util.js'

/** A distributor other than the pilot: its legal identity, its team, its shops and its shelf. */
export interface TenantProfile {
  /** Id namespace for every non-global `demoId()` of this tenant's rows. Must end with ':'. */
  scope: string
  slug: string
  legalName: string
  /** Trading name printed on the shop's copy of every document (white-label, docs/17 §D6). */
  displayName: string
  invoiceFooter: string
  gstin: string
  stateCode: string
  plan: 'pilot' | 'starter' | 'growth'
  /** Invoice number prefix. Per-tenant configuration, never hard-coded (docs/17 §D1). */
  invoicePrefix: string
  roster: PeopleRoster
  network: RetailerNetwork
  /** The brands this distributor lists; its catalog overlay is the variants of these brands. */
  brandKeys: readonly string[]
  /** Shops of the pilot's network this distributor also sells to: `own index -> pilot index`. */
  sharesPilotShops: Readonly<Record<number, number>>
}

const SAI_SHOP_NAMES = [
  // 0-9 are the ten shops Tarsun also sells to. The names, phones and GSTINs actually written come
  // from the shared identity rows (see `sharesPilotShops`); these entries mirror them so the beat
  // plan reads truthfully.
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
  // 10-31: Sai's own shops around Dombivli.
  'Datta Kirana Bhandar',
  'Swami Samarth Stores',
  'Vaishnavi Provision',
  'Anand General Store',
  'Tulja Bhavani Kirana',
  'Sant Tukaram Stores',
  'Konkan Kirana Mart',
  'Prabhu Provision Store',
  'Rajhans General Store',
  'Sadguru Traders',
  'Manpada Super Bazar',
  'Suvarna Kirana Stores',
  'Aditya Provision',
  'Nakoda General Store',
  'Jain Kirana Mart',
  'Shubham Stores',
  'Vighnaharta Kirana',
  'Tirupati Provision Store',
  'Sanjivani General Store',
  'Ayre Road Kirana',
  'Milan Provision Mart',
  'Nandivali Corner Store',
]

const KALYAN_SHOP_NAMES = [
  // 0-4 are the five shops both Tarsun and Sai also sell to.
  'Shree Ganesh Kirana',
  'Om Sai Provision Store',
  'Mahalaxmi General Stores',
  'Sharma Kirana Stores',
  'Jai Bhavani Stores',
  // 5-31: Kalyan Agencies' own shops around Ulhasnagar, Ambernath and Badlapur.
  'Sindhi Colony Kirana',
  'Jhulelal Provision Store',
  'Camp 3 General Store',
  'Netaji Kirana Mart',
  'Sai Krupa Stores',
  'Guru Nanak Provision',
  'Ambernath Kirana Bhandar',
  'Shivneri General Store',
  'Morya Provision Store',
  'Renuka Kirana Stores',
  'Kailash Traders',
  'Vasant Provision Mart',
  'Dnyaneshwar Kirana',
  'Bharat General Store',
  'Om Shanti Stores',
  'Badlapur Kirana Mart',
  'Hanuman Provision Store',
  'Jyoti General Store',
  'Shahad Corner Stores',
  'Vardhaman Kirana',
  'Poonam Provision Mart',
  'Sagar General Store',
  'Tirumala Kirana Stores',
  'Aakash Provision',
  'Samrat General Store',
  'Vikas Kirana Bhandar',
  'Rangoli Stores',
]

/**
 * The shopkeeper users the pilot already created, addressed by the demo key `seedPeople` derives its
 * id from. Read at the ROOT scope (this module never runs inside `inDemoScope`), so these are the
 * pilot's user ids — the whole point: one shopkeeper, several distributors.
 */
const SHARED_RETAILER_USERS = {
  ramesh: {
    key: 'retailer-user-1',
    name: 'Ramesh Gupta',
    phone: '+919810000101',
    username: 'ramesh.gupta',
    id: demoId('user', 'retailer-user-1'),
  },
  fatima: {
    key: 'retailer-user-2',
    name: 'Fatima Shaikh',
    phone: '+919810000102',
    username: 'fatima.shaikh',
    id: demoId('user', 'retailer-user-2'),
  },
} as const

const SAI_ROSTER: PeopleRoster = {
  owner: {
    key: 'owner',
    name: 'Prakash Salunkhe',
    phone: '+919820000001',
    username: 'prakash.salunkhe',
  },
  manager: {
    key: 'manager',
    name: 'Sanjay Bhosale',
    phone: '+919820000002',
    username: 'sanjay.bhosale',
  },
  accountant: {
    key: 'accountant',
    name: 'Nilesh Wagh',
    phone: '+919820000003',
    username: 'nilesh.wagh',
  },
  warehouse: [
    {
      key: 'warehouse-bharat',
      name: 'Bharat Jadhav',
      phone: '+919820000031',
      username: 'bharat.jadhav',
    },
    {
      key: 'warehouse-sunita',
      name: 'Sunita Gaikwad',
      phone: '+919820000032',
      username: 'sunita.gaikwad',
    },
  ],
  salespeople: [
    { key: 'rep-kiran', name: 'Kiran Mhatre', phone: '+919820000011', username: 'kiran.mhatre' },
    { key: 'rep-sagar', name: 'Sagar Bhagat', phone: '+919820000012', username: 'sagar.bhagat' },
    { key: 'rep-neha', name: 'Neha Rane', phone: '+919820000013', username: 'neha.rane' },
  ],
  delivery: [
    {
      key: 'delivery-sachin',
      name: 'Sachin Dalvi',
      phone: '+919820000021',
      username: 'sachin.dalvi',
    },
    {
      key: 'delivery-imran',
      name: 'Imran Sayyed',
      phone: '+919820000022',
      username: 'imran.sayyed',
    },
    { key: 'delivery-vijay', name: 'Vijay Salvi', phone: '+919820000023', username: 'vijay.salvi' },
    { key: 'delivery-rohit', name: 'Rohit Tare', phone: '+919820000024', username: 'rohit.tare' },
  ],
  retailerUsers: [SHARED_RETAILER_USERS.ramesh, SHARED_RETAILER_USERS.fatima],
}

const KALYAN_ROSTER: PeopleRoster = {
  owner: { key: 'owner', name: 'Nitin Bhoir', phone: '+919830000001', username: 'nitin.bhoir' },
  manager: {
    key: 'manager',
    name: 'Ashok Kulkarni',
    phone: '+919830000002',
    username: 'ashok.kulkarni',
  },
  accountant: {
    key: 'accountant',
    name: 'Swati Naik',
    phone: '+919830000003',
    username: 'swati.naik',
  },
  warehouse: [
    {
      key: 'warehouse-ravi',
      name: 'Ravi Chormale',
      phone: '+919830000031',
      username: 'ravi.chormale',
    },
    {
      key: 'warehouse-manisha',
      name: 'Manisha Palve',
      phone: '+919830000032',
      username: 'manisha.palve',
    },
  ],
  salespeople: [
    {
      key: 'rep-sameer',
      name: 'Sameer Ghadge',
      phone: '+919830000011',
      username: 'sameer.ghadge',
    },
    {
      key: 'rep-deepak',
      name: 'Deepak Thorat',
      phone: '+919830000012',
      username: 'deepak.thorat',
    },
    {
      key: 'rep-anita',
      name: 'Anita Sonawane',
      phone: '+919830000013',
      username: 'anita.sonawane',
    },
  ],
  delivery: [
    { key: 'delivery-balu', name: 'Balu Shirke', phone: '+919830000021', username: 'balu.shirke' },
    { key: 'delivery-firoz', name: 'Firoz Mulla', phone: '+919830000022', username: 'firoz.mulla' },
    {
      key: 'delivery-nikhil',
      name: 'Nikhil Waghmare',
      phone: '+919830000023',
      username: 'nikhil.waghmare',
    },
    {
      key: 'delivery-pravin',
      name: 'Pravin Bhoite',
      phone: '+919830000024',
      username: 'pravin.bhoite',
    },
  ],
  retailerUsers: [
    SHARED_RETAILER_USERS.ramesh,
    {
      key: 'retailer-user-2',
      name: 'Suresh Chauhan',
      phone: '+919830000102',
      username: 'suresh.chauhan',
    },
  ],
}

const SAI_NETWORK: RetailerNetwork = {
  beats: [
    { key: 'manpada-road', name: 'Manpada Road', visitDays: [1, 4] },
    { key: 'tilak-nagar', name: 'Tilak Nagar', visitDays: [2, 5] },
    { key: 'ayre-road', name: 'Ayre Road', visitDays: [3, 6] },
    { key: 'nandivali', name: 'Nandivali', visitDays: [1, 3, 5] },
  ],
  area: 'Dombivli East',
  city: 'Dombivli',
  pincode: '421201',
  stateCode: '27',
  centre: { lat: 19.216, lng: 73.086 },
  names: SAI_SHOP_NAMES,
  perBeat: 8,
  codePrefix: 'SD-',
  phoneSeed: 3_000_001,
  gstinPanStem: 'AASPD',
  rngSeed: 'dos-demo:retailers:sai',
  linkedIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 22],
  registeredIndices: [10, 14, 19, 25, 30],
  appLoginIndices: [0, 9],
  externalCodeIndices: [0, 1, 2, 3, 4, 5, 6, 7],
}

const KALYAN_NETWORK: RetailerNetwork = {
  beats: [
    { key: 'ulhasnagar-camp-3', name: 'Ulhasnagar Camp 3', visitDays: [1, 4] },
    { key: 'ambernath-east', name: 'Ambernath East', visitDays: [2, 5] },
    { key: 'badlapur-west', name: 'Badlapur West', visitDays: [3, 6] },
    { key: 'shahad', name: 'Shahad', visitDays: [1, 3, 5] },
  ],
  area: 'Ulhasnagar',
  city: 'Ulhasnagar',
  pincode: '421003',
  stateCode: '27',
  centre: { lat: 19.218, lng: 73.163 },
  names: KALYAN_SHOP_NAMES,
  perBeat: 8,
  codePrefix: 'KA-',
  phoneSeed: 4_000_001,
  gstinPanStem: 'AAKAG',
  rngSeed: 'dos-demo:retailers:kalyan',
  linkedIndices: [0, 1, 2, 3, 4, 12, 20],
  registeredIndices: [5, 9, 13, 18, 24, 29],
  appLoginIndices: [0, 12],
  externalCodeIndices: [0, 1, 2, 3, 4],
}

/** Every brand the global catalog carries; the pilot lists all of them. */
const ALL_BRANDS = ['campa', 'independence', 'tooyumm', 'balaji', 'mommakhana', 'mastioye'] as const

export const EXTRA_TENANTS: TenantProfile[] = [
  {
    scope: 'sai:',
    slug: 'sai-distributors',
    legalName: 'Sai Distributors',
    displayName: 'Sai Distributors, Dombivli',
    invoiceFooter: 'Sai Distributors · Manpada Road, Dombivli East 421201 · GST paid at source',
    gstin: makeGstin('27', 'AASPD1201S'),
    stateCode: '27',
    plan: 'starter',
    invoicePrefix: 'SAI/',
    roster: SAI_ROSTER,
    network: SAI_NETWORK,
    // Does not carry Alan's Masti Oye.
    brandKeys: ALL_BRANDS.filter((b) => b !== 'mastioye'),
    sharesPilotShops: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9 },
  },
  {
    scope: 'kalyan:',
    slug: 'kalyan-agencies',
    legalName: 'Kalyan Agencies',
    displayName: 'Kalyan Agencies',
    invoiceFooter:
      'Kalyan Agencies · Camp 3, Ulhasnagar 421003 · Goods once sold are not taken back',
    gstin: makeGstin('27', 'AAKAG7788K'),
    stateCode: '27',
    plan: 'growth',
    invoicePrefix: 'KA/',
    roster: KALYAN_ROSTER,
    network: KALYAN_NETWORK,
    // Carries neither Masti Oye nor MOM Makhana.
    brandKeys: ALL_BRANDS.filter((b) => b !== 'mastioye' && b !== 'mommakhana'),
    sharesPilotShops: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 },
  },
]

/**
 * Creates the two extra distributors and seeds each one's month of trade. Called by `seed.ts` after
 * the pilot, because the shops they share are the pilot's: the shared `retailer_identities` rows and
 * the shopkeepers' user ids are all read at the ROOT demo scope before any tenant scope is entered.
 */
export async function seedExtraTenants(
  db: Db,
  opts: { passwordHash: string; printSignIn?: boolean },
): Promise<SeedDemoResult[]> {
  // The pilot's shops, derived from its config alone — no database round trip, and at the root scope
  // so `demoId('retailer-identity', code)` is the identity row the pilot actually wrote.
  const pilotShops = buildRetailerRows(TARSUN_NETWORK)
  const pilotShopUsers: Record<number, string> = {
    0: SHARED_RETAILER_USERS.ramesh.id,
    9: SHARED_RETAILER_USERS.fatima.id,
  }

  const results: SeedDemoResult[] = []
  for (const profile of EXTRA_TENANTS) {
    const tenantId = demoId('tenant', profile.slug)
    await db
      .insert(tenants)
      .values({
        id: tenantId,
        slug: profile.slug,
        legalName: profile.legalName,
        gstin: profile.gstin,
        stateCode: profile.stateCode,
        plan: profile.plan,
      })
      .onConflictDoNothing()

    // The invoice series is per-tenant configuration (docs/17 §D1). Written BEFORE bootstrapTenant so
    // its `onConflictDoNothing` default (`INV/`) does not win.
    await db
      .insert(numberingSeries)
      .values({ tenantId, seriesCode: 'INV', fy: FY, prefix: profile.invoicePrefix })
      .onConflictDoNothing()
    await bootstrapTenant(db, tenantId)

    // White label: the shop sees this distributor's own name on every document (docs/22 §9 rule 10).
    await db
      .insert(tenantSettings)
      .values([
        {
          tenantId,
          key: TENANT_SETTING_KEYS.brandingDisplayName,
          value: profile.displayName,
        },
        {
          tenantId,
          key: TENANT_SETTING_KEYS.brandingInvoiceFooter,
          value: profile.invoiceFooter,
        },
      ])
      .onConflictDoUpdate({
        target: [tenantSettings.tenantId, tenantSettings.key],
        set: { value: sql`excluded.value` },
      })

    const indices = Object.entries(profile.sharesPilotShops)
    const shared: Record<number, SharedShop> = {}
    const pilotIndices = indices.map(([, pilotIndex]) => pilotIndex)
    const shopsFromPilot = sharedShopsFrom(TARSUN_NETWORK, pilotShops, pilotIndices, pilotShopUsers)
    indices.forEach(([ownIndex], i) => {
      const shop = shopsFromPilot[i]
      if (shop) shared[Number(ownIndex)] = shop
    })

    results.push(
      await seedDemo(db, tenantId, {
        passwordHash: opts.passwordHash,
        printSignIn: opts.printSignIn ?? true,
        scope: profile.scope,
        label: profile.legalName,
        roster: profile.roster,
        network: { ...profile.network, shared },
        brandKeys: profile.brandKeys,
        depth: 'core',
      }),
    )
  }
  return results
}
