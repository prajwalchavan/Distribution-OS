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
