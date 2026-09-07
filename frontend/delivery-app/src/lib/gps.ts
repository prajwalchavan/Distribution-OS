/**
 * Trip tracking — the one write path in this app that must NEVER touch the sync queue (ADR 0012,
 * docs/07).
 *
 * Breadcrumbs go to `POST /gps/points` on their own, so a batch of location can never queue ahead of
 * a cash receipt or a delivery, and a phone that has been in a dead corner does not spend its first
 * minute of signal uploading where it has been instead of what it did. The endpoint is deliberately
 * always 2xx for a well-formed batch: stale points are `dropped`, replays are `duplicates`, and a
 * device over its budget is told `throttled` with a `retryAfterSeconds` rather than a 429 to hot-loop
 * on (docs/20 rule 6). This module honours all three.
 *
 * WHAT IS TRACKED, AND WHEN. Only while a trip is `active`, only with a granted `location_consents`
 * row (DPDP — `trips.depart` refuses without one), and it stops the moment the trip is checked in or
 * the app is closed. There is no ambient tracking anywhere in this product, which is why
 * `platform.location.watch` hands back a stop function rather than living for the life of the app.
 *
 * THE BUFFER IS IN MEMORY, ON PURPOSE AND WITH A LIMIT. `platform.storage` is Keychain /
 * EncryptedSharedPreferences on a phone — a key/value store meant for a token, warned about above a
 * couple of kilobytes — and `@dos/offline`'s SQLite is the queue this must not enter. So points are
 * held in memory, capped at the contract's own batch ceiling, flushed every 30 s or 25 points, and
 * the screen prints how many are held. What that costs is stated in the slice report: an app killed
 * mid-dead-spot loses the unsent tail of the track. It never loses a delivery, a receipt or a return,
 * which is the trade the ADR makes.
 *
 * ON THE WEB there is no background at all: a hidden tab is throttled and then suspended, so
 * `canTrackInBackground` is false and D1 says so in a sentence rather than dropping half a trip's
 * points without telling anyone.
 */
import { useApi } from '@dos/api-client/react'
import { location as platformLocation } from '@dos/ui/platform'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { GpsPointIn } from '@dos/contracts'

/** `GpsPointsInput.points` is capped at 500; hold a little less so a batch is always sendable. */
const BUFFER_LIMIT = 400
const BATCH_AT = 25
const FLUSH_EVERY_MS = 30_000
const DISTANCE_METRES = 50
const INTERVAL_MS = 30_000

export type TrackingState =
  'off' | 'starting' | 'on' | 'denied' | 'unavailable' | 'throttled' | 'error'

export interface TripTracking {
  state: TrackingState
  /** Points held on this phone and not yet accepted by the office. */
  buffered: number
  /** Epoch ms of the last batch the office accepted; null until one lands. */
  lastSentAt: number | null
  /** Points the office has accepted on this trip from this phone. */
  accepted: number
  /** False in a browser: a hidden tab stops sending, and the screen must say so. */
  canTrackInBackground: boolean
}

const IDLE: TripTracking = {
  state: 'off',
  buffered: 0,
  lastSentAt: null,
  accepted: 0,
  canTrackInBackground: platformLocation.canTrackInBackground,
}

export interface UseTripTrackingOptions {
  tripId: string | null
  deviceId: string
  /** Track only while the trip is out and the crew has agreed to the notice. */
  enabled: boolean
}

export function useTripTracking({
  tripId,
  deviceId,
  enabled,
}: UseTripTrackingOptions): TripTracking {
  const api = useApi()
  const [snapshot, setSnapshot] = useState<TripTracking>(IDLE)

  const buffer = useRef<GpsPointIn[]>([])
  const sending = useRef(false)
  const retryUntil = useRef(0)
  const acceptedRef = useRef(0)
  const lastSentRef = useRef<number | null>(null)
  const stateRef = useRef<TrackingState>('off')

  const publish = useCallback(() => {
    setSnapshot({
      state: stateRef.current,
      buffered: buffer.current.length,
      lastSentAt: lastSentRef.current,
      accepted: acceptedRef.current,
      canTrackInBackground: platformLocation.canTrackInBackground,
    })
  }, [])

  /**
   * One batch at a time, and the buffer is only emptied for the points that were actually sent — a
   * fix that arrives mid-flight is still there when the reply lands.
   */
  const flush = useCallback(
    async (force: boolean): Promise<void> => {
      if (tripId === null || sending.current) return
      if (buffer.current.length === 0) return
      if (!force && buffer.current.length < BATCH_AT) return
      if (Date.now() < retryUntil.current) return
      const batch = buffer.current.slice(0, BUFFER_LIMIT)
      sending.current = true
      try {
        const answer = await api.api.delivery.gps.points({
          idempotencyKey: `gps:${deviceId}:${String(batch[0]?.recordedAt ?? '')}:${String(batch.length)}`,
          tripId,
          deviceId,
          points: batch,
        })
        if (answer.throttled) {
          // Keep the buffer, wait exactly as long as we were told, and say so on screen.
          retryUntil.current = Date.now() + (answer.retryAfterSeconds ?? 60) * 1000
          stateRef.current = 'throttled'
        } else {
          buffer.current = buffer.current.slice(batch.length)
          acceptedRef.current += answer.accepted
          lastSentRef.current = Date.now()
          stateRef.current = answer.tripState === 'active' ? 'on' : 'off'
        }
      } catch {
        /*
         * A dead spot is the normal case, not an error state on screen: the points stay in the buffer
         * and the next tick tries again. Only the buffer's own ceiling is a fact worth showing, and
         * D1 shows it as a count.
         */
        retryUntil.current = Date.now() + 15_000
      } finally {
        sending.current = false
        publish()
      }
    },
    [api, deviceId, tripId, publish],
  )

  useEffect(() => {
    if (!enabled || tripId === null) {
      buffer.current = []
      stateRef.current = 'off'
      publish()
      return
    }

    let live = true
    let stop: (() => void) | null = null
    stateRef.current = 'starting'
    publish()

    void (async () => {
      if (!platformLocation.canTrackInBackground && typeof navigator === 'undefined') {
        stateRef.current = 'unavailable'
        publish()
        return
      }
      const permission = await platformLocation.requestPermission({ background: true })
      if (!live) return
      if (!permission.granted) {
        stateRef.current = 'denied'
        publish()
        return
      }
      stateRef.current = 'on'
      publish()
      stop = await platformLocation.watch(
        (point) => {
          if (!live) return
          buffer.current.push({
            recordedAt: new Date(point.at).toISOString(),
            lat: point.latitude,
            lng: point.longitude,
            ...(point.accuracy === null ? {} : { accuracyM: point.accuracy }),
          })
          // Oldest first: the office would drop them as stale anyway, and the newest fix is the one
          // that moves the vehicle on the live map.
          if (buffer.current.length > BUFFER_LIMIT) {
            buffer.current = buffer.current.slice(buffer.current.length - BUFFER_LIMIT)
          }
          publish()
          void flush(false)
        },
        { distanceMetres: DISTANCE_METRES, intervalMs: INTERVAL_MS },
      )
      if (!live) stop?.()
    })()

    const timer = setInterval(() => {
      void flush(true)
    }, FLUSH_EVERY_MS)

    return () => {
      live = false
      clearInterval(timer)
      stop?.()
      stateRef.current = 'off'
      publish()
    }
  }, [enabled, tripId, flush, publish])

  return useMemo(() => snapshot, [snapshot])
}
