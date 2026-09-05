import { PgBoss } from 'pg-boss'
import { createDb, createPool, loadDotenv } from '@dos/db'

loadDotenv()
import { logger } from './logger.js'
import { OUTBOX_RELAY, relayOutbox } from './jobs/outbox-relay.js'
import { handlePdfRenderJob, PDF_RENDER, renderPending } from './jobs/pdf-render.js'
import { RETENTION, runRetention } from './jobs/retention.js'

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
await boss.createQueue(RETENTION)
await boss.work(RETENTION, async () => {
  await runRetention(db)
})
await boss.schedule(RETENTION, '17 * * * *')
// PDF renderer: drains the outbox's render requests every minute (and after every drain that found
// work, immediately again), and renders a direct `DocumentRenderRequest` job when one is sent.
await boss.createQueue(PDF_RENDER)
await boss.work(PDF_RENDER, async ([job]) => {
  if (job?.data && typeof job.data === 'object' && 'kind' in job.data) {
    await handlePdfRenderJob(db, job.data)
    return
  }
  const done = await renderPending(db)
  if (done > 0) await boss.send(PDF_RENDER, {}, { singletonKey: 'drain', singletonSeconds: 5 })
})
await boss.schedule(PDF_RENDER, '* * * * *', {}, { singletonKey: 'drain-cron' })
logger.info(
  'worker started: outbox relay every minute, retention sweep hourly, PDF renderer every minute',
)

const shutdown = async (): Promise<void> => {
  logger.info('worker shutting down')
  await boss.stop({ graceful: true, timeout: 10_000 })
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
