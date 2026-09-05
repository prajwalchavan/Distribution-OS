import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, eq, gt, inArray, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  QueueItem,
  QueueListInput,
  QueueListOutput,
  StatsSummaryInput,
  StatsSummaryOutput,
} from '@dos/contracts'
import { QueueStatusSchema } from '@dos/contracts'
import {
  documents,
  extractions,
  reviewSessions,
  skuMatchCandidates,
  suppliers,
  users,
} from '@dos/db'
import type { Db } from '@dos/db'
import { DB, requireDb, requireRole } from '../../platform/index.js'
import { asCaller, DESK } from './docint.internals.js'
import { bestExtraction, checkSummaryFor, readingOf } from './pipeline/steps.js'

type QueueIn = z.infer<typeof QueueListInput>
type QueueOut = z.infer<typeof QueueListOutput>
type StatsIn = z.infer<typeof StatsSummaryInput>
type StatsOut = z.infer<typeof StatsSummaryOutput>

const QUEUE_STATUSES = QueueStatusSchema.options

const istStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
const istEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

/**
 * The manager's inbound worklist and the docs/11 alarm surface. Both carry purchase totals, so both
 * are back office; both are bounded (a page of the queue, a date range of the stats).
 */
@Injectable()
export class QueueService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /** Oldest first: the queue is drained in capture order; cursor = the last document id seen. */
  async list(input: QueueIn): Promise<QueueOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.status
          ? eq(documents.status, input.status)
          : inArray(documents.status, [...QUEUE_STATUSES]),
        input.kind ? eq(documents.kind, input.kind) : undefined,
        input.supplierId ? eq(documents.supplierId, input.supplierId) : undefined,
        input.cursor ? gt(documents.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select({
          doc: documents,
          supplierName: suppliers.name,
          uploadedByName: users.name,
        })
        .from(documents)
        .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
        .leftJoin(users, eq(users.id, documents.uploadedBy))
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(documents.id)
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const items: QueueItem[] = []
      const now = Date.now()
      for (const row of page) {
        const doc = row.doc
        const best = await bestExtraction(tx, doc.id)
        const summary = best ? await checkSummaryFor(tx, best.id) : { errors: 0, warnings: 0 }
        let unmatched = 0
        if (best) {
          const reading = readingOf(best)
          const chosen = await tx
            .selectDistinct({ lineNo: skuMatchCandidates.lineNo })
            .from(skuMatchCandidates)
            .where(
              and(
                eq(skuMatchCandidates.extractionId, best.id),
                eq(skuMatchCandidates.chosen, true),
              ),
            )
          unmatched = Math.max(0, (reading?.lines.length ?? best.lineCount ?? 0) - chosen.length)
        }
        const [lock] = await tx
          .select({ reviewerId: reviewSessions.reviewerId, name: users.name })
          .from(reviewSessions)
          .leftJoin(users, eq(users.id, reviewSessions.reviewerId))
          .where(
            and(
              eq(reviewSessions.documentId, doc.id),
              eq(reviewSessions.status, 'open'),
              gt(reviewSessions.lockedUntil, new Date()),
            ),
          )
          .limit(1)
        const status = QueueStatusSchema.safeParse(doc.status)
        if (!status.success) continue
        items.push({
          documentId: doc.id,
          kind: doc.kind,
          status: status.data,
          supplierId: doc.supplierId,
          supplierName: row.supplierName ?? null,
          invoiceNo: best?.invoiceNo ?? null,
          invoiceDate: best?.invoiceDate ?? null,
          totalPaise: best?.totalPaise ?? null,
          lineCount: best?.lineCount ?? null,
          redCount: summary.errors,
          amberCount: summary.warnings,
          unmatchedLines: unmatched,
          irnVerified: doc.irnVerified,
          qrStatus: doc.qrStatus,
          ageMinutes: Math.max(
            0,
            Math.floor((now - (doc.capturedAt ?? doc.createdAt).getTime()) / 60_000),
          ),
          uploadedBy: doc.uploadedBy,
          uploadedByName: row.uploadedByName ?? null,
          lockedByUserId: lock?.reviewerId ?? null,
          lockedByName: lock?.name ?? null,
          createdAt: doc.createdAt.toISOString(),
        })
      }
      const last = page[page.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.doc.id : null }
    })
  }

  /** Totals for a date range (the owner's day-by-day series is `reporting.series`, not here). */
  async summary(input: StatsIn): Promise<StatsOut> {
    requireRole(DESK)
    const db = requireDb(this.db)
    return asCaller(db, async (tx) => {
      const scope = and(
        sql`${documents.createdAt} >= ${istStart(input.from)}`,
        sql`${documents.createdAt} <= ${istEnd(input.to)}`,
        input.supplierId ? eq(documents.supplierId, input.supplierId) : undefined,
        input.kind ? eq(documents.kind, input.kind) : undefined,
      )
      const [counts] = await tx
        .select({
          documents: sql<number>`count(*)::int`,
          committed: sql<number>`count(*) filter (where ${documents.status} = 'committed')::int`,
          rejected: sql<number>`count(*) filter (where ${documents.status} = 'rejected')::int`,
          failed: sql<number>`count(*) filter (where ${documents.status} = 'failed')::int`,
        })
        .from(documents)
        .where(scope)
      const [engine] = await tx
        .select({
          escalated: sql<number>`count(*) filter (where ${extractions.escalatedFromExtractionId} is not null)::int`,
          avgLatencyMs: sql<number | null>`avg(${extractions.latencyMs})::int`,
          p95LatencyMs: sql<
            number | null
          >`percentile_cont(0.95) within group (order by ${extractions.latencyMs})::int`,
          costPaise: sql<number>`coalesce(sum(${extractions.costPaise}), 0)::bigint`,
        })
        .from(extractions)
        .innerJoin(documents, eq(documents.id, extractions.documentId))
        .where(scope)
      const [edits] = await tx
        .select({
          sessions: sql<number>`count(*)::int`,
          edits: sql<number>`coalesce(sum(${reviewSessions.editsCount}), 0)::int`,
          lines: sql<number>`coalesce(sum(coalesce(jsonb_array_length(${reviewSessions.reviewed} -> 'lines'), 0)), 0)::int`,
        })
        .from(reviewSessions)
        .innerJoin(documents, eq(documents.id, reviewSessions.documentId))
        .where(and(scope, eq(reviewSessions.status, 'submitted')))
      const bySupplier = await tx
        .select({
          supplierId: documents.supplierId,
          supplierName: suppliers.name,
          documents: sql<number>`count(distinct ${documents.id})::int`,
          committed: sql<number>`count(distinct ${documents.id}) filter (where ${documents.status} = 'committed')::int`,
          failed: sql<number>`count(distinct ${documents.id}) filter (where ${documents.status} = 'failed')::int`,
          edits: sql<number>`coalesce(sum(${reviewSessions.editsCount}), 0)::int`,
          lines: sql<number>`coalesce(sum(coalesce(jsonb_array_length(${reviewSessions.reviewed} -> 'lines'), 0)), 0)::int`,
        })
        .from(documents)
        .innerJoin(suppliers, eq(suppliers.id, documents.supplierId))
        .leftJoin(
          reviewSessions,
          and(eq(reviewSessions.documentId, documents.id), eq(reviewSessions.status, 'submitted')),
        )
        .where(scope)
        .groupBy(documents.supplierId, suppliers.name)
        .orderBy(sql`count(distinct ${documents.id}) desc`, suppliers.name)
        .limit(400)
      const perTen = (editsN: number, linesN: number): number =>
        linesN > 0 ? Math.round((editsN / linesN) * 1000) / 100 : 0
      const sessions = Number(edits?.sessions ?? 0)
      return {
        from: input.from,
        to: input.to,
        documents: Number(counts?.documents ?? 0),
        committed: Number(counts?.committed ?? 0),
        rejected: Number(counts?.rejected ?? 0),
        failed: Number(counts?.failed ?? 0),
        escalated: Number(engine?.escalated ?? 0),
        avgLatencyMs:
          engine?.avgLatencyMs === null || engine?.avgLatencyMs === undefined
            ? null
            : Number(engine.avgLatencyMs),
        p95LatencyMs:
          engine?.p95LatencyMs === null || engine?.p95LatencyMs === undefined
            ? null
            : Number(engine.p95LatencyMs),
        costPaise: Number(engine?.costPaise ?? 0),
        editsPerDocument:
          sessions > 0 ? Math.round((Number(edits?.edits ?? 0) / sessions) * 100) / 100 : 0,
        editsPerTenLines: perTen(Number(edits?.edits ?? 0), Number(edits?.lines ?? 0)),
        bySupplier: bySupplier
          .filter((s) => s.supplierId !== null)
          .map((s) => ({
            supplierId: s.supplierId ?? '',
            supplierName: s.supplierName,
            documents: Number(s.documents),
            committed: Number(s.committed),
            editsPerTenLines: perTen(Number(s.edits), Number(s.lines)),
            failureRate:
              Number(s.documents) > 0
                ? Math.round((Number(s.failed) / Number(s.documents)) * 1000) / 1000
                : 0,
          })),
      }
    })
  }
}
