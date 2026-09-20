/**
 * DOS-111 — the distributor must see what support read under the window it opened.
 *
 * Under a 72-hour window for ticket #4207 the console read `GET /retailers`, `GET
 * /tenant-catalog/costs` (purchase costs) and `GET /receivables/outstanding` (every shop's dues).
 * The owner's Settings › Audit showed set-credit, exports and GPS reads — and not one of those
 * three, because the reads were written only to `platform_audit`, which nobody outside Distribution
 * OS can read. The server now writes the same fact into the tenant's own `audit_log`
 * (`support-audit.interceptor.ts`), under the grant, with `actorRole: 'platform_admin'`.
 *
 * These are the two rules the owner's screens read those rows by, and nothing more: who the row
 * names (an outsider has no staff row, so `names.staff()` could only print eight characters of a
 * uuid), and what was read under ONE window, newest first.
 */
import { describe, expect, it } from 'vitest'

import { supportReads, auditWho, type AuditRow } from './support-reads'

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 'a1',
  actorId: 'rohit-uuid',
  actorRole: 'owner',
  action: 'setting.set',
  entityType: 'setting',
  entityId: 'branding.displayName',
  after: null,
  occurredAt: '2026-09-13T10:00:00.000Z',
  ...over,
})

const staff = (id: string): string => (id === 'sunil-uuid' ? 'Sunil Tarsun' : id.slice(0, 8))
const word = (value: string): string =>
  value === 'platform_admin' ? 'Distribution OS staff' : value

describe('DOS-111: the owner reads what support read', () => {
  it('names an outsider by what they are, and a colleague by their name', () => {
    expect(auditWho(row({ actorId: 'sunil-uuid', actorRole: 'owner' }), staff, word)).toBe(
      'Sunil Tarsun',
    )
    expect(
      auditWho(
        row({ actorId: 'rohit-uuid', actorRole: 'platform_admin', action: 'support.read' }),
        staff,
        word,
      ),
    ).toBe('Distribution OS staff')
  })

  it('lists the reads made under ONE window, newest first, by the route they named', () => {
    const grant = '0198f3a2-51c4-7a10-9e2d-6b7c8d9e0f11'
    const other = '0198f3a2-51c4-7b22-8f3e-7c8d9e0f1a22'
    const rows: AuditRow[] = [
      row({
        id: 'r1',
        action: 'support.read',
        entityType: 'support_grant',
        entityId: grant,
        after: { route: 'GET /retailers', outcome: 'ok' },
        occurredAt: '2026-09-13T10:00:00.000Z',
      }),
      row({
        id: 'r2',
        action: 'support.read',
        entityType: 'support_grant',
        entityId: grant,
        after: { route: 'GET /tenant-catalog/costs', outcome: 'ok' },
        occurredAt: '2026-09-13T10:05:00.000Z',
      }),
      // Another window's read, and one of the owner's own rows: neither belongs under this window.
      row({
        id: 'r3',
        action: 'support.read',
        entityType: 'support_grant',
        entityId: other,
        after: { route: 'GET /receivables/outstanding', outcome: 'ok' },
        occurredAt: '2026-09-13T10:06:00.000Z',
      }),
      row({ id: 'r4', entityId: grant, action: 'support.approve', entityType: 'support_grant' }),
    ]
    expect(supportReads(rows, grant)).toEqual([
      { id: 'r2', at: '2026-09-13T10:05:00.000Z', route: 'GET /tenant-catalog/costs' },
      { id: 'r1', at: '2026-09-13T10:00:00.000Z', route: 'GET /retailers' },
    ])
  })

  it('keeps a row whose payload is not the shape this build knows, without a route', () => {
    const grant = 'g1'
    expect(
      supportReads(
        [
          row({
            id: 'r9',
            action: 'support.read',
            entityType: 'support_grant',
            entityId: grant,
            after: { grantId: grant },
          }),
        ],
        grant,
      ),
    ).toEqual([{ id: 'r9', at: '2026-09-13T10:00:00.000Z', route: null }])
  })
})
