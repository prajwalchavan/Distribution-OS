/**
 * verify-1 m2 — "No money now" survives a reload for the trip it was said on, and for no other.
 */
import { storage } from '@dos/ui/platform'
import { describe, expect, it } from 'vitest'

import { parsePutOff, putOffKey, readPutOff, savePutOff, serialisePutOff } from './put-off'

describe('"No money now" is kept on this device for one trip', () => {
  it('reads back the stops of the same trip, and none of another', () => {
    const raw = serialisePutOff('trip-1', ['s1', 's2', 's1'])
    expect(parsePutOff(raw, 'trip-1')).toEqual(['s1', 's2'])
    expect(parsePutOff(raw, 'trip-2')).toEqual([])
  })

  it('anything unreadable reads as none', () => {
    expect(parsePutOff(null, 'trip-1')).toEqual([])
    expect(parsePutOff('not json', 'trip-1')).toEqual([])
    expect(parsePutOff('{"tripId":"trip-1","stops":"s1"}', 'trip-1')).toEqual([])
    expect(parsePutOff('{"tripId":"trip-1","stops":["s1",7,null]}', 'trip-1')).toEqual(['s1'])
  })

  it('is written per driver and read back after the app is gone', async () => {
    await savePutOff('driver-a', 'trip-1', ['s3'])
    expect(await readPutOff('driver-a', 'trip-1')).toEqual(['s3'])
    // Another driver on the same device starts with none; the next trip too.
    expect(await readPutOff('driver-b', 'trip-1')).toEqual([])
    expect(await readPutOff('driver-a', 'trip-9')).toEqual([])
    await storage.removeItem(putOffKey('driver-a'))
    expect(await readPutOff('driver-a', 'trip-1')).toEqual([])
  })
})
