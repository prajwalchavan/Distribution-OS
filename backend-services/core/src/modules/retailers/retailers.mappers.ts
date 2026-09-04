import type {
  Address,
  Beat,
  BeatAssignment,
  Retailer,
  RetailerLink,
  RetailerPublic,
  RetailerView,
  Visit,
} from '@dos/contracts'
import type {
  beatAssignments,
  beats,
  retailerLinks,
  retailers,
  TenantContext,
  visits,
} from '@dos/db'

/** DB rows -> contract shapes. Nothing here may add a column the contract does not name. */

export function pickCredit(row: typeof retailers.$inferSelect) {
  return {
    tier: row.tier,
    creditLimitPaise: row.creditLimitPaise,
    creditLimitBills: row.creditLimitBills,
    creditDays: row.creditDays,
    creditMode: row.creditMode,
  }
}

export function toPublic(row: typeof retailers.$inferSelect): RetailerPublic {
  return {
    id: row.id,
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    altPhone: row.altPhone,
    address: (row.address as Address | null) ?? null,
    lat: row.lat,
    lng: row.lng,
    beatId: row.beatId,
    gstRegType: row.gstRegType,
    gstin: row.gstin,
    stateCode: row.stateCode,
    paymentTerms: row.paymentTerms,
    cashDiscountBps: row.cashDiscountBps,
    cashDiscountDays: row.cashDiscountDays,
    active: row.active,
  }
}

export function toRetailer(row: typeof retailers.$inferSelect): Retailer {
  return {
    ...toPublic(row),
    ...pickCredit(row),
    code: row.code,
    identityId: row.identityId,
    onboardedBy: row.onboardedBy,
  }
}

/** The retailer role gets the public shape (no code/tier/credit) even though RLS already limited it to its own rows. */
export function toView(row: typeof retailers.$inferSelect, ctx: TenantContext): RetailerView {
  return ctx.actorRole === 'retailer' ? toPublic(row) : toRetailer(row)
}

export function toLink(row: typeof retailerLinks.$inferSelect): RetailerLink {
  return {
    id: row.id,
    retailerId: row.retailerId,
    identityId: row.identityId,
    userId: row.userId,
    linkedBy: row.linkedBy,
    status: row.status,
  }
}

export function toBeat(row: typeof beats.$inferSelect): Beat {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    visitDays: row.visitDays,
    active: row.active,
  }
}

export function toAssignment(row: typeof beatAssignments.$inferSelect): BeatAssignment {
  return {
    id: row.id,
    beatId: row.beatId,
    userId: row.userId,
    validFrom: row.validFrom,
    validTo: row.validTo,
  }
}

export function toVisit(row: typeof visits.$inferSelect): Visit {
  return {
    id: row.id,
    retailerId: row.retailerId,
    userId: row.userId,
    beatId: row.beatId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    outcome: row.outcome,
    reason: row.reason,
    lat: row.lat,
    lng: row.lng,
    note: row.note,
  }
}
