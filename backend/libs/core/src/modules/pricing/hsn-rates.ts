import { ORPCError } from '@orpc/server'
import { and, desc, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { hsnRates, type Db } from '@dos/db'

/** The dated tax rates of one HSN: GST and the compensation cess that rides with it (DOS-079). */
export interface HsnRate {
  gstBps: number
  cessBps: number
}

/**
 * THE ONE RESOLUTION OF AN HSN'S TAX RATE (QA S-176). The order path and the invoice path must price
 * the same variant on the same day at the same GST and the same cess — the bill is the legal document
 * and the quote is the promise made to the shopkeeper (docs/22 §4, §6) — so there is ONE function,
 * here, and `pricing.quote`, `billing.invoices` and the credit note all call it.
 *
 * It used to be two copies of the same query, one in `quote.service.ts` and one in
 * `billing.internals.ts`, on a table that held three live rows for HSN 2202. Same SQL, but "the first
 * row" of an unordered set is the query PLAN's choice: `hsn_code IN ('2202')` returned the 12% row and
 * `IN ('2202','1905',…)` the 28% + 12% cess row, so what a case of Campa was taxed at depended on what
 * else was on the order. `hsn_rates_code_from_idx` is unique from migration 0059, which makes
 * `effective_from DESC` a total order per HSN and this function a function.
 *
 * A rate CHANGE is a new row with a later `effective_from`, so an old bill re-printed with its own
 * date resolves to the rate it was issued at. A MISSING rate is a 400 naming the HSN, never a silent
 * 0%, which would under-declare tax.
 */
export async function loadHsnRates(
  tx: Db,
  hsnCodes: readonly string[],
  on: string,
): Promise<Map<string, HsnRate>> {
  const wanted = [...new Set(hsnCodes)].filter((code) => code.length > 0)
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({
      hsnCode: hsnRates.hsnCode,
      gstBps: hsnRates.gstBps,
      cessBps: hsnRates.cessBps,
      effectiveFrom: hsnRates.effectiveFrom,
    })
    .from(hsnRates)
    .where(
      and(
        inArray(hsnRates.hsnCode, wanted),
        lte(hsnRates.effectiveFrom, on),
        or(isNull(hsnRates.effectiveTo), gte(hsnRates.effectiveTo, on)),
      ),
    )
    .orderBy(desc(hsnRates.effectiveFrom))
  const map = new Map<string, HsnRate>()
  for (const row of rows)
    if (!map.has(row.hsnCode)) map.set(row.hsnCode, { gstBps: row.gstBps, cessBps: row.cessBps })
  const missing = wanted.filter((code) => !map.has(code))
  if (missing.length > 0)
    throw new ORPCError('BAD_REQUEST', {
      message: `no GST rate for HSN ${missing.join(', ')} on ${on}; add an hsn_rates row`,
      data: { hsnCodes: missing, on },
    })
  return map
}
