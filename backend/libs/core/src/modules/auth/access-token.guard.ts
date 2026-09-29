import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { loadAuthKeys } from '../../platform/index.js'
import {
  readAccessToken,
  refuseFirstPasswordToken,
  SIGN_IN_REQUIRED,
  type AuthClaims,
  type AuthenticatedRequest,
} from './auth-context.js'
import { verifyAccessToken } from './tokens.js'

/**
 * Guard for the token-bearing auth procedures (me, sessions, revokeSession, changePassword): verifies the
 * Bearer access token with the public key and puts the claims on `request.auth` for `@CurrentAuth()`.
 * Stateless by design — a revoked session is caught by the service when it loads the session row.
 * Nothing tenant-scoped happens behind it, so it does not enter the tenant context.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
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
    // A password a desk gave is a first password on the server too (docs/22 §8, 2026-09-29).
    refuseFirstPasswordToken(context, claims)
    req.auth = claims
    return true
  }
}
