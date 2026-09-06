/**
 * Two ways the kit prints a time, and no others.
 *
 * `relativeTime` — "just now" · "12 min ago" · "3 h ago". Used only for "Updated …", never for a
 * date on a bill: a relative date beyond a few hours is banned (UX-00 section 12).
 *
 * `clockTime` — "9:40 am". Used wherever the design says a clock time: "Offline since 10:42",
 * "Stock as of 9:40 am". Rendered in the device's own zone, which for every user of this product is
 * IST; business DATES come from `@dos/domain`'s IST calendar, never from here.
 */
import type { Translator } from './strings.js'

export function relativeTime(from: number, now: number, t: Translator): string {
  const minutes = Math.max(0, Math.round((now - from) / 60_000))
  if (minutes < 1) return t('connection.justNow')
  if (minutes < 60) return t('connection.minutesAgo', { count: minutes })
  return t('connection.hoursAgo', { count: Math.round(minutes / 60) })
}

/** `1757130000000` -> `"9:40 am"`. Lower case am/pm, as UX-00 section 12 writes times. */
export function clockTime(at: number): string {
  const date = new Date(at)
  const hours = date.getHours()
  const suffix = hours < 12 ? 'am' : 'pm'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hour12}:${date.getMinutes().toString().padStart(2, '0')} ${suffix}`
}
