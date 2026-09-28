/**
 * "No money now", remembered on this device for the trip (verify-1 m2).
 *
 * The answer records nothing at the office — it is the driver saying "not this shop, not now", and the
 * card keeps its "Take money" for when the shopkeeper comes back with it. It only changes which card
 * is "Do this next" and whether the day counts as done. Held in memory alone (`home.ts`), a browser
 * reload or an app restart forgot it and the same shop was the next job again, blocking "All done".
 *
 * So the list also goes into the device's own storage (`@dos/ui/platform`, the store the sales app
 * keeps its order drafts in), one entry per driver, for ONE trip: the next trip starts with none. It
 * is a per-device convenience and nothing more; a store that keeps nothing simply forgets it, which is
 * the old behaviour.
 */
import { storage } from '@dos/ui/platform'
import { useCallback, useEffect, useState } from 'react'

import { moneyPutOff, putMoneyOff } from './home'

/** A trip has a few dozen stops; a list longer than this is not ours. */
const MOST = 400

export function putOffKey(userId: string): string {
  return `dos.delivery.putOff.${userId}`
}

/** The stops put off on THIS trip, read from what storage held; anything else reads as none. */
export function parsePutOff(raw: string | null, tripId: string): string[] {
  if (raw === null) return []
  try {
    const held = JSON.parse(raw) as { tripId?: unknown; stops?: unknown }
    if (held.tripId !== tripId || !Array.isArray(held.stops)) return []
    return held.stops.filter((id): id is string => typeof id === 'string').slice(0, MOST)
  } catch {
    return []
  }
}

export function serialisePutOff(tripId: string, stops: readonly string[]): string {
  return JSON.stringify({ tripId, stops: [...new Set(stops)].slice(0, MOST) })
}

export async function readPutOff(userId: string, tripId: string): Promise<string[]> {
  try {
    return parsePutOff(await storage.getItem(putOffKey(userId)), tripId)
  } catch {
    return []
  }
}

export async function savePutOff(
  userId: string,
  tripId: string,
  stops: readonly string[],
): Promise<void> {
  try {
    await storage.setItem(putOffKey(userId), serialisePutOff(tripId, stops))
  } catch {
    // A store that cannot write keeps the answer for the running app only, as before.
  }
}

/**
 * The doors put off on this trip, and the one way to add one. `tripStops` is this trip's own stop
 * ids: only those are written, so the stored list never carries another trip's doors.
 */
export function useMoneyPutOff(
  userId: string | null,
  tripId: string | null,
  tripStops: readonly string[],
): { deferred: ReadonlySet<string>; putOff: (stopId: string) => void } {
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(moneyPutOff)

  useEffect(() => {
    if (userId === null || tripId === null) return
    let live = true
    void readPutOff(userId, tripId).then((stops) => {
      if (!live || stops.length === 0) return
      let all = moneyPutOff()
      for (const id of stops) all = putMoneyOff(id)
      setDeferred(all)
    })
    return () => {
      live = false
    }
  }, [userId, tripId])

  const putOff = useCallback(
    (stopId: string) => {
      const all = putMoneyOff(stopId)
      setDeferred(all)
      if (userId === null || tripId === null) return
      const mine = new Set(tripStops)
      void savePutOff(
        userId,
        tripId,
        [...all].filter((id) => mine.has(id)),
      )
    },
    [userId, tripId, tripStops],
  )

  return { deferred, putOff }
}
