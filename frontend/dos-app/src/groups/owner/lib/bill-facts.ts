/**
 * What one open bill in a shop's panel says, in words (UX-O-7).
 *
 * The Money → shop panel printed "INV/9048 · 4 Oct · ₹2,624.00" and "INV/0433 · 30 Jul · ₹4,561.00": the
 * date was the DUE date with no label (INV/9048 was billed on 27 Sep) and the amount was what is LEFT of
 * a ₹10,119 bill, with nothing saying so. The panel now names both dates, and when part of a bill has
 * been paid it says "left of" the bill's own total; a bill past its due date says how many days late.
 */
export interface OpenBillLike {
  invoiceDate: string
  dueDate: string | null
  totalPaise: number
  openPaise: number
  /** Days since the due date, negative when not due yet (receivables' own IST arithmetic). */
  ageDays: number
}

export interface BillFacts {
  billed: string
  due: string | null
  /** Days past the due date; null while it is not due yet (or has no due date). */
  lateDays: number | null
  /** Part of the bill is paid: the open amount is "left of" the total. */
  partPaid: boolean
}

export function billFacts(bill: OpenBillLike): BillFacts {
  return {
    billed: bill.invoiceDate,
    due: bill.dueDate,
    lateDays: bill.dueDate !== null && bill.ageDays > 0 ? bill.ageDays : null,
    partPaid: bill.openPaise < bill.totalPaise,
  }
}
