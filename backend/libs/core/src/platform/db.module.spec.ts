import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import type { Db } from '@dos/db'
import { loadEnv } from './config.js'
import { createReplicaPool, DB, DB_REPLICA, DbModule } from './db.module.js'

/**
 * The read-replica pool (docs/20 rule 10, coordination §3.8). Reporting reads through `DB_REPLICA`; the
 * guarantee this file exists for is that a deployment WITHOUT a replica is not a special case — the
 * symbol resolves to the primary client itself.
 */
describe('DB_REPLICA', () => {
  it('falls back to the primary client when DATABASE_REPLICA_URL is unset', async () => {
    // The founder's Mac (and CI) run one Postgres; backend/.env sets no replica url.
    expect(loadEnv().DATABASE_REPLICA_URL).toBeUndefined()
    const moduleRef = await Test.createTestingModule({ imports: [DbModule] }).compile()
    const primary = moduleRef.get<Db | null>(DB)
    const replica = moduleRef.get<Db | null>(DB_REPLICA)
    expect(replica).toBe(primary)
    await moduleRef.close()
  })

  it('builds a distinct pool when the replica url is set', async () => {
    const pool = createReplicaPool({
      ...loadEnv(),
      DATABASE_REPLICA_URL: 'postgres://dos:dos@127.0.0.1:5439/dos',
    })
    expect(pool).not.toBeNull()
    // pg.Pool is lazy: nothing connected, so ending it is free.
    await pool?.end()
  })

  it('builds no pool when the replica url is absent', () => {
    expect(createReplicaPool({ ...loadEnv(), DATABASE_REPLICA_URL: undefined })).toBeNull()
  })
})
