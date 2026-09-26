/**
 * ROLE ELECTION, downward only (founder, 2026-09-21; design `docs/29-sign-in-roles-and-one-store-app.md` §2).
 *
 * A membership is one (person, distributor, role), and a service answers only its own roles — an owner
 * token in the delivery app used to be a 403 and a screen saying so. Real distributorships do not work
 * that way: the owner drives some mornings and the warehouse man delivers on Tuesdays. The fix is NOT
 * to let an owner token into a field app — a van phone is shared and droppable, and an owner token on
 * it reaches owner-service for the life of its refresh token. The fix is that the DEVICE asks for the
 * role it needs and the auth service grants it only DOWNWARD:
 *
 * | Membership role                                  | May act as                                            |
 * | ------------------------------------------------ | ----------------------------------------------------- |
 * | owner                                            | manager, accountant, warehouse, delivery, salesperson |
 * | manager                                          | warehouse, delivery, salesperson                      |
 * | accountant, warehouse, delivery, salesperson     | own role, plus each role in the membership's extras   |
 * | retailer, platform_admin                         | never anything else                                   |
 *
 * The table is fixed in code, not configurable in v1, and it lives HERE — in the dependency-free domain
 * package — so the auth service and the seven apps link one constant rather than keep two lists that
 * drift. What an election changes is only which role the access token is MINTED with: `sub` stays the
 * person, so every audit row, actor id, receipt and delivery still records WHO did it. Services keep
 * their role lists, `PERMISSIONS` keeps every row, and RLS reads `app.actor_role` = the elected role
 * exactly as before. Nothing about the server's security model moves.
 *
 * The role names are spelled out here rather than imported from `@dos/contracts` because this package
 * carries ZERO runtime dependencies (it bundles into Expo unchanged); `election.ts` in `@dos/core`
 * holds the compile-time assertion that the two lists are the same list.
 */

/** What one person is inside one distributor. Same values as `MembershipRoleSchema` in @dos/contracts. */
export const MEMBERSHIP_ROLES = [
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'warehouse',
  'delivery',
  'retailer',
] as const
export type MembershipRoleName = (typeof MEMBERSHIP_ROLES)[number]

/**
 * Every role an access token can carry: a membership role, or Distribution OS's own staff. A
 * `platform_admin` holds no membership and signs in through its own procedure, so it appears here
 * only to make "platform staff never act as anything else" a row of the table rather than a comment.
 */
export const ELECTION_ROLES = [...MEMBERSHIP_ROLES, 'platform_admin'] as const
export type ElectionRole = (typeof ELECTION_ROLES)[number]

/**
 * The roles an owner or a manager may put on a colleague's membership as EXTRA roles — the four staff
 * roles of the table's third row and nothing else. `owner`, `manager`, `retailer` and `platform_admin`
 * are absent by construction: extras are a sideways grant between staff jobs, never a way up, and the
 * contract refuses them before the database is asked.
 */
export const GRANTABLE_EXTRA_ROLES = ['accountant', 'salesperson', 'warehouse', 'delivery'] as const
export type GrantableExtraRole = (typeof GRANTABLE_EXTRA_ROLES)[number]

/**
 * THE TABLE, as one constant. Each key is a membership role; each value is what that role may act as
 * BESIDES itself (its own role is always electable and is deliberately not repeated here, so a row can
 * never be read as granting something it does not).
 */
export const ROLE_ELECTION: Readonly<Record<ElectionRole, readonly MembershipRoleName[]>> = {
  owner: ['manager', 'accountant', 'warehouse', 'delivery', 'salesperson'],
  manager: ['warehouse', 'delivery', 'salesperson'],
  accountant: [],
  salesperson: [],
  warehouse: [],
  delivery: [],
  retailer: [],
  platform_admin: [],
}

/** The four staff roles whose extras count: the table's third row, and only that row. */
const ELECTS_FROM_EXTRAS: readonly ElectionRole[] = GRANTABLE_EXTRA_ROLES

export function isElectionRole(value: string): value is ElectionRole {
  return (ELECTION_ROLES as readonly string[]).includes(value)
}

export function isGrantableExtraRole(value: string): value is GrantableExtraRole {
  return (GRANTABLE_EXTRA_ROLES as readonly string[]).includes(value)
}

/**
 * Everything this membership may sign in as, own role first, in the order a staff screen should show
 * them. `extraRoles` is honoured only for the four staff roles — the owner and the manager elect from
 * the table, not from extras — and only for values the table can grant, so a stale or hand-edited row
 * can never widen anything.
 */
export function electableRoles(
  membershipRole: ElectionRole,
  extraRoles: readonly string[] = [],
): readonly ElectionRole[] {
  const out: ElectionRole[] = [membershipRole]
  for (const role of ROLE_ELECTION[membershipRole]) if (!out.includes(role)) out.push(role)
  if (ELECTS_FROM_EXTRAS.includes(membershipRole)) {
    for (const role of extraRoles) {
      if (isGrantableExtraRole(role) && !out.includes(role)) out.push(role)
    }
  }
  return out
}

/** May a membership of `membershipRole`, carrying `extraRoles`, sign in as `actAs`? */
export function canElect(
  membershipRole: ElectionRole,
  actAs: string,
  extraRoles: readonly string[] = [],
): boolean {
  if (!isElectionRole(actAs)) return false
  return electableRoles(membershipRole, extraRoles).includes(actAs)
}

/**
 * What a refused election says, docs/29 §2 word for word. A refusal is a 403 at sign-in with a
 * sentence the person can act on — never a silent downgrade into a role they did not ask for.
 */
export function electionRefusal(i: {
  /** The distributor's own display name, as the app already shows it. */
  distributor: string
  membershipRole: string
  actAs: string
}): string {
  return `Your login at ${i.distributor} is ${article(i.membershipRole)} ${i.membershipRole}; ask the owner to add ${i.actAs} to it.`
}

/**
 * "an accountant", "an owner", "a manager" (DOS-210: the sentence read "is a accountant"). The roles
 * are English words chosen by us, so the vowel rule is exact for every one of them.
 */
function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}
