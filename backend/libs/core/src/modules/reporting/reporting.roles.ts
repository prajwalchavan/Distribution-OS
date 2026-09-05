import type { ActorRole } from '@dos/db'

/**
 * The role tuples of this module, mirroring `backend/libs/contracts/src/permissions.ts` (coordination
 * §6) with `'system'` added for the worker — `permissions.ts` values are membership roles only, and
 * `requireRole()` takes `ActorRole`. `describePermissionMatrix` asserts the two lists agree for every
 * procedure × every role, so a drift here fails a service spec rather than leaking a number.
 */

/** The tenant's own figures: every tile, every series, every register, the exports (accountant included). */
export const BACK_OFFICE_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'system',
]
/** A rep's own numbers — the desk sees every rep, the rep only itself (docs/23 S9, M21). */
export const REP_PERFORMANCE_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'system',
]
/** The crew's own trips (docs/23 D11) plus the desk. */
export const CREW_PERFORMANCE_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'delivery',
  'system',
]
/** Picking accuracy is the godown's job too (docs/23 §4.2 W1). */
export const FILL_RATE_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'system',
]
/** The profit view is the owner's route alone (docs/23 O17, §1.2). */
export const OWNER_ONLY: readonly ActorRole[] = ['owner', 'system']
/** Who may pull a bulk financial extract (docs/17 A12: audited). */
export const EXPORT_REQUESTERS: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']
