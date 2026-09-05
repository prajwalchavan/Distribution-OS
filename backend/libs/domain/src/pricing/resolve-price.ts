import { multiply, paise, percentOf, subtract, type Paise } from '../money.js'

/**
 * Price precedence agreed in the blueprint:
 *   1. retailer-specific override (owner-set or rep-proposed + owner-approved) beats the tier price
 *   2. schemes stack on top unless the override is flagged `final`
 *   3. a bargain (negotiated) discount, already approved, is applied last within the rep's limit
 */
export type Scheme =
  | { kind: 'percent_off'; bps: number }
  | { kind: 'flat_off_per_unit'; amount: Paise }
  | { kind: 'free_qty'; buy: number; free: number }

export interface PriceInput {
  tierUnitPrice: Paise
  override?: { unitPrice: Paise; final: boolean } | undefined
  schemes?: readonly Scheme[] | undefined
  quantity: number
  bargainBps?: number | undefined
}

export interface PriceResult {
  unitPrice: Paise
  quantity: number
  freeQuantity: number
  gross: Paise
  schemeDiscount: Paise
  bargainDiscount: Paise
  net: Paise
  applied: string[]
}

export function resolvePrice(input: PriceInput): PriceResult {
  const applied: string[] = []
  let unitPrice = input.tierUnitPrice
  if (input.override) {
    unitPrice = input.override.unitPrice
    applied.push(input.override.final ? 'override:final' : 'override')
  }
  const gross = multiply(unitPrice, input.quantity)
  let schemeDiscount = paise(0)
  let freeQuantity = 0
  const schemesAllowed = !(input.override?.final ?? false)
  if (schemesAllowed) {
    for (const scheme of input.schemes ?? []) {
      switch (scheme.kind) {
        case 'percent_off':
          schemeDiscount = paise(schemeDiscount + percentOf(gross, scheme.bps))
          applied.push(`scheme:percent_off:${scheme.bps}`)
          break
        case 'flat_off_per_unit':
          schemeDiscount = paise(schemeDiscount + multiply(scheme.amount, input.quantity))
          applied.push('scheme:flat_off_per_unit')
          break
        case 'free_qty':
          if (scheme.buy > 0) {
            freeQuantity += Math.floor(input.quantity / scheme.buy) * scheme.free
            applied.push(`scheme:free_qty:${scheme.buy}+${scheme.free}`)
          }
          break
      }
    }
  }
  const afterSchemes = subtract(gross, schemeDiscount)
  const bargainDiscount = input.bargainBps ? percentOf(afterSchemes, input.bargainBps) : paise(0)
  if (bargainDiscount > 0) applied.push(`bargain:${input.bargainBps ?? 0}`)
  return {
    unitPrice,
    quantity: input.quantity,
    freeQuantity,
    gross,
    schemeDiscount,
    bargainDiscount,
    net: subtract(afterSchemes, bargainDiscount),
    applied,
  }
}
