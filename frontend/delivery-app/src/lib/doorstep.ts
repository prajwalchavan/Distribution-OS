/**
 * DOS-056 — the doorstep write never depends on the office answering.
 *
 * D4 records a delivery at the office when the phone believes it has a signal, and puts the SAME
 * delivery into the outbox when it does not. Deliveries were lost in the gap between the two: a phone
 * whose online flag is still green but whose call never reaches the office — a dead spot, a refused
 * connection, the 20 s deadline. `recordOrSave` closes that gap. A call that gets NO ANSWER is saved
 * on the phone; a call the office ANSWERED with a refusal (a business rule, a bad field, a conflict,
 * a permission, a server fault) is never queued, because the refusal is the answer and a queued copy
 * would only be refused again in the tray.
 *
 * Pure: the only import is the api-client's classifier, which reads a browser `TypeError`, the
 * deadline's `TimeoutError` and Expo's native `FetchError` ('fetch failed: …') as `network`.
 */
import { toApiError } from '@dos/api-client'
import { wordFor, type Translator } from '@dos/ui'

// ---------------------------------------------------------------------------
// The footer of D4 — the one decision behind `d4-record`
// ---------------------------------------------------------------------------

/**
 * DOS-181 — A PRESS THIS SCREEN WILL REFUSE IS NEVER ACCEPTED.
 *
 * `d4-record` used to be enabled on a bill the screen had already decided it could not write: a credit
 * shop with no photograph yet. The tap was taken, `commit()` returned at its own `podRequired` guard,
 * and the only trace was one sentence in `d4-error` — at the END of the scrolling body, a screen and a
 * half below the thumb, with no haptic. Measured on a Pixel 7 (SAI/0429 at Jain Kirana Mart) the
 * button read as dead, and a driver at the door had no way to close the stop.
 *
 * So there is ONE rule, here, and both halves of the screen ask it: the button asks it to decide
 * whether it may be pressed at all (the kit prints `disabledReason` directly beneath the button), and
 * `commit()` asks it again as a belt, because the policy can still turn on under the thumb — a
 * `trips.get` that resolves to `always` between the render and the release is enough. Whichever half
 * refuses, it refuses out loud.
 */
export type DoorstepBlock = 'recorded' | 'retake' | 'photo' | 'mismatch' | null

/** Everything about this bill that can stand between the driver and the doorstep write. */
export interface DoorstepGate {
  /** The bill already carries an outcome; an issued delivery is never recorded twice. */
  alreadyRecorded: boolean
  /** The photograph is over `MAX_INLINE_BASE64` and could not travel with an offline write. */
  proofTooBig: boolean
  /** The tenant's proof-of-delivery policy asks for a photograph on THIS bill. */
  photoRequired: boolean
  hasPhoto: boolean
  /** Dropped + taken back equals what is on the bill, on every line. */
  balanced: boolean
}

/**
 * What stands in the way right now, in the order the driver must clear it — or `null` when the write
 * may be made. A bill already recorded is said first because nothing else can be fixed after it.
 */
export function doorstepBlock(gate: DoorstepGate): DoorstepBlock {
  if (gate.alreadyRecorded) return 'recorded'
  if (gate.proofTooBig) return 'retake'
  if (gate.photoRequired && !gate.hasPhoto) return 'photo'
  if (!gate.balanced) return 'mismatch'
  return null
}

/** The sentence for a block: the driver's next action, never the problem (UX-00 §12). */
export function doorstepRefusal(
  t: Translator,
  block: Exclude<DoorstepBlock, null>,
  recordedOutcome: string | null,
): string {
  switch (block) {
    case 'recorded':
      return t('d4.alreadyDone', { outcome: wordFor(t, recordedOutcome) })
    case 'retake':
      return t('d4.podRetake')
    case 'photo':
      return t('d4.podRequired')
    case 'mismatch':
      return t('d4.mismatch')
  }
}

export interface DoorstepFooter {
  label: string
  disabled: boolean
  /** Present only while something blocks the write; the kit prints it beneath the button. */
  disabledReason?: string
  /** What `<Button>` calls on release. */
  onPress: () => void
}

export function doorstepFooter(input: {
  t: Translator
  gate: DoorstepGate
  /** What the sync engine believes right now (`useSyncStatus().online`). */
  online: boolean
  /** The outcome already on the bill, for the "already recorded" sentence. */
  recordedOutcome: string | null
  /** Make the doorstep write. */
  record: () => void
  /** Say, out loud, why the press was refused. */
  refuse: (sentence: string) => void
}): DoorstepFooter {
  const { t, gate, online, recordedOutcome, record, refuse } = input
  const block = doorstepBlock(gate)
  return {
    label: online ? t('d4.record') : t('d4.recordOffline'),
    disabled: block !== null,
    ...(block === null ? {} : { disabledReason: doorstepRefusal(t, block, recordedOutcome) }),
    onPress: () => {
      if (block !== null) {
        refuse(doorstepRefusal(t, block, recordedOutcome))
        return
      }
      record()
    },
  }
}

/** True when the call never reached the office — the one failure it is safe to save on the phone. */
export function noSignal(error: unknown): boolean {
  return toApiError(error).kind === 'network'
}

export type RecordedVia<T> = { via: 'office'; value: T } | { via: 'phone' }

export async function recordOrSave<T>(steps: {
  /** What the sync engine believes right now (`useSyncStatus().online`). */
  online: boolean
  /** The online write: the proof upload, then `deliveries.record`. */
  send: () => Promise<T>
  /** The outbox write: one `deliveries` op carrying its lines and its proof. */
  save: () => Promise<void>
}): Promise<RecordedVia<T>> {
  if (!steps.online) {
    await steps.save()
    return { via: 'phone' }
  }
  try {
    return { via: 'office', value: await steps.send() }
  } catch (error) {
    if (!noSignal(error)) throw error
    await steps.save()
    return { via: 'phone' }
  }
}
