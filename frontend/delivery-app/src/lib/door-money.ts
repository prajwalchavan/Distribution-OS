/**
 * DOS-062 — the ONE-SHOT handover of what a door receipt actually paid.
 *
 * `collections.record` answers the allocations and each bill's new open balance; the DEVICE has no
 * allocations table (receivables.module.ts pulls `receipts` and the outstanding summary, never
 * `allocations`: "bill-to-bill settlement is the server's arithmetic"), so that reply is the only
 * place those bills exist. D5 is replaced by D3 the moment it lands — the same tear-down that ate
 * D4's credit-note toast (DOS-149) — so the sentences travel HERE and D3 says them.
 *
 * Not in the route: this is several lines of money, and a route is editable in a browser's address
 * bar, so a stop that printed whatever the address bar carried would be inventing a receipt. Not in
 * SQLite either: it is read once, on the next mount of the stop, and then gone. A reload in between
 * loses it, exactly as the toast beside it is lost, and neither is a record of anything — the receipt
 * itself is at the office and in the trip's own list.
 */

let waiting: readonly string[] | null = null

/** D5, on its way out: what the office said this money paid. Empty lines are not worth a panel. */
export function keepApplied(lines: readonly string[]): void {
  waiting = lines.length === 0 ? null : lines
}

/** D3, on the way in: the lines once, and nothing on any mount after this one. */
export function takeApplied(): readonly string[] | null {
  const held = waiting
  waiting = null
  return held
}
