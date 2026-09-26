import { clean } from './text.js'
import type { Issue, LegacyCustomer, Parsed } from './types.js'

/**
 * The customer master, from `customer data whole pdf.pdf` ("AccountWise ListWithAll Details2", a Crystal
 * report from TradeEzee's vendor). The importer reads the PDF's TEXT in LAYOUT mode — one record is a header
 * line (`CODE   PARTY NAME`) and seven labelled lines under it:
 *
 *     11002       <PARTY NAME>
 *                Address Line1         : <line 1>
 *                Address Line2         : <line 2>                       Telephone no:        <phone>
 *                Address line 3        : <line 3>
 *                Area Name             : <area>                         Pincode  :           <pin>
 *                GST NO.               : <gstin>
 *                Food License          : <licence>                      Valid Upto :         <date>
 *
 * Pages repeat a banner (firm name, report title, `CODE  PARTY NAME`) and a footer; neither matches a
 * record header because a header is `<4-6 digits>` followed by two or more spaces and a name.
 */
const HEADER = /^\s*(\d{4,6})\s{2,}(\S.*?)\s*$/
const LINE1 = /^\s*Address Line1\s*:\s*(.*?)\s*$/
const LINE2 = /^\s*Address Line2\s*:\s*(.*?)\s+Telephone no:\s*(\S*)\s*$/
const LINE3 = /^\s*Address line 3\s*:\s*(.*?)\s*$/
const AREA = /^\s*Area Name\s*:\s*(.*?)\s+Pincode\s*:\s*(\S*)\s*$/
const GST = /^\s*GST NO\.\s*:\s*(.*?)\s*$/
const FOOD = /^\s*Food License\s*:\s*(.*?)\s+Valid Upto\s*:\s*(\S*)\s*$/

export function parseCustomerMasterText(text: string): Parsed<LegacyCustomer> {
  const items: LegacyCustomer[] = []
  const issues: Issue[] = []
  let cur: LegacyCustomer | null = null
  let seenFields = 0
  const close = (): void => {
    if (!cur) return
    if (seenFields < 4) issues.push({ kind: 'record-incomplete', ref: `customers:${cur.code}` })
    items.push(cur)
    cur = null
    seenFields = 0
  }
  for (const line of text.split(/\r?\n/)) {
    const h = HEADER.exec(line)
    if (h && !/^\s*CODE\b/i.test(line)) {
      close()
      cur = {
        code: h[1] ?? '',
        name: clean(h[2]),
        address1: '',
        address2: '',
        address3: '',
        phoneRaw: '',
        altPhoneRaw: '',
        areaName: '',
        pincode: '',
        gstinRaw: '',
        ownerName: '',
        email: '',
        pan: '',
        stateCode: '',
        foodLicense: '',
      }
      continue
    }
    if (!cur) continue
    let m: RegExpExecArray | null
    if ((m = LINE1.exec(line))) {
      cur.address1 = clean(m[1])
      seenFields++
    } else if ((m = LINE2.exec(line))) {
      cur.address2 = clean(m[1])
      cur.phoneRaw = clean(m[2])
      seenFields++
    } else if ((m = LINE3.exec(line))) {
      cur.address3 = clean(m[1])
      seenFields++
    } else if ((m = AREA.exec(line))) {
      cur.areaName = clean(m[1])
      cur.pincode = clean(m[2])
      seenFields++
    } else if ((m = GST.exec(line))) {
      cur.gstinRaw = clean(m[1]).toUpperCase()
      seenFields++
    } else if ((m = FOOD.exec(line))) {
      cur.foodLicense = clean(m[1])
      seenFields++
    }
  }
  close()
  return { items, issues }
}

/**
 * Combine two lists of the same customers: the PDF (the master the founder handed over) leads; the backup
 * fills the fields the PDF leaves blank (a second phone, the owner's name, a GSTIN, the state) and adds
 * the customers created after the PDF was printed. Where both hold a value the PDF's wins, and the count of
 * customers on whom the two disagree is returned so the report can say how far the sources drifted.
 */
export function mergeCustomers(
  primary: readonly LegacyCustomer[],
  extra: readonly LegacyCustomer[],
): { customers: LegacyCustomer[]; onlyInExtra: number; disagreements: number } {
  const byCode = new Map(extra.map((c) => [c.code, c]))
  const seen = new Set<string>()
  let disagreements = 0
  const empty = (v: string): boolean => v === '' || /^0+$/.test(v)
  const merged = primary.map((p) => {
    seen.add(p.code)
    const e = byCode.get(p.code)
    if (!e) return p
    const out: LegacyCustomer = { ...p }
    let differs = false
    for (const key of Object.keys(p) as (keyof LegacyCustomer)[]) {
      if (key === 'code') continue
      const a = p[key]
      const b = e[key]
      if (empty(a) && !empty(b)) out[key] = b
      else if (!empty(a) && !empty(b) && a.toUpperCase() !== b.toUpperCase()) differs = true
    }
    if (differs) disagreements++
    return out
  })
  const added = extra.filter((e) => !seen.has(e.code))
  return { customers: [...merged, ...added], onlyInExtra: added.length, disagreements }
}
