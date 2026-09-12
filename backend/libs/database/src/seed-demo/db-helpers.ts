import { and, eq, getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from '../client.js'
import { numberingSeries, stockBalances, stockLedger } from '../schema/index.js'
import { FY } from './util.js'

/**
 * The prefix this distributor's own documents carry, e.g. `INV/` for the pilot and `SAI/` for Sai
 * Distributors. The invoice series is per-tenant configuration and never hard-coded (docs/17 §D1),
 * so the seeded history has to read it rather than assume one — otherwise every distributor's bills
 * would print with the pilot's numbers on a screen that shows its own name and logo.
 */
export async function seriesPrefix(
  db: Db,
  tenantId: string,
  seriesCode: string,
  fallback: string,
): Promise<string> {
  const [row] = await db
    .select({ prefix: numberingSeries.prefix })
    .from(numberingSeries)
    .where(
      and(
        eq(numberingSeries.tenantId, tenantId),
        eq(numberingSeries.seriesCode, seriesCode),
        eq(numberingSeries.fy, FY),
      ),
    )
    .limit(1)
  return row?.prefix ?? fallback
}

/**
 * `db.insert(table).values([])` throws ("values() must be called with at least one value"), and several
 * of this seed's row arrays are legitimately empty depending on the deterministic random draw. This skips
 * the round trip instead of every call site needing its own length check.
 */
export async function insertMany<T extends PgTable>(
  db: Db,
  table: T,
  rows: T['$inferInsert'][],
): Promise<void> {
  const slices = chunked(rows)
  if (slices.length <= 1) {
    for (const slice of slices) await db.insert(table).values(slice).onConflictDoNothing()
    return
  }
  // One transaction for the whole batch: `journal_lines` is checked for balance at COMMIT, and an
  // entry whose lines straddle two statements would otherwise fail the check on the first.
  await db.transaction(async (tx) => {
    for (const slice of slices) await tx.insert(table).values(slice).onConflictDoNothing()
  })
}

/**
 * Postgres binds at most 65 535 parameters per statement (and counts them in a 16-bit field, so an
 * overflow reads as "bind message has N parameter formats but 0 parameters"). A ninety-day order
 * book is several thousand lines of twenty columns; slice it so no statement comes near the limit.
 */
function chunked<R extends object>(rows: R[]): R[][] {
  if (rows.length === 0) return []
  const columns = rows.reduce((n, r) => Math.max(n, Object.keys(r).length), 1)
  const size = Math.max(1, Math.floor(30_000 / columns))
  const out: R[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/**
 * The rollup tables (`daily_*`, `retailer_behaviour`, `owner_summary`) are DERIVED rows the worker
 * rewrites by upsert on their primary key (docs/plans/reporting.md §4 rule 4), never business records,
 * so the seed treats them the same way: an existing row is brought up to what this seed computes (a
 * column added by a later migration gets its value on the founder's already-seeded database), a missing
 * one is inserted. Still idempotent — the same seed produces the same values. `columns` names the
 * columns to refresh; everything else (the key, `computed_at` defaults) is left alone.
 */
export async function upsertMany<T extends PgTable>(
  db: Db,
  table: T,
  rows: T['$inferInsert'][],
  target: PgColumn[],
  columns: (keyof T['_']['columns'] & string)[],
): Promise<void> {
  if (rows.length === 0) return
  const all = getTableColumns(table) as Record<string, PgColumn>
  const set: Record<string, SQL> = {}
  for (const key of columns) {
    const column = all[key]
    if (!column) throw new Error(`upsertMany: ${String(key)} is not a column of the table`)
    set[key] = sql.raw(`excluded."${column.name}"`)
  }
  for (const slice of chunked(rows))
    await db.insert(table).values(slice).onConflictDoUpdate({ target, set })
}

/**
 * Writes stock-ledger rows AND moves the balances they imply, in two statements, so `stock_ledger`
 * and `stock_balances` can never disagree whichever seed module wrote the movement.
 *
 * The ledger insert is `ON CONFLICT DO NOTHING` on `(tenant_id, idempotency_key)` and RETURNS only the
 * rows it actually wrote; the balance deltas are folded from THOSE rows alone, so a re-seed (every row
 * already there) moves nothing, and a seed that dies half way leaves the two in step for what it did
 * write. Positive deltas upsert (a lot's first row at a location is created here); negative deltas
 * UPDATE only — Postgres checks `on_hand >= 0` on the proposed INSERT row before it looks for a
 * conflict, so a negative delta must never travel as an insert. A negative delta whose balance row does
 * not exist yet is refused with a clear message: it means the caller is issuing stock from a place that
 * never received any, which is the drift this helper exists to prevent.
 *
 * `negativeAllowedAt` names the locations (the damaged/expiry bin) whose fresh balance rows are created
 * with `negative_allowed = true`, exactly as the inventory bootstrap marks them.
 */
export async function postLedger(
  db: Db,
  tenantId: string,
  rows: (typeof stockLedger.$inferInsert)[],
  negativeAllowedAt: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (rows.length === 0) return
  const written: { lotId: string; locationId: string; qtyDelta: number }[] = []
  for (const slice of chunked(rows)) {
    written.push(
      ...(await db
        .insert(stockLedger)
        .values(slice)
        .onConflictDoNothing({ target: [stockLedger.tenantId, stockLedger.idempotencyKey] })
        .returning({
          lotId: stockLedger.lotId,
          locationId: stockLedger.locationId,
          qtyDelta: stockLedger.qtyDelta,
        })),
    )
  }
  if (written.length === 0) return
  const delta = new Map<string, { lotId: string; locationId: string; qty: number }>()
  for (const w of written) {
    const key = `${w.lotId}:${w.locationId}`
    const entry = delta.get(key) ?? { lotId: w.lotId, locationId: w.locationId, qty: 0 }
    entry.qty += w.qtyDelta
    delta.set(key, entry)
  }
  const ups = [...delta.values()].filter((d) => d.qty > 0)
  const downs = [...delta.values()].filter((d) => d.qty < 0)
  const flat = [...delta.values()].filter((d) => d.qty === 0)
  if (flat.length > 0) {
    // Opened and issued out in the same batch (the sold-out SKUs): the lot still gets its balance row,
    // at zero, so a stock screen lists it rather than not knowing it.
    await db
      .insert(stockBalances)
      .values(
        flat.map((d) => ({
          tenantId,
          lotId: d.lotId,
          locationId: d.locationId,
          onHand: 0,
          reserved: 0,
          negativeAllowed: negativeAllowedAt.has(d.locationId),
        })),
      )
      .onConflictDoNothing()
  }
  if (ups.length > 0) {
    await db
      .insert(stockBalances)
      .values(
        ups.map((d) => ({
          tenantId,
          lotId: d.lotId,
          locationId: d.locationId,
          onHand: d.qty,
          reserved: 0,
          negativeAllowed: negativeAllowedAt.has(d.locationId),
        })),
      )
      .onConflictDoUpdate({
        target: [stockBalances.tenantId, stockBalances.lotId, stockBalances.locationId],
        set: {
          onHand: sql`${stockBalances.onHand} + excluded.on_hand`,
          version: sql`${stockBalances.version} + 1`,
          updatedAt: new Date(),
        },
      })
  }
  for (const d of downs) {
    const moved = await db
      .update(stockBalances)
      .set({
        onHand: sql`${stockBalances.onHand} + ${d.qty}`,
        version: sql`${stockBalances.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stockBalances.tenantId, tenantId),
          eq(stockBalances.lotId, d.lotId),
          eq(stockBalances.locationId, d.locationId),
        ),
      )
      .returning({ lotId: stockBalances.lotId })
    if (moved.length === 0) {
      if (!negativeAllowedAt.has(d.locationId)) {
        throw new Error(
          `postLedger: ${-d.qty} pcs issued from lot ${d.lotId} at ${d.locationId}, which holds no balance`,
        )
      }
      await db
        .insert(stockBalances)
        .values({
          tenantId,
          lotId: d.lotId,
          locationId: d.locationId,
          onHand: d.qty,
          reserved: 0,
          negativeAllowed: true,
        })
        .onConflictDoNothing()
    }
  }
}
