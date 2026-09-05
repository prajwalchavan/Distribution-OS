import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto'
import type { AuthKeys } from './auth-keys.js'

/**
 * THE SUPPORT PASS — how an owner-approved `support_grants` row becomes a request a tenant service
 * will answer (founder decision 2026-09-05, docs/22 §2 row 7 and §8: support access is "time-boxed,
 * owner-approved, audited"; docs/17 §B [57]).
 *
 * A platform administrator holds a token with no `tid` and the role `platform_admin`, which every one
 * of the six tenant services refuses at the gate. When a distributor's owner has approved a grant, the
 * console exchanges that grant for a PASS at auth-service (`POST /auth/platform/support-pass`, which
 * reads the row, checks it is approved, live and unrevoked, and signs the four facts below), then
 * sends it to owner-service in the `x-support-grant` header alongside its own bearer token.
 *
 * WHY A SIGNED PASS AND NOT THE GRANT ID. `TenantGuard.canActivate` is deliberately SYNCHRONOUS: an
 * `await` before `AsyncLocalStorage.enterWith` binds the tenant context to the guard's own
 * continuation and not to the router that goes on to run the handler, so the handler would see no
 * tenant at all (the comment on that method has carried this since the guard was written). A grant id
 * would have to be looked up in Postgres, which is a round trip; the four facts the guard needs —
 * WHICH tenant, until WHEN, at what SCOPE, for WHICH grant — travel inside a signature it can check
 * with `node:crypto` in the same tick, against the very public key it already holds for access tokens.
 *
 * WHAT THE PASS CANNOT DO, by construction:
 *   - it never outlives the grant: `exp` is the earlier of the grant's `expires_at` and
 *     `SUPPORT_PASS_TTL_SECONDS` from now, so an owner who revokes at 11:05 closes the door by 11:10
 *     at the latest, and the console cannot mint a longer one because it does not hold the key;
 *   - it names ONE tenant, so it cannot be replayed against another distributor;
 *   - it is not a session: it carries no user. The caller still presents its own `platform_admin`
 *     bearer token, and the guard refuses the pass without one — so "who was in there" is always a
 *     named person, which is what makes the audit row worth writing;
 *   - `read_only` means GET. The guard refuses every other method before the handler runs, whatever
 *     the permission matrix would otherwise allow the role it is acting as.
 *
 * Format is the compact one `signResetToken` already uses (base64url(JSON) + '.' + base64url(sig))
 * rather than a JWT: it goes in a header beside a JWT, and a second JWT with its own header and `kid`
 * would be twice the bytes for nothing. Ed25519 through WebCrypto for signing (the auth keys are
 * `CryptoKey`s), `node:crypto` for the synchronous verify in the guard.
 */
export const SUPPORT_PASS_TTL_SECONDS = 5 * 60

const PASS_ALG = { name: 'Ed25519' }

/** What the console may do inside a distributor's data once the owner has said yes. */
export type SupportPassScope = 'read_only' | 'read_write'

export interface SupportPassClaims {
  /** `support_grants.id` — what the audit row points at, and what the owner can revoke. */
  grantId: string
  tenantId: string
  /** The platform administrator the grant was raised by; the pass is only usable by them. */
  adminUserId: string
  scope: SupportPassScope
  /** Epoch seconds. Never later than the grant's own `expires_at`. */
  expiresAt: number
}

interface PassBody {
  g: string
  t: string
  u: string
  s: SupportPassScope
  e: number
}

/**
 * Signs a pass. `grantExpiresAt` is the grant's own window: the pass expires at the earlier of that
 * and five minutes from now, so a revoked or shortened grant stops working within one pass lifetime
 * without any service having to be told.
 */
export async function signSupportPass(
  claims: Omit<SupportPassClaims, 'expiresAt'> & { grantExpiresAt: Date },
  keys: AuthKeys,
  now: Date = new Date(),
): Promise<{ pass: string; expiresAt: Date }> {
  if (!keys.privateKey)
    throw new Error(
      'AUTH_JWT_PRIVATE_KEY is not configured: this process cannot sign support passes',
    )
  const ceiling = Math.floor(claims.grantExpiresAt.getTime() / 1000)
  const wanted = Math.floor(now.getTime() / 1000) + SUPPORT_PASS_TTL_SECONDS
  const exp = Math.min(ceiling, wanted)
  const body: PassBody = {
    g: claims.grantId,
    t: claims.tenantId,
    u: claims.adminUserId,
    s: claims.scope,
    e: exp,
  }
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
  const signature = Buffer.from(
    await crypto.subtle.sign(PASS_ALG, keys.privateKey, Buffer.from(encoded, 'utf8')),
  ).toString('base64url')
  return { pass: `${encoded}.${signature}`, expiresAt: new Date(exp * 1000) }
}

/** A verifier bound to one public key, so the guard checks a pass without touching the database. */
export interface SupportPassVerifier {
  /** The claims, or null when the pass is malformed, forged or expired. `now` is epoch seconds. */
  verify(pass: string, now?: number): SupportPassClaims | null
}

export function createSupportPassVerifier(keys: AuthKeys): SupportPassVerifier {
  const key: KeyObject = createPublicKey({ key: keys.publicJwk, format: 'jwk' })
  return { verify: (pass, now = Date.now() / 1000) => verifySupportPass(pass, key, now) }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

/**
 * No clock tolerance on the way out, unlike an access token: a pass that has run out is a door that
 * should already be shut, and thirty seconds of grace on a support window is thirty seconds the owner
 * did not agree to.
 */
function verifySupportPass(pass: string, key: KeyObject, now: number): SupportPassClaims | null {
  const dot = pass.indexOf('.')
  if (dot <= 0 || pass.indexOf('.', dot + 1) !== -1) return null
  const encoded = pass.slice(0, dot)
  const signature = pass.slice(dot + 1)
  if (!BASE64URL.test(encoded) || !BASE64URL.test(signature)) return null
  let valid: boolean
  try {
    valid = verifySignature(
      null,
      Buffer.from(encoded, 'utf8'),
      key,
      Buffer.from(signature, 'base64url'),
    )
  } catch {
    return null
  }
  if (!valid) return null
  let body: PassBody
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PassBody
  } catch {
    return null
  }
  if (
    typeof body.g !== 'string' ||
    typeof body.t !== 'string' ||
    typeof body.u !== 'string' ||
    (body.s !== 'read_only' && body.s !== 'read_write') ||
    typeof body.e !== 'number'
  )
    return null
  if (body.e <= now) return null
  return {
    grantId: body.g,
    tenantId: body.t,
    adminUserId: body.u,
    scope: body.s,
    expiresAt: body.e,
  }
}

/** A verified pass plus the request it let through — what the audit interceptor files afterwards. */
export interface SupportAccessRecord {
  claims: SupportPassClaims
  method: string
  route: string
}

/**
 * The property `read_only` actually buys: only a read. Applied by the guard BEFORE the permission
 * matrix, so a pass can never be worth more than the word the owner pressed on their own screen.
 */
export function passAllowsMethod(scope: SupportPassScope, method: string): boolean {
  return scope === 'read_write' || method.toUpperCase() === 'GET'
}
