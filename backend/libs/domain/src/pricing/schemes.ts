import { allocate, multiply, paise, percentOf, subtract, sum, type Paise } from '../money.js'
import { pieces } from '../quantity.js'

/**
 * ADR 0008: `priceOrder()` is THE pricing engine. Pure, zero dependencies, identical on device and server.
 *
 * Precedence (fixed):
 *   1. tier price from the retailer's price list (`tierPrices`)
 *   2. retailer override wins; `final` = nothing stacks on top of it (no schemes on that line)
 *   3. schemes stack; a non-stackable (or `final`) scheme applies alone — the engine picks whichever is worth
 *      more to the retailer: every stackable scheme together, or the single best exclusive one
 *   4. approved bargain last: the negotiated rate replaces the rate, the difference is a `bargain` rule
 *   5. cash discount is CONDITIONAL (realised at receipt, ADR 0004): reported, never deducted
 *
 * Every applied rule is returned as an `AppliedRule` so the bill prints Free / Scheme % / Disc ₹ / Cash Dis %
 * exactly and claims reconstruct later. Money never loses a paisa: order-level rewards spread with `allocate()`.
 */

export type SchemeTriggerKind = 'qty' | 'value' | 'mix'
export type SchemeTriggerUnit = 'pcs' | 'case' | 'inr'
export type SchemeRewardKind =
  'free_qty' | 'line_pct' | 'order_pct' | 'cash_discount_pct' | 'net_scheme_amount'
export type SchemeFundingSource = 'company' | 'distributor'
export type PricingDateMode = 'order' | 'delivery'

/** Which lines a scheme looks at. `{}` (nothing set) matches nothing; say `all: true` explicitly. */
export interface SchemeScope {
  all?: boolean | undefined
  brandIds?: readonly string[] | undefined
  categories?: readonly string[] | undefined
  variantIds?: readonly string[] | undefined
}

/**
 * Quantity/value slab: the highest slab whose `min` ≤ the measured quantity (or value) wins and its `value`
 * replaces `rewardValue`; slab rewards apply once (a "buy 24 get 3, buy 48 get 8" TOD), unlike a slab-less
 * scheme whose free_qty / net_scheme_amount reward repeats for every multiple of `triggerMin` (a "12 + 1").
 */
export interface SchemeSlab {
  /** Same unit as the scheme's `triggerMin`: pieces, whole cases, or paise for `inr`. */
  min: number
  value: number
  freeVariantId?: string | undefined
}

/** Empty / missing lists mean "no restriction"; every list that is set must match (AND). */
export interface SchemeApplicability {
  tiers?: readonly string[] | undefined
  retailerIds?: readonly string[] | undefined
  beatIds?: readonly string[] | undefined
}

/** Mirrors the `schemes` table (backend/db/src/schema/pricing.ts). The engine reads nothing else. */
export interface SchemeRule {
  id: string
  name?: string | undefined
  version: number
  scope: SchemeScope
  /** `qty` / `value`: measured per line. `mix`: measured over every in-scope line together (assortment). */
  triggerKind: SchemeTriggerKind
  /** Pieces (`pcs`), whole cases (`case`) or PAISE of gross in-scope line value (`inr`: 2_500_000 = ₹25,000). */
  triggerMin: number
  /** `pcs` | `case` (whole cases of the line's case size) | `inr` (paise of gross in-scope line value). */
  triggerUnit: SchemeTriggerUnit
  slabs?: readonly SchemeSlab[] | null | undefined
  rewardKind: SchemeRewardKind
  /** free pieces (`free_qty`), basis points (`*_pct`) or paise (`net_scheme_amount`). */
  rewardValue: number
  freeVariantId?: string | null | undefined
  applicability: SchemeApplicability
  /** ISO dates (YYYY-MM-DD), inclusive. */
  validFrom: string
  validTo: string
  stackable: boolean
  /** Application order among stacked rules (asc); ties by id. Review item 14. Defaults to 0. */
  priority?: number | undefined
  /** When chosen, nothing else applies to that line: no other scheme and no bargain. */
  final: boolean
  fundingSource: SchemeFundingSource
  claimable: boolean
  gstOnFreeGoods: boolean
  /** Which date the validity window is checked against: the order date or the delivery date. */
  pricingDateMode: PricingDateMode
}

/**
 * One rule the engine applied, stored on every order/invoice line (`applied_rules jsonb`).
 * Keep IDENTICAL to `AppliedRule` in backend/db/src/schema/orders.ts.
 */
export interface AppliedRule {
  ruleId: string
  version: number
  kind: 'override' | 'scheme' | 'bargain' | 'manual'
  rewardKind?: string
  amountPaise?: number
  freeQty?: number
  freeVariantId?: string
}

export interface PriceOrderLineInput {
  lineId: string
  variantId: string
  brandId?: string | null | undefined
  category?: string | null | undefined
  qtyPcs: number
  caseSize: number
}

export interface PriceOverrideInput {
  id?: string | undefined
  variantId: string
  ratePaise: number
  final: boolean
}

export interface PriceBargainInput {
  id?: string | undefined
  variantId: string
  ratePaise: number
}

export interface PriceOrderInput {
  /** ISO date the order is priced on. */
  pricingDate: string
  /** Optional expected delivery date; schemes with `pricingDateMode: 'delivery'` are validated against it. */
  deliveryDate?: string | undefined
  retailer: { id: string; tier: string; beatId?: string | null | undefined }
  lines: readonly PriceOrderLineInput[]
  /** variantId → selling rate per piece in paise, already resolved for the retailer's tier. */
  tierPrices: Readonly<Record<string, number>>
  overrides: readonly PriceOverrideInput[]
  schemes: readonly SchemeRule[]
  approvedBargains: readonly PriceBargainInput[]
}

export interface FreeItem {
  variantId: string
  qtyPcs: number
  ruleId: string
  version: number
}

export interface PricedLine {
  lineId: string
  variantId: string
  qtyPcs: number
  /** Tier price (the "Rate" column). */
  listRatePaise: Paise
  /** Rate actually charged per piece: override or tier, then the bargain rate when one applies. */
  ratePaise: Paise
  /** Line value before any discount or bargain: (override ?? tier) × qty. */
  grossPaise: Paise
  /** Scheme discounts on this line, including its share of order-level rules. */
  discountPaise: Paise
  /** (rate before bargain − bargain rate) × qty. */
  bargainPaise: Paise
  /** Free pieces of THIS variant. Free goods of another variant are only in `freeItems`. */
  freeQtyPcs: number
  freeItems: FreeItem[]
  appliedRules: AppliedRule[]
  /** grossPaise − discountPaise − bargainPaise, before GST. */
  lineNetPaise: Paise
}

export interface PriceOrderResult {
  pricingDate: string
  lines: PricedLine[]
  /** Order-level rules (order_pct, mix-triggered schemes, cash discount) with their order totals. */
  orderRules: AppliedRule[]
  /** Best cash-discount scheme in force. Conditional: realised at receipt, NOT deducted here. */
  cashDiscountBps: number
  cashDiscountPaise: Paise
  totals: {
    grossPaise: Paise
    discountPaise: Paise
    bargainPaise: Paise
    /** Sum of line nets before GST. */
    netPaise: Paise
  }
}

export class PricingError extends Error {
  override name = 'PricingError'
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function isoDate(value: string, what: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value))
    throw new PricingError(`${what} must be an ISO date (YYYY-MM-DD): ${String(value)}`)
  return value.slice(0, 10)
}

function nonNegativeInt(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new PricingError(`${what} must be a non-negative integer: ${value}`)
  return value
}

function bps(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000)
    throw new PricingError(`${what} must be basis points 0..10000: ${value}`)
  return value
}

interface LineState {
  input: PriceOrderLineInput
  listRate: Paise
  baseRate: Paise
  gross: Paise
  schemesAllowed: boolean
  lockedByFinalScheme: boolean
  discount: number
  bargain: number
  bargainRate: Paise | null
  freeItems: FreeItem[]
  rules: AppliedRule[]
}

interface Reward {
  value: number
  multiples: number
  freeVariantId: string | undefined
}

interface Candidate {
  scheme: SchemeRule
  reward: Reward
  /** What the reward is worth to the retailer in paise; used to pick between exclusive schemes. */
  valuePaise: number
  exclusive: boolean
}

export function priceOrder(input: PriceOrderInput): PriceOrderResult {
  const pricingDate = isoDate(input.pricingDate, 'pricingDate')
  const deliveryDate =
    input.deliveryDate === undefined ? undefined : isoDate(input.deliveryDate, 'deliveryDate')
  const seen = new Set<string>()
  for (const line of input.lines) {
    if (seen.has(line.lineId)) throw new PricingError(`Duplicate lineId: ${line.lineId}`)
    seen.add(line.lineId)
  }

  const lines = input.lines.map((line) => resolveBase(line, input))
  const schemes = input.schemes.filter(
    (s) => isValidOn(s, pricingDate, deliveryDate) && isApplicable(s, input.retailer),
  )

  // 3a. line-level schemes (qty/value triggers, line rewards), chosen per line
  for (const line of lines) {
    if (!line.schemesAllowed || line.input.qtyPcs <= 0) continue
    const candidates: Candidate[] = []
    for (const scheme of schemes) {
      if (!isLineLevel(scheme) || !inScope(scheme, line.input)) continue
      const reward = evaluateTrigger(scheme, measure(scheme.triggerUnit, [line]))
      if (!reward) continue
      candidates.push({
        scheme,
        reward,
        valuePaise: lineRewardValue(scheme, reward, line, input.tierPrices),
        exclusive: !scheme.stackable || scheme.final,
      })
    }
    for (const c of chooseStack(candidates)) applyLineReward(c, line, [line])
  }

  // 3b. order-level schemes (order_pct, or any `mix` trigger) over every in-scope line together
  const orderRules: AppliedRule[] = []
  const orderCandidates: Candidate[] = []
  const scopeOf = new Map<string, LineState[]>()
  for (const scheme of schemes) {
    if (isLineLevel(scheme) || scheme.rewardKind === 'cash_discount_pct') continue
    const scope = lines.filter(
      (l) =>
        l.schemesAllowed &&
        !l.lockedByFinalScheme &&
        l.input.qtyPcs > 0 &&
        inScope(scheme, l.input),
    )
    if (scope.length === 0) continue
    const reward = evaluateTrigger(scheme, measure(scheme.triggerUnit, scope))
    if (!reward) continue
    scopeOf.set(scheme.id, scope)
    orderCandidates.push({
      scheme,
      reward,
      valuePaise: orderRewardValue(scheme, reward, scope, input.tierPrices),
      exclusive: !scheme.stackable || scheme.final,
    })
  }
  for (const c of chooseStack(orderCandidates)) {
    const rule = applyOrderReward(c, scopeOf.get(c.scheme.id) ?? [])
    if (rule) orderRules.push(rule)
  }

  // 4. approved bargain last
  for (const line of lines) {
    if (line.lockedByFinalScheme || line.input.qtyPcs <= 0) continue
    const bargain = input.approvedBargains.find((b) => b.variantId === line.input.variantId)
    if (!bargain) continue
    const rate = paise(bargain.ratePaise)
    if (rate < 0 || rate >= line.baseRate) continue
    const amount = multiply(subtract(line.baseRate, rate), line.input.qtyPcs)
    line.bargain = amount
    line.bargainRate = rate
    line.rules.push({
      ruleId: bargain.id ?? `bargain:${bargain.variantId}`,
      version: 1,
      kind: 'bargain',
      amountPaise: amount,
    })
  }

  const priced: PricedLine[] = lines.map((line) => {
    return {
      lineId: line.input.lineId,
      variantId: line.input.variantId,
      qtyPcs: line.input.qtyPcs,
      listRatePaise: line.listRate,
      ratePaise: line.bargainRate ?? line.baseRate,
      grossPaise: line.gross,
      discountPaise: paise(line.discount),
      bargainPaise: paise(line.bargain),
      freeQtyPcs: line.freeItems
        .filter((f) => f.variantId === line.input.variantId)
        .reduce((n, f) => n + f.qtyPcs, 0),
      freeItems: line.freeItems,
      appliedRules: line.rules,
      lineNetPaise: paise(line.gross - line.discount - line.bargain),
    }
  })

  const totals = {
    grossPaise: sum(priced.map((l) => l.grossPaise)),
    discountPaise: sum(priced.map((l) => l.discountPaise)),
    bargainPaise: sum(priced.map((l) => l.bargainPaise)),
    netPaise: sum(priced.map((l) => l.lineNetPaise)),
  }

  // 5. cash discount: conditional, best one in force, reported only
  let cashDiscountBps = 0
  let cashDiscountRule: SchemeRule | undefined
  for (const scheme of schemes) {
    if (scheme.rewardKind !== 'cash_discount_pct') continue
    const scope = lines.filter(
      (l) => l.schemesAllowed && l.input.qtyPcs > 0 && inScope(scheme, l.input),
    )
    if (scope.length === 0) continue
    const reward = evaluateTrigger(scheme, measure(scheme.triggerUnit, scope))
    if (!reward) continue
    const value = bps(reward.value, `scheme ${scheme.id} reward`)
    if (value > cashDiscountBps) {
      cashDiscountBps = value
      cashDiscountRule = scheme
    }
  }
  const cashDiscountPaise =
    cashDiscountBps > 0 ? percentOf(totals.netPaise, cashDiscountBps) : paise(0)
  if (cashDiscountRule) {
    orderRules.push({
      ruleId: cashDiscountRule.id,
      version: cashDiscountRule.version,
      kind: 'scheme',
      rewardKind: 'cash_discount_pct',
      amountPaise: cashDiscountPaise,
    })
  }

  return { pricingDate, lines: priced, orderRules, cashDiscountBps, cashDiscountPaise, totals }
}

// ---------------------------------------------------------------------------------------------------------------
// steps 1–2: tier price and override

function resolveBase(line: PriceOrderLineInput, input: PriceOrderInput): LineState {
  nonNegativeInt(line.qtyPcs, `line ${line.lineId} qtyPcs`)
  if (!Number.isSafeInteger(line.caseSize) || line.caseSize <= 0)
    throw new PricingError(
      `line ${line.lineId} caseSize must be a positive integer: ${line.caseSize}`,
    )
  const tier = input.tierPrices[line.variantId]
  const override = input.overrides.find((o) => o.variantId === line.variantId)
  if (tier === undefined && !override)
    throw new PricingError(`No price for variant ${line.variantId} (line ${line.lineId})`)
  const listRate = paise(tier ?? override?.ratePaise ?? 0)
  const baseRate = override ? paise(override.ratePaise) : listRate
  const rules: AppliedRule[] = []
  if (override) {
    rules.push({
      ruleId: override.id ?? `override:${override.variantId}`,
      version: 1,
      kind: 'override',
      amountPaise: multiply(subtract(listRate, baseRate), line.qtyPcs),
    })
  }
  return {
    input: line,
    listRate,
    baseRate,
    gross: multiply(baseRate, pieces(line.qtyPcs)),
    schemesAllowed: !(override?.final ?? false),
    lockedByFinalScheme: false,
    discount: 0,
    bargain: 0,
    bargainRate: null,
    freeItems: [],
    rules,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// eligibility

function isValidOn(
  scheme: SchemeRule,
  pricingDate: string,
  deliveryDate: string | undefined,
): boolean {
  const on = scheme.pricingDateMode === 'delivery' && deliveryDate ? deliveryDate : pricingDate
  const from = isoDate(scheme.validFrom, `scheme ${scheme.id} validFrom`)
  const to = isoDate(scheme.validTo, `scheme ${scheme.id} validTo`)
  return from <= on && on <= to
}

function isApplicable(scheme: SchemeRule, retailer: PriceOrderInput['retailer']): boolean {
  const a = scheme.applicability
  if (a.tiers && a.tiers.length > 0 && !a.tiers.includes(retailer.tier)) return false
  if (a.retailerIds && a.retailerIds.length > 0 && !a.retailerIds.includes(retailer.id))
    return false
  if (
    a.beatIds &&
    a.beatIds.length > 0 &&
    (!retailer.beatId || !a.beatIds.includes(retailer.beatId))
  )
    return false
  return true
}

function inScope(scheme: SchemeRule, line: PriceOrderLineInput): boolean {
  const s = scheme.scope
  if (s.all) return true
  if (s.variantIds?.includes(line.variantId)) return true
  if (line.brandId && s.brandIds?.includes(line.brandId)) return true
  if (line.category && s.categories?.includes(line.category)) return true
  return false
}

/** Line-level = per-line trigger with a per-line reward. Everything else is decided over the whole order. */
function isLineLevel(scheme: SchemeRule): boolean {
  return (
    scheme.triggerKind !== 'mix' &&
    (scheme.rewardKind === 'free_qty' ||
      scheme.rewardKind === 'line_pct' ||
      scheme.rewardKind === 'net_scheme_amount')
  )
}

function measure(unit: SchemeTriggerUnit, lines: readonly LineState[]): number {
  switch (unit) {
    case 'pcs':
      return lines.reduce((n, l) => n + l.input.qtyPcs, 0)
    case 'case':
      return lines.reduce((n, l) => n + Math.floor(l.input.qtyPcs / l.input.caseSize), 0)
    case 'inr':
      return lines.reduce((n, l) => n + l.gross, 0)
  }
}

function evaluateTrigger(scheme: SchemeRule, measured: number): Reward | null {
  if (measured <= 0) return null
  const slabs = scheme.slabs ?? []
  if (slabs.length > 0) {
    let best: SchemeSlab | undefined
    for (const slab of slabs)
      if (measured >= slab.min && (!best || slab.min > best.min)) best = slab
    if (!best) return null
    return {
      value: best.value,
      multiples: 1,
      freeVariantId: best.freeVariantId ?? scheme.freeVariantId ?? undefined,
    }
  }
  if (measured < scheme.triggerMin) return null
  const multiples = scheme.triggerMin > 0 ? Math.floor(measured / scheme.triggerMin) : 1
  return { value: scheme.rewardValue, multiples, freeVariantId: scheme.freeVariantId ?? undefined }
}

// ---------------------------------------------------------------------------------------------------------------
// stacking

/**
 * Stackable schemes all apply together. An exclusive one (non-stackable or final) applies alone. When both kinds
 * are eligible the engine takes whichever is worth more to the retailer; ties keep the stackable set, then the
 * earlier scheme.
 */
/** priority asc, free goods before money (money-neutral first), then scheme id. */
function orderStack(stack: readonly Candidate[]): Candidate[] {
  const rank = (c: Candidate) => (c.scheme.rewardKind === 'free_qty' ? 0 : 1)
  return [...stack].sort(
    (a, b) =>
      (a.scheme.priority ?? 0) - (b.scheme.priority ?? 0) ||
      rank(a) - rank(b) ||
      (a.scheme.id < b.scheme.id ? -1 : a.scheme.id > b.scheme.id ? 1 : 0),
  )
}

function chooseStack(candidates: readonly Candidate[]): Candidate[] {
  const stackable = candidates.filter((c) => !c.exclusive)
  const options: Candidate[][] = []
  if (stackable.length > 0) options.push(stackable)
  for (const c of candidates) if (c.exclusive) options.push([c])
  let best: Candidate[] = []
  let bestValue = -1
  for (const option of options) {
    const value = option.reduce((n, c) => n + c.valuePaise, 0)
    if (value > bestValue) {
      best = option
      bestValue = value
    }
  }
  return orderStack(best)
}

function freeValue(
  qty: number,
  variantId: string,
  fallbackRate: Paise,
  tierPrices: Readonly<Record<string, number>>,
): number {
  return qty * (tierPrices[variantId] ?? fallbackRate)
}

function lineRewardValue(
  scheme: SchemeRule,
  reward: Reward,
  line: LineState,
  tierPrices: Readonly<Record<string, number>>,
): number {
  switch (scheme.rewardKind) {
    case 'free_qty':
      return freeValue(
        nonNegativeInt(reward.value, `scheme ${scheme.id} reward`) * reward.multiples,
        reward.freeVariantId ?? line.input.variantId,
        line.baseRate,
        tierPrices,
      )
    case 'line_pct':
      return percentOf(line.gross, bps(reward.value, `scheme ${scheme.id} reward`))
    case 'net_scheme_amount':
      return nonNegativeInt(reward.value, `scheme ${scheme.id} reward`) * reward.multiples
    default:
      return 0
  }
}

function orderRewardValue(
  scheme: SchemeRule,
  reward: Reward,
  scope: readonly LineState[],
  tierPrices: Readonly<Record<string, number>>,
): number {
  const base = scopeBase(scope)
  switch (scheme.rewardKind) {
    case 'order_pct':
    case 'line_pct':
      return percentOf(base, bps(reward.value, `scheme ${scheme.id} reward`))
    case 'net_scheme_amount':
      return nonNegativeInt(reward.value, `scheme ${scheme.id} reward`) * reward.multiples
    case 'free_qty': {
      const anchor = largest(scope)
      return anchor
        ? freeValue(
            nonNegativeInt(reward.value, `scheme ${scheme.id} reward`) * reward.multiples,
            reward.freeVariantId ?? anchor.input.variantId,
            anchor.baseRate,
            tierPrices,
          )
        : 0
    }
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------------------------------------------
// applying rewards

function addDiscount(line: LineState, amount: number): number {
  const capped = Math.max(0, Math.min(amount, line.gross - line.discount))
  line.discount += capped
  return capped
}

function addFree(line: LineState, scheme: SchemeRule, qty: number, variantId: string): AppliedRule {
  line.freeItems.push({ variantId, qtyPcs: qty, ruleId: scheme.id, version: scheme.version })
  const rule: AppliedRule = {
    ruleId: scheme.id,
    version: scheme.version,
    kind: 'scheme',
    rewardKind: scheme.rewardKind,
    freeQty: qty,
    freeVariantId: variantId,
  }
  line.rules.push(rule)
  return rule
}

function lockIfFinal(scheme: SchemeRule, lines: readonly LineState[]): void {
  if (!scheme.final) return
  for (const line of lines) line.lockedByFinalScheme = true
}

function applyLineReward(c: Candidate, line: LineState, lines: readonly LineState[]): void {
  const { scheme, reward } = c
  switch (scheme.rewardKind) {
    case 'free_qty': {
      const qty = reward.value * reward.multiples
      if (qty > 0) addFree(line, scheme, qty, reward.freeVariantId ?? line.input.variantId)
      break
    }
    case 'line_pct': {
      // Compounds on the running net (invoice E: "Secondary Dis %" then "Cash Dis %" each on the reduced amount),
      // rounded half-up to the paisa per step by percentOf. Review item 14.
      const amount = addDiscount(line, percentOf(paise(line.gross - line.discount), reward.value))
      line.rules.push({
        ruleId: scheme.id,
        version: scheme.version,
        kind: 'scheme',
        rewardKind: scheme.rewardKind,
        amountPaise: amount,
      })
      break
    }
    case 'net_scheme_amount': {
      const amount = addDiscount(line, reward.value * reward.multiples)
      line.rules.push({
        ruleId: scheme.id,
        version: scheme.version,
        kind: 'scheme',
        rewardKind: scheme.rewardKind,
        amountPaise: amount,
      })
      break
    }
    default:
      return
  }
  lockIfFinal(scheme, lines)
}

/** Base for order-level percentages: in-scope line values after their own line-level schemes. */
function scopeBase(scope: readonly LineState[]): Paise {
  return paise(scope.reduce((n, l) => n + (l.gross - l.discount), 0))
}

function largest(scope: readonly LineState[]): LineState | undefined {
  let best: LineState | undefined
  for (const l of scope) if (!best || l.gross > best.gross) best = l
  return best
}

/** Spreads an order-level amount over the scope lines to the paisa and stamps each line with its share. */
function spread(
  scheme: SchemeRule,
  scope: readonly LineState[],
  amount: number,
): AppliedRule | null {
  const weights = scope.map((l) => l.gross - l.discount)
  const room = weights.reduce((n, w) => n + w, 0)
  if (room <= 0) return null
  const total = Math.min(amount, room)
  const shares = allocate(paise(total), weights)
  let applied = 0
  scope.forEach((line, i) => {
    const share = addDiscount(line, shares[i] ?? 0)
    applied += share
    line.rules.push({
      ruleId: scheme.id,
      version: scheme.version,
      kind: 'scheme',
      rewardKind: scheme.rewardKind,
      amountPaise: share,
    })
  })
  return {
    ruleId: scheme.id,
    version: scheme.version,
    kind: 'scheme',
    rewardKind: scheme.rewardKind,
    amountPaise: applied,
  }
}

function applyOrderReward(c: Candidate, scope: readonly LineState[]): AppliedRule | null {
  const { scheme, reward } = c
  const rule = orderReward(scheme, reward, scope)
  if (rule) lockIfFinal(scheme, scope)
  return rule
}

function orderReward(
  scheme: SchemeRule,
  reward: Reward,
  scope: readonly LineState[],
): AppliedRule | null {
  switch (scheme.rewardKind) {
    case 'order_pct':
    case 'line_pct':
      return spread(scheme, scope, percentOf(scopeBase(scope), reward.value))
    case 'net_scheme_amount':
      return spread(scheme, scope, reward.value * reward.multiples)
    case 'free_qty': {
      const anchor = largest(scope)
      const qty = reward.value * reward.multiples
      if (!anchor || qty <= 0) return null
      const variantId = reward.freeVariantId ?? anchor.input.variantId
      addFree(anchor, scheme, qty, variantId)
      return {
        ruleId: scheme.id,
        version: scheme.version,
        kind: 'scheme',
        rewardKind: scheme.rewardKind,
        freeQty: qty,
        freeVariantId: variantId,
      }
    }
    default:
      return null
  }
}
