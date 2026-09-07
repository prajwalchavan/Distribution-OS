/**
 * The one place a machine word becomes a word a person at this console uses.
 *
 * The services speak in enum values — `past_due`, `read_only`, `support.requested` — because that is
 * what a column and a state machine should hold. A value gets a locale key of its own,
 * `word.<value>`, in `src/strings.ts`, so these are translated like every other string when Hindi
 * arrives; a value with no key is HUMANISED by the kit (`wordFor` in `@dos/ui`) rather than printed
 * raw, so an action the backend adds tomorrow reaches the screen as "Support window opened" and
 * never as `support.approve`.
 */
import { useStrings, wordFor } from '@dos/ui'
import { STATE_CODES } from '@dos/domain'

/** `const word = useWord(); word(row.status)`. Null and undefined render as the em dash. */
export function useWord(): (value: string | null | undefined) => string {
  const t = useStrings()
  return (value) => wordFor(t, value)
}

/**
 * A GST state code as its state. `27` is Maharashtra, and a console row that printed `27` would be
 * asking its reader to keep the GST state table in their head. Unknown codes keep the digits, which
 * is honest: an imported row may hold one this list does not have.
 */
export function stateName(code: string | null | undefined): string {
  if (code === null || code === undefined || code === '') return '—'
  const name = STATE_CODES[code]
  return name === undefined ? code : name
}

/** Every state code with its name, for the onboarding picker, in code order. */
export function stateChoices(): readonly { id: string; label: string }[] {
  return Object.entries(STATE_CODES)
    .map(([code, name]) => ({ id: code, label: `${code} · ${name}` }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
