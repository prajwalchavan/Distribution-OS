import { ORPCError } from '@orpc/client'
import { describe, expect, it } from 'vitest'

import { ApiError, toApiError } from './errors.js'

describe('toApiError', () => {
  it('maps the statuses a screen has to behave differently for', () => {
    const cases: [number, string][] = [
      [400, 'validation'],
      [401, 'auth'],
      [403, 'permission'],
      [404, 'notFound'],
      [409, 'conflict'],
      [422, 'validation'],
      [423, 'suspended'],
      [418, 'business'],
      [500, 'server'],
      [503, 'server'],
    ]
    for (const [status, kind] of cases) {
      const err = toApiError(new ORPCError('BAD', { status, message: 'x' }))
      expect(err.kind, `status ${status}`).toBe(kind)
      expect(err.status).toBe(status)
    }
  })

  it('keeps the service’s own sentence, which is already business language', () => {
    const err = toApiError(
      new ORPCError('CREDIT_LIMIT', {
        status: 409,
        message: 'This order takes Shree Ganesh ₹3,200 over its limit.',
      }),
    )
    expect(err.message).toBe('This order takes Shree Ganesh ₹3,200 over its limit.')
  })

  it('falls back to a sentence a distributor can act on when the service sends none', () => {
    const err = toApiError(new ORPCError('X', { status: 403, message: '' }))
    expect(err.message).toBe('You do not have access to this.')
  })

  it('turns a dead network into `network`, never a raw TypeError', () => {
    const err = toApiError(new TypeError('Failed to fetch'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('treats an abort or a timeout as a network failure', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(toApiError(abort).kind).toBe('network')
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    expect(toApiError(timeout).kind).toBe('network')
  })

  it('passes an ApiError through unchanged', () => {
    const original = new ApiError({ kind: 'business', message: 'Already confirmed.' })
    expect(toApiError(original)).toBe(original)
  })

  it('never lets an unknown throw reach a screen untyped', () => {
    const err = toApiError('boom')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe('unknown')
    expect(err.message).toBe('Something could not be completed. Try again.')
  })

  it('marks only network and server failures as worth a "Try again"', () => {
    expect(toApiError(new ORPCError('X', { status: 500 })).retryable).toBe(true)
    expect(toApiError(new ORPCError('X', { status: 403 })).retryable).toBe(false)
    expect(toApiError(new ORPCError('X', { status: 409 })).retryable).toBe(false)
  })
})
