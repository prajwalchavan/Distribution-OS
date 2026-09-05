import { Inject, Injectable, Optional } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import {
  MAX_CLAIM_REGISTER_WINDOW_DAYS,
  RECONCILE_MAX_CLAIMS,
  RECONCILE_MAX_SUBSET,
  type ClaimAgeingGroup,
  type ClaimAgeingInput,
  type ClaimAgeingOutput,
  type ClaimReconcileCandidate,
  type ClaimReconcileInput,
  type ClaimReconcileOutput,
  type ClaimRegisterInput,
  type ClaimRegisterOutput,
  type ClaimRegisterRow,
} from '@dos/contracts'
import { businessDate, daysBetween } from '@dos/domain'
import { withTenant, type Db } from '@dos/db'
import { BACK_OFFICE, currentTenant, DB, requireDb, requireRole } from '../../platform/index.js'
import { TenantCatalogService } from '../tenant-catalog/index.js'

type AgeingIn = z.infer<typeof ClaimAgeingInput>
type AgeingOut = z.infer<typeof ClaimAgeingOutput>
type RegisterIn = z.infer<typeof ClaimRegisterInput>
type RegisterOut = z.infer<typeof ClaimRegisterOutput>
type ReconcileIn = z.infer<typeof ClaimReconcileInput>
type ReconcileOut = z.infer<typeof ClaimReconcileOutput>

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/**
 * The owner's and the accountant's views over the SMALL `claims` table only (brief §4.18): ageing of
 * claims receivable, the chart-ready register (docs/22: graphs wherever possible — recovery by brand,
 * claims by month) and the reconciliation helper for a brand payment. Nothing here reads
 * `claim_lines`; a claim's money is on its header.
 */
@Injectable()
export class ClaimReportsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly tenantCatalog: TenantCatalogService,
  ) {}

  /**
   * Outstanding per open claim = claimed − settled − written off, bucketed by days since submit (IST)
   * against `asOf`; drafts land in `notSubmittedPaise`. `brand_dms` groups are listed with their own
   * figures and contribute NOTHING to `totals` (those claims are not on our books, ADR 0014).
   */
  async ageing(input: AgeingIn): Promise<AgeingOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const asOf = input.asOf ?? businessDate().date
    return withTenant(db, ctx, async (tx) => {
      const result = await tx.execute(sql`
        SELECT c.id, c.claim_no, c.supplier_id, c.brand_id, c.status::text AS status,
               c.claim_channel::text AS claim_channel, c.claimed_paise, c.settled_paise, c.written_off_paise,
               c.submitted_at, (c.submitted_at AT TIME ZONE 'Asia/Kolkata')::date::text AS submitted_on
          FROM claims c
         WHERE c.tenant_id = ${ctx.tenantId}
           AND c.status IN ('draft', 'submitted', 'acknowledged', 'partially_settled')
           AND (${input.supplierId ?? null}::text IS NULL OR c.supplier_id = ${input.supplierId ?? null})
           AND (${input.brandId ?? null}::text IS NULL OR c.brand_id = ${input.brandId ?? null})
           AND (${input.kind ?? null}::text IS NULL OR c.kind::text = ${input.kind ?? null})
         ORDER BY c.submitted_at ASC NULLS LAST, c.id ASC
         LIMIT 5000`)
      const rows = result.rows
      const text = (v: unknown): string =>
        typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
      const keyOf = (r: Record<string, unknown>): string =>
        input.groupBy === 'brand' ? text(r.brand_id) || 'none' : text(r.supplier_id)
      const groups = new Map<string, ClaimAgeingGroup>()
      const totals = {
        outstandingPaise: 0,
        notSubmittedPaise: 0,
        b0_30: 0,
        b31_60: 0,
        b61_90: 0,
        b90plus: 0,
        openClaims: 0,
      }
      for (const r of rows) {
        const channel = String(r.claim_channel) as 'dos' | 'brand_dms'
        const groupKey = `${keyOf(r)}|${channel}`
        const g =
          groups.get(groupKey) ??
          ({
            key: keyOf(r),
            name: '',
            claimChannel: channel,
            outstandingPaise: 0,
            notSubmittedPaise: 0,
            buckets: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 },
            openClaims: 0,
            oldestSubmittedAt: null,
            oldestClaimNo: null,
          } satisfies ClaimAgeingGroup)
        groups.set(groupKey, g)
        const outstanding = n(r.claimed_paise) - n(r.settled_paise) - n(r.written_off_paise)
        if (String(r.status) === 'draft') {
          g.notSubmittedPaise += n(r.claimed_paise)
          if (channel === 'dos') totals.notSubmittedPaise += n(r.claimed_paise)
          continue
        }
        const submittedOn = typeof r.submitted_on === 'string' ? r.submitted_on : asOf
        const age = Math.max(0, daysBetween(submittedOn, asOf))
        const bucket = age <= 30 ? 'b0_30' : age <= 60 ? 'b31_60' : age <= 90 ? 'b61_90' : 'b90plus'
        g.outstandingPaise += outstanding
        g.buckets[bucket] += outstanding
        g.openClaims += 1
        if (g.oldestSubmittedAt === null && r.submitted_at) {
          g.oldestSubmittedAt = new Date(r.submitted_at as string | Date).toISOString()
          g.oldestClaimNo = (r.claim_no as string | null) ?? null
        }
        if (channel === 'dos') {
          totals.outstandingPaise += outstanding
          totals[bucket] += outstanding
          totals.openClaims += 1
        }
      }
      const ids = [...groups.values()].map((g) => g.key).filter((k) => k !== 'none')
      const names =
        input.groupBy === 'brand'
          ? await this.tenantCatalog.brandLabels(tx, ids)
          : new Map(
              [...(await this.tenantCatalog.supplierLabels(tx, ids))].map(([id, s]) => [
                id,
                s.name,
              ]),
            )
      const list = [...groups.values()]
        .map((g) => ({ ...g, name: names.get(g.key) ?? (g.key === 'none' ? 'No brand' : g.key) }))
        .sort((a, b) => b.outstandingPaise - a.outstandingPaise || a.name.localeCompare(b.name))
        .slice(0, input.limit)
      return {
        asOf,
        groupBy: input.groupBy,
        totals: {
          outstandingPaise: totals.outstandingPaise,
          notSubmittedPaise: totals.notSubmittedPaise,
          buckets: {
            b0_30: totals.b0_30,
            b31_60: totals.b31_60,
            b61_90: totals.b61_90,
            b90plus: totals.b90plus,
          },
          openClaims: totals.openClaims,
        },
        groups: list,
      }
    })
  }

  /** Every claim whose `periodTo` falls in the window (cancelled ones excluded), grouped by ONE query. */
  async register(input: RegisterIn): Promise<RegisterOut> {
    requireRole(BACK_OFFICE)
    if (input.to < input.from) throw new ORPCError('BAD_REQUEST', { message: 'to is before from' })
    if (daysBetween(input.from, input.to) > MAX_CLAIM_REGISTER_WINDOW_DAYS)
      throw new ORPCError('BAD_REQUEST', {
        message: `the register window is at most ${MAX_CLAIM_REGISTER_WINDOW_DAYS} days`,
      })
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const groupExpr = {
        supplier: sql`c.supplier_id`,
        brand: sql`coalesce(c.brand_id, 'none')`,
        kind: sql`c.kind::text`,
        status: sql`c.status::text`,
        month: sql`to_char(c.period_to, 'YYYY-MM')`,
      }[input.groupBy]
      const result = await tx.execute(sql`
        SELECT ${groupExpr} AS key,
               COUNT(*)::int AS claims,
               COALESCE(SUM(c.claimed_paise), 0)::bigint AS claimed_paise,
               COALESCE(SUM(c.settled_paise), 0)::bigint AS settled_paise,
               COALESCE(SUM(c.written_off_paise), 0)::bigint AS written_off_paise
          FROM claims c
         WHERE c.tenant_id = ${ctx.tenantId}
           AND c.status <> 'cancelled'
           AND c.period_to BETWEEN ${input.from} AND ${input.to}
           AND (${input.supplierId ?? null}::text IS NULL OR c.supplier_id = ${input.supplierId ?? null})
           AND (${input.brandId ?? null}::text IS NULL OR c.brand_id = ${input.brandId ?? null})
           AND (${input.kind ?? null}::text IS NULL OR c.kind::text = ${input.kind ?? null})
           AND (${input.claimChannel ?? null}::text IS NULL OR c.claim_channel::text = ${input.claimChannel ?? null})
         GROUP BY 1
         ORDER BY claimed_paise DESC, key ASC
         LIMIT 500`)
      const raw = result.rows
      const figures = (r: {
        claims: number
        claimed: number
        settled: number
        writtenOff: number
      }) => ({
        claims: r.claims,
        claimedPaise: r.claimed,
        settledPaise: r.settled,
        writtenOffPaise: r.writtenOff,
        outstandingPaise: r.claimed - r.settled - r.writtenOff,
        recoveryBps:
          r.claimed > 0 ? Math.min(10_000, Math.round((r.settled * 10_000) / r.claimed)) : 0,
      })
      const totals = { claims: 0, claimed: 0, settled: 0, writtenOff: 0 }
      const rows: {
        key: string
        claims: number
        claimed: number
        settled: number
        writtenOff: number
      }[] = []
      for (const r of raw) {
        const row = {
          key: String(r.key),
          claims: n(r.claims),
          claimed: n(r.claimed_paise),
          settled: n(r.settled_paise),
          writtenOff: n(r.written_off_paise),
        }
        rows.push(row)
        totals.claims += row.claims
        totals.claimed += row.claimed
        totals.settled += row.settled
        totals.writtenOff += row.writtenOff
      }
      const keys = rows.map((r) => r.key).filter((k) => k !== 'none')
      const names: Map<string, string> =
        input.groupBy === 'supplier'
          ? new Map(
              [...(await this.tenantCatalog.supplierLabels(tx, keys))].map(([id, s]) => [
                id,
                s.name,
              ]),
            )
          : input.groupBy === 'brand'
            ? await this.tenantCatalog.brandLabels(tx, keys)
            : new Map<string, string>()
      const label = (key: string): string => {
        if (input.groupBy === 'brand' && key === 'none') return 'No brand'
        return names.get(key) ?? key.replace(/_/g, ' ')
      }
      const out: ClaimRegisterRow[] = rows
        .slice(0, input.limit)
        .map((r) => ({ key: r.key, name: label(r.key), ...figures(r) }))
      return {
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        totals: figures(totals),
        rows: out,
      }
    })
  }

  /**
   * Which open claims a brand payment settles: exact single-claim matches first, then subsets of at
   * most `RECONCILE_MAX_SUBSET` within `tolerancePaise`, over the `RECONCILE_MAX_CLAIMS` most recent
   * open `dos` claims of the supplier (bounded search: C(20,1) + C(20,2) + C(20,3) = 1 350 sets).
   */
  async reconcile(input: ReconcileIn): Promise<ReconcileOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const result = await tx.execute(sql`
        SELECT c.id, c.claim_no, (c.claimed_paise - c.settled_paise - c.written_off_paise)::bigint AS outstanding
          FROM claims c
         WHERE c.tenant_id = ${ctx.tenantId}
           AND c.supplier_id = ${input.supplierId}
           AND c.claim_channel = 'dos'
           AND c.status IN ('submitted', 'acknowledged', 'partially_settled')
           AND (${input.fromDate ?? null}::text IS NULL OR (c.submitted_at AT TIME ZONE 'Asia/Kolkata')::date >= ${input.fromDate ?? null}::date)
           AND (${input.toDate ?? null}::text IS NULL OR (c.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= ${input.toDate ?? null}::date)
         ORDER BY c.submitted_at DESC NULLS LAST, c.id DESC
         LIMIT ${RECONCILE_MAX_CLAIMS}`)
      const open = result.rows
        .map((r) => ({
          id: String(r.id),
          claimNo: typeof r.claim_no === 'string' ? r.claim_no : '',
          outstanding: n(r.outstanding),
        }))
        .filter((c) => c.outstanding > 0)
      const target = input.amountPaise
      const candidates: ClaimReconcileCandidate[] = []
      const consider = (set: typeof open) => {
        const total = set.reduce((s, c) => s + c.outstanding, 0)
        const difference = total - target
        if (Math.abs(difference) <= input.tolerancePaise)
          candidates.push({
            claimIds: set.map((c) => c.id),
            claimNos: set.map((c) => c.claimNo),
            totalPaise: total,
            differencePaise: difference,
            exact: difference === 0,
          })
      }
      for (let i = 0; i < open.length; i++) {
        const a = open[i]
        if (!a) continue
        consider([a])
        if (RECONCILE_MAX_SUBSET < 2) continue
        for (let j = i + 1; j < open.length; j++) {
          const b = open[j]
          if (!b) continue
          consider([a, b])
          if (RECONCILE_MAX_SUBSET < 3) continue
          for (let k = j + 1; k < open.length; k++) {
            const c = open[k]
            if (c) consider([a, b, c])
          }
        }
      }
      candidates.sort(
        (x, y) =>
          Number(y.exact) - Number(x.exact) ||
          Math.abs(x.differencePaise) - Math.abs(y.differencePaise) ||
          x.claimIds.length - y.claimIds.length,
      )
      return { consideredClaims: open.length, candidates: candidates.slice(0, 20) }
    })
  }
}
