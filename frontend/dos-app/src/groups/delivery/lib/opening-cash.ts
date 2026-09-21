/**
 * D2 Start the trip — the float in "Cash handed to you" (DOS-146).
 *
 * Pure rules, no React, no kit, no imports. The screen holds `cashPaise: number | null`, and the two
 * values mean different things:
 *
 * - `null` = UNTOUCHED. The field shows the float planned at the office, `depart` leaves
 *   `openingCashPaise` out, and the server keeps `trips.opening_cash_paise`.
 * - a number = what the driver entered, `0` included. It is sent as `openingCashPaise`.
 *
 * Emptying the field (the pad's Clear, ⌫ down to nothing, or deleting the web text) reports `null`
 * from the kit. The screen used to store that `null` and show the plan again, so every emptied entry
 * came back as ₹3,000 and the next digit appended to it (₹3,00,04,756). The kit's DOS-060 rule
 * (`reconcilePadEntry`: when the typed entry and the parent's value disagree, the parent wins) is
 * right; the screen was handing it the wrong value. So an emptied field is `0`, and once any pad key
 * has been pressed, Clear included, `null` can never come back from the pad.
 */

/** What the field shows: the driver's entry once he has touched it, the planned float until then. */
export function openingCashShown(
  entered: number | null,
  plannedPaise: number | null | undefined,
): number | null {
  return entered ?? plannedPaise ?? null
}

/**
 * What the screen stores for a change the kit reports: an emptied field is ₹0, never the plan again
 * (DOS-146; founder default 2026-09-13, an emptied float at trip start is a ₹0 float).
 */
export function openingCashEntered(next: number | null): number {
  return next ?? 0
}
