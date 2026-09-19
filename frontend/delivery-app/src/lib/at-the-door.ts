/**
 * D4's own rules, in one testable place: what it hands to the stop screen once the write is made
 * (DOS-149), what it refuses before it asks for a photograph (DOS-148), what a typed piece count means
 * on a bill line (DOS-064), and what it may honestly claim about its own proof (DOS-070).
 *
 * WHY A HANDOVER AT ALL. Both doorstep screens end the same way: the write lands, and the driver is put
 * back on the stop. A toast raised on D4 or D5 is drawn by a screen that `router.replace` is already
 * tearing down — measured on the Pixel 7, the sentence naming CN/9007 was never visible for a single
 * frame. So the outcome travels in the route, as a CODE and at most one reference, and the screen that
 * stays says it. Nothing here is a sentence: `keepKey` is re-applied on the destination against that
 * render's own `persistent`, so the app never promises a keep the store may not be able to make
 * (never-list #12, DOS-167 ruling 3 (ee)).
 *
 * Runs under vitest, not under Metro (the pattern `doorstep.ts` set): what it takes from the kit is
 * `Translator` and `parsePieces`, and from the domain `orderMachine` — pure TypeScript, no renderer.
 * Nothing here may reach for a component or a platform module.
 */
import { orderMachine, type OrderState } from '@dos/domain'
import { parsePieces, type Translator } from '@dos/ui'

import { instantWithClock } from './dates'
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

// ---------------------------------------------------------------------------
// DOS-148 — the bill that is not on this van
// ---------------------------------------------------------------------------

/** The order move each doorstep outcome asks for; the server pairs them the same way. */
const DOORSTEP_EVENT = {
  delivered: 'deliver_all',
  partial: 'deliver_partial',
  failed: 'return_undelivered',
} as const

/** Where each of those takes a dispatched order — so "already applied" is read off the machine. */
const DOORSTEP_TARGET = orderMachine.transitions.dispatched

/** The states of an order still at the godown: nothing on that bill is at any shop door. */
const IN_THE_GODOWN: ReadonlySet<string> = new Set<OrderState>([
  'draft',
  'submitted',
  'confirmed',
  'picking',
  'packed',
])

/** What stands between this bill and the door, as far as the OFFICE's copy of the order says. */
export type DoorstepOrderBlock = 'godown' | 'elsewhere'

/**
 * Whether the office would refuse this outcome on this bill, or null when it would not — and null
 * again whenever the device does not know, which is most of a day on a road with no signal.
 *
 * `orderMachine` is the domain's, the same one `deliveries.record` asks, so this can only ever refuse
 * what the office would refuse. A state this build has never heard of says nothing: a device that
 * refuses a door on a word it cannot read is worse than one that lets the office answer.
 */
export function doorstepOrderBlock(
  orderState: string | null | undefined,
  outcome: 'delivered' | 'partial' | 'failed',
): DoorstepOrderBlock | null {
  if (orderState === null || orderState === undefined) return null
  const state = orderState as OrderState
  if (orderMachine.transitions[state] === undefined) return null
  const event = DOORSTEP_EVENT[outcome]
  // The move is legal, or the order has already been through it: the office takes this write.
  if (orderMachine.can(state, event) || state === DOORSTEP_TARGET[event]) return null
  return IN_THE_GODOWN.has(state) ? 'godown' : 'elsewhere'
}

/** The sentence for that refusal: what happened to the goods, and who the driver tells (UX-00 §12). */
export function doorstepOrderRefusal(t: Translator, block: DoorstepOrderBlock): string {
  return block === 'godown' ? t('d4.notLoaded') : t('d4.notOnThisVan')
}

// ---------------------------------------------------------------------------
// DOS-064 — pieces on a bill line
// ---------------------------------------------------------------------------

/**
 * What a typed piece count means on a bill line: whole pieces, capped at what the bill carries — or
 * null when what was typed is not a count at all.
 *
 * The cap is the same one the case stepper has always had (`Math.min(pieces, billed)`): a driver may
 * drop less than the bill and never more, and whatever is not dropped is what comes back. `parsePieces`
 * is the kit's, so "1,200" reads as 1200 and "1.5" is refused rather than silently truncated to 1.
 */
export function droppedPieces(typed: string, billedPcs: number): number | null {
  const parsed = parsePieces(typed)
  if (!parsed.ok) return null
  return Math.max(0, Math.min(parsed.pieces, billedPcs))
}

// ---------------------------------------------------------------------------
// DOS-070 — what the geo proof on a delivery actually is
// ---------------------------------------------------------------------------

/**
 * The line under the proof panel, or null when nothing about where the crew was is being sent.
 *
 * What travels with a delivery is `trip_stops.arrived_lat/lng` — the ONE fix taken when the crew tapped
 * "I am at the shop". D4 has never asked the phone for a reading of its own, so on a browser that
 * refused location, or a phone that never got one, there is no fix, no `geo` row, and nothing to say.
 * The old line, "Where you were is attached as proof", was printed beside a home screen reading
 * "Location is off — this phone is not sharing location": a claim the device had never made.
 */
export function geoProofLine(
  t: Translator,
  stop: { arrived_lat?: number | null; arrived_at?: string | null } | null | undefined,
): string | null {
  if (stop?.arrived_lat === null || stop?.arrived_lat === undefined) return null
  const at = stop.arrived_at
  return at === null || at === undefined || at === ''
    ? t('d4.podGeoArrival')
    : t('d4.podGeoArrivalAt', { when: instantWithClock(at) })
}
