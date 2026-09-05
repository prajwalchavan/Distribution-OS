import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { ORPCModule } from '@orpc/nest'
import type { ModuleMetadata } from '@nestjs/common'
import { SignJWT } from 'jose'
import { uuidv7 } from '@dos/domain'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AUTH_ALG, AUTH_AUDIENCE, AUTH_ISSUER, DbModule, loadAuthKeys } from '../platform/index.js'
import { registerStorageBodyParsers, STORAGE_BODY_LIMIT_BYTES } from '../service/bootstrap.js'
import { StorageController } from '../service/storage.controller.js'
import { SupportAuditInterceptor } from '../service/support-audit.interceptor.js'

/**
 * Boots a Nest app for a spec exactly as main.ts does (Fastify + oRPC), with the real DbModule so
 * DATABASE_URL-backed specs run against a migrated database and the rest run with db = null.
 */
export async function bootTestApp(
  imports: NonNullable<ModuleMetadata['imports']>,
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ORPCModule.forRoot({}), DbModule, ...imports],
    // The local object-storage route every service serves, so an upload round-trip is testable.
    controllers: [StorageController],
    // The cross-cutting pieces `ServiceModule` mounts on a real service, so a spec exercises the same
    // request path: today that is the support-access audit (module 13), a no-op on every request
    // `TenantGuard` did not admit through an owner-approved window.
    providers: [{ provide: APP_INTERCEPTOR, useClass: SupportAuditInterceptor }],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: STORAGE_BODY_LIMIT_BYTES }),
  )
  registerStorageBodyParsers(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return app
}

export interface Actor {
  tenantId: string
  actorId: string
  role: 'owner' | 'manager' | 'accountant' | 'salesperson' | 'warehouse' | 'delivery' | 'retailer'
}

/** Fixed session/device ids for test tokens, so a spec can assert on `currentAccessClaims()` if it needs to. */
export const TEST_SESSION_ID = '00000000-0000-7000-8000-00000000aaaa'
export const TEST_DEVICE_ID = '00000000-0000-7000-8000-00000000dddd'

export interface BearerOptions {
  /** Seconds until expiry (negative = already expired). Default 15 minutes. */
  ttlSeconds?: number
  sessionId?: string
  deviceId?: string
  /** Omit tenant + role (a session that has not chosen a distributor yet). */
  withoutTenant?: boolean
}

/**
 * Signs an access token the way auth-service does, with the private key `loadAuthKeys()` returns
 * (backend/.env dev pair, or an ephemeral pair under NODE_ENV=test), so TenantGuard verifies it with
 * the matching public key. Claims: sub = actorId, tid = tenantId, role, sid, did, iss, aud, iat, exp, jti.
 */
export async function bearer(
  actor: Actor,
  options: BearerOptions = {},
): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await signTestToken(actor, options)}` }
}

export async function signTestToken(actor: Actor, options: BearerOptions = {}): Promise<string> {
  const keys = await loadAuthKeys()
  if (!keys.privateKey) {
    throw new Error(
      'test tokens need a private key: set AUTH_JWT_PRIVATE_KEY in backend/.env or run with NODE_ENV=test',
    )
  }
  const now = Math.floor(Date.now() / 1000)
  const ttl = options.ttlSeconds ?? 15 * 60
  const claims: Record<string, unknown> = {
    sid: options.sessionId ?? TEST_SESSION_ID,
    did: options.deviceId ?? TEST_DEVICE_ID,
  }
  if (!options.withoutTenant) {
    claims.tid = actor.tenantId
    claims.role = actor.role
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: AUTH_ALG, kid: keys.kid, typ: 'JWT' })
    .setSubject(actor.actorId)
    .setIssuer(AUTH_ISSUER)
    .setAudience(AUTH_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setJti(uuidv7())
    .sign(keys.privateKey)
}

/**
 * A CONSOLE token (module 13): `role: 'platform_admin'`, no `tid`, because Distribution OS's own staff
 * hold no membership anywhere. `TenantGuard` accepts it on admin-service :3007 alone and refuses it,
 * before any handler, on all six tenant services — which is exactly what a spec needs to assert.
 */
export async function platformBearer(
  actorId: string,
  options: BearerOptions = {},
): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await signPlatformToken(actorId, options)}` }
}

export async function signPlatformToken(
  actorId: string,
  options: BearerOptions = {},
): Promise<string> {
  const keys = await loadAuthKeys()
  if (!keys.privateKey) {
    throw new Error(
      'test tokens need a private key: set AUTH_JWT_PRIVATE_KEY in backend/.env or run with NODE_ENV=test',
    )
  }
  const now = Math.floor(Date.now() / 1000)
  const ttl = options.ttlSeconds ?? 15 * 60
  return new SignJWT({
    role: 'platform_admin',
    sid: options.sessionId ?? TEST_SESSION_ID,
    did: options.deviceId ?? TEST_DEVICE_ID,
  })
    .setProtectedHeader({ alg: AUTH_ALG, kid: keys.kid, typ: 'JWT' })
    .setSubject(actorId)
    .setIssuer(AUTH_ISSUER)
    .setAudience(AUTH_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setJti(uuidv7())
    .sign(keys.privateKey)
}

/** oRPC/OpenAPI GET input goes in the query string; POST input is the JSON body. */
export async function call<T>(
  app: NestFastifyApplication,
  actor: Actor | null,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: T }> {
  const headers = { ...(actor ? await bearer(actor) : {}), 'content-type': 'application/json' }
  const res =
    method === 'GET'
      ? await app.inject({ method, url, headers, query: toQuery(payload) })
      : await app.inject({ method, url, headers, payload: JSON.stringify(payload ?? {}) })
  const body: T = res.json()
  return { status: res.statusCode, body }
}

function toQuery(payload?: Record<string, unknown>): Record<string, string> {
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (v === undefined) continue
    q[k] =
      typeof v === 'string'
        ? v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : JSON.stringify(v)
  }
  return q
}

export { describePermissionMatrix, type PermissionMatrixOptions } from './permission-matrix.js'
