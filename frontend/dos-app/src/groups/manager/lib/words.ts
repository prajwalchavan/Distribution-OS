/**
 * The one place a machine word becomes a word a distributor uses.
 *
 * The services speak in enum values — `settled_with_variance`, `POST_FULFILLMENT`, `short_delivery`,
 * `report_gstSalesRegister_csv` — because that is what a column and a state machine should hold. The
 * app printed them verbatim in twenty-odd registers, so the trips register's `<StatusChip>` read
 * "settled_with_variance" and the shops register's Terms column read "POST_FULFILLMENT". UX-00 §12
 * asks for the trade's own word; a database identifier is not one.
 *
 * How it works. A value gets a locale key of its own, `word.<value>`, in `src/strings.ts` — so these
 * are translated exactly like every other string when Hindi arrives, and nothing here holds an
 * English literal. A value with no key is HUMANISED by the kit (`wordFor` in `@dos/ui`) rather than
 * printed raw, so a status the backend adds tomorrow reaches the screen as "Partly settled" and
 * never as `partly_settled`. That fallback is what makes it safe to point this at every enum in the
 * contract instead of maintaining a list that has to keep up.
 */
import { useStrings, wordFor } from '@dos/ui'

/** `const word = useWord(); word(row.state)`. Null and undefined render as the em dash. */
export function useWord(): (value: string | null | undefined) => string {
  const t = useStrings()
  return (value) => wordFor(t, value)
}

/**
 * A percentage held in basis points, as a percentage.
 *
 * Every rate in this product is an integer in bps (`@dos/domain`: 1 % = 100 bps), and the schemes
 * register printed the integer: a 2 % cash discount read "cash_discount_pct 200" and a 5 % slab read
 * "line_pct 500". Trailing zeros go, because "2%" is what is written on the scheme letter.
 */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const frac = Math.abs(bps % 100)
  if (frac === 0) return `${String(whole)}%`
  const two = frac.toString().padStart(2, '0')
  return `${String(whole)}.${two.replace(/0$/, '')}%`
}
