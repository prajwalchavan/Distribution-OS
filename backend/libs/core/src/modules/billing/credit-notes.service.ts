import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CancelCreditNoteInput,
  CancelCreditNoteOutput,
  CreateCreditNoteInput,
  CreateCreditNoteOutput,
  CreditNoteDetail,
  CreditNoteGetInput,
  CreditNoteGetOutput,
  CreditNoteReason,
  CreditNotesListInput,
  CreditNotesListOutput,
  IssueCreditNoteInput,
  IssueCreditNoteOutput,
} from '@dos/contracts'
import { isSaleableCreditNoteReason } from '@dos/contracts'
import {
  creditableTaxable,
  financialYear,
  paise,
  percentOf,
  piecesLeftToCredit,
  roundToRupee,
  uuidv7,
} from '@dos/domain'
import {
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoices,
  locations,
  outboxEvents,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  requestDocumentRender,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { InventoryService } from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import { ReceivablesService } from '../receivables/index.js'
import { asLedgerPoster, invoiceDateOf, loadSeller } from './billing.internals.js'
import {
  loadCreditNoteDetail,
  toCreditNoteListItem,
  type CreditNoteRow,
} from './billing.mappers.js'
import { ANY_MEMBER, BillingService } from './invoices.service.js'

/**
 * The credit note: the ONLY lawful correction to an issued tax invoice (ADR 0004). Short delivery, a
 * saleable or damaged return, a rate difference, a scheme settlement — all of them reverse part of a
 * bill AT THE ORIGINAL RATE and the frozen tax of the line they correct. Never today's price list,
 * never a re-quote, and never an edit of the invoice row itself.
 *
 * A note is drafted (no number, no stock, no journal), then ISSUED: the number comes from the tenant's
 * configured `CN` series at that moment, the returned pieces go back into stock through
 * `InventoryService`, and the money goes back through `ReceivablesService.postCreditNoteIssued`, which
 * posts the reversing entry and allocates the note against the bill so the shop's outstanding drops.
 * A purely financial note (rate difference, scheme settlement) moves no goods at all.
 */

type CreateIn = z.infer<typeof CreateCreditNoteInput>
type CreateOut = z.infer<typeof CreateCreditNoteOutput>
type IssueIn = z.infer<typeof IssueCreditNoteInput>
type IssueOut = z.infer<typeof IssueCreditNoteOutput>
type CancelIn = z.infer<typeof CancelCreditNoteInput>
type CancelOut = z.infer<typeof CancelCreditNoteOutput>
type GetIn = z.infer<typeof CreditNoteGetInput>
type GetOut = z.infer<typeof CreditNoteGetOutput>
type ListIn = z.infer<typeof CreditNotesListInput>
type ListOut = z.infer<typeof CreditNotesListOutput>

type OrderRow = NonNullable<Awaited<ReturnType<OrdersService['findOrder']>>>

/** The tenant's credit-note series key; its prefix and starting number are configuration (docs/17 §D1). */
export const CREDIT_NOTE_SERIES = 'CN'

const CREDIT_NOTE_RAISERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'delivery',
  'system',
]

/** A bill you can still correct. A draft was never issued; a cancelled one was undone in full. */
const CREDITABLE_INVOICE_STATES = new Set(['issued', 'partially_paid', 'paid', 'written_off'])

/** Reasons where goods physically come back. Everything else is money only — no ledger row at all. */
const RESTOCKING_REASONS = new Set<CreditNoteReason>([
  'short_delivery',
  'return_saleable',
  'return_damaged',
  'cancellation',
])

/**
 * Whether an issued note has anything for the book. Every component is checked, not just the total: a note
 * that nets to zero out of non-zero parts still has entries to post. Only a note made entirely of free goods
 * (DOS-185) — nothing charged, so nothing taxed and nothing to refund — is zero all the way through.
 */
function carriesMoney(note: CreditNoteRow): boolean {
  return (
    note.taxablePaise !== 0 ||
    note.cgstPaise !== 0 ||
    note.sgstPaise !== 0 ||
    note.igstPaise !== 0 ||
    note.cessPaise !== 0 ||
    note.roundOffPaise !== 0 ||
    note.totalPaise !== 0
  )
}

/** What the delivery crew hands over from the doorstep (coordination §4: delivery → billing). */
export interface RaiseForDeliveryInput {
  id: string
  invoiceId: string
  reason: CreditNoteReason
  deliveryId?: string | null | undefined
  /** The van, for goods taken back at the door; the godown when the crew is already home. */
  restockLocationId?: string | null | undefined
  note?: string | null | undefined
  noteDate?: string | undefined
  /**
   * When a line omits `saleable` it follows the reason (`isSaleableCreditNoteReason`): a `return_damaged`
   * line goes to the damaged bin, and one marked saleable is refused.
   */
  lines: readonly { id: string; invoiceLineId: string; qtyPcs: number; saleable?: boolean }[]
}

@Injectable()
export class CreditNotesService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly receivables: ReceivablesService,
    /** The dock and the trips, for a bill credited before it left the godown (QA DOS-248). */
    private readonly billing: BillingService,
  ) {}

  /**
   * THE BILL HAS NOT LEFT THE GODOWN (QA DOS-248): a pack bill whose order is still `packed`. Its pieces stand
   * on the dock (or stood there, before a check-in counted them onto the rack), not in the shop — so a
   * goods note on it is "we could not supply this", and it follows the cancel's rules, not a return's.
   */
  private async notDispatched(
    tx: Db,
    invoice: { source: string; orderId: string | null },
  ): Promise<OrderRow | null> {
    if (invoice.source !== 'pack' || invoice.orderId === null) return null
    const order = await this.orders.findOrder(tx, invoice.orderId)
    return order !== undefined && order.state === 'packed' ? order : null
  }

  // =============================================================================================================
  // the surface other modules import
  // =============================================================================================================

  /**
   * The crew's one-tap short delivery: draft and issue in the same transaction, so the shopkeeper is
   * handed a numbered note before the van pulls away. Delivery (slice 4) calls this from its own
   * doorstep transaction; it is `create(autoIssue: true)` with the doorstep defaults filled in.
   */
  async raiseForDelivery(tx: Db, input: RaiseForDeliveryInput): Promise<CreditNoteRow> {
    const drafted = await this.draft(tx, {
      id: input.id,
      invoiceId: input.invoiceId,
      reason: input.reason,
      deliveryId: input.deliveryId ?? undefined,
      restockLocationId: input.restockLocationId ?? undefined,
      note: input.note ?? undefined,
      noteDate: input.noteDate,
      lines: input.lines.map((l) => ({
        id: l.id,
        invoiceLineId: l.invoiceLineId,
        qtyPcs: l.qtyPcs,
        saleable: l.saleable,
      })),
    })
    return this.issueInTx(tx, drafted, input.restockLocationId ?? null, null)
  }

  // =============================================================================================================
  // procedures
  // =============================================================================================================

  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(CREDIT_NOTE_RAISERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let note = await this.draft(tx, input)
        if (input.autoIssue)
          note = await this.issueInTx(tx, note, input.restockLocationId ?? null, null)
        return { item: await this.detail(tx, note) }
      }),
    )
  }

  async issue(input: IssueIn): Promise<IssueOut> {
    requireRole(CREDIT_NOTE_RAISERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const note = await this.lockNote(tx, input.id)
        const issued = await this.issueInTx(tx, note, null, input.deviceId ?? null)
        return { item: await this.detail(tx, issued) }
      }),
    )
  }

  /** Only a DRAFT may be cancelled: an issued note is a tax document and is undone by a debit note. */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const { tenantId } = currentTenant()
    return withTenant(db, currentTenant(), (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const note = await this.lockNote(tx, input.id)
        if (note.state === 'cancelled') return { item: await this.detail(tx, note) }
        if (note.state !== 'draft')
          throw new ORPCError('CONFLICT', {
            message: `credit note ${note.creditNoteNo ?? note.id} is ${note.state}; an issued note is reversed by a debit note, not cancelled`,
          })
        const [cancelled] = await tx
          .update(creditNotes)
          .set({
            state: 'cancelled',
            note: note.note
              ? `${note.note}\ncancelled: ${input.reason}`
              : `cancelled: ${input.reason}`,
            updatedAt: new Date(),
          })
          .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, note.id)))
          .returning()
        return { item: await this.detail(tx, cancelled ?? note) }
      }),
    )
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const note = await this.findNote(tx, input.id)
      return { item: await this.detail(tx, note) }
    })
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    const { tenantId } = currentTenant()
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(creditNotes.tenantId, tenantId),
        input.invoiceId ? eq(creditNotes.invoiceId, input.invoiceId) : undefined,
        input.retailerId ? eq(creditNotes.retailerId, input.retailerId) : undefined,
        input.reason ? eq(creditNotes.reason, input.reason) : undefined,
        input.state ? eq(creditNotes.state, input.state) : undefined,
        input.from ? gte(creditNotes.noteDate, input.from) : undefined,
        input.to ? lte(creditNotes.noteDate, input.to) : undefined,
        /*
         * Keyset on the cursor note's own (note_date, id), inside this tenant's fence (DOS-009 ruling,
         * UX-O-8): the cursor stays the last id seen, so the wire does not change.
         */
        input.cursor
          ? sql`(${creditNotes.noteDate}, ${creditNotes.id}) < (select c.note_date, c.id from credit_notes c where c.tenant_id = ${tenantId} and c.id = ${input.cursor})`
          : undefined,
      ]
      const rows = await tx
        .select()
        .from(creditNotes)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        /*
         * Newest first by NOTE DATE, the column `from`/`to` filters on (the DOS-009 ruling names this
         * list: "sort on its window column"). Ids are minted by the client, so id order is not age — the
         * simulation's five notes of 27 Sep read as rows 56–60 of 60 under `desc(id)` (UX-O-8).
         */
        .orderBy(desc(creditNotes.noteDate), desc(creditNotes.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const numbers = await this.invoiceNumbers(
        tx,
        page.map((r) => r.invoiceId),
      )
      const items = page.map((r) => toCreditNoteListItem(r, numbers.get(r.invoiceId) ?? null))
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  // =============================================================================================================
  // internals
  // =============================================================================================================

  /**
   * A draft note: quantities capped by what the bill still has left to credit, value capped by what the
   * shop was charged for those pieces (the line's taxable pro rata, QA DOS-242) and rates by the invoice
   * line's own, tax at the line's FROZEN `gst_bps` / `cess_bps` and the invoice's own
   * intra/inter split. It writes no stock and no journal — those happen at issue. A line that omits
   * `saleable` takes its disposition from the reason, and a damaged return is never saleable (DOS-116).
   */
  private async draft(
    tx: Db,
    input: {
      id: string
      invoiceId: string
      reason: CreditNoteReason
      noteDate?: string | undefined
      deliveryId?: string | undefined
      restockLocationId?: string | undefined
      note?: string | undefined
      lines: readonly {
        id: string
        invoiceLineId: string
        qtyPcs: number
        saleable?: boolean | undefined
        ratePaise?: number | undefined
      }[]
    },
  ): Promise<CreditNoteRow> {
    const { tenantId } = currentTenant()
    const [existing] = await tx
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, input.id)))
      .limit(1)
    if (existing) return existing

    const invoice = await this.loadInvoice(tx, input.invoiceId)
    if (!CREDITABLE_INVOICE_STATES.has(invoice.state))
      throw new ORPCError('CONFLICT', {
        message: `bill ${invoice.invoiceNo ?? invoice.id} is ${invoice.state}; a credit note corrects an issued bill`,
      })
    const noteDate = invoiceDateOf(input.noteDate)
    const lineRows = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id))
    const byId = new Map(lineRows.map((l) => [l.id, l]))
    const credited = await this.creditedByLine(tx, invoice.id)

    /*
     * QA DOS-248: A BILL THAT NEVER LEFT THE GODOWN IS CREDITED WHOLE OR NOT AT ALL. Its goods are on the dock
     * (or were counted back onto the rack) — a goods note on it says "we could not supply this", and what it
     * leaves behind must be something the godown can still send. A part of a packed bill cannot be: the load
     * sheet, the challan and the door all carry the bill's full lines. So the desk credits every line, the
     * order closes with it and the shop gets a fresh order for what it still wants — the same way out the
     * cancel gives an unpaid bill (DOS-139), for a bill money has already landed on. A money-only note (rate
     * difference, scheme settlement) is unaffected.
     */
    if (RESTOCKING_REASONS.has(input.reason) && (await this.notDispatched(tx, invoice)) !== null) {
      await this.billing.assertOffEveryTrip(tx, invoice, 'credit it')
      const asked = new Map<string, number>()
      for (const line of input.lines)
        asked.set(line.invoiceLineId, (asked.get(line.invoiceLineId) ?? 0) + line.qtyPcs)
      const partial = lineRows.some((l) => {
        const left = piecesLeftToCredit(l, credited.get(l.id)?.pcs ?? 0)
        return left > 0 && (asked.get(l.id) ?? 0) !== left
      })
      if (partial)
        throw new ORPCError('CONFLICT', {
          message: `Bill ${invoice.invoiceNo ?? invoice.id} has not left the godown, so it is credited whole or not at all: its load sheet and its delivery carry every line. Credit every line (the shop keeps the money on account) and book a fresh order for what the shop still wants`,
          data: { code: 'whole_bill_before_dispatch' },
        })
    }

    let taxable = 0
    let cgst = 0
    let sgst = 0
    let igst = 0
    let cess = 0
    const values: (typeof creditNoteLines.$inferInsert)[] = []
    for (const line of input.lines) {
      const source = byId.get(line.invoiceLineId)
      if (!source)
        throw new ORPCError('BAD_REQUEST', {
          message: `line ${line.invoiceLineId} does not belong to bill ${invoice.invoiceNo ?? invoice.id}`,
        })
      const already = credited.get(source.id) ?? { pcs: 0, taxablePaise: 0 }
      const remaining = piecesLeftToCredit(source, already.pcs)
      if (line.qtyPcs > remaining)
        throw new ORPCError('BAD_REQUEST', {
          message: `only ${String(remaining)} pcs of ${source.description} are left to credit on ${invoice.invoiceNo ?? invoice.id}`,
          data: { invoiceLineId: source.id, remaining, requested: line.qtyPcs },
        })
      // ADR 0004: the ORIGINAL rate is the ceiling. A rate-difference note passes the DIFFERENCE per
      // piece, which is why a lower rate is allowed and a higher one never is.
      const rate = line.ratePaise ?? source.ratePaise
      if (rate > source.ratePaise)
        throw new ORPCError('BAD_REQUEST', {
          message: `a credit note may not exceed the invoiced rate of ${String(source.ratePaise)} paise`,
          data: { invoiceLineId: source.id, invoicedRatePaise: source.ratePaise },
        })
      // QA DOS-242: what the shop was CHARGED for these pieces — the line's taxable after its schemes and
      // discounts, pro rata over its pieces, the last piece taking the remainder — is the ceiling of every
      // note. `rate` is the pre-scheme list rate (`rate_paise`): crediting `rate × pieces` gave the shop the
      // scheme money back on top of the goods. A rate-difference note below that value keeps its own figure.
      const worth = creditableTaxable(source, already, line.qtyPcs)
      const lineTaxable = Math.min(rate * line.qtyPcs, worth)
      const creditedRate = line.qtyPcs > 0 ? Math.round(lineTaxable / line.qtyPcs) : rate
      // DOS-116: an omitted flag follows the reason, and a damaged return never goes back on sale — the
      // credit-note side of the doorstep rule (DOS-058), read from the one list in @dos/contracts.
      const saleable = line.saleable ?? isSaleableCreditNoteReason(input.reason)
      if (saleable && !isSaleableCreditNoteReason(input.reason))
        throw new ORPCError('BAD_REQUEST', {
          message: `${source.description}: damaged goods go to the damaged bin, not back on sale`,
          data: { code: 'return_not_saleable', invoiceLineId: source.id, reason: input.reason },
        })
      // Intra-state halves are each `percentOf(taxable, bps/2)`, so the two are exact and their sum is
      // what the line prints — never `percentOf(taxable, bps)`, which can differ by a paisa.
      const half = invoice.isInterState ? 0 : percentOf(paise(lineTaxable), source.gstBps / 2)
      const lineIgst = invoice.isInterState ? percentOf(paise(lineTaxable), source.gstBps) : 0
      const gstPaise = half + half + lineIgst
      const cessPaise = percentOf(paise(lineTaxable), source.cessBps)
      cgst += half
      sgst += half
      igst += lineIgst
      taxable += lineTaxable
      cess += cessPaise
      values.push({
        id: line.id,
        tenantId,
        creditNoteId: input.id,
        invoiceLineId: source.id,
        qtyPcs: line.qtyPcs,
        saleable,
        ratePaise: creditedRate,
        taxablePaise: lineTaxable,
        gstBps: source.gstBps,
        taxPaise: gstPaise + cessPaise,
        lineTotalPaise: lineTaxable + gstPaise + cessPaise,
      })
    }

    const { rounded, roundOff } = roundToRupee(paise(taxable + cgst + sgst + igst + cess))
    const [row] = await tx
      .insert(creditNotes)
      .values({
        id: input.id,
        tenantId,
        creditNoteNo: null,
        seriesCode: CREDIT_NOTE_SERIES,
        fy: financialYear(new Date(`${noteDate}T12:00:00.000+05:30`)),
        noteDate,
        invoiceId: invoice.id,
        retailerId: invoice.retailerId,
        reason: input.reason,
        state: 'draft',
        deliveryId: input.deliveryId ?? null,
        taxablePaise: taxable,
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst,
        cessPaise: cess,
        roundOffPaise: roundOff,
        totalPaise: rounded,
        note: input.note ?? null,
      })
      .returning()
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'credit note insert returned nothing',
      })
    if (values.length > 0) await tx.insert(creditNoteLines).values(values)
    return row
  }

  /**
   * Number it, put the goods back and give the money back. The invoice row is NEVER touched: its
   * payment state is receivables' to derive from the allocation this creates.
   */
  private async issueInTx(
    tx: Db,
    note: CreditNoteRow,
    restockLocationId: string | null,
    deviceId: string | null,
  ): Promise<CreditNoteRow> {
    const { tenantId, actorId } = currentTenant()
    if (note.state !== 'draft') return note
    const at = new Date(`${note.noteDate}T12:00:00.000+05:30`)
    const creditNoteNo = note.creditNoteNo ?? (await nextDocumentNumber(tx, CREDIT_NOTE_SERIES, at))
    const [issued] = await tx
      .update(creditNotes)
      .set({
        creditNoteNo,
        state: 'issued',
        issuedBy: actorId,
        issuedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, note.id)))
      .returning()
    await this.restock(tx, issued ?? note, restockLocationId)
    // Re-read: a bill credited before dispatch has its note's words extended by the restock (QA DOS-248).
    const row = await this.findNote(tx, (issued ?? note).id)
    /*
     * QA DOS-185: free goods that come back are a note about GOODS with no money in it — the shop paid
     * nothing for them, so nothing is refunded and nothing is owed back. The book stays out of it (a
     * journal entry with no money in it is a caller's bug, and `postJournalEntry` says so); the pieces
     * have already gone back on the rack above, and the bill's payment state is unchanged because there
     * is nothing to allocate. Same reason as the invoice's own AR entry for the rest: a role that may
     * raise the document is not always a role that may write the book (coordination §5.3, `asLedgerPoster`).
     */
    if (carriesMoney(row))
      await asLedgerPoster(tx, () =>
        this.receivables.postCreditNoteIssued(tx, {
          id: row.id,
          invoiceId: row.invoiceId,
          retailerId: row.retailerId,
          noteDate: row.noteDate,
          taxablePaise: row.taxablePaise,
          cgstPaise: row.cgstPaise,
          sgstPaise: row.sgstPaise,
          igstPaise: row.igstPaise,
          cessPaise: row.cessPaise,
          roundOffPaise: row.roundOffPaise,
          totalPaise: row.totalPaise,
        }),
      )
    await tx.insert(outboxEvents).values({
      id: uuidv7(),
      tenantId,
      aggregateType: 'credit_note',
      aggregateId: row.id,
      eventType: 'CreditNoteIssued',
      payload: {
        creditNoteId: row.id,
        creditNoteNo: row.creditNoteNo,
        invoiceId: row.invoiceId,
        retailerId: row.retailerId,
        reason: row.reason,
        totalPaise: row.totalPaise,
        restockLocationId,
        deviceId,
      },
    })
    await requestDocumentRender(tx, { kind: 'credit_note', id: row.id })
    return row
  }

  /**
   * Returned pieces go back to the lot they left from: saleable stock into the given location (the van
   * at the door, otherwise the location the order shipped from), damaged goods into the tenant's damaged
   * bin. Nothing moves for a rate difference or a scheme settlement — no goods ever left.
   */
  private async restock(
    tx: Db,
    note: CreditNoteRow,
    restockLocationId: string | null,
  ): Promise<void> {
    if (!RESTOCKING_REASONS.has(note.reason)) return
    const lines = await tx
      .select({
        id: creditNoteLines.id,
        qtyPcs: creditNoteLines.qtyPcs,
        saleable: creditNoteLines.saleable,
        lotId: invoiceLines.lotId,
      })
      .from(creditNoteLines)
      .innerJoin(invoiceLines, eq(invoiceLines.id, creditNoteLines.invoiceLineId))
      .where(eq(creditNoteLines.creditNoteId, note.id))
      .orderBy(asc(creditNoteLines.id))
    const movable = lines.filter((l) => l.lotId !== null && l.qtyPcs > 0)
    const invoice = await this.loadInvoice(tx, note.invoiceId)
    const order = await this.notDispatched(tx, invoice)
    if (order !== null) {
      await this.creditBeforeDispatch(tx, note, invoice, order, movable, restockLocationId)
      return
    }
    if (movable.length === 0) return
    const saleableLocation = restockLocationId ?? (await this.defaultRestockLocation(tx, note))
    const damagedLocation = await this.damagedLocation(tx)
    await this.inventory.post(
      tx,
      movable.map((line) => ({
        lotId: line.lotId as string,
        locationId: line.saleable ? saleableLocation : damagedLocation,
        qtyDelta: line.qtyPcs,
        reason: line.saleable
          ? ('sale_return_saleable' as const)
          : ('sale_return_damaged' as const),
        refType: 'credit_note',
        refId: note.id,
        idempotencyKey: `credit-note:${note.id}:${line.id}`,
        note: `credit note ${note.creditNoteNo ?? note.id}`,
      })),
    )
  }

  /**
   * A WHOLE BILL CREDITED BEFORE IT LEFT THE GODOWN (QA DOS-248): Balaji paid ₹11,276.00 for INV/9017 on day 3;
   * its atta and oil were counted back onto the rack at a check-in and sold to another shop, so no sheet could
   * ever load it, and the only credit note that fitted would have restocked 34 pieces into lots that were
   * empty on the shelf. Now, in the note's own transaction:
   *
   *   the goods   what the dock still holds for the bill goes back to the rack (damaged lines to the damaged
   *               bin) as a real dock → godown transfer (`BillingService.billOffDock`, `skip`); the pieces the
   *               dock no longer holds move NOTHING — they already went back into stock where they are — and
   *               the note says so in its own words, so nobody goes looking for them;
   *   the order   is cancelled with the bill named, so it leaves the planning board, the godown's awaiting-load
   *               list and every sheet; the shop that still wants the goods gets a fresh order (DOS-139);
   *   the flag    "came back undelivered" is cleared, so the bill leaves the Undelivered register and the
   *               shop's dues are the note's to settle: allocated to the bill, the rest on account (DOS-245).
   *
   * Whole bill only (`whole_bill_before_dispatch`, checked at draft and again here, since a draft made while
   * the bill was out may be issued after it came back).
   */
  private async creditBeforeDispatch(
    tx: Db,
    note: CreditNoteRow,
    invoice: { id: string; invoiceNo: string | null; orderId: string | null },
    order: OrderRow,
    movable: readonly { id: string; qtyPcs: number; saleable: boolean; lotId: string | null }[],
    restockLocationId: string | null,
  ): Promise<void> {
    const { tenantId } = currentTenant()
    const bill = invoice.invoiceNo ?? invoice.id
    await this.billing.assertOffEveryTrip(tx, invoice, 'credit it')
    const lineRows = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id))
    const credited = await this.creditedByLine(tx, invoice.id)
    if (lineRows.some((l) => piecesLeftToCredit(l, credited.get(l.id)?.pcs ?? 0) > 0))
      throw new ORPCError('CONFLICT', {
        message: `Bill ${bill} has not left the godown, so it is credited whole or not at all: its load sheet and its delivery carry every line. Credit every line and book a fresh order for what the shop still wants`,
        data: { code: 'whole_bill_before_dispatch' },
      })
    const saleableLocation = restockLocationId ?? (await this.defaultRestockLocation(tx, note))
    const damagedLocation = await this.damagedLocation(tx)
    const short = await this.billing.billOffDock(
      tx,
      { id: invoice.id, orderId: order.id },
      movable
        .filter((l): l is typeof l & { lotId: string } => l.lotId !== null)
        .map((line) => {
          const to = line.saleable ? saleableLocation : damagedLocation
          return {
            lotId: line.lotId,
            pcs: line.qtyPcs,
            toLocationId: to,
            outKey: `credit-note:${note.id}:${line.id}:dock`,
            inKey: `credit-note:${note.id}:${line.id}`,
          }
        }),
      {
        refType: 'credit_note',
        refId: note.id,
        note: `credit note ${note.creditNoteNo ?? note.id}: ${bill} could not be supplied — its pieces back off the dock`,
      },
      'skip',
    )
    if (short.length > 0) {
      const words = `Not on the dock, so nothing moved for: ${short
        .map((s) => `${String(s.shortPcs)} pc ${s.label}`)
        .join('; ')} — those pieces had already gone back into stock.`
      await tx
        .update(creditNotes)
        .set({
          note: (note.note ? `${note.note}\n${words}` : words).slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, note.id)))
    }
    await this.orders.cancelInTx(
      tx,
      order,
      `bill ${bill} credited in full before dispatch (${note.creditNoteNo ?? note.id})`.slice(
        0,
        200,
      ),
      null,
    )
    await this.billing.clearUndelivered(tx, invoice.id)
  }

  private async defaultRestockLocation(tx: Db, note: CreditNoteRow): Promise<string> {
    const [invoice] = await tx
      .select({ orderId: invoices.orderId })
      .from(invoices)
      .where(eq(invoices.id, note.invoiceId))
      .limit(1)
    if (invoice?.orderId) {
      const order = await this.orders.findOrder(tx, invoice.orderId)
      if (order?.fulfilFromLocationId) return order.fulfilFromLocationId
    }
    return this.locationOfKind(tx, 'warehouse')
  }

  private damagedLocation(tx: Db): Promise<string> {
    return this.locationOfKind(tx, 'damaged')
  }

  private async locationOfKind(tx: Db, kind: 'warehouse' | 'damaged'): Promise<string> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(eq(locations.tenantId, tenantId), eq(locations.kind, kind), eq(locations.active, true)),
      )
      .orderBy(asc(locations.id))
      .limit(1)
    if (!row)
      throw new ORPCError('BAD_REQUEST', {
        message: `this distributor has no active ${kind} location (bootstrap it first)`,
      })
    return row.id
  }

  /** Pieces and taxable already credited per invoice line, over every note that is not cancelled. */
  private async creditedByLine(
    tx: Db,
    invoiceId: string,
  ): Promise<Map<string, { pcs: number; taxablePaise: number }>> {
    const { tenantId } = currentTenant()
    const rows = await tx
      .select({
        invoiceLineId: creditNoteLines.invoiceLineId,
        qtyPcs: sql<number>`COALESCE(SUM(${creditNoteLines.qtyPcs}), 0)::int`,
        taxablePaise: sql<number>`COALESCE(SUM(${creditNoteLines.taxablePaise}), 0)::bigint`,
      })
      .from(creditNoteLines)
      .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLines.creditNoteId))
      .where(
        and(
          eq(creditNoteLines.tenantId, tenantId),
          eq(creditNotes.invoiceId, invoiceId),
          ne(creditNotes.state, 'cancelled'),
        ),
      )
      .groupBy(creditNoteLines.invoiceLineId)
    return new Map(
      rows.map((r) => [
        r.invoiceLineId,
        { pcs: Number(r.qtyPcs), taxablePaise: Number(r.taxablePaise) },
      ]),
    )
  }

  private async invoiceNumbers(
    tx: Db,
    invoiceIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(invoiceIds)]
    if (ids.length === 0) return new Map()
    const rows = await tx
      .select({ id: invoices.id, invoiceNo: invoices.invoiceNo })
      .from(invoices)
      .where(inArray(invoices.id, ids))
    return new Map(rows.map((r) => [r.id, r.invoiceNo]))
  }

  private async loadInvoice(
    tx: Db,
    invoiceId: string,
  ): Promise<{
    id: string
    invoiceNo: string | null
    retailerId: string
    state: string
    isInterState: boolean
    source: string
    orderId: string | null
  }> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        retailerId: invoices.retailerId,
        state: invoices.state,
        isInterState: invoices.isInterState,
        source: invoices.source,
        orderId: invoices.orderId,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `invoice ${invoiceId} not found` })
    return row
  }

  async findNote(tx: Db, id: string): Promise<CreditNoteRow> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, id)))
      .limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `credit note ${id} not found` })
    return row
  }

  private async lockNote(tx: Db, id: string): Promise<CreditNoteRow> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, id)))
      .for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: `credit note ${id} not found` })
    return row
  }

  async detail(tx: Db, note: CreditNoteRow): Promise<CreditNoteDetail> {
    const invoice = await this.loadInvoice(tx, note.invoiceId)
    const seller = await loadSeller(tx)
    return loadCreditNoteDetail(
      tx,
      note,
      { invoiceNo: invoice.invoiceNo, isInterState: invoice.isInterState },
      seller,
    )
  }
}
