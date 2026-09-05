import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import type { DocumentKind, ExtractedInvoice, QrPayload } from '@dos/contracts'
import { ExtractedInvoiceSchema, QrPayloadSchema } from '@dos/contracts'
import {
  brands,
  documentPages,
  documents,
  engineDisagreements,
  extractionChecks,
  extractions,
  hsnRates,
  outboxEvents,
  productVariants,
  products,
  supplierAliases,
  supplierInvoices,
  supplierPackConfigs,
  suppliers,
  tenants,
  type Db,
} from '@dos/db'
import {
  businessDate,
  documentMachine,
  financialYear,
  parseCaseSizeFromName,
  uuidv7,
  type DocumentEvent,
} from '@dos/domain'
import { createObjectStorage, type ObjectStorage } from '../../../platform/object-storage.js'
import { docintConfig, type DocintConfig } from './config.js'
import { createEngine } from './engines/index.js'
import { matchLines, normalizeTight, writeCandidates, type Band } from './matcher.js'
import { diffReadings } from './paths.js'
import type {
  CatalogHint,
  EngineHints,
  ExtractionEngineAdapter,
  PageImage,
  PipelineJob,
  PipelineRunner,
  StepResult,
} from './types.js'
import { EngineFailure, EngineTransientError } from './types.js'
import {
  shouldEscalate,
  summarise,
  validateInvoice,
  type CheckResult,
  type ValidatableInvoice,
} from './validators.js'

/**
 * The four pipeline steps (task: qr-read → extract → validate → match), each idempotent and each
 * leaving the document where the app can see progress: `status` moves only through `documentMachine`,
 * and the cheap poll (`documents.status`) shows `latestExtractionId` after extract, `checkSummary`
 * after validate and the final `extracted` / `needs_review` after match. The worker runs one pg-boss
 * job per step; the inline path runs them back to back inside the request.
 */

export type DocumentRow = typeof documents.$inferSelect
export type ExtractionRow = typeof extractions.$inferSelect

export const DOCINT_EVENTS = {
  submitted: 'docint.document.submitted',
  extracted: 'docint.document.extracted',
  needsReview: 'docint.document.needs_review',
  reviewed: 'docint.document.reviewed',
  failed: 'docint.document.failed',
  drafted: 'docint.supplier_invoice.drafted',
} as const

export const FAILURE_EXTRACTION = 'extraction_failed'

// -------------------------------------------------------------------------------------------------
// shared helpers (also used by the Nest services)

export async function loadDocumentRow(tx: Db, documentId: string): Promise<DocumentRow | null> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  return row ?? null
}

/** `documentMachine.next()` written into the column, with the extra columns of that move. */
export async function applyDocumentEvent(
  tx: Db,
  doc: DocumentRow,
  event: DocumentEvent,
  extra: Partial<typeof documents.$inferInsert> = {},
): Promise<DocumentRow> {
  const next = documentMachine.next(doc.status, event)
  const [row] = await tx
    .update(documents)
    .set({ status: next, updatedAt: new Date(), ...extra })
    .where(eq(documents.id, doc.id))
    .returning()
  if (!row) throw new Error(`document ${doc.id} vanished during ${event}`)
  return row
}

export async function emitDocumentEvent(
  tx: Db,
  doc: { id: string; tenantId: string },
  eventType: string,
  payload: Record<string, unknown>,
  aggregateType: 'document' | 'supplier_invoice' = 'document',
  aggregateId: string = doc.id,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: doc.tenantId,
    aggregateType,
    aggregateId,
    eventType,
    payload: { documentId: doc.id, ...payload },
  })
}

/** Newest reading of a document; the review base is `bestExtraction`, which prefers fewer red checks. */
export async function latestExtraction(tx: Db, documentId: string): Promise<ExtractionRow | null> {
  const [row] = await tx
    .select()
    .from(extractions)
    .where(eq(extractions.documentId, documentId))
    .orderBy(desc(extractions.createdAt), desc(extractions.id))
    .limit(1)
  return row ?? null
}

/**
 * The reading a reviewer should start from: the one with the fewest failed `error` checks, newest
 * first on a tie — so an escalated second reading only replaces the first when it is actually better.
 */
export async function bestExtraction(tx: Db, documentId: string): Promise<ExtractionRow | null> {
  const rows = await tx
    .select()
    .from(extractions)
    .where(eq(extractions.documentId, documentId))
    .orderBy(desc(extractions.createdAt), desc(extractions.id))
    .limit(8)
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0] ?? null
  const counts = await tx
    .select({ extractionId: extractionChecks.extractionId, n: sql<number>`count(*)::int` })
    .from(extractionChecks)
    .where(
      and(
        inArray(
          extractionChecks.extractionId,
          rows.map((r) => r.id),
        ),
        eq(extractionChecks.passed, false),
        eq(extractionChecks.severity, 'error'),
      ),
    )
    .groupBy(extractionChecks.extractionId)
  const failed = new Map(counts.map((c) => [c.extractionId, Number(c.n)]))
  let best = rows[0] ?? null
  for (const row of rows) {
    if (!best) break
    if ((failed.get(row.id) ?? 0) < (failed.get(best.id) ?? 0)) best = row
  }
  return best
}

/** Failed-check counts for the reading. `review.*` rows, once any exist, are the truth (the reviewed doc). */
export async function checkSummaryFor(
  tx: Db,
  extractionId: string,
): Promise<{ errors: number; warnings: number; reviewStage: boolean }> {
  const rows = await tx
    .select({
      check: extractionChecks.check,
      passed: extractionChecks.passed,
      severity: extractionChecks.severity,
    })
    .from(extractionChecks)
    .where(eq(extractionChecks.extractionId, extractionId))
  const review = rows.filter((r) => r.check.startsWith('review.'))
  const set = review.length > 0 ? review : rows
  return { ...summarise(set), reviewStage: review.length > 0 }
}

export function readingOf(row: ExtractionRow): ExtractedInvoice | null {
  const parsed = ExtractedInvoiceSchema.safeParse(row.result)
  return parsed.success ? parsed.data : null
}

export function qrOf(doc: DocumentRow): QrPayload | null {
  const parsed = QrPayloadSchema.safeParse(doc.qrPayload)
  return parsed.success ? parsed.data : null
}

/** Pre-classification (docs/05 step 2): which prompt profile the engine reads this bill with. */
export function promptProfileFor(kind: DocumentKind, supplierName: string | null): string {
  if (kind === 'brand_dms_invoice') return 'brand-dms-secondary'
  const name = (supplierName ?? '').toLowerCase()
  if (name.includes('reliance')) return 'sap-reliance'
  if (name.includes('guiltfree') || name.includes('too yumm')) return 'guiltfree-dms'
  if (name.includes('marg')) return 'marg-gst-local'
  return 'tally'
}

/** Resolve a supplier from a GSTIN (aliases first, then the master) or from a printed name (aliases). */
export async function resolveSupplier(
  tx: Db,
  input: { tenantId: string; gstin?: string | null; name?: string | null },
): Promise<string | null> {
  const gstin = input.gstin?.trim().toUpperCase()
  if (gstin) {
    const [alias] = await tx
      .select({ supplierId: supplierAliases.supplierId })
      .from(supplierAliases)
      .where(and(eq(supplierAliases.tenantId, input.tenantId), eq(supplierAliases.gstin, gstin)))
      .limit(1)
    if (alias) return alias.supplierId
    const [master] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, input.tenantId), eq(suppliers.gstin, gstin)))
      .limit(1)
    if (master) return master.id
  }
  const name = input.name ? normalizeTight(input.name) : ''
  if (name) {
    const [alias] = await tx
      .select({ supplierId: supplierAliases.supplierId })
      .from(supplierAliases)
      .where(
        and(eq(supplierAliases.tenantId, input.tenantId), eq(supplierAliases.normalized, name)),
      )
      .limit(1)
    if (alias) return alias.supplierId
  }
  return null
}

/** Bump the alias that resolved a document (`hits`, `last_seen_at`), or remember a new one. */
export async function rememberSupplierAlias(
  tx: Db,
  input: { tenantId: string; supplierId: string; alias: string; gstin: string | null },
): Promise<void> {
  const normalized = normalizeTight(input.alias)
  if (!normalized) return
  await tx
    .insert(supplierAliases)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      supplierId: input.supplierId,
      alias: input.alias.trim(),
      normalized,
      gstin: input.gstin,
      hits: 1,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [supplierAliases.tenantId, supplierAliases.normalized],
      set: {
        hits: sql`${supplierAliases.hits} + 1`,
        lastSeenAt: new Date(),
        gstin: sql`coalesce(${supplierAliases.gstin}, ${input.gstin})`,
        updatedAt: new Date(),
      },
    })
}

async function catalogHints(
  tx: Db,
  tenantId: string,
  supplierId: string | null,
): Promise<CatalogHint[]> {
  if (!supplierId) return []
  const rows = await tx
    .select({
      variantId: productVariants.id,
      variantName: productVariants.name,
      productName: products.name,
      brandName: brands.name,
      supplierCode: supplierPackConfigs.supplierCode,
      supplierDescription: supplierPackConfigs.supplierDescription,
      hsnCode: productVariants.hsnCode,
      mrpPaise: productVariants.mrpPaise,
      pcsPerCase: supplierPackConfigs.pcsPerCase,
    })
    .from(supplierPackConfigs)
    .innerJoin(productVariants, eq(productVariants.id, supplierPackConfigs.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(
      and(
        eq(supplierPackConfigs.tenantId, tenantId),
        eq(supplierPackConfigs.supplierId, supplierId),
      ),
    )
    .orderBy(asc(supplierPackConfigs.id))
    .limit(40)
  const rates = await hsnRatesAsOf(
    tx,
    rows.map((r) => r.hsnCode),
    businessDate().date,
  )
  return rows.map((r) => ({
    ...r,
    gstBps: rates.get(r.hsnCode)?.gstBps ?? null,
    cessBps: rates.get(r.hsnCode)?.cessBps ?? null,
  }))
}

/** The dated GST rate per HSN as of `isoDate` (latest `effective_from` that is not yet expired). */
export async function hsnRatesAsOf(
  tx: Db,
  codes: readonly string[],
  isoDate: string,
): Promise<Map<string, { gstBps: number; cessBps: number }>> {
  const wanted = [...new Set(codes.filter((c) => /^\d{4,8}$/.test(c)))]
  if (wanted.length === 0) return new Map()
  const prefixes = [...new Set(wanted.flatMap((c) => [c, c.slice(0, 6), c.slice(0, 4)]))]
  const rows = await tx
    .select({
      hsnCode: hsnRates.hsnCode,
      gstBps: hsnRates.gstBps,
      cessBps: hsnRates.cessBps,
      effectiveFrom: hsnRates.effectiveFrom,
    })
    .from(hsnRates)
    .where(
      and(
        inArray(hsnRates.hsnCode, prefixes),
        sql`${hsnRates.effectiveFrom} <= ${isoDate}`,
        or(isNull(hsnRates.effectiveTo), sql`${hsnRates.effectiveTo} >= ${isoDate}`),
      ),
    )
    .orderBy(asc(hsnRates.hsnCode), desc(hsnRates.effectiveFrom))
  const out = new Map<string, { gstBps: number; cessBps: number }>()
  for (const r of rows)
    if (!out.has(r.hsnCode)) out.set(r.hsnCode, { gstBps: r.gstBps, cessBps: r.cessBps })
  return out
}

/** Is this invoice already in the books (procurement) or already captured (another document)? */
export async function findDuplicate(
  tx: Db,
  input: {
    documentId: string
    supplierId: string | null
    invoiceNo: string | null
    irn: string | null
  },
): Promise<{ supplierInvoiceId: string | null; documentId: string | null } | null> {
  const conditions = []
  if (input.irn) conditions.push(eq(supplierInvoices.irn, input.irn.toLowerCase()))
  if (input.supplierId && input.invoiceNo)
    conditions.push(
      and(
        eq(supplierInvoices.supplierId, input.supplierId),
        eq(supplierInvoices.invoiceNo, input.invoiceNo),
      ),
    )
  let supplierInvoiceId: string | null = null
  if (conditions.length > 0) {
    const [row] = await tx
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(and(or(...conditions), ne(supplierInvoices.status, 'cancelled')))
      .limit(1)
    supplierInvoiceId = row?.id ?? null
  }
  let documentId: string | null = null
  if (input.irn) {
    const [row] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.irn, input.irn.toLowerCase()),
          ne(documents.id, input.documentId),
          notInArray(documents.status, ['rejected', 'failed']),
        ),
      )
      .limit(1)
    documentId = row?.id ?? null
  }
  if (!documentId && input.supplierId && input.invoiceNo) {
    const [row] = await tx
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(extractions, eq(extractions.documentId, documents.id))
      .where(
        and(
          eq(documents.supplierId, input.supplierId),
          eq(extractions.invoiceNo, input.invoiceNo),
          ne(documents.id, input.documentId),
          notInArray(documents.status, ['rejected', 'failed']),
        ),
      )
      .limit(1)
    documentId = row?.id ?? null
  }
  return supplierInvoiceId || documentId ? { supplierInvoiceId, documentId } : null
}

function result(doc: DocumentRow, partial: Partial<StepResult> = {}): StepResult {
  return {
    documentId: doc.id,
    status: doc.status,
    extractionId: null,
    errors: 0,
    warnings: 0,
    unmatched: 0,
    escalate: false,
    ...partial,
  }
}

// -------------------------------------------------------------------------------------------------
// step 1: qr-read — re-check what capture left behind, pick the prompt profile, verifying → extracting

export async function qrReadStep(runner: PipelineRunner, job: PipelineJob): Promise<StepResult> {
  return runner.run(async (tx) => {
    let doc = await loadDocumentRow(tx, job.documentId)
    if (!doc) throw new DocumentGone(job.documentId)
    if (doc.status !== 'verifying') return result(doc)
    const qr = qrOf(doc)
    const supplierId =
      doc.supplierId ??
      (qr ? await resolveSupplier(tx, { tenantId: doc.tenantId, gstin: qr.sellerGstin }) : null)
    const supplierName = supplierId
      ? ((
          await tx
            .select({ name: suppliers.name })
            .from(suppliers)
            .where(eq(suppliers.id, supplierId))
            .limit(1)
        )[0]?.name ?? null)
      : null
    doc = await applyDocumentEvent(tx, doc, 'verified', {
      supplierId,
      promptProfile: doc.promptProfile ?? promptProfileFor(doc.kind, supplierName),
      irn: doc.irn ?? qr?.irn ?? null,
    })
    return result(doc)
  })
}

// -------------------------------------------------------------------------------------------------
// step 2: extract — the engine reads the pages; one `extractions` row per attempt

export class DocumentGone extends Error {
  constructor(documentId: string) {
    super(`document ${documentId} not found`)
    this.name = 'DocumentGone'
  }
}

export interface ExtractOptions {
  engine?: 'llm_vision' | 'llm_vision_secondary' | 'template' | undefined
  adapter?: ExtractionEngineAdapter | undefined
  storage?: ObjectStorage | undefined
  config?: DocintConfig | undefined
  /** The reading this one escalates from (secondary engine). */
  escalatedFromExtractionId?: string | null | undefined
}

async function loadPages(
  tx: Db,
  doc: DocumentRow,
  storage: ObjectStorage | null,
): Promise<PageImage[]> {
  const rows = await tx
    .select()
    .from(documentPages)
    .where(eq(documentPages.documentId, doc.id))
    .orderBy(asc(documentPages.pageNo))
  const pages: PageImage[] = []
  for (const row of rows) {
    const mimeType = row.mimeType as PageImage['mimeType']
    pages.push({
      pageNo: row.pageNo,
      mimeType,
      bytes: storage ? await storage.get(row.objectKey) : Buffer.alloc(0),
      width: row.width,
      height: row.height,
    })
  }
  return pages
}

async function hintsFor(tx: Db, doc: DocumentRow): Promise<EngineHints> {
  const [tenant] = await tx
    .select({ legalName: tenants.legalName, gstin: tenants.gstin, stateCode: tenants.stateCode })
    .from(tenants)
    .where(eq(tenants.id, doc.tenantId))
    .limit(1)
  const supplier = doc.supplierId
    ? ((
        await tx
          .select({
            id: suppliers.id,
            name: suppliers.name,
            gstin: suppliers.gstin,
            stateCode: suppliers.stateCode,
          })
          .from(suppliers)
          .where(eq(suppliers.id, doc.supplierId))
          .limit(1)
      )[0] ?? null)
    : null
  return {
    tenantId: doc.tenantId,
    documentId: doc.id,
    kind: doc.kind,
    contentHash: doc.contentHash,
    supplier,
    buyer: {
      name: tenant?.legalName ?? 'the distributor',
      gstin: tenant?.gstin ?? null,
      stateCode: tenant?.stateCode ?? null,
    },
    expectedPages: doc.expectedPages,
    qr: qrOf(doc),
    catalog: await catalogHints(tx, doc.tenantId, doc.supplierId),
    note: doc.note,
  }
}

/**
 * Read the pages. Bounded to one engine call; the bytes never touch the database. Throws
 * `EngineTransientError` for the queue to retry, `EngineFailure` for a permanent fault of this
 * attempt — the caller (job or inline runner) decides when attempts run out.
 */
export async function extractStep(
  runner: PipelineRunner,
  job: PipelineJob,
  opts: ExtractOptions = {},
): Promise<StepResult> {
  const config = opts.config ?? docintConfig()
  const adapter = opts.adapter ?? createEngine(config)
  const engine = opts.engine ?? 'llm_vision'
  const prepared = await runner.run(async (tx) => {
    const doc = await loadDocumentRow(tx, job.documentId)
    if (!doc) throw new DocumentGone(job.documentId)
    if (doc.status !== 'extracting') return { doc, pages: null, hints: null }
    const storage = adapter.name === 'stub' ? null : (opts.storage ?? createObjectStorage())
    const pages = await loadPages(tx, doc, storage)
    const hints = await hintsFor(tx, doc)
    const [bumped] = await tx
      .update(documents)
      .set({ attemptCount: sql`${documents.attemptCount} + 1`, updatedAt: new Date() })
      .where(eq(documents.id, doc.id))
      .returning()
    return { doc: bumped ?? doc, pages, hints }
  })
  if (!prepared.pages || !prepared.hints)
    return result(prepared.doc, {
      extractionId: (await runner.run((tx) => latestExtraction(tx, job.documentId)))?.id ?? null,
    })
  const doc = prepared.doc
  let reading
  try {
    reading = await adapter.run({
      pages: prepared.pages,
      profile:
        doc.promptProfile ?? promptProfileFor(doc.kind, prepared.hints.supplier?.name ?? null),
      hints: prepared.hints,
      engine,
    })
  } catch (error) {
    const code =
      error instanceof EngineFailure
        ? error.code
        : error instanceof EngineTransientError
          ? 'transient'
          : 'engine_error'
    await runner.run(async (tx) => {
      await tx
        .update(documents)
        .set({ failureCode: code, updatedAt: new Date() })
        .where(eq(documents.id, doc.id))
    })
    throw error
  }
  const extractionId = await runner.run(async (tx) => {
    const id = uuidv7()
    const header = reading.result.header
    await tx.insert(extractions).values({
      id,
      tenantId: doc.tenantId,
      documentId: doc.id,
      engine: reading.engine,
      model: reading.model,
      promptVersion: reading.promptVersion,
      engineVersion: reading.engineVersion,
      result: reading.result,
      confidence: reading.confidence,
      costPaise: reading.costPaise,
      latencyMs: reading.latencyMs,
      invoiceNo: header.invoiceNo,
      invoiceDate: header.invoiceDate,
      supplierGstin: header.supplierGstin,
      buyerGstin: header.buyerGstin,
      totalPaise: header.totalPaise,
      lineCount: reading.result.lines.length,
      escalatedFromExtractionId: opts.escalatedFromExtractionId ?? null,
    })
    await tx
      .update(documents)
      .set({ failureCode: null, updatedAt: new Date() })
      .where(eq(documents.id, doc.id))
    return id
  })
  return result(doc, { extractionId })
}

// -------------------------------------------------------------------------------------------------
// step 3: validate — the deterministic checks on the newest reading

export async function validateStep(
  runner: PipelineRunner,
  job: PipelineJob,
  opts: { extractionId?: string | undefined } = {},
): Promise<StepResult> {
  return runner.run(async (tx) => {
    const doc = await loadDocumentRow(tx, job.documentId)
    if (!doc) throw new DocumentGone(job.documentId)
    const extraction = opts.extractionId
      ? ((
          await tx.select().from(extractions).where(eq(extractions.id, opts.extractionId)).limit(1)
        )[0] ?? null)
      : await latestExtraction(tx, doc.id)
    if (!extraction) return result(doc)
    const reading = readingOf(extraction)
    if (!reading) return result(doc, { extractionId: extraction.id })
    const checks = await validateReading(tx, doc, reading)
    await replaceChecks(tx, doc.tenantId, extraction.id, checks, 'engine')
    // The reading may name the supplier the capture did not: resolve it once, from the printed GSTIN or name.
    let updated = doc
    if (!doc.supplierId) {
      const supplierId = await resolveSupplier(tx, {
        tenantId: doc.tenantId,
        gstin: reading.header.supplierGstin,
        name: reading.header.supplierName,
      })
      if (supplierId) {
        const [row] = await tx
          .update(documents)
          .set({ supplierId, updatedAt: new Date() })
          .where(eq(documents.id, doc.id))
          .returning()
        if (row) updated = row
      }
    }
    const { errors, warnings } = summarise(checks)
    return result(updated, {
      extractionId: extraction.id,
      errors,
      warnings,
      escalate: shouldEscalate(checks),
    })
  })
}

/** Build the validation context from the database and run the pure validators over a reading. */
export async function validateReading(
  tx: Db,
  doc: DocumentRow,
  reading: ValidatableInvoice,
  stage: 'engine' | 'review' = 'engine',
): Promise<CheckResult[]> {
  const [tenant] = await tx
    .select({ gstin: tenants.gstin })
    .from(tenants)
    .where(eq(tenants.id, doc.tenantId))
    .limit(1)
  const supplier = doc.supplierId
    ? ((
        await tx
          .select({ gstin: suppliers.gstin, stateCode: suppliers.stateCode })
          .from(suppliers)
          .where(eq(suppliers.id, doc.supplierId))
          .limit(1)
      )[0] ?? null)
    : null
  const pageCount = Number(
    (
      (
        await tx.execute(
          sql`select count(*)::int as n from document_pages where document_id = ${doc.id}`,
        )
      ).rows[0] as { n: number } | undefined
    )?.n ?? 0,
  )
  const header = reading.header
  const lines = reading.lines
  const invoiceDate = header.invoiceDate ?? businessDate().date
  const rates = await hsnRatesAsOf(
    tx,
    lines.map((l) => l.hsnCode ?? '').filter(Boolean),
    invoiceDate,
  )
  const duplicate = await findDuplicate(tx, {
    documentId: doc.id,
    supplierId: doc.supplierId,
    invoiceNo: header.invoiceNo,
    irn: header.irn ?? doc.irn,
  })
  const fyAt = header.invoiceDate ? new Date(`${header.invoiceDate}T12:00:00+05:30`) : null
  return validateInvoice(
    { header, lines, pageCount: reading.pageCount },
    {
      stage,
      today: businessDate().date,
      tenantGstin: tenant?.gstin ?? null,
      supplierGstin: supplier?.gstin ?? null,
      supplierStateCode: supplier?.stateCode ?? null,
      hsnRates: rates,
      pageCount,
      expectedPages: doc.expectedPages,
      qr: qrOf(doc),
      duplicate,
      financialYear: fyAt && !Number.isNaN(fyAt.getTime()) ? financialYear(fyAt) : null,
    },
  )
}

/**
 * Replace one stage's rows for an extraction. `engine` rows carry the validator's own names;
 * `review` rows are prefixed `review.` and are the only ones the desk re-runs, so the engine's
 * verdict stays for the eval (brief §2 `review.save`).
 */
export async function replaceChecks(
  tx: Db,
  tenantId: string,
  extractionId: string,
  checks: readonly CheckResult[],
  stage: 'engine' | 'review',
): Promise<void> {
  await tx
    .delete(extractionChecks)
    .where(
      and(
        eq(extractionChecks.extractionId, extractionId),
        stage === 'review'
          ? sql`${extractionChecks.check} like 'review.%'`
          : sql`${extractionChecks.check} not like 'review.%'`,
      ),
    )
  if (checks.length === 0) return
  await tx.insert(extractionChecks).values(
    checks.map((c) => ({
      id: uuidv7(),
      tenantId,
      extractionId,
      check: stage === 'review' ? `review.${c.check}` : c.check,
      passed: c.passed,
      severity: c.severity,
      lineNo: c.lineNo,
      detail: c.detail,
    })),
  )
}

// -------------------------------------------------------------------------------------------------
// step 4: match — the SKU cascade, then the verdict: extracted (clean) or needs_review

export async function matchStep(
  runner: PipelineRunner,
  job: PipelineJob,
  opts: { extractionId?: string | undefined; finalize?: boolean | undefined } = {},
): Promise<StepResult> {
  return runner.run(async (tx) => {
    let doc = await loadDocumentRow(tx, job.documentId)
    if (!doc) throw new DocumentGone(job.documentId)
    const extraction = opts.extractionId
      ? ((
          await tx.select().from(extractions).where(eq(extractions.id, opts.extractionId)).limit(1)
        )[0] ?? null)
      : await bestExtraction(tx, doc.id)
    if (!extraction) return result(doc)
    const reading = readingOf(extraction)
    if (!reading) return result(doc, { extractionId: extraction.id })
    const bands = await rematch(tx, doc, extraction.id, reading)
    const unmatched = [...bands.values()].filter((b) => b !== 'green').length
    const { errors, warnings } = await checkSummaryFor(tx, extraction.id)
    if ((opts.finalize ?? true) && doc.status === 'extracting') {
      const flagged = errors > 0 || warnings > 0 || unmatched > 0
      doc = await applyDocumentEvent(tx, doc, flagged ? 'flag' : 'extracted')
      await emitDocumentEvent(tx, doc, DOCINT_EVENTS.extracted, {
        extractionId: extraction.id,
        lineCount: reading.lines.length,
        redCount: errors,
        amberCount: warnings,
        unmatchedLines: unmatched,
      })
      if (flagged)
        await emitDocumentEvent(tx, doc, DOCINT_EVENTS.needsReview, {
          redCount: errors,
          amberCount: warnings,
          unmatchedLines: unmatched,
        })
    }
    return result(doc, { extractionId: extraction.id, errors, warnings, unmatched })
  })
}

/** Run the cascade for every line of the reading without a chosen candidate and persist it. */
export async function rematch(
  tx: Db,
  doc: DocumentRow,
  extractionId: string,
  reading: ExtractedInvoice,
): Promise<Map<number, Band>> {
  const results = await matchLines(tx, {
    tenantId: doc.tenantId,
    supplierId: doc.supplierId,
    lines: reading.lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      supplierCode: l.supplierCode,
      hsnCode: l.hsnCode,
      mrpPaise: l.mrpPaise,
      caseSize: l.caseSize ?? parseCaseSizeFromName(l.description),
      qtyPcs: l.qtyPcs,
      printedQty: l.printedQty,
    })),
  })
  return writeCandidates(tx, { tenantId: doc.tenantId, extractionId, results })
}

// -------------------------------------------------------------------------------------------------
// escalation — a second reading on the stronger model when the first one fails arithmetic

export async function escalateStep(
  runner: PipelineRunner,
  job: PipelineJob,
  base: { extractionId: string },
  opts: ExtractOptions = {},
): Promise<StepResult> {
  const second = await extractStep(runner, job, {
    ...opts,
    engine: 'llm_vision_secondary',
    escalatedFromExtractionId: base.extractionId,
  })
  if (!second.extractionId || second.extractionId === base.extractionId) return second
  const validated = await validateStep(runner, job, { extractionId: second.extractionId })
  await runner.run(async (tx) => {
    const [a] = await tx
      .select()
      .from(extractions)
      .where(eq(extractions.id, base.extractionId))
      .limit(1)
    const [b] = await tx
      .select()
      .from(extractions)
      .where(eq(extractions.id, second.extractionId ?? ''))
      .limit(1)
    const ra = a ? readingOf(a) : null
    const rb = b ? readingOf(b) : null
    if (!a || !ra || !rb) return
    const diffs = diffReadings(
      { header: ra.header, lines: ra.lines },
      { header: rb.header, lines: rb.lines },
    )
    if (diffs.length === 0) return
    const best = await bestExtraction(tx, job.documentId)
    const winner = best?.id === second.extractionId ? 'llm_vision_secondary' : 'llm_vision'
    await tx.insert(engineDisagreements).values(
      diffs.slice(0, 200).map((d) => ({
        id: uuidv7(),
        tenantId: a.tenantId,
        documentId: job.documentId,
        path: d.path,
        values: { llm_vision: d.a, llm_vision_secondary: d.b },
        resolvedValue: winner === 'llm_vision' ? d.a : d.b,
      })),
    )
  })
  return validated
}

// -------------------------------------------------------------------------------------------------
// the failure path — after the last permitted attempt the document is `failed` and manual typing is allowed

export async function failDocument(
  runner: PipelineRunner,
  job: PipelineJob,
  failureCode: string = FAILURE_EXTRACTION,
): Promise<StepResult> {
  return runner.run(async (tx) => {
    let doc = await loadDocumentRow(tx, job.documentId)
    if (!doc) throw new DocumentGone(job.documentId)
    if (!documentMachine.can(doc.status, 'fail')) return result(doc)
    doc = await applyDocumentEvent(tx, doc, 'fail', { failureCode })
    await emitDocumentEvent(tx, doc, DOCINT_EVENTS.failed, {
      failureCode,
      attemptCount: doc.attemptCount,
    })
    return result(doc)
  })
}
