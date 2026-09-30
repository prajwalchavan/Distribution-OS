/**
 * WHAT THE SHOPKEEPER IS TOLD AFTER "ASK TO JOIN" (blind check of the shopkeeper's sign-up, M2) — the pure half of
 * `add-distributor.tsx`.
 *
 * The server answers an ask with THE REQUEST AS IT IS: a new one waiting, the one already waiting for that shop, or —
 * for an `id` it has seen before — that request in whatever state it has reached. The screen used to say "Request
 * sent" whatever came back, and kept the same `id` for the same shop code for the whole visit (the mutation hook keys
 * the id on the INPUT), so asking again after a withdraw sent the old id, got the WITHDRAWN request back and still said
 * "Request sent". Now the words follow the state, and the screen starts a new request after every answered ask.
 */
import type { MyJoinRequest } from '@dos/contracts'

/** The string key of the toast for the request an ask answered with. */
export function askedToastKey(state: MyJoinRequest['state']): string {
  switch (state) {
    case 'waiting':
      return 'join.asked'
    case 'approved':
      return 'join.askedJoined'
    default:
      return 'join.askedClosed'
  }
}
