/**
 * A PASSWORD GIVEN BY A DESK IS A FIRST PASSWORD ON THE SERVER TOO (architect's ruling of 2026-09-29,
 * docs/22 §8, R2). The owner or the manager who made a login — a member of staff, or a shop's sign-in
 * (DOS-400) — knows its first password until the person chooses their own. The app has always sent
 * such a session to "Change your password" and nowhere else; that was the app's rule alone, so anybody
 * holding the first password could read the books through the API directly.
 *
 * Now the fact rides in the access token. `auth` sets the claim `pwc` on every access token it issues
 * (sign-in, refresh, switch of distributor, the console's sign-in and refresh) while
 * `users.must_change_password` is true; `auth.changePassword` answers with a fresh token that does not
 * carry it. Every guard reads the claim in the same synchronous tick it verifies the signature in (no
 * database read, so nothing is awaited before `TenantGuard` enters the tenant context):
 *
 *   - auth-service answers `me`, `platformMe` and `changePassword` (and, token-free, sign-in, refresh,
 *     switch of distributor and sign-out); `sessions`, `revokeSession`, `memberships.summary` and
 *     `supportPass` are refused;
 *   - every business service (owner, manager, sales, warehouse, delivery, retailer, admin) refuses
 *     every procedure with 403 and the sentence below, before its role checks;
 *   - `sync.upload`, which never answers 4xx (ADR 0007), answers 2xx and sends every op back
 *     `password_change_required`, unapplied and unrecorded, so the device sends them again afterwards.
 */

/** The access-token claim: present and `true` only while the person must choose their own password. */
export const FIRST_PASSWORD_CLAIM = 'pwc'

/** What every refused call says, staff and shopkeeper alike. */
export const CHOOSE_YOUR_OWN_PASSWORD =
  'Choose your own password first: the one you signed in with was given to you by someone else. Change it, then try again.'

/** Said when the new password is the one the person has now (a desk's first password kept as is). */
export const SAME_PASSWORD =
  'Your new password must be different from the one you have now. Choose a password nobody gave you.'
