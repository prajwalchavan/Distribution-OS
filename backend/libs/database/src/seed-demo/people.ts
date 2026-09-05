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

export interface PeopleResult {
  owner: PersonRef
  manager: PersonRef
  accountant: PersonRef
  warehouse: PersonRef
  salespeople: { rahul: PersonRef; amit: PersonRef; pooja: PersonRef }
  delivery: { ganesh: PersonRef; raju: PersonRef; santosh: PersonRef; iqbal: PersonRef }
  retailerUsers: [PersonRef, PersonRef]
}

const person = (key: string, name: string, phone: string, username: string): PersonRef => ({
  id: demoId('user', key),
  name,
  phone,
  username,
})

export async function seedPeople(
  db: Db,
  tenantId: string,
  passwordHash: string,
): Promise<PeopleResult> {
  const owner = person('owner', 'Sunil Tarsun', '+919810000001', 'sunil.tarsun')
  const manager = person('manager', 'Vikas Kadam', '+919810000002', 'vikas.kadam')
  const accountant = person('accountant', 'Meena Joshi', '+919810000003', 'meena.joshi')
  const rahul = person('rep-rahul', 'Rahul Deshmukh', '+919810000011', 'rahul.deshmukh')
  const amit = person('rep-amit', 'Amit Pawar', '+919810000012', 'amit.pawar')
  const pooja = person('rep-pooja', 'Pooja Shinde', '+919810000013', 'pooja.shinde')
  const ganesh = person('delivery-ganesh', 'Ganesh More', '+919810000021', 'ganesh.more')
  const raju = person('delivery-raju', 'Raju Yadav', '+919810000022', 'raju.yadav')
  const santosh = person('delivery-santosh', 'Santosh Kamble', '+919810000023', 'santosh.kamble')
  const iqbal = person('delivery-iqbal', 'Iqbal Shaikh', '+919810000024', 'iqbal.shaikh')
  const warehouse = person('warehouse-dinesh', 'Dinesh Patil', '+919810000031', 'dinesh.patil')
  const retailerUser1 = person('retailer-user-1', 'Ramesh Gupta', '+919810000101', 'ramesh.gupta')
  const retailerUser2 = person('retailer-user-2', 'Fatima Shaikh', '+919810000102', 'fatima.shaikh')

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

  // Pooja is employed by Guiltfree Industries and sells only Too Yumm; the others sell the full catalog.
  await insertMany(db, repProductAuthorisations, [
    ...BRAND_KEYS.map((key) => ({
      id: demoId('rep-auth', `rahul:${key}`),
      tenantId,
      userId: rahul.id,
      brandId: brandId(key),
      employedBy: 'distributor',
    })),
    ...BRAND_KEYS.map((key) => ({
      id: demoId('rep-auth', `amit:${key}`),
      tenantId,
      userId: amit.id,
      brandId: brandId(key),
      employedBy: 'distributor',
    })),
    {
      id: demoId('rep-auth', 'pooja:tooyumm'),
      tenantId,
      userId: pooja.id,
      brandId: brandId('tooyumm'),
      employedBy: 'manufacturer',
    },
  ])

  await insertMany(
    db,
    repAutoApproveBounds,
    [rahul, amit, pooja].map((rep) => ({
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
  ])

  return {
    owner,
    manager,
    accountant,
    warehouse,
    salespeople: { rahul, amit, pooja },
    delivery: { ganesh, raju, santosh, iqbal },
    retailerUsers: [retailerUser1, retailerUser2],
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
