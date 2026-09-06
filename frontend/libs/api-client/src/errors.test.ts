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

  /**
   * What owner-service really answers a shopkeeper who signs into the wrong app. `ORPCError.message`
   * carries the machine word from `error`; the sentence is in `body.message` and is the whole point.
   */
  it('prefers the service’s own sentence over the machine word beside it', () => {
    const err = toApiError(
      new ORPCError('FORBIDDEN', {
        status: 403,
        message: 'Forbidden',
        data: {
          body: {
            message: 'owner-service does not serve the retailer role',
            error: 'Forbidden',
            statusCode: 403,
          },
          status: 403,
        },
      }),
    )
    expect(err.message).toBe('owner-service does not serve the retailer role')
    expect(err.kind).toBe('permission')
  })

  it('shows the FIRST of a validation body’s messages, not the array', () => {
    const err = toApiError(
      new ORPCError('BAD_REQUEST', {
        status: 400,
        message: 'Bad Request',
        data: { body: { message: ['quantity must be a positive integer'], error: 'Bad Request' } },
      }),
    )
    expect(err.message).toBe('quantity must be a positive integer')
  })

  it('treats a message that is only the code, in ANY case, as no message at all', () => {
    // `Forbidden` and `FORBIDDEN` are the same machine word (UX-00 §12 forbids both on screen).
    expect(
      toApiError(new ORPCError('FORBIDDEN', { status: 403, message: 'Forbidden' })).message,
    ).toBe('You do not have access to this.')
    expect(
      toApiError(new ORPCError('BAD_REQUEST', { status: 400, message: 'Bad Request' })).message,
    ).toBe('Check the highlighted field and try again.')
    expect(
      toApiError(
        new ORPCError('FORBIDDEN', {
          status: 403,
          message: 'Forbidden',
          data: { body: { message: 'Forbidden', error: 'Forbidden' } },
        }),
      ).message,
    ).toBe('You do not have access to this.')
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
