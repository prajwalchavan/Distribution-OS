import { createHash, randomBytes } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import { MembershipRoleSchema } from '@dos/contracts'
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
  const role = MembershipRoleSchema.safeParse(payload.role)
  return {
    userId: payload.sub,
    tenantId: typeof payload.tid === 'string' ? payload.tid : null,
    role: role.success ? role.data : null,
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
