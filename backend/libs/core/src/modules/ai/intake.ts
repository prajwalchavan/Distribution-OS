import type { AiOrderDraftLine, Db } from '@dos/db'
import { AI_MAX_DRAFT_LINES } from '@dos/contracts'
import {
  createLlmProvider,
  LlmFailure,
  LlmTransientError,
  type LlmProvider,
} from '../../platform/index.js'
import { clampBps } from './ai.internals.js'
import {
  AMBIGUOUS_BPS,
  CLEAR_MARGIN_BPS,
  listingLabels,
  matchFragments,
  MATCH_BPS,
  shopHistory,
  type VariantCandidate,
} from './matcher.js'
import { parseMessage, piecesFor, type EnteredUnit, type ParsedFragment } from './tokenise.js'

/**
 * The intake pipeline, as plain functions so the worker can run it on an inbound WhatsApp message
 * without a Nest container (coordination §3.9 / §13).
 *
 * TWO STAGES, and the split is the whole design:
 *
 *   1. READ THE LANGUAGE. Turn a message into "how many, of what" fragments. The `deterministic`
 *      driver does this with rules (`tokenise.ts`); the `anthropic` driver asks Claude for the same
 *      segmentation as JSON. Both answer the same shape, and a model fault falls straight back to
 *      the rules — a shopkeeper's order is never lost to an outage or an empty API key.
 *   2. DECIDE THE SKU IN THE DATABASE. `matcher.ts` alone maps a phrase to a variant, against THIS
 *      distributor's listing and THIS shop's buying habit. The model never names a SKU: it has no
 *      list of ids and could not be trusted with one. So a model change can never silently start
 *      ordering a different product — the worst it can do is segment a sentence badly, and a human
 *      confirms every line anyway.
 *
 * Nothing here writes a row and nothing here creates an order.
 */

export interface ParsedDraftLines {
  lines: AiOrderDraftLine[]
  /** The draft's own confidence: the mean of its lines, in basis points. */
  matchConfidenceBps: number
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
}

/** How a line reads on the wire, derived from the stored line rather than stored (contract §drafts). */
export type DraftLineStatus = 'matched' | 'ambiguous' | 'unmatched'

export function lineStatus(line: AiOrderDraftLine): DraftLineStatus {
  if (line.variantId) return 'matched'
  return line.candidates.length > 0 ? 'ambiguous' : 'unmatched'
}

/** A draft with an unmatched line, an unnamed shop or a low overall score waits for a human. */
export function draftStatusFor(
  lines: readonly AiOrderDraftLine[],
  retailerId: string | null,
): 'parsed' | 'needs_review' {
  if (!retailerId || lines.length === 0) return 'needs_review'
  return lines.every((line) => lineStatus(line) === 'matched') ? 'parsed' : 'needs_review'
}

const SYSTEM_PROMPT = `You segment Indian FMCG shopkeepers' order messages (WhatsApp, SMS, or a voice note transcribed) into individual order lines and return JSON matching the provided schema EXACTLY.

The messages are written in English, Hindi transliterated into Latin letters (Hinglish), or a mix. Typical: "2 case campa 1L, 10 pc too yumm chilli", "bhai kal do peti coca cola 750ml bhej dena".

Rules:
- One output line per product the shopkeeper asks for, in the order written. A greeting, a thank-you, a delivery instruction or a payment remark is NOT a line: leave it out entirely.
- quantity is the COUNT the shopkeeper said. A number that is part of a pack size ("1L", "750ml", "90g", "20rs") is NOT a quantity. When no count is stated, use 1 and set quantity_stated to false.
- unit is "case" when they said case / peti / carton / box, "inner" for inner / dabba, otherwise "piece". When no unit word appears, use "piece" and set unit_stated to false.
- product is the product words ONLY, with the quantity, the unit and all politeness removed, but the pack size KEPT ("campa 1l", "too yumm chilli 90g"). Copy the shopkeeper's own spelling; do not correct a brand name to what you think it should be, and never invent a product that is not in the message.
- raw_text is the fragment of the original message this line was read from, verbatim.
- Never answer with a product id, a price, a rate or a total. You are reading words, not deciding an order.`

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['raw_text', 'product', 'quantity', 'unit', 'quantity_stated', 'unit_stated'],
        properties: {
          raw_text: { type: 'string' },
          product: { type: 'string' },
          quantity: { type: 'integer' },
          unit: { type: 'string', enum: ['piece', 'inner', 'case'] },
          quantity_stated: { type: 'boolean' },
          unit_stated: { type: 'boolean' },
        },
      },
    },
  },
}

interface WireLine {
  raw_text: string
  product: string
  quantity: number
  unit: EnteredUnit
  quantity_stated: boolean
  unit_stated: boolean
}

/**
 * Read a message into draft lines. `provider` defaults to whatever `llmConfig()` selects, which under
 * `NODE_ENV=test` and with no `ANTHROPIC_API_KEY` is always the deterministic driver.
 */
export async function parseOrderText(
  tx: Db,
  input: { text: string; retailerId: string | null },
  provider: LlmProvider = createLlmProvider(),
): Promise<ParsedDraftLines> {
  const rules = (): ParsedFragment[] => parseMessage(input.text, AI_MAX_DRAFT_LINES)
  // The model is told what this distributor sells so its segmentation splits on real product names
  // rather than on guesses; it still never chooses one — `matchFragments` does that in the database.
  const catalog =
    provider.name === 'anthropic'
      ? await listingLabels(tx, { retailerId: input.retailerId, limit: 60 })
      : []
  let fragments: ParsedFragment[]
  let providerName: string
  let model: string
  let tokensIn: number
  let tokensOut: number
  try {
    const read = await provider.complete<ParsedFragment[]>({
      system: SYSTEM_PROMPT,
      prompt: promptFor(input.text, catalog),
      schema: OUTPUT_SCHEMA,
      effort: 'low',
      fallback: rules,
      parse: (raw) => toFragments(raw),
    })
    fragments = read.value
    providerName = read.deterministic ? 'deterministic' : read.provider
    model = read.model
    tokensIn = read.tokensIn
    tokensOut = read.tokensOut
  } catch (error) {
    // A model fault is never the shopkeeper's problem: the rules answer, and the row records that
    // the deterministic engine read it, so the provenance is honest about what happened.
    if (!(error instanceof LlmFailure) && !(error instanceof LlmTransientError)) throw error
    fragments = rules()
    providerName = 'deterministic'
    model = 'rules/1.0.0'
    // A refused reading costs nothing and is recorded as costing nothing.
    tokensIn = 0
    tokensOut = 0
  }
  if (fragments.length === 0)
    return {
      lines: [],
      matchConfidenceBps: 0,
      provider: providerName,
      model,
      tokensIn,
      tokensOut,
    }

  const candidates = await matchFragments(tx, fragments, { retailerId: input.retailerId })
  const lines = fragments.map((fragment, index) => toDraftLine(fragment, candidates[index] ?? []))
  const total = lines.reduce((sum, line) => sum + line.confidenceBps, 0)
  return {
    lines,
    matchConfidenceBps: clampBps(lines.length === 0 ? 0 : total / lines.length),
    provider: providerName,
    model,
    tokensIn,
    tokensOut,
  }
}

/**
 * One fragment plus its candidates as the stored `parsed_lines` entry. The top candidate is CHOSEN
 * only when it is confident AND clearly ahead of the runner-up; otherwise every candidate is offered
 * and a human picks. That margin is the difference between "the model decided" and "the model
 * suggested", which is the founder's rule in arithmetic form.
 */
export function toDraftLine(
  fragment: ParsedFragment,
  candidates: readonly VariantCandidate[],
): AiOrderDraftLine {
  const best = candidates[0]
  const runnerUp = candidates[1]
  const clear =
    best !== undefined &&
    best.scoreBps >= MATCH_BPS &&
    (runnerUp === undefined || best.scoreBps - runnerUp.scoreBps >= CLEAR_MARGIN_BPS)
  const chosen = clear ? best : undefined
  // Unit: what they said, or — when they said none — a case if the pack size makes that the sane
  // reading of a single number in a wholesale order, which for FMCG it is not: pieces are the safe
  // default, and the reviewer changes it in one tap.
  const unit: EnteredUnit = fragment.unit
  const packSize = chosen?.packSize ?? null
  return {
    text: fragment.rawText,
    variantId: chosen?.variantId ?? null,
    qtyPcs: chosen ? piecesFor(fragment.qty, unit, packSize) : 0,
    cases: unit === 'case' ? fragment.qty : null,
    unit,
    confidenceBps: confidenceFor(fragment, best, clear),
    candidates: candidates
      .filter((c) => c.scoreBps >= AMBIGUOUS_BPS)
      .map((c) => ({ variantId: c.variantId, label: c.label, scoreBps: c.scoreBps })),
  }
}

/**
 * How sure we are of THIS line. The SKU score dominates; a quantity or a unit the shopkeeper never
 * actually stated costs a little, because "1 piece" assumed from silence is a guess even when the
 * product is certain.
 */
function confidenceFor(
  fragment: ParsedFragment,
  best: VariantCandidate | undefined,
  clear: boolean,
): number {
  if (!best) return 0
  let score = clear ? best.scoreBps : Math.min(best.scoreBps, AMBIGUOUS_BPS + 2_000)
  if (!fragment.qtyStated) score -= 500
  if (!fragment.unitStated) score -= 500
  return clampBps(score)
}

function promptFor(text: string, catalog: readonly { label: string }[]): string {
  const lines = ['The shopkeeper wrote:', '', text, '']
  if (catalog.length > 0) {
    lines.push(
      'This distributor stocks these products (for your segmentation only — never answer with one of these strings unless the shopkeeper wrote it):',
    )
    for (const item of catalog) lines.push(`- ${item.label}`)
  }
  return lines.join('\n')
}

/** The model's JSON → the same fragments the rules produce. Throws to reject an unusable answer. */
function toFragments(raw: unknown): ParsedFragment[] {
  const wire = raw as { lines?: WireLine[] }
  if (!Array.isArray(wire.lines)) throw new Error('no lines array')
  const out: ParsedFragment[] = []
  for (const line of wire.lines.slice(0, AI_MAX_DRAFT_LINES)) {
    const product = typeof line.product === 'string' ? line.product.trim() : ''
    if (product.length === 0) continue
    const qty = Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1
    const unit: EnteredUnit =
      line.unit === 'case' || line.unit === 'inner' || line.unit === 'piece' ? line.unit : 'piece'
    out.push({
      rawText:
        typeof line.raw_text === 'string' && line.raw_text.trim() ? line.raw_text.trim() : product,
      phrase: product.toLowerCase(),
      qty,
      unit,
      qtyStated: line.quantity_stated !== false,
      unitStated: line.unit_stated !== false,
    })
  }
  if (out.length === 0) throw new Error('the model found no order lines')
  return out
}

/** Re-export so `intake.service.ts` and the worker share one source of the shop's habit. */
export { shopHistory }
