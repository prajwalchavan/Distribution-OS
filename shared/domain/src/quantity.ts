/**
 * Quantities are stored in base units (pieces). A case size belongs to the tenant's product record,
 * because the same SKU ships in different case packs from different suppliers (x90 vs x96 vs x120).
 */
export type Pieces = number & { readonly __brand: 'Pieces' }

export class QuantityError extends Error {
  override name = 'QuantityError'
}

export function pieces(n: number): Pieces {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new QuantityError(`Pieces must be a non-negative integer: ${n}`)
  return n as Pieces
}

export function toPieces(cases: number, loosePieces: number, caseSize: number): Pieces {
  if (!Number.isSafeInteger(caseSize) || caseSize <= 0)
    throw new QuantityError(`Bad case size: ${caseSize}`)
  if (!Number.isSafeInteger(cases) || cases < 0) throw new QuantityError(`Bad case count: ${cases}`)
  if (!Number.isSafeInteger(loosePieces) || loosePieces < 0)
    throw new QuantityError(`Bad loose pieces: ${loosePieces}`)
  return pieces(cases * caseSize + loosePieces)
}

export function toCasesAndPieces(qty: Pieces, caseSize: number): { cases: number; pieces: number } {
  if (!Number.isSafeInteger(caseSize) || caseSize <= 0)
    throw new QuantityError(`Bad case size: ${caseSize}`)
  return { cases: Math.floor(qty / caseSize), pieces: qty % caseSize }
}

/** "2 cs + 3 pcs", "1 cs", "5 pcs" */
export function formatQty(
  qty: Pieces,
  caseSize: number,
  labels = { cs: 'cs', pcs: 'pcs' },
): string {
  const { cases, pieces: loose } = toCasesAndPieces(qty, caseSize)
  const parts: string[] = []
  if (cases > 0) parts.push(`${cases} ${labels.cs}`)
  if (loose > 0 || cases === 0) parts.push(`${loose} ${labels.pcs}`)
  return parts.join(' + ')
}

/**
 * Best-effort case size from a supplier's item description. Real examples:
 *  "MOM Makhana 12g - Himalayan Salt N Paper x 90"  -> 90
 *  "TY!Wafers Chilli 21.5G(16+5.5)_120"             -> 120
 *  "MOM Panchameva 20G Pouch x 144"                 -> 144
 *  "SURE WATER BY CAMPA 1L 2.0"                     -> null (case size comes from UOM "CS1" master)
 */
export function parseCaseSizeFromName(name: string): number | null {
  const patterns = [
    /\bx\s*(\d{1,4})\s*$/i,
    /_(\d{1,4})\s*(?:EWS|WS)?\s*$/i,
    /\((\d{1,4})\s*(?:pcs|pc|nos)\)\s*$/i,
  ]
  for (const re of patterns) {
    const m = re.exec(name.trim())
    if (m?.[1]) {
      const n = Number(m[1])
      if (n >= 2 && n <= 2000) return n
    }
  }
  return null
}
