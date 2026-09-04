import { add, paise, percentOf, type Paise } from './money.js'

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
  const intra = supplierStateCode === placeOfSupplyStateCode
  if (intra) {
    const half = percentOf(taxable, rateBps / 2)
    const tax = add(half, half)
    return {
      taxable,
      rateBps,
      cgst: half,
      sgst: half,
      igst: paise(0),
      tax,
      total: add(taxable, tax),
      kind: 'intra',
    }
  }
  const igst = percentOf(taxable, rateBps)
  return {
    taxable,
    rateBps,
    cgst: paise(0),
    sgst: paise(0),
    igst,
    tax: igst,
    total: add(taxable, igst),
    kind: 'inter',
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
