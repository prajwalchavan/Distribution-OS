/**
 * A scheme, said in words a shopkeeper uses (docs/23 §6.1 R9, and the founder's "with the offer said
 * in words").
 *
 * A scheme row is an ECONOMICS record — `triggerKind`, `triggerMin`, `triggerUnit`, `rewardKind`,
 * `rewardValue`, `slabs` — and printing those six on a shop's screen would be printing the database.
 * This file turns exactly that record into one English sentence, through the strings namespace, so
 * Hindi and Marathi are a translation of the same sentence and never a second rendering rule.
 *
 * IT DERIVES NO PRICE. What a shop actually pays comes from `pricing.quote` on the server — the same
 * engine that prices the order and the bill. The sentence here says what the offer IS; the order
 * screen says what it did.
 */
import type { SchemeView } from '@dos/contracts'
import { formatMoney } from '@dos/ui'

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** A percentage held in basis points, printed as a percentage: 200 bps → "2%". */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const frac = Math.abs(bps % 100)
  if (frac === 0) return `${String(whole)}%`
  return `${String(whole)}.${frac.toString().padStart(2, '0').replace(/0$/, '')}%`
}

/** The trigger, in the shop's unit: "5 cases", "20 pieces", "₹5,000 worth". */
function triggerText(t: Translate, scheme: SchemeView): string {
  const min = scheme.triggerMin
  if (scheme.triggerUnit === 'inr') return formatMoney(min)
  return `${String(min)} ${scheme.triggerUnit === 'case' ? t('r9.unitCase') : t('r9.unitPcs')}`
}

/** The unit word alone, for the sentences that interpolate `{min}` and `{unit}` separately. */
function unitText(t: Translate, scheme: SchemeView): string {
  if (scheme.triggerUnit === 'inr') return t('r9.unitAmount')
  return scheme.triggerUnit === 'case' ? t('r9.unitCase') : t('r9.unitPcs')
}

/**
 * The whole offer as one sentence.
 *
 * `rewardValue` means a different thing per `rewardKind` — free PIECES, basis POINTS, or PAISE — and
 * a screen that formatted all five the same way would print "₹2.00 off" for a 2 % scheme. The switch
 * below is that distinction, in one place.
 *
 * TWO THINGS THE FIRST DRAFT OF THIS FILE GOT WRONG, BOTH MEASURED ON THE PILOT'S OWN SCHEMES.
 *
 * 1. A **cash discount is not an order discount** (ADR 0004): it is realised at the RECEIPT, only if
 *    the shop pays inside the window, and `priceOrder()` reports it without deducting it. Printing
 *    "take 2% off it" beside an order total that does not include it is the app promising money the
 *    bill will not carry. It gets its own sentence.
 * 2. A trigger of **zero** is "on any order", not "spend ₹0.00" — which is what Tarsun's own Too Yumm
 *    cash-discount scheme printed.
 *
 * `freeItemName` is the free variant's own name where the caller could resolve it; a scheme that
 * gives a DIFFERENT item away and cannot say which one is worth less than one that names it.
 */
export function offerSentence(
  t: Translate,
  scheme: SchemeView,
  freeItemName?: string | null,
): string {
  const any = scheme.triggerMin <= 0
  const min =
    scheme.triggerUnit === 'inr' ? formatMoney(scheme.triggerMin) : String(scheme.triggerMin)
  const unit = unitText(t, scheme)
  switch (scheme.rewardKind) {
    case 'free_qty':
      if (scheme.freeVariantId === null)
        return t('r9.freeQty', { min, unit, reward: String(scheme.rewardValue) })
      return freeItemName === null || freeItemName === undefined || freeItemName === ''
        ? t('r9.freeItem', { min, unit, reward: String(scheme.rewardValue) })
        : t('r9.freeItemNamed', {
            min,
            unit,
            reward: String(scheme.rewardValue),
            item: freeItemName,
          })
    case 'line_pct':
      return any
        ? t('r9.linePctAny', { pct: formatBps(scheme.rewardValue) })
        : t('r9.linePct', { min, unit, pct: formatBps(scheme.rewardValue) })
    case 'order_pct':
      return any
        ? t('r9.orderPctAny', { pct: formatBps(scheme.rewardValue) })
        : t('r9.orderPct', { min: triggerText(t, scheme), pct: formatBps(scheme.rewardValue) })
    case 'cash_discount_pct':
      return any
        ? t('r9.cashPctAny', { pct: formatBps(scheme.rewardValue) })
        : t('r9.cashPct', { min: triggerText(t, scheme), pct: formatBps(scheme.rewardValue) })
    case 'net_scheme_amount':
      return scheme.triggerUnit === 'inr'
        ? t('r9.orderAmount', {
            min: triggerText(t, scheme),
            amount: formatMoney(scheme.rewardValue),
          })
        : t('r9.lineAmount', { min, unit, amount: formatMoney(scheme.rewardValue) })
  }
}

/** "More you buy, more you save: 5+ → 2%, 10+ → 4%" — the slab ladder, or null when there is none. */
export function slabSentence(t: Translate, scheme: SchemeView): string | null {
  const slabs = scheme.slabs ?? []
  if (slabs.length === 0) return null
  const money = scheme.rewardKind === 'net_scheme_amount'
  const rungs = slabs
    .map((slab) =>
      t('r9.slab', {
        min: String(slab.min),
        value: money ? formatMoney(slab.value) : formatBps(slab.value),
      }),
    )
    .join(' · ')
  return t('r9.slabs', { slabs: rungs })
}

/** What the offer applies to: everything, one brand, or a named set of items. */
export function scopeSentence(
  t: Translate,
  scheme: SchemeView,
  brandName: string | undefined,
): string {
  if (scheme.scope.all === true) return t('r9.allItems')
  if (brandName !== undefined && brandName !== '') return t('r9.brand', { brand: brandName })
  return t('r9.someItems')
}

/**
 * A scheme this shop can act on today.
 *
 * `schemes.list` already filters by `applicability` for the retailer role and by `activeOnly`, but the
 * seeded database also carries rows left behind by `pnpm smoke` whose window is a single day in the
 * past (docs/23 §10). A shop's offers screen opening on somebody's test data is worse than an empty
 * one, so the window is checked here as well — the server's own rule, applied to what it returned.
 */
export function runningToday(scheme: SchemeView, on: string): boolean {
  return scheme.active && scheme.validFrom <= on && scheme.validTo >= on
}
