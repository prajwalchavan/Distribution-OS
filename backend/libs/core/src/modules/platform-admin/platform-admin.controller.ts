import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { PlatformConsoleService } from './console.service.js'
import { PlatformSubscriptionsService } from './subscriptions.service.js'
import { PlatformSupportService } from './support.service.js'
import { PlatformTenantsService } from './tenants.service.js'

/**
 * The platform console's fifteen procedures (module 13, founder decision 2026-09-05). Mounted by
 * `admin-service` :3007 and by nothing else, so a `platform_admin` token has exactly one door.
 *
 * `TenantGuard` is the same guard the six tenant services use: it verifies the token, sees the
 * `platform_admin` role, checks that THIS service serves it (only admin-service does) and enters a
 * console context whose `app.tenant_id` is empty — so a query that strays into a business table reads
 * nothing. Every row below is `ROLE_GROUPS.PLATFORM` in `permissions.ts`, and `platform_admin` is not
 * a `MembershipRole`, so "no distributor's staff can reach `admin.*`" is a type-level fact rather
 * than a convention.
 */
@Controller()
@UseGuards(TenantGuard)
export class PlatformAdminController {
  constructor(
    private readonly tenants: PlatformTenantsService,
    private readonly subscriptions: PlatformSubscriptionsService,
    private readonly support: PlatformSupportService,
    private readonly console: PlatformConsoleService,
  ) {}

  @Implement(contract.admin.tenants.create)
  createTenant(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.tenants.create).handler(({ input }) =>
      this.tenants.create(input),
    )
  }

  @Implement(contract.admin.tenants.list)
  listTenants(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.tenants.list).handler(({ input }) => this.tenants.list(input))
  }

  @Implement(contract.admin.tenants.get)
  getTenant(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.tenants.get).handler(({ input }) => this.tenants.get(input))
  }

  @Implement(contract.admin.tenants.suspend)
  suspendTenant(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.tenants.suspend).handler(({ input }) =>
      this.tenants.suspend(input),
    )
  }

  @Implement(contract.admin.tenants.reactivate)
  reactivateTenant(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.tenants.reactivate).handler(({ input }) =>
      this.tenants.reactivate(input),
    )
  }

  @Implement(contract.admin.subscriptions.upsert)
  upsertSubscription(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.subscriptions.upsert).handler(({ input }) =>
      this.subscriptions.upsert(input),
    )
  }

  @Implement(contract.admin.subscriptions.list)
  listSubscriptions(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.subscriptions.list).handler(({ input }) =>
      this.subscriptions.list(input),
    )
  }

  @Implement(contract.admin.subscriptions.get)
  getSubscription(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.subscriptions.get).handler(({ input }) =>
      this.subscriptions.get(input),
    )
  }

  /** ASK. There is deliberately no `approve` here — only the distributor's own owner opens a window. */
  @Implement(contract.admin.support.request)
  requestSupport(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.support.request).handler(({ input }) =>
      this.support.request(input),
    )
  }

  @Implement(contract.admin.support.list)
  listSupport(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.support.list).handler(({ input }) => this.support.list(input))
  }

  @Implement(contract.admin.support.revoke)
  revokeSupport(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.support.revoke).handler(({ input }) =>
      this.support.revoke(input),
    )
  }

  @Implement(contract.admin.users.list)
  listUsers(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.users.list).handler(({ input }) =>
      this.console.listUsers(input),
    )
  }

  @Implement(contract.admin.users.disable)
  disableUser(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.users.disable).handler(({ input }) =>
      this.console.disableUser(input),
    )
  }

  @Implement(contract.admin.metrics.overview)
  metrics(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.metrics.overview).handler(({ input }) =>
      this.console.metrics(input),
    )
  }

  @Implement(contract.admin.audit.list)
  audit(@OwnsReply() _reply: unknown) {
    return implement(contract.admin.audit.list).handler(({ input }) => this.console.audit(input))
  }
}
