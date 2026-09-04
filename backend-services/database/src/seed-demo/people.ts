/** Staff and retailer-app users, their tenant memberships, brand authorisations and bargain bounds. */
import { insertMany } from './db-helpers.js'
import {
  devices,
  memberships,
  repAutoApproveBounds,
  repProductAuthorisations,
  users,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { BRAND_KEYS, brandId } from './catalog.js'
import { demoId } from './ids.js'

export interface PersonRef {
  id: string
  name: string
  phone: string
}

export interface PeopleResult {
  owner: PersonRef
  manager: PersonRef
  accountant: PersonRef
  salespeople: { rahul: PersonRef; amit: PersonRef; pooja: PersonRef }
  delivery: { ganesh: PersonRef; raju: PersonRef; santosh: PersonRef; iqbal: PersonRef }
  retailerUsers: [PersonRef, PersonRef]
}

const person = (key: string, name: string, phone: string): PersonRef => ({
  id: demoId('user', key),
  name,
  phone,
})

export async function seedPeople(db: Db, tenantId: string): Promise<PeopleResult> {
  const owner = person('owner', 'Sunil Tarsun', '+919810000001')
  const manager = person('manager', 'Vikas Kadam', '+919810000002')
  const accountant = person('accountant', 'Meena Joshi', '+919810000003')
  const rahul = person('rep-rahul', 'Rahul Deshmukh', '+919810000011')
  const amit = person('rep-amit', 'Amit Pawar', '+919810000012')
  const pooja = person('rep-pooja', 'Pooja Shinde', '+919810000013')
  const ganesh = person('delivery-ganesh', 'Ganesh More', '+919810000021')
  const raju = person('delivery-raju', 'Raju Yadav', '+919810000022')
  const santosh = person('delivery-santosh', 'Santosh Kamble', '+919810000023')
  const iqbal = person('delivery-iqbal', 'Iqbal Shaikh', '+919810000024')
  const retailerUser1 = person('retailer-user-1', 'Ramesh Gupta', '+919810000101')
  const retailerUser2 = person('retailer-user-2', 'Fatima Shaikh', '+919810000102')

  const staff = [owner, manager, accountant, rahul, amit, pooja, ganesh, raju, santosh, iqbal]
  const retailerUsers = [retailerUser1, retailerUser2]

  await insertMany(db, users, [
    ...staff.map((p) => ({ id: p.id, phone: p.phone, name: p.name, locale: 'mr-IN' })),
    ...retailerUsers.map((p) => ({ id: p.id, phone: p.phone, name: p.name, locale: 'hi-IN' })),
  ])

  const roleFor: Record<string, 'owner' | 'manager' | 'accountant' | 'salesperson' | 'delivery'> = {
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
  ])

  return {
    owner,
    manager,
    accountant,
    salespeople: { rahul, amit, pooja },
    delivery: { ganesh, raju, santosh, iqbal },
    retailerUsers: [retailerUser1, retailerUser2],
  }
}
