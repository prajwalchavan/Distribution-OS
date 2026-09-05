/**
 * Module configuration, read from the environment on every call so a spec can flip it with
 * `process.env` and the worker and the services agree on the same defaults. The same shape docint
 * uses (`pipeline/config.ts`), for the same reason.
 */
export interface AiConfig {
  /**
   * Run the forecast pass inside the request instead of the worker. True under `NODE_ENV=test` so a
   * spec can assert on the numbers without a pg-boss process; false everywhere else, because ninety
   * days of ledger history is not request-path work (docs/20 rule 3).
   */
  inlineJobs: boolean
  /** Days of history the daily pass reads unless the tenant's setting says otherwise. */
  lookbackDays: number
  /** Horizons the worker's DAILY sweep computes for every tenant. */
  horizons: number[]
}

const truthy = (v: string | undefined): boolean =>
  v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())

export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const isTest = env.NODE_ENV === 'test' || env.VITEST !== undefined
  const inline = env.AI_INLINE_JOBS
  const horizons = (env.AI_FORECAST_HORIZONS ?? '14,30')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 90)
  return {
    inlineJobs: inline === undefined ? isTest : truthy(inline),
    lookbackDays: positiveInt(env.AI_FORECAST_LOOKBACK_DAYS, 90),
    horizons: horizons.length > 0 ? horizons : [14, 30],
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}
