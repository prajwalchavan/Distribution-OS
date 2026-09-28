/**
 * THE CATALOGUE ORDER (architect ruling 2026-09-28, the simulation's UX-O-8) on the device: brand A–Z (a
 * product with no brand files under its maker), then item A–Z, then pack size smallest first (a kilogram
 * after 500 grams), then the variant's own name — the server's `CATALOG_ORDER`, case-insensitive, so the
 * rep's catalogue reads exactly like the owner's and the manager's.
 */
export type CatalogOrderKey = readonly [string, string, number, string, string]

export function catalogOrderKey(input: {
  brandName: string | null
  manufacturerName: string | null
  productName: string
  netQty: number | null
  netUnit: string | null
  variantName: string
  variantId: string
}): CatalogOrderKey {
  const qty = input.netQty ?? 0
  const pack = input.netUnit === 'kg' || input.netUnit === 'l' ? qty * 1000 : qty
  return [
    (input.brandName ?? input.manufacturerName ?? '').toLowerCase(),
    input.productName.toLowerCase(),
    pack,
    input.variantName.toLowerCase(),
    input.variantId,
  ]
}

export function compareCatalogOrder(a: CatalogOrderKey, b: CatalogOrderKey): number {
  return (
    a[0].localeCompare(b[0]) ||
    a[1].localeCompare(b[1]) ||
    a[2] - b[2] ||
    a[3].localeCompare(b[3]) ||
    (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0)
  )
}
