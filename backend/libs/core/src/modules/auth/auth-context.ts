import {
  createParamDecorator,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { PermissionRole } from '@dos/contracts'
import { CHOOSE_YOUR_OWN_PASSWORD } from '../../platform/index.js'

const WHILE_CHOOSING_PASSWORD = 'dos:auth:whileChoosingPassword'

/**
 * Marks one of auth-service's token-bearing procedures as open to a session that must still choose
 * its own password (`platform/first-password.ts`): `me`, `platformMe` and `changePassword` — what the
 * "Change your password" screen needs, and nothing else.
 */
export const WhileChoosingPassword = (): MethodDecorator =>
  SetMetadata(WHILE_CHOOSING_PASSWORD, true)

/** 403 in words for a first-password token on a procedure that is not marked `WhileChoosingPassword`. */
export function refuseFirstPasswordToken(context: ExecutionContext, claims: AuthClaims): void {
  if (claims.mustChangePassword !== true) return
  if (Reflect.getMetadata(WHILE_CHOOSING_PASSWORD, context.getHandler()) === true) return
  throw new ForbiddenException(CHOOSE_YOUR_OWN_PASSWORD)
}

/** What a verified access token says about the caller. Nothing here is trusted until AccessTokenGuard sets it. */
export interface AuthClaims {
  /** `sub`: the user id. */
  userId: string
  /** `tid`: the tenant the session is signed in to; null for a session that has not chosen one. */
  tenantId: string | null
  /**
   * `role`: the membership role in that tenant at the time the token was issued — or the single
   * non-membership role `platform_admin` (module 13), which arrives with `tenantId: null` because
   * Distribution OS's own staff belong to no distributor.
   */
  role: PermissionRole | null
  /** `sid`: auth_sessions.id, so a token can be tied back to the device session it came from. */
  sessionId: string
  /** `did`: the device id the session belongs to. */
  deviceId: string
  /**
   * `pwc`: the person signed in with a password a desk gave them and has not chosen their own yet
   * (`platform/first-password.ts`). Such a token reaches only what changing the password needs.
   * Absent = false.
   */
  mustChangePassword?: boolean
}

export const SIGN_IN_REQUIRED = 'Sign in to continue'

export type AuthenticatedRequest = FastifyRequest & { auth?: AuthClaims }

/** Bearer token from the Authorization header, or null when there is none. */
export function readAccessToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/** The claims AccessTokenGuard verified for this request; throws 401 when the guard did not run. */
export function readAuth(req: FastifyRequest): AuthClaims {
  const claims = (req as AuthenticatedRequest).auth
  if (!claims) throw new UnauthorizedException(SIGN_IN_REQUIRED)
  return claims
}

/**
 * Parameter decorator for `@Implement` methods behind AccessTokenGuard:
 *   me(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) { ... }
 * It reads what the guard put on the request. (An AsyncLocalStorage set from an async guard is not
 * visible to the handler — `enterWith` after an `await` binds the guard's own continuation only — so the
 * request object is the carrier.)
 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthClaims =>
    readAuth(ctx.switchToHttp().getRequest<FastifyRequest>()),
)
