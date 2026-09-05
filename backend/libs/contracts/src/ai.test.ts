import { describe, expect, it } from 'vitest'
import {
  AI_DEFAULT_COVER_DAYS,
  AI_DEFAULT_HORIZON_DAYS,
  AI_MAX_DRAFT_LINES,
  AI_MAX_INTAKE_CHARS,
  AI_MAX_ROUTE_STOPS,
  AI_MAX_VOICE_MS,
  ApplyRoutePlanOutput,
  ConfirmDraftInput,
  ConfirmDraftOutput,
  DraftGetOutput,
  DraftsListInput,
  DraftsListOutput,
  ForecastListInput,
  ForecastListOutput,
  ForecastReceiptSchema,
  ForecastRunInput,
  ForecastRunOutput,
  IntakeTextSourceSchema,
  OrderDraftLineSchema,
  ParseTextInput,
  ParseTextOutput,
  PlanRouteInput,
  PlanRouteOutput,
  RejectDraftInput,
  RejectDraftOutput,
  RoutePlanGetInput,
  RoutePlanGetOutput,
  RoutePlanStopSchema,
  TranscribeVoiceInput,
  TranscribeVoiceOutput,
} from './ai.js'

const KEY = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a10'
const DRAFT_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a11'
const ORDER_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a12'
const RETAILER_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a13'
const VARIANT_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a14'
const TRIP_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a15'
const LINE_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a16'

/** Every output shape of the contract, so a new procedure joins the guarantees below by construction. */
const OUTPUTS = {
  'intake.parseText': ParseTextOutput,
  'intake.transcribe': TranscribeVoiceOutput,
  'drafts.list': DraftsListOutput,
  'drafts.get': DraftGetOutput,
  'drafts.confirm': ConfirmDraftOutput,
  'drafts.reject': RejectDraftOutput,
  'forecast.run': ForecastRunOutput,
  'forecast.list': ForecastListOutput,
  'routing.plan': PlanRouteOutput,
  'routing.get': RoutePlanGetOutput,
  'routing.apply': ApplyRoutePlanOutput,
}

type ZodLike = { _zod: { def: Record<string, unknown> } }

/** Every field name reachable in a schema, however deeply nested (the same walk the docs sampler does). */
function fieldNames(schema: unknown, depth = 0): string[] {
  const def = (schema as Partial<ZodLike> | undefined)?._zod?.def
  if (!def || depth > 12) return []
  const out: string[] = []
  switch (def.type) {
    case 'object':
      for (const [key, child] of Object.entries((def.shape ?? {}) as Record<string, unknown>)) {
        out.push(key, ...fieldNames(child, depth + 1))
      }
      break
    case 'array':
      out.push(...fieldNames(def.element, depth + 1))
      break
    case 'optional':
    case 'nullable':
    case 'default':
    case 'nonoptional':
    case 'readonly':
      out.push(...fieldNames(def.innerType, depth + 1))
      break
    case 'union':
      for (const option of (def.options ?? []) as unknown[])
        out.push(...fieldNames(option, depth + 1))
      break
    case 'pipe':
      out.push(...fieldNames(def.in, depth + 1), ...fieldNames(def.out, depth + 1))
      break
    case 'record':
      out.push(...fieldNames(def.valueType, depth + 1))
      break
    default:
      break
  }
  return out
}

const draftLine = {
  lineNo: 1,
  rawText: '2 case parle-g 20rs',
  status: 'matched',
  variantId: VARIANT_ID,
  variantName: 'Parle-G 20 g',
  packSize: 30,
  qtyPcs: 60,
  cases: 2,
  unit: 'case',
  confidenceBps: 9400,
  candidates: [],
}

const receipt = {
  jobId: null,
  status: 'queued',
  asOfDate: '2026-09-06',
  locationId: null,
  horizonDays: AI_DEFAULT_HORIZON_DAYS,
  queuedAt: '2026-09-06T04:30:00.000Z',
  confidenceBps: null,
  needsHumanConfirmation: true,
}

const planStop = {
  stopId: DRAFT_ID,
  sequence: 1,
  currentSequence: 4,
  retailerId: RETAILER_ID,
  retailerName: 'Shree Ganesh Kirana',
  lat: 19.2403,
  lng: 73.1305,
  distanceM: 1240,
  etaAt: '2026-09-06T04:30:00.000Z',
}

describe('the assistant never decides', () => {
  it('carries a human-confirmation flag that cannot be answered false', () => {
    // `needsHumanConfirmation` is a literal `true` on every advisory shape: the founder's rule is in the
    // wire format, not only in a comment (docs/22 §8, 2026-09-05).
    expect(OrderDraftLineSchema.safeParse(draftLine).success).toBe(true)
    expect(ForecastReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(
      ForecastReceiptSchema.safeParse({ ...receipt, needsHumanConfirmation: false }).success,
    ).toBe(false)
    expect(ForecastRunOutput.safeParse({ item: receipt, created: true }).success).toBe(true)
    expect(
      ForecastRunOutput.safeParse({
        item: { ...receipt, needsHumanConfirmation: false },
        created: true,
      }).success,
    ).toBe(false)
    for (const [name, schema] of Object.entries(OUTPUTS)) {
      expect(fieldNames(schema), `${name} must carry the flag`).toContain('needsHumanConfirmation')
      expect(fieldNames(schema), `${name} must carry a confidence`).toContain('confidenceBps')
    }
  })

  it('never puts a purchase cost or a margin on the wire', () => {
    // docs/22 §9 non-negotiable 1, and the reason the warehouse role may read the reorder list at all.
    const forbidden = /cost|margin|ptd|landed|profit/i
    for (const [name, schema] of Object.entries(OUTPUTS)) {
      const leaked = fieldNames(schema).filter((key) => forbidden.test(key))
      expect(leaked, `${name} leaks a cost field`).toEqual([])
    }
  })

  it('measures every confidence in basis points, never a float', () => {
    // CLAUDE.md and schema/ai.ts: "every confidence is BASIS POINTS — the same rule that keeps money in
    // paise". 94% is 9400; 0.94 is not a confidence, it is a rounding accident waiting to happen.
    expect(OrderDraftLineSchema.safeParse({ ...draftLine, confidenceBps: 0.94 }).success).toBe(
      false,
    )
    expect(OrderDraftLineSchema.safeParse({ ...draftLine, confidenceBps: 10_001 }).success).toBe(
      false,
    )
    expect(OrderDraftLineSchema.safeParse({ ...draftLine, confidenceBps: -1 }).success).toBe(false)
    expect(OrderDraftLineSchema.safeParse({ ...draftLine, confidenceBps: 10_000 }).success).toBe(
      true,
    )
  })
})

describe('intake', () => {
  it('takes a message but never a voice note through the text procedure', () => {
    expect(IntakeTextSourceSchema.safeParse('whatsapp').success).toBe(true)
    expect(IntakeTextSourceSchema.safeParse('text').success).toBe(true)
    expect(IntakeTextSourceSchema.safeParse('voice').success).toBe(false)
  })

  it('needs an idempotency key, a client id and a shop only when the human knows it', () => {
    const base = { idempotencyKey: KEY, id: DRAFT_ID, source: 'whatsapp', text: '2 case parle-g' }
    expect(ParseTextInput.safeParse(base).success).toBe(true)
    expect(ParseTextInput.safeParse({ ...base, retailerId: RETAILER_ID }).success).toBe(true)
    // The inbound WhatsApp row the words came from: one draft per message, ever (a partial unique index).
    expect(ParseTextInput.safeParse({ ...base, inboundMessageId: DRAFT_ID }).success).toBe(true)
    expect(ParseTextInput.safeParse({ ...base, idempotencyKey: undefined }).success).toBe(false)
    expect(ParseTextInput.safeParse({ ...base, id: 'not-a-uuid' }).success).toBe(false)
    expect(ParseTextInput.safeParse({ ...base, text: '   ' }).success).toBe(false)
  })

  it('bounds one intake at a WhatsApp message and one voice note at two minutes', () => {
    const base = { idempotencyKey: KEY, id: DRAFT_ID, source: 'text' }
    expect(
      ParseTextInput.safeParse({ ...base, text: 'x'.repeat(AI_MAX_INTAKE_CHARS) }).success,
    ).toBe(true)
    expect(
      ParseTextInput.safeParse({ ...base, text: 'x'.repeat(AI_MAX_INTAKE_CHARS + 1) }).success,
    ).toBe(false)
    const voice = {
      idempotencyKey: KEY,
      id: DRAFT_ID,
      audioObjectKey: 'tenant/01a0/voice/0192/note.m4a',
    }
    const parsed = TranscribeVoiceInput.safeParse(voice)
    expect(parsed.success && parsed.data.language).toBe('en-IN')
    expect(TranscribeVoiceInput.safeParse({ ...voice, language: 'mr-IN' }).success).toBe(true)
    expect(TranscribeVoiceInput.safeParse({ ...voice, durationMs: AI_MAX_VOICE_MS }).success).toBe(
      true,
    )
    expect(
      TranscribeVoiceInput.safeParse({ ...voice, durationMs: AI_MAX_VOICE_MS + 1 }).success,
    ).toBe(false)
    // The transcript is lifted out of the draft, because the voice screen shows it before anything else.
    expect(fieldNames(TranscribeVoiceOutput)).toContain('transcript')
  })
})

describe('drafts', () => {
  it('reads a query string the way a browser sends one', () => {
    const parsed = DraftsListInput.safeParse({ mine: 'true', limit: '25' })
    expect(parsed.success && parsed.data.mine).toBe(true)
    expect(parsed.success && parsed.data.limit).toBe(25)
    expect(DraftsListInput.parse({}).limit).toBe(50)
    expect(DraftsListInput.safeParse({ limit: 201 }).success).toBe(false)
    expect(DraftsListInput.safeParse({ from: '06/09/2026' }).success).toBe(false)
    expect(DraftsListInput.safeParse({ status: 'expired' }).success).toBe(true)
    expect(DraftsListInput.safeParse({ status: 'failed' }).success).toBe(false)
  })

  it('confirms the lines the human left, not the lines the model produced', () => {
    const line = { id: LINE_ID, variantId: VARIANT_ID, enteredQty: 5, enteredUnit: 'case' }
    const base = { idempotencyKey: KEY, id: DRAFT_ID, orderId: ORDER_ID, lines: [line] }
    expect(ConfirmDraftInput.safeParse(base).success).toBe(true)
    // A line the human ADDED has no draft line behind it; one the model produced points back at its
    // position in the stored array (a JSONB line has no id of its own).
    expect(
      ConfirmDraftInput.safeParse({ ...base, lines: [{ ...line, draftLineNo: null }] }).success,
    ).toBe(true)
    expect(
      ConfirmDraftInput.safeParse({ ...base, lines: [{ ...line, draftLineNo: 3 }] }).success,
    ).toBe(true)
    expect(
      ConfirmDraftInput.safeParse({ ...base, lines: [{ ...line, draftLineNo: 0 }] }).success,
    ).toBe(false)
    // The order id is the client's, and a confirm with no lines is a rejection, not a confirmation.
    expect(ConfirmDraftInput.safeParse({ ...base, orderId: undefined }).success).toBe(false)
    expect(ConfirmDraftInput.safeParse({ ...base, lines: [] }).success).toBe(false)
    expect(
      ConfirmDraftInput.safeParse({
        ...base,
        lines: Array.from({ length: AI_MAX_DRAFT_LINES + 1 }, () => line),
      }).success,
    ).toBe(false)
    expect(
      ConfirmDraftInput.safeParse({ ...base, lines: [{ ...line, enteredQty: 0 }] }).success,
    ).toBe(false)
    // Confirming answers the order itself, so the app never has to fetch it a second time.
    expect(fieldNames(ConfirmDraftOutput)).toContain('order')
  })

  it('always asks why a draft was thrown away', () => {
    const base = { idempotencyKey: KEY, id: DRAFT_ID }
    expect(RejectDraftInput.safeParse({ ...base, reason: 'shop cancelled' }).success).toBe(true)
    expect(RejectDraftInput.safeParse(base).success).toBe(false)
    expect(RejectDraftInput.safeParse({ ...base, reason: '  ' }).success).toBe(false)
  })
})

describe('forecast', () => {
  it('bounds the window a pass may read and the horizon it may claim', () => {
    const base = { idempotencyKey: KEY, id: DRAFT_ID }
    expect(ForecastRunInput.safeParse(base).success).toBe(true)
    expect(ForecastRunInput.safeParse({ ...base, lookbackDays: 90, horizonDays: 14 }).success).toBe(
      true,
    )
    expect(ForecastRunInput.safeParse({ ...base, lookbackDays: 366 }).success).toBe(false)
    expect(ForecastRunInput.safeParse({ ...base, lookbackDays: 6 }).success).toBe(false)
    expect(ForecastRunInput.safeParse({ ...base, horizonDays: 0 }).success).toBe(false)
    expect(ForecastRunInput.safeParse({ ...base, asOfDate: '2026-09-06' }).success).toBe(true)
    expect(ForecastRunInput.safeParse({ ...base, asOfDate: '06-09-2026' }).success).toBe(false)
  })

  it("answers a receipt, and says when today's pass was already queued", () => {
    expect(fieldNames(ForecastRunOutput)).toContain('created')
    // Rows exist per horizon, so a list without one would show a variant once per horizon computed.
    const parsed = ForecastListInput.safeParse({ belowCover: 'true', limit: '10' })
    expect(parsed.success && parsed.data.belowCover).toBe(true)
    expect(parsed.success && parsed.data.limit).toBe(10)
    expect(parsed.success && parsed.data.horizonDays).toBe(AI_DEFAULT_HORIZON_DAYS)
    expect(parsed.success && parsed.data.coverDays).toBe(AI_DEFAULT_COVER_DAYS)
    expect(ForecastListInput.safeParse({ horizonDays: '30' }).success).toBe(true)
    expect(ForecastListInput.safeParse({ horizonDays: 91 }).success).toBe(false)
    // The screen has to be able to say how stale the numbers are.
    expect(fieldNames(ForecastListOutput)).toContain('lastComputedAt')
  })
})

describe('routing', () => {
  it('plans against a trip and carries nothing the plan cannot store', () => {
    expect(
      PlanRouteInput.safeParse({ idempotencyKey: KEY, id: DRAFT_ID, tripId: TRIP_ID }).success,
    ).toBe(true)
    expect(
      PlanRouteInput.safeParse({ idempotencyKey: KEY, id: DRAFT_ID, tripId: 'x' }).success,
    ).toBe(false)
    expect(RoutePlanGetInput.safeParse({ tripId: TRIP_ID }).success).toBe(true)
    // A trip nobody has planned answers null, which is an answer and not an error.
    expect(RoutePlanGetOutput.safeParse({ item: null }).success).toBe(true)
  })

  it('keeps a stop with no shop pin in the plan instead of dropping it', () => {
    expect(RoutePlanStopSchema.safeParse(planStop).success).toBe(true)
    expect(
      RoutePlanStopSchema.safeParse({ ...planStop, lat: null, lng: null, etaAt: null }).success,
    ).toBe(true)
    expect(RoutePlanStopSchema.safeParse({ ...planStop, sequence: 0 }).success).toBe(false)
    expect(RoutePlanStopSchema.safeParse({ ...planStop, lat: 100 }).success).toBe(false)
    expect(RoutePlanStopSchema.safeParse({ ...planStop, distanceM: 1240.5 }).success).toBe(false)
  })

  it('caps a plan at the number of stops delivery will re-sequence', () => {
    expect(AI_MAX_ROUTE_STOPS).toBe(80)
    // Applying answers the trip's stops in their new order, so the app re-renders without a second call.
    expect(fieldNames(ApplyRoutePlanOutput)).toContain('stops')
  })
})
