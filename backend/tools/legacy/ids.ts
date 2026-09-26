import { createHash } from 'node:crypto'

/**
 * Deterministic, UUID-shaped ids for what the legacy importer writes (the same construction as
 * `stableUuid` in `@dos/core`'s integrations module: a SHA-256 of the seed with the RFC 4122 version and
 * variant nibbles forced, so it validates as a real UUID and every contract `z.uuid()` accepts it).
 *
 * The importer is idempotent BECAUSE of these ids: the second run derives the same id for the same
 * legacy key (ITEM_CODE, CASH_ACC, BOOK_CODE + SAL_YEAR + BILL_NO), finds the row already there and
 * writes nothing. A tenant id is mixed into every id of tenant data, so two distributors importing
 * their own `AE01` never collide; global catalogue rows (manufacturers) are keyed by name alone.
 */
export function stableId(seed: string): string {
  const h = createHash('sha256').update(seed).digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The old software's name as `external_party_codes.system` remembers it. */
export const LEGACY_SYSTEM = 'tradeezee'

export const ids = {
  manufacturer: (name: string): string => stableId(`legacy:manufacturer:${name.toUpperCase()}`),
  hsnRate: (hsn: string, effectiveFrom: string): string =>
    stableId(`legacy:hsn-rate:${hsn}:${effectiveFrom}`),
  product: (tenantId: string, itemCode: string): string =>
    stableId(`legacy:product:${tenantId}:${itemCode}`),
  variant: (tenantId: string, itemCode: string): string =>
    stableId(`legacy:variant:${tenantId}:${itemCode}`),
  listing: (tenantId: string, itemCode: string): string =>
    stableId(`legacy:listing:${tenantId}:${itemCode}`),
  priceList: (tenantId: string): string => stableId(`legacy:price-list:${tenantId}`),
  priceItem: (tenantId: string, itemCode: string): string =>
    stableId(`legacy:price-item:${tenantId}:${itemCode}`),
  cost: (tenantId: string, itemCode: string): string =>
    stableId(`legacy:cost:${tenantId}:${itemCode}`),
  supplier: (tenantId: string, code: string): string =>
    stableId(`legacy:supplier:${tenantId}:${code}`),
  beat: (tenantId: string, name: string): string =>
    stableId(`legacy:beat:${tenantId}:${name.toUpperCase()}`),
  retailer: (tenantId: string, cashAcc: string): string =>
    stableId(`legacy:party:${tenantId}:${cashAcc}`),
  externalCode: (tenantId: string, cashAcc: string): string =>
    stableId(`legacy:party-code:${tenantId}:${cashAcc}`),
  openingInvoice: (tenantId: string, bookCode: string, salYear: string, billNo: string): string =>
    stableId(`legacy:opening-bill:${tenantId}:${bookCode}:${salYear}:${billNo}`),
  lot: (tenantId: string, itemCode: string): string =>
    stableId(`legacy:opening-lot:${tenantId}:${itemCode}`),
  /** The `importJobId` that opening bills carry in their journal narration: one label for the whole load. */
  loadLabel: (tenantId: string): string => stableId(`legacy:load:${tenantId}`),
}
