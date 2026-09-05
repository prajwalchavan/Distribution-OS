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
import { and, asc, eq, inArray } from 'drizzle-orm'
import { businessDate } from '@dos/domain'
import type { Db } from '../client.js'
import { insertMany } from './db-helpers.js'
import {
  memberships,
  platformAdmins,
  subscriptions,
  supportGrants,
  tenants,
  users,
} from '../schema/index.js'
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

// ---------------------------------------------------------------------------------------------------------------
// MODULE 13's own half: the console account, the subscriptions and the two decided grants

/** The console's demo sign-in — `dos.admin` / `Dos@1234`, the account `pnpm smoke` opens :3007 with. */
export const DEMO_PLATFORM_ADMIN_USERNAME = 'dos.admin'

/** The three distributors `pnpm db:seed` writes (seed.ts and `seed-demo/tenants.ts`), and no others. */
const DEMO_TENANT_SLUGS = ['tarsun', 'sai-distributors', 'kalyan-agencies'] as const

/**
 * How long the seeded ACTIVE support window runs. Twenty-nine days, one short of the thirty
 * `dos_support_grant_guard()` allows, so a database seeded today still has a live window a month from
 * now and the `/docs` example for `auth.supportPass` keeps working without a re-seed.
 */
const ACTIVE_GRANT_DAYS = 29
const DAY_MS = 24 * 60 * 60 * 1000

export interface PlatformConsoleSeedResult {
  adminUserId: string
  activeGrantId: string | null
  expiredGrantId: string | null
}

/**
 * The platform console's own demo data (module 13, founder decision 2026-09-05). Runs ONCE for the
 * whole database, after every distributor has been seeded — not per tenant — because everything it
 * writes is global or spans tenants:
 *
 *   - `dos.admin`, a SUPER administrator: the account that onboards, suspends and sets plans, and the
 *     one `pnpm smoke` signs in with at `POST /auth/platform/login`. It holds NO membership anywhere,
 *     which is the whole point of `platform_admin` — it cannot sign in to any of the six role
 *     services, because it has no distributor to sign in to.
 *   - one `subscriptions` row per distributor: the pilot is a paying customer (`active`), the other
 *     two are inside their free window (`trial`), so the console's home list shows both states and
 *     `admin.subscriptions.list --status trialing` returns something.
 *   - two DECIDED support grants against the pilot, on top of the pending one `seedPlatformSupport`
 *     writes: one APPROVED and live (so `auth.supportPass` has a grant to exchange and the owner app's
 *     "who is inside my books right now" card is not empty) and one that has EXPIRED (so the history
 *     is not all one colour). Both are approved by the pilot's own owner, because the database refuses
 *     any other approver — `dos_support_grant_guard()` requires an ACTIVE OWNER MEMBERSHIP of that very
 *     tenant, and never the requester.
 *
 * Idempotent like every other seed: fixed `demoId()` ids and `onConflictDoNothing()`. Note that the
 * four console tables have NO delete policy and `platform_audit` is append-only, so a re-seed can only
 * ever be upsert-shaped — never delete-then-insert.
 */
export async function seedPlatformConsole(
  db: Db,
  passwordHash: string,
): Promise<PlatformConsoleSeedResult> {
  const adminUserId = demoId('platform-user', 'admin-1')
  await insertMany(db, users, [
    {
      id: adminUserId,
      phone: '+917000000100',
      name: 'Rohit Nair (Distribution OS)',
      locale: 'en-IN',
      platformRole: 'support' as const,
      username: DEMO_PLATFORM_ADMIN_USERNAME,
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  ])
  await insertMany(db, platformAdmins, [
    // `super`: opens and closes other console accounts. `created_by` is null on purpose — the founding
    // row is written by the migrating connection, which is the only bootstrap the guard trigger allows.
    { id: demoId('platform-admin', 'admin-1'), userId: adminUserId, role: 'super' as const },
  ])

  // ONLY the three demo distributors. `tenants` in a developer's database also holds the throwaway
  // fixtures every `describeDb` spec creates (thousands of them after a few days — see CLAUDE.md,
  // "the dev database accumulates test rows"), and writing a subscription for each of those would make
  // the console's own list unreadable and the seed slow, for rows nobody will ever look at.
  const rows = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.slug, [...DEMO_TENANT_SLUGS]))
    .orderBy(asc(tenants.createdAt), asc(tenants.id))
  const today = businessDate().date
  await insertMany(
    db,
    subscriptions,
    rows.map((tenant, index) => {
      // The pilot pays; everyone else is still in the free window. Two states on one screen.
      const paying = tenant.slug === 'tarsun'
      return {
        id: demoId('subscription', tenant.slug),
        tenantId: tenant.id,
        plan: paying ? 'pro' : 'standard',
        status: paying ? 'active' : 'trial',
        trialEndsAt: paying ? null : new Date(Date.now() + (20 - index) * DAY_MS),
        periodStart: today,
        periodEnd: addIstDays(today, 30),
        seats: paying ? 25 : 10,
        // ₹4,999 and ₹1,999 a month, in integer paise. Our price to the distributor, never theirs.
        pricePaiseMonth: paying ? 499_900 : 199_900,
        billingInterval: 'monthly' as const,
        notes: paying ? 'Pilot customer, Kalyan West.' : 'Free trial from onboarding.',
        updatedBy: adminUserId,
      }
    }),
  )

  // The two decided grants belong to the pilot, which is the tenant every /docs example points at.
  const [pilot] = rows.filter((t) => t.slug === 'tarsun')
  if (!pilot) return { adminUserId, activeGrantId: null, expiredGrantId: null }
  const [owner] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, pilot.id),
        eq(memberships.role, 'owner'),
        eq(memberships.status, 'active'),
      ),
    )
    .orderBy(asc(memberships.createdAt))
    .limit(1)
  if (!owner) return { adminUserId, activeGrantId: null, expiredGrantId: null }

  const now = new Date()
  const activeGrantId = demoId('support-grant', 'active')
  const expiredGrantId = demoId('support-grant', 'expired')
  await insertMany(db, supportGrants, [
    {
      id: activeGrantId,
      tenantId: pilot.id,
      adminUserId,
      requestedAt: now,
      requestedHours: 72,
      reason:
        'Ticket #4207: the August GST register does not tie to the sales register by ₹1,240. We would like to read the invoices and credit notes for August to find the difference.',
      approvedBy: owner.userId,
      approvedAt: now,
      expiresAt: new Date(now.getTime() + ACTIVE_GRANT_DAYS * DAY_MS),
      decisionNote: 'Go ahead, read only please.',
      scope: 'read' as const,
    },
    {
      // Ten days ago, approved for four hours, long since closed by the clock: the history row.
      id: expiredGrantId,
      tenantId: pilot.id,
      adminUserId,
      requestedAt: new Date(now.getTime() - 10 * DAY_MS),
      requestedHours: 4,
      reason:
        'Ticket #3990: a delivery trip would not close — the crew reported a cash variance the app kept refusing. We would like to read the trip and its collections.',
      approvedBy: owner.userId,
      approvedAt: new Date(now.getTime() - 10 * DAY_MS),
      expiresAt: new Date(now.getTime() - 10 * DAY_MS + 4 * 60 * 60 * 1000),
      decisionNote: 'Approved for the four hours asked.',
      scope: 'read' as const,
    },
  ])
  return { adminUserId, activeGrantId, expiredGrantId }
}

/** `2026-09-06` + n days, still an IST business date (the same arithmetic `@dos/core` uses). */
function addIstDays(date: string, days: number): string {
  return businessDate(new Date(`${date}T00:00:00+05:30`).getTime() + days * DAY_MS).date
}
