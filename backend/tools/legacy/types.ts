/**
 * What the parsers hand to the planner. Everything here is the LEGACY vocabulary (item code, cash account,
 * bill number); the mapping into the app's own words lives in `plan.ts`.
 *
 * Nothing in an `Issue` may carry a name, a phone number or a GSTIN: issues are counted by `kind` in the
 * report and printed by reference (`source:row`), so the report can be shared without the data.
 */

export type IssueKind =
  | 'duplicate-item-code'
  | 'duplicate-bill'
  | 'bad-amount'
  | 'bad-date'
  | 'bad-gstin'
  | 'bad-phone'
  | 'missing-phone'
  | 'missing-hsn'
  | 'hsn-padded'
  | 'hsn-assumed'
  | 'hsn-rate-conflict'
  | 'hsn-rate-differs-from-catalogue'
  | 'missing-price'
  | 'missing-mrp'
  | 'price-above-mrp'
  | 'price-below-half-mrp'
  | 'inactive-item'
  | 'unknown-customer'
  | 'name-differs-from-master'
  | 'settled-bill'
  | 'over-received-bill'
  | 'partly-received-bill'
  | 'blank-area'
  | 'state-unknown'
  | 'gstin-state-mismatch'
  | 'possible-duplicate-customer'
  | 'shared-phone'
  | 'shared-gstin'
  | 'record-incomplete'
  | 'unsupported-row'

export interface Issue {
  kind: IssueKind
  /** `products:12`, `outstanding:40`, `customers:code-only` — a location, never a value. */
  ref: string
}

/** One row of `CompanywiseProductList.xlsx`. */
export interface LegacyItem {
  code: string
  title: string
  /** `ITEM_PACK`: `EACH`, `CASE`, `CASES`, or a size label (`250ML`). The price is per this unit. */
  packLabel: string
  unitKind: 'each' | 'case' | 'other'
  mfgCode: string
  mfgName: string
  gstBps: number
  /** The code exactly as the sheet gave it (digits only), or null. */
  hsnRaw: string | null
  salePaise: number | null
  mrpPaise: number | null
  active: boolean
  row: number
}

/** One row of `DateWiseOutStanding.xlsx`: one open bill. */
export interface LegacyBill {
  bookCode: string
  salYear: string
  billNo: string
  cashAcc: string
  title: string
  areaName: string
  salesman: string
  billDate: string
  dueDate: string | null
  amountPaise: number
  receivedPaise: number
  creditDays: number
  row: number
}

/** One customer of the master list (the PDF, or `m_accmas` in the backup). */
export interface LegacyCustomer {
  code: string
  name: string
  address1: string
  address2: string
  address3: string
  phoneRaw: string
  altPhoneRaw: string
  areaName: string
  pincode: string
  gstinRaw: string
  ownerName: string
  email: string
  pan: string
  stateCode: string
  foodLicense: string
}

/** What one Sales-GST row tells us about a customer (the sheet has bills, not lines). */
export interface LegacySalesGstRow {
  cashAcc: string
  gstinRaw: string
  stateLabel: string
  billNo: string
  billDate: string
  taxablePaise: number
  totalPaise: number
  gstSlabBps: number
  row: number
}

export interface Parsed<T> {
  items: T[]
  issues: Issue[]
}
