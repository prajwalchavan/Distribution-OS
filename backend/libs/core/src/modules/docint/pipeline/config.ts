/**
 * Docint configuration, read from the environment once per call so a spec can flip it with
 * `process.env` and the worker and the services agree on the same defaults (brief §8 env list).
 */
export interface DocintConfig {
  /** `stub` (deterministic, no network) or `anthropic`. */
  engine: 'stub' | 'anthropic'
  /** Vision model for the first reading. The exact id string, never date-suffixed. */
  model: string
  /** Model for the escalated second reading (docs/05 step 7). */
  escalationModel: string
  /** Run the pipeline inside the request (`submit` / `extractions.run`) instead of the worker. */
  inlineJobs: boolean
  /** Review lock TTL; `review.heartbeat` extends by this much. */
  lockTtlSeconds: number
  /** Engine attempts before the document is `failed` and manual typing is allowed. */
  maxAttempts: number
  anthropicApiKey: string | null
  anthropicBaseUrl: string
  /** Optional JWKS (JSON) of the IRP signing keys; without it a QR is `decoded`, never `verified`. */
  irpKeys: string | null
  /** Escalate to the secondary engine automatically when the first reading fails arithmetic. */
  autoEscalate: boolean
}

const truthy = (v: string | undefined): boolean =>
  v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())

export const DEFAULT_DOCINT_MODEL = 'claude-sonnet-5'
export const DEFAULT_DOCINT_ESCALATION_MODEL = 'claude-opus-5'

export function docintConfig(env: NodeJS.ProcessEnv = process.env): DocintConfig {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null
  const isTest = env.NODE_ENV === 'test' || env.VITEST !== undefined
  const requested = env.DOCINT_ENGINE?.trim().toLowerCase()
  const engine: DocintConfig['engine'] =
    requested === 'anthropic' || requested === 'stub'
      ? requested
      : isTest || !apiKey
        ? 'stub'
        : 'anthropic'
  const inline = env.DOCINT_INLINE_JOBS
  return {
    engine,
    model: env.DOCINT_MODEL?.trim() || DEFAULT_DOCINT_MODEL,
    escalationModel: env.DOCINT_ESCALATION_MODEL?.trim() || DEFAULT_DOCINT_ESCALATION_MODEL,
    inlineJobs: inline === undefined ? isTest : truthy(inline),
    lockTtlSeconds: positiveInt(env.DOCINT_LOCK_TTL_SECONDS, 300),
    maxAttempts: positiveInt(env.DOCINT_MAX_ATTEMPTS, 3),
    anthropicApiKey: apiKey,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL?.trim().replace(/\/$/, '') || 'https://api.anthropic.com',
    irpKeys: env.DOCINT_IRP_KEYS?.trim() || null,
    autoEscalate: env.DOCINT_AUTO_ESCALATE === undefined ? true : truthy(env.DOCINT_AUTO_ESCALATE),
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}
