import { Controller, Req, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import type { FastifyRequest } from 'fastify'
import { contract } from '@dos/contracts'
import { loadAuthKeys, OwnsReply } from '../../platform/index.js'
import { AccessTokenGuard } from './access-token.guard.js'
import { CurrentAuth, type AuthClaims } from './auth-context.js'
import { AuthService, type ClientInfo } from './auth.service.js'

/**
 * Sign-in, refresh, logout and switch-tenant take no token (they are the ones that hand tokens out);
 * me, sessions, revokeSession and changePassword carry a Bearer access token through AccessTokenGuard.
 * No TenantGuard here: nothing in this controller is tenant-scoped.
 */
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Implement(contract.auth.login)
  login(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.login).handler(({ input }) => this.auth.login(input, client))
  }

  @Implement(contract.auth.refresh)
  refresh(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.refresh).handler(({ input }) => this.auth.refresh(input, client))
  }

  @Implement(contract.auth.logout)
  logout(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.logout).handler(({ input }) => this.auth.logout(input, client))
  }

  @Implement(contract.auth.switchTenant)
  switchTenant(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.switchTenant).handler(({ input }) =>
      this.auth.switchTenant(input, client),
    )
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.me)
  me(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.me).handler(() => this.auth.me(auth))
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.sessions)
  sessions(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.sessions).handler(() => this.auth.sessions(auth))
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.revokeSession)
  revokeSession(
    @OwnsReply() _reply: unknown,
    @CurrentAuth() auth: AuthClaims,
    @Req() req: FastifyRequest,
  ) {
    const client = clientInfo(req)
    return implement(contract.auth.revokeSession).handler(({ input }) =>
      this.auth.revokeSession(auth, input, client),
    )
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.changePassword)
  changePassword(
    @OwnsReply() _reply: unknown,
    @CurrentAuth() auth: AuthClaims,
    @Req() req: FastifyRequest,
  ) {
    const client = clientInfo(req)
    return implement(contract.auth.changePassword).handler(({ input }) =>
      this.auth.changePassword(auth, input, client),
    )
  }

  @Implement(contract.auth.forgotPassword)
  forgotPassword(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.forgotPassword).handler(({ input }) =>
      this.auth.forgotPassword(input, client),
    )
  }

  @Implement(contract.auth.resetPassword)
  resetPassword(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.resetPassword).handler(({ input }) =>
      this.auth.resetPassword(input, client),
    )
  }

  /** Public: the verifying half of the signing key, so any service or integrator can check a token. */
  @Implement(contract.auth.jwks)
  jwks(@OwnsReply() _reply: unknown) {
    return implement(contract.auth.jwks).handler(async () => {
      const keys = await loadAuthKeys()
      return { keys: [keys.publicJwk] }
    })
  }
}

/** Fastify resolves `ip` from the socket (or x-forwarded-for when trustProxy is on); nothing else is trusted. */
function clientInfo(req: FastifyRequest): ClientInfo {
  return {
    ip: req.ip || null,
    userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
  }
}
