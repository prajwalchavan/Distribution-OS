/**
 * The device tables that hold money a PERSON has entered (DOS-178; never-list #13, founder 2026-09-19).
 *
 * "Nothing a person has entered is ever thrown away" (founder answer A, 2026-09-14) has one edge where it
 * actually bites: a doorstep payment the office refuses. The crew takes cash at a door with no signal, the
 * office settles that trip before the phone finds one, and the receipt comes back refused `trip_settled` —
 * correctly, because that money now goes over the counter to the cashier. Until DOS-178 the tray offered
 * "Throw it away" on that card, and on a settled trip the outbox row is the ONLY record anywhere that the
 * shop paid: the phone's, because the office refused it, and the books', because it never reached them.
 *
 * WHY A TABLE LIST AND NOT A CODE LIST. Kept-or-discardable is decided by the TABLE the op writes, never by
 * the rejection code. A code list drifts the moment the server adds one — `trip_not_found` and
 * `trip_not_on_road` arrived with DOS-175 in the same week — and every code that has ever been added to a
 * money table means the same thing to a driver holding notes: the office did not take it, so a person must.
 * The table cannot drift: these three are the insert-only money tables of docs/27 §7, and a device writes
 * money nowhere else.
 *
 * This is a LIBRARY CONSTANT on purpose. Putting a `money` flag on the sync manifest would make it the
 * server's to say, which is a contract change; the architect's design (2026-09-19 §5) deliberately did not
 * take it, and this list is the whole of the decision.
 */

/** The insert-only money tables (docs/27 §7). A refused op on one of these is kept, whatever the code. */
export const MONEY_TABLES: readonly string[] = ['receipts', 'allocations', 'collections']

/** Whether a refused op on this table holds money a person entered, and so may never be thrown away. */
export function isMoneyTable(table: string): boolean {
  return MONEY_TABLES.includes(table)
}
