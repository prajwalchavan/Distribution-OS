import { Injectable } from '@nestjs/common'
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { ClaimBuildSource, ClaimKind, ClaimLineDetail, ClaimValueBasis } from '@dos/contracts'
import { allocate, businessDate, daysBetween, multiply, paise } from '@dos/domain'
import { claimLines, type AppliedRule, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { RegistersService } from '../billing/index.js'
import { InventoryService } from '../inventory/index.js'
import { SchemesService, type SchemeForClaim } from '../pricing/index.js'
import { GrnService } from '../procurement/index.js'
import {
  TenantCatalogService,
  type ReturnPolicyRow,
  type VariantCostRow,
} from '../tenant-catalog/index.js'
import { builtLineId, linesOf, recomputeClaimed, type ClaimRow } from './claims.internals.js'

/**
 * THE BUILD (brief §2 `build`, §4.6–4.14): a draft's lines reconstructed from the sources its kind
 * implies, every one read through the owning module's exported service (coordination §4) — never a
 * table of billing, pricing, inventory, procurement or the catalog overlay.
 *
 *   scheme                   `invoice_lines.applied_rules` → the scheme behind each rule; only
 *                            claimable + company-funded + this claim's channel + not a cash discount
 *   damage                   credit notes `return_damaged` + `stock_ledger` `damage` rows into the damaged bin
 *   expiry                   `stock_ledger` `expiry_writeoff` rows into the damaged bin
 *   shortage                 open gate-count findings `short` / `damaged` on the supplier's GRNs
 *   rate_difference          open `price_mismatch` findings
 *   other                    manual lines only
 *
 * Re-runnable: a source already carried by a non-rejected line of ANY claim is `skipped` (the partial
 * unique index is the guarantee); a source older than the claim window is inserted `rejected` with
 * `detail.reason = 'out_of_window'` so the loss is visible; `open` lines whose source disappeared are
 * deleted; the header money is recomputed from the lines. Bounded: at most `limit` lines per call and
 * `truncated: true` when it stops early.
 */

type SourceType = ClaimBuildSource

export interface Candidate {
  sourceType: SourceType
  sourceId: string
  /** The source document's own IST date — what the claim window is measured from. */
  sourceDate: string
  schemeId: string | null
  retailerId: string | null
  variantId: string | null
  lotId: string | null
  batchNo: string | null
  expiryDate: string | null
  mrpPaise: number | null
  qtyPcs: number
  caseSize: number | null
  ratePaise: number | null
  basis: ClaimValueBasis | null
  amountPaise: number
  detail: ClaimLineDetail
  /** `min(policy window, scheme window)`; null = no window. */
  windowDays: number | null
}

export interface BuildResult {
  added: number
  skipped: number
  outOfWindow: number
  truncated: boolean
}

/** What a kind reads by default (brief §2 `build`: "the set implied by kind"). */
export function defaultSourcesFor(kind: ClaimKind): SourceType[] {
  switch (kind) {
    case 'scheme':
      return ['invoice']
    case 'damage':
      return ['credit_note', 'stock_ledger']
    case 'expiry':
      return ['stock_ledger']
    case 'shortage':
    case 'rate_difference':
      return ['inbound_discrepancy']
    case 'other':
      return []
  }
}

const SOURCE_READ_LIMIT = 5_000
/** Split an `IN (…)` list so no single statement carries thousands of parameters. */
const CHUNK = 500

const minWindow = (a: number | null | undefined, b: number | null | undefined): number | null => {
  const xs = [a, b].filter((v): v is number => typeof v === 'number' && v > 0)
  return xs.length === 0 ? null : Math.min(...xs)
}

/** Round half up at the line total when the supplier billed per case (docs/17 A4). */
function valueAt(
  basis: ClaimValueBasis,
  qtyPcs: number,
  cost: VariantCostRow | undefined,
  mrpPaise: number | null,
): { ratePaise: number | null; amountPaise: number } {
  if (basis === 'mrp') {
    const rate = mrpPaise ?? 0
    return { ratePaise: rate, amountPaise: multiply(paise(rate), qtyPcs) }
  }
  if (!cost) return { ratePaise: null, amountPaise: 0 }
  if (basis === 'landed_cost') {
    return {
      ratePaise: cost.landedCostPaise,
      amountPaise: multiply(paise(cost.landedCostPaise), qtyPcs),
    }
  }
  // `ptd` (the default), falling back to the landed cost, then the purchase rate (brief §8.4).
  const perPiece = cost.perPieceCost === null ? null : Number(cost.perPieceCost)
  if (perPiece !== null && Number.isFinite(perPiece) && perPiece > 0 && cost.ptdPaise === null) {
    return {
      ratePaise: Math.round(perPiece),
      amountPaise: paise(Math.round(perPiece * qtyPcs)),
    }
  }
  const rate = cost.ptdPaise ?? cost.landedCostPaise ?? cost.purchaseRatePaise
  return { ratePaise: rate, amountPaise: multiply(paise(rate), qtyPcs) }
}

@Injectable()
export class ClaimBuildService {
  constructor(
    private readonly registers: RegistersService,
    private readonly schemes: SchemesService,
    private readonly inventory: InventoryService,
    private readonly grns: GrnService,
    private readonly tenantCatalog: TenantCatalogService,
  ) {}

  /** The policy gate (brief §4.12): a brand that takes no damage / expiry returns refuses the build by name. */
  static assertPolicyAllows(kind: ClaimKind, policy: ReturnPolicyRow | null): void {
    if (kind === 'damage' && policy && !policy.damageClaimable)
      throw new ORPCError('CONFLICT', {
        message: `${policy.brandName} does not accept damage claims (return policy)`,
      })
    if (kind === 'expiry' && policy && !policy.expiryClaimable)
      throw new ORPCError('CONFLICT', {
        message: `${policy.brandName} does not accept expiry claims (return policy)`,
      })
  }

  /** Every source the claim's kind and window admit, in (source_type, source_id) order. */
  async gather(
    tx: Db,
    claim: ClaimRow,
    policy: ReturnPolicyRow | null,
    sources: readonly SourceType[],
  ): Promise<Candidate[]> {
    const out: Candidate[] = []
    const wanted = new Set(sources)
    if (claim.kind === 'scheme' && wanted.has('invoice') && claim.brandId) {
      out.push(...(await this.schemeCandidates(tx, claim, claim.brandId, policy)))
    }
    if (claim.kind === 'damage' && claim.brandId) {
      if (wanted.has('credit_note'))
        out.push(...(await this.creditNoteCandidates(tx, claim, claim.brandId, policy)))
      if (wanted.has('stock_ledger'))
        out.push(...(await this.ledgerCandidates(tx, claim, claim.brandId, policy, ['damage'])))
    }
    if (claim.kind === 'expiry' && claim.brandId && wanted.has('stock_ledger')) {
      out.push(
        ...(await this.ledgerCandidates(tx, claim, claim.brandId, policy, ['expiry_writeoff'])),
      )
    }
    if (
      (claim.kind === 'shortage' || claim.kind === 'rate_difference') &&
      wanted.has('inbound_discrepancy')
    ) {
      out.push(...(await this.discrepancyCandidates(tx, claim, policy)))
    }
    return out.sort(
      (a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId),
    )
  }

  /**
   * Insert what is new, skip what is claimed, reject what is stale, drop what vanished, recompute.
   * Runs inside the caller's `withTenant` + `idempotent` transaction.
   */
  async build(
    tx: Db,
    claim: ClaimRow,
    policy: ReturnPolicyRow | null,
    sources: readonly SourceType[],
    limit: number,
  ): Promise<BuildResult> {
    const { tenantId } = currentTenant()
    const candidates = await this.gather(tx, claim, policy, sources)
    const existing = await linesOf(tx, claim.id)
    const onThisClaim = new Set(existing.map((l) => `${l.sourceType}:${l.sourceId}`))
    const elsewhere = await this.claimedElsewhere(tx, claim.id, candidates)
    const fresh = new Set(candidates.map((c) => `${c.sourceType}:${c.sourceId}`))

    // Open lines whose source is gone (a cancelled bill, a finding the desk accepted) leave the draft.
    let lineNo = existing.reduce((m, l) => Math.max(m, l.lineNo), 0)
    const gone = existing.filter(
      (l) =>
        l.status === 'open' &&
        l.sourceType !== 'manual' &&
        sources.includes(l.sourceType as SourceType) &&
        !fresh.has(`${l.sourceType}:${l.sourceId}`),
    )
    if (gone.length > 0) {
      await tx.delete(claimLines).where(
        and(
          eq(claimLines.tenantId, tenantId),
          inArray(
            claimLines.id,
            gone.map((l) => l.id),
          ),
        ),
      )
    }

    let added = 0
    let skipped = 0
    let outOfWindow = 0
    let truncated = false
    for (const c of candidates) {
      const key = `${c.sourceType}:${c.sourceId}`
      if (onThisClaim.has(key) || elsewhere.has(key)) {
        skipped += 1
        continue
      }
      if (added >= limit) {
        truncated = true
        break
      }
      const stale =
        c.windowDays !== null && daysBetween(c.sourceDate, claim.periodTo) > c.windowDays
      const noCost = c.amountPaise <= 0
      const detail: ClaimLineDetail = stale
        ? { ...c.detail, reason: 'out_of_window' }
        : noCost
          ? { ...c.detail, reason: 'no_cost_basis' }
          : c.detail
      lineNo += 1
      const inserted = await tx
        .insert(claimLines)
        .values({
          id: builtLineId(claim.id, c.sourceType, c.sourceId),
          tenantId,
          claimId: claim.id,
          lineNo,
          status: stale || noCost ? 'rejected' : 'open',
          schemeId: c.schemeId,
          sourceType: c.sourceType,
          sourceId: c.sourceId,
          retailerId: c.retailerId,
          variantId: c.variantId,
          lotId: c.lotId,
          batchNo: c.batchNo,
          expiryDate: c.expiryDate,
          caseSize: c.caseSize,
          qtyPcs: c.qtyPcs,
          mrpPaise: c.mrpPaise,
          ratePaise: c.ratePaise,
          basis: c.basis,
          amountPaise: c.amountPaise,
          detail,
        })
        .onConflictDoNothing()
        .returning({ id: claimLines.id })
      if (inserted.length === 0) {
        // Raced by another desk's build a moment ago: the partial unique index kept it to one claim.
        lineNo -= 1
        skipped += 1
        continue
      }
      added += 1
      if (stale || noCost) outOfWindow += 1
    }
    await recomputeClaimed(tx, claim.id)
    return { added, skipped, outOfWindow, truncated }
  }

  /**
   * A cheap estimate for `periods.list`: how many sources a window holds and what they are worth,
   * without materialising lines. Bounded by the same read limits as the build.
   */
  async estimate(
    tx: Db,
    claim: Pick<
      ClaimRow,
      'kind' | 'brandId' | 'supplierId' | 'claimChannel' | 'periodFrom' | 'periodTo'
    >,
    policy: ReturnPolicyRow | null,
  ): Promise<{ count: number; amountPaise: number }> {
    const fake: ClaimRow = {
      ...claim,
      id: '',
      tenantId: currentTenant().tenantId,
      claimNo: null,
      status: 'draft',
      claimedPaise: 0,
      settledPaise: 0,
      writtenOffPaise: 0,
      externalRef: null,
      submittedAt: null,
      dueDate: null,
      acknowledgedAt: null,
      settledAt: null,
      rejectedAt: null,
      rejectionReason: null,
      accruedAt: null,
      createdBy: null,
      submittedBy: null,
      note: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }
    const candidates = await this.gather(tx, fake, policy, defaultSourcesFor(claim.kind))
    const elsewhere = await this.claimedElsewhere(tx, null, candidates)
    let count = 0
    let amountPaise = 0
    for (const c of candidates) {
      if (elsewhere.has(`${c.sourceType}:${c.sourceId}`)) continue
      if (c.windowDays !== null && daysBetween(c.sourceDate, claim.periodTo) > c.windowDays)
        continue
      count += 1
      amountPaise += c.amountPaise
    }
    return { count, amountPaise }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // sources

  private async schemeCandidates(
    tx: Db,
    claim: ClaimRow,
    brandId: string,
    policy: ReturnPolicyRow | null,
  ): Promise<Candidate[]> {
    const lines = await this.registers.invoiceLinesForPeriod(tx, {
      from: claim.periodFrom,
      to: claim.periodTo,
      brandId,
      limit: SOURCE_READ_LIMIT,
    })
    if (lines.length === 0) return []
    const ruleIds = new Set<string>()
    for (const l of lines)
      for (const r of l.appliedRules) if (r.kind === 'scheme') ruleIds.add(r.ruleId)
    const schemes = await this.schemes.schemesByIds(tx, [...ruleIds])
    const eligible = (s: SchemeForClaim | undefined): s is SchemeForClaim =>
      s !== undefined &&
      s.claimable &&
      s.fundingSource === 'company' &&
      s.claimChannel === claim.claimChannel &&
      s.rewardKind !== 'cash_discount_pct' &&
      (s.brandId === null || s.brandId === brandId)
    // A credit note against the bill reduces the claimable quantity (brief §4.13); returns may land after the period.
    const returns = await this.registers.creditNoteLinesForPeriod(tx, {
      from: claim.periodFrom,
      to: businessDate().date,
      brandId,
      limit: SOURCE_READ_LIMIT,
    })
    const returnedByLine = new Map<string, number>()
    for (const r of returns)
      returnedByLine.set(r.invoiceLineId, (returnedByLine.get(r.invoiceLineId) ?? 0) + r.qtyPcs)
    const variantIds = new Set<string>()
    for (const l of lines) {
      variantIds.add(l.variantId)
      for (const r of l.appliedRules) if (r.freeVariantId) variantIds.add(r.freeVariantId)
    }
    const packs = await this.tenantCatalog.sellSidePackSizes(tx, [...variantIds])
    const costs = await this.tenantCatalog.costsForVariants(tx, [...variantIds])
    const out: Candidate[] = []
    for (const l of lines) {
      const returned = Math.min(l.qtyPcs, returnedByLine.get(l.lineId) ?? 0)
      const kept = l.qtyPcs - returned
      for (const rule of l.appliedRules) {
        if (rule.kind !== 'scheme') continue
        const scheme = schemes.get(rule.ruleId)
        if (!eligible(scheme)) continue
        out.push(this.schemeLine(claim, l, rule, scheme, kept, returned, packs, costs, policy))
      }
    }
    return out
  }

  private schemeLine(
    claim: ClaimRow,
    l: Awaited<ReturnType<RegistersService['invoiceLinesForPeriod']>>[number],
    rule: AppliedRule,
    scheme: SchemeForClaim,
    kept: number,
    returned: number,
    packs: Awaited<ReturnType<TenantCatalogService['sellSidePackSizes']>>,
    costs: Map<string, VariantCostRow>,
    policy: ReturnPolicyRow | null,
  ): Candidate {
    const total = kept + returned
    const detailBase: ClaimLineDetail = {
      invoiceNo: l.invoiceNo ?? undefined,
      ruleKind: rule.kind,
      rewardKind: rule.rewardKind ?? scheme.rewardKind,
      appliedRule: rule,
      schemeName: scheme.name,
      schemeRef: scheme.sourceRef ?? undefined,
      sourceDate: l.invoiceDate,
    }
    const windowDays = minWindow(policy?.claimWindowDays, scheme.claimWindowDays)
    const rewardKind = rule.rewardKind ?? scheme.rewardKind
    if (rewardKind === 'free_qty') {
      // Free goods are claimed AT COST (brief §4.14): the pieces given away, valued at PTD.
      const variantId = rule.freeVariantId ?? l.variantId
      const freeQty = rule.freeQty ?? 0
      const qty = returned > 0 && total > 0 ? Math.floor((freeQty * kept) / total) : freeQty
      const value = valueAt(
        'ptd',
        qty,
        costs.get(variantId),
        packs.get(variantId)?.mrpPaise ?? null,
      )
      return {
        sourceType: 'invoice',
        sourceId: `${l.lineId}:${rule.ruleId}`,
        sourceDate: l.invoiceDate,
        schemeId: scheme.id,
        retailerId: l.retailerId,
        variantId,
        lotId: null,
        batchNo: null,
        expiryDate: null,
        mrpPaise: packs.get(variantId)?.mrpPaise ?? null,
        qtyPcs: qty,
        caseSize: packs.get(variantId)?.packSize ?? null,
        ratePaise: value.ratePaise,
        basis: 'ptd',
        amountPaise: value.amountPaise,
        detail: detailBase,
        windowDays,
      }
    }
    // Percentage / flat / net-scheme rewards: exactly the paise given away, scaled by what was kept.
    const given = paise(rule.amountPaise ?? 0)
    const amount = returned > 0 && total > 0 ? (allocate(given, [kept, returned])[0] ?? 0) : given
    return {
      sourceType: 'invoice',
      sourceId: `${l.lineId}:${rule.ruleId}`,
      sourceDate: l.invoiceDate,
      schemeId: scheme.id,
      retailerId: l.retailerId,
      variantId: l.variantId,
      lotId: null,
      batchNo: null,
      expiryDate: null,
      mrpPaise: packs.get(l.variantId)?.mrpPaise ?? null,
      qtyPcs: kept,
      caseSize: packs.get(l.variantId)?.packSize ?? null,
      ratePaise: null,
      basis: 'scheme_amount',
      amountPaise: amount,
      detail: detailBase,
      windowDays,
    }
  }

  private async creditNoteCandidates(
    tx: Db,
    claim: ClaimRow,
    brandId: string,
    policy: ReturnPolicyRow | null,
  ): Promise<Candidate[]> {
    const notes = (
      await this.registers.creditNoteLinesForPeriod(tx, {
        from: claim.periodFrom,
        to: claim.periodTo,
        brandId,
        limit: SOURCE_READ_LIMIT,
      })
    ).filter((n) => n.reason === 'return_damaged' && n.qtyPcs > 0)
    if (notes.length === 0) return []
    const variantIds = [...new Set(notes.map((n) => n.variantId))]
    const packs = await this.tenantCatalog.sellSidePackSizes(tx, variantIds)
    const costs = await this.tenantCatalog.costsForVariants(tx, variantIds)
    const basis = policy?.damageValueBasis ?? 'ptd'
    return notes.map((n) => {
      const value = valueAt(
        basis,
        n.qtyPcs,
        costs.get(n.variantId),
        packs.get(n.variantId)?.mrpPaise ?? null,
      )
      return {
        sourceType: 'credit_note',
        sourceId: n.lineId,
        sourceDate: n.noteDate,
        schemeId: null,
        retailerId: n.retailerId,
        variantId: n.variantId,
        lotId: null,
        batchNo: null,
        expiryDate: null,
        mrpPaise: packs.get(n.variantId)?.mrpPaise ?? null,
        qtyPcs: n.qtyPcs,
        caseSize: packs.get(n.variantId)?.packSize ?? null,
        ratePaise: value.ratePaise,
        basis,
        amountPaise: value.amountPaise,
        detail: { creditNoteNo: n.creditNoteNo ?? undefined, sourceDate: n.noteDate },
        windowDays: minWindow(policy?.claimWindowDays, null),
      }
    })
  }

  private async ledgerCandidates(
    tx: Db,
    claim: ClaimRow,
    brandId: string,
    policy: ReturnPolicyRow | null,
    reasons: ('damage' | 'expiry_writeoff')[],
  ): Promise<Candidate[]> {
    const rows = await this.inventory.ledgerRowsByReason(tx, {
      reasons,
      locationKind: 'damaged',
      from: claim.periodFrom,
      to: claim.periodTo,
      brandId,
      limit: SOURCE_READ_LIMIT,
    })
    if (rows.length === 0) return []
    const costs = await this.tenantCatalog.costsForVariants(tx, [
      ...new Set(rows.map((r) => r.variantId)),
    ])
    const basis =
      claim.kind === 'expiry'
        ? (policy?.expiryValueBasis ?? 'ptd')
        : (policy?.damageValueBasis ?? 'ptd')
    return rows.map((r) => {
      const value = valueAt(basis, r.qtyDelta, costs.get(r.variantId), r.mrpPaise)
      const sourceDate = businessDate(r.occurredAt).date
      return {
        sourceType: 'stock_ledger',
        sourceId: r.id,
        sourceDate,
        schemeId: null,
        retailerId: null,
        variantId: r.variantId,
        lotId: r.lotId,
        batchNo: r.batchNo || null,
        expiryDate: r.expiryDate,
        mrpPaise: r.mrpPaise,
        qtyPcs: r.qtyDelta,
        caseSize: r.caseSize,
        ratePaise: value.ratePaise,
        basis,
        amountPaise: value.amountPaise,
        detail: { ledgerRef: r.idempotencyKey, note: r.note ?? undefined, sourceDate },
        windowDays: minWindow(policy?.claimWindowDays, null),
      }
    })
  }

  private async discrepancyCandidates(
    tx: Db,
    claim: ClaimRow,
    policy: ReturnPolicyRow | null,
  ): Promise<Candidate[]> {
    const rows = await this.grns.openDiscrepancies(tx, {
      supplierId: claim.supplierId,
      from: claim.periodFrom,
      to: claim.periodTo,
      kinds: claim.kind === 'shortage' ? ['short', 'damaged'] : ['price_mismatch'],
      limit: SOURCE_READ_LIMIT,
    })
    return rows.map((d) => {
      const rate = d.ratePaise ?? 0
      const amount = d.amountPaise ?? multiply(paise(rate), d.qtyPcs)
      return {
        sourceType: 'inbound_discrepancy',
        sourceId: d.id,
        sourceDate: d.invoiceDate,
        schemeId: null,
        retailerId: null,
        variantId: d.variantId,
        lotId: d.lotId,
        batchNo: null,
        expiryDate: null,
        mrpPaise: null,
        qtyPcs: d.qtyPcs,
        caseSize: null,
        ratePaise: d.ratePaise,
        basis: 'invoice_rate',
        amountPaise: amount,
        detail: {
          invoiceNo: d.supplierInvoiceNo,
          ledgerRef: d.grnNo ?? d.grnId,
          note: d.note ?? undefined,
          sourceDate: d.invoiceDate,
          discrepancyKind: d.kind,
        },
        windowDays: minWindow(policy?.claimWindowDays, null),
      }
    })
  }

  /** Sources already carried by a non-rejected line of another claim (or of any claim when `claimId` is null). */
  private async claimedElsewhere(
    tx: Db,
    claimId: string | null,
    candidates: readonly Candidate[],
  ): Promise<Set<string>> {
    const { tenantId } = currentTenant()
    const out = new Set<string>()
    const byType = new Map<string, string[]>()
    for (const c of candidates) {
      const list = byType.get(c.sourceType) ?? []
      list.push(c.sourceId)
      byType.set(c.sourceType, list)
    }
    for (const [sourceType, ids] of byType) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const rows = await tx
          .select({ sourceId: claimLines.sourceId })
          .from(claimLines)
          .where(
            and(
              eq(claimLines.tenantId, tenantId),
              eq(claimLines.sourceType, sourceType),
              inArray(claimLines.sourceId, chunk),
              ne(claimLines.status, 'rejected'),
              claimId ? notInArray(claimLines.claimId, [claimId]) : sql`true`,
            ),
          )
        for (const r of rows) out.add(`${sourceType}:${r.sourceId}`)
      }
    }
    return out
  }
}
