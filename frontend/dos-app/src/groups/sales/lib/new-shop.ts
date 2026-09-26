/**
 * DOS-211 — a shop the rep has just added is on the SERVER a few seconds before it is on the phone.
 *
 * The shop card (S2) reads the device's `retailers` table, and that table receives a new row only
 * with the next `sync/pull`. The New shop form used to `replace` to the card the moment
 * `POST /sales/retailers` answered, so the rep read "That shop is not on this phone" over the shop
 * they had just added — for 5 s on day 1 of the simulation, and for more than 16 s on the second shop
 * — and a rep at a counter reads that as "it did not save" and taps Add again: a duplicate shop.
 *
 * The cure is the one `orders/[id].tsx` already uses for an order placed a moment ago: the device's
 * row when it has one, the service's reply when it does not. The POST's own reply seeds the card's
 * `retailers.get` cache entry before the navigation, so the card opens on the shop at once with no
 * second request; a card opened any other way before the pull asks `retailers.get` itself.
 *
 * This file is the one translation between the two shapes: the wire's camelCase `Retailer` (the
 * contract's, never re-declared) into the device's snake_case `LocalRetailer` the card already
 * renders, so the card has exactly one rendering path whichever copy it holds.
 */
import type { RetailerView } from '@dos/contracts'

import type { LocalRetailer } from './local'

/** The query key the card reads the service's copy under; the form seeds the same key. */
export function shopQueryKey(retailerId: string): readonly ['retailers', 'get', string] {
  return ['retailers', 'get', retailerId]
}

/**
 * The service's retailer as the card's device row. A staff reply carries the code, tier and credit
 * terms; the public shape (the retailer role's) does not, and those come back `null` — "not known
 * here", which the card already prints as "—" — never a made-up zero.
 */
export function localShopOf(item: RetailerView): LocalRetailer {
  const staff = 'code' in item ? item : null
  return {
    id: item.id,
    code: staff?.code ?? null,
    name: item.name,
    owner_name: item.ownerName,
    phone: item.phone,
    alt_phone: item.altPhone,
    address: addressOf(item.address),
    lat: item.lat,
    lng: item.lng,
    beat_id: item.beatId,
    tier: staff?.tier ?? null,
    gst_reg_type: item.gstRegType,
    gstin: item.gstin,
    state_code: item.stateCode,
    credit_limit_paise: staff?.creditLimitPaise ?? null,
    credit_limit_bills: staff?.creditLimitBills ?? null,
    credit_days: staff?.creditDays ?? null,
    credit_mode: staff?.creditMode ?? null,
    payment_terms: item.paymentTerms,
    cash_discount_bps: item.cashDiscountBps,
    cash_discount_days: item.cashDiscountDays,
    active: item.active,
    updated_at: null,
  }
}

/** The device keeps the address as string fields only; anything else an import carried is dropped. */
function addressOf(address: RetailerView['address']): Record<string, string> | null {
  if (address === null) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(address))
    if (typeof value === 'string') out[key] = value
  return out
}

/**
 * Which copy the card renders: the device's when it has the row (it is the one that works with no
 * signal and carries this phone's own pending writes), else the service's, else nothing.
 */
export function shopToShow(
  device: LocalRetailer | null,
  service: RetailerView | undefined,
): LocalRetailer | null {
  if (device !== null) return device
  return service === undefined ? null : localShopOf(service)
}
