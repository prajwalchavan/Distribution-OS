import { Global, Module } from '@nestjs/common'
import { createDb, createPool, type Db } from '@dos/db'
import type pg from 'pg'
import { loadEnv, type Env } from './config.js'

export const DB = Symbol('DB')
export const PG_POOL = Symbol('PG_POOL')
/** The read-replica drizzle client. IS `DB` when `DATABASE_REPLICA_URL` is unset (coordination §3.8). */
export const DB_REPLICA = Symbol('DB_REPLICA')
export const PG_REPLICA_POOL = Symbol('PG_REPLICA_POOL')

/**
 * A second pool for reports (docs/20 rule 10): a dashboard that scans a month of rollup rows must never
 * compete with the order that is being confirmed right now. `DATABASE_REPLICA_URL` is optional and unset
 * on the founder's Mac, so this returns null and `DB_REPLICA` resolves to the very same client as `DB` —
 * correctness-neutral today, one variable away from a real replica in production.
 */
export function createReplicaPool(env: Env = loadEnv()): pg.Pool | null {
  return env.DATABASE_REPLICA_URL ? createPool(env.DATABASE_REPLICA_URL) : null
}

/** One pool per process; modules receive the drizzle client with `@Inject(DB)`. Null when DATABASE_URL is unset (tests). */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): pg.Pool | null => {
        const env = loadEnv()
        return env.DATABASE_URL ? createPool(env.DATABASE_URL) : null
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool | null): Db | null => (pool ? createDb(pool) : null),
    },
    {
      provide: PG_REPLICA_POOL,
      useFactory: (): pg.Pool | null => createReplicaPool(),
    },
    {
      provide: DB_REPLICA,
      inject: [PG_REPLICA_POOL, DB],
      // No replica configured → the primary client itself, so `db.replica ?? db.primary` is never a branch
      // a reader has to think about and a spec can assert the two are the same object.
      useFactory: (pool: pg.Pool | null, primary: Db | null): Db | null =>
        pool ? createDb(pool) : primary,
    },
  ],
  exports: [DB, PG_POOL, DB_REPLICA, PG_REPLICA_POOL],
})
export class DbModule {}
