/**
 * The rule `useQuery` follows before it touches the network: a read only runs when there is somebody
 * to read as.
 *
 * The failure this guards against is not theoretical — it was measured on the owner app. Opening any
 * route signed out mounts that route (expo-router must keep rendering the layout's `<Slot/>`, because
 * that is the navigator the redirect to `/sign-in` needs), and every `useQuery` on it fired without a
 * token: five 401s and five error states for a screen the reader never sees.
 */
import { describe, expect, it } from 'vitest'

import { intentHash, readsAllowed } from './index.js'
import type { Session, SessionState } from '../session.js'

const session = {
  user: { id: 'u1', name: 'Sunil Tarsun', mustChangePassword: false },
  tenant: { id: 't1', legalName: 'M/s Tarsun Enterprise', displayName: 'Tarsun Enterprise' },
  role: 'owner',
  memberships: [],
} as unknown as Session

const signedOut: SessionState = { session: null, hydrating: false }
const signedIn: SessionState = { session, hydrating: false }
/** A restored session whose access token is still being refreshed. */
const restoring: SessionState = { session, hydrating: true }
/** Signed in with a password a manager read out loud: every app shows one screen until it is changed. */
const temporaryPassword: SessionState = {
  session: { ...session, user: { ...session.user, mustChangePassword: true } },
  hydrating: false,
}

describe('readsAllowed', () => {
  it('refuses every read while nobody is signed in', () => {
    expect(readsAllowed(signedOut, true)).toBe(false)
  })

  it('allows a read once there is a session', () => {
    expect(readsAllowed(signedIn, true)).toBe(true)
  })

  it('does NOT wait for the boot-time refresh: a restored session is a session', () => {
    expect(readsAllowed(restoring, true)).toBe(true)
  })

  it('refuses reads while the password is still somebody else’s (docs/23 §0 X2)', () => {
    expect(readsAllowed(temporaryPassword, true)).toBe(false)
  })

  it('still honours the screen’s own `enabled` flag', () => {
    expect(readsAllowed(signedIn, false)).toBe(false)
    expect(readsAllowed(signedOut, false)).toBe(false)
  })
})

/**
 * What makes two calls of one write hook the SAME intent.
 *
 * A hook lives as long as the screen and a screen writes over and over. The settings page proved it:
 * saving "proof of delivery = every bill" and then "= credit bills only" sent both payloads under one
 * idempotency key and the service answered `409 Conflict` — correctly, since a key may not be reused
 * for different content. The approvals queue has the same shape and would have decided exactly one
 * row per page load.
 */
describe('intentHash', () => {
  it('is the same for the same payload, whatever order the object was built in', () => {
    expect(intentHash({ id: 'a', decision: 'approve' })).toBe(
      intentHash({ decision: 'approve', id: 'a' }),
    )
  })

  it('separates two different decisions, so the second one gets its own key', () => {
    expect(intentHash({ id: 'a', decision: 'approve' })).not.toBe(
      intentHash({ id: 'b', decision: 'approve' }),
    )
    expect(intentHash([{ key: 'delivery.pod_required', value: 'always' }])).not.toBe(
      intentHash([{ key: 'delivery.pod_required', value: 'credit_only' }]),
    )
  })

  it('handles the payload-less write (`mutate(null)`) without inventing a new intent each time', () => {
    expect(intentHash(null)).toBe(intentHash(null))
  })

  it('treats a value JSON cannot carry as its own intent rather than throwing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => intentHash(cyclic)).not.toThrow()
    expect(intentHash(cyclic)).not.toBe(intentHash(cyclic))
  })
})
