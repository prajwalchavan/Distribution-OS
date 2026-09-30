/**
 * `/retailer/add-distributor` — a shopkeeper who already buys from one distributor asks another to join them to their shop
 * (founder, 2026-09-29: "one account, as many distributors as the shop buys from, each joined and left
 * separately"). Reached from Me. The approved distributor appears in the switcher at the next refresh. The
 * component is `src/join/add-distributor.tsx`, shared with `/join`.
 */
import { AddDistributor } from '../../src/join/add-distributor'

export default function JoinAnother(): React.JSX.Element {
  return <AddDistributor mode="shop" />
}
