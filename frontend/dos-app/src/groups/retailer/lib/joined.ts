/**
 * THE DISTRIBUTORS A SHOP BUYS FROM NOW (blind check of the shopkeeper's sign-up, m3).
 *
 * A session's memberships include the ones that are switched off: a distributor the shopkeeper LEFT, or whose desk
 * STOPPED the shop's sign-in, stays on the list with `status = disabled` (it is still a fact about the account). The
 * switcher already offered only the active ones; Me's "Your distributors" listed them all, so right after leaving a
 * distributor it still showed that one with "Buy from here" and counted it in "across 2 distributors". Both read this.
 */
export function joinedDistributors<T extends { status: string }>(memberships: readonly T[]): T[] {
  return memberships.filter((membership) => membership.status === 'active')
}
