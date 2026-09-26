/**
 * THE PERSON IS THE ELECTOR — docs/31 ruling B3, docs/29 §2.
 *
 * With six apps, the app elected: the delivery app sent `actAs: 'delivery'` on every sign-in, because
 * installing it was itself the choice. With one app there is no `APP.role` left to send, so after the
 * username and the password the person is asked: **Continue as …**, one row per role this membership
 * permits, and the choice is what the token is minted with.
 *
 * Three rules this file holds, and nothing else does:
 *
 * 1. **The chooser is shown only when there is a choice.** A membership that permits exactly one role
 *    goes straight in — which is every salesperson, every warehouse hand and every shopkeeper, i.e.
 *    almost everybody. Showing them a one-row list every morning would be a tax on the common case.
 * 2. **The last choice is remembered per device AND per person** (`dos.lastRole`, keyed on the
 *    username since DOS-210), so the owner who drives on Tuesdays taps once rather than reading the
 *    list, and so the sign-in itself can ask for that role rather than signing him in as an owner and
 *    immediately re-minting — while the accountant who sits down at the same desk next is never sent
 *    out asking for his role.
 * 3. **A change of role is a fresh election** — `electRole`, a new token — never the app deciding to
 *    render another group under the token it already holds. That token would still reach the old
 *    role's service for the life of its refresh.
 *
 * The table is `@dos/domain`'s `electableRoles`, the SAME constant the auth service grants from. The
 * device asking is never the thing that decides: the server re-validates and refuses with a sentence
 * the person can act on (`electionRefusal`), which the chooser prints.
 */
import { GROUP_OF, type Session } from '@dos/api-client'
import type { MembershipRole, MembershipSummary } from '@dos/contracts'
import { electableRoles, type ElectionRole } from '@dos/domain'
import { storage } from '@dos/ui/platform'

import { LAST_ROLE_KEY } from './api'

/** `MembershipRole` and `ElectionRole` are the same list plus `platform_admin`, which holds no membership. */
function isMembershipRole(role: ElectionRole): role is MembershipRole {
  return role !== 'platform_admin'
}

/** The membership this session is signed in under — the person's ROLE here, not the elected one. */
export function currentMembership(session: Session): MembershipSummary | undefined {
  return session.memberships.find((membership) => membership.tenantId === session.tenant.id)
}

/**
 * The extra roles an owner or manager has put on this membership (docs/29 §2).
 *
 * The wire carries them — `MembershipSummary.extraRoles`, REQUIRED, filled by the auth service from
 * `memberships.extra_roles` (docs/31 ruling B5) — so this is a typed read and nothing more. For the
 * four staff roles the extras are the only second row the chooser can offer: a warehouse hand who
 * drives on Tuesdays sees "warehouse" and "delivery", and the server grants the election from the
 * same column, so the list offered and the list granted are one list.
 */
function extraRolesOf(membership: MembershipSummary | undefined): readonly MembershipRole[] {
  return membership?.extraRoles ?? []
}

/**
 * Every role this person may sign in as at THIS distributor, their own first.
 *
 * `electableRoles` is `@dos/domain`'s, so the list the device offers and the list the server grants
 * are one list. Roles with no group are dropped rather than offered and then refused by the root's
 * ladder (ruling Q2): an unmapped role is a blank screen, and a row that cannot work is not a choice.
 */
export function permittedRoles(session: Session): readonly MembershipRole[] {
  const membership = currentMembership(session)
  const own = membership?.role ?? session.role
  return electableRoles(own, extraRolesOf(membership))
    .filter(isMembershipRole)
    .filter((role) => role in GROUP_OF)
}

/** Is there anything to ask? One permitted role is not a choice, and is never put to the person. */
export function needsChooser(session: Session): boolean {
  return permittedRoles(session).length > 1
}

/**
 * A username as the auth service keys it (`normalizeUsername` in `@dos/db`: trimmed, lower-case), so
 * "Meena.Joshi " and "meena.joshi" are one person here exactly as they are one person there.
 */
function sameUser(username: string): string {
  return username.trim().toLowerCase()
}

/** What `dos.lastRole` holds: the choice AND whose choice it was (DOS-210). */
interface RememberedElection {
  username: string
  role: string
}

function readElection(): RememberedElection | null {
  const held = storage.getItemSync(LAST_ROLE_KEY)
  if (held === null) return null
  try {
    const parsed: unknown = JSON.parse(held)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record['username'] !== 'string' || typeof record['role'] !== 'string') return null
    return { username: record['username'], role: record['role'] }
  } catch {
    // A bare role from before DOS-210 ("manager"): nobody knows whose it was, so it is nobody's.
    return null
  }
}

/**
 * The role THIS PERSON chose last time on this device, if it is still one with a group.
 *
 * KEYED ON THE USERNAME (DOS-210). It used to be the device's last choice, full stop, so on a desk
 * two people share the second person's sign-in went out asking for the FIRST person's role: Meena
 * the accountant signed in with `actAs: "manager"` because Vikas had, took a 403 naming a role she
 * never asked for, and was signed in only by the silent retry — an `auth_events` refusal row per
 * sign-in, and a sentence on a slow network that reads as "your login is broken". A choice now
 * travels only with the person who made it; anybody else signs in as their own membership role.
 *
 * Still device-scoped, for the reason the welcome flag is (ruling Q7): the next sign-in on a phone is
 * usually the same person on the same round, and that person still taps once.
 */
export function lastRole(username: string | null): MembershipRole | null {
  // A session with no username (a shopkeeper signed in by phone) has nobody to remember for.
  if (username === null) return null
  const held = readElection()
  if (held === null || held.username !== sameUser(username)) return null
  return held.role in GROUP_OF ? (held.role as MembershipRole) : null
}

export function rememberRole(username: string | null, role: MembershipRole): void {
  if (username === null) {
    forgetRole()
    return
  }
  const value: RememberedElection = { username: sameUser(username), role }
  storage.setItemSync(LAST_ROLE_KEY, JSON.stringify(value))
}

/** After a refused election: never ask for that role again by itself on the next launch. */
export function forgetRole(): void {
  storage.setItemSync(LAST_ROLE_KEY, null)
}

/**
 * Which row the chooser opens on: the last choice when it is still permitted, else this membership's
 * own role, else the first row. Never an empty selection — a list with nothing chosen makes the
 * person do the work of the remembering.
 */
export function preselectedRole(session: Session): MembershipRole {
  const permitted = permittedRoles(session)
  const remembered = lastRole(session.user.username)
  if (remembered !== null && permitted.includes(remembered)) return remembered
  const own = currentMembership(session)?.role
  if (own !== undefined && permitted.includes(own)) return own
  return permitted[0] ?? session.role
}

// ---------------------------------------------------------------------------------------------------
// The chooser is open — a fact the ROOT layout has to know
// ---------------------------------------------------------------------------------------------------

/**
 * The root's redirect ladder takes a signed-in person on `/sign-in` to their group. The chooser is
 * rendered by the sign-in screen itself, AFTER the password and before the person has said which
 * role they want, so for those few seconds there is a session on `/sign-in` and the ladder must hold
 * still. This is that fact, in the one place both the screen and the layout can reach.
 *
 * A module-level flag rather than a context, because the two live on opposite sides of `<Slot/>`:
 * the chooser is inside the router's tree and the ladder is outside it. It is deliberately NOT
 * persisted — a reload while the chooser is open has already elected (the token carries the role the
 * login asked for), so the person lands in that group rather than being asked again.
 */
let choosing = false
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

export function beginChoosing(): void {
  if (choosing) return
  choosing = true
  announce()
}

export function endChoosing(): void {
  if (!choosing) return
  choosing = false
  announce()
}

export function isChoosing(): boolean {
  return choosing
}

export function subscribeChoosing(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
