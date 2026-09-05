import { AsyncLocalStorage } from 'node:async_hooks'
import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto'
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  type OnModuleInit,
  Optional,
  RequestMethod,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { toNestPattern } from '@orpc/nest'
import {
  contract,
  isAllowed,
  listProcedures as contractProcedures,
  MembershipRoleSchema,
  PlatformRoleSchema,
  type MembershipRole,
  type Permission,
  type PermissionRole,
} from '@dos/contracts'
import {
  AUTH_ALG,
  AUTH_AUDIENCE,
  AUTH_ISSUER,
  createSupportPassVerifier,
  loadAuthKeys,
  passAllowsMethod,
  tenantStorage,
  type AuthKeys,
  type SupportAccessRecord,
  type SupportPassVerifier,
} from '../../platform/index.js'
import { SERVICE_INFO, type ServiceDefinition } from '../../service/define.js'

/** Seconds of clock skew tolerated on exp/nbf, the same value auth-service documents for its clients. */
export const AUTH_CLOCK_TOLERANCE_SECONDS = 30

/** The verified claims of the access token behind the current request (auth-service issues them). */
export interface AccessClaims {
  /** User id. */
  sub: string
  /** Active tenant id, or null while the session has not chosen a distributor yet. */
  tid: string | null
  /**
   * Membership role in `tid`; null exactly when `tid` is null — with ONE exception, the platform
   * console (module 13): `platform_admin` arrives with `tid: null` because Distribution OS's own
   * staff hold no membership in any distributor.
   */
  role: PermissionRole | null
  /** auth_sessions.id — what "current session", logout and revoke resolve to. */
  sid: string
  /** Device id the session was opened from. */
  did: string | null
  jti: string | null
  expiresAt: Date
}

/**
 * Request-scoped access-token claims, entered by the guard next to the tenant context. Handlers that
 * need the session (auth.me, auth.sessions, auth.revokeSession, auth.changePassword) read them through
 * `currentAccessClaims()`; everything tenant-scoped keeps using `currentTenant()`.
 */
export const accessClaimsStorage = new AsyncLocalStorage<AccessClaims>()

export function currentAccessClaims(): AccessClaims {
  const claims = accessClaimsStorage.getStore()
  if (!claims) throw new Error('No access claims: handler ran outside TenantGuard')
  return claims
}

/**
 * Bearer-token guard for every business controller (`@UseGuards(TenantGuard)`), never global so
 * `/health` and `/docs` stay open to load balancers and browsers.
 *
 * Order of checks, each failing closed:
 *   1. the handler must map to a contract procedure with a line in PERMISSIONS (else 500);
 *   2. 'public' passes without a token;
 *   3. the token must verify against the auth public key (401 'sign in required' / 'token expired');
 *   4. a `platform_admin` token takes the console path below;
 *   5. 'authenticated' needs nothing more (tenant context is entered when the token carries one);
 *   6. a role list needs an active tenant + role, then this SERVICE must serve the role (403), then
 *      the matrix must allow the role on this procedure (403), then the tenant context is entered.
 *
 * THE CONSOLE PATH (module 13, founder decision 2026-09-05). A `platform_admin` token carries no
 * `tid`, because Distribution OS's own staff are members of no distributor. It has exactly two uses:
 *
 *   a. On **admin-service :3007** — the only service whose `roles` list names it — it reaches the
 *      `admin.*` procedures, and the context it enters carries `tenantId: ''` (`PLATFORM_SCOPE`). That
 *      empty string is not a formality: every tenant policy in the database compares `tenant_id` to
 *      `app.tenant_id`, so a console session that strays into a business table reads ZERO rows rather
 *      than somebody's. The four platform tables have policies that key on the actor's ROLE instead,
 *      which is how the console reads its own data (`schema/platform-admin.ts`).
 *   b. On **owner-service** with an `x-support-grant` pass, when that distributor's OWNER has approved
 *      a `support_grants` row. The pass says which tenant, until when and at what scope; it is signed
 *      by auth-service and checked here with the same public key as the access token, in the same
 *      synchronous tick (see `platform/support-access.ts` for why it is a signed pass and not a grant
 *      id). The session then acts as that tenant's `owner` — narrowed to GET while the scope is
 *      `read_only` — and the request is recorded in `platform_audit` by `SupportAuditInterceptor`.
 *      The pass is refused on every service that does not serve the role it acts as, and a membership
 *      token that presents one is refused outright.
 *
 * `canActivate` is deliberately synchronous: `AsyncLocalStorage.enterWith` after an `await` binds the
 * store to the guard's own continuation, not to the router that goes on to run the handler. So the
 * public key is loaded once in `onModuleInit` and the Ed25519 signature is checked with node:crypto's
 * synchronous `verify`; the claim checks mirror jose's jwtVerify (issuer, audience, alg, exp/nbf with
 * clock tolerance). RLS in Postgres remains the guarantee; this gives a clear answer before any
 * business logic runs.
 */
@Injectable()
export class TenantGuard implements CanActivate, OnModuleInit {
  private readonly permissions: ReadonlyMap<string, Permission | undefined>
  private verifier: TokenVerifier | null = null
  private passes: SupportPassVerifier | null = null

  /** Present when running inside a service (docs/19): only that service's roles may pass. Absent in module specs. */
  constructor(
    @Optional() @Inject(SERVICE_INFO) private readonly service: ServiceDefinition | null,
  ) {
    this.permissions = routePermissions()
  }

  async onModuleInit(): Promise<void> {
    const keys = await loadAuthKeys()
    this.verifier = createTokenVerifier(keys)
    this.passes = createSupportPassVerifier(keys)
  }

  canActivate(context: ExecutionContext): boolean {
    const route = routeOf(context.getHandler())
    // A contract procedure nobody declared in PERMISSIONS (or a handler outside the contract) is a
    // programming error: nobody may call it, never "anybody may".
    const permission = this.permissions.get(route)
    if (permission === undefined) {
      throw new InternalServerErrorException(`endpoint has no permission entry: ${route}`)
    }
    if (permission === 'public') return true

    if (!this.verifier || !this.passes) {
      throw new ServiceUnavailableException('auth keys not loaded yet')
    }
    const req = context.switchToHttp().getRequest<SupportAwareRequest>()
    const token = bearerToken(req)
    if (!token) throw new UnauthorizedException('sign in required')
    const claims = this.verifier.verify(token)
    accessClaimsStorage.enterWith(claims)
    const pass = this.readPass(req)

    if (claims.role === 'platform_admin') {
      return this.admitConsole(req, claims, pass, permission, route)
    }
    // A distributor's own staff never present a support pass: the pass is the console's way in, and
    // honouring one here would let a manager borrow a window its owner granted to somebody else.
    if (pass) {
      throw new ForbiddenException(
        'x-support-grant belongs to a Distribution OS console session, not to a distributor login',
      )
    }

    if (permission === 'authenticated') {
      if (claims.role !== null) this.requireServed(claims.role)
      if (claims.tid !== null && claims.role !== null) enterTenant(claims, claims.tid, claims.role)
      return true
    }

    if (claims.tid === null || claims.role === null) {
      throw new ForbiddenException(
        'this token has no active tenant; sign in to a distributor first',
      )
    }
    this.requireServed(claims.role)
    if (!isAllowed(permission, claims.role)) {
      throw new ForbiddenException(`the ${claims.role} role may not call ${route}`)
    }
    enterTenant(claims, claims.tid, claims.role)
    return true
  }

  /**
   * The console's two doors. Without a pass this is admin-service and nothing else; with one it is a
   * distributor's own service, acting as that distributor's owner for as long as the owner agreed.
   */
  private admitConsole(
    req: SupportAwareRequest,
    claims: AccessClaims,
    pass: SupportAccessRecord['claims'] | null,
    permission: Permission,
    route: string,
  ): boolean {
    if (!pass) {
      this.requireServed('platform_admin')
      if (permission !== 'authenticated' && !isAllowed(permission, 'platform_admin')) {
        throw new ForbiddenException(`the platform_admin role may not call ${route}`)
      }
      tenantStorage.enterWith({
        tenantId: PLATFORM_SCOPE,
        actorId: claims.sub,
        actorRole: 'platform_admin',
      })
      return true
    }
    // The pass names the administrator it was minted for, so one console user cannot hand another
    // their window, and the audit row always names a person who actually made the call.
    if (pass.adminUserId !== claims.sub) {
      throw new ForbiddenException('this support pass was issued to another administrator')
    }
    const method = route.slice(0, route.indexOf(' '))
    if (!passAllowsMethod(pass.scope, method)) {
      throw new ForbiddenException(
        'this support window is read-only: the distributor approved a look, not a change',
      )
    }
    // Support access is READING A DISTRIBUTOR'S BOOKS, so it acts as that distributor's owner and is
    // held to exactly what an owner may do on this service — never more. On admin-service, which
    // serves no membership role, the next line refuses the pass outright.
    this.requireServed(SUPPORT_ACTING_ROLE)
    if (permission !== 'authenticated' && !isAllowed(permission, SUPPORT_ACTING_ROLE)) {
      throw new ForbiddenException(`a support window may not call ${route}`)
    }
    tenantStorage.enterWith({
      tenantId: pass.tenantId,
      actorId: claims.sub,
      actorRole: SUPPORT_ACTING_ROLE,
    })
    req.supportAccess = { claims: pass, method, route }
    return true
  }

  /** Verified `x-support-grant`, or null when the header is absent. A bad or lapsed pass is a 403. */
  private readPass(req: SupportAwareRequest): SupportAccessRecord['claims'] | null {
    const raw = req.headers['x-support-grant']
    const header = Array.isArray(raw) ? raw[0] : raw
    if (!header) return null
    const verified = this.passes?.verify(header.trim()) ?? null
    if (!verified) {
      throw new ForbiddenException(
        'this support window is not open: the pass is invalid or has expired',
      )
    }
    return verified
  }

  private requireServed(role: PermissionRole): void {
    if (this.service && !this.service.roles.includes(role)) {
      throw new ForbiddenException(`${this.service.name}-service does not serve the ${role} role`)
    }
  }
}

/**
 * The `app.tenant_id` a console session runs with. It is EMPTY on purpose: `platform_admin` belongs to
 * no distributor, and every tenant policy in the database compares `tenant_id` to this setting, so a
 * console query that wanders into a business table matches nothing instead of matching somebody.
 */
export const PLATFORM_SCOPE = ''

/** What an approved support window acts as inside a distributor: its owner, and nothing wider. */
const SUPPORT_ACTING_ROLE = 'owner' satisfies MembershipRole

function enterTenant(claims: AccessClaims, tenantId: string, role: PermissionRole): void {
  tenantStorage.enterWith({ tenantId, actorId: claims.sub, actorRole: role })
}

/**
 * Route key as Nest registers it for an `@Implement` method: `${METHOD} ${pattern}`, where the pattern
 * is the contract path run through the same `toNestPattern` that `@Implement` uses for `@Get`/`@Post`
 * (`/retailers/{id}` → `/retailers/:id`). Built from the whole contract, so a controller may serve any
 * subset and the guard still knows every procedure's permission.
 */
let routeCache: ReadonlyMap<string, Permission | undefined> | null = null

function routePermissions(): ReadonlyMap<string, Permission | undefined> {
  if (routeCache) return routeCache
  const map = new Map<string, Permission | undefined>()
  for (const p of contractProcedures(contract)) {
    map.set(`${p.method.toUpperCase()} ${toNestPattern(p.httpPath as `/${string}`)}`, p.permission)
  }
  routeCache = map
  return map
}

/** `${METHOD} ${pattern}` of the Nest handler this request resolved to (same shape as the route map). */
function routeOf(handler: object): string {
  const path: unknown = Reflect.getMetadata(PATH_METADATA, handler)
  const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler)
  const pattern = Array.isArray(path) ? String(path[0] ?? '') : typeof path === 'string' ? path : ''
  const verb = typeof method === 'number' ? RequestMethod[method] : 'GET'
  return `${verb} ${pattern}`
}

/**
 * The only part of the request the guard reads (plus the one thing it writes): keeps it independent of
 * the HTTP adapter's types. `supportAccess` is how the guard hands a console request to
 * `SupportAuditInterceptor`, which files the `platform_audit` row after the handler has answered.
 */
export interface SupportAwareRequest {
  headers: Record<string, string | string[] | undefined>
  supportAccess?: SupportAccessRecord
}

function bearerToken(req: SupportAwareRequest): string | null {
  const raw = req.headers['authorization']
  const header = Array.isArray(raw) ? raw[0] : raw
  if (!header) return null
  const [scheme, token, ...rest] = header.trim().split(/\s+/)
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token || rest.length > 0) return null
  return token
}

export interface TokenVerifier {
  kid: string
  /** Throws UnauthorizedException('token expired' | 'sign in required'). `now` is epoch seconds. */
  verify(token: string, now?: number): AccessClaims
}

/**
 * Synchronous EdDSA JWT verification with the auth public key (no call to auth-service per request).
 * Exported for the guard's own spec; services never call it directly.
 */
export function createTokenVerifier(keys: AuthKeys): TokenVerifier {
  const key: KeyObject = createPublicKey({ key: keys.publicJwk, format: 'jwk' })
  return {
    kid: keys.kid,
    verify: (token, now = Date.now() / 1000) => verifyAccessToken(token, key, keys.kid, now),
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

function verifyAccessToken(token: string, key: KeyObject, kid: string, now: number): AccessClaims {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts.every((p) => BASE64URL.test(p))) return invalid()
  const [h, p, s] = parts as [string, string, string]

  const header = decodeJson(h)
  if (!header || header.alg !== AUTH_ALG) return invalid()
  if (typeof header.kid === 'string' && header.kid !== kid) return invalid()

  if (!signatureOk(`${h}.${p}`, s, key)) return invalid()

  const payload = decodeJson(p)
  if (!payload) return invalid()
  if (payload.iss !== AUTH_ISSUER) return invalid()
  const aud = payload.aud
  const audienceOk =
    aud === AUTH_AUDIENCE || (Array.isArray(aud) && (aud as unknown[]).includes(AUTH_AUDIENCE))
  if (!audienceOk) return invalid()
  if (payload.iat !== undefined && typeof payload.iat !== 'number') return invalid()
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number') return invalid()
    if (payload.nbf > now + AUTH_CLOCK_TOLERANCE_SECONDS) return invalid()
  }
  if (typeof payload.exp !== 'number') return invalid()
  if (payload.exp <= now - AUTH_CLOCK_TOLERANCE_SECONDS) {
    throw new UnauthorizedException('token expired')
  }
  return toClaims(payload)
}

function signatureOk(signed: string, signature: string, key: KeyObject): boolean {
  try {
    return verifySignature(
      null,
      Buffer.from(signed, 'ascii'),
      key,
      Buffer.from(signature, 'base64url'),
    )
  } catch {
    return false
  }
}

function invalid(): never {
  throw new UnauthorizedException('sign in required')
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function toClaims(payload: Record<string, unknown>): AccessClaims {
  const sub = optionalString(payload.sub)
  const sid = optionalString(payload.sid)
  if (!sub || !sid) return invalid()
  const tid = optionalString(payload.tid)
  const roleRaw = optionalString(payload.role)
  // A console token (module 13) is the one shape where a role arrives WITHOUT a tenant. It is checked
  // against its own enum, which `MembershipRoleSchema` deliberately does not contain, so no tenant
  // sign-in can ever mint it and no console token can ever pass as a membership.
  if (roleRaw !== null && PlatformRoleSchema.safeParse(roleRaw).success) {
    if (tid !== null) return invalid()
    return {
      sub,
      tid: null,
      role: 'platform_admin',
      sid,
      did: optionalString(payload.did),
      jti: optionalString(payload.jti),
      expiresAt: new Date((payload.exp as number) * 1000),
    }
  }
  const role = roleRaw ? MembershipRoleSchema.safeParse(roleRaw) : null
  if (role && !role.success) return invalid()
  if ((tid === null) !== (role === null)) return invalid()
  return {
    sub,
    tid,
    role: role ? role.data : null,
    sid,
    did: optionalString(payload.did),
    jti: optionalString(payload.jti),
    expiresAt: new Date((payload.exp as number) * 1000),
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
