import { createHash, randomBytes } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import { MembershipRoleSchema, PlatformRoleSchema } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import { AUTH_ALG, AUTH_AUDIENCE, AUTH_ISSUER, type AuthKeys } from '../../platform/index.js'
import type { AuthClaims } from './auth-context.js'

/** Defaults from the founder's design (2026-09-04): 15-minute access tokens, 30-day refresh tokens. */
export const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60
export const DEFAULT_REFRESH_TTL_DAYS = 30

export interface AuthTtl {
  accessTtlSeconds: number
  refreshTtlDays: number
}

/** AUTH_ACCESS_TTL_SECONDS / AUTH_REFRESH_TTL_DAYS from the environment, falling back to the defaults. */
export function authTtl(env: NodeJS.ProcessEnv = process.env): AuthTtl {
  return {
    accessTtlSeconds: positiveInt(env.AUTH_ACCESS_TTL_SECONDS, DEFAULT_ACCESS_TTL_SECONDS),
    refreshTtlDays: positiveInt(env.AUTH_REFRESH_TTL_DAYS, DEFAULT_REFRESH_TTL_DAYS),
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return raw && Number.isInteger(value) && value > 0 ? value : fallback
}

export interface SignedAccessToken {
  token: string
  jti: string
  /** Epoch seconds. */
  expiresAt: number
}

/**
 * Access token: an EdDSA JWT with `sub` (user), `tid` (tenant), `role`, `sid` (session), `did` (device),
 * the fixed issuer/audience and a UUIDv7 `jti`. The `kid` header lets a verifier pick the key from JWKS.
 */
export async function signAccessToken(
  claims: AuthClaims,
  keys: AuthKeys,
  ttlSeconds: number,
  now: Date = new Date(),
): Promise<SignedAccessToken> {
  if (!keys.privateKey) {
    throw new Error(
      'AUTH_JWT_PRIVATE_KEY is not configured: this process cannot sign access tokens',
    )
  }
  const iat = Math.floor(now.getTime() / 1000)
  const exp = iat + ttlSeconds
  const jti = uuidv7()
  const token = await new SignJWT({
    tid: claims.tenantId,
    role: claims.role,
    sid: claims.sessionId,
    did: claims.deviceId,
  })
    .setProtectedHeader({ alg: AUTH_ALG, kid: keys.kid, typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(AUTH_ISSUER)
    .setAudience(AUTH_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(keys.privateKey)
  return { token, jti, expiresAt: exp }
}

/**
 * Verifies signature, issuer, audience, algorithm and expiry (30 s clock tolerance) with the PUBLIC key
 * only, so every service can do it without calling auth-service. Throws on any problem.
 */
export async function verifyAccessToken(token: string, keys: AuthKeys): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, keys.publicKey, {
    issuer: AUTH_ISSUER,
    audience: AUTH_AUDIENCE,
    algorithms: [AUTH_ALG],
    clockTolerance: 30,
  })
  const sid = payload.sid
  const did = payload.did
  if (typeof payload.sub !== 'string' || typeof sid !== 'string' || typeof did !== 'string') {
    throw new Error('access token is missing sub/sid/did')
  }
  // A console session (module 13) carries `role: 'platform_admin'` and NO `tid`: Distribution OS's own
  // staff hold no membership anywhere, so the membership enum alone would read their role as null and
  // auth-service could not tell a platform session from one that has not picked a distributor yet.
  const membership = MembershipRoleSchema.safeParse(payload.role)
  const platform = PlatformRoleSchema.safeParse(payload.role)
  return {
    userId: payload.sub,
    tenantId: typeof payload.tid === 'string' ? payload.tid : null,
    role: membership.success ? membership.data : platform.success ? platform.data : null,
    sessionId: sid,
    deviceId: did,
  }
}

export interface RefreshToken {
  /** Given to the device, never stored. 32 random bytes as base64url (43 characters). */
  token: string
  /** sha256 hex of `token`; what auth_sessions.refresh_token_hash holds. */
  hash: string
}

export function newRefreshToken(): RefreshToken {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------------------------------------------
// password reset — a signed, self-invalidating token; no table (docs/23 §8.12)

/** Thirty minutes, as the contract promises. */
export const RESET_TOKEN_TTL_SECONDS = 30 * 60
/** Ed25519 through WebCrypto — the auth keys are `CryptoKey`s (jose), so no re-import is needed. */
const RESET_ALG = { name: 'Ed25519' }

/**
 * A fingerprint of the CURRENT password hash. It travels inside the reset token, so the token is
 * good for exactly one reset: the moment the password changes the fingerprint no longer matches and
 * the same token is refused. Sixteen hex chars of a sha256 reveal nothing about the hash itself.
 */
export function passwordFingerprint(passwordHash: string | null): string {
  return createHash('sha256')
    .update(passwordHash ?? '', 'utf8')
    .digest('hex')
    .slice(0, 16)
}

/**
 * The reset token: `base64url(JSON{u, p, e, j})` + `.` + `base64url(Ed25519 signature)`, signed with the
 * auth key through WebCrypto (the same key that signs access tokens). Compact on purpose — a full JWT
 * with its header and `kid` is longer than the 400 characters the contract allows in an SMS — and
 * stateless: nothing is stored, because the signature and the password fingerprint (`p`) already
 * give single use, and the channel that delivers it (SMS / WhatsApp) is the OTP layer docs/22 §7
 * defers.
 */
export async function signResetToken(
  i: { userId: string; passwordHash: string | null },
  keys: AuthKeys,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  if (!keys.privateKey)
    throw new Error('AUTH_JWT_PRIVATE_KEY is not configured: this process cannot sign reset tokens')
  const exp = Math.floor(now.getTime() / 1000) + RESET_TOKEN_TTL_SECONDS
  const body = Buffer.from(
    JSON.stringify({ u: i.userId, p: passwordFingerprint(i.passwordHash), e: exp, j: uuidv7() }),
    'utf8',
  ).toString('base64url')
  const signature = Buffer.from(
    await crypto.subtle.sign(RESET_ALG, keys.privateKey, Buffer.from(body, 'utf8')),
  ).toString('base64url')
  return { token: `${body}.${signature}`, expiresAt: new Date(exp * 1000) }
}

/** The user and fingerprint of a reset token, or null when it is not a valid, unexpired reset token. */
export async function verifyResetToken(
  token: string,
  keys: AuthKeys,
  now: Date = new Date(),
): Promise<{ userId: string; fingerprint: string } | null> {
  const dot = token.indexOf('.')
  if (dot <= 0 || token.indexOf('.', dot + 1) !== -1) return null
  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  try {
    const valid = await crypto.subtle.verify(
      RESET_ALG,
      keys.publicKey,
      Buffer.from(signature, 'base64url'),
      Buffer.from(body, 'utf8'),
    )
    if (!valid) return null
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      u?: unknown
      p?: unknown
      e?: unknown
    }
    if (
      typeof parsed.u !== 'string' ||
      typeof parsed.p !== 'string' ||
      typeof parsed.e !== 'number'
    )
      return null
    if (parsed.e * 1000 < now.getTime() - 30_000) return null
    return { userId: parsed.u, fingerprint: parsed.p }
  } catch {
    return null
  }
}
