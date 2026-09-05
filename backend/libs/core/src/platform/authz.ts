import { ORPCError } from '@orpc/server'
import type { ActorRole } from '@dos/db'
import { currentTenant } from './tenant-context.js'

export const BACK_OFFICE: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']
export const STAFF: readonly ActorRole[] = [
  'owner',
  'manager',
  'salesperson',
  'warehouse',
  'delivery',
  'accountant',
  'system',
]
export const OWNER: readonly ActorRole[] = ['owner', 'system']

/**
 * Who RUNS the distributorship (docs/22 decision 2026-09-05, `MANAGEMENT` in permissions.ts): the
 * owner and the manager set prices, schemes, overrides and credit terms, decide approvals and
 * bargains, confirm orders and edit the catalog overlay. The accountant is deliberately absent —
 * it is the MONEY_DESK (office receipts, banking, bounces, allocations, write-offs, statements) and
 * reads everything else. `system` rides along for the worker and the escalation pattern.
 */
export const MANAGEMENT: readonly ActorRole[] = ['owner', 'manager', 'system']
export const MONEY_DESK: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']
/** Who brings a person or a shop into the network, creates beats and assigns them (docs/17 item 27). */
export const ONBOARDERS: readonly ActorRole[] = ['owner', 'manager', 'system']
/** Every member of the tenant, the shopkeeper included. */
export const ANY_MEMBER: readonly ActorRole[] = [...STAFF, 'retailer']

/**
 * Application-level role check. RLS is the guarantee; this gives the caller a clear 403 instead of an
 * empty result or a silent no-op, and keeps role rules readable in one place per procedure.
 */
export function requireRole(roles: readonly ActorRole[]): void {
  const ctx = currentTenant()
  if (!roles.includes(ctx.actorRole)) {
    throw new ORPCError('FORBIDDEN', { message: `This action needs one of: ${roles.join(', ')}` })
  }
}
