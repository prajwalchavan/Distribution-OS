/**
 * The words a refused write reaches a desk in (QA DOS-141).
 *
 * A service's refusal is shown to the person who pressed, verbatim (DOS-029), so the sentence IS the
 * product here. Several of them named a row by its database id and a moment by its UTC ISO string —
 * "load sheet 01a0976e-bbaf-… was already approved by a1cbd424-…", "reviewing this document (until
 * 2026-10-12T00:00:00.000Z)" — which tells a manager nothing he can act on and nothing he can repeat
 * over the phone. Every instant this product shows a person is IST (`businessDate()` in @dos/domain
 * is the same rule), printed the way the apps print one: `13 Sep`, `13 Sep, 4:20 pm`.
 */
import { IST_OFFSET_MINUTES } from '@dos/domain'

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** The instant, moved into IST so the UTC getters read as Indian wall-clock parts. */
function istClock(at: Date | string): Date | null {
  const ms = typeof at === 'string' ? Date.parse(at) : at.getTime()
  if (Number.isNaN(ms)) return null
  return new Date(ms + IST_OFFSET_MINUTES * 60_000)
}

/** `13 Sep` — an instant as the IST day a desk calls it. */
export function istDay(at: Date | string | null | undefined): string {
  if (at === null || at === undefined) return 'an unknown day'
  const ist = istClock(at)
  if (ist === null) return 'an unknown day'
  return `${String(ist.getUTCDate())} ${MONTHS[ist.getUTCMonth()] ?? ''}`
}

/** `2026-09-13` (an IST calendar date, as the tables store a sheet date) → `13 Sep`. */
export function istDateWord(isoDate: string | null | undefined): string {
  if (!isoDate || isoDate.length < 10) return 'an unknown day'
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ''
  return `${String(Number(isoDate.slice(8, 10)))} ${month}`
}

/** `13 Sep, 4:20 pm` — an instant as an IST day and clock time. */
export function istMoment(at: Date | string | null | undefined): string {
  if (at === null || at === undefined) return 'an unknown time'
  const ist = istClock(at)
  if (ist === null) return 'an unknown time'
  const hours = ist.getUTCHours()
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0')
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${istDay(at)}, ${String(hour12)}:${minutes} ${suffix}`
}

/** A person's name where there is one, and a word that is not an id where there is not. */
export function personWord(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? ''
  return trimmed === '' ? 'someone else' : trimmed
}
