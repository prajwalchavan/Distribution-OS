/**
 * DOS-056 — the doorstep write never depends on the office answering.
 *
 * `recordOrSave` is the one decision D4 makes: with a signal it records at the office, and when the
 * office never answers — a browser `TypeError`, the 20 s deadline, or Expo's native `FetchError` on a
 * phone whose online flag is still green — the same delivery goes into the outbox instead. A write the
 * office REFUSED is never queued: the refusal is the answer.
 *
 * Pure rules only: no database, no network, no React.
 */
import { ApiError, ORPCError, toApiError } from '@dos/api-client'
import { describe, expect, it, vi } from 'vitest'

import { noSignal, recordOrSave } from './doorstep'

/** What expo/fetch throws on Android when the service is not reachable (expo/src/winter/fetch). */
const expoFetchError = (): Error =>
  new Error('fetch failed: java.net.ConnectException: Failed to connect to /127.0.0.1:3005')

describe('recordOrSave', () => {
  it("DOS-056 saves the delivery on the phone when the office call fails with Expo's native FetchError while the online flag is still true", async () => {
    // Raw, as `files.upload`'s PUT throws it, and typed, as `useMutation` rethrows it.
    for (const failure of [expoFetchError(), toApiError(expoFetchError())]) {
      const send = vi.fn(() => Promise.reject(failure))
      const save = vi.fn(() => Promise.resolve())
      const result = await recordOrSave({ online: true, send, save })
      expect(result).toEqual({ via: 'phone' })
      expect(send).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledTimes(1)
      expect(noSignal(failure)).toBe(true)
    }
  })

  it('DOS-056 saves the delivery on the phone when the browser fetch throws TypeError or the request hits the deadline', async () => {
    const deadline = new Error('signal timed out')
    deadline.name = 'TimeoutError'
    const failures: Error[] = [
      new TypeError('Failed to fetch'),
      deadline,
      new ApiError({ kind: 'network', message: 'No connection.' }),
    ]
    for (const failure of failures) {
      const save = vi.fn(() => Promise.resolve())
      const result = await recordOrSave({
        online: true,
        send: () => Promise.reject(failure),
        save,
      })
      expect(result).toEqual({ via: 'phone' })
      expect(save).toHaveBeenCalledTimes(1)
    }
  })

  it('DOS-056 never queues a write the office refused (business/validation/conflict/server ApiError is rethrown, save not called)', async () => {
    const refusals: Error[] = [
      new ORPCError('BAD_REQUEST', { status: 400, message: 'the damaged bin takes this back' }),
      new ORPCError('FORBIDDEN', { status: 403, message: 'Forbidden' }),
      new ORPCError('CONFLICT', { status: 409, message: 'stop is already delivered' }),
      new ORPCError('INTERNAL_SERVER_ERROR', { status: 500, message: 'boom' }),
      new ApiError({ kind: 'business', message: 'That could not be done.' }),
      new ApiError({ kind: 'validation', message: 'Check the highlighted field.' }),
      new Error('Upload failed with 403'),
    ]
    for (const refusal of refusals) {
      const save = vi.fn(() => Promise.resolve())
      await expect(
        recordOrSave({ online: true, send: () => Promise.reject(refusal), save }),
      ).rejects.toBe(refusal)
      expect(save).not.toHaveBeenCalled()
      expect(noSignal(refusal)).toBe(false)
    }
  })

  it('DOS-056 with no signal goes straight to the phone and never calls the office', async () => {
    const send = vi.fn(() => Promise.resolve('recorded'))
    const save = vi.fn(() => Promise.resolve())
    const result = await recordOrSave({ online: false, send, save })
    expect(result).toEqual({ via: 'phone' })
    expect(send).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)

    const office = await recordOrSave({ online: true, send, save: vi.fn() })
    expect(office).toEqual({ via: 'office', value: 'recorded' })
  })
})
