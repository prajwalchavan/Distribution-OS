/**
 * "This shop has no history yet" is not an error (DOS-093).
 *
 * `reporting.retailers.behaviour` answers **404 `behaviour_not_computed`** until the nightly rollup
 * has seen a shop — the contract says so in as many words, the service throws exactly that, and
 * `reporting.spec.ts` asserts the status. So the 404 in a rep's network log after adding a shop is
 * correct and is not going away; what has to change is the screen, which put it through the same
 * `<Async>` ErrorState as a dead service and offered a Retry that could only fail again.
 *
 * WHERE THE WORD `behaviour_not_computed` ACTUALLY IS (review of the first fix, which read it off
 * `error.code` and therefore never fired once). The service throws
 *
 *     new ORPCError('NOT_FOUND', { message, data: { code: 'behaviour_not_computed', retailerId } })
 *
 * and `ORPCError.toJSON()` puts the oRPC code — `NOT_FOUND` — at the TOP level, with the module's own
 * word inside `data`. The client rebuilds the error from that JSON as `new ORPCError(json.code, …)`,
 * so `ApiError.code` is `'NOT_FOUND'` on every one of these and `'behaviour_not_computed'` is only
 * ever reachable through `ApiError.data`. Reading it off `data` is what makes the branch real.
 *
 * The test is narrow on purpose. A 404 from somewhere else (a shop that really is not there), a
 * refusal, a timeout or a server fault are all things a rep must still be told about, so only this
 * one status-and-payload pair is read as "new shop".
 */
export interface BehaviourFailure {
  status: number
  /** The oRPC code. For this failure it is `NOT_FOUND`, never the module's own word. */
  code?: string | undefined
  /** The service's payload — `{ code: 'behaviour_not_computed', retailerId }` lives here. */
  data?: unknown
}

/** The module's own code, off the error payload; `null` when the service sent no payload. */
function moduleCode(error: BehaviourFailure): string | null {
  const data: unknown = error.data
  if (typeof data !== 'object' || data === null) return null
  const code: unknown = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function isNewShop(error: BehaviourFailure | undefined): boolean {
  return (
    error !== undefined && error.status === 404 && moduleCode(error) === 'behaviour_not_computed'
  )
}
