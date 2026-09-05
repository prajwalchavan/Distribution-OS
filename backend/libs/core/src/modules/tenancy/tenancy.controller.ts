import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { ORPCError } from '@orpc/server'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantConfigService } from './config.service.js'
import { SupportAccessService } from './support.service.js'
import { TenancyService } from './tenancy.service.js'
import { TenantGuard } from './tenant.guard.js'

@Controller()
@UseGuards(TenantGuard)
export class TenancyController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly config: TenantConfigService,
    private readonly support: SupportAccessService,
  ) {}

  @Implement(contract.tenancy.me)
  me(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.me).handler(async () => {
      const me = await this.tenancy.me()
      if (!me)
        throw new ORPCError('UNAUTHORIZED', { message: 'No active membership for this tenant' })
      return me
    })
  }

  @Implement(contract.tenancy.staff.list)
  staffList(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.staff.list).handler(() => this.tenancy.listStaff())
  }

  @Implement(contract.tenancy.staff.create)
  staffCreate(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.staff.create).handler(({ input }) =>
      this.tenancy.createStaff(input),
    )
  }

  @Implement(contract.tenancy.staff.update)
  staffUpdate(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.staff.update).handler(({ input }) =>
      this.tenancy.updateStaff(input),
    )
  }

  @Implement(contract.tenancy.staff.setPassword)
  staffSetPassword(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.staff.setPassword).handler(({ input }) =>
      this.tenancy.setStaffPassword(input),
    )
  }

  @Implement(contract.tenancy.staff.setStatus)
  staffSetStatus(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.staff.setStatus).handler(({ input }) =>
      this.tenancy.setStaffStatus(input),
    )
  }

  @Implement(contract.tenancy.branding.get)
  brandingGet(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.branding.get).handler(() => this.config.branding())
  }

  @Implement(contract.tenancy.settings.get)
  settingsGet(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.settings.get).handler(({ input }) =>
      this.config.getSettings(input),
    )
  }

  @Implement(contract.tenancy.settings.set)
  settingsSet(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.settings.set).handler(({ input }) =>
      this.config.setSettings(input),
    )
  }

  @Implement(contract.tenancy.numbering.list)
  numberingList(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.numbering.list).handler(({ input }) =>
      this.config.listNumbering(input),
    )
  }

  @Implement(contract.tenancy.numbering.upsert)
  numberingUpsert(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.numbering.upsert).handler(({ input }) =>
      this.config.upsertNumbering(input),
    )
  }

  @Implement(contract.tenancy.featureFlags.list)
  featureFlagsList(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.featureFlags.list).handler(() => this.config.listFlags())
  }

  @Implement(contract.tenancy.featureFlags.set)
  featureFlagsSet(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.featureFlags.set).handler(({ input }) =>
      this.config.setFlags(input),
    )
  }

  @Implement(contract.tenancy.tenant.update)
  tenantUpdate(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.tenant.update).handler(({ input }) =>
      this.config.updateTenant(input),
    )
  }

  @Implement(contract.tenancy.audit.list)
  auditList(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.audit.list).handler(({ input }) =>
      this.config.listAudit(input),
    )
  }

  // The owner's half of platform support access. The console asks (`admin.support.request`); only
  // these three answer, and only an owner may call them (`OWNER_ONLY` in permissions.ts).

  @Implement(contract.tenancy.support.list)
  supportList(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.support.list).handler(({ input }) => this.support.list(input))
  }

  @Implement(contract.tenancy.support.approve)
  supportApprove(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.support.approve).handler(({ input }) =>
      this.support.approve(input),
    )
  }

  @Implement(contract.tenancy.support.revoke)
  supportRevoke(@OwnsReply() _reply: unknown) {
    return implement(contract.tenancy.support.revoke).handler(({ input }) =>
      this.support.revoke(input),
    )
  }
}
