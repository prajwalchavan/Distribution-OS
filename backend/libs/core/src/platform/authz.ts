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
 * Application-level role check. RLS is the guarantee; this gives the caller a clear 403 instead of an
 * empty result or a silent no-op, and keeps role rules readable in one place per procedure.
 */
export function requireRole(roles: readonly ActorRole[]): void {
  const ctx = currentTenant()
  if (!roles.includes(ctx.actorRole)) {
    throw new ORPCError('FORBIDDEN', { message: `This action needs one of: ${roles.join(', ')}` })
  }
}
