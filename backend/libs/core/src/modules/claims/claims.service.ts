import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import {
  DEFAULT_CLAIM_SETTLEMENT_DAYS,
  DEFAULT_CLAIM_SHEET_FORMAT,
  CLAIM_DETAIL_LINES,
  CLAIM_SHEET_EXPORT_KIND,
  MAX_CLAIM_PERIODS,
  type AcknowledgeClaimInput,
  type AcknowledgeClaimOutput,
  type AddClaimLineInput,
  type AddClaimLineOutput,
  type AdjustClaimLineInput,
  type AdjustClaimLineOutput,
  type AttachClaimEvidenceInput,
  type AttachClaimEvidenceOutput,
  type BuildClaimInput,
  type BuildClaimOutput,
  type CancelClaimInput,
  type CancelClaimOutput,
  type ClaimDetail,
  type ClaimGetInput,
  type ClaimGetOutput,
  type ClaimKind,
  type ClaimLinesListInput,
  type ClaimLinesListOutput,
  type ClaimPeriod,
  type ClaimPeriodsListInput,
  type ClaimPeriodsListOutput,
  type ClaimPoliciesListInput,
  type ClaimPoliciesListOutput,
  type ClaimsListInput,
  type ClaimsListOutput,
  type ClaimStatement,
  type ClaimStatementsListInput,
  type ClaimStatementsListOutput,
  type ClaimSummary,
  type GenerateClaimStatementInput,
  type GenerateClaimStatementOutput,
  type OpenClaimInput,
  type OpenClaimOutput,
  type RecordClaimSettlementInput,
  type RecordClaimSettlementOutput,
  type RejectClaimInput,
  type RejectClaimOutput,
  type RemoveClaimLineInput,
  type RemoveClaimLineOutput,
  type SubmitClaimInput,
  type SubmitClaimOutput,
  type UpsertClaimPolicyInput,
  type UpsertClaimPolicyOutput,
  type WriteOffClaimInput,
  type WriteOffClaimOutput,
} from '@dos/contracts'
import { allocate, businessDate, multiply, paise, uuidv7 } from '@dos/domain'
import {
  claimEvidence,
  claimLines,
  claimSettlements,
  claimStatements,
  claims,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MONEY_DESK,
  nextDocumentNumber,
  OWNER,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import { assertTenantKey, parseObjectKey } from '../../platform/object-storage.js'
import { loadDocumentRow } from '../docint/index.js'
import { ExportJobsService, integrationsConfig } from '../integrations/index.js'
import { GrnService } from '../procurement/index.js'
import { ReceivablesService } from '../receivables/index.js'
import { TenantCatalogService, type ReturnPolicyRow } from '../tenant-catalog/index.js'
import { ClaimBuildService, defaultSourcesFor } from './build.service.js'
import {
  addDaysIso,
  CLAIM_EVENTS,
  conflictFrom,
  detailOf,
  emitClaimEvent,
  expenseAccountFor,
  istInstant,
  journalKeys,
  linesOf,
  loadClaim,
  loadLine,
  receivableAccountFor,
  recomputeClaimed,
  requireDraft,
  transition,
  type ClaimLineRow,
  type ClaimRow,
} from './claims.internals.js'
import {
  toClaimEvidence,
  toClaimLine,
  toClaimPolicy,
  toClaimSettlement,
  toClaimStatement,
  toClaimSummary,
  type ClaimNames,
} from './claims.mappers.js'
import { snapshotClaimSheet } from './statements.js'

type PoliciesIn = z.infer<typeof ClaimPoliciesListInput>
type PoliciesOut = z.infer<typeof ClaimPoliciesListOutput>
type PolicyIn = z.infer<typeof UpsertClaimPolicyInput>
type PolicyOut = z.infer<typeof UpsertClaimPolicyOutput>
type PeriodsIn = z.infer<typeof ClaimPeriodsListInput>
type PeriodsOut = z.infer<typeof ClaimPeriodsListOutput>
type OpenIn = z.infer<typeof OpenClaimInput>
type OpenOut = z.infer<typeof OpenClaimOutput>
type ListIn = z.infer<typeof ClaimsListInput>
type ListOut = z.infer<typeof ClaimsListOutput>
type GetIn = z.infer<typeof ClaimGetInput>
type GetOut = z.infer<typeof ClaimGetOutput>
type BuildIn = z.infer<typeof BuildClaimInput>
type BuildOut = z.infer<typeof BuildClaimOutput>
type LinesIn = z.infer<typeof ClaimLinesListInput>
type LinesOut = z.infer<typeof ClaimLinesListOutput>
type AddLineIn = z.infer<typeof AddClaimLineInput>
type AddLineOut = z.infer<typeof AddClaimLineOutput>
type AdjustIn = z.infer<typeof AdjustClaimLineInput>
type AdjustOut = z.infer<typeof AdjustClaimLineOutput>
type RemoveIn = z.infer<typeof RemoveClaimLineInput>
type RemoveOut = z.infer<typeof RemoveClaimLineOutput>
type EvidenceIn = z.infer<typeof AttachClaimEvidenceInput>
type EvidenceOut = z.infer<typeof AttachClaimEvidenceOutput>
type SubmitIn = z.infer<typeof SubmitClaimInput>
type SubmitOut = z.infer<typeof SubmitClaimOutput>
type AckIn = z.infer<typeof AcknowledgeClaimInput>
type AckOut = z.infer<typeof AcknowledgeClaimOutput>
type SettleIn = z.infer<typeof RecordClaimSettlementInput>
type SettleOut = z.infer<typeof RecordClaimSettlementOutput>
type RejectIn = z.infer<typeof RejectClaimInput>
type RejectOut = z.infer<typeof RejectClaimOutput>
type WriteOffIn = z.infer<typeof WriteOffClaimInput>
type WriteOffOut = z.infer<typeof WriteOffClaimOutput>
type CancelIn = z.infer<typeof CancelClaimInput>
type CancelOut = z.infer<typeof CancelClaimOutput>
type StatementIn = z.infer<typeof GenerateClaimStatementInput>
type StatementOut = z.infer<typeof GenerateClaimStatementOutput>
type StatementsIn = z.infer<typeof ClaimStatementsListInput>
type StatementsOut = z.infer<typeof ClaimStatementsListOutput>

/** Who accepts a loss: the owner or the accountant, never the manager (brief §2 `writeOff`). */
const LOSS_ACCEPTORS: readonly ActorRole[] = ['owner', 'accountant', 'system']

/** The account a settlement mode lands in (contract header, "THE MONEY"). */
const SETTLEMENT_ACCOUNTS = {
  credit_note: 'AP',
  adjustment: 'AP',
  bank_receipt: 'BANK',
  cheque: 'CHEQUES',
  goods_replacement: 'PURCHASES',
} as const

/** The docint document kinds a claim may cite as evidence (brief §2 `evidence.attach`). */
const EVIDENCE_DOCUMENT_KINDS = new Set(['claim_sheet', 'other', 'supplier_invoice'])

const TERMINAL = new Set(['settled', 'rejected', 'written_off', 'cancelled'])

/**
 * The claim aggregate (docs/plans/claims.md): the draft, its lines, the number and the accrual at
 * submit, the brand's answer (acknowledge / settle / reject), the write-off, the cancel, and the claim
 * sheet. BACK OFFICE ONLY throughout: served by owner-service and manager-service, and every table is
 * `tenantRolePolicy(BACK_OFFICE_ROLES)` so the guard is the courtesy and RLS the guarantee.
 *
 * Every mutation is `requireRole → requireDb → withTenant → idempotent`; every status change goes
 * through `claimMachine.next()`; every rupee that moves goes through `ReceivablesService.postEntry` /
 * `reverseEntry` with a deterministic key; a `brand_dms` claim never posts anything.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly tenantCatalog: TenantCatalogService,
    private readonly receivables: ReceivablesService,
    private readonly grns: GrnService,
    private readonly exportJobs: ExportJobsService,
    private readonly builder: ClaimBuildService,
  ) {}

  // =============================================================================================================
  // policies
  // =============================================================================================================

  async listPolicies(input: PoliciesIn): Promise<PoliciesOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const page = await this.tenantCatalog.returnPolicies(tx, {
        brandId: input.brandId,
        limit: input.limit,
        cursor: input.cursor,
      })
      return { items: page.items.map(toClaimPolicy), nextCursor: page.nextCursor }
    })
  }

  /** Owner only: it changes what money the business believes it can recover. Audited with before / after. */
  async upsertPolicy(input: PolicyIn): Promise<PolicyOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const before = await this.tenantCatalog.returnPolicy(tx, input.brandId)
        if (!before)
          throw new ORPCError('NOT_FOUND', { message: `brand ${input.brandId} not found` })
        if (input.claimSupplierId) {
          const supplier = await this.tenantCatalog.supplierLabels(tx, [input.claimSupplierId])
          if (!supplier.has(input.claimSupplierId))
            throw new ORPCError('NOT_FOUND', {
              message: `supplier ${input.claimSupplierId} not found`,
            })
        }
        const { idempotencyKey: _key, ...values } = input
        const row = await this.tenantCatalog.upsertReturnPolicy(tx, values)
        await writeAudit(tx, {
          action: 'claims.policy.upsert',
          entityType: 'return_policy',
          entityId: row.id ?? input.id,
          before: before.id ? { ...toClaimPolicy(before) } : null,
          after: { ...toClaimPolicy(row) },
        })
        return { item: toClaimPolicy(row) }
      }),
    )
  }

  // =============================================================================================================
  // periods — pure computation over the policies and a cheap count of the sources
  // =============================================================================================================

  async listPeriods(input: PeriodsIn): Promise<PeriodsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const today = businessDate().date
    return withTenant(db, currentTenant(), async (tx) => {
      const policies = (
        await this.tenantCatalog.returnPolicies(tx, { brandId: input.brandId, limit: 200 })
      ).items.filter(
        (p) =>
          p.claimPeriodKind !== 'adhoc' &&
          (!input.supplierId || p.claimSupplierId === input.supplierId),
      )
      const items: ClaimPeriod[] = []
      for (const policy of policies) {
        const kinds: ClaimKind[] = (['scheme', 'damage', 'expiry'] as const).filter(
          (k) =>
            (!input.kind || input.kind === k) &&
            (k === 'scheme' ||
              (k === 'damage' && policy.damageClaimable) ||
              (k === 'expiry' && policy.expiryClaimable)),
        )
        if (kinds.length === 0) continue
        const windows = periodWindows(policy, today, Math.min(input.periods, MAX_CLAIM_PERIODS))
        for (const kind of kinds) {
          for (const w of windows) {
            if (items.length >= 500) break
            const existing = policy.claimSupplierId
              ? await this.findCovering(tx, policy.claimSupplierId, policy.brandId, kind, w)
              : null
            const estimate =
              existing || !policy.claimSupplierId
                ? { count: 0, amountPaise: 0 }
                : await this.builder.estimate(
                    tx,
                    {
                      kind,
                      brandId: policy.brandId,
                      supplierId: policy.claimSupplierId,
                      claimChannel: policy.claimChannel,
                      periodFrom: w.from,
                      periodTo: w.to,
                    },
                    policy,
                  )
            items.push({
              brandId: policy.brandId,
              brandName: policy.brandName,
              supplierId: policy.claimSupplierId,
              supplierName: policy.claimSupplierName,
              kind,
              periodFrom: w.from,
              periodTo: w.to,
              cutoffDate: w.cutoff,
              existingClaimId: existing?.id ?? null,
              existingStatus: existing?.status ?? null,
              estimatedSourceCount: estimate.count,
              estimatedClaimablePaise: estimate.amountPaise,
            })
          }
        }
      }
      return { asOf: today, items }
    })
  }

  private async findCovering(
    tx: Db,
    supplierId: string,
    brandId: string,
    kind: ClaimKind,
    w: { from: string; to: string },
  ): Promise<ClaimRow | null> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select()
      .from(claims)
      .where(
        and(
          eq(claims.tenantId, tenantId),
          eq(claims.supplierId, supplierId),
          eq(claims.brandId, brandId),
          eq(claims.kind, kind),
          eq(claims.periodFrom, w.from),
          eq(claims.periodTo, w.to),
          sql`${claims.status} NOT IN ('rejected', 'cancelled')`,
        ),
      )
      .limit(1)
    return row ?? null
  }

  // =============================================================================================================
  // the claim
  // =============================================================================================================

  async open(input: OpenIn): Promise<OpenOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const supplier = await this.tenantCatalog.supplierLabels(tx, [input.supplierId])
        if (!supplier.has(input.supplierId))
          throw new ORPCError('NOT_FOUND', { message: `supplier ${input.supplierId} not found` })
        const policy = input.brandId
          ? await this.tenantCatalog.returnPolicy(tx, input.brandId)
          : null
        if (input.brandId && !policy)
          throw new ORPCError('NOT_FOUND', { message: `brand ${input.brandId} not found` })
        ClaimBuildService.assertPolicyAllows(input.kind, policy)
        try {
          await tx.insert(claims).values({
            id: input.id,
            tenantId: ctx.tenantId,
            supplierId: input.supplierId,
            brandId: input.brandId ?? null,
            kind: input.kind,
            status: 'draft',
            // Frozen here (brief §4.7): a brand-DMS brand's claim never reaches our journal.
            claimChannel: policy?.claimChannel ?? 'dos',
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
            claimedPaise: 0,
            createdBy: ctx.actorId,
            note: input.note ?? null,
          })
        } catch (error) {
          conflictFrom(
            error,
            `a live claim already covers ${input.kind} for this supplier and brand over ${input.periodFrom} to ${input.periodTo}`,
          )
        }
        return { item: await this.detail(tx, input.id) }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const today = businessDate().date
    return withTenant(db, ctx, async (tx) => {
      const statuses = new Set<string>(input.statuses ?? [])
      if (input.status) statuses.add(input.status)
      const filters: (SQL | undefined)[] = [
        eq(claims.tenantId, ctx.tenantId),
        statuses.size > 0
          ? inArray(claims.status, [...statuses] as ClaimRow['status'][])
          : undefined,
        input.openOnly || input.overdueOnly
          ? inArray(claims.status, ['submitted', 'acknowledged', 'partially_settled'])
          : undefined,
        input.overdueOnly ? lt(claims.dueDate, today) : undefined,
        input.kind ? eq(claims.kind, input.kind) : undefined,
        input.supplierId ? eq(claims.supplierId, input.supplierId) : undefined,
        input.brandId ? eq(claims.brandId, input.brandId) : undefined,
        input.claimChannel ? eq(claims.claimChannel, input.claimChannel) : undefined,
        input.periodFrom ? sql`${claims.periodTo} >= ${input.periodFrom}` : undefined,
        input.periodTo ? sql`${claims.periodFrom} <= ${input.periodTo}` : undefined,
        input.q
          ? sql`(${claims.claimNo} ILIKE ${`%${input.q}%`} OR ${claims.externalRef} ILIKE ${`%${input.q}%`})`
          : undefined,
        input.cursor ? lt(claims.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(claims)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(claims.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const names = await this.namesFor(tx, page)
      const items = page.map((row) => toClaimSummary(row, names(row), today))
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => ({
      item: await this.detail(tx, input.id),
    }))
  }

  async build(input: BuildIn): Promise<BuildOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        requireDraft(claim, 'build')
        const policy = claim.brandId
          ? await this.tenantCatalog.returnPolicy(tx, claim.brandId)
          : null
        ClaimBuildService.assertPolicyAllows(claim.kind, policy)
        const allowed = defaultSourcesFor(claim.kind)
        const sources = (input.sources ?? allowed).filter((s) => allowed.includes(s))
        const result = await this.builder.build(tx, claim, policy, sources, input.limit)
        return { item: await this.detail(tx, claim.id), ...result }
      }),
    )
  }

  // =============================================================================================================
  // lines
  // =============================================================================================================

  async listLines(input: LinesIn): Promise<LinesOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      await loadClaim(tx, input.id)
      const filters: (SQL | undefined)[] = [
        eq(claimLines.tenantId, ctx.tenantId),
        eq(claimLines.claimId, input.id),
        input.status ? eq(claimLines.status, input.status) : undefined,
        input.sourceType ? eq(claimLines.sourceType, input.sourceType) : undefined,
        input.cursor ? gt(claimLines.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(claimLines)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(claimLines.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toClaimLine)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /** A manual line the sources cannot reconstruct (a rate-difference letter, a negotiated lump sum). */
  async addLine(input: AddLineIn): Promise<AddLineOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        requireDraft(claim, 'adding a line')
        const existing = await linesOf(tx, claim.id)
        const lineNo = existing.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1
        let row: ClaimLineRow | undefined
        try {
          ;[row] = await tx
            .insert(claimLines)
            .values({
              id: input.lineId,
              tenantId: ctx.tenantId,
              claimId: claim.id,
              lineNo,
              status: 'open',
              sourceType: 'manual',
              sourceId: input.lineId,
              schemeId: input.schemeId ?? null,
              retailerId: input.retailerId ?? null,
              variantId: input.variantId ?? null,
              qtyPcs: input.qtyPcs,
              ratePaise: input.ratePaise ?? null,
              basis: input.basis,
              amountPaise: input.amountPaise,
              detail: input.note ? { note: input.note } : {},
            })
            .returning()
        } catch (error) {
          conflictFrom(error, `line ${input.lineId} already exists`)
        }
        if (!row) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'line insert failed' })
        await recomputeClaimed(tx, claim.id)
        await writeAudit(tx, {
          action: 'claims.line.add',
          entityType: 'claim',
          entityId: claim.id,
          after: { lineId: row.id, amountPaise: row.amountPaise, qtyPcs: row.qtyPcs },
        })
        return { item: await this.detail(tx, claim.id), line: toClaimLine(row) }
      }),
    )
  }

  /** The desk's review of a built line: its money, or in / out of this claim (brief; contract `lines.adjust`). */
  async adjustLine(input: AdjustIn): Promise<AdjustOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        requireDraft(claim, 'adjusting a line')
        const line = await loadLine(tx, claim.id, input.lineId)
        if (line.settledPaise > 0)
          throw new ORPCError('CONFLICT', {
            message: `line ${line.id} has money settled against it`,
          })
        const before = toClaimLine(line)
        const qtyPcs = input.qtyPcs ?? line.qtyPcs
        const ratePaise = input.ratePaise ?? line.ratePaise
        const amountPaise =
          input.amountPaise ??
          (input.qtyPcs !== undefined || input.ratePaise !== undefined
            ? ratePaise !== null
              ? multiply(paise(ratePaise), qtyPcs)
              : line.amountPaise
            : line.amountPaise)
        const detail = detailOf(line)
        let status = line.status
        let nextDetail = { ...detail }
        if (input.exclude === true) {
          status = 'rejected'
          nextDetail = {
            ...detail,
            reason: 'excluded',
            ...(input.reason ? { note: input.reason } : {}),
          }
        } else if (input.exclude === false) {
          status = 'open'
          const { reason: _reason, ...rest } = detail
          nextDetail = input.reason ? { ...rest, note: input.reason } : rest
        } else if (input.reason) {
          nextDetail = { ...detail, note: input.reason }
        }
        let updated: ClaimLineRow | undefined
        try {
          ;[updated] = await tx
            .update(claimLines)
            .set({
              qtyPcs,
              ratePaise,
              amountPaise,
              status,
              detail: nextDetail,
              updatedAt: new Date(),
            })
            .where(and(eq(claimLines.tenantId, ctx.tenantId), eq(claimLines.id, line.id)))
            .returning()
        } catch (error) {
          conflictFrom(error, `the source of line ${line.id} is already carried by another claim`)
        }
        if (!updated)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'line update failed' })
        await recomputeClaimed(tx, claim.id)
        await writeAudit(tx, {
          action: 'claims.line.adjust',
          entityType: 'claim',
          entityId: claim.id,
          before: { ...before },
          after: { ...toClaimLine(updated), reason: input.reason ?? null },
        })
        return { item: await this.detail(tx, claim.id), line: toClaimLine(updated) }
      }),
    )
  }

  /** Hard delete from a draft (`claim_lines` is not a ledger); the before image goes to the audit log. */
  async removeLine(input: RemoveIn): Promise<RemoveOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        requireDraft(claim, 'removing a line')
        const line = await loadLine(tx, claim.id, input.lineId)
        if (line.settledPaise > 0)
          throw new ORPCError('CONFLICT', {
            message: `line ${line.id} has money settled against it`,
          })
        await tx
          .delete(claimLines)
          .where(and(eq(claimLines.tenantId, ctx.tenantId), eq(claimLines.id, line.id)))
        await recomputeClaimed(tx, claim.id)
        await writeAudit(tx, {
          action: 'claims.line.remove',
          entityType: 'claim',
          entityId: claim.id,
          before: { ...toClaimLine(line) },
          after: { reason: input.reason ?? null },
        })
        return { item: await this.detail(tx, claim.id) }
      }),
    )
  }

  // =============================================================================================================
  // evidence
  // =============================================================================================================

  async attachEvidence(input: EvidenceIn): Promise<EvidenceOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id)
        if (TERMINAL.has(claim.status))
          throw new ORPCError('CONFLICT', {
            message: `claim ${claim.claimNo ?? claim.id} is ${claim.status}; no more evidence is taken`,
          })
        if (input.documentId) {
          const doc = await loadDocumentRow(tx, input.documentId)
          if (!doc || doc.tenantId !== ctx.tenantId)
            throw new ORPCError('NOT_FOUND', { message: `document ${input.documentId} not found` })
          if (!EVIDENCE_DOCUMENT_KINDS.has(doc.kind))
            throw new ORPCError('CONFLICT', {
              message: `document ${input.documentId} is a ${doc.kind}; claim evidence is a claim sheet, a supplier invoice or an other document`,
            })
        }
        if (input.objectKey) {
          // The key must be this tenant's and this claim's (`files.uploadUrl`, domain `claim`).
          try {
            assertTenantKey(input.objectKey, ctx.tenantId)
          } catch {
            throw new ORPCError('BAD_REQUEST', {
              message: 'objectKey does not belong to this distributor',
            })
          }
          const parsed = parseObjectKey(input.objectKey)
          if (!parsed || parsed.domain !== 'claims' || parsed.entityId !== claim.id)
            throw new ORPCError('BAD_REQUEST', {
              message: `objectKey must be a file uploaded for this claim (tenant/…/claims/${claim.id}/…)`,
            })
        }
        let row: typeof claimEvidence.$inferSelect | undefined
        try {
          ;[row] = await tx
            .insert(claimEvidence)
            .values({
              id: input.evidenceId,
              tenantId: ctx.tenantId,
              claimId: claim.id,
              kind: input.kind,
              documentId: input.documentId ?? null,
              objectKey: input.objectKey ?? null,
              caption: input.caption ?? null,
              uploadedBy: ctx.actorId,
            })
            .returning()
        } catch (error) {
          conflictFrom(error, `evidence ${input.evidenceId} already exists`)
        }
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'evidence insert failed' })
        return { item: await this.detail(tx, claim.id), evidence: toClaimEvidence(row) }
      }),
    )
  }

  // =============================================================================================================
  // submit → acknowledge → settle | reject | write off ; cancel
  // =============================================================================================================

  async submit(input: SubmitIn): Promise<SubmitOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const out = await withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        const next = transition(claim, 'submit')
        const lines = await linesOf(tx, claim.id)
        const live = lines.filter((l) => l.status === 'open')
        const claimed = live.reduce((s, l) => s + l.amountPaise, 0)
        if (live.length === 0 || claimed <= 0)
          throw new ORPCError('CONFLICT', {
            message: 'nothing to claim: build the lines or add one before submitting',
          })
        const policy = claim.brandId
          ? await this.tenantCatalog.returnPolicy(tx, claim.brandId)
          : null
        const now = new Date()
        const submittedOn = input.submittedOn ?? businessDate(now).date
        const dueDate = addDaysIso(
          submittedOn,
          policy?.settlementDays ?? DEFAULT_CLAIM_SETTLEMENT_DAYS,
        )
        // Numbering happens ONLY here (brief §4.4): CLAIM series, per tenant per FY.
        const claimNo = await nextDocumentNumber(tx, 'CLAIM', now)
        await tx
          .update(claimLines)
          .set({ status: 'claimed', updatedAt: now })
          .where(
            and(
              eq(claimLines.tenantId, ctx.tenantId),
              eq(claimLines.claimId, claim.id),
              eq(claimLines.status, 'open'),
            ),
          )
        const names = await this.namesFor(tx, [claim])
        const supplierName = names(claim).supplierName
        let accruedAt: Date | null = null
        if (claim.claimChannel === 'dos') {
          const receivable = receivableAccountFor(claim.kind)
          await this.receivables.postEntry(tx, {
            entryDate: submittedOn,
            refType: 'claim',
            refId: claim.id,
            narration: `Claim ${claimNo} on ${supplierName} (${claim.kind}, ${claim.periodFrom} to ${claim.periodTo})`,
            idempotencyKey: journalKeys.accrue(claim.id),
            lines: [
              {
                accountCode: receivable,
                amountPaise: claimed,
                partyType: 'supplier',
                partyId: claim.supplierId,
                memo: claimNo,
              },
              { accountCode: expenseAccountFor(claim.kind), amountPaise: -claimed, memo: claimNo },
            ],
          })
          accruedAt = now
        }
        const [updated] = await tx
          .update(claims)
          .set({
            status: next,
            claimNo,
            claimedPaise: claimed,
            submittedAt: istInstant(input.submittedOn, now),
            submittedBy: ctx.actorId,
            dueDate,
            accruedAt,
            updatedAt: now,
          })
          .where(and(eq(claims.tenantId, ctx.tenantId), eq(claims.id, claim.id)))
          .returning()
        if (!updated) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'claim vanished' })
        const findings = live
          .filter((l) => l.sourceType === 'inbound_discrepancy')
          .map((l) => l.sourceId)
        await this.grns.markDiscrepanciesClaimed(tx, findings, claim.id)
        let statement: ClaimStatement | null = null
        let exportJobId: string | null = null
        if (input.statement) {
          const queued = await this.queueStatement(
            tx,
            updated,
            input.statement.id,
            input.statement.format ?? policy?.claimSheetFormat ?? DEFAULT_CLAIM_SHEET_FORMAT,
            names(claim),
            now,
          )
          statement = queued.statement
          exportJobId = queued.exportJobId
        }
        await emitClaimEvent(tx, claim.id, CLAIM_EVENTS.submitted, {
          claimId: claim.id,
          claimNo,
          supplierId: claim.supplierId,
          brandId: claim.brandId,
          kind: claim.kind,
          claimChannel: claim.claimChannel,
          claimedPaise: claimed,
          dueDate,
        })
        await writeAudit(tx, {
          action: 'claims.submit',
          entityType: 'claim',
          entityId: claim.id,
          before: { status: claim.status, claimedPaise: claim.claimedPaise },
          after: {
            status: next,
            claimNo,
            claimedPaise: claimed,
            dueDate,
            accrued: accruedAt !== null,
          },
        })
        return { item: await this.detail(tx, claim.id), statement, exportJobId }
      }),
    )
    if (out.exportJobId) await this.renderInline(out.exportJobId)
    return out.exportJobId
      ? { ...out, item: await withTenant(db, ctx, (tx) => this.detail(tx, out.item.id)) }
      : out
  }

  async acknowledge(input: AckIn): Promise<AckOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        const next = transition(claim, 'acknowledge')
        const now = new Date()
        await tx
          .update(claims)
          .set({
            status: next,
            externalRef: input.externalRef,
            acknowledgedAt: istInstant(input.acknowledgedOn, now),
            updatedAt: now,
          })
          .where(and(eq(claims.tenantId, ctx.tenantId), eq(claims.id, claim.id)))
        return { item: await this.detail(tx, claim.id) }
      }),
    )
  }

  /** The brand paid: partial or full, allocated to lines, journalled per mode (never for `brand_dms`). */
  async recordSettlement(input: SettleIn): Promise<SettleOut> {
    requireRole(MONEY_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        const room = claim.claimedPaise - claim.settledPaise - claim.writtenOffPaise
        if (input.amountPaise > room)
          throw new ORPCError('CONFLICT', {
            message: `${input.amountPaise} paise exceeds the ${room} paise still open on claim ${claim.claimNo ?? claim.id}`,
          })
        const full = input.amountPaise === room
        const next = transition(claim, full ? 'settle_full' : 'settle_partial')
        const now = new Date()
        // Allocate to lines: as named, else largest-remainder over the open capacity in line order.
        const lines = (await linesOf(tx, claim.id)).filter(
          (l) => l.status === 'claimed' || l.status === 'settled',
        )
        const capacity = (l: ClaimLineRow) => l.amountPaise - l.settledPaise
        let shares: { line: ClaimLineRow; amount: number }[]
        if (input.lineAllocations) {
          const byId = new Map(lines.map((l) => [l.id, l]))
          shares = input.lineAllocations.map((a) => {
            const line = byId.get(a.claimLineId)
            if (!line)
              throw new ORPCError('CONFLICT', {
                message: `line ${a.claimLineId} is not an open line of this claim`,
              })
            if (a.amountPaise > capacity(line))
              throw new ORPCError('CONFLICT', {
                message: `line ${line.id} has only ${capacity(line)} paise open`,
              })
            return { line, amount: a.amountPaise }
          })
        } else {
          const open = lines.filter((l) => capacity(l) > 0)
          if (open.length > 0) {
            const split = allocate(
              paise(input.amountPaise),
              open.map((l) => capacity(l)),
            )
            shares = open
              .map((line, i) => ({ line, amount: split[i] ?? 0 }))
              .filter((s) => s.amount > 0)
          } else shares = []
        }
        for (const s of shares) {
          const settled = s.line.settledPaise + s.amount
          await tx
            .update(claimLines)
            .set({
              settledPaise: settled,
              status: settled >= s.line.amountPaise ? 'settled' : s.line.status,
              updatedAt: now,
            })
            .where(and(eq(claimLines.tenantId, ctx.tenantId), eq(claimLines.id, s.line.id)))
        }
        let journalEntryId: string | null = null
        if (claim.claimChannel === 'dos') {
          const names = await this.namesFor(tx, [claim])
          const posted = await this.receivables.postEntry(tx, {
            entryDate: input.settledOn,
            refType: 'claim_settlement',
            refId: input.settlementId,
            narration: `${claim.claimNo ?? 'claim'} settled by ${names(claim).supplierName} (${input.mode}${input.externalRef ? ` ${input.externalRef}` : ''})`,
            idempotencyKey: journalKeys.settle(input.settlementId),
            lines: [
              {
                accountCode: SETTLEMENT_ACCOUNTS[input.mode],
                amountPaise: input.amountPaise,
                partyType: 'supplier',
                partyId: claim.supplierId,
                memo: input.externalRef ?? claim.claimNo ?? undefined,
              },
              {
                accountCode: receivableAccountFor(claim.kind),
                amountPaise: -input.amountPaise,
                partyType: 'supplier',
                partyId: claim.supplierId,
                memo: claim.claimNo ?? undefined,
              },
            ],
          })
          journalEntryId = posted.entryId
        }
        let settlement: typeof claimSettlements.$inferSelect | undefined
        try {
          ;[settlement] = await tx
            .insert(claimSettlements)
            .values({
              id: input.settlementId,
              tenantId: ctx.tenantId,
              claimId: claim.id,
              settledOn: input.settledOn,
              amountPaise: input.amountPaise,
              mode: input.mode,
              externalRef: input.externalRef ?? null,
              documentId: input.documentId ?? null,
              grnId: input.grnId ?? null,
              journalEntryId,
              note: input.note ?? null,
              recordedBy: ctx.actorId,
            })
            .returning()
        } catch (error) {
          conflictFrom(
            error,
            `reference ${input.externalRef ?? input.settlementId} is already recorded on this claim`,
          )
        }
        if (!settlement)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'settlement insert failed' })
        const settledPaise = claim.settledPaise + input.amountPaise
        try {
          await tx
            .update(claims)
            .set({
              status: next,
              settledPaise,
              settledAt: full ? istInstant(input.settledOn, now) : claim.settledAt,
              externalRef: claim.externalRef ?? input.externalRef ?? null,
              updatedAt: now,
            })
            .where(and(eq(claims.tenantId, ctx.tenantId), eq(claims.id, claim.id)))
        } catch (error) {
          conflictFrom(error, 'the settlement would exceed what was claimed')
        }
        await emitClaimEvent(tx, claim.id, CLAIM_EVENTS.settled, {
          claimId: claim.id,
          settlementId: settlement.id,
          amountPaise: input.amountPaise,
          mode: input.mode,
          settledPaise,
          status: next,
        })
        await writeAudit(tx, {
          action: 'claims.settlement.record',
          entityType: 'claim',
          entityId: claim.id,
          before: { status: claim.status, settledPaise: claim.settledPaise },
          after: {
            status: next,
            settledPaise,
            settlementId: settlement.id,
            amountPaise: input.amountPaise,
            mode: input.mode,
            journalEntryId,
          },
        })
        return { item: await this.detail(tx, claim.id), settlement: toClaimSettlement(settlement) }
      }),
    )
  }

  /** The brand refused: the accrual is REVERSED (never deleted), the sources freed. 409 once money has landed. */
  async reject(input: RejectIn): Promise<RejectOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        const next = transition(claim, 'reject')
        const [settled] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(claimSettlements)
          .where(
            and(
              eq(claimSettlements.tenantId, ctx.tenantId),
              eq(claimSettlements.claimId, claim.id),
            ),
          )
        if ((settled?.n ?? 0) > 0)
          throw new ORPCError('CONFLICT', {
            message: `claim ${claim.claimNo ?? claim.id} has a settlement recorded; write off the remainder instead`,
          })
        const now = new Date()
        if (claim.claimChannel === 'dos') {
          const accrual = await this.receivables.entryIdByRef(tx, 'claim', claim.id)
          if (accrual)
            await this.receivables.reverseEntry(
              tx,
              accrual,
              journalKeys.reject(claim.id),
              `Claim ${claim.claimNo ?? claim.id} rejected: ${input.reason}`,
            )
        }
        const lines = await linesOf(tx, claim.id)
        const freed = lines.filter((l) => l.status !== 'settled' && l.status !== 'rejected')
        for (const l of freed) {
          await tx
            .update(claimLines)
            .set({
              status: 'rejected',
              detail: { ...detailOf(l), reason: 'claim_rejected' },
              updatedAt: now,
            })
            .where(and(eq(claimLines.tenantId, ctx.tenantId), eq(claimLines.id, l.id)))
        }
        await this.grns.reopenDiscrepancies(
          tx,
          freed.filter((l) => l.sourceType === 'inbound_discrepancy').map((l) => l.sourceId),
        )
        await tx
          .update(claims)
          .set({
            status: next,
            rejectedAt: istInstant(input.rejectedOn, now),
            rejectionReason: input.reason,
            updatedAt: now,
          })
          .where(and(eq(claims.tenantId, ctx.tenantId), eq(claims.id, claim.id)))
        await emitClaimEvent(tx, claim.id, CLAIM_EVENTS.rejected, {
          claimId: claim.id,
          claimNo: claim.claimNo,
          reason: input.reason,
        })
        await writeAudit(tx, {
          action: 'claims.reject',
          entityType: 'claim',
          entityId: claim.id,
          before: { status: claim.status },
          after: { status: next, reason: input.reason, linesFreed: freed.length },
        })
        return { item: await this.detail(tx, claim.id) }
      }),
    )
  }

  /**
   * The unrecovered remainder accepted as a loss: Dr BAD_DEBTS / Cr the receivable (the orchestrating
   * plan names BAD_DEBTS for a written-off claim; the brief's expense-account variant is not used).
   * Owner or accountant only.
   */
  async writeOff(input: WriteOffIn): Promise<WriteOffOut> {
    requireRole(LOSS_ACCEPTORS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        const next = transition(claim, 'write_off')
        const remainder = claim.claimedPaise - claim.settledPaise - claim.writtenOffPaise
        if (remainder <= 0)
          throw new ORPCError('CONFLICT', {
            message: `claim ${claim.claimNo ?? claim.id} has nothing left to write off`,
          })
        const now = new Date()
        const writtenOffOn = input.writtenOffOn ?? businessDate(now).date
        if (claim.claimChannel === 'dos') {
          await this.receivables.postEntry(tx, {
            entryDate: writtenOffOn,
            refType: 'claim_write_off',
            refId: claim.id,
            narration: `Claim ${claim.claimNo ?? claim.id} written off: ${input.reason}`,
            idempotencyKey: journalKeys.writeOff(claim.id),
            lines: [
              {
                accountCode: 'BAD_DEBTS',
                amountPaise: remainder,
                memo: claim.claimNo ?? undefined,
              },
              {
                accountCode: receivableAccountFor(claim.kind),
                amountPaise: -remainder,
                partyType: 'supplier',
                partyId: claim.supplierId,
                memo: claim.claimNo ?? undefined,
              },
            ],
          })
        }
        await tx
          .update(claimLines)
          .set({ status: 'written_off', updatedAt: now })
          .where(
            and(
              eq(claimLines.tenantId, ctx.tenantId),
              eq(claimLines.claimId, claim.id),
              inArray(claimLines.status, ['claimed', 'open']),
            ),
          )
        await tx
          .update(claims)
          .set({
            status: next,
            writtenOffPaise: claim.writtenOffPaise + remainder,
            updatedAt: now,
          })
          .where(and(eq(claims.tenantId, ctx.tenantId), eq(claims.id, claim.id)))
        await emitClaimEvent(tx, claim.id, CLAIM_EVENTS.writtenOff, {
          claimId: claim.id,
          claimNo: claim.claimNo,
          writtenOffPaise: remainder,
          reason: input.reason,
        })
        await writeAudit(tx, {
          action: 'claims.write_off',
          entityType: 'claim',
          entityId: claim.id,
          before: { status: claim.status, writtenOffPaise: claim.writtenOffPaise },
          after: {
            status: next,
            writtenOffPaise: claim.writtenOffPaise + remainder,
            reason: input.reason,
          },
        })
        return { item: await this.detail(tx, claim.id) }
      }),
    )
  }

  /** A draft discarded: its lines go (their sources are free again); no number, no journal to undo. */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id, true)
        const next = transition(claim, 'cancel')
        const lines = await linesOf(tx, claim.id)
        await tx
          .delete(claimLines)
          .where(and(eq(claimLines.tenantId, ctx.tenantId), eq(claimLines.claimId, claim.id)))
        const now = new Date()
        await tx
          .update(claims)
          .set({ status: next, claimedPaise: 0, updatedAt: now })
          .where(and(eq(claims.tenantId, ctx.tenantId), eq(claims.id, claim.id)))
        await writeAudit(tx, {
          action: 'claims.cancel',
          entityType: 'claim',
          entityId: claim.id,
          before: { status: claim.status, claimedPaise: claim.claimedPaise, lines: lines.length },
          after: { status: next, reason: input.reason },
        })
        return { item: await this.detail(tx, claim.id) }
      }),
    )
  }

  // =============================================================================================================
  // statements
  // =============================================================================================================

  async generateStatement(input: StatementIn): Promise<StatementOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const out = await withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const claim = await loadClaim(tx, input.id)
        if (!['draft', 'submitted', 'acknowledged'].includes(claim.status))
          throw new ORPCError('CONFLICT', {
            message: `claim ${claim.claimNo ?? claim.id} is ${claim.status}; a sheet is produced for a draft, submitted or acknowledged claim`,
          })
        const policy = claim.brandId
          ? await this.tenantCatalog.returnPolicy(tx, claim.brandId)
          : null
        const names = await this.namesFor(tx, [claim])
        const queued = await this.queueStatement(
          tx,
          claim,
          input.statementId,
          input.format ?? policy?.claimSheetFormat ?? DEFAULT_CLAIM_SHEET_FORMAT,
          names(claim),
          new Date(),
        )
        return { item: queued.statement, exportJobId: queued.exportJobId }
      }),
    )
    await this.renderInline(out.exportJobId)
    const fresh = await withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(claimStatements)
        .where(and(eq(claimStatements.tenantId, ctx.tenantId), eq(claimStatements.id, out.item.id)))
        .limit(1)
      return row ? toClaimStatement(row) : out.item
    })
    return { item: fresh, exportJobId: out.exportJobId }
  }

  async listStatements(input: StatementsIn): Promise<StatementsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      await loadClaim(tx, input.id)
      const filters: (SQL | undefined)[] = [
        eq(claimStatements.tenantId, ctx.tenantId),
        eq(claimStatements.claimId, input.id),
        input.cursor ? lt(claimStatements.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(claimStatements)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(claimStatements.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toClaimStatement)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /**
   * Snapshot the lines, insert the statement with `object_key = NULL`, enqueue ONE `claim_sheet`
   * export on integrations' queue (coordination §3.5). Rendering never happens here (docs/20 rule 3);
   * outside production the API renders it right after the commit (`renderInline`).
   */
  private async queueStatement(
    tx: Db,
    claim: ClaimRow,
    statementId: string,
    format: string,
    names: ClaimNames,
    now: Date,
  ): Promise<{ statement: ClaimStatement; exportJobId: string }> {
    const ctx = currentTenant()
    const lines = await linesOf(tx, claim.id)
    const payload = await snapshotClaimSheet(tx, claim, lines, names, format, now)
    const exportJobId = uuidv7()
    let row: typeof claimStatements.$inferSelect | undefined
    try {
      ;[row] = await tx
        .insert(claimStatements)
        .values({
          id: statementId,
          tenantId: ctx.tenantId,
          claimId: claim.id,
          format,
          objectKey: null,
          exportJobId,
          rowCount: null,
          generatedAt: null,
          payload,
        })
        .returning()
    } catch (error) {
      conflictFrom(error, `statement ${statementId} already exists`)
    }
    if (!row) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'statement insert failed' })
    await this.exportJobs.enqueueExport(tx, {
      id: exportJobId,
      kind: CLAIM_SHEET_EXPORT_KIND,
      params: { claimId: claim.id, statementId, format },
      requestedBy: ctx.actorId,
    })
    await emitClaimEvent(tx, claim.id, CLAIM_EVENTS.statementRequested, {
      claimId: claim.id,
      statementId,
      format,
      exportJobId,
    })
    return { statement: toClaimStatement(row), exportJobId }
  }

  /** Outside production the file is rendered in this process right after the commit (the worker may not be running on the founder's Mac). */
  private async renderInline(exportJobId: string): Promise<void> {
    if (!integrationsConfig().inlineJobs) return
    try {
      await this.exportJobs.renderNow(exportJobId)
    } catch (error) {
      // The export job carries the failure; the statement simply stays `ready: false` until the worker retries.
      console.warn('[claims] inline claim sheet render failed', error)
    }
  }

  // =============================================================================================================
  // reads
  // =============================================================================================================

  /** The claim with its first page of lines, evidence, statements, settlements and the brand's policy. */
  async detail(tx: Db, claimId: string): Promise<ClaimDetail> {
    const ctx = currentTenant()
    const claim = await loadClaim(tx, claimId)
    const names = await this.namesFor(tx, [claim])
    const lineRows = await tx
      .select()
      .from(claimLines)
      .where(and(eq(claimLines.tenantId, ctx.tenantId), eq(claimLines.claimId, claimId)))
      .orderBy(asc(claimLines.id))
      .limit(CLAIM_DETAIL_LINES + 1)
    const lines = lineRows.slice(0, CLAIM_DETAIL_LINES).map(toClaimLine)
    const lastLine = lines[lines.length - 1]
    // One transaction client: the reads run one after another (pg refuses concurrent queries on a client).
    const evidence = await tx
      .select()
      .from(claimEvidence)
      .where(and(eq(claimEvidence.tenantId, ctx.tenantId), eq(claimEvidence.claimId, claimId)))
      .orderBy(asc(claimEvidence.id))
    const statements = await tx
      .select()
      .from(claimStatements)
      .where(and(eq(claimStatements.tenantId, ctx.tenantId), eq(claimStatements.claimId, claimId)))
      .orderBy(desc(claimStatements.id))
      .limit(50)
    const settlements = await tx
      .select()
      .from(claimSettlements)
      .where(
        and(eq(claimSettlements.tenantId, ctx.tenantId), eq(claimSettlements.claimId, claimId)),
      )
      .orderBy(asc(claimSettlements.id))
    const policy = claim.brandId ? await this.tenantCatalog.returnPolicy(tx, claim.brandId) : null
    const summary: ClaimSummary = toClaimSummary(claim, names(claim), businessDate().date)
    return {
      ...summary,
      lines,
      linesNextCursor: lineRows.length > CLAIM_DETAIL_LINES && lastLine ? lastLine.id : null,
      evidence: evidence.map(toClaimEvidence),
      statements: statements.map(toClaimStatement),
      settlements: settlements.map(toClaimSettlement),
      policy: policy ? toClaimPolicy(policy) : null,
    }
  }

  /** Supplier and brand names plus the line count for a page of claims, three bounded queries. */
  private async namesFor(
    tx: Db,
    rows: readonly ClaimRow[],
  ): Promise<(row: ClaimRow) => ClaimNames> {
    const ctx = currentTenant()
    if (rows.length === 0) return () => ({ supplierName: '', brandName: null, lineCount: 0 })
    const suppliers = await this.tenantCatalog.supplierLabels(
      tx,
      rows.map((r) => r.supplierId),
    )
    const brands = await this.tenantCatalog.brandLabels(
      tx,
      rows.map((r) => r.brandId).filter((b): b is string => b !== null),
    )
    const counts = await tx
      .select({ claimId: claimLines.claimId, n: sql<number>`count(*)::int` })
      .from(claimLines)
      .where(
        and(
          eq(claimLines.tenantId, ctx.tenantId),
          inArray(
            claimLines.claimId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .groupBy(claimLines.claimId)
    const countBy = new Map(counts.map((c) => [c.claimId, Number(c.n)]))
    return (row) => ({
      supplierName: suppliers.get(row.supplierId)?.name ?? '',
      brandName: row.brandId ? (brands.get(row.brandId) ?? null) : null,
      lineCount: countBy.get(row.id) ?? 0,
    })
  }
}

/**
 * The closed periods of a brand, newest first (brief §2 `periods.list`): calendar months, halves of
 * a month, or quarters, walked back from today (IST). `cutoff` is the policy's cut-off day in the
 * month after the period ends (the 1st when unset).
 */
export function periodWindows(
  policy: ReturnPolicyRow,
  today: string,
  count: number,
): { from: string; to: string; cutoff: string }[] {
  const out: { from: string; to: string; cutoff: string }[] = []
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const d = Number(today.slice(8, 10))
  const cutoffDay = policy.claimCutoffDay ?? 1
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const monthOf = (yy: number, mm: number, delta: number): [number, number] => {
    const idx = yy * 12 + (mm - 1) + delta
    return [Math.floor(idx / 12), (idx % 12) + 1]
  }
  const cutoffAfter = (yy: number, mm: number): string => {
    const [ny, nm] = monthOf(yy, mm, 1)
    return `${ny}-${pad(nm)}-${pad(Math.min(cutoffDay, lastDay(ny, nm)))}`
  }
  if (policy.claimPeriodKind === 'monthly') {
    for (let i = 1; out.length < count && i <= count + 1; i++) {
      const [yy, mm] = monthOf(y, m, -i)
      out.push({
        from: `${yy}-${pad(mm)}-01`,
        to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}`,
        cutoff: cutoffAfter(yy, mm),
      })
    }
  } else if (policy.claimPeriodKind === 'quarterly') {
    const q0 = Math.floor((m - 1) / 3)
    for (let i = 1; out.length < count; i++) {
      const qi = y * 4 + q0 - i
      const qy = Math.floor(qi / 4)
      const qm = (qi % 4) * 3 + 1
      out.push({
        from: `${qy}-${pad(qm)}-01`,
        to: `${qy}-${pad(qm + 2)}-${pad(lastDay(qy, qm + 2))}`,
        cutoff: cutoffAfter(qy, qm + 2),
      })
    }
  } else if (policy.claimPeriodKind === 'fortnightly') {
    // Halves: 1–15 and 16–end. Start from the last CLOSED half.
    let yy = y
    let mm = m
    let second = d > 15 // the first half of this month is closed once we are past the 15th
    while (out.length < count) {
      if (second) {
        second = false
        out.push({
          from: `${yy}-${pad(mm)}-01`,
          to: `${yy}-${pad(mm)}-15`,
          cutoff: `${yy}-${pad(mm)}-${pad(Math.min(15 + cutoffDay, lastDay(yy, mm)))}`,
        })
      } else {
        ;[yy, mm] = monthOf(yy, mm, -1)
        second = true
        out.push({
          from: `${yy}-${pad(mm)}-16`,
          to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}`,
          cutoff: cutoffAfter(yy, mm),
        })
      }
    }
  }
  return out
}
