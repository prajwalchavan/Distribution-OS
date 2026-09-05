/**
 * Demo data for the OWNER'S HALF of platform support access (`tenancy.support.*`), so the owner app's
 * "who has asked to look inside my books" card has something on it and `/docs` "Try it out" answers a
 * real row rather than a made-up id.
 *
 * Three rows, and no more than three:
 *   - ONE Distribution OS staff user (`dos.support`) with NO membership anywhere. That is the whole
 *     point of `platform_admin`: it is not a membership role, so this account cannot sign in to any of
 *     the six role services — it has no tenant to sign in to. It exists so the grant below has a real
 *     requester with a real name, and so module 13's console has a first administrator to be.
 *   - its `platform_admins` row (`support` level: asks for access and answers tickets; it is not a
 *     `super`, so it cannot open another console account).
 *   - ONE support grant in the `requested` state against the pilot tenant: asked for four hours,
 *     read-only, with the reason our person actually typed. NOTHING IS APPROVED. The owner approving
 *     it is the demo.
 *
 * The full console — subscriptions, onboarding, the platform audit trail — belongs to module 13 and is
 * deliberately not seeded here: this file writes only what the owner app needs to have a screen.
 *
 * Idempotent like every other seed: fixed `demoId()` ids and `onConflictDoNothing()`, so `pnpm db:seed`
 * twice adds nothing. Runs on the owner (BYPASSRLS) connection, and `dos_support_grant_guard()` still
 * binds it — the window below is inside the 30 days the database allows and the requester is an active
 * administrator, because the row above it says so.
 */
import type { Db } from '../client.js'
import { insertMany } from './db-helpers.js'
import { platformAdmins, supportGrants, users } from '../schema/index.js'
import { demoId } from './ids.js'

/** How long our person asked for. `admin.support.request` defaults to the same four hours. */
const REQUESTED_HOURS = 4
const HOUR_MS = 60 * 60 * 1000

export interface SupportSeedResult {
  adminUserId: string
  grantId: string
}

export async function seedPlatformSupport(
  db: Db,
  tenantId: string,
  passwordHash: string,
): Promise<SupportSeedResult> {
  // Global rows: the same person whichever distributor is being seeded, so the id is taken at the root
  // scope. `demoId` namespaces non-global kinds by the demo scope, and a platform admin belongs to no
  // distributor at all — but only the pilot seeds this file, so the scope is empty either way.
  const adminUserId = demoId('platform-user', 'support-1')
  await insertMany(db, users, [
    {
      id: adminUserId,
      phone: '+917000000101',
      name: 'Anita Rao (Distribution OS support)',
      locale: 'en-IN',
      platformRole: 'support' as const,
      username: 'dos.support',
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  ])
  await insertMany(db, platformAdmins, [
    { id: demoId('platform-admin', 'support-1'), userId: adminUserId, role: 'support' as const },
  ])

  // Asked for now, so the window is live for the next four hours whenever the database was seeded —
  // an owner opening the app straight after `pnpm db:seed` has a decision it can actually take. A
  // request found later has simply lapsed, which is the correct thing for it to show.
  const requestedAt = new Date()
  const grantId = demoId('support-grant', 1)
  await insertMany(db, supportGrants, [
    {
      id: grantId,
      tenantId,
      adminUserId,
      requestedAt,
      requestedHours: REQUESTED_HOURS,
      reason:
        'Ticket #4182: three invoices from 2 September will not issue — "numbering series locked". We would like to read the numbering series and the invoice rows to see why.',
      expiresAt: new Date(requestedAt.getTime() + REQUESTED_HOURS * HOUR_MS),
      scope: 'read' as const,
    },
  ])
  return { adminUserId, grantId }
}
