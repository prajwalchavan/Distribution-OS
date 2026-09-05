import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  ExtractedInvoiceSchema,
  type ExtractedInvoice,
  type ExtractedLine,
  type FieldConfidence,
} from '@dos/contracts'
import { businessDate, paise, percentOf, roundToRupee, splitGst } from '@dos/domain'
import { docintConfig } from '../config.js'
import { headerPath, linePath } from '../paths.js'
import type {
  CatalogHint,
  EngineHints,
  EngineResult,
  EngineRunInput,
  ExtractionEngineAdapter,
} from '../types.js'

/**
 * The deterministic engine (brief §4.15): used by every spec and whenever `ANTHROPIC_API_KEY` is empty
 * or `DOCINT_ENGINE=stub`. NO SPEC EVER CALLS THE NETWORK. Three sources, first hit wins:
 *
 *  1. a reading registered in-process (`registerStubReading`) under the document's content hash —
 *     what specs do to script exactly the arithmetic faults and match tiers they assert on;
 *  2. a fixture file `docs/fixtures/docint/<contentHash>.json` (or `<sha1 of the hash>`), so a local
 *     demo can re-run a seeded document without the network;
 *  3. a plausible invoice SYNTHESISED from the hints: the supplier, the buyer, the QR when there is
 *     one, and the descriptions this supplier printed before (`supplier_pack_configs` → the catalog).
 *     Every number is derived from the content hash, so the same document always reads the same.
 *
 * The synthesised reading is internally consistent (line arithmetic, subtotal, tax split, total
 * rounded to the rupee) and deliberately leaves the LAST line a little fuzzy — a shortened
 * description — so the SKU cascade has an amber to show; a document with no catalog hints reads as
 * two generic lines that match nothing (red), which is the "create product, then rerun" case.
 */

export const STUB_PROMPT_VERSION = 'stub-v1'
export const STUB_ENGINE_VERSION = 'stub/1.0.0'

const registry = new Map<string, { result: ExtractedInvoice; confidence: number }>()

/** Script the next reading of a document (by content hash). Specs call this before `submit`. */
export function registerStubReading(
  contentHash: string,
  result: ExtractedInvoice,
  confidence = 0.97,
): void {
  registry.set(contentHash, { result: ExtractedInvoiceSchema.parse(result), confidence })
}

export function clearStubReadings(): void {
  registry.clear()
}

function workspaceRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir)
  for (let hop = 0; hop < 12; hop++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(startDir)
}

/** `docs/fixtures/docint/` at the repo root, or `DOCINT_FIXTURES_DIR`. */
export function fixturesDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DOCINT_FIXTURES_DIR?.trim()
  if (configured) return resolve(configured)
  return join(workspaceRoot(), '..', 'docs', 'fixtures', 'docint')
}

function fixtureFor(contentHash: string | null): { result: ExtractedInvoice; confidence: number } | null {
  if (!contentHash) return null
  const dir = fixturesDir()
  for (const name of [contentHash, createHash('sha1').update(contentHash).digest('hex')]) {
    const file = join(dir, `${name}.json`)
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        reading?: unknown
        confidence?: unknown
      }
      const parsed = ExtractedInvoiceSchema.safeParse(raw.reading ?? raw)
      if (parsed.success)
        return {
          result: parsed.data,
          confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.96,
        }
    } catch {
      // an unreadable fixture is ignored; the reading is synthesised instead
    }
  }
  return null
}

/** mulberry32 seeded from a string, so a reading is a pure function of the document. */
function rng(seed: string): () => number {
  let s = 0
  for (let i = 0; i < seed.length; i++) s = (Math.imul(s, 31) + seed.charCodeAt(i)) | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FALLBACK_LINE: CatalogHint = {
  variantId: '',
  variantName: 'Namkeen Mix 200 g',
  productName: 'Namkeen Mix',
  brandName: null,
  supplierCode: 'NM200',
  supplierDescription: 'NAMKEEN MIX 200G X 24',
  hsnCode: '2106',
  mrpPaise: 6000,
  pcsPerCase: 24,
  gstBps: 1200,
  cessBps: 0,
}

const GENERIC_LINES: CatalogHint[] = [
  FALLBACK_LINE,
  {
    variantId: '',
    variantName: 'Aerated Drink 600 ml',
    productName: 'Aerated Drink',
    brandName: null,
    supplierCode: 'AD600',
    supplierDescription: 'AERATED DRINK PET 600ML X 24',
    hsnCode: '2202',
    mrpPaise: 4000,
    pcsPerCase: 24,
    gstBps: 2800,
    cessBps: 1200,
  },
]

/** Shorten a printed description the way a second supplier prints the same product ("... X 24" → no pack). */
function fuzz(description: string): string {
  return description
    .replace(/\s*[xX]\s*\d{1,4}\s*$/, '')
    .replace(/_\d{1,4}\s*$/, '')
    .replace(/\bPET\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function synthesise(hints: EngineHints, pageCount: number): { result: ExtractedInvoice; confidence: number } {
  const seed = hints.contentHash ?? hints.documentId
  const random = rng(seed)
  const catalog = hints.catalog.length > 0 ? hints.catalog.slice(0, 6) : GENERIC_LINES
  const lineCount = hints.qr ? Math.max(1, Math.min(hints.qr.itemCnt, 12)) : catalog.length
  const supplierState = hints.supplier?.stateCode ?? hints.supplier?.gstin?.slice(0, 2) ?? '27'
  const buyerState = hints.buyer.stateCode ?? hints.buyer.gstin?.slice(0, 2) ?? '27'
  const today = businessDate()
  const invoiceDate = hints.qr?.docDt ?? today.date
  const fieldConfidence: FieldConfidence = {}
  const lines: ExtractedLine[] = []
  let subtotal = 0
  let cgst = 0
  let sgst = 0
  let igst = 0
  let cess = 0
  for (let i = 0; i < lineCount; i++) {
    const hint = catalog[i % catalog.length] ?? FALLBACK_LINE
    const pcsPerCase = Math.max(1, hint.pcsPerCase)
    const cases = 2 + Math.floor(random() * 5)
    const qtyPcs = cases * pcsPerCase
    // Buy rate ≈ 72 % of MRP per piece, printed per case (docs/17 A4: the rate is stored as printed).
    const perPiece = hint.mrpPaise ? Math.round(hint.mrpPaise * 0.72) : 1000 + Math.floor(random() * 4000)
    const ratePaise = perPiece * pcsPerCase
    const taxable = paise(ratePaise * cases)
    const gstBps = hint.gstBps ?? 1200
    const cessBps = hint.cessBps ?? 0
    const gst = splitGst(taxable, gstBps, supplierState, buyerState)
    const cessAmt = percentOf(taxable, cessBps)
    const tax = paise(gst.tax + cessAmt)
    const last = i === lineCount - 1 && lineCount > 1 && hints.catalog.length > 0
    const printed = hint.supplierDescription ?? hint.variantName.toUpperCase()
    const description = last ? fuzz(printed) : printed
    const line: ExtractedLine = {
      lineNo: i + 1,
      description,
      supplierCode: last ? null : hint.supplierCode,
      hsnCode: hint.hsnCode,
      batchNo: `B${invoiceDate.replace(/-/g, '').slice(2)}${String(i + 1).padStart(2, '0')}`,
      mfgDate: shiftDate(invoiceDate, -20 - i * 3),
      expiryDate: shiftDate(invoiceDate, 150 + i * 30),
      mrpPaise: hint.mrpPaise,
      printedQty: cases,
      printedUnit: 'case',
      caseSize: pcsPerCase,
      qtyPcs,
      freeQtyPcs: 0,
      ratePaise,
      rateBasis: 'case',
      basisQty: pcsPerCase,
      discountBps: 0,
      discountPaise: 0,
      gstBps,
      cessBps,
      taxablePaise: taxable,
      taxPaise: tax,
      lineTotalPaise: paise(taxable + tax),
      evidence: {
        pageNo: 1 + Math.floor((i / Math.max(1, lineCount)) * Math.max(1, pageCount)),
        rowText: `${String(i + 1)} ${description} ${String(cases)} CS ${(ratePaise / 100).toFixed(2)} ${(taxable / 100).toFixed(2)}`,
        bbox: [0.05, 0.3 + i * 0.05, 0.95, 0.34 + i * 0.05],
      },
    }
    lines.push(line)
    subtotal += taxable
    cgst += gst.cgst
    sgst += gst.sgst
    igst += gst.igst
    cess += cessAmt
    for (const field of ['description', 'qtyPcs', 'ratePaise', 'lineTotalPaise', 'hsnCode', 'batchNo'])
      fieldConfidence[linePath(i, field)] = round2(0.86 + random() * 0.13 - (last && field === 'description' ? 0.2 : 0))
  }
  const freightBase = 0
  const beforeRounding = paise(subtotal + cgst + sgst + igst + cess + freightBase)
  const { rounded, roundOff } = roundToRupee(beforeRounding)
  let freight = freightBase
  let total = rounded
  // A QR total within ₹500 of the reading is honoured by declaring the difference as freight, the
  // way a supplier prints transport below the tax lines; a bigger gap stays a red `qr_total`.
  if (hints.qr && hints.qr.totInvValPaise > rounded && hints.qr.totInvValPaise - rounded <= 50_000) {
    freight = hints.qr.totInvValPaise - rounded
    total = hints.qr.totInvValPaise
  }
  const supplierName = hints.supplier?.name ?? 'Unknown supplier (printed name unreadable)'
  const invoiceNo =
    hints.qr?.docNo ?? `${supplierName.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase() || 'INV'}/${today.year}-${String((today.year + 1) % 100).padStart(2, '0')}/${String(1000 + Math.floor(random() * 8999))}`
  for (const field of ['invoiceNo', 'invoiceDate', 'supplierGstin', 'buyerGstin', 'totalPaise', 'subtotalPaise'])
    fieldConfidence[headerPath(field)] = round2(0.9 + random() * 0.09)
  const result: ExtractedInvoice = {
    header: {
      supplierName,
      supplierGstin: hints.qr?.sellerGstin ?? hints.supplier?.gstin ?? null,
      buyerName: hints.buyer.name,
      buyerGstin: hints.qr?.buyerGstin ?? hints.buyer.gstin,
      invoiceNo,
      invoiceDate,
      irn: hints.qr?.irn ?? null,
      ewayBillNo: null,
      placeOfSupplyState: buyerState,
      subtotalPaise: paise(subtotal),
      discountPaise: 0,
      cgstPaise: paise(cgst),
      sgstPaise: paise(sgst),
      igstPaise: paise(igst),
      cessPaise: paise(cess),
      freightPaise: paise(freight),
      roundOffPaise: roundOff,
      totalPaise: total,
    },
    lines,
    fieldConfidence,
    handwrittenAnnotations: /short|damage|less/i.test(hints.note ?? '')
      ? [
          {
            id: 'hw-1',
            pageNo: 1,
            text: hints.note ?? '',
            nearPath: linePath(0, 'qtyPcs'),
            suggestedValue: null,
            bbox: null,
          },
        ]
      : [],
    pageCount,
  }
  return { result: ExtractedInvoiceSchema.parse(result), confidence: round2(0.9 + random() * 0.09) }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

function shiftDate(isoDate: string, days: number): string {
  const at = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  )
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10)
}

export function createStubEngine(): ExtractionEngineAdapter {
  return {
    name: 'stub',
    async run(input: EngineRunInput): Promise<EngineResult> {
      const started = Date.now()
      const hash = input.hints.contentHash
      const scripted = (hash && registry.get(hash)) || fixtureFor(hash)
      const { result, confidence } = scripted ?? synthesise(input.hints, input.pages.length)
      const config = docintConfig()
      const secondary = input.engine === 'llm_vision_secondary'
      return {
        result,
        engine: secondary ? 'llm_vision_secondary' : 'llm_vision',
        // The model NAME is the one the config would have called, so seeded rows, specs and a real
        // run agree on it; `engineVersion` / `promptVersion` are what mark a reading as synthetic.
        model: input.model ?? (secondary ? config.escalationModel : config.model),
        promptVersion: STUB_PROMPT_VERSION,
        engineVersion: STUB_ENGINE_VERSION,
        costPaise: 0,
        latencyMs: Math.max(1, Date.now() - started),
        confidence,
      }
    },
  }
}
