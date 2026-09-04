import 'dotenv/config'
import { PgBoss } from 'pg-boss'
import { createDb, createPool } from '@dos/db'
import { logger } from './logger.js'
import { OUTBOX_RELAY, relayOutbox } from './jobs/outbox-relay.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const pool = createPool(url)
const db = createDb(pool)
const boss = new PgBoss({ connectionString: url, schema: 'pgboss' })

boss.on('error', (error: Error) => logger.error({ err: error }, 'pg-boss error'))

await boss.start()
await boss.createQueue(OUTBOX_RELAY)
await boss.work(OUTBOX_RELAY, async () => {
  await relayOutbox(db)
})
await boss.schedule(OUTBOX_RELAY, '* * * * *')
logger.info('worker started: outbox relay scheduled every minute')

const shutdown = async (): Promise<void> => {
  logger.info('worker shutting down')
  await boss.stop({ graceful: true, timeout: 10_000 })
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
