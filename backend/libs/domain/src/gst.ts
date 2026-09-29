import { add, divideHalfUp, paise, type Paise } from './money.js'

/** The dated rates of one HSN heading (`hsn_rates`): GST and the compensation cess that rides with it. */
export interface GstRate {
  gstBps: number
  cessBps: number
}

/** The tax of one line, every figure in paise. `taxPaise` = CGST + SGST + IGST + cess. */
export interface LineTax {
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  /** CGST + SGST + IGST. */
  gstPaise: number
  taxPaise: number
}

/**
 * THE ONE WAY GST IS COMPUTED, from the quote to the bill (docs/22 §8, 2026-09-28, ruling 2 — QA DOS-332).
 *
 * Per ORDER LINE, on its taxable value: inside the state CGST and SGST are each HALF the rate, each rounded half
 * up to the paisa (so they are always equal); across states IGST is the whole rate, rounded once. Cess is its own
 * rate on the same taxable. The quote, the order, the bill and the credit note all call this; the bill then
 * shares an order line's figures over its batch lines (`billOrderLine`) so they add up to exactly these, and the
 * document is rounded to the rupee once. The quote used to take the combined rate (12 % of ₹10.25 = 123 p) while
 * the bill split it (61.5 p → 62 p, twice = 124 p), so a shop told ₹21 was billed ₹22.
 */
export function lineTax(taxablePaise: number, rate: GstRate, interState: boolean): LineTax {
  const half = interState ? 0 : divideHalfUp(taxablePaise * rate.gstBps, 20_000)
  const igst = interState ? divideHalfUp(taxablePaise * rate.gstBps, 10_000) : 0
  const cess = divideHalfUp(taxablePaise * rate.cessBps, 10_000)
  const gst = half + half + igst
  return {
    cgstPaise: half,
    sgstPaise: half,
    igstPaise: igst,
    cessPaise: cess,
    gstPaise: gst,
    taxPaise: gst + cess,
  }
}

/**
 * Place of supply: the shop's state, except that a REGISTERED shop's GSTIN prefix is its state by law, so when
 * the two disagree the GSTIN wins (the return is filed against it). An unregistered or composition shop's
 * captured GSTIN is not printed and does not decide anything.
 */
export function placeOfSupply(buyer: {
  gstin: string | null
  stateCode: string
  gstRegType?: string | null | undefined
}): string {
  const registered = buyer.gstRegType === undefined || buyer.gstRegType === 'regular'
  const gstin = registered ? buyer.gstin : null
  return gstin ? gstin.trim().slice(0, 2) : buyer.stateCode
}

/** Indian GST: intra-state supply splits the rate equally into CGST + SGST; inter-state charges IGST. */
export interface GstSplit {
  taxable: Paise
  rateBps: number
  cgst: Paise
  sgst: Paise
  igst: Paise
  tax: Paise
  total: Paise
  kind: 'intra' | 'inter'
}

export function splitGst(
  taxable: Paise,
  rateBps: number,
  supplierStateCode: string,
  placeOfSupplyStateCode: string,
): GstSplit {
  // `lineTax` is the rule; this is its older shape (no cess), kept for the purchase side and the reader.
  const intra = supplierStateCode === placeOfSupplyStateCode
  const t = lineTax(taxable, { gstBps: rateBps, cessBps: 0 }, !intra)
  const tax = paise(t.gstPaise)
  return {
    taxable,
    rateBps,
    cgst: paise(t.cgstPaise),
    sgst: paise(t.sgstPaise),
    igst: paise(t.igstPaise),
    tax,
    total: add(taxable, tax),
    kind: intra ? 'intra' : 'inter',
  }
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Validates format and the mod-36 check digit used by GSTN. */
export function isValidGstin(input: string): boolean {
  const gstin = input.trim().toUpperCase()
  if (!GSTIN_RE.test(gstin)) return false
  let total = 0
  for (let i = 0; i < 14; i++) {
    const value = ALPHABET.indexOf(gstin[i] ?? '')
    if (value < 0) return false
    const factor = i % 2 === 0 ? 1 : 2
    const product = value * factor
    total += Math.floor(product / 36) + (product % 36)
  }
  const check = ALPHABET[(36 - (total % 36)) % 36]
  return check === gstin[14]
}

export function stateCodeFromGstin(gstin: string): string {
  return gstin.trim().slice(0, 2)
}

export function panFromGstin(gstin: string): string {
  return gstin.trim().toUpperCase().slice(2, 12)
}

/** Indian financial year label for a date: 2026-08-11 -> "2026-27"; 2027-02-01 -> "2026-27". */
export function financialYearLabel(date: Date): string {
  const year = date.getFullYear()
  const startYear = date.getMonth() >= 3 ? year : year - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** Indian state codes used on GST invoices (first two digits of a GSTIN). */
export const STATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
}
