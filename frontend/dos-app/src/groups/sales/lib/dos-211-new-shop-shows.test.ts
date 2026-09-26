/**
 * DOS-211 — after "Add shop" the rep's phone said "That shop is not on this phone".
 *
 * Day 1 of the business simulation: `POST /sales/retailers` answered 200 with R-9025, the form
 * replaced to `/shops/<id>`, and the card — which read only the device's `retailers` table — said the
 * shop was not on the phone until the next `sync/pull` carried the row (5 s for the first shop, more
 * than 16 s for the second). A rep reads that as "it did not save" and adds the shop again.
 *
 * The first half is the translation the card now renders the service's copy through: the REPLY the
 * sales service actually sends (the contract's own `RetailerSchema`, parsed, not a hand-typed object)
 * must become the device row the card prints, field for field. The second half reads the two screens
 * as text — importing a screen in Node pulls in `expo-router` — to hold the wiring: the form seeds the
 * card's entry with its reply before it navigates, and the card falls back to the service before it
 * says "not on this phone".
 */
import { RetailerPublicSchema, RetailerSchema, UpsertRetailerOutput } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import type { LocalRetailer } from './local'
import { localShopOf, shopQueryKey, shopToShow } from './new-shop'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function source(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
}

/** The reply day 1 recorded for R-9025, as the wire carries it, parsed by the contract. */
const REPLY = UpsertRetailerOutput.parse({
  item: {
    id: '01a0c3d0-5653-755b-9a6d-cf98f867d55a',
    code: 'R-9025',
    name: 'Navjeevan Kirana Stores',
    ownerName: 'Suresh Navale',
    phone: '+919876543201',
    altPhone: null,
    address: {
      line1: 'Shop 3, Rajaji Path',
      area: 'Station Road',
      city: 'Kalyan',
      pincode: '421301',
    },
    lat: null,
    lng: null,
    beatId: '7298470d-0000-7000-8000-000000000001',
    gstRegType: 'unregistered',
    gstin: null,
    stateCode: '27',
    paymentTerms: 'POST_FULFILLMENT',
    cashDiscountBps: 0,
    cashDiscountDays: 0,
    active: true,
    identityId: null,
    tier: 'C',
    creditLimitPaise: 0,
    creditLimitBills: 0,
    creditDays: 0,
    creditMode: 'indicate',
    onboardedBy: '8760e17e-0000-7000-8000-000000000001',
  },
})

describe('DOS-211: the service copy of a new shop, as the card renders it', () => {
  it('turns the POST reply into the device row, field for field', () => {
    const row = localShopOf(REPLY.item)
    expect(row).toEqual({
      id: '01a0c3d0-5653-755b-9a6d-cf98f867d55a',
      code: 'R-9025',
      name: 'Navjeevan Kirana Stores',
      owner_name: 'Suresh Navale',
      phone: '+919876543201',
      alt_phone: null,
      address: {
        line1: 'Shop 3, Rajaji Path',
        area: 'Station Road',
        city: 'Kalyan',
        pincode: '421301',
      },
      lat: null,
      lng: null,
      beat_id: '7298470d-0000-7000-8000-000000000001',
      tier: 'C',
      gst_reg_type: 'unregistered',
      gstin: null,
      state_code: '27',
      credit_limit_paise: 0,
      credit_limit_bills: 0,
      credit_days: 0,
      credit_mode: 'indicate',
      payment_terms: 'POST_FULFILLMENT',
      cash_discount_bps: 0,
      cash_discount_days: 0,
      active: true,
      updated_at: null,
    } satisfies LocalRetailer)
  })

  it('never invents credit terms from the public shape: unknown is null, not zero', () => {
    const publicOnly = RetailerPublicSchema.parse(REPLY.item)
    const row = localShopOf(publicOnly)
    expect(row.code).toBeNull()
    expect(row.tier).toBeNull()
    expect(row.credit_limit_paise).toBeNull()
    expect(row.credit_mode).toBeNull()
    // …while what the shop may see of itself is still there.
    expect(row.payment_terms).toBe('POST_FULFILLMENT')
  })

  it('prefers the phone’s row the moment the pull brings it, else the service’s, else nothing', () => {
    const device: LocalRetailer = { ...localShopOf(REPLY.item), name: 'From the pull' }
    expect(shopToShow(device, REPLY.item)?.name).toBe('From the pull')
    expect(shopToShow(null, REPLY.item)?.code).toBe('R-9025')
    expect(shopToShow(null, undefined)).toBeNull()
  })

  it('reads a staff reply through the same union the card’s query returns', () => {
    expect(RetailerSchema.safeParse(REPLY.item).success).toBe(true)
    expect(shopQueryKey(REPLY.item.id)).toEqual(['retailers', 'get', REPLY.item.id])
  })
})

describe('DOS-211: the wiring on the two screens', () => {
  it('the form fills the card’s entry with its own reply BEFORE it navigates, and asks for a pull', async () => {
    const form = await source('../../../../app/sales/shops/new.tsx')
    const seeded = form.indexOf('cache.setData(shopQueryKey(result.item.id), result)')
    const synced = form.indexOf("engine?.sync('shop added')")
    const moved = form.indexOf('go.replace(`/shops/${result.item.id}`)')
    expect(seeded).toBeGreaterThan(-1)
    expect(synced).toBeGreaterThan(-1)
    expect(moved).toBeGreaterThan(seeded)
  })

  it('the card asks the service under the same key before it says "not on this phone"', async () => {
    const card = await source('../../../../app/sales/shops/[id].tsx')
    expect(card).toMatch(
      /useQuery\(\s?shopQueryKey\(retailerId\),\s?\(\) => api\.api\.retailers\.get\(/,
    )
    expect(card).toContain('const shop = shopToShow(deviceShop, serviceShop.data?.item)')
    // While the service is being asked the card is loading, not empty.
    expect(card).toMatch(/loading=\{\s?askService && serviceShop\.data === undefined/)
  })
})
