/**
 * DOS-066 — THE DUES THE DOOR SHOWS.
 *
 * The stop drew one chip off `outstanding_paise` and tinted it when anything was overdue. The device
 * already held the rest of the row — `overdue_paise`, `oldest_due_date` — and the shop's `credit_mode`
 * besides, and none of it reached the screen: at Vaibhav Kirana Mart ₹52,176 of ₹75,228 was past due
 * on a bill due 10 July, and the shop the office had put on credit mode `stop` looked exactly like
 * every other shop on the road.
 *
 * The founder's rule (docs/22 §8, 2026-09-13) is TELL, NEVER BLOCK: the crew hands over goods the
 * office has already invoiced and loaded — that bill passed the credit gate at order submit, or the
 * owner overrode it — and the stop says what the shop owes, how late it is, and whether the office
 * has stopped its credit. Nothing here gates a button, on the phone or on the server. Only `stop`
 * earns a chip: `strict` and `indicate` look exactly as they did (docs/23 §5.3), and no credit LIMIT
 * and no credit DAYS appear at the door — DOS-072 took them off the crew's device entirely, and
 * `overdue_paise` / `oldest_due_date` already embody the shop's credit days.
 *
 * Pure TypeScript like `doorstep.ts`: `@dos/domain` for days, `./dates` for the printed date and the
 * kit's string layer for the sentence — no component and no platform module, so it runs under vitest
 * with no Metro. No file in this app carries a literal English sentence, this one included.
 */
import { daysBetween } from '@dos/domain'
import type { Translator } from '@dos/ui'

import { shortDate, today } from './dates'
import type { LocalOutstanding } from './local'

/**
 * How the door reads this shop, worst first.
 *
 * `stopped` wins over everything: a shop whose credit the office has stopped is the one the crew must
 * act differently at, whether or not the summary on this phone has caught up with a payment.
 */
export type DoorTone = 'clear' | 'due' | 'overdue' | 'stopped'

export interface DoorDues {
  outstandingPaise: number
  overduePaise: number
  oldestDueDate: string | null
  /** Whole days past the oldest bill's due date; never negative, and 0 when nothing is late. */
  daysLate: number
  /** The office has stopped this shop's credit (`retailers.credit_mode === 'stop'`). */
  stopped: boolean
  tone: DoorTone
}

export function doorDues(
  dues: LocalOutstanding | null,
  creditMode: string | null,
  on: string = today(),
): DoorDues {
  const stopped = creditMode === 'stop'
  const outstandingPaise = dues?.outstanding_paise ?? 0
  const overduePaise = dues?.overdue_paise ?? 0
  const oldestDueDate = overduePaise > 0 ? (dues?.oldest_due_date ?? null) : null
  const daysLate = oldestDueDate === null ? 0 : Math.max(0, daysBetween(oldestDueDate, on))
  const tone: DoorTone = stopped
    ? 'stopped'
    : overduePaise > 0
      ? 'overdue'
      : outstandingPaise > 0
        ? 'due'
        : 'clear'
  return { outstandingPaise, overduePaise, oldestDueDate, daysLate, stopped, tone }
}

/**
 * "Overdue ₹52,176.00 · oldest due 10 Jul", or null when nothing at this shop is past its date.
 *
 * The money is printed by the screen's own formatter (`formatINR(paise(…))`) and the date by
 * `shortDate`, the one every other door line uses.
 */
export function overdueLine(
  t: Translator,
  door: DoorDues,
  money: (paise: number) => string,
): string | null {
  if (door.overduePaise <= 0) return null
  const amount = money(door.overduePaise)
  return door.oldestDueDate === null
    ? t('d3.overdueNoDate', { amount })
    : t('d3.overdue', { amount, date: shortDate(door.oldestDueDate) })
}
