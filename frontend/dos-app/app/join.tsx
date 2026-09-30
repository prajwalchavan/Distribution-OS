/**
 * `/join` — "Add a distributor" for the shopkeeper's own account before any distributor has joined it (founder,
 * 2026-09-29, docs/22 §8 "The shopkeeper is independent"). The root's ladder keeps such an account here: signed in,
 * with no group, reading only its own requests at auth-service. The moment a distributor approves, the next refresh
 * is a session on that distributor's shop and the ladder opens it. The component is `src/join/add-distributor.tsx`,
 * shared with the shop's own group (`/retailer/add-distributor`).
 */
import { AddDistributor } from '../src/join/add-distributor'

export default function Join(): React.JSX.Element {
  return <AddDistributor mode="account" />
}
