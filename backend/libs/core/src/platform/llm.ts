/**
 * The platform's LLM surface: ONE small interface — `complete()` for structured JSON and
 * `transcribe()` for audio — behind which two drivers sit.
 *
 *   `deterministic`  rule-based, no network, no key. Every request carries the rule-based answer to
 *                    the SAME question as `fallback`, and this driver simply runs it. That is what
 *                    makes `NODE_ENV=test` and `pnpm smoke` truthful: no spec and no smoke probe has
 *                    ever opened a socket, and the answers are stable enough to assert on.
 *   `anthropic`      the Messages API over plain `fetch` (Node 24 has it global), with
 *                    `output_config.format = { type: 'json_schema' }` so the answer parses, adaptive
 *                    thinking, and a cached system prompt. It NEVER replaces the rule-based reading
 *                    silently: on any failure the caller catches `LlmFailure` and falls back, which
 *                    is why `fallback` is required on the request and not optional.
 *
 * WHICH DRIVER RUNS (docs/22 §8, founder 2026-09-05 "AI keys: stub drivers for now"): `deterministic`
 * under `NODE_ENV=test`/vitest, whenever `ANTHROPIC_API_KEY` is empty, or when `AI_ENGINE=deterministic`;
 * `anthropic` only when a key is present and nothing forces the stub. Nothing in the build waits on
 * the key, and turning it on is one line in `backend/.env`.
 *
 * Transcription has no Anthropic endpoint, so `transcribe()` is pluggable: `AI_STT_URL` names an
 * OpenAI-shaped `/audio/transcriptions` multipart endpoint (Whisper, faster-whisper, a self-hosted
 * one — the founder chooses), `AI_STT_MODEL` and `AI_STT_API_KEY` configure it. With no URL set, the
 * deterministic transcriber runs: it decodes the stored object as UTF-8 when the object IS text
 * (which is what the demo data and every spec store) and otherwise synthesises a stable sentence from
 * the request's own hints — the same posture as docint's stub engine, and the reason a voice draft is
 * demonstrable today without an STT bill.
 *
 * Costs and provenance ride back on every result (`provider`, `model`, `tokensIn`, `tokensOut`) so
 * `ai_order_drafts` can record which engine read a shopkeeper's words. No caller ever shows them to
 * a shopkeeper.
 */

/** A permanent fault for this attempt: a 4xx, a refusal, an answer that is not the requested shape. */
export class LlmFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LlmFailure'
  }
}

/** Rate limits, 5xx and network faults: the caller may retry, or fall back to the rule-based answer. */
export class LlmTransientError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LlmTransientError'
  }
}

export interface LlmUsage {
  tokensIn: number
  tokensOut: number
}

export interface LlmResult<T> extends LlmUsage {
  value: T
  provider: LlmProviderName
  model: string
  /** True when the rule-based reading answered — either because that driver runs, or after a fault. */
  deterministic: boolean
  latencyMs: number
}

export interface LlmCompletion<T> {
  /** Cached system prompt: what the model is, what it must and must not do. */
  system: string
  /** The request itself: the shopkeeper's words plus the catalogue the matcher already narrowed. */
  prompt: string
  /** JSON Schema the answer must match, passed straight to `output_config.format`. */
  schema: Record<string, unknown>
  /**
   * The rule-based answer to the same question. REQUIRED, not optional: it is what the deterministic
   * driver returns, and what the anthropic driver falls back to when the API refuses, times out or
   * answers something that does not parse. No request path may depend on the network.
   */
  fallback: () => T | Promise<T>
  /** Validate and normalise the model's JSON. Throw to reject the reading and take the fallback. */
  parse: (raw: unknown) => T
  model?: string
  maxTokens?: number
  /** `low` … `max`; the parser wants a quick, cheap read. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export interface LlmTranscription {
  /** The recording. `null` when the object could not be read — the deterministic driver still answers. */
  bytes: Buffer | null
  mimeType: string
  /** BCP-47 as the app sends it (`en-IN`); the STT endpoint gets the language subtag. */
  language: string
  /**
   * What the deterministic transcriber says when the bytes are not text: a sentence synthesised from
   * these hints, so a demo voice note reads as an order for shop SKUs rather than as lorem ipsum.
   */
  hints?: {
    /** A stable seed (the object key) so the same recording always transcribes the same. */
    seed: string
    /** What this shop bought before: `label` is the phrase a shopkeeper would actually say. */
    catalog?: readonly { label: string; unit?: 'case' | 'piece' }[]
  }
}

export type LlmProviderName = 'deterministic' | 'anthropic'

export interface LlmProvider {
  readonly name: LlmProviderName
  complete<T>(request: LlmCompletion<T>): Promise<LlmResult<T>>
  transcribe(request: LlmTranscription): Promise<LlmResult<string>>
}

export interface LlmConfig {
  engine: LlmProviderName
  /** Parsing model. `claude-sonnet-5` is fast and cheap enough to read a WhatsApp line. */
  model: string
  anthropicApiKey: string | null
  anthropicBaseUrl: string
  /** OpenAI-shaped multipart `/audio/transcriptions` endpoint; unset means the deterministic one. */
  sttUrl: string | null
  sttModel: string
  sttApiKey: string | null
  requestTimeoutMs: number
  maxOutputTokens: number
}

export const DEFAULT_AI_MODEL = 'claude-sonnet-5'
export const DEFAULT_AI_STT_MODEL = 'whisper-1'
const API_VERSION = '2023-06-01'

export function llmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null
  const isTest = env.NODE_ENV === 'test' || env.VITEST !== undefined
  const requested = env.AI_ENGINE?.trim().toLowerCase()
  const engine: LlmProviderName =
    requested === 'anthropic' || requested === 'deterministic'
      ? requested
      : isTest || !apiKey
        ? 'deterministic'
        : 'anthropic'
  return {
    engine,
    model: env.AI_MODEL?.trim() || DEFAULT_AI_MODEL,
    anthropicApiKey: apiKey,
    anthropicBaseUrl:
      env.ANTHROPIC_BASE_URL?.trim().replace(/\/$/, '') || 'https://api.anthropic.com',
    // A spec or a smoke run must never reach an STT endpoint even if one is configured on the machine.
    sttUrl: isTest ? null : env.AI_STT_URL?.trim() || null,
    sttModel: env.AI_STT_MODEL?.trim() || DEFAULT_AI_STT_MODEL,
    sttApiKey: env.AI_STT_API_KEY?.trim() || null,
    requestTimeoutMs: positiveInt(env.AI_REQUEST_TIMEOUT_MS, 60_000),
    maxOutputTokens: positiveInt(env.AI_MAX_OUTPUT_TOKENS, 8_192),
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** The driver `llmConfig()` selects. Pass a config (and a `fetch`) to pin one in a spec. */
export function createLlmProvider(
  config: LlmConfig = llmConfig(),
  fetchImpl: typeof fetch = fetch,
): LlmProvider {
  return config.engine === 'anthropic' && config.anthropicApiKey
    ? createAnthropicLlm(config, fetchImpl)
    : createDeterministicLlm(config, fetchImpl)
}

// ---------------------------------------------------------------------------------------------------------------
// deterministic

/**
 * Scripted transcripts, by object key. A spec calls this before `intake.transcribe` to say exactly
 * what the recording contains, the way docint's `registerStubReading` scripts a bill.
 */
const transcripts = new Map<string, string>()

export function registerStubTranscript(objectKey: string, text: string): void {
  transcripts.set(objectKey, text)
}

export function clearStubTranscripts(): void {
  transcripts.clear()
}

export function createDeterministicLlm(
  config: LlmConfig = llmConfig(),
  fetchImpl: typeof fetch = fetch,
): LlmProvider {
  return {
    name: 'deterministic',
    async complete<T>(request: LlmCompletion<T>): Promise<LlmResult<T>> {
      const started = Date.now()
      const value = await request.fallback()
      return {
        value,
        provider: 'deterministic',
        model: 'rules/1.0.0',
        deterministic: true,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
      }
    },
    async transcribe(request: LlmTranscription): Promise<LlmResult<string>> {
      const started = Date.now()
      if (config.sttUrl) {
        try {
          return await postToStt(config, fetchImpl, request, started)
        } catch (error) {
          if (!(error instanceof LlmTransientError)) throw error
          // A configured endpoint that is down must not lose the shopkeeper's words: fall through.
        }
      }
      return {
        value: stubTranscript(request),
        provider: 'deterministic',
        model: 'rules/1.0.0',
        deterministic: true,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
      }
    },
  }
}

/**
 * The rule-based transcript, in order of honesty: a transcript a spec scripted; the object's own
 * bytes when they are UTF-8 text (the demo voice notes and every fixture are text files, deliberately);
 * otherwise a sentence built from what this shop actually buys, seeded by the object key so the same
 * recording always reads the same. It is a STUB and says so — the row records `provider = deterministic`.
 */
export function stubTranscript(request: LlmTranscription): string {
  const seed = request.hints?.seed ?? ''
  const scripted = transcripts.get(seed)
  if (scripted) return scripted
  if (request.bytes && looksLikeText(request.bytes)) return request.bytes.toString('utf8').trim()
  const catalog = request.hints?.catalog ?? []
  if (catalog.length === 0) return 'do case cola aur ek case namkeen bhej dena'
  const n = hashInt(seed)
  const picks = [catalog[n % catalog.length], catalog[(n >> 3) % catalog.length]].filter(
    (c, i, all): c is { label: string; unit?: 'case' | 'piece' } =>
      c !== undefined && all.findIndex((o) => o?.label === c.label) === i,
  )
  const words = ['ek', 'do', 'teen', 'char']
  return picks
    .map((pick, i) => {
      const qty = words[(n >> (i * 5)) % words.length] ?? 'do'
      const unit = pick.unit === 'piece' ? 'piece' : 'case'
      return `${qty} ${unit} ${pick.label}`
    })
    .join(' aur ')
}

/** UTF-8 text with no control bytes: what a fixture or a demo voice note is. */
function looksLikeText(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.length > 64 * 1024) return false
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13) continue
    if (byte < 32) return false
  }
  return true
}

function hashInt(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

// ---------------------------------------------------------------------------------------------------------------
// anthropic

/**
 * `POST /v1/messages` with a JSON-schema output format, adaptive thinking and a cached system prompt.
 * Raw HTTP rather than the SDK for exactly the reason docint's engine gives: this workspace pins every
 * dependency in `pnpm-workspace.yaml`'s catalog and this slice may not run `pnpm install`, so the
 * official SDK is a mechanical follow-up swap — the body below is its wire shape.
 */
export function createAnthropicLlm(
  config: LlmConfig = llmConfig(),
  fetchImpl: typeof fetch = fetch,
): LlmProvider {
  const stub = createDeterministicLlm(config, fetchImpl)
  return {
    name: 'anthropic',
    async complete<T>(request: LlmCompletion<T>): Promise<LlmResult<T>> {
      if (!config.anthropicApiKey)
        throw new LlmFailure('not_configured', 'ANTHROPIC_API_KEY is not set')
      const started = Date.now()
      const model = request.model ?? config.model
      const body = {
        model,
        max_tokens: request.maxTokens ?? config.maxOutputTokens,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: request.effort ?? 'low',
          format: { type: 'json_schema', schema: request.schema },
        },
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }],
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
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        })
      } catch (error) {
        throw new LlmTransientError(`messages request failed: ${String(error)}`, error)
      }
      const payload = await readMessage(response)
      let value: T
      try {
        value = request.parse(JSON.parse(payload.text))
      } catch (error) {
        throw new LlmFailure('bad_json', `the model did not answer the schema: ${String(error)}`)
      }
      return {
        value,
        provider: 'anthropic',
        model,
        deterministic: false,
        tokensIn: payload.tokensIn,
        tokensOut: payload.tokensOut,
        latencyMs: Date.now() - started,
      }
    },
    transcribe: (request) => stub.transcribe(request),
  }
}

interface MessagePayload {
  text: string
  tokensIn: number
  tokensOut: number
}

async function readMessage(response: Response): Promise<MessagePayload> {
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    if (response.status === 429 || response.status === 408 || response.status >= 500)
      throw new LlmTransientError(`anthropic ${String(response.status)}: ${detail}`)
    throw new LlmFailure(
      `http_${String(response.status)}`,
      `anthropic ${String(response.status)}: ${detail}`,
    )
  }
  let json: {
    content?: { type?: string; text?: string }[]
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  try {
    json = (await response.json()) as typeof json
  } catch (error) {
    throw new LlmTransientError(`could not read the response body: ${String(error)}`, error)
  }
  if (json.stop_reason === 'refusal')
    throw new LlmFailure('refusal', 'the model declined to read this message')
  if (json.stop_reason === 'max_tokens')
    throw new LlmFailure('truncated', 'the answer did not fit in the output budget')
  const text = (json.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
  if (!text.trim()) throw new LlmFailure('empty', 'the model answered nothing')
  return {
    text,
    tokensIn: json.usage?.input_tokens ?? 0,
    tokensOut: json.usage?.output_tokens ?? 0,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// speech to text

/** OpenAI-shaped multipart `/audio/transcriptions`: the shape every self-hosted Whisper serves. */
async function postToStt(
  config: LlmConfig,
  fetchImpl: typeof fetch,
  request: LlmTranscription,
  started: number,
): Promise<LlmResult<string>> {
  if (!request.bytes) throw new LlmTransientError('no audio bytes to transcribe')
  const form = new FormData()
  form.append('model', config.sttModel)
  form.append('language', request.language.split('-')[0] ?? 'en')
  form.append(
    'file',
    new Blob([new Uint8Array(request.bytes)], { type: request.mimeType }),
    'audio',
  )
  let response: Response
  try {
    response = await fetchImpl(config.sttUrl as string, {
      method: 'POST',
      headers: config.sttApiKey ? { authorization: `Bearer ${config.sttApiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
  } catch (error) {
    throw new LlmTransientError(`transcription request failed: ${String(error)}`, error)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new LlmTransientError(`stt ${String(response.status)}: ${detail}`)
  }
  const json = (await response.json().catch(() => null)) as { text?: string } | null
  const text = json?.text?.trim()
  if (!text) throw new LlmTransientError('the transcription endpoint answered no text')
  return {
    value: text,
    provider: 'deterministic',
    model: config.sttModel,
    deterministic: false,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: Date.now() - started,
  }
}
