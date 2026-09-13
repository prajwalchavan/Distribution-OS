/**
 * DOS-109 — one platform audit row, read by a person: who acted, why, and what changed.
 *
 * The payloads are the shapes the five `platform_audit` writers store, as found on dos_qa on 12-13 Sep
 * 2026 (demo staff names only): a suspension `{from,to,reason}`, a plan change
 * `{plan,status,amountPaise,billingInterval,from}`, an ask `{grantId,hours,scope,reason}`, a withdrawal
 * `{grantId,was,now,reason}`, a support read `{grantId,scope,method,route,outcome}`, a lock
 * `{userId,username,reason}` and an onboarding `{slug,plan,ownerUserId,trialDays}`. Two partial rows an
 * rls.test fixture left there are kept on purpose: `support.requested` with only a `grantId`, and
 * `support.opened`, an action no production writer uses.
 *
 * Pure rules only: no database, no network, no React.
 */
import type { PlatformAuditEntry } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { auditChange, auditReason, auditWho, type AuditFormat } from './audit'

const catalogue: Readonly<Record<string, string>> = strings

/** `t(key, vars)` over this app's catalogue, `{name}` interpolated the way the kit's translator does. */
const t: AuditFormat['t'] = (key, params) =>
  (catalogue[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params?.[name]
    return value === undefined ? whole : String(value)
  })

/** `word.<value>` from the same catalogue, the raw value when it has none. */
const word: AuditFormat['word'] = (value) =>
  value === null || value === undefined || value === ''
    ? '—'
    : (catalogue[`word.${value}`] ?? value)

const fmt: AuditFormat = { t, word, money: (paise) => `₹${(paise / 100).toFixed(2)}` }

// dos_qa ids: the two console accounts, the distributorship and the grant; the rest only need to be ids.
const ROHIT = '0198f3a2-51c4-7a10-9e2d-6b7c8d9e0f11' // dos.admin, super
const ANITA = '0198f3a2-51c4-7b22-8f3e-7c8d9e0f1a22' // dos.support, support
const TARSUN = '0198e1b0-0a1b-7c2d-9e3f-4a5b6c7d8e90'
const GRANT = 'dc9b8792-4f1e-7a3b-9c5d-6e7f8a9b0c1d'
const SALESMAN = '0198e1b0-3c4d-7e5f-8a6b-7c8d9e0f1a2b'

let sequence = 0

/** One row as `admin.audit.list` answers it, filed under dos.admin on Tarsun unless told otherwise. */
function row(
  action: string,
  after: Record<string, unknown> | null,
  overrides: Partial<PlatformAuditEntry> = {},
): PlatformAuditEntry {
  sequence += 1
  return {
    id: `0198f3b0-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    actorId: ROHIT,
    actorRole: 'platform_admin',
    actorName: 'Rohit Nair (Distribution OS)',
    action,
    entityType: action.split('.')[0] ?? 'platform',
    entityId: TARSUN,
    before: null,
    after,
    deviceId: null,
    occurredAt: '2026-09-12T10:41:07.000Z',
    tenantId: TARSUN,
    tenantSlug: 'tarsun',
    tenantName: 'M/s. Tarsun Enterprise',
    ...overrides,
  }
}

describe('DOS-109 — a platform audit row, read by a person', () => {
  it('DOS-109: Who is the staff member\'s name from the row, never "Distribution OS staff"; the role word only when the service sent no name', () => {
    const suspension = row('tenant.suspended', {
      from: 'active',
      to: 'suspended',
      reason: 'DOS-109 verify: suspend',
    })
    const ask = row(
      'support.requested',
      { grantId: GRANT, hours: 4, scope: 'read_only', reason: 'DOS-109 verify: support ask' },
      { actorId: ANITA, actorName: 'Anita Rao (Distribution OS support)' },
    )
    expect(auditWho(suspension, word)).toBe('Rohit Nair (Distribution OS)')
    expect(auditWho(ask, word)).toBe('Anita Rao (Distribution OS support)')
    expect([auditWho(suspension, word), auditWho(ask, word)]).not.toContain('Distribution OS staff')

    // Only a row the server could not name falls back to the role word.
    expect(auditWho({ ...suspension, actorName: null }, word)).toBe('Distribution OS staff')
  })

  it('DOS-109: a suspension reads "Active → Suspended" and carries the reason typed into the dialog; a reactivation without a note has no reason', () => {
    const suspension = row('tenant.suspended', {
      from: 'active',
      to: 'suspended',
      reason: 'Subscription unpaid for 45 days.',
    })
    expect(auditChange(suspension, fmt)).toBe('Active → Suspended')
    expect(auditReason(suspension)).toBe('Subscription unpaid for 45 days.')

    const reactivation = row('tenant.reactivated', {
      from: 'suspended',
      to: 'active',
      reason: null,
    })
    expect(auditChange(reactivation, fmt)).toBe('Suspended → Active')
    expect(auditReason(reactivation)).toBeNull()
    // A blank note is no reason either.
    expect(
      auditReason(row('tenant.reactivated', { from: 'suspended', to: 'active', reason: ' ' })),
    ).toBeNull()
  })

  it('DOS-109: a plan change reads the old plan, state and price before the new ones, and the stored "trial" reads as On trial', () => {
    const newer = {
      plan: 'pro',
      status: 'active',
      amountPaise: 499_900,
      billingInterval: 'monthly',
    }
    // Written before amendment (a): `from.status` is the column's `trial` (the dos_qa row).
    const onDisk = row('subscription.updated', {
      ...newer,
      from: { plan: 'standard', status: 'trial', amountPaise: 199_900 },
    })
    // Written after it: the wire's own `trialing`, like the top-level `status`.
    const written = row('subscription.updated', {
      ...newer,
      from: { plan: 'standard', status: 'trialing', amountPaise: 199_900 },
    })
    expect(auditChange(onDisk, fmt)).toBe(
      'Standard · On trial · ₹1999.00 → Pro · Active · ₹4999.00',
    )
    expect(auditChange(written, fmt)).toBe(auditChange(onDisk, fmt))

    const created = row('subscription.created', {
      plan: 'starter',
      status: 'trialing',
      amountPaise: 99_900,
      billingInterval: 'monthly',
      from: null,
    })
    expect(auditChange(created, fmt)).toBe('Starter · On trial · ₹999.00')
    expect(auditReason(created)).toBeNull()
  })

  it('DOS-109: a support read names its route and outcome, a withdrawal reads "Open → Handed back" with its reason, and a lock names the login', () => {
    const read = row('support.read', {
      grantId: GRANT,
      scope: 'read_only',
      method: 'GET',
      route: 'GET /retailers',
      outcome: 'ok',
    })
    expect(auditChange(read, fmt)).toBe('GET /retailers · Answered')
    expect(auditReason(read)).toBeNull()
    const refused = row('support.read', {
      grantId: GRANT,
      scope: 'read_only',
      method: 'POST',
      route: 'POST /retailers',
      outcome: 'refused',
    })
    expect(auditChange(refused, fmt)).toBe('POST /retailers · Refused')

    const handedBack = row('support.withdrawn', {
      grantId: GRANT,
      was: 'approved',
      now: 'revoked',
      reason: 'Finished on the call.',
    })
    expect(auditChange(handedBack, fmt)).toBe('Open → Handed back')
    expect(auditReason(handedBack)).toBe('Finished on the call.')

    const lock = row('user.disabled', {
      userId: SALESMAN,
      username: 'ramesh.tarsun',
      reason: 'Phone lost; lock until it is replaced.',
    })
    expect(auditChange(lock, fmt)).toBe('ramesh.tarsun')
    expect(auditReason(lock)).toBe('Phone lost; lock until it is replaced.')
  })

  it('DOS-109: withdrawing an ask the owner never answered reads "Waiting for their owner → Handed back", never that the owner refused', () => {
    // Amendment (b): `now: 'rejected'` only means nobody had answered yet; the console handed it back.
    const withdrawn = row('support.withdrawn', {
      grantId: GRANT,
      was: 'requested',
      now: 'rejected',
      reason: 'Solved on the phone.',
    })
    const line = auditChange(withdrawn, fmt)
    expect(line).toBe('Waiting for their owner → Handed back')
    expect(line).not.toContain('Refused')
    expect(auditReason(withdrawn)).toBe('Solved on the phone.')
  })

  it('DOS-109: an action the console does not know, or a payload missing a field the line needs (support.requested with only a grantId), gives no change line instead of throwing or printing undefined', () => {
    // The two rls.test fixture rows on dos_qa.
    const fixtures = [
      row('support.opened', { grantId: GRANT }),
      row('support.requested', { grantId: GRANT }),
    ]
    // The same actions with every field their line prints, for contrast.
    expect(
      auditChange(
        row('support.requested', { grantId: GRANT, hours: 4, scope: 'read_only', reason: 'x' }),
        fmt,
      ),
    ).toBe('Read only · 4 h')
    expect(
      auditChange(
        row('tenant.onboarded', {
          slug: 'sai',
          plan: 'standard',
          ownerUserId: SALESMAN,
          trialDays: 30,
        }),
        fmt,
      ),
    ).toBe('Standard · 30-day trial')

    const partial = [
      ...fixtures,
      row('tenant.onboarded', { slug: 'sai', plan: 'standard' }),
      row('tenant.suspended', { from: 'active' }),
      row('tenant.suspended', null),
      row('subscription.updated', {
        plan: 'pro',
        status: 'active',
        amountPaise: '4999',
        from: { plan: 'standard', status: 'active', amountPaise: 199_900 },
      }),
      row('subscription.updated', {
        plan: 'pro',
        status: 'active',
        amountPaise: 499_900,
        from: null,
      }),
      row('subscription.created', { plan: 'pro', amountPaise: 499_900 }),
      row('support.requested', { grantId: GRANT, hours: '4', scope: 'read_only' }),
      row('support.withdrawn', { grantId: GRANT, now: 'revoked' }),
      row('support.read', { grantId: GRANT, route: 'GET /retailers' }),
      row('user.disabled', { userId: SALESMAN }),
    ]
    for (const entry of partial) {
      const label = `${entry.action} ${JSON.stringify(entry.after)}`
      expect(() => auditChange(entry, fmt), label).not.toThrow()
      expect(auditChange(entry, fmt), label).toBeNull()
      expect(() => auditReason(entry), label).not.toThrow()
    }
    expect(auditReason(row('tenant.suspended', null))).toBeNull()
  })
})
