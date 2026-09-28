// Phase 8 — an INDEPENDENT pricing + GST oracle.
//
// Written from the rules only: docs/22 (order-to-cash, §8 rulings DOS-075, DOS-087, DOS-185, S-176, cash discount rows) and the
// header comment of backend/libs/domain/src/pricing/schemes.ts (precedence 1–5) plus the field docs of the contract
// (backend/libs/contracts/src/pricing.ts). It does NOT import or copy the engine. Where the rules are silent the oracle takes the
// convention written next to `SILENT:` below, and the findings file lists each one as a question for the founder.
//
// Money is integer paise. Every percentage is computed to the paisa with ROUND HALF UP (SILENT: the rules name no rounding mode).
//
// Input (all plain data read from the database or from the test plan — see inputs.mjs):
//   { pricingDate, deliveryDate?, sellerState, orderId?,
//     shop: { id, tier, beatId, stateCode },
//     lines: [{ lineId, variantId, qtyPcs }],
//     variants: { [variantId]: { caseSize, brandId, category, gstBps, cessBps, hsn } },
//     tierPrices: { [variantId]: paise },              // the shop's price list rate
//     overrides: [{ variantId, ratePaise, final, validFrom, validTo }],
//     schemes: [{ id, version, active, scope, triggerKind, triggerMin, triggerUnit, slabs, rewardKind, rewardValue,
//                 freeVariantId, applicability, validFrom, validTo, stackable, final, priority, pricingDateMode, gstOnFreeGoods }],
//     bargains: [{ variantId, ratePaise, orderId }] }   // APPROVED ones only
// Output: per line { gross, discount, bargain, net, rate, listRate, freeQty (same variant), freeItems, rules, orderShare,
//                    gst, cgst, sgst, igst, cess, tax, total, exclusive }, rewardLines (free goods of another variant),
//         totals { gross, discount, bargain, net, cgst, sgst, igst, cess, tax, roundOff, total }, cashDiscount { bps, paise, schemeId }

/** round half up of a non-negative rational a/b, integers only */
export function rdiv(a, b) {
  if (b <= 0) throw new Error('rdiv: b must be positive')
  if (a < 0) return -rdiv(-a, b)
  return Math.floor((2 * a + b) / (2 * b))
}
/** pct of an amount in basis points, round half up */
export const bpsOf = (amount, bps) => rdiv(amount * bps, 10000)

/** largest-remainder split of `amount` over `weights` (non-negative integers); ties go to the earlier line */
export function largestRemainder(amount, weights) {
  const total = weights.reduce((s, w) => s + w, 0)
  if (total === 0 || amount === 0) return weights.map(() => 0)
  const raw = weights.map((w) => ({ floor: Math.floor((amount * w) / total), rem: (amount * w) % total }))
  let left = amount - raw.reduce((s, r) => s + r.floor, 0)
  const order = raw.map((r, i) => ({ i, rem: r.rem })).sort((a, b) => b.rem - a.rem || a.i - b.i)
  const out = raw.map((r) => r.floor)
  for (const o of order) {
    if (left <= 0) break
    out[o.i] += 1
    left -= 1
  }
  return out
}

const inWindow = (d, from, to) => (!from || from <= d) && (!to || d <= to)

function schemeDate(s, input) {
  // pricingDateMode 'delivery' validates against the delivery date when one is given (header: "Which date the validity window is checked against")
  return s.pricingDateMode === 'delivery' && input.deliveryDate ? input.deliveryDate : input.pricingDate
}
function applies(s, shop) {
  const a = s.applicability ?? {}
  // "Empty / missing lists mean no restriction; every list that is set must match (AND)."
  if (a.tiers?.length && !a.tiers.includes(shop.tier)) return false
  if (a.retailerIds?.length && !a.retailerIds.includes(shop.id)) return false
  if (a.beatIds?.length && !a.beatIds.includes(shop.beatId)) return false
  return true
}
function inScope(s, v, variantId) {
  const sc = s.scope ?? {}
  if (sc.all === true) return true
  // SILENT: when a scope names several lists (brands AND variants) the rules do not say AND or OR. The oracle reads OR (any list
  // naming the line puts it in scope). No test scheme in this lane sets two lists.
  if (sc.variantIds?.includes(variantId)) return true
  if (v.brandId && sc.brandIds?.includes(v.brandId)) return true
  if (v.category && sc.categories?.includes(v.category)) return true
  return false
}
/** measured quantity of a line in the trigger unit: pieces, WHOLE cases (floored per line), or paise of gross */
function measure(unit, line) {
  if (unit === 'pcs') return line.qtyPcs
  if (unit === 'case') return Math.floor(line.qtyPcs / line.caseSize)
  return line.gross
}
function slabFor(s, m) {
  if (!s.slabs?.length) return null
  let best = null
  for (const sl of s.slabs) if (sl.min <= m && (!best || sl.min > best.min)) best = sl
  return best
}
const byPriority = (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The effect of ONE line-level scheme on a line whose running net is `running`.
 * Returns { money, free: { variantId, qty } | null } or null when the trigger is not met.
 */
function lineEffect(s, line, running) {
  const m = measure(s.triggerUnit, line)
  if (m < s.triggerMin) return null
  const slab = slabFor(s, m)
  if (s.slabs?.length && !slab) return null // SILENT: measure ≥ triggerMin but under every slab — treated as not triggered
  const value = slab ? slab.value : s.rewardValue
  // slab-less free_qty / net_scheme_amount repeat per multiple of triggerMin; slab rewards apply once (header of SchemeSlab)
  const multiples = slab ? 1 : s.triggerMin > 0 ? Math.floor(m / s.triggerMin) : 1
  switch (s.rewardKind) {
    case 'line_pct':
      return { money: bpsOf(running, value), free: null }
    case 'net_scheme_amount':
      return { money: Math.min(running, multiples * value), free: null }
    case 'per_unit_amount':
      // DOS-087: paise off EVERY whole trigger unit once triggerMin is reached
      return { money: Math.min(running, m * value), free: null }
    case 'free_qty': {
      const variantId = (slab && slab.freeVariantId) || s.freeVariantId || line.variantId
      return { money: 0, free: { variantId, qty: multiples * value } }
    }
    default:
      return null
  }
}

export function oracle(input) {
  const date = input.pricingDate
  const shop = input.shop
  const interState = shop.stateCode !== input.sellerState
  const lines = input.lines.map((l, idx) => {
    const v = input.variants[l.variantId]
    if (!v) throw new Error(`oracle: no variant ${l.variantId}`)
    const tier = input.tierPrices[l.variantId]
    if (tier === undefined) throw new Error(`oracle: no tier price for ${l.variantId}`)
    // 2. the shop's own rate wins over the tier price (SILENT: two valid overrides — the latest validFrom wins)
    const ov = (input.overrides ?? [])
      .filter((o) => o.variantId === l.variantId && inWindow(date, o.validFrom, o.validTo))
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0]
    const r0 = ov ? ov.ratePaise : tier
    return { idx, ...l, caseSize: v.caseSize, v, listRate: tier, r0, finalOverride: !!ov?.final, override: ov ?? null, gross: r0 * l.qtyPcs, running: r0 * l.qtyPcs, discount: 0, bargain: 0, rules: [], free: [], exclusive: null, orderShare: 0 }
  })

  const eligible = (input.schemes ?? []).filter((s) => s.active !== false && inWindow(schemeDate(s, input), s.validFrom, s.validTo) && applies(s, shop))
  const isOrderLevel = (s) => s.rewardKind === 'order_pct' || s.triggerKind === 'mix'
  const lineLevel = eligible.filter((s) => !isOrderLevel(s) && s.rewardKind !== 'cash_discount_pct').sort(byPriority)
  const orderLevel = eligible.filter((s) => isOrderLevel(s) && s.rewardKind !== 'cash_discount_pct').sort(byPriority)
  const cdSchemes = eligible.filter((s) => s.rewardKind === 'cash_discount_pct')

  const rateOf = (variantId) => {
    const ln = lines.find((x) => x.variantId === variantId)
    return ln ? ln.r0 : (input.tierPrices[variantId] ?? 0)
  }
  // 3. schemes, line by line
  for (const ln of lines) {
    if (ln.finalOverride) continue // `final` override: no scheme on that line
    const cands = lineLevel.filter((s) => inScope(s, ln.v, ln.variantId))
    if (!cands.length) continue
    // the stackable set, compounding on the running net in (priority, id) order
    const stack = cands.filter((s) => s.stackable && !s.final)
    let run = ln.gross
    const stackApplied = []
    for (const s of stack) {
      const e = lineEffect(s, ln, run)
      if (!e) continue
      run -= e.money
      stackApplied.push({ s, e })
    }
    // SILENT: "worth to the retailer" of free goods is taken at the shop's own rate of the free item
    const worth = (applied) => applied.reduce((w, { e }) => w + e.money + (e.free ? e.free.qty * rateOf(e.free.variantId) : 0), 0)
    const stackWorth = worth(stackApplied)
    let best = null
    for (const s of cands.filter((x) => !x.stackable || x.final)) {
      const e = lineEffect(s, ln, ln.gross)
      if (!e) continue
      const w = worth([{ s, e }])
      if (!best || w > best.w) best = { s, e, w } // ties keep the earlier scheme (cands are in priority, id order)
    }
    const chosen = best && best.w > stackWorth ? [{ s: best.s, e: best.e }] : stackApplied
    if (best && best.w > stackWorth) ln.exclusive = best.s
    for (const { s, e } of chosen) {
      ln.running -= e.money
      ln.discount += e.money
      if (e.free) ln.free.push({ ...e.free, ruleId: s.id, version: s.version })
      ln.rules.push({ ruleId: s.id, kind: 'scheme', rewardKind: s.rewardKind, amountPaise: e.money, ...(e.free ? { freeQty: e.free.qty, freeVariantId: e.free.variantId } : {}) })
    }
  }

  // order-level schemes: threshold over EVERY in-scope line of the bill (DOS-075); reward only on lines free of a final override
  // or an exclusive scheme ("applies alone"); allocated by largest remainder on their running nets; compounding in priority order.
  const orderRules = []
  for (const s of orderLevel) {
    const scoped = lines.filter((ln) => inScope(s, ln.v, ln.variantId))
    if (!scoped.length) continue
    let m
    if (s.triggerUnit === 'inr') m = scoped.reduce((t, ln) => t + ln.gross, 0)
    else if (s.triggerUnit === 'pcs') m = scoped.reduce((t, ln) => t + ln.qtyPcs, 0)
    else m = scoped.reduce((t, ln) => t + Math.floor(ln.qtyPcs / ln.caseSize), 0)
    if (m < s.triggerMin) continue
    const slab = slabFor(s, m)
    if (s.slabs?.length && !slab) continue
    const value = slab ? slab.value : s.rewardValue
    const payees = scoped.filter((ln) => !ln.finalOverride && !ln.exclusive)
    const base = payees.reduce((t, ln) => t + ln.running, 0)
    let amount
    if (s.rewardKind === 'order_pct' || s.rewardKind === 'line_pct') amount = bpsOf(base, value)
    else if (s.rewardKind === 'net_scheme_amount') amount = Math.min(base, (slab ? 1 : Math.floor(m / Math.max(1, s.triggerMin))) * value)
    else if (s.rewardKind === 'per_unit_amount') amount = Math.min(base, m * value)
    else continue // SILENT: mix-triggered free goods — not modelled (not tested)
    const shares = largestRemainder(amount, payees.map((ln) => ln.running))
    payees.forEach((ln, i) => {
      ln.running -= shares[i]
      ln.discount += shares[i]
      ln.orderShare += shares[i]
      if (shares[i] > 0) ln.rules.push({ ruleId: s.id, kind: 'scheme', rewardKind: s.rewardKind, amountPaise: shares[i] })
    })
    orderRules.push({ ruleId: s.id, rewardKind: s.rewardKind, amountPaise: amount })
  }

  // 4. approved bargain last: the negotiated rate replaces the rate; the difference × qty is the bargain
  for (const ln of lines) {
    ln.rate = ln.r0
    if (ln.exclusive?.final) continue // a `final` scheme: no bargain
    const b = (input.bargains ?? []).filter((x) => x.variantId === ln.variantId && (!x.orderId || x.orderId === input.orderId)).sort((a, c) => a.ratePaise - c.ratePaise)[0]
    if (!b || b.ratePaise >= ln.r0) continue // SILENT: a "bargain" at or above the rate changes nothing
    ln.bargain = (ln.r0 - b.ratePaise) * ln.qtyPcs
    ln.rate = b.ratePaise
    ln.rules.push({ kind: 'bargain', amountPaise: ln.bargain })
  }

  // GST per line on the net (S-176: one live rate per HSN). Intra-state: CGST = SGST = half rate each, rounded each.
  // SILENT: whether CGST/SGST are each rounded (used here) or the full GST is rounded then split. Cess on the same net.
  const rewardLines = []
  for (const ln of lines) {
    ln.net = ln.gross - ln.discount - ln.bargain
    const g = ln.v.gstBps
    if (interState) {
      ln.igst = bpsOf(ln.net, g)
      ln.cgst = 0
      ln.sgst = 0
    } else {
      ln.cgst = rdiv(ln.net * g, 20000)
      ln.sgst = ln.cgst
      ln.igst = 0
    }
    ln.gstCombined = bpsOf(ln.net, g)
    ln.cess = bpsOf(ln.net, ln.v.cessBps)
    ln.tax = ln.cgst + ln.sgst + ln.igst + ln.cess
    ln.total = ln.net + ln.tax
    ln.freeQty = ln.free.filter((f) => f.variantId === ln.variantId).reduce((t, f) => t + f.qty, 0)
    for (const f of ln.free.filter((x) => x.variantId !== ln.variantId)) {
      // DOS-185: the reward is its own line, qty 0, free N, rate ₹0, taxable ₹0 (free goods carry no value on the bill)
      rewardLines.push({ variantId: f.variantId, freeQty: f.qty, ruleId: f.ruleId, taxable: 0, tax: 0 })
    }
  }
  const sum = (k) => lines.reduce((t, ln) => t + ln[k], 0)
  const net = sum('net')
  const tax = sum('tax')
  const exact = net + tax
  const total = rdiv(exact, 100) * 100 // SILENT: round-off to the nearest rupee, 50 paise up
  // 5. cash discount: reported, never deducted — the single offer worth most, on the net of its own in-scope lines
  let cashDiscount = { bps: 0, paise: 0, schemeId: null }
  for (const s of cdSchemes) {
    const scoped = lines.filter((ln) => inScope(s, ln.v, ln.variantId))
    if (!scoped.length) continue
    const m = s.triggerUnit === 'inr' ? scoped.reduce((t, ln) => t + ln.gross, 0) : s.triggerUnit === 'pcs' ? scoped.reduce((t, ln) => t + ln.qtyPcs, 0) : scoped.reduce((t, ln) => t + Math.floor(ln.qtyPcs / ln.caseSize), 0)
    if (m < s.triggerMin) continue
    const paise = bpsOf(scoped.reduce((t, ln) => t + ln.net, 0), s.rewardValue)
    if (paise > cashDiscount.paise) cashDiscount = { bps: s.rewardValue, paise, schemeId: s.id }
  }
  return {
    interState,
    lines: lines.map((ln) => ({
      lineId: ln.lineId, variantId: ln.variantId, qtyPcs: ln.qtyPcs, listRate: ln.listRate, rate: ln.rate, gross: ln.gross, discount: ln.discount, bargain: ln.bargain,
      net: ln.net, orderShare: ln.orderShare, freeQty: ln.freeQty, free: ln.free, rules: ln.rules, exclusive: ln.exclusive?.id ?? null, finalOverride: ln.finalOverride,
      gstBps: ln.v.gstBps, cessBps: ln.v.cessBps, cgst: ln.cgst, sgst: ln.sgst, igst: ln.igst, gstCombined: ln.gstCombined, cess: ln.cess, tax: ln.tax, total: ln.total,
    })),
    rewardLines,
    orderRules,
    totals: { gross: sum('gross'), discount: sum('discount'), bargain: sum('bargain'), net, cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess'), tax, roundOff: total - exact, total },
    cashDiscount,
  }
}
