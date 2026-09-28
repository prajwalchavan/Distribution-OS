// Phase 8 — reads the oracle's INPUTS from the database (the rows the owner typed: price lists, overrides, schemes, bargains,
// the curated HSN rates, case sizes). It reads no output of the engine (no order, quote or invoice row).
import * as L from './lib.mjs'

/** price list the shop's tier uses: the active list of that tier valid on the date, else the default list (per item). */
export function tierPrices(tier, date, variantIds) {
  const rows = L.q(`
    select i.variant_id, i.rate_paise::int rate, l.tier::text tier, l.is_default, i.inclusive_of_gst
      from price_list_items i join price_lists l on l.id = i.price_list_id
     where l.tenant_id = '${L.T}' and l.active and (l.valid_from is null or l.valid_from <= '${date}') and (l.valid_to is null or l.valid_to >= '${date}')
       and i.variant_id in (${L.inList(variantIds)}) and (l.tier::text = '${tier}' or l.is_default)`)
  const out = {}
  for (const v of variantIds) {
    const own = rows.find((r) => r.variant_id === v && r.tier === tier)
    const def = rows.find((r) => r.variant_id === v && r.is_default)
    const pick = own ?? def
    if (pick) out[v] = pick.rate
  }
  return out
}

export function variants(variantIds, date) {
  const rows = L.q(`
    select v.id, coalesce(tp.case_size_override, v.default_case_size) cs, p.brand_id, p.category, v.hsn_code,
           -- contract (catalog.hsnRates, DOS-213): the full code, else its 6-digit, else its 4-digit heading, dated
           (select json_build_object('g', h.gst_bps, 'c', h.cess_bps) from hsn_rates h
             where h.hsn_code in (v.hsn_code, left(v.hsn_code, 6), left(v.hsn_code, 4))
               and h.effective_from <= '${date}' and (h.effective_to is null or h.effective_to >= '${date}')
             order by length(h.hsn_code) desc, h.effective_from desc limit 1) rate
      from product_variants v join products p on p.id = v.product_id
      left join tenant_products tp on tp.variant_id = v.id and tp.tenant_id = '${L.T}'
     where v.id in (${L.inList(variantIds)})`)
  const out = {}
  for (const r of rows) out[r.id] = { caseSize: r.cs, brandId: r.brand_id, category: r.category, hsn: r.hsn_code, gstBps: r.rate?.g ?? null, cessBps: r.rate?.c ?? null }
  return out
}

export function schemes() {
  return L.q(`select id, name, version, active, scope, trigger_kind "triggerKind", trigger_min "triggerMin", trigger_unit::text "triggerUnit", slabs,
                     reward_kind::text "rewardKind", reward_value "rewardValue", free_variant_id "freeVariantId", applicability,
                     valid_from::text "validFrom", valid_to::text "validTo", stackable, final, priority, pricing_date_mode::text "pricingDateMode",
                     gst_on_free_goods "gstOnFreeGoods"
                from schemes where tenant_id = '${L.T}'`).map((s) => ({ ...s, triggerKind: String(s.triggerKind) }))
}

export function overrides(shopId) {
  return L.q(`select variant_id "variantId", rate_paise::int "ratePaise", final, valid_from::text "validFrom", valid_to::text "validTo"
                from retailer_price_overrides where tenant_id = '${L.T}' and retailer_id = '${shopId}'`)
}

export function bargains(shopId) {
  return L.q(`select variant_id "variantId", coalesce(approved_rate_paise, asked_rate_paise)::int "ratePaise", order_id "orderId", status::text status
                from bargain_requests where tenant_id = '${L.T}' and retailer_id = '${shopId}' and status in ('approved', 'auto_approved')
                 and (expires_at is null or expires_at > now())`)
}

export function shop(shopId) {
  const r = L.q1(`select id, tier::text tier, beat_id "beatId", state_code "stateCode", gstin from retailers where id = '${shopId}'`)
  return r
}

/** Everything the oracle needs for one basket. lines: [{ lineId, variantId, qtyPcs }] */
export function load(shopId, lines, opts = {}) {
  const date = opts.pricingDate ?? L.today()
  const s = shop(shopId)
  const ids = [...new Set(lines.map((l) => l.variantId))]
  const sch = schemes()
  const freeIds = sch.flatMap((x) => [x.freeVariantId, ...(x.slabs ?? []).map((sl) => sl.freeVariantId)]).filter(Boolean)
  const all = [...new Set([...ids, ...freeIds])]
  return {
    pricingDate: date,
    deliveryDate: opts.deliveryDate,
    orderId: opts.orderId,
    sellerState: L.SELLER_STATE,
    shop: s,
    lines,
    variants: variants(all, date),
    tierPrices: tierPrices(s.tier, date, all),
    overrides: overrides(shopId),
    schemes: sch,
    bargains: bargains(shopId),
  }
}
