import { PgBoss } from 'pg-boss'
import { createDb, createPool, loadDotenv } from '@dos/db'

loadDotenv()
import { registerClaimSheetRenderer } from '@dos/core/claims'
import { DOCUMENT_RENDER_EVENT } from '@dos/core/documents'
import { logger } from './logger.js'
import { registerDocintJobs } from './jobs/docint.js'
import {
  INTEGRATIONS_SWEEP,
  registerIntegrationsJobs,
  sweepIntegrations,
} from './jobs/integrations.js'
import { OUTBOX_RELAY, registerOutboxHandler, relayOutbox } from './jobs/outbox-relay.js'
import { handlePdfRenderJob, PDF_RENDER, renderPending } from './jobs/pdf-render.js'
import { RETENTION, runRetention } from './jobs/retention.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const pool = createPool(url)
const db = createDb(pool)
const boss = new PgBoss({ connectionString: url, schema: 'pgboss' })

boss.on('error', (error: Error) => logger.error({ err: error }, 'pg-boss error'))

await boss.start()
// The outbox relay (coordination §3.6): handlers per event type, registered before the first tick.
// `DocumentRenderRequested` renders through the registry now that one exists (pdf-render.ts);
// docint's `docint.document.submitted` starts the four-step pipeline (jobs/docint.ts).
registerOutboxHandler(DOCUMENT_RENDER_EVENT, (e) => handlePdfRenderJob(db, e.payload))
await registerDocintJobs(boss, db)
// Integrations (coordination §3.5): the importer's phases on `imports.run`, every export kind on the
// one `exports.render` queue, and a minute sweep for hand-offs the relay missed.
await registerIntegrationsJobs(boss, db)
// Claims (coordination §3.5): the `claim_sheet` renderer on the same `exports.render` registry.
registerClaimSheetRenderer()
await boss.createQueue(INTEGRATIONS_SWEEP)
await boss.work(INTEGRATIONS_SWEEP, async () => {
  await sweepIntegrations(db, boss)
})
await boss.schedule(INTEGRATIONS_SWEEP, '* * * * *')
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
// PDF renderer: the outbox relay above renders every `DocumentRenderRequested` row through the
// registry; this queue renders a direct `DocumentRenderRequest` job when one is sent, and a bare
// `{}` job drains whatever the relay has not reached yet (the old poll, kept for `pnpm smoke`).
await boss.createQueue(PDF_RENDER)
await boss.work(PDF_RENDER, async ([job]) => {
  if (job?.data && typeof job.data === 'object' && 'kind' in job.data) {
    await handlePdfRenderJob(db, job.data)
    return
  }
  await renderPending(db)
})
logger.info(
  'worker started: outbox relay every minute (PDF render, docint, integrations handlers registered), retention sweep hourly, docint queues qr-read/extract/validate/match, integrations queues imports.run/exports.render + sweep',
)

const shutdown = async (): Promise<void> => {
  logger.info('worker shutting down')
  await boss.stop({ graceful: true, timeout: 10_000 })
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
