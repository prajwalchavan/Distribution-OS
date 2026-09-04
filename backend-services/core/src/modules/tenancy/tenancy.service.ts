import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import type { MeOutput } from '@dos/contracts'
import { memberships, tenants, users, withTenant, type Db } from '@dos/db'
import { currentTenant, DB } from '../../platform/index.js'

@Injectable()
export class TenancyService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /** Resolves the caller's user, tenant and membership inside the tenant-scoped transaction. */
  async me(): Promise<MeOutput | null> {
    if (!this.db) return null
    const ctx = currentTenant()
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ user: users, tenant: tenants, membership: memberships })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.actorId)))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      return {
        user: {
          id: row.user.id,
          phone: row.user.phone,
          name: row.user.name,
          locale: row.user.locale as 'en-IN' | 'hi-IN' | 'mr-IN',
        },
        tenant: {
          id: row.tenant.id,
          slug: row.tenant.slug,
          legalName: row.tenant.legalName,
          gstin: row.tenant.gstin,
          stateCode: row.tenant.stateCode,
          plan: row.tenant.plan,
          status: row.tenant.status,
        },
        membership: {
          id: row.membership.id,
          tenantId: row.membership.tenantId,
          userId: row.membership.userId,
          role: row.membership.role,
          status: row.membership.status,
        },
      }
    })
  }
}
