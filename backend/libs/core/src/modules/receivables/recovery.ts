import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { WriteOffRecovery } from '@dos/contracts'
import { businessDate, uuidv7 } from '@dos/domain'
import { allocations, writeOffs, type Db } from '@dos/db'
import type { AllocationRow } from './receivables.mappers.js'
import { BACK_OFFICE, currentTenant } from '../../platform/index.js'
import { idList } from './outstanding.js'
import { emitEvent, postJournalEntry } from './posting.js'

/**
 * MONEY RECEIVED AFTER A WRITE-OFF RECOVERS THE WRITE-OFF FIRST (QA DOS-311, P0; architect ruling 2026-09-28,
 * docs/22 §8 "money and credit" (2)).
 *
 * How a write-off is booked (`createWriteOff`): a `write_offs` row, an `allocations` row from it that closes the
 * bill's open value, one entry DR Bad debts / CR AR, and — when it takes the whole of what was open — the bill's
 * state `written_off` through the invoice machine. Before this, a shop that turned up and paid the ₹395.00 it
 * owed found no bill to take it (a written-off bill takes no money) and the money became the SHOP'S CREDIT: the
 * write-off stood in the books as a loss while the next bill was ₹395.00 short.
 *
 * Now, before anything reaches an open bill, the money goes to what still stands written off on the shop's
 * `written_off` bills, oldest write-off first. Per write-off it recovers:
 *   * a RECOVERY row in `write_offs` — the same shape, a negative amount, `reverses_write_off_id` = the
 *     write-off, `receipt_id` = the money; its own `allocations` row (negative) takes the write-off's hold off
 *     the bill; its own entry DR AR / CR Bad debts puts the debt back where the money can meet it;
 *   * the receipt's own allocation to that bill (positive), in the caller's list like any other.
 * The bill stays `written_off` (and nets to zero), the receipt's entry is the ordinary DR cash / CR AR, so AR,
 * the shop's dues and its money on account come out exactly where they were: the ₹395.00 is income on Bad debts,
 * not the shop's credit. The trial balance still totals zero, and every write-off row of the register still has
 * DR Bad debts = its amount and an allocation of its amount — which is what the reconcile holds them to.
 *
 * A receipt reversed or bounced after it recovered something re-instates it (`reinstateRecoveries`): a positive
 * row with the same `reverses_write_off_id` and the reversal's `receipt_id`, its allocation and DR Bad debts /
 * CR AR. Migration 0079 keeps every write-off between 0 and its amount at commit.
 *
 * `write_offs` is back office at the database. The crew's money recovers write-offs too (the rule is about the
 * money, not who took it), so the recovery runs as the system role for its own statements — the escalation the
 * other modules use for a write that follows from the caller's own (see `asSystemRole`).
 */

/** One write-off with what still stands of it, on a bill that is `written_off`. */
interface StandingWriteOff {
  id: string
  invoiceId: string
  invoiceNo: string | null
  reason: string
  writtenOffAt: Date
  standingPaise: number
}

/** What one recovery wrote: the lines the caller adds to the receipt's reply and allocations. */
export interface RecoveredLine {
  writeOffId: string
  recoveryId: string
  invoiceId: string
  invoiceNo: string | null
  writtenOffAt: Date
  amountPaise: number
}

const WRITE_OFF_READERS: ReadonlySet<string> = new Set(BACK_OFFICE)

/** Run `fn` as the system role unless the caller may already read and write `write_offs`. */
async function asBackOffice<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  if (WRITE_OFF_READERS.has(ctx.actorRole)) return fn()
  try {
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return await fn()
  } finally {
    await tx
      .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
      .catch(() => undefined)
  }
}

/** The shop's written-off bills with what still stands written off on each, per write-off, oldest first. */
async function standingWriteOffs(tx: Db, retailerId: string): Promise<StandingWriteOff[]> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select w.id, w.invoice_id, i.invoice_no, w.reason, w.created_at,
           w.amount_paise + coalesce(sum(x.amount_paise), 0) as standing
      from write_offs w
      join invoices i on i.tenant_id = w.tenant_id and i.id = w.invoice_id
      left join write_offs x on x.tenant_id = w.tenant_id and x.reverses_write_off_id = w.id
     where w.tenant_id = ${tenantId}
       and w.retailer_id = ${retailerId}
       and w.reverses_write_off_id is null
       and i.state = 'written_off'
     group by w.id, w.invoice_id, i.invoice_no, i.invoice_date, w.reason, w.created_at, w.amount_paise
    having w.amount_paise + coalesce(sum(x.amount_paise), 0) > 0
     order by w.created_at asc, i.invoice_date asc, w.id asc`)
  return (
    result.rows as unknown as {
      id: string
      invoice_id: string
      invoice_no: string | null
      reason: string
      created_at: string | Date
      standing: string | number
    }[]
  ).map((row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    invoiceNo: row.invoice_no,
    reason: row.reason,
    writtenOffAt: new Date(row.created_at),
    standingPaise: Number(row.standing),
  }))
}

/** One write-off a receipt will recover, and how much of it: the read half, taken before the receipt is written. */
export interface RecoveryPlanLine {
  writeOffId: string
  invoiceId: string
  invoiceNo: string | null
  reason: string
  writtenOffAt: Date
  amountPaise: number
}

/**
 * What `availablePaise` of a new receipt recovers for this shop, oldest write-off first. Read-only, so
 * `recordReceipt` can plan the rest of the money (FIFO, the cash discount it stores on the receipt) on what is left
 * BEFORE it writes the receipt; `writeRecoveries` then writes it. Called under the shop's money lock.
 */
export async function planRecoveries(
  tx: Db,
  retailerId: string,
  availablePaise: number,
): Promise<RecoveryPlanLine[]> {
  if (availablePaise <= 0) return []
  return asBackOffice(tx, async () => {
    const plan: RecoveryPlanLine[] = []
    let left = availablePaise
    for (const writeOff of await standingWriteOffs(tx, retailerId)) {
      if (left <= 0) break
      const amount = Math.min(left, writeOff.standingPaise)
      left -= amount
      plan.push({
        writeOffId: writeOff.id,
        invoiceId: writeOff.invoiceId,
        invoiceNo: writeOff.invoiceNo,
        reason: writeOff.reason,
        writtenOffAt: writeOff.writtenOffAt,
        amountPaise: amount,
      })
    }
    return plan
  })
}

/**
 * Writes a planned recovery for the receipt just written: per write-off the recovery row, its (negative)
 * allocation, its entry DR AR / CR Bad debts, and the receipt's own allocation to the bill, which it returns.
 */
export async function writeRecoveries(
  tx: Db,
  receipt: { id: string; receiptNo: string; retailerId: string; receivedBy: string; at: Date },
  plan: readonly RecoveryPlanLine[],
): Promise<{ lines: RecoveredLine[]; allocations: AllocationRow[] }> {
  if (plan.length === 0) return { lines: [], allocations: [] }
  const { tenantId, actorId } = currentTenant()
  return asBackOffice(tx, async () => {
    const lines: RecoveredLine[] = []
    const written: AllocationRow[] = []
    for (const line of plan) {
      const amount = line.amountPaise
      const recoveryId = uuidv7()
      const entry = await postJournalEntry(tx, {
        entryDate: businessDate(receipt.at).date,
        refType: 'writeoff',
        refId: recoveryId,
        narration: `bad debt recovered by ${receipt.receiptNo}`,
        idempotencyKey: `journal:writeoff:${recoveryId}`,
        lines: [
          {
            accountCode: 'AR',
            amountPaise: amount,
            partyType: 'retailer',
            partyId: receipt.retailerId,
          },
          { accountCode: 'BAD_DEBTS', amountPaise: -amount },
        ],
      })
      await tx.insert(writeOffs).values({
        id: recoveryId,
        tenantId,
        invoiceId: line.invoiceId,
        retailerId: receipt.retailerId,
        amountPaise: -amount,
        reason: line.reason,
        note: `recovered by ${receipt.receiptNo}`,
        approvedBy: receipt.receivedBy,
        journalEntryId: entry.entryId,
        idempotencyKey: `recovery:${receipt.id}:${line.writeOffId}`,
        reversesWriteOffId: line.writeOffId,
        receiptId: receipt.id,
      })
      // The write-off's hold on the bill comes off, and the money takes its place: the bill still nets to zero.
      await tx.insert(allocations).values({
        id: uuidv7(),
        tenantId,
        invoiceId: line.invoiceId,
        writeOffId: recoveryId,
        amountPaise: -amount,
        allocatedBy: actorId,
      })
      const [row] = await tx
        .insert(allocations)
        .values({
          id: uuidv7(),
          tenantId,
          invoiceId: line.invoiceId,
          receiptId: receipt.id,
          amountPaise: amount,
          allocatedBy: actorId,
        })
        .returning()
      if (row) written.push(row)
      await emitEvent(tx, 'invoice', line.invoiceId, 'WriteOffRecovered', {
        invoiceId: line.invoiceId,
        writeOffId: line.writeOffId,
        recoveryId,
        receiptId: receipt.id,
        amountPaise: amount,
      })
      lines.push({
        writeOffId: line.writeOffId,
        recoveryId,
        invoiceId: line.invoiceId,
        invoiceNo: line.invoiceNo,
        writtenOffAt: line.writtenOffAt,
        amountPaise: amount,
      })
    }
    return { lines, allocations: written }
  })
}

/**
 * The undo of a receipt that recovered write-offs (`undoReceipt`: a reversal or a bounced cheque): each recovery
 * is matched by a re-instatement row, its allocation and DR Bad debts / CR AR, so the write-off stands again
 * exactly. The reversal's mirror of the receipt's own allocations is `undoReceipt`'s, as for any bill.
 */
export async function reinstateRecoveries(
  tx: Db,
  original: { id: string; receiptNo: string | null; retailerId: string },
  reversal: { id: string; receiptNo: string; receivedBy: string; at: Date },
): Promise<void> {
  const { tenantId, actorId } = currentTenant()
  await asBackOffice(tx, async () => {
    const recovered = await tx
      .select()
      .from(writeOffs)
      .where(
        and(
          eq(writeOffs.tenantId, tenantId),
          eq(writeOffs.receiptId, original.id),
          isNotNull(writeOffs.reversesWriteOffId),
        ),
      )
      .orderBy(asc(writeOffs.id))
    for (const row of recovered) {
      if (row.amountPaise >= 0 || row.reversesWriteOffId === null) continue
      const amount = -row.amountPaise
      const reinstateId = uuidv7()
      const entry = await postJournalEntry(tx, {
        entryDate: businessDate(reversal.at).date,
        refType: 'writeoff',
        refId: reinstateId,
        narration: `write-off stands again: ${original.receiptNo ?? original.id} undone by ${reversal.receiptNo}`,
        idempotencyKey: `journal:writeoff:${reinstateId}`,
        lines: [
          { accountCode: 'BAD_DEBTS', amountPaise: amount },
          {
            accountCode: 'AR',
            amountPaise: -amount,
            partyType: 'retailer',
            partyId: original.retailerId,
          },
        ],
      })
      await tx.insert(writeOffs).values({
        id: reinstateId,
        tenantId,
        invoiceId: row.invoiceId,
        retailerId: row.retailerId,
        amountPaise: amount,
        reason: row.reason,
        note: `stands again: ${original.receiptNo ?? original.id} undone by ${reversal.receiptNo}`,
        approvedBy: reversal.receivedBy,
        journalEntryId: entry.entryId,
        idempotencyKey: `recovery-undone:${reversal.id}:${row.id}`,
        reversesWriteOffId: row.reversesWriteOffId,
        receiptId: reversal.id,
      })
      await tx.insert(allocations).values({
        id: uuidv7(),
        tenantId,
        invoiceId: row.invoiceId,
        writeOffId: reinstateId,
        amountPaise: amount,
        allocatedBy: actorId,
      })
    }
  })
}

/**
 * What these receipts recovered, one line per bill (DOS-311: "₹395.00 recovered from a bill written off on …").
 * `writtenOffOn` is the IST date of the bill's latest write-off. The staff who took or read the money see what it
 * recovered (read as the system role, like the recovery itself: `write_offs` is back office); a shop reading its own
 * receipt gets no list — the write-off is the distributor's decision, not the shop's document.
 */
export async function recoveriesOf(
  tx: Db,
  receiptIds: readonly string[],
): Promise<Map<string, WriteOffRecovery[]>> {
  const out = new Map<string, WriteOffRecovery[]>()
  const ids = [...new Set(receiptIds)]
  if (ids.length === 0) return out
  const { tenantId, actorRole } = currentTenant()
  if (actorRole === 'retailer') return out
  const result = await asBackOffice(tx, () =>
    tx.execute(sql`
    select x.receipt_id, x.invoice_id, i.invoice_no, max(w.created_at) as written_off_at,
           -sum(x.amount_paise) as amount
      from write_offs x
      join write_offs w on w.tenant_id = x.tenant_id and w.id = x.reverses_write_off_id
      join invoices i on i.tenant_id = x.tenant_id and i.id = x.invoice_id
     where x.tenant_id = ${tenantId}
       and x.receipt_id in (${idList(ids)})
     group by x.receipt_id, x.invoice_id, i.invoice_no
     order by min(w.created_at) asc, x.invoice_id asc`),
  )
  for (const row of result.rows as unknown as {
    receipt_id: string
    invoice_id: string
    invoice_no: string | null
    written_off_at: string | Date
    amount: string | number
  }[]) {
    const list = out.get(row.receipt_id) ?? []
    list.push({
      invoiceId: row.invoice_id,
      invoiceNo: row.invoice_no,
      writtenOffOn: businessDate(new Date(row.written_off_at)).date,
      amountPaise: Number(row.amount),
    })
    out.set(row.receipt_id, list)
  }
  return out
}

/** The recovery rows a receipt wrote, as `RecoveredLine`s grouped per bill, for the reply of the write itself. */
export function recoveriesFromLines(lines: readonly RecoveredLine[]): WriteOffRecovery[] {
  const byBill = new Map<string, WriteOffRecovery & { at: number }>()
  for (const line of lines) {
    const held = byBill.get(line.invoiceId)
    const at = line.writtenOffAt.getTime()
    if (held) {
      held.amountPaise += line.amountPaise
      if (at > held.at) {
        held.at = at
        held.writtenOffOn = businessDate(line.writtenOffAt).date
      }
    } else {
      byBill.set(line.invoiceId, {
        invoiceId: line.invoiceId,
        invoiceNo: line.invoiceNo,
        writtenOffOn: businessDate(line.writtenOffAt).date,
        amountPaise: line.amountPaise,
        at,
      })
    }
  }
  return [...byBill.values()].map(({ at: _at, ...line }) => line)
}
