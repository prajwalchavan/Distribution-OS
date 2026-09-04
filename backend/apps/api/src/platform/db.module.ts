import { Global, Module } from '@nestjs/common'
import { createDb, createPool, type Db } from '@dos/db'
import type pg from 'pg'
import { loadEnv } from './config.js'

export const DB = Symbol('DB')
export const PG_POOL = Symbol('PG_POOL')

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
  ],
  exports: [DB, PG_POOL],
})
export class DbModule {}
