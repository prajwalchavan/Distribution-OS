import type { MembershipDues, MembershipRole, MembershipsSummary } from '@dos/contracts'
import { withTenant, type Db, type TenantContext } from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { lastBillForCaller } from '../billing/index.js'
import { openStopsForCaller } from '../delivery/index.js'
import { loadOutstandingTotals } from '../receivables/index.js'

/**
 * DOS-102 — the shop's home across every distributor it buys from, composed here.
 *
 * WHY THIS IS SAFE. Each membership's figures are read inside `tenantStorage.run(ctx, () =>
 * withTenant(db, ctx, …))` with the CALLER'S OWN actor id and the role of THAT membership — the exact
 * context `auth.switchTenant` would mint — so every policy that would apply after a switch applies
 * here, and a row the user could not see then it cannot see now. Nothing is read as the system role,
 * no token, session or `auth_events` row is written, and a tenant the user is not an active member of
 * is never queried at all.
 *
 * WHY IT LIVES IN AUTH. The read is cross-tenant by nature; every other service's guard pins the
 * caller to one `tid`. Auth composes it from three PLAIN FUNCTIONS exported by the modules that own
 * the tables (`receivables`, `billing`, `delivery`) through their `index.ts` — it touches none of
 * their tables itself (module boundary, coordination §4).
 *
 * WHAT A STAFF MEMBERSHIP ANSWERS. Zeros and nulls. A manager who also works at a distributor does
 * not "owe" it, and `loadOutstandingTotals` under a staff role would sum the WHOLE tenant's
 * receivable — the distributor's book, not this person's dues.
 */

/** A login belonging to more distributors than this is not a shop; the read stays bounded (docs/20). */
export const MAX_SUMMARY_MEMBERSHIPS = 20

export interface SummaryMembership {
  tenantId: string
  tenantSlug: string
  displayName: string
  logoUrl: string | null
  role: MembershipRole
  status: 'invited' | 'active' | 'disabled'
}

/** The three reads of one tenant, before they become wire shapes. */
interface Figures {
  outstandingPaise: number
  overduePaise: number
  openBills: number
  lastReceiptAt: Date | null
  lastReceiptPaise: number | null
  lastBill: MembershipDues['lastBill']
  onTheWay: { stops: number; state: 'pending' | 'started' | 'arrived'; etaAt: Date | null } | null
}

const EMPTY: Figures = {
  outstandingPaise: 0,
  overduePaise: 0,
  openBills: 0,
  lastReceiptAt: null,
  lastReceiptPaise: null,
  lastBill: null,
  onTheWay: null,
}

export async function membershipsSummary(
  db: Db,
  actorId: string,
  rows: readonly SummaryMembership[],
): Promise<MembershipsSummary> {
  const active = rows.filter((row) => row.status === 'active').slice(0, MAX_SUMMARY_MEMBERSHIPS)
  const items: MembershipDues[] = []
  for (const row of active) {
    const figures = row.role === 'retailer' ? await readAsMember(db, actorId, row) : EMPTY
    items.push({
      tenantId: row.tenantId,
      tenantSlug: row.tenantSlug,
      displayName: row.displayName,
      logoUrl: row.logoUrl,
      role: row.role,
      outstandingPaise: figures.outstandingPaise,
      overduePaise: figures.overduePaise,
      openBills: figures.openBills,
      lastReceiptAt: figures.lastReceiptAt?.toISOString() ?? null,
      lastReceiptPaise: figures.lastReceiptPaise,
      lastBill: figures.lastBill,
      onTheWay:
        figures.onTheWay === null
          ? null
          : {
              stops: figures.onTheWay.stops,
              state: figures.onTheWay.state,
              etaAt: figures.onTheWay.etaAt?.toISOString() ?? null,
            },
    })
  }
  return {
    items,
    totalOutstandingPaise: items.reduce((sum, item) => sum + item.outstandingPaise, 0),
    totalOverduePaise: items.reduce((sum, item) => sum + item.overduePaise, 0),
  }
}

/** One tenant's three small reads, in one transaction, as the caller's own membership. */
async function readAsMember(db: Db, actorId: string, row: SummaryMembership): Promise<Figures> {
  const ctx: TenantContext = { tenantId: row.tenantId, actorId, actorRole: row.role }
  return tenantStorage.run(ctx, () =>
    withTenant(db, ctx, async (tx) => {
      const totals = await loadOutstandingTotals(tx)
      const lastBill = await lastBillForCaller(tx)
      const onTheWay = await openStopsForCaller(tx)
      return { ...totals, lastBill, onTheWay }
    }),
  )
}
