import { ORPCError } from '@orpc/server'
import { sql } from 'drizzle-orm'
import type { EarlierReceipt, ReceiptMode } from '@dos/contracts'
import { businessDate, formatINR, paise } from '@dos/domain'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * A PAYMENT REFERENCE IS USED ONCE (QA DOS-310, P0; architect ruling 2026-09-28, docs/22 §8 "money and credit" (1)).
 *
 * The same cheque number and the same UPI UTR were accepted again, each time as NEW money: RCPT-9021 and RCPT-9022
 * for one ₹595.00 cheque, RCPT-9103/9104/9105 for one ₹105.00 UPI transfer across two shops. Every door a receipt
 * comes in by reaches `recordReceipt`, which asks this before it draws a number:
 *
 *   * a UPI or bank-transfer reference (a UTR is unique per transfer) already on a LIVE receipt of this
 *     distributor is refused, whoever the shop — 409 `reference_already_recorded`;
 *   * a cheque number already on a LIVE receipt of the SAME shop is refused — 409 `cheque_already_recorded`;
 *   * the same cheque number from ANOTHER shop is a question, not an answer: refused 409
 *     `cheque_number_seen_elsewhere` with the earlier receipt in `data.earlier`, until the request carries
 *     `confirmReference: true` (two banks may print the same number on two shops' cheques).
 *
 * LIVE = `collected` or `deposited`, a positive amount, not a reversal mirror: a bounced or cancelled receipt frees
 * its reference. The comparison is `dos_normalise_reference()` (migration 0079): trimmed, every space removed, upper
 * case. The advisory lock is the one the database trigger `receipts_reference_is_free` takes, so two desks keying the
 * same UTR at the same instant take turns and the second is refused here, in words, instead of by the trigger.
 *
 * A replay (the same receipt id, the same idempotency key, the crew's same paper-book number) never reaches this:
 * `recordReceipt` returns the first result before it asks.
 */

/** The codes of the three refusals, for the offline door to keep (`receivables.sync.ts`, `delivery.sync.ts`). */
export const REFERENCE_REFUSALS: ReadonlySet<string> = new Set([
  'reference_already_recorded',
  'cheque_already_recorded',
  'cheque_number_seen_elsewhere',
])

const TRANSFER_MODES: ReadonlySet<ReceiptMode> = new Set<ReceiptMode>(['upi', 'bank_transfer'])

const MODE_WORD: Readonly<Record<string, string>> = {
  upi: 'UPI reference',
  bank_transfer: 'bank transfer reference',
  cheque: 'cheque',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "28 Sep 2026": the IST calendar date of an instant, as the desk reads it. */
export function istDay(at: Date | string): string {
  const iso = businessDate(new Date(at)).date
  const month = MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)
  return `${String(Number(iso.slice(8, 10)))} ${month} ${iso.slice(0, 4)}`
}

interface RawEarlier {
  id: string
  receipt_no: string | null
  retailer_id: string
  retailer_name: string
  mode: ReceiptMode
  reference: string
  amount_paise: string | number
  received_at: string | Date
}

function toEarlier(row: RawEarlier): EarlierReceipt {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    retailerId: row.retailer_id,
    retailerName: row.retailer_name,
    mode: row.mode,
    reference: row.reference,
    amountPaise: Number(row.amount_paise),
    receivedAt: new Date(row.received_at).toISOString(),
  }
}

/** "receipt RCPT-9021 of Sai Kirana, 28 Sep 2026, ₹595.00" — the earlier receipt, by name. */
function named(earlier: EarlierReceipt, withShop: boolean): string {
  const no = earlier.receiptNo ?? earlier.id
  const shop = withShop ? ` of ${earlier.retailerName}` : ''
  return `receipt ${no}${shop}, ${istDay(earlier.receivedAt)}, ${formatINR(paise(earlier.amountPaise))}`
}

/**
 * Refuses a reference that is already live (see the head of this file). Takes the reference's advisory lock
 * first, in the transaction that will write the receipt, so the answer holds until it commits.
 */
export async function assertReferenceFree(
  tx: Db,
  input: {
    retailerId: string
    mode: ReceiptMode
    reference?: string | null | undefined
    confirmReference?: boolean | undefined
  },
): Promise<void> {
  const reference = input.reference?.trim() ?? ''
  if (reference === '') return
  const transfer = TRANSFER_MODES.has(input.mode)
  if (!transfer && input.mode !== 'cheque') return
  const { tenantId } = currentTenant()
  const normalised = await tx.execute(sql`select dos_normalise_reference(${reference}) as ref`)
  const ref = (normalised.rows[0] as { ref: string } | undefined)?.ref ?? ''
  if (ref === '') return
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`receipt-ref:${tenantId}:${ref}`}))`)
  const family = transfer ? sql`('upi', 'bank_transfer')` : sql`('cheque')`
  const found = await tx.execute(sql`
    select r.id, r.receipt_no, r.retailer_id, coalesce(rt.name, r.retailer_id) as retailer_name,
           r.mode::text as mode, r.reference, r.amount_paise, r.received_at
      from receipts r
      left join retailers rt on rt.tenant_id = r.tenant_id and rt.id = r.retailer_id
     where r.tenant_id = ${tenantId}
       and r.reference is not null
       and dos_normalise_reference(r.reference) = ${ref}
       and r.amount_paise > 0
       and r.reverses_receipt_id is null
       and r.status in ('collected', 'deposited')
       and r.mode in ${family}
     order by r.received_at asc, r.id asc
     limit 20`)
  const rows = (found.rows as unknown as RawEarlier[]).map(toEarlier)
  const first = rows[0]
  if (!first) return
  if (transfer) {
    throw new ORPCError('CONFLICT', {
      message: `${MODE_WORD[input.mode] ?? 'reference'} ${reference} is already on ${named(first, true)}; one payment is recorded once. Open that receipt, or check the reference in the bank or UPI app`,
      data: { code: 'reference_already_recorded', earlier: first },
    })
  }
  const sameShop = rows.find((row) => row.retailerId === input.retailerId)
  if (sameShop) {
    throw new ORPCError('CONFLICT', {
      message: `cheque ${reference} of ${sameShop.retailerName} is already on ${named(sameShop, false)}; one cheque is recorded once. Open that receipt, or check the cheque number`,
      data: { code: 'cheque_already_recorded', earlier: sameShop },
    })
  }
  if (input.confirmReference === true) return
  throw new ORPCError('CONFLICT', {
    message: `cheque number ${reference} is already on ${named(first, true)}; if this is a different cheque of this shop, confirm it and record it again`,
    data: { code: 'cheque_number_seen_elsewhere', earlier: first },
  })
}
