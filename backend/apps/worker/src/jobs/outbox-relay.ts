import { isNull } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { outboxEvents } from '@dos/db'
import { logger } from '../logger.js'

export const OUTBOX_RELAY = 'outbox-relay'

/**
 * Relays unpublished outbox events. Handlers per event type are registered here as modules grow
 * (e.g. OrderApproved -> reserve stock, InvoiceIssued -> WhatsApp the retailer).
 * Runs on the owner connection (no tenant context) because it spans tenants; it only reads the outbox.
 */
export async function relayOutbox(db: Db): Promise<number> {
  const pending = await db
    .select()
    .from(outboxEvents)
    .where(isNull(outboxEvents.publishedAt))
    .limit(100)
  if (pending.length > 0)
    logger.info({ count: pending.length }, 'outbox events pending (no handlers registered yet)')
  return pending.length
}
