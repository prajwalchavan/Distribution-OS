import { eq } from 'drizzle-orm'
import { aiOrderDrafts, inboundMessages, type Db } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { createLlmProvider, currentTenant, type LlmProvider } from '../../platform/index.js'
import { AI_EVENTS, emitAiEvent, type DraftRow } from './ai.internals.js'
import { draftStatusFor, parseOrderText } from './intake.js'

/**
 * The inbound WhatsApp path (my slice's "wire the notifications inbound path"): a shop texts an
 * order, the message lands in `inbound_messages`, an `InboundMessageReceived` outbox row is emitted,
 * and the worker's relay handler calls this. The draft then appears in the rep's queue (its own
 * beat) and the manager's, and a human confirms it into an order — the same one door every other
 * draft goes through.
 *
 * A PLAIN FUNCTION with no Nest DI, so the worker imports it as `@dos/core/ai` (coordination §13).
 * The caller runs it inside `withSystem` (role `system`, BYPASSRLS), because a relayed message has
 * no human behind it: `created_by` is null and the desk owns the draft until someone claims it.
 *
 * IDEMPOTENT TWICE OVER. The relay is at-least-once, so this checks for an existing draft on the
 * message first, and the partial unique index `ai_order_drafts_inbound_idx` refuses a second one at
 * the database even if two workers race. A redelivery is a no-op that answers the first draft.
 */

export interface InboundParseResult {
  draftId: string
  /** False when a draft already existed for this message — a relay redelivery, not a new order. */
  created: boolean
  lineCount: number
  status: DraftRow['status']
}

export async function parseInboundMessage(
  tx: Db,
  messageId: string,
  provider: LlmProvider = createLlmProvider(),
): Promise<InboundParseResult | null> {
  const [message] = await tx
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.id, messageId))
    .limit(1)
  if (!message) return null

  const [existing] = await tx
    .select({
      id: aiOrderDrafts.id,
      status: aiOrderDrafts.status,
      lines: aiOrderDrafts.parsedLines,
    })
    .from(aiOrderDrafts)
    .where(eq(aiOrderDrafts.inboundMessageId, messageId))
    .limit(1)
  if (existing)
    return {
      draftId: existing.id,
      created: false,
      lineCount: existing.lines.length,
      status: existing.status,
    }

  const text = (message.body ?? '').trim()
  // A photo with no words, or a bare "ok": nothing to read into an order. The message stays in the
  // triage queue for a person; inventing an empty draft would only add noise to the rep's screen.
  if (text.length === 0) return null

  const read = await parseOrderText(tx, { text, retailerId: message.retailerId }, provider)
  if (read.lines.length === 0) return null

  const id = uuidv7()
  const [row] = await tx
    .insert(aiOrderDrafts)
    .values({
      id,
      tenantId: currentTenant().tenantId,
      source: 'whatsapp',
      retailerId: message.retailerId,
      inboundMessageId: message.id,
      rawText: text,
      parsedLines: read.lines,
      matchConfidenceBps: read.matchConfidenceBps,
      status: draftStatusFor(read.lines, message.retailerId),
      createdBy: null,
      provider: read.provider,
      model: read.model,
      tokensIn: read.tokensIn,
      tokensOut: read.tokensOut,
      // Derived from the message, so a second relay attempt collides on `(tenant, idempotency_key)`
      // as well as on the inbound index: two independent guards against one text becoming two orders.
      idempotencyKey: `inbound:${message.id}`,
    })
    .onConflictDoNothing()
    .returning()
  if (!row) {
    const [raced] = await tx
      .select({
        id: aiOrderDrafts.id,
        status: aiOrderDrafts.status,
        lines: aiOrderDrafts.parsedLines,
      })
      .from(aiOrderDrafts)
      .where(eq(aiOrderDrafts.inboundMessageId, messageId))
      .limit(1)
    return raced
      ? { draftId: raced.id, created: false, lineCount: raced.lines.length, status: raced.status }
      : null
  }
  await emitAiEvent(tx, 'ai_order_draft', row.id, AI_EVENTS.draftParsed, {
    draftId: row.id,
    retailerId: row.retailerId,
    source: row.source,
    status: row.status,
    lineCount: row.parsedLines.length,
    inboundMessageId: message.id,
  })
  return {
    draftId: row.id,
    created: true,
    lineCount: row.parsedLines.length,
    status: row.status,
  }
}
