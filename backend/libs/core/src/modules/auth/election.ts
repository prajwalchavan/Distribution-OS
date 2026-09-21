/**
 * Role election at sign-in and at switch-tenant (founder 2026-09-21, docs/29 §2).
 *
 * The TABLE lives in `@dos/domain` (`ROLE_ELECTION`) so the server and the seven apps link one
 * constant. This file is the server's half of it: it turns a membership row plus the `actAs` a device
 * asked for into the role the access token will carry, or into the 403 the person can act on.
 *
 * What it deliberately does NOT do is downgrade quietly. A device that asks for a role its login
 * cannot elect is refused at sign-in with a sentence naming the distributor, the role the login
 * actually is and the role to ask for — because the alternative is a driver staring at an empty road
 * with no idea why, which is exactly what the wrong-role screen used to be.
 */
import type { MembershipRole } from '@dos/contracts'
import { canElect, electionRefusal, type ElectionRole } from '@dos/domain'
import { ORPCError } from '@orpc/server'

/**
 * The two role lists are one list. `@dos/domain` spells its own out because it carries no runtime
 * dependencies; this is where a value added to `MembershipRoleSchema` and forgotten in `ROLE_ELECTION`
 * stops the build instead of silently electing nothing.
 */
const _membershipRolesAreElectionRoles: ElectionRole = null as unknown as MembershipRole
void _membershipRolesAreElectionRoles

export interface ElectionRequest {
  /** What the membership row says this person IS at this distributor. */
  membershipRole: MembershipRole
  /** `memberships.extra_roles`; read only for the four staff roles (docs/29 §2). */
  extraRoles: readonly string[]
  /** What the device asked for. Undefined means "my own role", which is always granted. */
  actAs: MembershipRole | undefined
  /** The distributor's own display name, for the refusal sentence. */
  distributor: string
}

export interface ElectedRole {
  /** What the access token and `auth_sessions.role` will carry. */
  role: MembershipRole
  /**
   * Non-null only when the device asked for something other than its own role — what
   * `auth_events.acted_as` records, so an ordinary sign-in leaves that column null.
   */
  electedRole: MembershipRole | null
}

export type ElectionOutcome =
  { ok: true; value: ElectedRole } | { ok: false; error: ORPCError<string, unknown> }

/**
 * The elected role, or the 403 to answer with. It returns the refusal rather than throwing it so the
 * caller can still commit its `auth_events` row: a refused election is a thing the owner should be
 * able to see happened, and a thrown error inside the sign-in transaction would roll that row back.
 */
export function electRole(req: ElectionRequest): ElectionOutcome {
  const asked = req.actAs
  if (asked === undefined || asked === req.membershipRole) {
    return { ok: true, value: { role: req.membershipRole, electedRole: null } }
  }
  if (!canElect(req.membershipRole, asked, req.extraRoles)) {
    return { ok: false, error: electionRefused({ ...req, actAs: asked }) }
  }
  return { ok: true, value: { role: asked, electedRole: asked } }
}

/** docs/29 §2 word for word, as an ORPC 403. */
export function electionRefused(req: {
  distributor: string
  membershipRole: string
  actAs: string
}): ORPCError<string, unknown> {
  return new ORPCError('FORBIDDEN', {
    message: electionRefusal({
      distributor: req.distributor,
      membershipRole: req.membershipRole,
      actAs: req.actAs,
    }),
    data: { code: 'role_not_electable', membershipRole: req.membershipRole, actAs: req.actAs },
  })
}
