import { Module } from '@nestjs/common'
import { TenancyModule } from '../tenancy/index.js'
import { PlatformAdminController } from './platform-admin.controller.js'
import { PlatformConsoleService } from './console.service.js'
import { PlatformSubscriptionsService } from './subscriptions.service.js'
import { PlatformSupportService } from './support.service.js'
import { PlatformTenantsService } from './tenants.service.js'

/**
 * MODULE 13 — the platform console (founder decision 2026-09-05, docs/22 §2 row 7 and §8): onboarding
 * a distributor, its plan and subscription state, time-boxed owner-approved support access, the global
 * identity directory, the platform's own counts and the trail of everything our staff did.
 *
 * It is mounted by `admin-service` :3007 and by NOTHING else. The six tenant services never see it,
 * and the roles cannot cross: `platform_admin` is not a `MembershipRole`, and no `admin.*` row of the
 * permission matrix names one.
 *
 * `TenancyModule` is imported for `TenantGuard` alone, exactly as every other module's controller does
 * — not for `TenancyService`. Module 13 owns four global tables and reaches nothing of a distributor's
 * except through the two documented paths in `internals.ts`.
 */
@Module({
  imports: [TenancyModule],
  controllers: [PlatformAdminController],
  providers: [
    PlatformTenantsService,
    PlatformSubscriptionsService,
    PlatformSupportService,
    PlatformConsoleService,
  ],
  exports: [
    PlatformTenantsService,
    PlatformSubscriptionsService,
    PlatformSupportService,
    PlatformConsoleService,
  ],
})
export class PlatformAdminModule {}
