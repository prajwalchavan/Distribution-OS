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
  | 'warehouse'
  | 'curator'
  | 'support'
  /**
   * Module 13 (founder decision 2026-09-05, docs/22 §2 row 7): Distribution OS's own staff in the
   * platform console. A GLOBAL actor with no membership in any tenant — deliberately absent from the
   * `membership_role` enum — so it never arrives from a tenant sign-in; only `admin-service` (:3007)
   * issues it, and only the four `platform_admin` tables plus `tenants` have policies that admit it.
   * Reading a distributor's own business data still needs an owner-approved `support_grants` row.
   */
  | 'platform_admin'
  | 'system'

export interface TenantContext {
  tenantId: string
  actorId: string
  actorRole: ActorRole
}

/**
 * Default connections per process. Every service replica and every worker opens its own pool, so the
 * ceiling that matters is `replicas x DATABASE_POOL_MAX <= the database's max_connections`
 * (docs/20-scale-rules.md). Postgres here allows 100; seven services at 10 already reserve 70, which
 * is why a test run that boots a pool per spec file must lower it — see `DATABASE_POOL_MAX`.
 */
export const DEFAULT_POOL_MAX = 10

export function poolMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DATABASE_POOL_MAX)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_POOL_MAX
}

export function createPool(connectionString: string, max: number = poolMax()): pg.Pool {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 })
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

/**
 * Cross-tenant work that has no tenant context yet: sign-in by username, refresh-token rotation, the
 * worker's outbox relay and retention sweeps. Runs as `app_worker` (BYPASSRLS, granted to the connection
 * user in migration 0003) with `app.actor_role = 'system'`, so policies that name the system role still
 * read correctly. Use it only where a tenant genuinely cannot be known; everything else uses withTenant.
 */
export async function withSystem<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_worker`)
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return fn(tx)
  })
}

export async function ping(db: Db): Promise<boolean> {
  const result = await db.execute(sql`select 1 as ok`)
  return result.rows.length === 1
}
