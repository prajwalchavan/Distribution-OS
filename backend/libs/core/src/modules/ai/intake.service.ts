import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ParseTextInput,
  ParseTextOutput,
  TranscribeVoiceInput,
  TranscribeVoiceOutput,
} from '@dos/contracts'
import { AI_MAX_VOICE_MS } from '@dos/contracts'
import { aiOrderDrafts, inboundMessages, withTenant, type Db } from '@dos/db'
import {
  assertTenantKey,
  createLlmProvider,
  createObjectStorage,
  currentTenant,
  DB,
  idempotent,
  ObjectStorageError,
  requireDb,
  requireRole,
  type LlmProvider,
  type ObjectStorage,
} from '../../platform/index.js'
import {
  AI_EVENTS,
  DRAFT_TAKERS,
  emitAiEvent,
  findDraft,
  resolveRetailer,
  type DraftRow,
} from './ai.internals.js'
import { draftStatusFor, parseOrderText } from './intake.js'
import { listingLabels } from './matcher.js'
import { detailOf } from './drafts.service.js'

type ParseIn = z.infer<typeof ParseTextInput>
type ParseOut = z.infer<typeof ParseTextOutput>
type VoiceIn = z.infer<typeof TranscribeVoiceInput>
type VoiceOut = z.infer<typeof TranscribeVoiceOutput>

/**
 * Order intake: words in, a DRAFT out. Never an order — `orders.create` is reached only from
 * `drafts.confirm`, after a human has looked at what we understood (docs/22 §8, 2026-09-05).
 *
 * Both procedures are idempotent on the client's key AND on the draft's own client-generated id, so
 * a rep's phone replaying an offline capture, or a relay redelivering the same inbound message,
 * answers the first draft instead of writing a second. The database backs that up twice over: a
 * unique index on `(tenant_id, idempotency_key)` and a partial unique index on
 * `(tenant_id, inbound_message_id)`.
 *
 * A `retailer` caller's shop is FORCED to its own; a `salesperson` may name only a shop it may
 * already order for, which RLS then re-checks on the row it writes (`ai_order_drafts_insert`'s check
 * is the same predicate as its read policy, so nobody can write a draft they could not read back).
 */
@Injectable()
export class IntakeService {
  private readonly llm: LlmProvider
  private readonly storage: ObjectStorage

  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {
    this.llm = createLlmProvider()
    this.storage = createObjectStorage()
  }

  async parseText(input: ParseIn): Promise<ParseOut> {
    requireRole(DRAFT_TAKERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const retailerId = await resolveRetailer(tx, input.retailerId ?? null)
        const inboundMessageId = await this.checkInbound(tx, input.inboundMessageId ?? null)
        const read = await parseOrderText(tx, { text: input.text, retailerId }, this.llm)
        const row = await this.insertDraft(tx, {
          id: input.id,
          source: input.source,
          retailerId,
          inboundMessageId,
          rawText: input.text,
          transcript: null,
          audioObjectKey: null,
          idempotencyKey: input.idempotencyKey,
          read,
        })
        return { item: await detailOf(tx, row) }
      }),
    )
  }

  /**
   * A voice note, transcribed and parsed in one call. The bytes are already in object storage — the
   * client PUT them there with a key `files.uploadUrl` minted (docs/20 rule 3: nothing binary
   * through a service) — and the key is anchored at the caller's tenant, so another distributor's
   * object is `invalid_key` before anything is read.
   *
   * With no STT endpoint configured (the founder's "stub drivers for now", docs/22 §8 2026-09-05)
   * the deterministic transcriber answers: the object's own bytes when they are text, else a
   * sentence built from what this shop buys. The row records `provider = deterministic`, so nobody
   * can mistake a stub reading for a real one.
   */
  async transcribe(input: VoiceIn): Promise<VoiceOut> {
    requireRole(DRAFT_TAKERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    if (input.durationMs !== undefined && input.durationMs > AI_MAX_VOICE_MS)
      throw new ORPCError('BAD_REQUEST', {
        message: `a voice note may be at most ${String(Math.round(AI_MAX_VOICE_MS / 1000))} seconds`,
        data: { code: 'voice_too_long' },
      })
    try {
      assertTenantKey(input.audioObjectKey, ctx.tenantId)
    } catch (error) {
      throw new ORPCError('BAD_REQUEST', {
        message: error instanceof ObjectStorageError ? error.message : 'unusable audio key',
        data: { code: 'invalid_key' },
      })
    }
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const retailerId = await resolveRetailer(tx, input.retailerId ?? null)
        const bytes = await this.storage.get(input.audioObjectKey).catch(() => null)
        const catalog = (await listingLabels(tx, { retailerId, limit: 12 })).map((item) => ({
          label: item.label,
          unit: 'case' as const,
        }))
        const heard = await this.llm.transcribe({
          bytes,
          mimeType: 'audio/mp4',
          language: input.language,
          hints: { seed: input.audioObjectKey, catalog },
        })
        const transcript = heard.value.trim()
        if (transcript.length === 0)
          throw new ORPCError('BAD_REQUEST', {
            message: 'nothing could be heard in this recording',
            data: { code: 'empty_transcript' },
          })
        const read = await parseOrderText(tx, { text: transcript, retailerId }, this.llm)
        const row = await this.insertDraft(tx, {
          id: input.id,
          source: 'voice',
          retailerId,
          inboundMessageId: null,
          rawText: null,
          transcript,
          audioObjectKey: input.audioObjectKey,
          idempotencyKey: input.idempotencyKey,
          read: {
            ...read,
            // The transcript and the parse may come from different engines; the row records the one
            // that read the WORDS, and the transcriber's name when it is the more interesting half.
            provider: heard.deterministic ? read.provider : `${heard.provider}+${read.provider}`,
          },
        })
        return { item: await detailOf(tx, row), transcript }
      }),
    )
  }

  /**
   * The draft row. `created_by` is the caller — which is also what makes a rep's own capture pass its
   * own read policy under FORCE RLS, so `INSERT … RETURNING` works at all before the shop is known.
   */
  private async insertDraft(
    tx: Db,
    i: {
      id: string
      source: 'whatsapp' | 'voice' | 'text'
      retailerId: string | null
      inboundMessageId: string | null
      rawText: string | null
      transcript: string | null
      audioObjectKey: string | null
      idempotencyKey: string
      read: {
        lines: DraftRow['parsedLines']
        matchConfidenceBps: number
        provider: string
        model: string
        tokensIn: number
        tokensOut: number
      }
    },
  ): Promise<DraftRow> {
    const ctx = currentTenant()
    const status = draftStatusFor(i.read.lines, i.retailerId)
    const [row] = await tx
      .insert(aiOrderDrafts)
      .values({
        id: i.id,
        tenantId: ctx.tenantId,
        source: i.source,
        retailerId: i.retailerId,
        inboundMessageId: i.inboundMessageId,
        rawText: i.rawText,
        transcript: i.transcript,
        audioObjectKey: i.audioObjectKey,
        parsedLines: i.read.lines,
        matchConfidenceBps: i.read.matchConfidenceBps,
        status,
        createdBy: ctx.actorRole === 'system' ? null : ctx.actorId,
        provider: i.read.provider,
        model: i.read.model,
        tokensIn: i.read.tokensIn,
        tokensOut: i.read.tokensOut,
        idempotencyKey: i.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning()
    // A replay whose idempotency row was pruned, or a second draft for the same inbound message:
    // answer the draft that already exists rather than refusing a shopkeeper's order.
    const draft = row ?? (await findDraft(tx, i.id))
    await emitAiEvent(tx, 'ai_order_draft', draft.id, AI_EVENTS.draftParsed, {
      draftId: draft.id,
      retailerId: draft.retailerId,
      source: draft.source,
      status: draft.status,
      lineCount: draft.parsedLines.length,
    })
    return draft
  }

  /** The inbound message exists in this tenant, and no draft has been made from it before. */
  private async checkInbound(tx: Db, id: string | null): Promise<string | null> {
    if (!id) return null
    const [message] = await tx
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(eq(inboundMessages.id, id))
      .limit(1)
    if (!message) throw new ORPCError('NOT_FOUND', { message: `inbound message ${id} not found` })
    const [existing] = await tx
      .select({ id: aiOrderDrafts.id })
      .from(aiOrderDrafts)
      .where(eq(aiOrderDrafts.inboundMessageId, id))
      .limit(1)
    if (existing)
      throw new ORPCError('CONFLICT', {
        message: 'this message has already been read into a draft',
        data: { code: 'already_parsed', draftId: existing.id },
      })
    return id
  }
}
