import { Controller, Req, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import type { FastifyRequest } from 'fastify'
import { contract } from '@dos/contracts'
import { loadAuthKeys, OwnsReply } from '../../platform/index.js'
import { AccessTokenGuard } from './access-token.guard.js'
import { PlatformTokenGuard } from './platform-token.guard.js'
import { CurrentAuth, WhileChoosingPassword, type AuthClaims } from './auth-context.js'
import { AuthService, type ClientInfo } from './auth.service.js'

/**
 * Sign-in, refresh, logout and switch-tenant take no token (they are the ones that hand tokens out);
 * me, sessions, revokeSession and changePassword carry a Bearer access token through AccessTokenGuard.
 * No TenantGuard here: nothing in this controller is tenant-scoped.
 *
 * A session that must still choose its own password (the token's `pwc` claim, docs/22 §8 2026-09-29)
 * reaches only the procedures marked `@WhileChoosingPassword()`: me, platformMe and changePassword.
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

  /** The shopkeeper's own account (founder, 2026-09-29): public, like sign-in. */
  @Implement(contract.auth.signUp)
  signUp(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.signUp).handler(({ input }) => this.auth.signUp(input, client))
  }

  // The shopkeeper's half of joining a distributor's shop: the account's Bearer token, with or without a
  // distributor. Never while a desk's first password is still in use (`@WhileChoosingPassword()` is not set).

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.joins.lookup)
  joinLookup(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.joins.lookup).handler(({ input }) =>
      this.auth.joinLookup(auth, input),
    )
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.joins.distributors)
  joinDistributors(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.joins.distributors).handler(({ input }) =>
      this.auth.joinDistributors(auth, input),
    )
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.joins.ask)
  joinAsk(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.joins.ask).handler(({ input }) => this.auth.joinAsk(auth, input))
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.joins.mine)
  joinMine(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.joins.mine).handler(() => this.auth.joinMine(auth))
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.joins.withdraw)
  joinWithdraw(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.joins.withdraw).handler(({ input }) =>
      this.auth.joinWithdraw(auth, input),
    )
  }

  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.joins.leave)
  joinLeave(
    @OwnsReply() _reply: unknown,
    @CurrentAuth() auth: AuthClaims,
    @Req() req: FastifyRequest,
  ) {
    const client = clientInfo(req)
    return implement(contract.auth.joins.leave).handler(({ input }) =>
      this.auth.joinLeave(auth, input, client),
    )
  }

  // ------------------------------------------------------------ the platform console (module 13)

  @Implement(contract.auth.platformLogin)
  platformLogin(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.platformLogin).handler(({ input }) =>
      this.auth.platformLogin(input, client),
    )
  }

  @Implement(contract.auth.platformRefresh)
  platformRefresh(@OwnsReply() _reply: unknown, @Req() req: FastifyRequest) {
    const client = clientInfo(req)
    return implement(contract.auth.platformRefresh).handler(({ input }) =>
      this.auth.platformRefresh(input, client),
    )
  }

  @UseGuards(PlatformTokenGuard)
  @WhileChoosingPassword()
  @Implement(contract.auth.platformMe)
  platformMe(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.platformMe).handler(() => this.auth.platformMe(auth))
  }

  /** The pass a distributor's own service will honour, once that distributor's owner has approved. */
  @UseGuards(PlatformTokenGuard)
  @Implement(contract.auth.supportPass)
  supportPass(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.supportPass).handler(({ input }) =>
      this.auth.supportPass(auth, input),
    )
  }

  @UseGuards(AccessTokenGuard)
  @WhileChoosingPassword()
  @Implement(contract.auth.me)
  me(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.me).handler(() => this.auth.me(auth))
  }

  /** DOS-102: the cross-tenant read behind the shop's home; every figure is read under RLS per membership. */
  @UseGuards(AccessTokenGuard)
  @Implement(contract.auth.memberships.summary)
  membershipsSummary(@OwnsReply() _reply: unknown, @CurrentAuth() auth: AuthClaims) {
    return implement(contract.auth.memberships.summary).handler(() =>
      this.auth.membershipsSummary(auth),
    )
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
  @WhileChoosingPassword()
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
