import { and, eq } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { uuidv7 } from '@dos/domain'
import { numberingSeries, retailerIdentities, users, type Db } from '@dos/db'

/**
 * ADR 0001 numbering for retailer codes. Codes are permanent identifiers under UNIQUE(tenant_id, code), so the
 * RET series must never restart with the financial year; it is keyed with this sentinel instead of the FY.
 */
const RET_SERIES = 'RET'
const RET_PERPETUAL_FY = 'ALL'
const RET_PREFIX = 'R-'

/** ADR 0001: take the next number under SELECT ... FOR UPDATE; the RET series row is created on first use. */
export async function nextRetailerCode(tx: Db, tenantId: string): Promise<string> {
  const lockRow = () =>
    tx
      .select({ prefix: numberingSeries.prefix, nextNo: numberingSeries.nextNo })
      .from(numberingSeries)
      .where(
        and(
          eq(numberingSeries.tenantId, tenantId),
          eq(numberingSeries.seriesCode, RET_SERIES),
          eq(numberingSeries.fy, RET_PERPETUAL_FY),
        ),
      )
      .for('update')
  let [series] = await lockRow()
  if (!series) {
    await tx
      .insert(numberingSeries)
      .values({ tenantId, seriesCode: RET_SERIES, fy: RET_PERPETUAL_FY, prefix: RET_PREFIX })
      .onConflictDoNothing()
    ;[series] = await lockRow()
  }
  if (!series)
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'numbering series RET unavailable' })
  await tx
    .update(numberingSeries)
    .set({ nextNo: series.nextNo + 1, updatedAt: new Date() })
    .where(
      and(
        eq(numberingSeries.tenantId, tenantId),
        eq(numberingSeries.seriesCode, RET_SERIES),
        eq(numberingSeries.fy, RET_PERPETUAL_FY),
      ),
    )
  return `${series.prefix}${String(series.nextNo).padStart(4, '0')}`
}

export type Identity = { id: string; userId: string | null }

export async function findOrCreateIdentity(
  tx: Db,
  phone: string,
  shopName: string,
): Promise<{ identity: Identity; created: boolean }> {
  const [visible] = await tx
    .select({ id: retailerIdentities.id, userId: retailerIdentities.userId })
    .from(retailerIdentities)
    .where(eq(retailerIdentities.phone, phone))
  if (visible) return { identity: visible, created: false }
  // a login with this phone that is visible to us (self or a member of this tenant) becomes the identity's user
  const [login] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone))
  const identity: Identity = { id: uuidv7(), userId: login?.id ?? null }
  try {
    // savepoint: a unique-phone violation must not abort the surrounding transaction
    await tx.transaction(async (sp) => {
      await sp
        .insert(retailerIdentities)
        .values({ id: identity.id, phone, userId: identity.userId, shopName })
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ORPCError('CONFLICT', {
        message:
          'This phone already has a retailer identity that is not linked to this distributor; the shop must opt in from the retailer app (directory) or support must link it.',
      })
    }
    throw err
  }
  return { identity, created: true }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}
