import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { paise, roundToRupee } from '@dos/domain'
import type { Db } from '../client.js'
import {
  correctionsLog,
  documentPages,
  documents,
  engineDisagreements,
  extractionChecks,
  extractions,
  productAliases,
  productExternalCodes,
  reviewSessions,
  skuMatchCandidates,
  supplierAliases,
  supplierInvoiceLines,
  supplierInvoices,
  supplierPackConfigs,
  suppliers,
} from '../schema/index.js'
import type { VariantRow } from './catalog.js'
import { insertMany } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { TenantCatalogResult } from './tenant-catalog.js'
import { atIstTime, daysAgo, daysAhead, isoDate, makeGstin, TODAY } from './util.js'

/**
 * Document intelligence demo (docs/plans/docint.md §6): the inbound inbox as the manager sees it on
 * a Thursday afternoon. Eleven captured documents in every state of the pipeline, their pages (a
 * 1×1 PNG each, written to the local object store so `readUrl` opens), the engine readings whose
 * header and line amounts EQUAL the supplier invoices `stock.ts` already booked (so the demo is
 * internally consistent), the deterministic checks, the SKU candidates in all three bands, two
 * open review sessions (one per desk user, so both the owner and the manager service can save,
 * heartbeat and submit), a submitted one waiting for approval, corrections, an engine
 * disagreement, the supplier-name aliases and a handful of curated external codes.
 *
 * Every row is keyed with `demoId('docint-…', `${tenantId}:${key}`)` and inserted with
 * `onConflictDoNothing`, so re-seeding adds nothing (and a second distributor gets its own rows).
 * Never touches stock, cost or the journal: a document is a reading, not a receipt (never-list 6).
 */

const DOCS_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** Same resolution as the local object-storage driver: `OBJECT_STORAGE_DIR` or `<workspace>/.storage`. */
function storageRoot(): string {
  const configured = process.env.OBJECT_STORAGE_DIR?.trim()
  if (configured) return resolve(configured)
  let dir = resolve(process.cwd())
  for (let hop = 0; hop < 12; hop++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, '.storage')
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(resolve(process.cwd()), '.storage')
}

function writePage(objectKey: string): void {
  const full = join(storageRoot(), objectKey)
  if (existsSync(full)) return
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, DOCS_PNG)
}

type InvoiceRow = typeof supplierInvoices.$inferSelect
type InvoiceLineRow = typeof supplierInvoiceLines.$inferSelect

interface Reading {
  header: Record<string, unknown>
  lines: Record<string, unknown>[]
  fieldConfidence: Record<string, number>
  handwrittenAnnotations: Record<string, unknown>[]
  pageCount: number
}

interface ReadingOptions {
  invoiceNo: string
  invoiceDate: string
  pageCount: number
  /** Per printed line: how the description reads and whether the code is printed. */
  lines?: {
    index: number
    description?: string
    supplierCode?: string | null
    taxablePaise?: number
  }[]
  totalOffsetPaise?: number
}

/** The engine's reading of a booked invoice: the same numbers, printed per case (docs/17 A4). */
function readingOf(
  invoice: InvoiceRow,
  lines: InvoiceLineRow[],
  variantsById: Map<string, VariantRow>,
  supplier: { name: string; gstin: string | null; stateCode: string | null },
  opts: ReadingOptions,
): Reading {
  const fieldConfidence: Record<string, number> = {
    'header.invoiceNo': 0.99,
    'header.invoiceDate': 0.98,
    'header.supplierGstin': 0.99,
    'header.totalPaise': 0.97,
  }
  const overrides = new Map((opts.lines ?? []).map((l) => [l.index, l]))
  const out = lines.map((l, i) => {
    const v = variantsById.get(l.variantId ?? '')
    const caseSize = v?.defaultCaseSize ?? 12
    const cases = Math.max(1, Math.round(l.qtyPcs / caseSize))
    const over = overrides.get(i)
    const taxable = over?.taxablePaise ?? l.taxablePaise
    fieldConfidence[`lines[${String(i)}].description`] = over?.description ? 0.74 : 0.97
    fieldConfidence[`lines[${String(i)}].qtyPcs`] = 0.96
    fieldConfidence[`lines[${String(i)}].ratePaise`] = 0.95
    fieldConfidence[`lines[${String(i)}].lineTotalPaise`] = over?.taxablePaise ? 0.62 : 0.96
    return {
      lineNo: i + 1,
      description: over?.description ?? l.description,
      supplierCode: over && 'supplierCode' in over ? (over.supplierCode ?? null) : l.supplierCode,
      hsnCode: l.hsnCode,
      batchNo: l.batchNo,
      mfgDate: isoDate(daysAgo(40 + i * 3)),
      expiryDate: l.expiryDate ?? isoDate(daysAhead(150 + i * 30)),
      mrpPaise: v?.mrpPaise ?? l.mrpPaise,
      printedQty: cases,
      printedUnit: 'CS',
      caseSize,
      qtyPcs: l.qtyPcs,
      freeQtyPcs: l.freeQtyPcs,
      ratePaise: l.ratePaise * caseSize,
      rateBasis: 'case',
      basisQty: caseSize,
      discountBps: l.discountBps,
      discountPaise: l.discountPaise,
      gstBps: l.gstBps,
      cessBps: l.cessBps,
      taxablePaise: taxable,
      taxPaise: l.taxPaise,
      lineTotalPaise: taxable + l.taxPaise,
      evidence: {
        pageNo: 1 + Math.floor((i / Math.max(1, lines.length)) * opts.pageCount),
        rowText: `${String(i + 1)} ${over?.description ?? l.description} ${String(cases)} CS ${((l.ratePaise * caseSize) / 100).toFixed(2)} ${(taxable / 100).toFixed(2)}`,
        bbox: [0.05, 0.32 + i * 0.05, 0.95, 0.36 + i * 0.05],
      },
    }
  })
  const subtotal = out.reduce((s, l) => s + Number(l.taxablePaise), 0)
  const sumLines = out.reduce((s, l) => s + Number(l.lineTotalPaise), 0)
  const cgst = invoice.cgstPaise
  const sgst = invoice.sgstPaise
  const igst = invoice.igstPaise
  const cess = invoice.cessPaise
  const beforeRounding = paise(sumLines + invoice.freightPaise)
  const { rounded, roundOff } = roundToRupee(beforeRounding)
  return {
    header: {
      supplierName: supplier.name,
      supplierGstin: supplier.gstin,
      buyerName: 'Tarsun Enterprises',
      buyerGstin: null,
      invoiceNo: opts.invoiceNo,
      invoiceDate: opts.invoiceDate,
      irn: null,
      ewayBillNo: null,
      placeOfSupplyState: '27',
      subtotalPaise: subtotal,
      discountPaise: 0,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      cessPaise: cess,
      freightPaise: invoice.freightPaise,
      roundOffPaise: roundOff,
      totalPaise: rounded + (opts.totalOffsetPaise ?? 0),
    },
    lines: out,
    fieldConfidence,
    handwrittenAnnotations: [],
    pageCount: opts.pageCount,
  }
}

/** The reviewed payload (what `review.start` seeds, plus the reviewer's edits) for a clean reading. */
function reviewedOf(
  reading: Reading,
  supplierId: string,
  lineVariantIds: (string | null)[],
  dueDate: string | null,
) {
  const h = reading.header
  return {
    header: {
      supplierId,
      supplierName: h.supplierName,
      supplierGstin: h.supplierGstin,
      buyerGstin: h.buyerGstin,
      invoiceNo: h.invoiceNo,
      invoiceDate: h.invoiceDate,
      irn: h.irn,
      ewayBillNo: h.ewayBillNo,
      placeOfSupplyState: h.placeOfSupplyState,
      purchaseOrderId: null,
      dueDate,
      subtotalPaise: h.subtotalPaise,
      discountPaise: h.discountPaise,
      cgstPaise: h.cgstPaise,
      sgstPaise: h.sgstPaise,
      igstPaise: h.igstPaise,
      cessPaise: h.cessPaise,
      freightPaise: h.freightPaise,
      roundOffPaise: h.roundOffPaise,
      totalPaise: h.totalPaise,
    },
    lines: reading.lines.map((l, i) => {
      const { evidence: _evidence, ...rest } = l
      return { ...rest, variantId: lineVariantIds[i] ?? null }
    }),
    annotations: [],
  }
}

const ENGINE_CHECKS = [
  'gstin_checksum',
  'gst_split_state',
  'hsn_dated_rate',
  'line_arithmetic',
  'sum_lines_equals_subtotal',
  'sum_lines_equals_total',
  'rounding_section_170',
  'page_completeness',
  'qr_line_count',
  'qr_total',
  'irn_hash',
  'duplicate_invoice',
] as const

interface CheckOverride {
  check: string
  lineNo: number | null
  severity: 'error' | 'warn'
  detail: Record<string, unknown>
}

function checksFor(
  tenantId: string,
  extractionId: string,
  key: string,
  failures: CheckOverride[],
  stage: 'engine' | 'review' = 'engine',
): (typeof extractionChecks.$inferInsert)[] {
  const failed = new Map(failures.map((f) => [`${f.check}:${String(f.lineNo)}`, f]))
  const rows: (typeof extractionChecks.$inferInsert)[] = []
  for (const check of ENGINE_CHECKS) {
    const name = stage === 'review' ? `review.${check}` : check
    const hit = failed.get(`${check}:null`)
    rows.push({
      id: demoId('docint-check', `${tenantId}:${key}:${name}`),
      tenantId,
      extractionId,
      check: name,
      passed: !hit,
      severity:
        hit?.severity ??
        (check === 'hsn_dated_rate' ||
        check === 'rounding_section_170' ||
        check === 'gst_split_state'
          ? 'warn'
          : 'error'),
      lineNo: null,
      detail: hit?.detail ?? null,
    })
  }
  for (const f of failures.filter((x) => x.lineNo !== null)) {
    const name = stage === 'review' ? `review.${f.check}` : f.check
    rows.push({
      id: demoId('docint-check', `${tenantId}:${key}:${name}:${String(f.lineNo)}`),
      tenantId,
      extractionId,
      check: name,
      passed: false,
      severity: f.severity,
      lineNo: f.lineNo,
      detail: f.detail,
    })
  }
  return rows
}

export interface DocintSeedResult {
  documentIds: Record<string, string>
}

export async function seedDocint(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  tenantCatalog: TenantCatalogResult,
  people: PeopleResult,
): Promise<DocintSeedResult> {
  const variantsById = new Map(variants.map((v) => [v.id, v]))
  const variantByKey = new Map(variants.map((v) => [v.key, v]))
  const supplierRows = await db.select().from(suppliers).where(eq(suppliers.tenantId, tenantId))
  const supplierById = new Map(supplierRows.map((s) => [s.id, s]))
  const did = (key: string) => demoId('docint-document', `${tenantId}:${key}`)
  const eid = (key: string) => demoId('docint-extraction', `${tenantId}:${key}`)
  const sid = (key: string) => demoId('docint-session', `${tenantId}:${key}`)

  /** The booked invoice of a supplier (`stock.ts`), with its lines in order. */
  const bookedInvoice = async (
    key: string,
  ): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] } | null> => {
    const [invoice] = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, demoId('supplier-invoice', key)))
    if (!invoice) return null
    const lines = await db
      .select()
      .from(supplierInvoiceLines)
      .where(eq(supplierInvoiceLines.supplierInvoiceId, invoice.id))
      .orderBy(asc(supplierInvoiceLines.lineNo))
    return { invoice, lines }
  }
  const supplierOf = (id: string) => {
    const s = supplierById.get(id)
    return { name: s?.name ?? 'Supplier', gstin: s?.gstin ?? null, stateCode: s?.stateCode ?? null }
  }
  const pack = (supplierId: string, variantId: string) =>
    demoId('supplier-pack', `${supplierId}:${variantId}`)

  const documentRows: (typeof documents.$inferInsert)[] = []
  const pageRows: (typeof documentPages.$inferInsert)[] = []
  const extractionRows: (typeof extractions.$inferInsert)[] = []
  const checkRows: (typeof extractionChecks.$inferInsert)[] = []
  const candidateRows: (typeof skuMatchCandidates.$inferInsert)[] = []
  const sessionRows: (typeof reviewSessions.$inferInsert)[] = []
  const correctionRows: (typeof correctionsLog.$inferInsert)[] = []
  const disagreementRows: (typeof engineDisagreements.$inferInsert)[] = []
  const packRows: (typeof supplierPackConfigs.$inferInsert)[] = []
  const documentIds: Record<string, string> = {}

  const addPages = (docKey: string, n: number, opts: { qrOnFirst?: boolean } = {}): string => {
    const docId = did(docKey)
    const hashes: string[] = []
    for (let p = 1; p <= n; p++) {
      const objectKey = `tenant/${tenantId}/docs/${docId}/page-${String(p)}.png`
      writePage(objectKey)
      const sha256 = createHash('sha256')
        .update(DOCS_PNG)
        .update(`${docId}:${String(p)}`)
        .digest('hex')
      hashes.push(sha256)
      pageRows.push({
        id: demoId('docint-page', `${tenantId}:${docKey}:${String(p)}`),
        tenantId,
        documentId: docId,
        pageNo: p,
        objectKey,
        mimeType: 'image/png',
        width: 2576,
        height: 3435,
        bytes: DOCS_PNG.byteLength,
        sha256,
        printedPageLabel: `${String(p)} of ${String(n)}`,
        qrDetected: p === 1 && (opts.qrOnFirst ?? false),
      })
    }
    return createHash('sha256').update(hashes.join('\n')).digest('hex')
  }

  const addExtraction = (
    docKey: string,
    extKey: string,
    reading: Reading,
    meta: {
      engine: 'qr' | 'llm_vision' | 'llm_vision_secondary'
      model: string | null
      confidence: number
      costPaise: number
      latencyMs: number
      createdAt: Date
      escalatedFrom?: string | null
    },
  ): string => {
    const id = eid(extKey)
    extractionRows.push({
      id,
      tenantId,
      documentId: did(docKey),
      engine: meta.engine,
      model: meta.model,
      promptVersion: meta.engine === 'qr' ? null : 'v1',
      engineVersion: meta.engine === 'qr' ? 'qr/1' : 'anthropic-messages/2023-06-01',
      result: reading,
      confidence: meta.confidence,
      costPaise: meta.costPaise,
      latencyMs: meta.latencyMs,
      invoiceNo: reading.header.invoiceNo as string,
      invoiceDate: reading.header.invoiceDate as string,
      supplierGstin: (reading.header.supplierGstin as string | null) ?? null,
      buyerGstin: null,
      totalPaise: reading.header.totalPaise as number,
      lineCount: reading.lines.length,
      escalatedFromExtractionId: meta.escalatedFrom ?? null,
      createdAt: meta.createdAt,
      updatedAt: meta.createdAt,
    })
    return id
  }

  const green = (
    extKey: string,
    lineNo: number,
    variantId: string,
    reason: 'supplier_alias' | 'external_code',
    score: number,
  ) => {
    candidateRows.push({
      id: demoId('docint-candidate', `${tenantId}:${extKey}:${String(lineNo)}:${variantId}`),
      tenantId,
      extractionId: eid(extKey),
      lineNo,
      variantId,
      score,
      reason,
      chosen: true,
      matchedBy: 'auto',
      features: {
        [reason === 'supplier_alias' ? 'supplierAlias' : 'externalCode']: true,
        hsnMatch: true,
        mrpDelta: 0,
      },
    })
  }
  const amber = (extKey: string, lineNo: number, picks: [string, number][]) => {
    for (const [variantId, score] of picks)
      candidateRows.push({
        id: demoId('docint-candidate', `${tenantId}:${extKey}:${String(lineNo)}:${variantId}`),
        tenantId,
        extractionId: eid(extKey),
        lineNo,
        variantId,
        score,
        reason: 'trgm',
        chosen: false,
        matchedBy: 'auto',
        features: {
          similarity: Math.round(((score - 0.24) / 0.71) * 1000) / 1000,
          via: 'variant',
          hsnMatch: true,
          mrpDelta: null,
        },
      })
  }
  const document = (
    key: string,
    row: Omit<typeof documents.$inferInsert, 'id' | 'tenantId' | 'contentHash'> & {
      contentHash?: string | null
    },
  ): string => {
    const id = did(key)
    documentIds[key] = id
    documentRows.push({ id, tenantId, ...row })
    return id
  }

  const ids = tenantCatalog.supplierIds
  const reliance = await bookedInvoice('reliance-1')
  const guruKripa = await bookedInvoice('guru-kripa-1')
  const guiltfree = await bookedInvoice('guiltfree-1')
  const alans = await bookedInvoice('alans-foods-1')

  // ---------------------------------------------------------------------------------------------
  // 1. reliance-1 — committed: the bill behind supplier invoice reliance-1, read with a verified QR
  if (reliance) {
    const key = 'reliance-1'
    const hash = addPages(key, 2, { qrOnFirst: true })
    const reading = readingOf(
      reliance.invoice,
      reliance.lines,
      variantsById,
      supplierOf(ids.reliance),
      {
        invoiceNo: reliance.invoice.invoiceNo,
        invoiceDate: reliance.invoice.invoiceDate,
        pageCount: 2,
      },
    )
    const irn = createHash('sha256').update(`${tenantId}:${key}:irn`).digest('hex')
    document(key, {
      kind: 'supplier_invoice',
      status: 'committed',
      uploadedBy: people.manager.id,
      supplierId: ids.reliance,
      qrPayload: {
        sellerGstin: supplierOf(ids.reliance).gstin,
        buyerGstin: makeGstin('27', 'AAETT9021Q'),
        docNo: reliance.invoice.invoiceNo,
        docTyp: 'INV',
        docDt: reliance.invoice.invoiceDate,
        totInvValPaise: reading.header.totalPaise,
        itemCnt: reliance.lines.length,
        mainHsnCode: '2202',
        irn,
        irnDt: `${reliance.invoice.invoiceDate}T10:12:00+05:30`,
      },
      irn,
      irnVerified: true,
      qrStatus: 'verified',
      contentHash: hash,
      committedEntityType: 'supplier_invoice',
      committedEntityId: reliance.invoice.id,
      committedAt: atIstTime(daysAgo(9), 17, 45),
      expectedPages: 2,
      capturedAt: atIstTime(daysAgo(9), 10, 20),
      promptProfile: 'sap-reliance',
      attemptCount: 1,
      createdAt: atIstTime(daysAgo(9), 10, 21),
      updatedAt: atIstTime(daysAgo(9), 17, 45),
    })
    addExtraction(
      key,
      `${key}:qr`,
      { ...reading, lines: [] },
      {
        engine: 'qr',
        model: null,
        confidence: 1,
        costPaise: 0,
        latencyMs: 12,
        createdAt: atIstTime(daysAgo(9), 10, 22),
      },
    )
    const ext = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.98,
      costPaise: 310,
      latencyMs: 9_400,
      createdAt: atIstTime(daysAgo(9), 10, 23),
    })
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision`, []))
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision:review`, [], 'review'))
    reliance.lines.forEach((l, i) => {
      if (l.variantId)
        green(
          `${key}:vision`,
          i + 1,
          l.variantId,
          i === 0 ? 'external_code' : 'supplier_alias',
          0.97 - i * 0.01,
        )
    })
    sessionRows.push({
      id: sid(key),
      tenantId,
      documentId: did(key),
      reviewerId: people.manager.id,
      baseExtractionId: ext,
      status: 'submitted',
      reviewed: reviewedOf(
        reading,
        ids.reliance,
        reliance.lines.map((l) => l.variantId),
        reliance.invoice.dueDate,
      ),
      lockedUntil: atIstTime(daysAgo(9), 17, 30),
      submittedAt: atIstTime(daysAgo(9), 17, 40),
      editsCount: 4,
      heartbeatAt: atIstTime(daysAgo(9), 17, 38),
      createdAt: atIstTime(daysAgo(9), 17, 10),
      updatedAt: atIstTime(daysAgo(9), 17, 40),
    })
    const corrections: [string, unknown, unknown][] = [
      ['lines[2].qtyPcs', 288, 300],
      ['lines[2].variantId', null, reliance.lines[2]?.variantId ?? null],
      [
        'lines[2].caseSize',
        null,
        variantsById.get(reliance.lines[2]?.variantId ?? '')?.defaultCaseSize ?? 12,
      ],
      ['header.roundOffPaise', 0, reading.header.roundOffPaise],
    ]
    corrections.forEach(([path, before, after], i) =>
      correctionRows.push({
        id: demoId('docint-correction', `${tenantId}:${key}:${String(i)}`),
        tenantId,
        reviewSessionId: sid(key),
        path,
        before,
        after,
        createdAt: atIstTime(daysAgo(9), 17, 15 + i * 5),
      }),
    )
  }

  // ---------------------------------------------------------------------------------------------
  // 2. guru-kripa-2 — REVIEWED, waiting for the desk to approve (the `documents.approve` example)
  if (guruKripa) {
    const key = 'guru-kripa-2'
    const hash = addPages(key, 4, { qrOnFirst: true })
    const reading = readingOf(
      guruKripa.invoice,
      guruKripa.lines,
      variantsById,
      supplierOf(ids.guruKripa),
      {
        invoiceNo: 'GUR/26-27/00490',
        invoiceDate: isoDate(daysAgo(1)),
        pageCount: 4,
      },
    )
    const irn = createHash('sha256').update(`${tenantId}:${key}:irn`).digest('hex')
    document(key, {
      kind: 'supplier_invoice',
      status: 'reviewed',
      uploadedBy: people.warehouse.id,
      supplierId: ids.guruKripa,
      irn,
      irnVerified: true,
      qrStatus: 'verified',
      contentHash: hash,
      expectedPages: 4,
      capturedAt: atIstTime(daysAgo(1), 9, 5),
      promptProfile: 'tally',
      attemptCount: 1,
      createdAt: atIstTime(daysAgo(1), 9, 6),
      updatedAt: atIstTime(daysAgo(1), 11, 30),
    })
    const ext = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.97,
      costPaise: 420,
      latencyMs: 13_800,
      createdAt: atIstTime(daysAgo(1), 9, 8),
    })
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision`, []))
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision:review`, [], 'review'))
    guruKripa.lines.forEach((l, i) => {
      if (l.variantId) green(`${key}:vision`, i + 1, l.variantId, 'supplier_alias', 0.98 - i * 0.01)
    })
    sessionRows.push({
      id: sid(key),
      tenantId,
      documentId: did(key),
      reviewerId: people.accountant.id,
      baseExtractionId: ext,
      status: 'submitted',
      reviewed: reviewedOf(
        reading,
        ids.guruKripa,
        guruKripa.lines.map((l) => l.variantId),
        isoDate(daysAhead(20)),
      ),
      lockedUntil: atIstTime(daysAgo(1), 11, 35),
      submittedAt: atIstTime(daysAgo(1), 11, 30),
      editsCount: 1,
      heartbeatAt: atIstTime(daysAgo(1), 11, 29),
      createdAt: atIstTime(daysAgo(1), 11, 0),
      updatedAt: atIstTime(daysAgo(1), 11, 30),
    })
    correctionRows.push({
      id: demoId('docint-correction', `${tenantId}:${key}:0`),
      tenantId,
      reviewSessionId: sid(key),
      path: 'header.dueDate',
      before: null,
      after: isoDate(daysAhead(20)),
      createdAt: atIstTime(daysAgo(1), 11, 20),
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 3. guiltfree-2 — needs_review with an open session (the manager): a red, an amber, a disagreement
  if (guiltfree) {
    const key = 'guiltfree-2'
    const hash = addPages(key, 3)
    const wafers = variantByKey.get('too-yumm-multigrain-chips-60g')
    const reading = readingOf(
      guiltfree.invoice,
      guiltfree.lines,
      variantsById,
      supplierOf(ids.guiltfree),
      {
        invoiceNo: 'GFI/26-27/00489',
        invoiceDate: isoDate(daysAgo(0)),
        pageCount: 3,
        lines: [
          {
            index: 2,
            description: 'TY!WAFERS CHILLI 21.5G(16+5.5)_120',
            supplierCode: null,
            taxablePaise: (guiltfree.lines[2]?.taxablePaise ?? 0) + 400,
          },
          { index: 3, description: 'TY! NEW LAUNCH TANGY TOMATO 55G_48', supplierCode: null },
        ],
      },
    )
    document(key, {
      kind: 'supplier_invoice',
      status: 'needs_review',
      uploadedBy: people.warehouse.id,
      supplierId: ids.guiltfree,
      qrStatus: 'absent',
      contentHash: hash,
      expectedPages: 3,
      capturedAt: atIstTime(TODAY, 8, 40),
      promptProfile: 'guiltfree-dms',
      attemptCount: 1,
      note: 'Too Yumm secondary bill, 3 pages',
      createdAt: atIstTime(TODAY, 8, 41),
      updatedAt: atIstTime(TODAY, 9, 5),
    })
    const first = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.91,
      costPaise: 380,
      latencyMs: 12_100,
      createdAt: atIstTime(TODAY, 8, 43),
    })
    const secondReading: Reading = {
      ...reading,
      lines: reading.lines.map((l, i) =>
        i === 2 ? { ...l, ratePaise: Number(l.ratePaise) - 90 } : l,
      ),
    }
    const second = addExtraction(key, `${key}:secondary`, secondReading, {
      engine: 'llm_vision_secondary',
      model: 'claude-opus-5',
      confidence: 0.93,
      costPaise: 1_120,
      latencyMs: 14_300,
      createdAt: atIstTime(TODAY, 8, 46),
      escalatedFrom: first,
    })
    const reds: CheckOverride[] = [
      {
        check: 'line_arithmetic',
        lineNo: 3,
        severity: 'error',
        detail: {
          expectedTaxablePaise: guiltfree.lines[2]?.taxablePaise ?? 0,
          printedTaxablePaise: (guiltfree.lines[2]?.taxablePaise ?? 0) + 400,
        },
      },
      {
        check: 'sum_lines_equals_subtotal',
        lineNo: null,
        severity: 'error',
        detail: { deltaPaise: 400 },
      },
    ]
    checkRows.push(...checksFor(tenantId, first, `${key}:vision`, reds))
    checkRows.push(...checksFor(tenantId, second, `${key}:secondary`, reds))
    checkRows.push(
      ...checksFor(
        tenantId,
        second,
        `${key}:secondary:review`,
        [
          ...reds,
          {
            check: 'sku_matched',
            lineNo: 3,
            severity: 'error',
            detail: { reason: 'pick the variant' },
          },
          {
            check: 'sku_matched',
            lineNo: 4,
            severity: 'error',
            detail: { reason: 'not in the catalog: propose it, then rerun' },
          },
        ],
        'review',
      ),
    )
    for (const extKey of [`${key}:vision`, `${key}:secondary`]) {
      guiltfree.lines.slice(0, 2).forEach((l, i) => {
        if (l.variantId) green(extKey, i + 1, l.variantId, 'supplier_alias', 0.96 - i * 0.02)
      })
      amber(
        extKey,
        3,
        [
          [variantByKey.get('too-yumm-veggie-stix-70g')?.id ?? '', 0.72],
          [wafers?.id ?? '', 0.66],
          [variantByKey.get('too-yumm-karare-60g')?.id ?? '', 0.61],
        ].filter((p): p is [string, number] => p[0] !== ''),
      )
    }
    disagreementRows.push({
      id: demoId('docint-disagreement', `${tenantId}:${key}:0`),
      tenantId,
      documentId: did(key),
      path: 'lines[2].ratePaise',
      values: {
        llm_vision: reading.lines[2]?.ratePaise ?? null,
        llm_vision_secondary: secondReading.lines[2]?.ratePaise ?? null,
      },
      resolvedValue: reading.lines[2]?.ratePaise ?? null,
      createdAt: atIstTime(TODAY, 8, 47),
    })
    sessionRows.push({
      id: sid(key),
      tenantId,
      documentId: did(key),
      reviewerId: people.manager.id,
      baseExtractionId: second,
      status: 'open',
      reviewed: reviewedOf(
        secondReading,
        ids.guiltfree,
        [guiltfree.lines[0]?.variantId ?? null, guiltfree.lines[1]?.variantId ?? null, null, null],
        null,
      ),
      lockedUntil: daysAhead(30),
      editsCount: 3,
      heartbeatAt: atIstTime(TODAY, 9, 4),
      createdAt: atIstTime(TODAY, 9, 0),
      updatedAt: atIstTime(TODAY, 9, 4),
    })
    const edits: [string, unknown, unknown][] = [
      ['lines[0].batchNo', null, guiltfree.lines[0]?.batchNo ?? 'GF0901'],
      ['lines[1].expiryDate', null, isoDate(daysAhead(180))],
      ['lines[2].caseSize', null, 120],
    ]
    edits.forEach(([path, before, after], i) =>
      correctionRows.push({
        id: demoId('docint-correction', `${tenantId}:${key}:${String(i)}`),
        tenantId,
        reviewSessionId: sid(key),
        path,
        before,
        after,
        createdAt: atIstTime(TODAY, 9, 1 + i),
      }),
    )
  }

  // ---------------------------------------------------------------------------------------------
  // 4. mom-makhana-2 — failed after three attempts: the one place manual typing is allowed
  {
    const key = 'mom-makhana-2'
    const hash = addPages(key, 1)
    document(key, {
      kind: 'supplier_invoice',
      status: 'failed',
      uploadedBy: people.warehouse2.id,
      supplierId: ids.momMakhana,
      qrStatus: 'absent',
      contentHash: hash,
      failureCode: 'extraction_failed',
      attemptCount: 3,
      capturedAt: atIstTime(daysAgo(2), 15, 10),
      promptProfile: 'tally',
      note: 'blurry, photographed in the van',
      createdAt: atIstTime(daysAgo(2), 15, 11),
      updatedAt: atIstTime(daysAgo(2), 15, 40),
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 5. toyumm-dms-1 — a brand-DMS bill (FieldAssist): captured and read, approved through billing later
  if (guiltfree) {
    const key = 'toyumm-dms-1'
    const hash = addPages(key, 1)
    const reading = readingOf(
      guiltfree.invoice,
      guiltfree.lines.slice(0, 2),
      variantsById,
      supplierOf(ids.guiltfree),
      {
        invoiceNo: 'FA/TY/26-27/1187',
        invoiceDate: isoDate(daysAgo(0)),
        pageCount: 1,
      },
    )
    document(key, {
      kind: 'brand_dms_invoice',
      status: 'needs_review',
      uploadedBy: people.manager.id,
      supplierId: ids.guiltfree,
      qrStatus: 'absent',
      contentHash: hash,
      expectedPages: 1,
      capturedAt: atIstTime(TODAY, 7, 55),
      promptProfile: 'brand-dms-secondary',
      attemptCount: 1,
      createdAt: atIstTime(TODAY, 7, 56),
      updatedAt: atIstTime(TODAY, 8, 2),
    })
    const ext = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.94,
      costPaise: 180,
      latencyMs: 6_200,
      createdAt: atIstTime(TODAY, 7, 58),
    })
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision`, []))
    guiltfree.lines.slice(0, 2).forEach((l, i) => {
      if (l.variantId) green(`${key}:vision`, i + 1, l.variantId, 'external_code', 0.97)
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 6. lr-guiltfree-1 — the lorry receipt for the Too Yumm consignment, captured, not yet submitted
  {
    const key = 'lr-guiltfree-1'
    addPages(key, 1)
    document(key, {
      kind: 'lorry_receipt',
      status: 'uploaded',
      uploadedBy: people.warehouse.id,
      supplierId: ids.guiltfree,
      qrStatus: 'absent',
      expectedPages: 1,
      capturedAt: atIstTime(TODAY, 8, 35),
      note: 'LR 44120, 18 packages',
      createdAt: atIstTime(TODAY, 8, 36),
      updatedAt: atIstTime(TODAY, 8, 36),
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 7. pod-ganesh-1 — a proof of delivery the crew captured: a field kind, visible to the field
  {
    const key = 'pod-ganesh-1'
    addPages(key, 1)
    document(key, {
      kind: 'pod',
      status: 'uploaded',
      uploadedBy: people.delivery.ganesh.id,
      qrStatus: 'absent',
      capturedAt: atIstTime(daysAgo(1), 14, 20),
      createdAt: atIstTime(daysAgo(1), 14, 21),
      updatedAt: atIstTime(daysAgo(1), 14, 21),
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 8. alans-2 — needs_review, clean, open session held by the OWNER (the owner service's save/submit)
  if (alans) {
    const key = 'alans-2'
    const hash = addPages(key, 2)
    const reading = readingOf(
      alans.invoice,
      alans.lines,
      variantsById,
      supplierOf(ids.alansFoods),
      {
        invoiceNo: 'ALA/26-27/00491',
        invoiceDate: isoDate(daysAgo(0)),
        pageCount: 2,
      },
    )
    document(key, {
      kind: 'supplier_invoice',
      status: 'needs_review',
      uploadedBy: people.warehouse.id,
      supplierId: ids.alansFoods,
      qrStatus: 'absent',
      contentHash: hash,
      expectedPages: 2,
      capturedAt: atIstTime(TODAY, 9, 30),
      promptProfile: 'tally',
      attemptCount: 1,
      createdAt: atIstTime(TODAY, 9, 31),
      updatedAt: atIstTime(TODAY, 9, 50),
    })
    const ext = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.96,
      costPaise: 260,
      latencyMs: 8_100,
      createdAt: atIstTime(TODAY, 9, 33),
    })
    checkRows.push(
      ...checksFor(tenantId, ext, `${key}:vision`, [
        {
          check: 'hsn_dated_rate',
          lineNo: 2,
          severity: 'warn',
          detail: { printedGstBps: 1200, datedGstBps: 1800 },
        },
      ]),
    )
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision:review`, [], 'review'))
    alans.lines.forEach((l, i) => {
      if (l.variantId) green(`${key}:vision`, i + 1, l.variantId, 'supplier_alias', 0.95 - i * 0.01)
    })
    sessionRows.push({
      id: sid(key),
      tenantId,
      documentId: did(key),
      reviewerId: people.owner.id,
      baseExtractionId: ext,
      status: 'open',
      reviewed: reviewedOf(
        reading,
        ids.alansFoods,
        alans.lines.map((l) => l.variantId),
        isoDate(daysAhead(15)),
      ),
      lockedUntil: daysAhead(30),
      editsCount: 0,
      heartbeatAt: atIstTime(TODAY, 9, 50),
      createdAt: atIstTime(TODAY, 9, 50),
      updatedAt: atIstTime(TODAY, 9, 50),
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 9 + 10. campa-3 / balaji-3 — extracted and clean, nobody reviewing: `review.start` targets
  if (reliance) {
    const key = 'campa-3'
    const hash = addPages(key, 2, { qrOnFirst: true })
    const reading = readingOf(
      reliance.invoice,
      reliance.lines,
      variantsById,
      supplierOf(ids.reliance),
      {
        invoiceNo: 'REL/26-27/00495',
        invoiceDate: isoDate(daysAgo(0)),
        pageCount: 2,
      },
    )
    document(key, {
      kind: 'supplier_invoice',
      status: 'extracted',
      uploadedBy: people.warehouse.id,
      supplierId: ids.reliance,
      qrStatus: 'decoded',
      contentHash: hash,
      expectedPages: 2,
      capturedAt: atIstTime(TODAY, 10, 5),
      promptProfile: 'sap-reliance',
      attemptCount: 1,
      createdAt: atIstTime(TODAY, 10, 6),
      updatedAt: atIstTime(TODAY, 10, 9),
    })
    const ext = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.98,
      costPaise: 290,
      latencyMs: 8_900,
      createdAt: atIstTime(TODAY, 10, 7),
    })
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision`, []))
    reliance.lines.forEach((l, i) => {
      if (l.variantId)
        green(
          `${key}:vision`,
          i + 1,
          l.variantId,
          i === 0 ? 'external_code' : 'supplier_alias',
          0.97,
        )
    })
  }
  if (guruKripa) {
    const key = 'balaji-3'
    const hash = addPages(key, 3)
    const reading = readingOf(
      guruKripa.invoice,
      guruKripa.lines,
      variantsById,
      supplierOf(ids.guruKripa),
      {
        invoiceNo: 'GUR/26-27/00496',
        invoiceDate: isoDate(daysAgo(0)),
        pageCount: 3,
      },
    )
    document(key, {
      kind: 'supplier_invoice',
      status: 'extracted',
      uploadedBy: people.warehouse2.id,
      supplierId: ids.guruKripa,
      qrStatus: 'absent',
      contentHash: hash,
      expectedPages: 3,
      capturedAt: atIstTime(TODAY, 10, 40),
      promptProfile: 'tally',
      attemptCount: 1,
      createdAt: atIstTime(TODAY, 10, 41),
      updatedAt: atIstTime(TODAY, 10, 44),
    })
    const ext = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.97,
      costPaise: 340,
      latencyMs: 10_400,
      createdAt: atIstTime(TODAY, 10, 42),
    })
    checkRows.push(...checksFor(tenantId, ext, `${key}:vision`, []))
    guruKripa.lines.forEach((l, i) => {
      if (l.variantId) green(`${key}:vision`, i + 1, l.variantId, 'supplier_alias', 0.98)
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 11. dup-guru-kripa-1 — the bill of guru-kripa-1 photographed again: the duplicate check fires
  if (guruKripa) {
    const key = 'dup-guru-kripa-1'
    const hash = addPages(key, 4)
    const reading = readingOf(
      guruKripa.invoice,
      guruKripa.lines,
      variantsById,
      supplierOf(ids.guruKripa),
      {
        invoiceNo: guruKripa.invoice.invoiceNo,
        invoiceDate: guruKripa.invoice.invoiceDate,
        pageCount: 4,
      },
    )
    document(key, {
      kind: 'supplier_invoice',
      status: 'needs_review',
      uploadedBy: people.warehouse2.id,
      supplierId: ids.guruKripa,
      qrStatus: 'absent',
      contentHash: hash,
      expectedPages: 4,
      capturedAt: atIstTime(daysAgo(3), 16, 12),
      promptProfile: 'tally',
      attemptCount: 1,
      note: 'second copy found in the van',
      createdAt: atIstTime(daysAgo(3), 16, 13),
      updatedAt: atIstTime(daysAgo(3), 16, 20),
    })
    const ext = addExtraction(key, `${key}:vision`, reading, {
      engine: 'llm_vision',
      model: 'claude-sonnet-5',
      confidence: 0.97,
      costPaise: 400,
      latencyMs: 12_900,
      createdAt: atIstTime(daysAgo(3), 16, 15),
    })
    checkRows.push(
      ...checksFor(tenantId, ext, `${key}:vision`, [
        {
          check: 'duplicate_invoice',
          lineNo: null,
          severity: 'error',
          detail: { supplierInvoiceId: guruKripa.invoice.id, documentId: null },
        },
      ]),
    )
    guruKripa.lines.forEach((l, i) => {
      if (l.variantId) green(`${key}:vision`, i + 1, l.variantId, 'supplier_alias', 0.98)
    })
  }

  // ---------------------------------------------------------------------------------------------
  // supplier aliases: the printed names, as the cascade resolves them
  const aliasRows: (typeof supplierAliases.$inferInsert)[] = []
  const aliasOf = (supplierId: string, alias: string, hits: number, days: number) => {
    const s = supplierById.get(supplierId)
    if (!s) return
    aliasRows.push({
      id: demoId('docint-supplier-alias', `${tenantId}:${alias}`),
      tenantId,
      supplierId,
      alias,
      normalized: alias.toLowerCase().replace(/[^a-z0-9]/g, ''),
      gstin: s.gstin,
      hits,
      lastSeenAt: atIstTime(daysAgo(days), 10, 0),
    })
  }
  aliasOf(ids.reliance, 'RELIANCE CONSUMER PRODUCTS LTD', 31, 9)
  aliasOf(ids.guruKripa, 'GURU KRIPA AGENCIES', 12, 7)
  aliasOf(ids.momMakhana, 'MOM FOODS PVT LTD', 4, 11)
  aliasOf(ids.guiltfree, 'GUILTFREE INDUSTRIES LIMITED', 9, 6)
  aliasOf(ids.alansFoods, "ALAN'S FOOD PRODUCTS", 6, 10)

  // curated external codes and printed descriptions (global, curator-owned; seeded on the owner connection)
  const externalRows: (typeof productExternalCodes.$inferInsert)[] = []
  const productAliasRows: (typeof productAliases.$inferInsert)[] = []
  const external = (system: string, code: string, variantKey: string) => {
    const v = variantByKey.get(variantKey)
    if (!v) return
    externalRows.push({
      id: demoId('external-code', `${system}:${code}`),
      variantId: v.id,
      system,
      code,
    })
  }
  external('reliance', '494607257', 'campa-cola-750ml')
  external('reliance', '494607258', 'campa-orange-750ml')
  external('reliance', '494607301', 'independence-water-1l')
  external('guiltfree', 'TYK60', 'too-yumm-karare-60g')
  external('guiltfree', 'TYMG60', 'too-yumm-multigrain-chips-60g')
  external('guiltfree', 'TYVS70', 'too-yumm-veggie-stix-70g')
  external('guiltfree', 'TYMK20', 'too-yumm-makhana-20g')
  external('fieldassist', 'ERP-TY-60-KAR', 'too-yumm-karare-60g')
  const alias = (variantKey: string, text: string, hits: number) => {
    const v = variantByKey.get(variantKey)
    if (!v) return
    productAliasRows.push({
      id: demoId('product-alias', text),
      variantId: v.id,
      alias: text,
      normalized: text.toLowerCase().replace(/\s+/g, ' ').trim(),
      source: 'docint',
      hits,
    })
  }
  alias('too-yumm-multigrain-chips-60g', 'TY!WAFERS CHILLI 21.5G(16+5.5)_120', 5)
  alias('mom-makhana-himalayan-salt-12g', 'MOM Makhana 12g - Himalayan Salt N Paper x 90', 14)
  alias('mom-makhana-peri-peri-60g', 'MOM MAKHANA PERI PERI 60G X 30', 7)
  alias('independence-water-1l', 'INDEPENDENCE PACKAGED WATER 1L X 12', 11)
  alias('masti-oye-classic-salted-30g', 'MASTI OYE CLASSIC SALTED 30G X 60', 9)
  alias('masti-oye-tomato-twist-30g', 'MASTI OYE TOMATO TWIST 30G X 60', 6)

  // the pack the reviewer remembered on guiltfree-2 (docs/17 B: the second typed number)
  const wafers = variantByKey.get('too-yumm-multigrain-chips-60g')
  if (wafers)
    packRows.push({
      id: pack(ids.guiltfree, wafers.id),
      tenantId,
      supplierId: ids.guiltfree,
      variantId: wafers.id,
      pcsPerCase: 120,
      supplierCode: 'TYMG60',
      supplierDescription: 'TY!WAFERS CHILLI 21.5G(16+5.5)_120',
    })

  await insertMany(db, documents, documentRows)
  await insertMany(db, documentPages, pageRows)
  await insertMany(db, extractions, extractionRows)
  await insertMany(db, extractionChecks, checkRows)
  await insertMany(db, skuMatchCandidates, candidateRows)
  await insertMany(db, reviewSessions, sessionRows)
  await insertMany(db, correctionsLog, correctionRows)
  await insertMany(db, engineDisagreements, disagreementRows)
  await insertMany(db, supplierAliases, aliasRows)
  await insertMany(db, productExternalCodes, externalRows)
  await insertMany(db, productAliases, productAliasRows)
  await insertMany(db, supplierPackConfigs, packRows)

  return { documentIds }
}
