import {
  ExtractedInvoiceSchema,
  type ExtractedInvoice,
  type ExtractedLine,
  type FieldConfidence,
} from '@dos/contracts'
import { fromRupees, paise } from '@dos/domain'
import { docintConfig, type DocintConfig } from '../config.js'
import { headerPath, linePath } from '../paths.js'
import {
  EngineFailure,
  EngineTransientError,
  type EngineResult,
  type EngineRunInput,
  type ExtractionEngineAdapter,
  type PageImage,
} from '../types.js'

/**
 * The vision engine (docs/05 steps 2–4, brief §4.16): one Messages API request per invoice with every
 * page as an image (or PDF document) block, a cached system prompt, adaptive thinking and a JSON
 * structured output the adapter converts to the pipeline's paise/pieces/bps shape with `fromRupees()`
 * — never `parseFloat * 100`. NEVER AUTO-COMMITS: the reading lands in `extractions.result` and a
 * human reviews it (never-list 6).
 *
 * Raw HTTP against `POST /v1/messages` (`fetch` is global on Node 24): the workspace pins every
 * dependency in its catalog and this slice may not run `pnpm install`, so the official SDK is a
 * follow-up swap — the request body below is exactly the SDK's wire shape (`output_config.format`,
 * `thinking: { type: 'adaptive' }`, no `temperature`, no prefill), so the swap is mechanical.
 *
 * Model: `DOCINT_MODEL` (default `claude-sonnet-5`) for the first reading, `DOCINT_ESCALATION_MODEL`
 * (default `claude-opus-5`) for the second; the ids are used exactly as configured, never
 * date-suffixed. Rate limits, 5xx and network faults are `EngineTransientError` so pg-boss retries;
 * a 4xx, a refusal or a truncated answer is a permanent `EngineFailure` for this attempt.
 */

export const ANTHROPIC_PROMPT_VERSION = 'v1'
export const ANTHROPIC_ENGINE_VERSION = 'anthropic-messages/2023-06-01'
const API_VERSION = '2023-06-01'
/** A 20-page bill streams well inside this; the API's own ceiling is 10 minutes per request. */
const REQUEST_TIMEOUT_MS = 9 * 60_000
const MAX_OUTPUT_TOKENS = 64_000

/**
 * USD per million tokens (input, output) for cost accounting on `extractions.cost_paise`; the exact
 * figures are the founder's alarm surface, not a billing source of truth. Override with
 * `DOCINT_INPUT_USD_PER_MTOK` / `DOCINT_OUTPUT_USD_PER_MTOK`; the rupee rate with `DOCINT_USD_INR`.
 */
const PRICES: Readonly<Record<string, [number, number]>> = {
  'claude-sonnet-5': [2, 10],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-haiku-4-5': [1, 5],
}

const SYSTEM_PROMPT = `You read photographs and PDF scans of Indian FMCG supplier invoices (GST tax invoices from manufacturers, super-stockists and distributors, printed by Tally, SAP, Marg, Busy or a brand DMS) and return their contents as JSON that matches the provided schema EXACTLY.

Rules:
- Copy printed values as printed. Never guess a value that is not on the page: use null.
- Money fields are rupee strings with two decimals ("1234.50"), taken from the printed figures, not recomputed.
- Percentages (gst_pct, cess_pct, discount_pct) are plain numbers as printed (12, 18, 28).
- Quantities: printed_qty and printed_unit exactly as printed ("15", "CS"); qty_pcs is the number of PIECES when the page makes it clear (cases × pack size), else null. case_size is the pack size when printed in the description ("x 90", "_120", "(16+5.5)").
- rate is the printed rate; rate_basis is "case" when the printed rate is per case/carton, else "piece"; basis_qty is the pieces per case when rate_basis is "case", else 1.
- One output line per printed line item, in printed order, with line_no starting at 1. For every line give page_no, the printed row text (row_text) and, when you can, the bounding box of that row as fractions of the page [x0, y0, x1, y1].
- Dates are ISO (YYYY-MM-DD). GSTINs are 15 characters, uppercase.
- handwritten_annotations lists anything written by hand on the page (short quantities, corrected rates, signatures excluded) with the line it refers to; NEVER apply a handwritten change to a printed value.
- confidence values are between 0 and 1 and express how sure you are of THAT field on THIS scan.
- Skip nothing: a blurry or partially visible line is still a line, with low confidence.`

const nullable = (schema: Record<string, unknown>): Record<string, unknown> => ({
  anyOf: [schema, { type: 'null' }],
})
const str = nullable({ type: 'string' })
const num = nullable({ type: 'number' })
const int = nullable({ type: 'integer' })

/** The engine wire schema: rupee strings and percentages, converted to paise/bps by `toReading`. */
export const ENGINE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['header', 'lines', 'handwritten_annotations', 'page_count', 'confidence'],
  properties: {
    header: {
      type: 'object',
      additionalProperties: false,
      required: [
        'supplier_name',
        'supplier_gstin',
        'buyer_name',
        'buyer_gstin',
        'invoice_no',
        'invoice_date',
        'irn',
        'eway_bill_no',
        'place_of_supply_state',
        'subtotal',
        'discount',
        'cgst',
        'sgst',
        'igst',
        'cess',
        'freight',
        'round_off',
        'total',
        'confidence',
      ],
      properties: {
        supplier_name: str,
        supplier_gstin: str,
        buyer_name: str,
        buyer_gstin: str,
        invoice_no: str,
        invoice_date: str,
        irn: str,
        eway_bill_no: str,
        place_of_supply_state: str,
        subtotal: str,
        discount: str,
        cgst: str,
        sgst: str,
        igst: str,
        cess: str,
        freight: str,
        round_off: str,
        total: str,
        confidence: {
          type: 'object',
          additionalProperties: false,
          required: ['invoice_no', 'invoice_date', 'supplier_gstin', 'buyer_gstin', 'total'],
          properties: {
            invoice_no: { type: 'number' },
            invoice_date: { type: 'number' },
            supplier_gstin: { type: 'number' },
            buyer_gstin: { type: 'number' },
            total: { type: 'number' },
          },
        },
      },
    },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'line_no',
          'description',
          'supplier_code',
          'hsn_code',
          'batch_no',
          'mfg_date',
          'expiry_date',
          'mrp',
          'printed_qty',
          'printed_unit',
          'case_size',
          'qty_pcs',
          'free_qty_pcs',
          'rate',
          'rate_basis',
          'basis_qty',
          'discount_pct',
          'discount_amount',
          'gst_pct',
          'cess_pct',
          'taxable',
          'tax',
          'line_total',
          'page_no',
          'row_text',
          'bbox',
          'confidence',
        ],
        properties: {
          line_no: { type: 'integer' },
          description: { type: 'string' },
          supplier_code: str,
          hsn_code: str,
          batch_no: str,
          mfg_date: str,
          expiry_date: str,
          mrp: str,
          printed_qty: int,
          printed_unit: str,
          case_size: int,
          qty_pcs: int,
          free_qty_pcs: int,
          rate: str,
          rate_basis: nullable({ type: 'string', enum: ['piece', 'case'] }),
          basis_qty: int,
          discount_pct: num,
          discount_amount: str,
          gst_pct: num,
          cess_pct: num,
          taxable: str,
          tax: str,
          line_total: str,
          page_no: { type: 'integer' },
          row_text: { type: 'string' },
          bbox: nullable({ type: 'array', items: { type: 'number' } }),
          confidence: {
            type: 'object',
            additionalProperties: false,
            required: ['description', 'qty_pcs', 'rate', 'line_total'],
            properties: {
              description: { type: 'number' },
              qty_pcs: { type: 'number' },
              rate: { type: 'number' },
              line_total: { type: 'number' },
            },
          },
        },
      },
    },
    handwritten_annotations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['page_no', 'text', 'near_line_no', 'suggested_value'],
        properties: {
          page_no: { type: 'integer' },
          text: { type: 'string' },
          near_line_no: int,
          suggested_value: str,
        },
      },
    },
    page_count: { type: 'integer' },
    confidence: { type: 'number' },
  },
}

interface WireLine {
  line_no: number
  description: string
  supplier_code: string | null
  hsn_code: string | null
  batch_no: string | null
  mfg_date: string | null
  expiry_date: string | null
  mrp: string | null
  printed_qty: number | null
  printed_unit: string | null
  case_size: number | null
  qty_pcs: number | null
  free_qty_pcs: number | null
  rate: string | null
  rate_basis: 'piece' | 'case' | null
  basis_qty: number | null
  discount_pct: number | null
  discount_amount: string | null
  gst_pct: number | null
  cess_pct: number | null
  taxable: string | null
  tax: string | null
  line_total: string | null
  page_no: number
  row_text: string
  bbox: number[] | null
  confidence: { description: number; qty_pcs: number; rate: number; line_total: number }
}

interface WireReading {
  header: Record<string, string | null> & {
    confidence: Record<string, number>
  }
  lines: WireLine[]
  handwritten_annotations: {
    page_no: number
    text: string
    near_line_no: number | null
    suggested_value: string | null
  }[]
  page_count: number
  confidence: number
}

const money = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v.trim() === '') return null
  try {
    return fromRupees(v)
  } catch {
    return null
  }
}
const bps = (pct: number | null | undefined): number | null =>
  pct === null || pct === undefined || !Number.isFinite(pct) ? null : Math.round(pct * 100)
const isoDate = (v: string | null | undefined): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null
const clamp01 = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Engine wire JSON → the pipeline's `ExtractedInvoice` (paise, pieces, bps, ISO dates). */
export function toReading(wire: WireReading): ExtractedInvoice {
  const fieldConfidence: FieldConfidence = {}
  const h = wire.header
  for (const [field, value] of Object.entries(h.confidence ?? {})) {
    const path = headerPath(
      {
        invoice_no: 'invoiceNo',
        invoice_date: 'invoiceDate',
        supplier_gstin: 'supplierGstin',
        buyer_gstin: 'buyerGstin',
        total: 'totalPaise',
      }[field] ?? field,
    )
    fieldConfidence[path] = clamp01(value)
  }
  const lines: ExtractedLine[] = wire.lines.map((l, index) => {
    const conf = l.confidence ?? {}
    fieldConfidence[linePath(index, 'description')] = clamp01(conf.description)
    fieldConfidence[linePath(index, 'qtyPcs')] = clamp01(conf.qty_pcs)
    fieldConfidence[linePath(index, 'ratePaise')] = clamp01(conf.rate)
    fieldConfidence[linePath(index, 'lineTotalPaise')] = clamp01(conf.line_total)
    const bbox =
      Array.isArray(l.bbox) && l.bbox.length === 4 && l.bbox.every((n) => typeof n === 'number')
        ? ([l.bbox[0], l.bbox[1], l.bbox[2], l.bbox[3]] as [number, number, number, number])
        : null
    const qtyPcs = intOrNull(l.qty_pcs)
    const freeQty = intOrNull(l.free_qty_pcs)
    const caseSize = intOrNull(l.case_size)
    const basisQty = intOrNull(l.basis_qty)
    return {
      lineNo: Number.isInteger(l.line_no) && l.line_no > 0 ? l.line_no : index + 1,
      description:
        (l.description ?? '').trim() || l.row_text?.trim() || `line ${String(index + 1)}`,
      supplierCode: text(l.supplier_code),
      hsnCode: text(l.hsn_code)?.replace(/\D/g, '') || null,
      batchNo: text(l.batch_no),
      mfgDate: isoDate(l.mfg_date),
      expiryDate: isoDate(l.expiry_date),
      mrpPaise: money(l.mrp),
      printedQty: intOrNull(l.printed_qty),
      printedUnit: text(l.printed_unit),
      caseSize: caseSize !== null && caseSize > 0 ? caseSize : null,
      qtyPcs: qtyPcs !== null && qtyPcs >= 0 ? qtyPcs : null,
      freeQtyPcs: freeQty !== null && freeQty >= 0 ? freeQty : null,
      ratePaise: money(l.rate),
      rateBasis: l.rate_basis === 'case' || l.rate_basis === 'piece' ? l.rate_basis : null,
      basisQty: basisQty !== null && basisQty > 0 ? basisQty : null,
      discountBps: bps(l.discount_pct),
      discountPaise: money(l.discount_amount),
      gstBps: bps(l.gst_pct),
      cessBps: bps(l.cess_pct),
      taxablePaise: money(l.taxable),
      taxPaise: money(l.tax),
      lineTotalPaise: money(l.line_total),
      evidence: {
        pageNo: Number.isInteger(l.page_no) && l.page_no > 0 ? l.page_no : 1,
        rowText: (l.row_text ?? '').trim(),
        bbox,
      },
    }
  })
  const reading: ExtractedInvoice = {
    header: {
      supplierName: text(h.supplier_name),
      supplierGstin: text(h.supplier_gstin)?.toUpperCase() ?? null,
      buyerName: text(h.buyer_name),
      buyerGstin: text(h.buyer_gstin)?.toUpperCase() ?? null,
      invoiceNo: text(h.invoice_no),
      invoiceDate: isoDate(h.invoice_date),
      irn: text(h.irn)?.toLowerCase() ?? null,
      ewayBillNo: text(h.eway_bill_no)?.replace(/\D/g, '') || null,
      placeOfSupplyState: /^\d{2}$/.test(h.place_of_supply_state ?? '')
        ? (h.place_of_supply_state ?? null)
        : null,
      subtotalPaise: money(h.subtotal),
      discountPaise: money(h.discount),
      cgstPaise: money(h.cgst),
      sgstPaise: money(h.sgst),
      igstPaise: money(h.igst),
      cessPaise: money(h.cess),
      freightPaise: money(h.freight),
      roundOffPaise: money(h.round_off),
      totalPaise: money(h.total),
    },
    lines,
    fieldConfidence,
    handwrittenAnnotations: (wire.handwritten_annotations ?? []).map((a, i) => ({
      id: `hw-${String(i + 1)}`,
      pageNo: Number.isInteger(a.page_no) && a.page_no > 0 ? a.page_no : 1,
      text: (a.text ?? '').trim(),
      nearPath:
        typeof a.near_line_no === 'number' && a.near_line_no > 0
          ? linePath(a.near_line_no - 1, 'qtyPcs')
          : null,
      suggestedValue: a.suggested_value ?? null,
      bbox: null,
    })),
    pageCount: Number.isInteger(wire.page_count) ? wire.page_count : lines.length > 0 ? 1 : 0,
  }
  return ExtractedInvoiceSchema.parse(reading)
}

function contentBlocksFor(pages: PageImage[]): Record<string, unknown>[] {
  return pages.flatMap((page) => {
    const data = page.bytes.toString('base64')
    const block =
      page.mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: page.mimeType, data } }
    return [{ type: 'text', text: `Page ${String(page.pageNo)}:` }, block]
  })
}

function userPrompt(input: EngineRunInput): string {
  const h = input.hints
  const lines = [
    `Read every page of this ${h.kind.replace(/_/g, ' ')} (${String(input.pages.length)} page(s)) and return the JSON.`,
    `Prompt profile: ${input.profile}.`,
  ]
  if (h.supplier)
    lines.push(
      `The bill is expected from ${h.supplier.name}${h.supplier.gstin ? ` (GSTIN ${h.supplier.gstin})` : ''}.`,
    )
  lines.push(
    `The buyer should be ${h.buyer.name}${h.buyer.gstin ? ` (GSTIN ${h.buyer.gstin})` : ''}.`,
  )
  if (h.qr)
    lines.push(
      `The e-invoice QR on the bill says: document ${h.qr.docNo} dated ${h.qr.docDt}, ${String(h.qr.itemCnt)} line items, total ₹${(h.qr.totInvValPaise / 100).toFixed(2)}, seller ${h.qr.sellerGstin}.`,
    )
  if (h.catalog.length > 0) {
    lines.push(
      'This supplier has printed these descriptions before (for reference only; copy what is printed on THIS bill):',
    )
    for (const c of h.catalog.slice(0, 40))
      lines.push(
        `- ${c.supplierDescription ?? c.variantName}${c.supplierCode ? ` [code ${c.supplierCode}]` : ''} (HSN ${c.hsnCode}, ${String(c.pcsPerCase)} pcs per case)`,
      )
  }
  if (h.note) lines.push(`Capture note from the warehouse: ${h.note}`)
  return lines.join('\n')
}

interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Parse the SSE stream of a Messages request into the concatenated text and the usage. */
async function readStream(
  body: ReadableStream<Uint8Array>,
): Promise<{ text: string; usage: Usage; stopReason: string | null }> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  let text = ''
  let stopReason: string | null = null
  const usage: Usage = {}
  const handle = (event: string): void => {
    for (const line of event.split('\n')) {
      if (!line.startsWith('data:')) continue
      const json = line.slice(5).trim()
      if (!json || json === '[DONE]') continue
      let parsed: {
        type?: string
        delta?: { type?: string; text?: string; stop_reason?: string }
        message?: { usage?: Usage }
        usage?: Usage
        error?: { type?: string; message?: string }
      }
      try {
        parsed = JSON.parse(json) as typeof parsed
      } catch {
        continue
      }
      if (parsed.type === 'message_start' && parsed.message?.usage)
        Object.assign(usage, parsed.message.usage)
      else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta')
        text += parsed.delta.text ?? ''
      else if (parsed.type === 'message_delta') {
        if (parsed.usage) Object.assign(usage, parsed.usage)
        if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason
      } else if (parsed.type === 'error')
        throw new EngineTransientError(`stream error: ${parsed.error?.message ?? 'unknown'}`)
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n\n')
    while (idx >= 0) {
      handle(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 2)
      idx = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) handle(buffer)
  return { text, usage, stopReason }
}

export function costPaiseFor(
  model: string,
  usage: Usage,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const [inUsd, outUsd] = PRICES[model] ?? [3, 15]
  const inputRate = Number(env.DOCINT_INPUT_USD_PER_MTOK) || inUsd
  const outputRate = Number(env.DOCINT_OUTPUT_USD_PER_MTOK) || outUsd
  const usdInr = Number(env.DOCINT_USD_INR) || 84
  const input =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * 0.1
  const usd =
    (input / 1_000_000) * inputRate + ((usage.output_tokens ?? 0) / 1_000_000) * outputRate
  return paise(Math.round(usd * usdInr * 100))
}

export function createAnthropicEngine(
  config: DocintConfig = docintConfig(),
  fetchImpl: typeof fetch = fetch,
): ExtractionEngineAdapter {
  return {
    name: 'anthropic',
    async run(input: EngineRunInput): Promise<EngineResult> {
      if (!config.anthropicApiKey)
        throw new EngineFailure(
          'not_configured',
          'ANTHROPIC_API_KEY is not set; DOCINT_ENGINE=anthropic cannot run',
        )
      if (input.pages.length === 0)
        throw new EngineFailure('no_pages', 'the document has no pages to read')
      const secondary = input.engine === 'llm_vision_secondary'
      const model = input.model ?? (secondary ? config.escalationModel : config.model)
      const started = Date.now()
      const body = {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: secondary ? 'high' : 'medium',
          format: { type: 'json_schema', schema: ENGINE_OUTPUT_SCHEMA },
        },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [...contentBlocksFor(input.pages), { type: 'text', text: userPrompt(input) }],
          },
        ],
      }
      let response: Response
      try {
        response = await fetchImpl(`${config.anthropicBaseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.anthropicApiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (error) {
        throw new EngineTransientError(`messages request failed: ${String(error)}`, error)
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 500)
        if (
          response.status === 429 ||
          response.status === 408 ||
          response.status === 409 ||
          response.status >= 500
        )
          throw new EngineTransientError(`anthropic ${String(response.status)}: ${detail}`)
        throw new EngineFailure(
          `http_${String(response.status)}`,
          `anthropic ${String(response.status)}: ${detail}`,
        )
      }
      if (!response.body) throw new EngineTransientError('empty response body')
      const { text, usage, stopReason } = await readStream(response.body)
      if (stopReason === 'refusal')
        throw new EngineFailure('refusal', 'the model declined to read this document')
      if (stopReason === 'max_tokens')
        throw new EngineFailure('truncated', 'the reading did not fit in the output budget')
      let wire: WireReading
      try {
        wire = JSON.parse(text) as WireReading
      } catch {
        throw new EngineFailure('bad_json', 'the model did not answer with JSON')
      }
      let result: ExtractedInvoice
      try {
        result = toReading(wire)
      } catch (error) {
        throw new EngineFailure(
          'schema',
          `the reading does not match the docint schema: ${String(error)}`,
        )
      }
      return {
        result,
        engine: secondary ? 'llm_vision_secondary' : 'llm_vision',
        model,
        promptVersion: ANTHROPIC_PROMPT_VERSION,
        engineVersion: ANTHROPIC_ENGINE_VERSION,
        costPaise: costPaiseFor(model, usage),
        latencyMs: Date.now() - started,
        confidence: clamp01(wire.confidence),
      }
    },
  }
}
