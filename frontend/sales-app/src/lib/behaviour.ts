/**
 * "This shop has no history yet" is not an error (DOS-093).
 *
 * `reporting.retailers.behaviour` answers **404 `behaviour_not_computed`** until the nightly rollup
 * has seen a shop — the contract says so in as many words, the service throws exactly that, and
 * `reporting.spec.ts` asserts the status. So the 404 in a rep's network log after adding a shop is
 * correct and is not going away; what has to change is the screen, which put it through the same
 * `<Async>` ErrorState as a dead service and offered a Retry that could only fail again.
 *
 * The test is narrow on purpose. A 404 from somewhere else (a shop that really is not there), a
 * refusal, a timeout or a server fault are all things a rep must still be told about, so only this
 * one status-and-code pair is read as "new shop".
 */
export interface BehaviourFailure {
  status: number
  code?: string | undefined
}

export function isNewShop(error: BehaviourFailure | undefined): boolean {
  return error !== undefined && error.status === 404 && error.code === 'behaviour_not_computed'
}
