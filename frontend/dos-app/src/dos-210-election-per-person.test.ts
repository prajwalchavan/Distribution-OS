/**
 * DOS-210 — the device remembered the LAST person's elected role and sent it for the NEXT person.
 *
 * Found on day 0 of the business simulation: after `vikas.kadam` continued as Manager on a shared
 * desk browser, `meena.joshi`'s sign-in went to the wire as `actAs: "manager"`, took a 403 naming
 * the manager role she never asked for, and was signed in only by the silent retry. The remembered
 * election is now keyed on the username: a choice travels with the person who made it and nobody
 * else, so the next person on that desk signs in as their own role at the first POST.
 *
 * These run against the REAL `platform.storage` the app writes through (the memory map in a Vitest
 * run, `localStorage` in a browser, the Keychain cache on a phone) under the real key.
 */
import type { Session } from '@dos/api-client'
import type { MembershipRole } from '@dos/contracts'
import { storage } from '@dos/ui/platform'
import { beforeEach, describe, expect, it } from 'vitest'

import { LAST_ROLE_KEY } from './api'
import { forgetRole, lastRole, preselectedRole, rememberRole } from './election'

const TARSUN = '01924f9a-0000-7000-8000-0000000000aa'

function session(username: string, own: MembershipRole): Session {
  return {
    user: {
      id: '01924f9a-0000-7000-8000-0000000000b1',
      username,
      name: username,
      locale: 'en-IN',
      mustChangePassword: false,
    },
    tenant: {
      id: TARSUN,
      slug: 'tarsun',
      legalName: 'Tarsun Enterprises',
      displayName: 'Tarsun Enterprises',
      logoUrl: null,
    },
    role: own,
    memberships: [
      {
        tenantId: TARSUN,
        tenantSlug: 'tarsun',
        tenantName: 'Tarsun Enterprises',
        displayName: 'Tarsun Enterprises',
        logoUrl: null,
        role: own,
        extraRoles: [],
        status: 'active',
      },
    ],
  }
}

describe('DOS-210: the remembered election belongs to the person who made it', () => {
  beforeEach(() => {
    forgetRole()
  })

  it('gives the next person on a shared desk nothing to send: no actAs, no 403', () => {
    rememberRole('vikas.kadam', 'manager')
    // Meena's sign-in reads this before the POST; null means the login carries no actAs at all.
    expect(lastRole('meena.joshi')).toBeNull()
  })

  it('still gives the same person their own choice back, so they tap once', () => {
    rememberRole('sunil.tarsun', 'delivery')
    expect(lastRole('sunil.tarsun')).toBe('delivery')
  })

  it('matches the username the way the auth service does: trimmed, any case', () => {
    rememberRole(' Sunil.Tarsun ', 'warehouse')
    expect(lastRole('sunil.tarsun')).toBe('warehouse')
    expect(lastRole('SUNIL.TARSUN  ')).toBe('warehouse')
  })

  it('opens the chooser on the person’s OWN role when the last choice was somebody else’s', () => {
    rememberRole('sunil.tarsun', 'delivery')
    // Vikas is a manager; the owner's "delivery" is permitted to him too, and must still not be his.
    expect(preselectedRole(session('vikas.kadam', 'manager'))).toBe('manager')
    expect(preselectedRole(session('sunil.tarsun', 'owner'))).toBe('delivery')
  })

  it('forgets a bare role written before DOS-210: nobody knows whose it was', () => {
    storage.setItemSync(LAST_ROLE_KEY, 'manager')
    expect(lastRole('vikas.kadam')).toBeNull()
    expect(lastRole('meena.joshi')).toBeNull()
  })

  it('ignores anything in the key that is not a remembered election', () => {
    for (const junk of ['{', '42', 'null', '{"role":"manager"}', '{"username":"x","role":7}']) {
      storage.setItemSync(LAST_ROLE_KEY, junk)
      expect(lastRole('x')).toBeNull()
    }
  })

  it('drops a remembered role that no group can open', () => {
    storage.setItemSync(
      LAST_ROLE_KEY,
      JSON.stringify({ username: 'dos.admin', role: 'platform_admin' }),
    )
    expect(lastRole('dos.admin')).toBeNull()
  })

  it('a refused election forgets the choice for everybody', () => {
    rememberRole('sunil.tarsun', 'delivery')
    forgetRole()
    expect(lastRole('sunil.tarsun')).toBeNull()
  })
})
