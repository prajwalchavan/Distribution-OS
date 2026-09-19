/**
 * What D4 and D5 hand to the stop screen once the write is made (DOS-149).
 *
 * WHY A HANDOVER AT ALL. Both doorstep screens end the same way: the write lands, and the driver is put
 * back on the stop. A toast raised on D4 or D5 is drawn by a screen that `router.replace` is already
 * tearing down — measured on the Pixel 7, the sentence naming CN/9007 was never visible for a single
 * frame. So the outcome travels in the route, as a CODE and at most one reference, and the screen that
 * stays says it. Nothing here is a sentence: `keepKey` is re-applied on the destination against that
 * render's own `persistent`, so the app never promises a keep the store may not be able to make
 * (never-list #12, DOS-167 ruling 3 (ee)).
 *
 * Runs under vitest, not under Metro (the pattern `doorstep.ts` set): it imports `Translator` from the
 * kit — pure TypeScript, the string layer with no renderer — and nothing here may reach for a component
 * or a platform module.
 */
import type { Translator } from '@dos/ui'

import { keepKey } from './keep'

// ---------------------------------------------------------------------------
// DOS-149 — the outcome the stop screen says
// ---------------------------------------------------------------------------

/**
 * What just happened at this door, as little of it as the next screen needs.
 *
 * `credit` carries the credit note's NUMBER — "CN/9007", what the shopkeeper is holding — and `money`
 * the receipt's. `kept` and `moneyKept` are the offline twins: the write is on the phone, and how that
 * is worded is decided again on the destination against the store it actually turned out to have.
 */
export type DoorDone =
  | { readonly code: 'delivered' }
  | { readonly code: 'credit'; readonly note: string }
  | { readonly code: 'kept' }
  | { readonly code: 'money'; readonly no: string }
  | { readonly code: 'moneyKept'; readonly no: string }

/** The route back to the stop, carrying what was recorded at it. */
export function doorDoneHref(stopId: string, done: DoorDone): string {
  const stop = `/stop/${encodeURIComponent(stopId)}`
  const reference = 'note' in done ? done.note : 'no' in done ? done.no : null
  return reference === null || reference === ''
    ? `${stop}?done=${done.code}`
    : `${stop}?done=${done.code}&doneNo=${encodeURIComponent(reference)}`
}

/** Expo-router hands a query parameter back as a string, an array of them, or nothing. */
type RouteParam = string | string[] | undefined

function only(value: RouteParam): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return first === undefined || first === '' ? null : first
}

/**
 * The sentence for what was handed over, or null when the stop was opened in the ordinary way.
 *
 * A code this app did not write says nothing: a route is editable in a browser's address bar, and a
 * delivery screen that would print "Delivery recorded" for anyone who typed it is worse than silent.
 */
export function doorDoneMessage(
  t: Translator,
  persistent: boolean | null,
  params: { done?: RouteParam; doneNo?: RouteParam },
): string | null {
  const code = only(params.done)
  const reference = only(params.doneNo)
  switch (code) {
    case 'delivered':
      return t('d4.recorded')
    case 'credit':
      return reference === null ? t('d4.recorded') : t('d4.creditNote', { no: reference })
    case 'kept':
      return t(keepKey('savedOnPhone', persistent))
    case 'money':
      return reference === null ? null : t('d5.recorded', { no: reference })
    case 'moneyKept':
      return reference === null ? null : t(keepKey('recordedMoney', persistent), { no: reference })
    default:
      return null
  }
}
