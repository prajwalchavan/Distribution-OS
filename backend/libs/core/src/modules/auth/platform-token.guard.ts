import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { loadAuthKeys } from '../../platform/index.js'
import {
  readAccessToken,
  SIGN_IN_REQUIRED,
  type AuthClaims,
  type AuthenticatedRequest,
} from './auth-context.js'
import { verifyAccessToken } from './tokens.js'

/**
 * `AccessTokenGuard` plus the one extra fact the console's own procedures need: this token is a
 * CONSOLE token (module 13, founder decision 2026-09-05). `auth.platformMe` and `auth.supportPass`
 * carry `PLATFORM` in the permission matrix, and auth-service is the one service that mounts no
 * `TenantGuard` — nothing tenant-scoped happens there — so the matrix has to be honoured here or it
 * would be a comment rather than a rule.
 *
 * The refusal is a Nest `ForbiddenException` on purpose, not an oRPC business error: it is the same
 * kind of answer the guard on every other service gives for the same reason ("your role may not call
 * this"), and the README generator and the permission-matrix harness both read that shape.
 *
 * It checks the ROLE IN THE TOKEN only. Whether the person is still an active administrator is the
 * handler's question, because the answer is in `platform_admins` and this guard is not allowed to
 * wait for the database (see `AccessTokenGuard`: nothing tenant-scoped hangs off these procedures).
 */
@Injectable()
export class PlatformTokenGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = readAccessToken(req)
    if (!token) throw new UnauthorizedException(SIGN_IN_REQUIRED)
    let claims: AuthClaims
    try {
      claims = await verifyAccessToken(token, await loadAuthKeys())
    } catch {
      throw new UnauthorizedException(SIGN_IN_REQUIRED)
    }
    if (claims.role !== 'platform_admin') {
      throw new ForbiddenException(
        'this endpoint belongs to the Distribution OS console; sign in at POST /auth/platform/login',
      )
    }
    req.auth = claims
    return true
  }
}
