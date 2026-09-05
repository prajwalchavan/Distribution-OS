import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { MembershipRole } from '@dos/contracts'

/** What a verified access token says about the caller. Nothing here is trusted until AccessTokenGuard sets it. */
export interface AuthClaims {
  /** `sub`: the user id. */
  userId: string
  /** `tid`: the tenant the session is signed in to; null for a session that has not chosen one. */
  tenantId: string | null
  /** `role`: the membership role in that tenant at the time the token was issued. */
  role: MembershipRole | null
  /** `sid`: auth_sessions.id, so a token can be tied back to the device session it came from. */
  sessionId: string
  /** `did`: the device id the session belongs to. */
  deviceId: string
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
