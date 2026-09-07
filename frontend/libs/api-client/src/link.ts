/**
 * The two things every oRPC link in this package does the same way, extracted so the tenant client
 * (`client.ts`) and the platform console's client (`platform-client.ts`) cannot drift apart on them.
 *
 * Everything ELSE about the two clients is deliberately separate: they sign in through different
 * procedures, refresh through different procedures, and hold different session shapes. Sharing the
 * URL join and the request deadline is sharing a fact; sharing the auth flow would have meant a
 * nullable tenant in six apps that can never see one.
 */

/** A request that has gone unanswered this long is a dead spot, not a slow service. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

/** `join('https://api.example.in', '/owner')` — the all-in-one deployment of docs/26 §7. */
export function join(base: string, prefix: string | undefined): string {
  if (!prefix) return base.replace(/\/$/, '')
  return `${base.replace(/\/$/, '')}/${prefix.replace(/^\//, '').replace(/\/$/, '')}`
}

/**
 * `fetch` with a deadline. The caller's own signal still wins (the query cache abandons a read when
 * the distributor is switched), so the two are combined rather than replaced. `fetch` has no timeout
 * of its own, and a dead spot on an Indian highway does not REFUSE a connection — it accepts it and
 * never answers, which without this leaves a screen on a skeleton for the OS TCP timeout.
 */
export function fetchWithDeadline(
  timeoutMs: number,
): (request: Request, init: RequestInit) => Promise<Response> {
  return (request, init) => {
    if (timeoutMs <= 0) return fetch(request, init)
    const deadline = AbortSignal.timeout(timeoutMs)
    const signal =
      typeof AbortSignal.any === 'function' ? AbortSignal.any([request.signal, deadline]) : deadline
    return fetch(request, { ...init, signal })
  }
}
