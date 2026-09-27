/**
 * Stock at cost, split by brand, for a chart (QA DOS-253).
 *
 * The owner's "Stock value by brand" donut summed the first 200 rows of `reporting.registers.stockValue`
 * and printed ₹14.0L beside "Stock at cost ₹23,29,594.17", leaving Campa (₹3.38L) off it entirely. It is
 * now drawn from the register's own `byBrand` — the brand split of the SAME totals over every row. EVERY
 * brand goes to the chart: `<StackedMix>` itself keeps the four largest and folds the rest into its one
 * "Other" segment, so the segments always add up to the figure printed beside them.
 */
export interface BrandValue {
  readonly brandId: string | null
  readonly brandName: string | null
  readonly valuePaise: number
}

export interface Slice {
  label: string
  value: number
}

/** Every brand worth something, largest first; a row with no brand is named `noBrand`. */
export function brandSlices(byBrand: readonly BrandValue[], noBrand: string): Slice[] {
  return byBrand
    .filter((b) => b.valuePaise > 0)
    .map((b) => ({ label: b.brandName ?? noBrand, value: b.valuePaise }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}
