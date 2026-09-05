import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  AcceptMatchInput,
  ChooseMatchInput,
  ExtractedInvoice,
  MatchesListInput,
  MatchesListOutput,
  RejectMatchInput,
  RerunMatchesInput,
  RerunMatchesOutput,
  SkuCandidate,
  SkuLine,
  SkuMatchLineOutput,
} from '@dos/contracts'
import { parseCaseSizeFromName, uuidv7 } from '@dos/domain'
import {
  brands,
  correctionsLog,
  extractions,
  productVariants,
  products,
  reviewSessions,
  skuMatchCandidates,
  supplierPackConfigs,
  withTenant,
  type Db,
} from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { asCaller, DESK, loadDocumentOr404, notFound } from './docint.internals.js'
import { reviewedOf, toCandidate, type CandidateRow } from './docint.mappers.js'
import { linePath } from './pipeline/paths.js'
import { readingOf, rematch, rememberSupplierAlias, type DocumentRow } from './pipeline/steps.js'

type ListIn = z.infer<typeof MatchesListInput>
type ListOut = z.infer<typeof MatchesListOutput>
type AcceptIn = z.infer<typeof AcceptMatchInput>
type RejectIn = z.infer<typeof RejectMatchInput>
type ChooseIn = z.infer<typeof ChooseMatchInput>
type LineOut = z.infer<typeof SkuMatchLineOutput>
type RerunIn = z.infer<typeof RerunMatchesInput>
type RerunOut = z.infer<typeof RerunMatchesOutput>

type ExtractionRow = typeof extractions.$inferSelect

/**
 * SKU matching as the desk sees it (docs/05 step 8): the cascade's candidates per printed line and
 * the three human writes — accept a listed candidate, reject one (or the line), pick another variant
 * from the catalog. A human pick remembers the supplier's pack (`supplier_pack_configs`, the second
 * number a human may type, docs/17 B) and is logged in `corrections_log` while a session is open. The
 * global `product_aliases` / `product_external_codes` are curator-owned and never written from here.
 */
@Injectable()
export class MatchesService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async list(input: ListIn): Promise<ListOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => {
      const extraction = await loadExtraction(tx, input.extractionId)
      const doc = await loadDocumentOr404(tx, extraction.documentId)
      const filters: (SQL | undefined)[] = [
        eq(skuMatchCandidates.extractionId, extraction.id),
        input.lineNo !== undefined ? eq(skuMatchCandidates.lineNo, input.lineNo) : undefined,
        input.cursor ? gt(skuMatchCandidates.id, input.cursor) : undefined,
      ]
      if (input.unmatchedOnly) {
        const chosen = await chosenLines(tx, extraction.id)
        if (chosen.length > 0)
          filters.push(
            sql`${skuMatchCandidates.lineNo} not in (${sql.join(
              chosen.map((n) => sql`${n}`),
              sql`, `,
            )})`,
          )
      }
      const rows = await tx
        .select()
        .from(skuMatchCandidates)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(
          asc(skuMatchCandidates.lineNo),
          desc(skuMatchCandidates.score),
          asc(skuMatchCandidates.id),
        )
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const items = await hydrate(tx, doc, page)
      const last = page[page.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async accept(input: AcceptIn): Promise<LineOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const { extraction, doc, reading, line } = await loadLine(tx, input.id, input.lineNo)
        const [candidate] = await tx
          .select()
          .from(skuMatchCandidates)
          .where(
            and(
              eq(skuMatchCandidates.id, input.candidateId),
              eq(skuMatchCandidates.extractionId, extraction.id),
              eq(skuMatchCandidates.lineNo, input.lineNo),
            ),
          )
          .limit(1)
        if (!candidate)
          throw notFound(`candidate on line ${String(input.lineNo)}`, input.candidateId)
        const before = await chosenVariant(tx, extraction.id, input.lineNo)
        await tx
          .update(skuMatchCandidates)
          .set({ chosen: false })
          .where(
            and(
              eq(skuMatchCandidates.extractionId, extraction.id),
              eq(skuMatchCandidates.lineNo, input.lineNo),
            ),
          )
        const pcsPerCase = await rememberPack(
          tx,
          doc,
          reading,
          line,
          candidate.variantId,
          input.pcsPerCase,
          input.rememberAlias,
        )
        await tx
          .update(skuMatchCandidates)
          .set({ chosen: true, features: withPack(candidate.features, pcsPerCase, ctx.actorId) })
          .where(eq(skuMatchCandidates.id, candidate.id))
        await syncSession(tx, doc, line.lineNo, { before, after: candidate.variantId, pcsPerCase })
        return { line: await lineView(tx, doc, extraction.id, input.lineNo) }
      }),
    )
  }

  async reject(input: RejectIn): Promise<LineOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const { extraction, doc, line } = await loadLine(tx, input.id, input.lineNo)
        const before = await chosenVariant(tx, extraction.id, input.lineNo)
        const rejection = {
          reason: input.reason,
          note: input.note ?? null,
          by: ctx.actorId,
          at: new Date().toISOString(),
        }
        if (input.candidateId) {
          const [candidate] = await tx
            .select()
            .from(skuMatchCandidates)
            .where(
              and(
                eq(skuMatchCandidates.id, input.candidateId),
                eq(skuMatchCandidates.extractionId, extraction.id),
                eq(skuMatchCandidates.lineNo, input.lineNo),
              ),
            )
            .limit(1)
          if (!candidate)
            throw notFound(`candidate on line ${String(input.lineNo)}`, input.candidateId)
          await tx
            .update(skuMatchCandidates)
            .set({
              chosen: false,
              features: { ...(candidate.features ?? {}), rejected: rejection },
            })
            .where(eq(skuMatchCandidates.id, candidate.id))
          if (before === candidate.variantId)
            await syncSession(tx, doc, line.lineNo, { before, after: null, pcsPerCase: null })
        } else {
          await tx
            .update(skuMatchCandidates)
            .set({
              chosen: false,
              features: sql`coalesce(${skuMatchCandidates.features}, '{}'::jsonb) || ${JSON.stringify({ rejectedLine: rejection })}::jsonb`,
            })
            .where(
              and(
                eq(skuMatchCandidates.extractionId, extraction.id),
                eq(skuMatchCandidates.lineNo, input.lineNo),
              ),
            )
          if (before)
            await syncSession(tx, doc, line.lineNo, { before, after: null, pcsPerCase: null })
        }
        return { line: await lineView(tx, doc, extraction.id, input.lineNo) }
      }),
    )
  }

  async choose(input: ChooseIn): Promise<LineOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const { extraction, doc, reading, line } = await loadLine(tx, input.id, input.lineNo)
        const [variant] = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(
            and(
              eq(productVariants.id, input.variantId),
              inArray(productVariants.status, ['active', 'proposed']),
            ),
          )
          .limit(1)
        if (!variant) throw notFound('variant', input.variantId)
        const before = await chosenVariant(tx, extraction.id, input.lineNo)
        await tx
          .update(skuMatchCandidates)
          .set({ chosen: false })
          .where(
            and(
              eq(skuMatchCandidates.extractionId, extraction.id),
              eq(skuMatchCandidates.lineNo, input.lineNo),
            ),
          )
        const pcsPerCase = await rememberPack(
          tx,
          doc,
          reading,
          line,
          variant.id,
          input.pcsPerCase,
          input.rememberAlias,
        )
        const features = withPack(null, pcsPerCase, ctx.actorId)
        await tx
          .insert(skuMatchCandidates)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            extractionId: extraction.id,
            lineNo: input.lineNo,
            variantId: variant.id,
            score: 1,
            reason: 'reviewer',
            chosen: true,
            matchedBy: 'reviewer',
            features,
          })
          .onConflictDoUpdate({
            target: [
              skuMatchCandidates.tenantId,
              skuMatchCandidates.extractionId,
              skuMatchCandidates.lineNo,
              skuMatchCandidates.variantId,
            ],
            set: { score: 1, reason: 'reviewer', chosen: true, matchedBy: 'reviewer', features },
          })
        await syncSession(tx, doc, line.lineNo, { before, after: variant.id, pcsPerCase })
        return { line: await lineView(tx, doc, extraction.id, input.lineNo) }
      }),
    )
  }

  /** Re-run the cascade for every line with no chosen candidate (after `catalog.propose`). */
  async rerun(input: RerunIn): Promise<RerunOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const extraction = await loadExtraction(tx, input.id)
        const doc = await loadDocumentOr404(tx, extraction.documentId)
        const reading = readingOf(extraction)
        if (!reading)
          throw new ORPCError('CONFLICT', { message: 'the extraction carries no readable result' })
        const bands = await rematch(tx, doc, extraction.id, reading)
        const out = { green: 0, amber: 0, red: 0 }
        for (const band of bands.values()) out[band] += 1
        return out
      }),
    )
  }
}

/** The reviewer's pack decision rides on the chosen candidate so `review.start` seeds `caseSize` from it. */
function withPack(
  features: unknown,
  pcsPerCase: number | null,
  reviewerId: string,
): Record<string, unknown> {
  const base = (features as Record<string, unknown> | null) ?? {}
  return { ...base, reviewer: reviewerId, ...(pcsPerCase !== null ? { pcsPerCase } : {}) }
}

async function loadExtraction(tx: Db, id: string): Promise<ExtractionRow> {
  const [row] = await tx.select().from(extractions).where(eq(extractions.id, id)).limit(1)
  if (!row) throw notFound('extraction', id)
  return row
}

async function loadLine(
  tx: Db,
  extractionId: string,
  lineNo: number,
): Promise<{
  extraction: ExtractionRow
  doc: DocumentRow
  reading: ExtractedInvoice
  line: ExtractedInvoice['lines'][number]
}> {
  const extraction = await loadExtraction(tx, extractionId)
  const doc = await loadDocumentOr404(tx, extraction.documentId)
  if (doc.status === 'committed' || doc.status === 'rejected')
    throw new ORPCError('CONFLICT', {
      message: `document ${doc.id} is ${doc.status}; its matches are frozen`,
    })
  const reading = readingOf(extraction)
  const line = reading?.lines.find((l) => l.lineNo === lineNo)
  if (!reading || !line) throw notFound(`line ${String(lineNo)} of extraction`, extractionId)
  return { extraction, doc, reading, line }
}

async function chosenLines(tx: Db, extractionId: string): Promise<number[]> {
  return (
    await tx
      .selectDistinct({ lineNo: skuMatchCandidates.lineNo })
      .from(skuMatchCandidates)
      .where(
        and(eq(skuMatchCandidates.extractionId, extractionId), eq(skuMatchCandidates.chosen, true)),
      )
  ).map((r) => r.lineNo)
}

async function chosenVariant(tx: Db, extractionId: string, lineNo: number): Promise<string | null> {
  const [row] = await tx
    .select({ variantId: skuMatchCandidates.variantId })
    .from(skuMatchCandidates)
    .where(
      and(
        eq(skuMatchCandidates.extractionId, extractionId),
        eq(skuMatchCandidates.lineNo, lineNo),
        eq(skuMatchCandidates.chosen, true),
      ),
    )
    .limit(1)
  return row?.variantId ?? null
}

/**
 * The buy-side pack (docs/17 B): the reviewer's number, else the printed pack, else what the tenant
 * remembered, else the variant's default — upserted on `supplier_pack_configs` exactly as
 * `procurement.supplierInvoices.matchLine` does, with the supplier's code and description.
 */
async function rememberPack(
  tx: Db,
  doc: DocumentRow,
  reading: ExtractedInvoice,
  line: ExtractedInvoice['lines'][number],
  variantId: string,
  pcsPerCase: number | undefined,
  rememberAlias: boolean,
): Promise<number | null> {
  if (!doc.supplierId) return null
  const [variant] = await tx
    .select({ defaultCaseSize: productVariants.defaultCaseSize })
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .limit(1)
  const [existing] = await tx
    .select({ pcsPerCase: supplierPackConfigs.pcsPerCase })
    .from(supplierPackConfigs)
    .where(
      and(
        eq(supplierPackConfigs.supplierId, doc.supplierId),
        eq(supplierPackConfigs.variantId, variantId),
      ),
    )
    .limit(1)
  const pack =
    pcsPerCase ??
    line.caseSize ??
    parseCaseSizeFromName(line.description) ??
    existing?.pcsPerCase ??
    variant?.defaultCaseSize ??
    1
  const values = {
    pcsPerCase: pack,
    supplierCode: line.supplierCode,
    supplierDescription: line.description,
  }
  await tx
    .insert(supplierPackConfigs)
    .values({
      id: uuidv7(),
      tenantId: doc.tenantId,
      supplierId: doc.supplierId,
      variantId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        supplierPackConfigs.tenantId,
        supplierPackConfigs.supplierId,
        supplierPackConfigs.variantId,
      ],
      set: { ...values, updatedAt: new Date() },
    })
  if (rememberAlias && reading.header.supplierName)
    await rememberSupplierAlias(tx, {
      tenantId: doc.tenantId,
      supplierId: doc.supplierId,
      alias: reading.header.supplierName,
      gstin: reading.header.supplierGstin,
    })
  return pack
}

/** Keep an open review session's `reviewed` payload in step with the pick and log the correction. */
async function syncSession(
  tx: Db,
  doc: DocumentRow,
  lineNo: number,
  change: { before: string | null; after: string | null; pcsPerCase: number | null },
): Promise<void> {
  const [session] = await tx
    .select()
    .from(reviewSessions)
    .where(
      and(
        eq(reviewSessions.documentId, doc.id),
        eq(reviewSessions.status, 'open'),
        gt(reviewSessions.lockedUntil, new Date()),
      ),
    )
    .limit(1)
  if (!session || change.before === change.after) return
  const reviewed = reviewedOf(session)
  const index = reviewed.lines.findIndex((l) => l.lineNo === lineNo)
  const corrections: { path: string; before: unknown; after: unknown }[] = [
    {
      path: linePath(index >= 0 ? index : lineNo - 1, 'variantId'),
      before: change.before,
      after: change.after,
    },
  ]
  const line = index >= 0 ? reviewed.lines[index] : undefined
  if (line) {
    line.variantId = change.after
    if (change.pcsPerCase !== null && line.caseSize !== change.pcsPerCase) {
      corrections.push({
        path: linePath(index, 'caseSize'),
        before: line.caseSize,
        after: change.pcsPerCase,
      })
      line.caseSize = change.pcsPerCase
    }
  }
  await tx.insert(correctionsLog).values(
    corrections.map((c) => ({
      id: uuidv7(),
      tenantId: doc.tenantId,
      reviewSessionId: session.id,
      ...c,
    })),
  )
  await tx
    .update(reviewSessions)
    .set({ reviewed, editsCount: session.editsCount + corrections.length, updatedAt: new Date() })
    .where(eq(reviewSessions.id, session.id))
}

async function hydrate(tx: Db, doc: DocumentRow, rows: CandidateRow[]): Promise<SkuCandidate[]> {
  if (rows.length === 0) return []
  const ids = [...new Set(rows.map((r) => r.variantId))]
  const variants = await tx
    .select({
      id: productVariants.id,
      name: productVariants.name,
      productName: products.name,
      brandName: brands.name,
      netQty: productVariants.netQty,
      netUnit: productVariants.netUnit,
      defaultCaseSize: productVariants.defaultCaseSize,
      mrpPaise: productVariants.mrpPaise,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(inArray(productVariants.id, ids))
  const packs = doc.supplierId
    ? await tx
        .select({
          variantId: supplierPackConfigs.variantId,
          pcsPerCase: supplierPackConfigs.pcsPerCase,
        })
        .from(supplierPackConfigs)
        .where(
          and(
            eq(supplierPackConfigs.supplierId, doc.supplierId),
            inArray(supplierPackConfigs.variantId, ids),
          ),
        )
    : []
  const packByVariant = new Map(packs.map((p) => [p.variantId, p.pcsPerCase]))
  const byId = new Map(variants.map((v) => [v.id, v]))
  const out: SkuCandidate[] = []
  for (const row of rows) {
    const v = byId.get(row.variantId)
    if (!v) continue
    out.push(
      toCandidate(row, {
        variantName: v.name,
        productName: v.productName,
        brandName: v.brandName,
        netQty: v.netQty,
        netUnit: v.netUnit,
        defaultCaseSize: v.defaultCaseSize,
        mrpPaise: v.mrpPaise,
        packPcsPerCase: packByVariant.get(v.id) ?? null,
      }),
    )
  }
  return out
}

export async function lineView(
  tx: Db,
  doc: DocumentRow,
  extractionId: string,
  lineNo: number,
): Promise<SkuLine> {
  const rows = await tx
    .select()
    .from(skuMatchCandidates)
    .where(
      and(eq(skuMatchCandidates.extractionId, extractionId), eq(skuMatchCandidates.lineNo, lineNo)),
    )
    .orderBy(
      desc(skuMatchCandidates.chosen),
      desc(skuMatchCandidates.score),
      asc(skuMatchCandidates.id),
    )
    .limit(50)
  const items = await hydrate(tx, doc, rows)
  const band = items.some((i) => i.chosen) ? 'green' : items.length > 0 ? 'amber' : 'red'
  return { lineNo, band, items }
}
