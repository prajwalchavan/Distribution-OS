import { and, eq, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { uuidv7 } from '@dos/domain'
import { numberingSeries, retailerIdentities, retailers, users, type Db } from '@dos/db'

/**
 * ADR 0001 numbering for retailer codes. Codes are permanent identifiers under UNIQUE(tenant_id, code), so the
 * RET series must never restart with the financial year; it is keyed with this sentinel instead of the FY.
 */
const RET_SERIES = 'RET'
const RET_PERPETUAL_FY = 'ALL'
const RET_PREFIX = 'R-'

/**
 * ADR 0001: take the next number under SELECT ... FOR UPDATE; the RET series row is created on first use.
 *
 * The counter is never the only source of truth: a tenant can already hold codes the RET/ALL row knows nothing
 * about — seeded or imported shops, or codes handed out by an older series row keyed with the financial year
 * before this sentinel existed. Starting such a tenant at 1 would hand back a code that `UNIQUE(tenant_id, code)`
 * already owns, so the number is taken past whatever the tenant actually uses. Codes are permanent identifiers,
 * not a gapless statutory series (that rule is for invoices), so skipping ahead is safe.
 */
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
  const nextNo = Math.max(series.nextNo, (await highestCodeInUse(tx, tenantId, series.prefix)) + 1)
  await tx
    .update(numberingSeries)
    .set({ nextNo: nextNo + 1, updatedAt: new Date() })
    .where(
      and(
        eq(numberingSeries.tenantId, tenantId),
        eq(numberingSeries.seriesCode, RET_SERIES),
        eq(numberingSeries.fy, RET_PERPETUAL_FY),
      ),
    )
  return `${series.prefix}${String(nextNo).padStart(4, '0')}`
}

/** The largest number already spent on `<prefix><digits>` in this tenant; 0 when the tenant has none. */
async function highestCodeInUse(tx: Db, tenantId: string, prefix: string): Promise<number> {
  // the `::int` is load-bearing: with an untyped bind Postgres resolves `substring(text from ?)` to the POSIX
  // regex overload, so `substring('R-0036' from 3)` would match the pattern "3" and yield "3", not "0036"
  const tail = sql`substring(${retailers.code} from ${prefix.length + 1}::int)`
  const [row] = await tx
    .select({ highest: sql<number>`coalesce(max(${tail}::bigint), 0)::int` })
    .from(retailers)
    .where(
      and(
        eq(retailers.tenantId, tenantId),
        sql`starts_with(${retailers.code}, ${prefix})`,
        sql`${tail} ~ '^[0-9]{1,9}$'`,
      ),
    )
  return row?.highest ?? 0
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
