/**
 * UX-O-8 put five owner lists newest first on their window column with the id as the tie-break, keyset-paged on
 * `(column, id)`. The only indexes they had led with a filter they do not always carry — `(tenant_id, status,
 * created_at)`, `(tenant_id, supplier_id, …)` — so an UNFILTERED page sorted every row of the tenant before it
 * could return fifty (owner-ux repair, verifier finding 6; docs/20: lakhs of rows per tenant). Migration 0073
 * adds a `(tenant_id, column, id)` index for each; this file fails if one goes missing or changes shape. (A plan
 * assertion was tried and dropped: on a dev-sized table the planner's choice depends on its statistics.)
 */
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb, createPool, type Db } from './client.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const KEYSET_INDEXES: readonly (readonly [table: string, index: string, columns: string])[] = [
  ['messages', 'messages_created_idx', '(tenant_id, created_at, id)'],
  ['export_jobs', 'export_jobs_created_idx', '(tenant_id, created_at, id)'],
  ['grns', 'grns_created_idx', '(tenant_id, created_at, id)'],
  ['purchase_orders', 'purchase_orders_created_idx', '(tenant_id, created_at, id)'],
  ['supplier_invoices', 'supplier_invoices_date_idx', '(tenant_id, invoice_date, id)'],
]

describeDb('keyset indexes behind the owner lists (UX-O-8)', () => {
  const pool = createPool(url ?? '', 2)
  const db: Db = createDb(pool)

  afterAll(async () => {
    await pool.end()
  })

  it.each(KEYSET_INDEXES)('%s carries %s on %s', async (table, index, columns) => {
    const rows = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = ${table} and indexname = ${index}`,
    )
    expect(rows.rows, `${index} is missing`).toHaveLength(1)
    expect(rows.rows[0]?.indexdef).toContain(`USING btree ${columns}`)
  })
})
