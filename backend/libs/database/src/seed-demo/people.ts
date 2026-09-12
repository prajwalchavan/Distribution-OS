/** Staff and retailer-app users, their tenant memberships, brand authorisations and bargain bounds. */
import { sql } from 'drizzle-orm'
import { insertMany } from './db-helpers.js'
import {
  devices,
  memberships,
  repAutoApproveBounds,
  repProductAuthorisations,
  users,
} from '../schema/index.js'
import type { membershipRole } from '../schema/index.js'
import type { Db } from '../client.js'
import { BRAND_KEYS, brandId } from './catalog.js'
import { demoId } from './ids.js'

export interface PersonRef {
  id: string
  name: string
  phone: string
  /** Sign-in name; the password for every demo user is DEMO_PASSWORD. */
  username: string
}

/**
 * One person as a roster entry. `key` feeds `demoId('user', key)` — which is namespaced by the demo
 * scope, so the same key under two distributors is two different people. `id` overrides that for a
 * user who is deliberately SHARED between distributors: the shopkeeper who buys from more than one
 * of them is one platform user with one phone and a membership per tenant.
 */
export interface PersonSpec {
  key: string
  name: string
  phone: string
  username: string
  id?: string
}

/**
 * Who works for one distributor. Every distributor in the demo has the same shape of team (the
 * downstream seeds address them by slot), but its own names, phones and sign-in names.
 */
export interface PeopleRoster {
  owner: PersonSpec
  manager: PersonSpec
  accountant: PersonSpec
  /** Two godown hands: picking waves alternate between them. */
  warehouse: readonly [PersonSpec, PersonSpec]
  /** Three reps. The third is employed by the manufacturer and sells only Too Yumm. */
  salespeople: readonly [PersonSpec, PersonSpec, PersonSpec]
  delivery: readonly [PersonSpec, PersonSpec, PersonSpec, PersonSpec]
  /** Shopkeepers who sign in to the retailer app; matched positionally to the network's app logins. */
  retailerUsers: readonly [PersonSpec, PersonSpec]
  /** Extra staff beyond the slots the downstream seeds address by name. Users + memberships only. */
  extra?: readonly (PersonSpec & { role: StaffRole })[]
}

export type StaffRole =
  'owner' | 'manager' | 'accountant' | 'salesperson' | 'warehouse' | 'delivery'
export type ExtraPerson = PersonRef & { role: StaffRole }

/**
 * The seeded team, by slot. The property names are the pilot tenant's first names because that is
 * what every downstream seed already reads; for another distributor `salespeople.rahul` simply means
 * "that tenant's first rep", `delivery.ganesh` "its first driver", and so on.
 */
export interface PeopleResult {
  owner: PersonRef
  manager: PersonRef
  accountant: PersonRef
  warehouse: PersonRef
  /** The second godown hand: waves alternate between the two so the picking sheets look real. */
  warehouse2: PersonRef
  salespeople: { rahul: PersonRef; amit: PersonRef; pooja: PersonRef }
  delivery: { ganesh: PersonRef; raju: PersonRef; santosh: PersonRef; iqbal: PersonRef }
  retailerUsers: [PersonRef, PersonRef]
  /** The roster's `extra` members, with their roles; empty when the roster names none. */
  extra: ExtraPerson[]
}

const person = (spec: PersonSpec): PersonRef => ({
  id: spec.id ?? demoId('user', spec.key),
  name: spec.name,
  phone: spec.phone,
  username: spec.username,
})

/** `rahul.deshmukh` -> `rahul`: the short key the rep-scoped demo ids have always been built from. */
export const shortKey = (p: PersonRef): string => p.username.split('.')[0] ?? p.username

/** The pilot distributor's team (Tarsun Enterprises, Kalyan West). */
export const TARSUN_ROSTER: PeopleRoster = {
  owner: { key: 'owner', name: 'Sunil Tarsun', phone: '+919810000001', username: 'sunil.tarsun' },
  manager: { key: 'manager', name: 'Vikas Kadam', phone: '+919810000002', username: 'vikas.kadam' },
  accountant: {
    key: 'accountant',
    name: 'Meena Joshi',
    phone: '+919810000003',
    username: 'meena.joshi',
  },
  warehouse: [
    {
      key: 'warehouse-dinesh',
      name: 'Dinesh Patil',
      phone: '+919810000031',
      username: 'dinesh.patil',
    },
    {
      key: 'warehouse-kavita',
      name: 'Kavita Sawant',
      phone: '+919810000032',
      username: 'kavita.sawant',
    },
  ],
  salespeople: [
    {
      key: 'rep-rahul',
      name: 'Rahul Deshmukh',
      phone: '+919810000011',
      username: 'rahul.deshmukh',
    },
    { key: 'rep-amit', name: 'Amit Pawar', phone: '+919810000012', username: 'amit.pawar' },
    { key: 'rep-pooja', name: 'Pooja Shinde', phone: '+919810000013', username: 'pooja.shinde' },
  ],
  delivery: [
    {
      key: 'delivery-ganesh',
      name: 'Ganesh More',
      phone: '+919810000021',
      username: 'ganesh.more',
    },
    { key: 'delivery-raju', name: 'Raju Yadav', phone: '+919810000022', username: 'raju.yadav' },
    {
      key: 'delivery-santosh',
      name: 'Santosh Kamble',
      phone: '+919810000023',
      username: 'santosh.kamble',
    },
    {
      key: 'delivery-iqbal',
      name: 'Iqbal Shaikh',
      phone: '+919810000024',
      username: 'iqbal.shaikh',
    },
  ],
  retailerUsers: [
    {
      key: 'retailer-user-1',
      name: 'Ramesh Gupta',
      phone: '+919810000101',
      username: 'ramesh.gupta',
    },
    {
      key: 'retailer-user-2',
      name: 'Fatima Shaikh',
      phone: '+919810000102',
      username: 'fatima.shaikh',
    },
  ],
  // The eight who joined as the pilot grew to six beats (spec §2.7); phones continue each block.
  extra: [
    {
      key: 'owner-anil',
      name: 'Anil Tarsun',
      phone: '+919810000004',
      username: 'anil.tarsun',
      role: 'owner',
    },
    {
      key: 'manager-snehal',
      name: 'Snehal Rane',
      phone: '+919810000005',
      username: 'snehal.rane',
      role: 'manager',
    },
    {
      key: 'accountant-amol',
      name: 'Amol Vaidya',
      phone: '+919810000006',
      username: 'amol.vaidya',
      role: 'accountant',
    },
    {
      key: 'rep-sandeep',
      name: 'Sandeep Mane',
      phone: '+919810000014',
      username: 'sandeep.mane',
      role: 'salesperson',
    },
    {
      key: 'rep-ruksana',
      name: 'Ruksana Shaikh',
      phone: '+919810000015',
      username: 'ruksana.shaikh',
      role: 'salesperson',
    },
    {
      key: 'warehouse-prashant',
      name: 'Prashant Gawde',
      phone: '+919810000033',
      username: 'prashant.gawde',
      role: 'warehouse',
    },
    {
      key: 'delivery-tanaji',
      name: 'Tanaji Bhosale',
      phone: '+919810000025',
      username: 'tanaji.bhosale',
      role: 'delivery',
    },
    {
      key: 'delivery-mahesh',
      name: 'Mahesh Sutar',
      phone: '+919810000026',
      username: 'mahesh.sutar',
      role: 'delivery',
    },
  ],
}

export async function seedPeople(
  db: Db,
  tenantId: string,
  passwordHash: string,
  roster: PeopleRoster = TARSUN_ROSTER,
): Promise<PeopleResult> {
  const owner = person(roster.owner)
  const manager = person(roster.manager)
  const accountant = person(roster.accountant)
  const [rahul, amit, pooja] = roster.salespeople.map(person) as [PersonRef, PersonRef, PersonRef]
  const [ganesh, raju, santosh, iqbal] = roster.delivery.map(person) as [
    PersonRef,
    PersonRef,
    PersonRef,
    PersonRef,
  ]
  const [warehouse, warehouse2] = roster.warehouse.map(person) as [PersonRef, PersonRef]
  const [retailerUser1, retailerUser2] = roster.retailerUsers.map(person) as [PersonRef, PersonRef]
  const extra: ExtraPerson[] = (roster.extra ?? []).map((spec) => ({
    ...person(spec),
    role: spec.role,
  }))

  const staff = [
    owner,
    manager,
    accountant,
    rahul,
    amit,
    pooja,
    ganesh,
    raju,
    santosh,
    iqbal,
    warehouse,
    warehouse2,
    ...extra,
  ]
  const retailerUsers = [retailerUser1, retailerUser2]

  // must_change_password stays false on purpose: these are demo accounts, and a forced password change on
  // first sign-in would block every screenshot and every app walkthrough.
  const credentials = { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() }
  await insertMany(db, users, [
    ...staff.map((p) => ({
      id: p.id,
      phone: p.phone,
      name: p.name,
      locale: 'mr-IN',
      username: p.username,
      ...credentials,
    })),
    ...retailerUsers.map((p) => ({
      id: p.id,
      phone: p.phone,
      name: p.name,
      locale: 'hi-IN',
      username: p.username,
      ...credentials,
    })),
  ])

  // The insert above is onConflictDoNothing, so rows seeded before usernames existed would keep none.
  await backfillCredentials(db, [...staff, ...retailerUsers], passwordHash)

  const roleFor: Record<string, (typeof membershipRole.enumValues)[number]> = {
    [owner.id]: 'owner',
    [manager.id]: 'manager',
    [accountant.id]: 'accountant',
    [rahul.id]: 'salesperson',
    [amit.id]: 'salesperson',
    [pooja.id]: 'salesperson',
    [ganesh.id]: 'delivery',
    [raju.id]: 'delivery',
    [santosh.id]: 'delivery',
    [iqbal.id]: 'delivery',
    [warehouse.id]: 'warehouse',
    [warehouse2.id]: 'warehouse',
    ...Object.fromEntries(extra.map((p) => [p.id, p.role])),
  }

  await insertMany(db, memberships, [
    ...staff.map((p) => ({
      id: demoId('membership', p.id),
      tenantId,
      userId: p.id,
      role: roleFor[p.id] ?? 'salesperson',
    })),
    ...retailerUsers.map((p) => ({
      id: demoId('membership', p.id),
      tenantId,
      userId: p.id,
      role: 'retailer' as const,
    })),
  ])

  const extraReps = extra.filter((p) => p.role === 'salesperson')

  // The third rep is employed by Guiltfree Industries and sells only Too Yumm (Pooja Shinde at the
  // pilot); the other two — and the extra reps — sell the full catalog.
  await insertMany(db, repProductAuthorisations, [
    ...BRAND_KEYS.map((key) => ({
      id: demoId('rep-auth', `${shortKey(rahul)}:${key}`),
      tenantId,
      userId: rahul.id,
      brandId: brandId(key),
      employedBy: 'distributor',
    })),
    ...BRAND_KEYS.map((key) => ({
      id: demoId('rep-auth', `${shortKey(amit)}:${key}`),
      tenantId,
      userId: amit.id,
      brandId: brandId(key),
      employedBy: 'distributor',
    })),
    {
      id: demoId('rep-auth', `${shortKey(pooja)}:tooyumm`),
      tenantId,
      userId: pooja.id,
      brandId: brandId('tooyumm'),
      employedBy: 'manufacturer',
    },
    ...extraReps.flatMap((rep) =>
      BRAND_KEYS.map((key) => ({
        id: demoId('rep-auth', `${shortKey(rep)}:${key}`),
        tenantId,
        userId: rep.id,
        brandId: brandId(key),
        employedBy: 'distributor',
      })),
    ),
  ])

  await insertMany(
    db,
    repAutoApproveBounds,
    [rahul, amit, pooja, ...extraReps].map((rep) => ({
      id: demoId('rep-bound', rep.id),
      tenantId,
      userId: rep.id,
      maxDiscountBps: 300,
      floorBasis: 'tier_price' as const,
    })),
  )

  await insertMany(db, devices, [
    {
      id: demoId('device', owner.id),
      userId: owner.id,
      platform: 'web' as const,
      model: 'Chrome desktop',
    },
    {
      id: demoId('device', rahul.id),
      userId: rahul.id,
      platform: 'android' as const,
      model: 'Redmi Note 13',
    },
    {
      id: demoId('device', ganesh.id),
      userId: ganesh.id,
      platform: 'android' as const,
      model: 'Samsung Galaxy M14',
    },
    {
      id: demoId('device', warehouse.id),
      userId: warehouse.id,
      platform: 'android' as const,
      model: 'Moto G54 (godown)',
    },
    ...extraReps.slice(0, 2).map((rep, i) => ({
      id: demoId('device', rep.id),
      userId: rep.id,
      platform: 'android' as const,
      model: i === 0 ? 'Realme Narzo 60' : 'Samsung Galaxy A15',
    })),
  ])

  return {
    owner,
    manager,
    accountant,
    warehouse,
    warehouse2,
    salespeople: { rahul, amit, pooja },
    delivery: { ganesh, raju, santosh, iqbal },
    retailerUsers: [retailerUser1, retailerUser2],
    extra,
  }
}

/**
 * Every demo insert is `onConflictDoNothing()` against a deterministic id, so a database seeded before
 * usernames existed would keep users with no credentials for ever. One statement fills in the gap and
 * touches nothing that already has a username (a founder who changed their own password keeps it).
 */
async function backfillCredentials(
  db: Db,
  people: PersonRef[],
  passwordHash: string,
): Promise<void> {
  const values = sql.join(
    people.map((p) => sql`(${p.id}, ${p.username})`),
    sql`, `,
  )
  await db.execute(sql`
    UPDATE users SET username = v.username, password_hash = ${passwordHash},
                     password_changed_at = now(), must_change_password = false, updated_at = now()
    FROM (VALUES ${values}) AS v(id, username)
    WHERE users.id = v.id AND users.username IS NULL
  `)
}
