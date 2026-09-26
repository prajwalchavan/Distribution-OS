/**
 * DOS-212 and DOS-214 — what the desk types, turned into what the contract accepts.
 *
 * Both desks (owner and manager; `PERMISSIONS` gives the writes to exactly those two) edit the same four
 * things: a shop's credit (limit, days, mode, terms), a price list's rates, a shop's own rate, and a
 * scheme. The screens differ; the arithmetic must not. So the conversions live here ONCE, at install
 * level (docs/31 §6.4 lets any group import `src/`, never another group), with no React in them, and
 * `forms.test.ts` parses every payload they build with the contract's own Zod schema.
 *
 * Units are the whole point. The contract stores integers: paise for money, basis points for a
 * percentage, pieces or cases for a quantity trigger. A person types "2.5" for 2.5 %, "₹5,000" for a
 * bill threshold and "12" for twelve pieces. Every function below is one of those translations, and a
 * translation that cannot be made answers a PROBLEM (a string key the screen prints) rather than a
 * guess: never-list #12 — the input stays, and the screen says what is wrong with it.
 */
import type {
  CreditModeSchema,
  PaymentTermsSchema,
  RetailerPriceOverride,
  Scheme,
  SchemeRewardKindSchema,
  SchemeTriggerKindSchema,
  SchemeTriggerUnitSchema,
} from '@dos/contracts'
import type { z } from 'zod'

export type CreditMode = z.infer<typeof CreditModeSchema>
export type PaymentTerms = z.infer<typeof PaymentTermsSchema>
export type RewardKind = z.infer<typeof SchemeRewardKindSchema>
export type TriggerKind = z.infer<typeof SchemeTriggerKindSchema>
export type TriggerUnit = z.infer<typeof SchemeTriggerUnitSchema>
export type Tier = 'A' | 'B' | 'C' | 'D'

/** The contract's credit modes, in the order a desk reads them: least to most severe. */
export const CREDIT_MODES: readonly CreditMode[] = ['indicate', 'strict', 'stop']
/** The contract's payment terms: before, at and after delivery. */
export const PAYMENT_TERMS: readonly PaymentTerms[] = ['PRE', 'ON', 'POST_FULFILLMENT']
export const TIERS: readonly Tier[] = ['A', 'B', 'C', 'D']

/** A string key from `src/pricing/strings.ts`, printed by the screen where the problem is. */
export type Problem = string

export type Built<T> = { ok: true; input: T } | { ok: false; problem: Problem }

// ---------------------------------------------------------------------------------------------------------------
// numbers and dates as typed

/**
 * "2", "2.5", "12.25", "2%" → basis points. At most two decimals, because a basis point IS the second
 * decimal; "2.555" is not a rate anybody means, and rounding it silently would store a different one.
 */
export function percentToBps(text: string): number | null {
  const clean = text.trim().replace(/%$/, '').trim()
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(clean)
  if (match === null) return null
  const whole = Number.parseInt(match[1] ?? '0', 10)
  const frac = Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10)
  const bps = whole * 100 + frac
  return bps > 10_000 ? null : bps
}

/** Basis points back to what a person types: 250 → "2.5", 200 → "2". */
export function bpsToPercentText(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const frac = bps % 100
  if (frac === 0) return String(whole)
  return `${String(whole)}.${frac.toString().padStart(2, '0').replace(/0$/, '')}`
}

/** A whole count ("12", " 3 "); anything else — "1.5", "-2", "12 pcs" — is not a count. */
export function wholeNumber(text: string): number | null {
  const clean = text.trim()
  if (!/^\d{1,9}$/.test(clean)) return null
  return Number.parseInt(clean, 10)
}

/** `YYYY-MM-DD` that is also a real calendar day (no 2026-02-30). */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [y, m, d] = text.split('-').map((part) => Number.parseInt(part, 10))
  const at = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1))
  return at.getUTCFullYear() === y && at.getUTCMonth() + 1 === m && at.getUTCDate() === d
}

/** One calendar day before or after an ISO date, in the date's own terms (no clock, no zone). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((part) => Number.parseInt(part, 10))
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return at.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-212 — a shop's credit

export interface CreditShop {
  id: string
  tier: Tier
  creditLimitPaise: number
  creditLimitBills: number
  creditDays: number
  creditMode: CreditMode
  paymentTerms: PaymentTerms
}

export interface CreditDraft {
  limitPaise: number | null
  daysText: string
  mode: CreditMode
  terms: PaymentTerms
}

/** The dialog opens on what the shop has NOW, so the desk reads the current terms before changing one. */
export function creditDraftOf(shop: CreditShop): CreditDraft {
  return {
    limitPaise: shop.creditLimitPaise,
    daysText: String(shop.creditDays),
    mode: shop.creditMode,
    terms: shop.paymentTerms,
  }
}

export interface CreditPayload {
  id: string
  tier: Tier
  creditLimitPaise: number
  creditLimitBills: number
  creditDays: number
  creditMode: CreditMode
  paymentTerms: PaymentTerms
}

/**
 * The `retailers.setCredit` body. The tier and the open-bill count are the shop's own and pass through
 * unchanged; the four fields the dialog asks for are validated, never defaulted: an empty limit used to
 * be sent as ₹0 and "abc" days as 0, which quietly turned a credit shop into a no-credit one.
 */
export function creditPayload(shop: CreditShop, draft: CreditDraft): Built<CreditPayload> {
  if (draft.limitPaise === null || draft.limitPaise < 0)
    return { ok: false, problem: 'px.needLimit' }
  const days = wholeNumber(draft.daysText)
  if (days === null || days > 365) return { ok: false, problem: 'px.needDays' }
  return {
    ok: true,
    input: {
      id: shop.id,
      tier: shop.tier,
      creditLimitPaise: draft.limitPaise,
      creditLimitBills: shop.creditLimitBills,
      creditDays: days,
      creditMode: draft.mode,
      paymentTerms: draft.terms,
    },
  }
}

/** True when saving would change nothing: the button then says so instead of writing a no-op. */
export function creditUnchanged(shop: CreditShop, draft: CreditDraft): boolean {
  return (
    draft.limitPaise === shop.creditLimitPaise &&
    wholeNumber(draft.daysText) === shop.creditDays &&
    draft.mode === shop.creditMode &&
    draft.terms === shop.paymentTerms
  )
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-214 — one rate on a price list

export interface PriceItemPayload {
  priceListId: string
  items: [{ id: string; variantId: string; ratePaise: number; inclusiveOfGst: boolean }]
}

/**
 * `pricing.priceLists.setItems` upserts per variant, so ONE changed rate is a one-item call: the other
 * rates on the list are not re-sent and cannot be overwritten by a stale copy on this screen. `itemId`
 * is the row's own id when it exists (the server keys the upsert on the variant; the id only names a new
 * row).
 */
export function priceItemPayload(args: {
  priceListId: string
  itemId: string
  variantId: string
  ratePaise: number | null
  inclusiveOfGst: boolean
}): Built<PriceItemPayload> {
  if (args.variantId === '') return { ok: false, problem: 'px.needItem' }
  if (args.ratePaise === null || args.ratePaise <= 0) return { ok: false, problem: 'px.needRate' }
  return {
    ok: true,
    input: {
      priceListId: args.priceListId,
      items: [
        {
          id: args.itemId,
          variantId: args.variantId,
          ratePaise: args.ratePaise,
          inclusiveOfGst: args.inclusiveOfGst,
        },
      ],
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-214 — a shop's own rate (override)

export type OverrideState = 'running' | 'ended' | 'upcoming'

/** Whether a shop rate prices an order placed today: the engine's own rule (validFrom ≤ day ≤ validTo). */
export function overrideState(
  row: Pick<RetailerPriceOverride, 'validFrom' | 'validTo'>,
  today: string,
): OverrideState {
  if (row.validFrom > today) return 'upcoming'
  if (row.validTo !== null && row.validTo < today) return 'ended'
  return 'running'
}

export interface OverrideDraft {
  retailerId: string
  variantId: string
  ratePaise: number | null
  final: boolean
  validFrom: string
  validTo: string
  note: string
}

export function newOverrideDraft(today: string): OverrideDraft {
  return {
    retailerId: '',
    variantId: '',
    ratePaise: null,
    final: false,
    validFrom: today,
    validTo: '',
    note: '',
  }
}

export function overrideDraftOf(row: RetailerPriceOverride): OverrideDraft {
  return {
    retailerId: row.retailerId,
    variantId: row.variantId,
    ratePaise: row.ratePaise,
    final: row.final,
    validFrom: row.validFrom,
    validTo: row.validTo ?? '',
    note: row.note ?? '',
  }
}

export interface OverridePayload {
  id: string
  retailerId: string
  variantId: string
  ratePaise: number
  final: boolean
  validFrom: string
  validTo: string | null
  note: string | null
}

/**
 * The `pricing.overrides.upsert` body. The engine prices with the NEWEST running override of a shop and
 * item, so setting a rate for a pair that already has one running EDITS that row (`id` = its id) rather
 * than stacking a second row the desk would then have to reason about. The caller passes that id.
 */
export function overridePayload(id: string, draft: OverrideDraft): Built<OverridePayload> {
  if (draft.retailerId === '') return { ok: false, problem: 'px.needShop' }
  if (draft.variantId === '') return { ok: false, problem: 'px.needItem' }
  if (draft.ratePaise === null || draft.ratePaise <= 0) return { ok: false, problem: 'px.needRate' }
  if (!isIsoDate(draft.validFrom)) return { ok: false, problem: 'px.badFrom' }
  const to = draft.validTo.trim()
  if (to !== '' && !isIsoDate(to)) return { ok: false, problem: 'px.badTo' }
  if (to !== '' && to < draft.validFrom) return { ok: false, problem: 'px.toBeforeFrom' }
  const note = draft.note.trim()
  return {
    ok: true,
    input: {
      id,
      retailerId: draft.retailerId,
      variantId: draft.variantId,
      ratePaise: draft.ratePaise,
      final: draft.final,
      validFrom: draft.validFrom,
      validTo: to === '' ? null : to,
      note: note === '' ? null : note.slice(0, 200),
    },
  }
}

/**
 * Ending a shop rate. There is no delete — the orders it priced point at it (`applied_rules`) — so a rate
 * is ended by its last day. The earliest honest last day is YESTERDAY: the shop pays its list price from
 * today. A rate that only started today (or starts later) cannot end before it began, so its last day is
 * its first, and the shop goes back to the list the day after. `backOn` is that day, for the dialog to
 * say in so many words.
 */
export function endOverride(
  row: RetailerPriceOverride,
  today: string,
): { payload: OverridePayload; backOn: string } {
  const yesterday = addDays(today, -1)
  const lastDay = row.validFrom > yesterday ? row.validFrom : yesterday
  return {
    payload: {
      id: row.id,
      retailerId: row.retailerId,
      variantId: row.variantId,
      ratePaise: row.ratePaise,
      final: row.final,
      validFrom: row.validFrom,
      validTo: lastDay,
      note: row.note,
    },
    backOn: addDays(lastDay, 1),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-214 — a scheme

/** The rewards whose value is a percentage (bps), a count of pieces, or money (paise). */
export const PCT_REWARDS: readonly RewardKind[] = ['line_pct', 'order_pct', 'cash_discount_pct']
export const AMOUNT_REWARDS: readonly RewardKind[] = ['per_unit_amount', 'net_scheme_amount']
/** What the editor offers, in the order a distributor meets them on a brand's scheme letter. */
export const REWARD_KINDS: readonly RewardKind[] = [
  'line_pct',
  'order_pct',
  'free_qty',
  'per_unit_amount',
  'net_scheme_amount',
  'cash_discount_pct',
]

export type ScopeMode = 'all' | 'items' | 'kept'

export interface SchemeDraft {
  name: string
  rewardKind: RewardKind
  /** Percentage text for the pct kinds, a count for `free_qty`. */
  rewardText: string
  /** Paise for the amount kinds. */
  rewardPaise: number | null
  triggerKind: TriggerKind
  triggerUnit: TriggerUnit
  /** The threshold for a quantity trigger, as typed. */
  triggerCountText: string
  /** The threshold for a bill-value trigger, in paise. */
  triggerPaise: number | null
  scopeMode: ScopeMode
  variantIds: readonly string[]
  tiers: readonly Tier[]
  validFrom: string
  validTo: string
  /** Applies alone rather than stacking (`stackable = false`); the engine's "exclusive". */
  exclusive: boolean
  fundingSource: 'company' | 'distributor'
  active: boolean
  /**
   * What this editor does not offer and must therefore hand back UNCHANGED on an edit: a brand or
   * category scope, slabs, a gift of a different item, shop or beat lists, the claim window. Dropping
   * any of them on save would change what the engine does without anybody having asked for it.
   */
  kept: {
    brandId: string | null
    scope: Scheme['scope']
    slabs: Scheme['slabs']
    freeVariantId: string | null
    final: boolean
    claimable: boolean
    claimWindowDays: number | null
    gstOnFreeGoods: boolean
    pricingDateMode: Scheme['pricingDateMode']
    sourceRef: string | null
    retailerIds: readonly string[] | undefined
    beatIds: readonly string[] | undefined
  }
}

/** A new scheme: 2 % off every item, for a month from today, on every shop, funded by the company. */
export function newSchemeDraft(today: string): SchemeDraft {
  return {
    name: '',
    rewardKind: 'line_pct',
    rewardText: '',
    rewardPaise: null,
    triggerKind: 'qty',
    triggerUnit: 'pcs',
    triggerCountText: '1',
    triggerPaise: null,
    scopeMode: 'all',
    variantIds: [],
    tiers: [],
    validFrom: today,
    validTo: addDays(today, 30),
    exclusive: false,
    fundingSource: 'company',
    active: true,
    kept: {
      brandId: null,
      scope: { all: true },
      slabs: null,
      freeVariantId: null,
      final: false,
      claimable: false,
      claimWindowDays: null,
      gstOnFreeGoods: false,
      pricingDateMode: 'order',
      sourceRef: null,
      retailerIds: undefined,
      beatIds: undefined,
    },
  }
}

/** An existing scheme, opened for editing with every figure in the unit a person reads. */
export function schemeDraftOf(row: Scheme): SchemeDraft {
  const scope = row.scope
  const onlyItems =
    (scope.variantIds?.length ?? 0) > 0 &&
    (scope.brandIds?.length ?? 0) === 0 &&
    (scope.categories?.length ?? 0) === 0 &&
    scope.all !== true
  return {
    name: row.name,
    rewardKind: row.rewardKind,
    rewardText: PCT_REWARDS.includes(row.rewardKind)
      ? bpsToPercentText(row.rewardValue)
      : row.rewardKind === 'free_qty'
        ? String(row.rewardValue)
        : '',
    rewardPaise: AMOUNT_REWARDS.includes(row.rewardKind) ? row.rewardValue : null,
    triggerKind: row.triggerKind,
    triggerUnit: row.triggerUnit,
    triggerCountText: row.triggerUnit === 'inr' ? '1' : String(row.triggerMin),
    triggerPaise: row.triggerUnit === 'inr' ? row.triggerMin : null,
    scopeMode: scope.all === true ? 'all' : onlyItems ? 'items' : 'kept',
    variantIds: onlyItems ? (scope.variantIds ?? []) : [],
    tiers: row.applicability.tiers ?? [],
    validFrom: row.validFrom,
    validTo: row.validTo,
    exclusive: !row.stackable,
    fundingSource: row.fundingSource,
    active: row.active,
    kept: {
      brandId: row.brandId,
      scope: row.scope,
      slabs: row.slabs,
      freeVariantId: row.freeVariantId,
      final: row.final,
      claimable: row.claimable,
      claimWindowDays: row.claimWindowDays,
      gstOnFreeGoods: row.gstOnFreeGoods,
      pricingDateMode: row.pricingDateMode,
      sourceRef: row.sourceRef,
      retailerIds: row.applicability.retailerIds,
      beatIds: row.applicability.beatIds,
    },
  }
}

export interface SchemePayload {
  id: string
  name: string
  brandId: string | null
  scope: Scheme['scope']
  triggerKind: TriggerKind
  triggerMin: number
  triggerUnit: TriggerUnit
  slabs: Scheme['slabs']
  rewardKind: RewardKind
  rewardValue: number
  freeVariantId: string | null
  applicability: { tiers?: Tier[]; retailerIds?: string[]; beatIds?: string[] }
  validFrom: string
  validTo: string
  stackable: boolean
  final: boolean
  fundingSource: 'company' | 'distributor'
  claimable: boolean
  claimWindowDays: number | null
  gstOnFreeGoods: boolean
  pricingDateMode: Scheme['pricingDateMode']
  sourceRef: string | null
  active: boolean
}

/**
 * The `pricing.schemes.upsert` body, or the first thing wrong with the draft. The checks are the
 * contract's own refinements said in the desk's words, so the server's 400 is the exception and not the
 * way the desk learns the rules: a bill-value trigger is in rupees, a quantity trigger in pieces or
 * cases, a percentage is 0–100 with two decimals, a "₹ off each unit" needs a unit, and a scheme ends on
 * or after the day it starts.
 */
export function schemePayload(id: string, draft: SchemeDraft): Built<SchemePayload> {
  const name = draft.name.trim()
  if (name === '') return { ok: false, problem: 'px.needName' }
  if (name.length > 120) return { ok: false, problem: 'px.nameTooLong' }

  let rewardValue: number | null
  if (PCT_REWARDS.includes(draft.rewardKind)) rewardValue = percentToBps(draft.rewardText)
  else if (draft.rewardKind === 'free_qty') rewardValue = wholeNumber(draft.rewardText)
  else rewardValue = draft.rewardPaise
  if (rewardValue === null || rewardValue <= 0) {
    return {
      ok: false,
      problem: PCT_REWARDS.includes(draft.rewardKind)
        ? 'px.needPercent'
        : draft.rewardKind === 'free_qty'
          ? 'px.needFree'
          : 'px.needAmount',
    }
  }

  let triggerUnit: TriggerUnit = draft.triggerUnit
  let triggerMin: number | null
  if (draft.triggerKind === 'value') {
    triggerUnit = 'inr'
    triggerMin = draft.triggerPaise
    if (triggerMin === null || triggerMin < 0) return { ok: false, problem: 'px.needBillValue' }
  } else {
    if (draft.triggerKind === 'qty' && triggerUnit === 'inr') triggerUnit = 'pcs'
    triggerMin = triggerUnit === 'inr' ? draft.triggerPaise : wholeNumber(draft.triggerCountText)
    if (triggerMin === null) return { ok: false, problem: 'px.needCount' }
  }
  if (draft.rewardKind === 'per_unit_amount' && triggerUnit === 'inr') {
    return { ok: false, problem: 'px.perUnitNeedsUnit' }
  }

  let scope: Scheme['scope']
  if (draft.scopeMode === 'all') scope = { all: true }
  else if (draft.scopeMode === 'items') {
    if (draft.variantIds.length === 0) return { ok: false, problem: 'px.needItems' }
    scope = { variantIds: [...draft.variantIds] }
  } else scope = draft.kept.scope

  if (!isIsoDate(draft.validFrom)) return { ok: false, problem: 'px.badFrom' }
  if (!isIsoDate(draft.validTo)) return { ok: false, problem: 'px.badTo' }
  if (draft.validTo < draft.validFrom) return { ok: false, problem: 'px.toBeforeFrom' }

  const applicability: SchemePayload['applicability'] = {}
  if (draft.tiers.length > 0) applicability.tiers = [...draft.tiers]
  if (draft.kept.retailerIds !== undefined) applicability.retailerIds = [...draft.kept.retailerIds]
  if (draft.kept.beatIds !== undefined) applicability.beatIds = [...draft.kept.beatIds]

  return {
    ok: true,
    input: {
      id,
      name,
      brandId: draft.kept.brandId,
      scope,
      triggerKind: draft.triggerKind,
      triggerMin,
      triggerUnit,
      slabs: draft.kept.slabs,
      rewardKind: draft.rewardKind,
      rewardValue,
      freeVariantId: draft.kept.freeVariantId,
      applicability,
      validFrom: draft.validFrom,
      validTo: draft.validTo,
      stackable: !draft.exclusive,
      final: draft.kept.final,
      fundingSource: draft.fundingSource,
      claimable: draft.kept.claimable,
      claimWindowDays: draft.kept.claimWindowDays,
      gstOnFreeGoods: draft.kept.gstOnFreeGoods,
      pricingDateMode: draft.kept.pricingDateMode,
      sourceRef: draft.kept.sourceRef,
      active: draft.active,
    },
  }
}

/** The one-word state of a scheme on a given day: running, paused, not started yet, or over. */
export function schemeState(
  row: Pick<Scheme, 'active' | 'validFrom' | 'validTo'>,
  today: string,
): 'running' | 'paused' | 'upcoming' | 'ended' {
  if (!row.active) return 'paused'
  if (row.validFrom > today) return 'upcoming'
  if (row.validTo < today) return 'ended'
  return 'running'
}
