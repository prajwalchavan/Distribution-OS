import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index.js'

export type Db = NodePgDatabase<typeof schema>
export type Schema = typeof schema

export type ActorRole =
  | 'owner'
  | 'manager'
  | 'salesperson'
  | 'delivery'
  | 'accountant'
  | 'retailer'
  | 'curator'
  | 'support'
  | 'system'

export interface TenantContext {
  tenantId: string
  actorId: string
  actorRole: ActorRole
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 })
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema, casing: 'snake_case' })
}

/**
 * ADR 0002: runs `fn` inside a transaction with the tenant context applied as Postgres settings, so
 * every RLS policy sees current_setting('app.tenant_id' | 'app.actor_id' | 'app.actor_role').
 * This is the ONLY sanctioned way to touch tenant data. Settings are transaction-local (`true`).
 */
export async function withTenant<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Defence in depth: even if DATABASE_URL is the owner/superuser (local dev, CI), tenant work runs as app_rw,
    // so every RLS policy applies. Migrations grant app_rw to the migrating role (0003).
    await tx.execute(sql`set local role app_rw`)
    await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`)
    await tx.execute(sql`select set_config('app.actor_id', ${ctx.actorId}, true)`)
    await tx.execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
    return fn(tx)
  })
}

export async function ping(db: Db): Promise<boolean> {
  const result = await db.execute(sql`select 1 as ok`)
  return result.rows.length === 1
}
