/**
 * WHAT A SERVICE WRITES TO ITS LOG WHEN A CALL FAILS (DOS-429; blind check of the shopkeeper's sign-up, B1).
 *
 * oRPC's `onError` hands over the error as thrown. A request that fails its input schema is an `ORPCError`
 * ('BAD_REQUEST', "Input validation failed") whose `cause` is a `ValidationError` carrying the WHOLE INPUT as
 * `data`: printed as it is, a sign-up whose username has a space in it put the person's chosen password, their
 * number and their name into the server's log in clear. An output that fails its schema carries the whole reply the
 * same way, and a business refusal's `data` can name a shop.
 *
 * So nothing a caller SENT is ever logged, and nothing a refusal answers beyond its words:
 *  - a refusal (an `ORPCError` below 500, which the caller was answered in words) is one line — status, code,
 *    message and, for a schema refusal, the field paths with the schema's own message for each. No values.
 *  - a failure (500 and anything that is not an `ORPCError`) keeps its stack for whoever debugs it, and its `data`
 *    with every value under a key that names a secret replaced; a `ValidationError`'s `data` (the input or the
 *    output, whole) is never printed at all, only its issues' paths and messages.
 */

/** A key whose value is never written to a log: passwords, tokens, keys, codes that prove who someone is. */
const SECRET_KEY =
  /pass(word)?|secret|token|api[-_]?key|private[-_]?key|otp|^pin$|authorization|cookie|signature|credential/i

const REDACTED = '[redacted]'
const MAX_DEPTH = 4
const MAX_ISSUES = 10

interface ErrorLike {
  name?: unknown
  message?: unknown
  stack?: unknown
  code?: unknown
  status?: unknown
  data?: unknown
  cause?: unknown
  issues?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** An `ORPCError` or anything shaped like one: a string code and a numeric HTTP status. */
function orpcStatus(error: unknown): number | null {
  if (!isObject(error)) return null
  const e = error as ErrorLike
  return typeof e.code === 'string' && typeof e.status === 'number' ? e.status : null
}

/** A schema's issues as `path: message` — the field and the rule it broke, never the value that broke it. */
function issueLines(issues: unknown): string[] {
  if (!Array.isArray(issues)) return []
  return issues.slice(0, MAX_ISSUES).map((raw: unknown) => {
    const issue = isObject(raw) ? raw : {}
    const path = Array.isArray(issue.path)
      ? issue.path
          .map((p: unknown) =>
            isObject(p) && 'key' in p ? String(p.key as string) : String(p as string),
          )
          .join('.')
      : ''
    const message = typeof issue.message === 'string' ? issue.message : 'invalid'
    return path === '' ? message : `${path}: ${message}`
  })
}

/** The issues a refusal or its `ValidationError` cause carry, wherever oRPC put them. */
function issuesOf(error: ErrorLike): string[] {
  const own = issueLines(error.issues)
  if (own.length > 0) return own
  if (isObject(error.data)) {
    const fromData = issueLines(error.data.issues)
    if (fromData.length > 0) return fromData
  }
  return isObject(error.cause) ? issueLines((error.cause as ErrorLike).issues) : []
}

/** A deep copy of `value` with every value under a secret-naming key replaced, bounded in depth and size. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (!isObject(value)) return value
  if (depth >= MAX_DEPTH) return '[…]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactSecrets(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redactSecrets(inner, depth + 1)
  }
  return out
}

/**
 * What of a FAILURE may be logged: name, code, status, message, stack, the issues' paths and messages, `data` with
 * its secrets replaced — except a `ValidationError`'s `data`, which is the caller's input or the whole reply and is
 * dropped — and the same for its cause.
 */
export function describeFailure(error: unknown, depth = 0): unknown {
  if (!isObject(error)) return error
  const e = error as ErrorLike
  const out: Record<string, unknown> = {}
  if (typeof e.name === 'string') out.name = e.name
  if (typeof e.code === 'string') out.code = e.code
  if (typeof e.status === 'number') out.status = e.status
  if (typeof e.message === 'string') out.message = e.message
  const issues = issueLines(e.issues)
  if (issues.length > 0) out.issues = issues
  // A ValidationError's data is what was validated: the request's input or the handler's reply, whole.
  if (e.data !== undefined && !Array.isArray(e.issues)) {
    const data = isObject(e.data) && 'issues' in e.data ? { ...e.data, issues: undefined } : e.data
    const kept = redactSecrets(data)
    if (!(isObject(kept) && Object.values(kept).every((v) => v === undefined))) out.data = kept
  }
  if (typeof e.stack === 'string') out.stack = e.stack
  if (e.cause !== undefined && depth < MAX_DEPTH) out.cause = describeFailure(e.cause, depth + 1)
  return out
}

/** The one line a refusal (an `ORPCError` below 500) leaves in the log. */
export function describeRefusal(error: unknown): string {
  const e = (isObject(error) ? error : {}) as ErrorLike
  const status = typeof e.status === 'number' ? String(e.status) : '4xx'
  const code = typeof e.code === 'string' ? e.code : 'REFUSED'
  const message = typeof e.message === 'string' ? e.message : ''
  const issues = issuesOf(e)
  return `[api] ${status} ${code}: ${message}${issues.length > 0 ? ` (${issues.join('; ')})` : ''}`
}

/** `onError` of every service (bootstrap.ts): logs what failed without anything the caller sent. */
export function logServiceError(
  error: unknown,
  log: (...args: unknown[]) => void = console.error,
): void {
  const status = orpcStatus(error)
  if (status !== null && status < 500) {
    log(describeRefusal(error))
    return
  }
  log(describeFailure(error))
}
