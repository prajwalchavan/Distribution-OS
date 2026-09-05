import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ExtractedInvoice,
  HeartbeatReviewInput,
  HeartbeatReviewOutput,
  ReleaseReviewInput,
  ReleaseReviewOutput,
  ReviewedInvoice,
  ReviewSession,
  SaveReviewInput,
  SaveReviewOutput,
  StartReviewInput,
  StartReviewOutput,
  SubmitReviewInput,
  SubmitReviewOutput,
  ThreeWayMatch,
} from '@dos/contracts'
import { ReviewedInvoiceSchema } from '@dos/contracts'
import { reviewSessionMachine, uuidv7, type ReviewSessionState } from '@dos/domain'
import {
  correctionsLog,
  documents,
  engineDisagreements,
  extractionChecks,
  extractions,
  grnLines,
  grns,
  lorryReceipts,
  productVariants,
  purchaseOrders,
  reviewSessions,
  skuMatchCandidates,
  suppliers,
  supplierPackConfigs,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { DESK, lockDocument, notFound, transition } from './docint.internals.js'
import { reviewedOf, toSession, type CheckRow, type SessionRow } from './docint.mappers.js'
import { docintConfig } from './pipeline/config.js'
import { applyReviewPatch } from './pipeline/paths.js'
import {
  bestExtraction,
  checkSummaryFor,
  DOCINT_EVENTS,
  emitDocumentEvent,
  readingOf,
  replaceChecks,
  validateReading,
  type DocumentRow,
} from './pipeline/steps.js'
import { blockingCount } from './pipeline/validators.js'

type StartIn = z.infer<typeof StartReviewInput>
type StartOut = z.infer<typeof StartReviewOutput>
type HeartbeatIn = z.infer<typeof HeartbeatReviewInput>
type HeartbeatOut = z.infer<typeof HeartbeatReviewOutput>
type SaveIn = z.infer<typeof SaveReviewInput>
type SaveOut = z.infer<typeof SaveReviewOutput>
type ReleaseIn = z.infer<typeof ReleaseReviewInput>
type ReleaseOut = z.infer<typeof ReleaseReviewOutput>
type SubmitIn = z.infer<typeof SubmitReviewInput>
type SubmitOut = z.infer<typeof SubmitReviewOutput>

const CASE_UNITS = /^(cs|case|cases|ctn|carton|cartons|box|boxes|bx)$/i

/**
 * The review desk (docs/05 step 10): a single-writer lock per document, the reviewed payload seeded
 * from the best reading and the chosen candidates, one `corrections_log` row per changed path, the
 * validators re-run on every save, and a submit that refuses while a red check stands. Submitting
 * asserts "the reading is right"; booking the draft is `documents.approve`, a separate deliberate
 * call (never-list 6).
 */
@Injectable()
export class ReviewService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async start(input: StartIn): Promise<StartOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let doc = await lockDocument(tx, input.id)
        if (doc.status !== 'extracted' && doc.status !== 'needs_review')
          throw new ORPCError('CONFLICT', {
            message: `document ${doc.id} is ${doc.status}; only an extracted or needs_review document can be reviewed`,
          })
        // A stale open session (its holder went away) is abandoned so the partial unique index admits a new one.
        await tx
          .update(reviewSessions)
          .set({ status: 'abandoned', updatedAt: new Date() })
          .where(
            and(
              eq(reviewSessions.documentId, doc.id),
              eq(reviewSessions.status, 'open'),
              lte(reviewSessions.lockedUntil, new Date()),
            ),
          )
        const holder = await openSession(tx, doc.id)
        if (holder) {
          if (holder.reviewerId === ctx.actorId)
            return { session: await sessionView(tx, holder, doc) }
          throw await lockedError(tx, holder)
        }
        const base = input.baseExtractionId
          ? await extractionOf(tx, doc.id, input.baseExtractionId)
          : await bestExtraction(tx, doc.id)
        if (!base)
          throw new ORPCError('CONFLICT', { message: 'the document has no reading to review yet' })
        const reading = readingOf(base)
        if (!reading)
          throw new ORPCError('CONFLICT', { message: 'the reading is not in the docint schema' })
        const reviewed = await seedReviewed(tx, doc, base.id, reading)
        const ttl = docintConfig().lockTtlSeconds
        const inserted = await tx
          .insert(reviewSessions)
          .values({
            id: input.sessionId,
            tenantId: ctx.tenantId,
            documentId: doc.id,
            reviewerId: ctx.actorId,
            baseExtractionId: base.id,
            status: reviewSessionMachine.initial,
            reviewed,
            lockedUntil: new Date(Date.now() + ttl * 1000),
            heartbeatAt: new Date(),
          })
          .onConflictDoNothing()
          .returning()
        const session = inserted[0]
        if (!session) {
          // Two managers raced on the partial unique index: the loser gets the holder's name, never a corrupted payload.
          const winner = await openSession(tx, doc.id)
          if (winner && winner.reviewerId !== ctx.actorId) throw await lockedError(tx, winner)
          throw new ORPCError('CONFLICT', {
            message: `review session ${input.sessionId} already exists`,
          })
        }
        const checks = await validateReading(tx, doc, reviewed, 'review')
        await replaceChecks(tx, ctx.tenantId, base.id, checks, 'review')
        doc = await transition(tx, doc, 'start_review')
        return { session: await sessionView(tx, session, doc) }
      }),
    )
  }

  async heartbeat(input: HeartbeatIn): Promise<HeartbeatOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const session = await heldSession(tx, input.id, ctx, { allowExpired: true })
        const lockedUntil = new Date(Date.now() + docintConfig().lockTtlSeconds * 1000)
        await tx
          .update(reviewSessions)
          .set({ lockedUntil, heartbeatAt: new Date(), updatedAt: new Date() })
          .where(eq(reviewSessions.id, session.id))
        return { lockedUntil: lockedUntil.toISOString() }
      }),
    )
  }

  async save(input: SaveIn): Promise<SaveOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const session = await heldSession(tx, input.id, ctx)
        const doc = await lockDocument(tx, session.documentId)
        if (input.patch.header?.buyerGstin !== undefined && ctx.actorRole !== 'owner')
          throw new ORPCError('FORBIDDEN', {
            message: 'only the owner may change the buyer GSTIN on a bill (docs/17 §D3)',
            data: { code: 'owner_only', path: 'header.buyerGstin' },
          })
        const { next, corrections } = applyReviewPatch(reviewedOf(session), input.patch)
        const reviewed = ReviewedInvoiceSchema.parse(next)
        if (corrections.length > 0)
          await tx.insert(correctionsLog).values(
            corrections.map((c) => ({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              reviewSessionId: session.id,
              path: c.path,
              before: c.before,
              after: c.after,
            })),
          )
        const [updated] = await tx
          .update(reviewSessions)
          .set({
            reviewed,
            editsCount: session.editsCount + corrections.length,
            heartbeatAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reviewSessions.id, session.id))
          .returning()
        const checks = await revalidate(tx, doc, updated ?? session, reviewed)
        const view = await sessionView(tx, updated ?? session, doc)
        return { session: view, checks: view.checks, blocking: blockingCount(checks) }
      }),
    )
  }

  async release(input: ReleaseIn): Promise<ReleaseOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [session] = await tx
          .select()
          .from(reviewSessions)
          .where(eq(reviewSessions.id, input.id))
          .limit(1)
        if (!session) throw notFound('review session', input.id)
        if (session.status !== 'open')
          throw new ORPCError('CONFLICT', {
            message: `review session ${session.id} is ${session.status}`,
          })
        // The holder gives it up; the owner may also clear a colleague's lock (a phone that died mid-review).
        if (session.reviewerId !== ctx.actorId && ctx.actorRole !== 'owner')
          throw new ORPCError('FORBIDDEN', {
            message: 'only the reviewer holding the lock (or the owner) may release it',
          })
        let doc = await lockDocument(tx, session.documentId)
        const [updated] = await tx
          .update(reviewSessions)
          .set({
            status: reviewSessionMachine.next(session.status as ReviewSessionState, 'abandon'),
            updatedAt: new Date(),
          })
          .where(eq(reviewSessions.id, session.id))
          .returning()
        if (doc.status === 'needs_review') {
          // `release` hands the document back as `extracted`; a reading that still carries a failed
          // check or an unmatched line is flagged again so the queue keeps telling the truth.
          doc = await transition(tx, doc, 'release')
          const summary = session.baseExtractionId
            ? await checkSummaryFor(tx, session.baseExtractionId)
            : null
          if (summary && summary.errors + summary.warnings > 0)
            doc = await transition(tx, doc, 'flag')
        }
        return { session: await sessionView(tx, updated ?? session, doc) }
      }),
    )
  }

  async submit(input: SubmitIn): Promise<SubmitOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const session = await heldSession(tx, input.id, ctx)
        let doc = await lockDocument(tx, session.documentId)
        const reviewed = reviewedOf(session)
        const checks = await revalidate(tx, doc, session, reviewed)
        const blocking = blockingCount(checks)
        if (blocking > 0)
          throw new ORPCError('BAD_REQUEST', {
            message: `${String(blocking)} red check(s) still fail; fix them before submitting`,
            data: {
              code: 'checks_blocking',
              checks: checks
                .filter((c) => !c.passed && c.severity === 'error')
                .map((c) => ({ check: c.check, lineNo: c.lineNo })),
            },
          })
        const [updated] = await tx
          .update(reviewSessions)
          .set({
            status: reviewSessionMachine.next(session.status, 'submit'),
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reviewSessions.id, session.id))
          .returning()
        doc = await transition(tx, doc, 'review_submitted', {
          supplierId: reviewed.header.supplierId ?? doc.supplierId,
          irn: reviewed.header.irn ?? doc.irn,
        })
        await emitDocumentEvent(tx, doc, DOCINT_EVENTS.reviewed, {
          reviewSessionId: session.id,
          editsCount: (updated ?? session).editsCount,
        })
        const view = await sessionView(tx, updated ?? session, doc)
        return { session: view, checks: view.checks, blocking: 0 }
      }),
    )
  }
}

// -------------------------------------------------------------------------------------------------

async function openSession(tx: Db, documentId: string): Promise<SessionRow | null> {
  const [row] = await tx
    .select()
    .from(reviewSessions)
    .where(
      and(
        eq(reviewSessions.documentId, documentId),
        eq(reviewSessions.status, 'open'),
        gt(reviewSessions.lockedUntil, new Date()),
      ),
    )
    .limit(1)
  return row ?? null
}

async function lockedError(tx: Db, holder: SessionRow): Promise<ORPCError<'CONFLICT', unknown>> {
  const [u] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, holder.reviewerId))
    .limit(1)
  return new ORPCError('CONFLICT', {
    message: `${u?.name ?? 'another reviewer'} is reviewing this document (until ${holder.lockedUntil.toISOString()})`,
    data: {
      code: 'locked',
      reviewSessionId: holder.id,
      reviewerId: holder.reviewerId,
      reviewerName: u?.name ?? null,
      lockedUntil: holder.lockedUntil.toISOString(),
    },
  })
}

/** The session the caller holds: open, theirs, and (unless `allowExpired`) still inside its lock. */
async function heldSession(
  tx: Db,
  id: string,
  ctx: TenantContext,
  opts: { allowExpired?: boolean } = {},
): Promise<SessionRow> {
  const [session] = await tx.select().from(reviewSessions).where(eq(reviewSessions.id, id)).limit(1)
  if (!session) throw notFound('review session', id)
  if (session.status !== 'open')
    throw new ORPCError('CONFLICT', {
      message: `review session ${session.id} is ${session.status}`,
    })
  if (session.reviewerId !== ctx.actorId)
    throw new ORPCError('FORBIDDEN', { message: 'this review session belongs to another reviewer' })
  if (!opts.allowExpired && session.lockedUntil.getTime() <= Date.now())
    throw new ORPCError('CONFLICT', {
      message: 'the review lock expired; start the review again',
      data: { code: 'lock_expired' },
    })
  return session
}

async function extractionOf(tx: Db, documentId: string, extractionId: string) {
  const [row] = await tx
    .select()
    .from(extractions)
    .where(and(eq(extractions.id, extractionId), eq(extractions.documentId, documentId)))
    .limit(1)
  if (!row) throw notFound('extraction of this document', extractionId)
  return row
}

/**
 * The reviewed payload the session starts from: the reading, the chosen candidates as `variantId`,
 * the resolved buy-side pack as `caseSize` (docs/17 B), the rate basis as printed (docs/17 A4) and
 * the supplier's payment terms as `dueDate`.
 */
export async function seedReviewed(
  tx: Db,
  doc: DocumentRow,
  extractionId: string,
  reading: ExtractedInvoice,
): Promise<ReviewedInvoice> {
  const chosen = await tx
    .select({
      lineNo: skuMatchCandidates.lineNo,
      variantId: skuMatchCandidates.variantId,
      features: skuMatchCandidates.features,
    })
    .from(skuMatchCandidates)
    .where(
      and(eq(skuMatchCandidates.extractionId, extractionId), eq(skuMatchCandidates.chosen, true)),
    )
  const byLine = new Map(chosen.map((c) => [c.lineNo, c]))
  const variantIds = [...new Set(chosen.map((c) => c.variantId))]
  const defaults = new Map(
    variantIds.length > 0
      ? (
          await tx
            .select({ id: productVariants.id, defaultCaseSize: productVariants.defaultCaseSize })
            .from(productVariants)
            .where(
              sql`${productVariants.id} in (${sql.join(
                variantIds.map((v) => sql`${v}`),
                sql`, `,
              )})`,
            )
        ).map((v) => [v.id, v.defaultCaseSize])
      : [],
  )
  const packs = new Map(
    doc.supplierId && variantIds.length > 0
      ? (
          await tx
            .select({
              variantId: supplierPackConfigs.variantId,
              pcsPerCase: supplierPackConfigs.pcsPerCase,
            })
            .from(supplierPackConfigs)
            .where(
              and(
                eq(supplierPackConfigs.supplierId, doc.supplierId),
                sql`${supplierPackConfigs.variantId} in (${sql.join(
                  variantIds.map((v) => sql`${v}`),
                  sql`, `,
                )})`,
              ),
            )
        ).map((p) => [p.variantId, p.pcsPerCase])
      : [],
  )
  const [supplier] = doc.supplierId
    ? await tx
        .select({ name: suppliers.name, gstin: suppliers.gstin, terms: suppliers.paymentTermsDays })
        .from(suppliers)
        .where(eq(suppliers.id, doc.supplierId))
        .limit(1)
    : [undefined]
  const h = reading.header
  const invoiceDate = h.invoiceDate
  const dueDate =
    invoiceDate && supplier?.terms !== null && supplier?.terms !== undefined
      ? new Date(
          Date.UTC(
            Number(invoiceDate.slice(0, 4)),
            Number(invoiceDate.slice(5, 7)) - 1,
            Number(invoiceDate.slice(8, 10)) + supplier.terms,
          ),
        )
          .toISOString()
          .slice(0, 10)
      : null
  const lines = reading.lines.map((l) => {
    const pick = byLine.get(l.lineNo)
    const variantId = pick?.variantId ?? null
    const reviewerPack = (pick?.features as { pcsPerCase?: unknown } | null)?.pcsPerCase
    const caseSize =
      (typeof reviewerPack === 'number' && reviewerPack > 0 ? reviewerPack : null) ??
      l.caseSize ??
      (variantId ? (packs.get(variantId) ?? defaults.get(variantId) ?? null) : null)
    const printedCase = l.printedUnit !== null && CASE_UNITS.test(l.printedUnit)
    const rateBasis = l.rateBasis ?? (printedCase && caseSize ? 'case' : 'piece')
    const basisQty = l.basisQty ?? (rateBasis === 'case' ? (caseSize ?? 1) : 1)
    return {
      lineNo: l.lineNo,
      description: l.description,
      supplierCode: l.supplierCode,
      variantId,
      hsnCode: l.hsnCode,
      batchNo: l.batchNo,
      mfgDate: l.mfgDate,
      expiryDate: l.expiryDate,
      mrpPaise: l.mrpPaise,
      printedQty: l.printedQty,
      printedUnit: l.printedUnit,
      caseSize,
      qtyPcs:
        l.qtyPcs ??
        (l.printedQty !== null && printedCase && caseSize ? l.printedQty * caseSize : l.printedQty),
      freeQtyPcs: l.freeQtyPcs ?? 0,
      ratePaise: l.ratePaise,
      rateBasis,
      basisQty,
      discountBps: l.discountBps ?? 0,
      discountPaise: l.discountPaise ?? 0,
      gstBps: l.gstBps ?? 0,
      cessBps: l.cessBps ?? 0,
      taxablePaise: l.taxablePaise,
      taxPaise: l.taxPaise,
      lineTotalPaise: l.lineTotalPaise,
    }
  })
  return ReviewedInvoiceSchema.parse({
    header: {
      supplierId: doc.supplierId,
      supplierName: h.supplierName ?? supplier?.name ?? null,
      supplierGstin: h.supplierGstin ?? supplier?.gstin ?? null,
      buyerGstin: h.buyerGstin,
      invoiceNo: h.invoiceNo,
      invoiceDate,
      irn: h.irn ?? doc.irn,
      ewayBillNo: h.ewayBillNo,
      placeOfSupplyState: h.placeOfSupplyState,
      purchaseOrderId: null,
      dueDate,
      subtotalPaise: h.subtotalPaise,
      discountPaise: h.discountPaise ?? 0,
      cgstPaise: h.cgstPaise ?? 0,
      sgstPaise: h.sgstPaise ?? 0,
      igstPaise: h.igstPaise ?? 0,
      cessPaise: h.cessPaise ?? 0,
      freightPaise: h.freightPaise ?? 0,
      roundOffPaise: h.roundOffPaise ?? 0,
      totalPaise: h.totalPaise,
    },
    lines,
    annotations: reading.handwrittenAnnotations.map((a) => ({ id: a.id, applied: false })),
  })
}

/** Re-run the validators over the reviewed payload and replace the session's `review.*` checks. */
async function revalidate(
  tx: Db,
  doc: DocumentRow,
  session: SessionRow,
  reviewed: ReviewedInvoice,
) {
  const checks = await validateReading(
    tx,
    doc,
    { header: reviewed.header, lines: reviewed.lines },
    'review',
  )
  if (session.baseExtractionId)
    await replaceChecks(tx, doc.tenantId, session.baseExtractionId, checks, 'review')
  return checks
}

async function sessionView(tx: Db, session: SessionRow, doc: DocumentRow): Promise<ReviewSession> {
  const [reviewer] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, session.reviewerId))
    .limit(1)
  let checks: CheckRow[] = []
  if (session.baseExtractionId) {
    const rows = await tx
      .select()
      .from(extractionChecks)
      .where(eq(extractionChecks.extractionId, session.baseExtractionId))
      .orderBy(asc(extractionChecks.id))
    const review = rows.filter((r) => r.check.startsWith('review.'))
    checks = review.length > 0 ? review : rows
  }
  const disagreements = await tx
    .select()
    .from(engineDisagreements)
    .where(eq(engineDisagreements.documentId, doc.id))
    .orderBy(asc(engineDisagreements.id))
    .limit(200)
  return toSession(session, {
    reviewerName: reviewer?.name ?? null,
    checks,
    blocking: blockingCount(checks),
    disagreements,
    threeWayMatch: await threeWayMatch(tx, doc, reviewedOf(session)),
  })
}

/** PO cases, lorry-receipt packages and the gate count next to the bill (docs/22 §5). Every part nullable. */
async function threeWayMatch(
  tx: Db,
  doc: DocumentRow,
  reviewed: ReviewedInvoice,
): Promise<ThreeWayMatch | null> {
  let poCases: number | null = null
  if (reviewed.header.purchaseOrderId) {
    const [po] = await tx
      .select({ lines: purchaseOrders.lines })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, reviewed.header.purchaseOrderId))
      .limit(1)
    if (po) {
      const ids = [...new Set(po.lines.map((l) => l.variantId))]
      const sizes = new Map(
        ids.length > 0
          ? (
              await tx
                .select({
                  id: productVariants.id,
                  defaultCaseSize: productVariants.defaultCaseSize,
                })
                .from(productVariants)
                .where(
                  sql`${productVariants.id} in (${sql.join(
                    ids.map((v) => sql`${v}`),
                    sql`, `,
                  )})`,
                )
            ).map((v) => [v.id, v.defaultCaseSize])
          : [],
      )
      poCases = po.lines.reduce(
        (sum, l) => sum + Math.round(l.qtyPcs / Math.max(1, sizes.get(l.variantId) ?? 1)),
        0,
      )
    }
  }
  let lrPackages: number | null = null
  if (doc.supplierId) {
    const [lr] = await tx
      .select({ packages: lorryReceipts.packages })
      .from(lorryReceipts)
      .innerJoin(documents, eq(documents.id, lorryReceipts.documentId))
      .where(and(eq(documents.supplierId, doc.supplierId), eq(documents.kind, 'lorry_receipt')))
      .orderBy(desc(lorryReceipts.id))
      .limit(1)
    lrPackages = lr?.packages ?? null
  }
  let gateCount: number | null = null
  if (doc.committedEntityId) {
    const [g] = await tx
      .select({
        counted: sql<number>`coalesce(sum(${grnLines.countedQtyPcs}), 0)::int`,
        n: sql<number>`count(${grnLines.id})::int`,
      })
      .from(grns)
      .leftJoin(grnLines, eq(grnLines.grnId, grns.id))
      .where(eq(grns.supplierInvoiceId, doc.committedEntityId))
    gateCount = g && Number(g.n) > 0 ? Number(g.counted) : null
  }
  if (poCases === null && lrPackages === null && gateCount === null) return null
  return { poCases, lrPackages, gateCount }
}
