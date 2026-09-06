/**
 * Typed errors. A screen must never see a raw `fetch` failure or an `ORPCError`: it sees an
 * `ApiError` whose `kind` tells it what to do and whose `message` is already in business language
 * (UX-00 section 12: "the business reason and the next action", never "Error 4xx").
 */
import { ORPCError } from '@orpc/client'

export type ApiErrorKind =
  /** No network, DNS failure, the request never reached a service. Retry is meaningful. */
  | 'network'
  /** The session is gone: the refresh token was rejected, reused, or never existed. Sign in again. */
  | 'auth'
  /** The role may not call this. The permission matrix said no; retrying will not help. */
  | 'permission'
  /** The distributorship is suspended (423). Nobody signs in until the platform reactivates it. */
  | 'suspended'
  /** A business rule refused the write: over credit limit, order already confirmed, and so on. */
  | 'business'
  /** The input did not satisfy the contract. A field is wrong; the screen should say which. */
  | 'validation'
  /** Someone else changed the row first, or the same idempotency key carried a different payload. */
  | 'conflict'
  /** The row is not there (or not visible to this tenant, which reads the same from outside). */
  | 'notFound'
  /** The service failed. Not the caller's fault; retry is meaningful. */
  | 'server'
  | 'unknown'

export interface ApiErrorOptions {
  kind: ApiErrorKind
  message: string
  /** HTTP status, or 0 when the request never got a reply. */
  status?: number
  /** The service's machine code, when it sent one. Shown only behind "Details". */
  code?: string | undefined
  /** The service's error payload, for a screen that can point at the offending field. */
  data?: unknown
  cause?: unknown
}

export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly kind: ApiErrorKind
  readonly status: number
  readonly code: string | undefined
  readonly data: unknown

  constructor(options: ApiErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause })
    this.kind = options.kind
    this.status = options.status ?? 0
    this.code = options.code
    this.data = options.data
  }

  /** True where showing "Try again" makes sense. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'server'
  }
}

const KIND_BY_STATUS: Readonly<Record<number, ApiErrorKind>> = {
  400: 'validation',
  401: 'auth',
  403: 'permission',
  404: 'notFound',
  409: 'conflict',
  422: 'validation',
  423: 'suspended',
}

/**
 * Default sentences, deliberately short and free of jargon. A screen that knows better replaces
 * them; a screen that does not still shows something a distributor can act on.
 */
const DEFAULT_MESSAGE: Readonly<Record<ApiErrorKind, string>> = {
  network: 'No connection. This will send when the signal is back.',
  auth: 'Signed out. Sign in again to continue.',
  permission: 'You do not have access to this.',
  suspended: 'This distributorship is suspended. Call Distribution OS support.',
  business: 'That could not be done.',
  validation: 'Check the highlighted field and try again.',
  conflict: 'Someone changed this first. Open it again to see the current state.',
  notFound: 'That record is no longer here.',
  server: 'The service could not answer. Try again in a moment.',
  unknown: 'Something could not be completed. Try again.',
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

/**
 * Normalises anything a call can throw. `ORPCError` carries the service's own message, which is
 * already written in business language by the backend, so it is preferred over the default.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof ORPCError) {
    const status: number = err.status
    const kind: ApiErrorKind =
      KIND_BY_STATUS[status] ?? (status >= 500 ? 'server' : status >= 400 ? 'business' : 'unknown')
    // `ORPCError` fills a missing message with the CODE ("FORBIDDEN"), which is exactly the machine
    // string UX-00 section 12 forbids on screen — so a message equal to the code counts as absent.
    const code = String(err.code)
    const message = err.message.trim()
    const usable = message !== '' && message !== code
    return new ApiError({
      kind,
      status,
      // `ORPCError` types both of these loosely; they are only ever shown behind "Details".
      code,
      data: err.data as unknown,
      message: usable ? message : DEFAULT_MESSAGE[kind],
      cause: err,
    })
  }
  if (isAbort(err)) {
    return new ApiError({ kind: 'network', message: DEFAULT_MESSAGE.network, cause: err })
  }
  if (err instanceof TypeError) {
    // `fetch` rejects with a TypeError when the request never left the device.
    return new ApiError({ kind: 'network', message: DEFAULT_MESSAGE.network, cause: err })
  }
  return new ApiError({ kind: 'unknown', message: DEFAULT_MESSAGE.unknown, cause: err })
}

/** The sentence a screen shows when it has nothing better of its own. */
export function defaultMessageFor(kind: ApiErrorKind): string {
  return DEFAULT_MESSAGE[kind]
}

export { ORPCError }
