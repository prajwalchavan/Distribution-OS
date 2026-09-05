/**
 * Claims demo data (docs/plans/claims.md §6): seven claims across the brands Tarsun claims from, in
 * every state the owner's and the accountant's screens show — a settled Campa scheme claim with its
 * credit note and a ready claim sheet, a submitted Balaji fortnight, a MOM Makhana claim paid in part,
 * a damage draft with photos, an expiry draft, a Reliance shortage from the gate count, and a Too Yumm
 * claim that settles inside FieldAssist and therefore never touches the journal.
 *
 * Sources are REAL rows the earlier seeds wrote (invoice lines with the Campa 12+1 rule, the damaged-bin
 * ledger rows, the gate-count shortage), read back here so `claims.build` on a draft finds exactly what
 * the lines already carry. Every id is `demoId(...)`, every insert `onConflictDoNothing`, and a claim's
 * children are written only when the claim row itself was inserted, so a second run adds nothing even
 * if the desk has since moved a claim on.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../client.js'
import {
  accounts,
  claimEvidence,
  claimLines,
  claimSettlements,
  claimStatements,
  claims,
  exportJobs,
  inboundDiscrepancies,
  journalEntries,
  journalLines,
  numberingSeries,
  retailers,
  returnPolicies,
  stockBalances,
  stockLedger,
  type AppliedRule,
} from '../schema/index.js'
import { brandId, type VariantRow } from './catalog.js'
import { insertMany } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { StockResult } from './stock.js'
import type { TenantCatalogResult } from './tenant-catalog.js'
import { atIstTime, daysAgo, FY, isoDate, TODAY } from './util.js'

const CAMPA_SCHEME_ID = demoId('scheme', 'campa-750-12-plus-1')
const BALAJI_SCHEME_ID = demoId('scheme', 'balaji-5pct-5-cases')
const MOM_SCHEME_ID = demoId('scheme', 'mom-makhana-slab')

/** The two MOM Makhana lots that expire in the demo: moved godown → damaged bin as `expiry_writeoff`. */
const EXPIRY_VARIANT_KEYS = ['mom-makhana-himalayan-salt-12g', 'mom-makhana-peri-peri-60g']
const EXPIRY_QTY_PCS = 12

interface InvoiceLineSource {
  lineId: string
  invoiceId: string
  invoiceNo: string | null
  invoiceDate: string
  retailerId: string
  variantId: string
  qtyPcs: number
  ratePaise: number
  taxablePaise: number
  appliedRules: AppliedRule[]
}

interface LineDraft {
  sourceType: 'invoice' | 'credit_note' | 'stock_ledger' | 'inbound_discrepancy' | 'manual'
  sourceId: string
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
  basis: 'ptd' | 'landed_cost' | 'mrp' | 'invoice_rate' | 'scheme_amount' | null
  amountPaise: number
  detail: Record<string, unknown>
}

interface ClaimSpec {
  key: string
  claimNo: string | null
  supplierId: string
  brandId: string | null
  kind: 'scheme' | 'damage' | 'expiry' | 'shortage' | 'rate_difference' | 'other'
  status:
    | 'draft'
    | 'submitted'
    | 'acknowledged'
    | 'partially_settled'
    | 'settled'
    | 'rejected'
    | 'written_off'
  claimChannel: 'dos' | 'brand_dms'
  periodFrom: string
  periodTo: string
  submittedAt: Date | null
  dueDate: string | null
  acknowledgedAt: Date | null
  settledAt: Date | null
  externalRef: string | null
  note: string | null
  lines: LineDraft[]
  settlements: {
    key: string
    settledOn: Date
    amountPaise: number
    mode: 'credit_note' | 'bank_receipt' | 'cheque' | 'goods_replacement' | 'adjustment'
    externalRef: string
    note?: string
  }[]
}

const lineStatusFor = (
  status: ClaimSpec['status'],
): 'open' | 'claimed' | 'settled' | 'rejected' | 'written_off' => {
  switch (status) {
    case 'draft':
      return 'open'
    case 'settled':
      return 'settled'
    case 'rejected':
      return 'rejected'
    case 'written_off':
      return 'written_off'
    default:
      return 'claimed'
  }
}

export async function seedClaims(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  tenantCatalog: TenantCatalogResult,
  stock: StockResult,
  people: PeopleResult,
): Promise<void> {
  const { supplierIds, costsByVariantId } = tenantCatalog
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const variantByKey = new Map(variants.map((v) => [v.key, v]))
  const ptdOf = (variantId: string): number =>
    costsByVariantId.get(variantId)?.purchaseRatePaise ?? 0

  await backfillClaimPolicies(db, tenantId, supplierIds)
  const expiryRows = await seedExpiryMovements(db, tenantId, variantByKey, stock, people)

  const accountRows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))
  const accountId = new Map(accountRows.map((a) => [a.code, a.id]))
  const acc = (code: string): string => {
    const id = accountId.get(code)
    if (!id) throw new Error(`chart of accounts missing ${code}; run bootstrapTenant first`)
    return id
  }

  const august = { from: '2026-08-01', to: '2026-08-31' }
  const fortnight = { from: isoDate(daysAgo(21)), to: isoDate(daysAgo(8)) }

  // --- the sources, read back from what the sales and stock seeds wrote ------------------------------
  const campaLines = await invoiceLinesFor(
    db,
    tenantId,
    brandId('campa'),
    august,
    15,
    CAMPA_SCHEME_ID,
  )
  const balajiLines = await invoiceLinesFor(db, tenantId, brandId('balaji'), fortnight, 8)
  const momLines = await invoiceLinesFor(db, tenantId, brandId('mommakhana'), august, 6)
  const tooYummLines = await invoiceLinesFor(db, tenantId, brandId('tooyumm'), august, 6)
  const balajiDamage = await ledgerRow(
    db,
    demoId('stock-ledger-damage-in', 'balaji-chataka-pataka-45g'),
  )
  const shortage = await discrepancyRow(db, tenantId, demoId('inbound-discrepancy', '1'))

  const schemeLine = (
    l: InvoiceLineSource,
    schemeId: string,
    schemeName: string,
    schemeRef: string,
    rule: AppliedRule,
    amountPaise: number,
    qtyPcs: number,
    basis: 'ptd' | 'scheme_amount',
    ratePaise: number | null,
    variantId: string,
  ): LineDraft => ({
    sourceType: 'invoice',
    sourceId: `${l.lineId}:${schemeId}`,
    schemeId,
    retailerId: l.retailerId,
    variantId,
    lotId: null,
    batchNo: null,
    expiryDate: null,
    mrpPaise: variantById.get(variantId)?.mrpPaise ?? null,
    qtyPcs,
    caseSize: variantById.get(variantId)?.defaultCaseSize ?? null,
    ratePaise,
    basis,
    amountPaise,
    detail: {
      invoiceNo: l.invoiceNo,
      ruleKind: 'scheme',
      rewardKind: rule.rewardKind,
      appliedRule: rule,
      schemeName,
      schemeRef,
      sourceDate: l.invoiceDate,
    },
  })

  // CLM-0001 — Campa 12+1: the free case of every August bill, claimed at PTD.
  const campaClaimLines = campaLines.map((l) => {
    const rule = l.appliedRules.find((r) => r.ruleId === CAMPA_SCHEME_ID) ?? {
      ruleId: CAMPA_SCHEME_ID,
      version: 1,
      kind: 'scheme' as const,
    }
    const variantId = rule.freeVariantId ?? l.variantId
    const qty = rule.freeQty ?? variantById.get(variantId)?.defaultCaseSize ?? 0
    const rate = ptdOf(variantId)
    return schemeLine(
      l,
      CAMPA_SCHEME_ID,
      'Campa 750 ml — 12+1 free',
      'Reliance circular RCP/2026/08/CAMPA-MON',
      rule,
      rate * qty,
      qty,
      'ptd',
      rate,
      variantId,
    )
  })
  // CLM-0002 — Balaji 5% on 5+ cases: the percentage given away on the fortnight's bills.
  const balajiClaimLines = balajiLines.map((l) => {
    const amount = Math.round((l.taxablePaise * 500) / 10_000)
    const rule: AppliedRule = {
      ruleId: BALAJI_SCHEME_ID,
      version: 1,
      kind: 'scheme',
      rewardKind: 'line_pct',
      amountPaise: amount,
    }
    return schemeLine(
      l,
      BALAJI_SCHEME_ID,
      'Balaji — 5% off on 5+ cases',
      'Balaji secondary scheme letter Aug-2026',
      rule,
      amount,
      l.qtyPcs,
      'scheme_amount',
      null,
      l.variantId,
    )
  })
  // CLM-0003 — MOM Makhana slab: 2% or 4% by the case count on the bill.
  const momClaimLines = momLines.map((l) => {
    const caseSize = variantById.get(l.variantId)?.defaultCaseSize ?? 1
    const bps = l.qtyPcs >= 10 * caseSize ? 400 : 200
    const amount = Math.round((l.taxablePaise * bps) / 10_000)
    const rule: AppliedRule = {
      ruleId: MOM_SCHEME_ID,
      version: 1,
      kind: 'scheme',
      rewardKind: 'line_pct',
      amountPaise: amount,
    }
    return schemeLine(
      l,
      MOM_SCHEME_ID,
      'MOM Makhana — slab scheme',
      'MOM Foods slab scheme Jul-2026',
      rule,
      amount,
      l.qtyPcs,
      'scheme_amount',
      null,
      l.variantId,
    )
  })
  // CLM-0007 — Too Yumm inside FieldAssist: the DMS's own scheme credit per bill, recorded only.
  const tooYummClaimLines = tooYummLines.map((l): LineDraft => {
    const amount = Math.round((l.taxablePaise * 300) / 10_000)
    return {
      sourceType: 'manual',
      sourceId: demoId('claim-line', `CLM-0007:${l.lineId}`),
      schemeId: null,
      retailerId: l.retailerId,
      variantId: l.variantId,
      lotId: null,
      batchNo: null,
      expiryDate: null,
      mrpPaise: variantById.get(l.variantId)?.mrpPaise ?? null,
      qtyPcs: l.qtyPcs,
      caseSize: variantById.get(l.variantId)?.defaultCaseSize ?? null,
      ratePaise: null,
      basis: 'scheme_amount',
      amountPaise: amount,
      detail: {
        invoiceNo: l.invoiceNo,
        note: 'FieldAssist scheme credit as per the DMS claim upload',
        sourceDate: l.invoiceDate,
      },
    }
  })
  const ledgerLine = (
    row: NonNullable<Awaited<ReturnType<typeof ledgerRow>>>,
    basis: 'ptd',
  ): LineDraft => {
    const rate = ptdOf(row.variantId)
    return {
      sourceType: 'stock_ledger',
      sourceId: row.id,
      schemeId: null,
      retailerId: null,
      variantId: row.variantId,
      lotId: row.lotId,
      batchNo: row.batchNo,
      expiryDate: row.expiryDate,
      mrpPaise: row.mrpPaise,
      qtyPcs: row.qtyDelta,
      caseSize: row.caseSize,
      ratePaise: rate,
      basis,
      amountPaise: rate * row.qtyDelta,
      detail: {
        ledgerRef: row.idempotencyKey,
        note: row.note,
        sourceDate: isoDate(row.occurredAt),
      },
    }
  }
  const damageClaimLines = balajiDamage ? [ledgerLine(balajiDamage, 'ptd')] : []
  const expiryClaimLines = expiryRows.map((r) => ledgerLine(r, 'ptd'))
  const shortageClaimLines: LineDraft[] = shortage
    ? [
        {
          sourceType: 'inbound_discrepancy',
          sourceId: shortage.id,
          schemeId: null,
          retailerId: null,
          variantId: shortage.variantId,
          lotId: shortage.lotId,
          batchNo: null,
          expiryDate: null,
          mrpPaise: null,
          qtyPcs: shortage.qtyPcs,
          caseSize: shortage.variantId
            ? (variantById.get(shortage.variantId)?.defaultCaseSize ?? null)
            : null,
          ratePaise:
            shortage.qtyPcs > 0 ? Math.round((shortage.amountPaise ?? 0) / shortage.qtyPcs) : null,
          basis: 'invoice_rate',
          amountPaise: shortage.amountPaise ?? 0,
          detail: {
            invoiceNo: shortage.invoiceNo,
            ledgerRef: shortage.grnNo,
            note: shortage.note,
            sourceDate: shortage.invoiceDate,
            discrepancyKind: shortage.kind,
          },
        },
      ]
    : []

  const total = (lines: LineDraft[]) => lines.reduce((s, l) => s + l.amountPaise, 0)
  const specs: ClaimSpec[] = [
    {
      key: 'CLM-0001',
      claimNo: 'CLM-0001',
      supplierId: supplierIds.reliance,
      brandId: brandId('campa'),
      kind: 'scheme',
      status: 'settled',
      claimChannel: 'dos',
      periodFrom: august.from,
      periodTo: august.to,
      submittedAt: atIstTime(daysAgo(30), 11, 0),
      dueDate: isoDate(daysAgo(0)),
      acknowledgedAt: atIstTime(daysAgo(24), 16, 0),
      settledAt: atIstTime(daysAgo(6), 12, 0),
      externalRef: 'RCP/CN/2026/0812',
      note: 'August 12+1 free goods on Campa 750 ml.',
      lines: campaClaimLines,
      settlements: [
        {
          key: 'CLM-0001:cn',
          settledOn: daysAgo(6),
          amountPaise: total(campaClaimLines),
          mode: 'credit_note',
          externalRef: 'RCP/CN/2026/0812',
          note: 'Reliance credit note against the August scheme claim.',
        },
      ],
    },
    {
      key: 'CLM-0002',
      claimNo: 'CLM-0002',
      supplierId: supplierIds.guruKripa,
      brandId: brandId('balaji'),
      kind: 'scheme',
      status: 'submitted',
      claimChannel: 'dos',
      periodFrom: fortnight.from,
      periodTo: fortnight.to,
      submittedAt: atIstTime(daysAgo(5), 10, 30),
      dueDate: isoDate(new Date(daysAgo(5).getTime() + 21 * 86_400_000)),
      acknowledgedAt: null,
      settledAt: null,
      externalRef: null,
      note: 'Fortnight secondary scheme, 5% on 5+ cases.',
      lines: balajiClaimLines,
      settlements: [],
    },
    {
      key: 'CLM-0003',
      claimNo: 'CLM-0003',
      supplierId: supplierIds.momMakhana,
      brandId: brandId('mommakhana'),
      kind: 'scheme',
      status: 'partially_settled',
      claimChannel: 'dos',
      periodFrom: august.from,
      periodTo: august.to,
      submittedAt: atIstTime(daysAgo(28), 11, 30),
      dueDate: isoDate(new Date(daysAgo(28).getTime() + 30 * 86_400_000)),
      acknowledgedAt: atIstTime(daysAgo(20), 15, 0),
      settledAt: null,
      externalRef: 'MOM/CLM/0826',
      note: 'Slab scheme, August. Balance promised with the next dispatch.',
      lines: momClaimLines,
      settlements: [
        {
          key: 'CLM-0003:neft',
          settledOn: daysAgo(9),
          amountPaise: Math.round(total(momClaimLines) * 0.6),
          mode: 'bank_receipt',
          externalRef: 'NEFT AXISN26240912345',
          note: 'NEFT from MOM Foods, 60% on account.',
        },
        {
          key: 'CLM-0003:adj',
          settledOn: daysAgo(3),
          amountPaise: Math.min(
            5_000,
            Math.max(1, total(momClaimLines) - Math.round(total(momClaimLines) * 0.6) - 1),
          ),
          mode: 'adjustment',
          externalRef: 'ADJ/SEP/01',
          note: 'Small rounding adjusted against the September supply bill.',
        },
      ],
    },
    {
      key: 'CLM-0004',
      claimNo: null,
      supplierId: supplierIds.guruKripa,
      brandId: brandId('balaji'),
      kind: 'damage',
      status: 'draft',
      claimChannel: 'dos',
      periodFrom: isoDate(daysAgo(30)),
      periodTo: isoDate(TODAY),
      submittedAt: null,
      dueDate: null,
      acknowledgedAt: null,
      settledAt: null,
      externalRef: null,
      note: 'Monsoon leak in the godown; cartons moved to the damaged bin.',
      lines: damageClaimLines,
      settlements: [],
    },
    {
      key: 'CLM-0005',
      claimNo: null,
      supplierId: supplierIds.momMakhana,
      brandId: brandId('mommakhana'),
      kind: 'expiry',
      status: 'draft',
      claimChannel: 'dos',
      periodFrom: isoDate(daysAgo(60)),
      periodTo: isoDate(TODAY),
      submittedAt: null,
      dueDate: null,
      acknowledgedAt: null,
      settledAt: null,
      externalRef: null,
      note: 'Oldest makhana lots past shelf life, written off to the damaged bin.',
      lines: expiryClaimLines,
      settlements: [],
    },
    {
      key: 'CLM-0006',
      claimNo: 'CLM-0006',
      supplierId: supplierIds.reliance,
      brandId: null,
      kind: 'shortage',
      status: 'submitted',
      claimChannel: 'dos',
      periodFrom: isoDate(daysAgo(30)),
      periodTo: isoDate(TODAY),
      submittedAt: atIstTime(daysAgo(2), 17, 0),
      dueDate: isoDate(new Date(daysAgo(2).getTime() + 30 * 86_400_000)),
      acknowledgedAt: null,
      settledAt: null,
      externalRef: null,
      note: 'One case of Campa Cola short against the depot invoice at the gate count.',
      lines: shortageClaimLines,
      settlements: [],
    },
    {
      key: 'CLM-0007',
      claimNo: 'CLM-0007',
      supplierId: supplierIds.guiltfree,
      brandId: brandId('tooyumm'),
      kind: 'scheme',
      status: 'submitted',
      claimChannel: 'brand_dms',
      periodFrom: august.from,
      periodTo: august.to,
      submittedAt: atIstTime(daysAgo(1), 12, 0),
      dueDate: isoDate(new Date(daysAgo(1).getTime() + 15 * 86_400_000)),
      acknowledgedAt: null,
      settledAt: null,
      externalRef: null,
      note: 'Settles inside FieldAssist; not on our books.',
      lines: tooYummClaimLines,
      settlements: [],
    },
  ]

  const entryRows: (typeof journalEntries.$inferInsert)[] = []
  const lineRows: (typeof journalLines.$inferInsert)[] = []
  /** One balanced entry, debit positive / credit negative, keyed exactly as the claims module keys it. */
  const post = (
    key: string,
    entryDate: Date,
    refType: string,
    refId: string,
    narration: string,
    postedBy: string,
    lines: { code: string; amountPaise: number; supplierId?: string; memo?: string | undefined }[],
  ): string => {
    const entryId = demoId('journal-entry', key)
    const sum = lines.reduce((s, l) => s + l.amountPaise, 0)
    if (sum !== 0) throw new Error(`seedClaims: entry ${key} does not balance (${sum} paise)`)
    entryRows.push({
      id: entryId,
      tenantId,
      entryDate: isoDate(entryDate),
      refType,
      refId,
      narration,
      idempotencyKey: key,
      postedBy,
      postedAt: entryDate,
    })
    lines.forEach((l, i) => {
      lineRows.push({
        id: demoId('journal-line', `${key}:${i}`),
        tenantId,
        entryId,
        accountId: acc(l.code),
        amountPaise: l.amountPaise,
        partyType: l.supplierId ? 'supplier' : null,
        partyId: l.supplierId ?? null,
        memo: l.memo ?? null,
      })
    })
    return entryId
  }

  for (const spec of specs) {
    if (spec.lines.length === 0) continue
    const claimId = demoId('claim', spec.key)
    const claimed = total(spec.lines)
    const settledTotal = spec.settlements.reduce((s, x) => s + x.amountPaise, 0)
    const inserted = await db
      .insert(claims)
      .values({
        id: claimId,
        tenantId,
        claimNo: spec.claimNo,
        supplierId: spec.supplierId,
        brandId: spec.brandId,
        kind: spec.kind,
        status: spec.status,
        claimChannel: spec.claimChannel,
        periodFrom: spec.periodFrom,
        periodTo: spec.periodTo,
        claimedPaise: claimed,
        settledPaise: settledTotal,
        writtenOffPaise: 0,
        externalRef: spec.externalRef,
        submittedAt: spec.submittedAt,
        dueDate: spec.dueDate,
        acknowledgedAt: spec.acknowledgedAt,
        settledAt: spec.settledAt,
        accruedAt: spec.claimChannel === 'dos' ? spec.submittedAt : null,
        createdBy: people.manager.id,
        submittedBy: spec.submittedAt ? people.manager.id : null,
        note: spec.note,
        createdAt: spec.submittedAt ?? atIstTime(daysAgo(1), 9, 0),
        updatedAt: spec.settledAt ?? spec.submittedAt ?? atIstTime(daysAgo(1), 9, 0),
      })
      .onConflictDoNothing()
      .returning({ id: claims.id })
    if (inserted.length === 0) continue

    // Lines: settlements spread over them in order, never past a line's own amount.
    let remaining = settledTotal
    const lineStatus = lineStatusFor(spec.status)
    await insertMany(
      db,
      claimLines,
      spec.lines.map((l, i) => {
        const settled = Math.min(l.amountPaise, remaining)
        remaining -= settled
        return {
          id: demoId('claim-line', `${spec.key}:${l.sourceType}:${l.sourceId}`),
          tenantId,
          claimId,
          lineNo: i + 1,
          status:
            lineStatus === 'claimed' && settled >= l.amountPaise && l.amountPaise > 0
              ? ('settled' as const)
              : lineStatus,
          schemeId: l.schemeId,
          sourceType: l.sourceType,
          sourceId: l.sourceId,
          retailerId: l.retailerId,
          variantId: l.variantId,
          lotId: l.lotId,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
          caseSize: l.caseSize,
          qtyPcs: l.qtyPcs,
          mrpPaise: l.mrpPaise,
          ratePaise: l.ratePaise,
          basis: l.basis,
          amountPaise: l.amountPaise,
          settledPaise: settled,
          detail: l.detail,
        }
      }),
    )

    if (spec.claimChannel === 'dos' && spec.submittedAt && claimed > 0) {
      const receivable =
        spec.kind === 'scheme' || spec.kind === 'rate_difference'
          ? 'SCHEME_RECEIVABLE'
          : 'CLAIMS_RECEIVABLE'
      const expense =
        spec.kind === 'scheme' || spec.kind === 'rate_difference' ? 'SCHEME_EXPENSE' : 'DAMAGES'
      post(
        `claim:accrue:${claimId}`,
        spec.submittedAt,
        'claim',
        claimId,
        `Claim ${spec.claimNo ?? ''} on ${spec.key === 'CLM-0006' ? 'Reliance' : 'the brand'} (${spec.kind}, ${spec.periodFrom} to ${spec.periodTo})`,
        people.manager.id,
        [
          {
            code: receivable,
            amountPaise: claimed,
            supplierId: spec.supplierId,
            memo: spec.claimNo ?? undefined,
          },
          { code: expense, amountPaise: -claimed, memo: spec.claimNo ?? undefined },
        ],
      )
      for (const s of spec.settlements) {
        const settlementId = demoId('claim-settlement', s.key)
        const debit = s.mode === 'bank_receipt' ? 'BANK' : s.mode === 'cheque' ? 'CHEQUES' : 'AP'
        const entryId = post(
          `claim:settle:${settlementId}`,
          s.settledOn,
          'claim_settlement',
          settlementId,
          `${spec.claimNo ?? ''} settled (${s.mode} ${s.externalRef})`,
          people.accountant.id,
          [
            {
              code: debit,
              amountPaise: s.amountPaise,
              supplierId: spec.supplierId,
              memo: s.externalRef,
            },
            {
              code: receivable,
              amountPaise: -s.amountPaise,
              supplierId: spec.supplierId,
              memo: spec.claimNo ?? undefined,
            },
          ],
        )
        await insertMany(db, claimSettlements, [
          {
            id: settlementId,
            tenantId,
            claimId,
            settledOn: isoDate(s.settledOn),
            amountPaise: s.amountPaise,
            mode: s.mode,
            externalRef: s.externalRef,
            journalEntryId: entryId,
            note: s.note ?? null,
            recordedBy: people.accountant.id,
            createdAt: atIstTime(s.settledOn, 16, 0),
            updatedAt: atIstTime(s.settledOn, 16, 0),
          },
        ])
      }
    }
  }
  await insertMany(db, journalEntries, entryRows)
  await insertMany(db, journalLines, lineRows)

  // The gate-count shortage CLM-0006 carries is now the brand's to answer.
  if (shortage) {
    await db
      .update(inboundDiscrepancies)
      .set({
        status: 'claimed',
        resolvedBy: people.manager.id,
        resolvedAt: atIstTime(daysAgo(2), 17, 0),
      })
      .where(and(eq(inboundDiscrepancies.id, shortage.id), eq(inboundDiscrepancies.status, 'open')))
  }

  // Evidence on the damage draft: two photos of the wet cartons, uploaded through files.uploadUrl.
  const damageClaimId = demoId('claim', 'CLM-0004')
  await insertMany(
    db,
    claimEvidence,
    [1, 2].map((n) => ({
      id: demoId('claim-evidence', `CLM-0004:${n}`),
      tenantId,
      claimId: damageClaimId,
      kind: 'damage_photo',
      objectKey: `tenant/${tenantId}/claims/${damageClaimId}/damage-${n}.jpg`,
      caption: n === 1 ? 'Wet cartons on the floor, aisle 3' : 'Batch label of the damaged carton',
      uploadedBy: people.manager.id,
      createdAt: atIstTime(daysAgo(4), 15, 30),
    })),
  )

  // Claim sheets: CLM-0001's is rendered (a succeeded export), CLM-0002's is still in the queue.
  await seedStatements(db, tenantId, specs, variantById, people)

  // The CLAIM series continues after the seven seeded numbers (never moved backwards).
  await db
    .insert(numberingSeries)
    .values({ tenantId, seriesCode: 'CLAIM', fy: FY, prefix: 'CLM-', nextNo: 8 })
    .onConflictDoUpdate({
      target: [numberingSeries.tenantId, numberingSeries.seriesCode, numberingSeries.fy],
      set: { nextNo: sql`greatest(${numberingSeries.nextNo}, 8)` },
    })
}

/**
 * The six `return_policies` rows the tenant-catalog seed wrote before claims existed gain the claim
 * cadence, settlement days and the claim supplier — only where nobody has configured them yet, so a
 * re-run never overwrites what the owner saved from `claims.policies.upsert`.
 */
async function backfillClaimPolicies(
  db: Db,
  tenantId: string,
  supplierIds: TenantCatalogResult['supplierIds'],
): Promise<void> {
  const fills: {
    brandKey: string
    claimSupplierId: string
    claimPeriodKind: 'monthly' | 'fortnightly'
    settlementDays: number
  }[] = [
    {
      brandKey: 'campa',
      claimSupplierId: supplierIds.reliance,
      claimPeriodKind: 'monthly',
      settlementDays: 30,
    },
    {
      brandKey: 'independence',
      claimSupplierId: supplierIds.reliance,
      claimPeriodKind: 'monthly',
      settlementDays: 30,
    },
    {
      brandKey: 'balaji',
      claimSupplierId: supplierIds.guruKripa,
      claimPeriodKind: 'fortnightly',
      settlementDays: 21,
    },
    {
      brandKey: 'mommakhana',
      claimSupplierId: supplierIds.momMakhana,
      claimPeriodKind: 'monthly',
      settlementDays: 30,
    },
    {
      brandKey: 'tooyumm',
      claimSupplierId: supplierIds.guiltfree,
      claimPeriodKind: 'monthly',
      settlementDays: 15,
    },
  ]
  for (const f of fills) {
    await db
      .update(returnPolicies)
      .set({
        claimSupplierId: f.claimSupplierId,
        claimPeriodKind: f.claimPeriodKind,
        claimCutoffDay: 1,
        settlementDays: f.settlementDays,
      })
      .where(
        and(
          eq(returnPolicies.tenantId, tenantId),
          eq(returnPolicies.brandId, brandId(f.brandKey)),
          sql`${returnPolicies.claimSupplierId} IS NULL`,
        ),
      )
  }
}

interface ExpiryRow {
  id: string
  lotId: string
  variantId: string
  batchNo: string
  expiryDate: string | null
  mrpPaise: number
  caseSize: number | null
  qtyDelta: number
  idempotencyKey: string
  note: string | null
  occurredAt: Date
}

/**
 * Two MOM Makhana lots past shelf life leave the godown for the damaged bin as `expiry_writeoff`
 * (the source of the expiry draft CLM-0005). The ledger rows are inserted once; the balances move only
 * when the rows were actually inserted, so a re-run leaves stock exactly where it is.
 */
async function seedExpiryMovements(
  db: Db,
  tenantId: string,
  variantByKey: Map<string, VariantRow>,
  stock: StockResult,
  people: PeopleResult,
): Promise<ExpiryRow[]> {
  const out: ExpiryRow[] = []
  for (const vk of EXPIRY_VARIANT_KEYS) {
    const v = variantByKey.get(vk)
    if (!v) continue
    const lots = stock.lotsByVariantId.get(v.id) ?? []
    const ref = lots[0]
    if (!ref) continue
    const lot = await lotRow(db, ref.id)
    if (!lot) continue
    const occurredAt = atIstTime(daysAgo(20), 11, 0)
    const inId = demoId('stock-ledger-expiry-in', vk)
    const note = 'Past shelf life on the monthly expiry check; written off to the damaged bin.'
    const inserted = await db
      .insert(stockLedger)
      .values([
        {
          id: demoId('stock-ledger-expiry-out', vk),
          tenantId,
          occurredAt,
          lotId: lot.id,
          locationId: stock.godownId,
          qtyDelta: -EXPIRY_QTY_PCS,
          reason: 'expiry_writeoff',
          refType: 'manual',
          refId: lot.id,
          actorId: people.manager.id,
          idempotencyKey: `expiry-out:${vk}`,
          note,
        },
        {
          id: inId,
          tenantId,
          occurredAt,
          lotId: lot.id,
          locationId: stock.damagedId,
          qtyDelta: EXPIRY_QTY_PCS,
          reason: 'expiry_writeoff',
          refType: 'manual',
          refId: lot.id,
          actorId: people.manager.id,
          idempotencyKey: `expiry-in:${vk}`,
          note,
        },
      ])
      .onConflictDoNothing()
      .returning({ id: stockLedger.id, locationId: stockLedger.locationId })
    for (const row of inserted) {
      const delta = row.locationId === stock.damagedId ? EXPIRY_QTY_PCS : -EXPIRY_QTY_PCS
      // UPDATE first (the godown row always exists; an insert of a negative on_hand would trip the
      // non-negative check before the conflict is even looked at), INSERT only a bin row that is new.
      const updated = await db
        .update(stockBalances)
        .set({ onHand: sql`${stockBalances.onHand} + ${delta}`, updatedAt: new Date() })
        .where(
          and(
            eq(stockBalances.tenantId, tenantId),
            eq(stockBalances.lotId, lot.id),
            eq(stockBalances.locationId, row.locationId),
          ),
        )
        .returning({ lotId: stockBalances.lotId })
      if (updated.length === 0 && delta > 0) {
        await db
          .insert(stockBalances)
          .values({
            tenantId,
            lotId: lot.id,
            locationId: row.locationId,
            onHand: delta,
            reserved: 0,
            negativeAllowed: row.locationId === stock.damagedId,
          })
          .onConflictDoNothing()
      }
    }
    out.push({
      id: inId,
      lotId: lot.id,
      variantId: v.id,
      batchNo: lot.batchNo,
      expiryDate: lot.expiryDate,
      mrpPaise: lot.mrpPaise,
      caseSize: lot.caseSize,
      qtyDelta: EXPIRY_QTY_PCS,
      idempotencyKey: `expiry-in:${vk}`,
      note,
      occurredAt,
    })
  }
  return out
}

async function invoiceLinesFor(
  db: Db,
  tenantId: string,
  brand: string,
  window: { from: string; to: string },
  limit: number,
  /** Only lines carrying this scheme in `applied_rules` (the Campa 12+1 bills). */
  ruleId?: string,
): Promise<InvoiceLineSource[]> {
  const ruleFilter = ruleId
    ? sql`AND il.applied_rules @> ${JSON.stringify([{ ruleId }])}::jsonb`
    : sql``
  const result = await db.execute(sql`
    SELECT il.id AS line_id, i.id AS invoice_id, i.invoice_no, i.invoice_date::text AS invoice_date,
           i.retailer_id, il.variant_id, il.qty_pcs, il.rate_paise, il.taxable_paise, il.applied_rules
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN product_variants v ON v.id = il.variant_id
      JOIN products p ON p.id = v.product_id
     WHERE i.tenant_id = ${tenantId}
       AND i.state NOT IN ('draft', 'cancelled')
       AND i.invoice_date BETWEEN ${window.from} AND ${window.to}
       AND p.brand_id = ${brand}
       ${ruleFilter}
     ORDER BY i.invoice_date ASC, i.id ASC, il.line_no ASC
     LIMIT ${limit}`)
  return result.rows.map((r) => ({
    lineId: String(r.line_id),
    invoiceId: String(r.invoice_id),
    invoiceNo: (r.invoice_no as string | null) ?? null,
    invoiceDate: String(r.invoice_date),
    retailerId: String(r.retailer_id),
    variantId: String(r.variant_id),
    qtyPcs: Number(r.qty_pcs),
    ratePaise: Number(r.rate_paise),
    taxablePaise: Number(r.taxable_paise),
    appliedRules: (r.applied_rules as AppliedRule[] | null) ?? [],
  }))
}

async function lotRow(
  db: Db,
  id: string,
): Promise<{
  id: string
  batchNo: string
  expiryDate: string | null
  mrpPaise: number
  caseSize: number | null
} | null> {
  const result = await db.execute(sql`
    SELECT id, batch_no, expiry_date::text AS expiry_date, mrp_paise, case_size FROM stock_lots WHERE id = ${id} LIMIT 1`)
  const r = result.rows[0]
  if (!r) return null
  return {
    id: String(r.id),
    batchNo: typeof r.batch_no === 'string' ? r.batch_no : '',
    expiryDate: (r.expiry_date as string | null) ?? null,
    mrpPaise: Number(r.mrp_paise),
    caseSize: r.case_size === null ? null : Number(r.case_size),
  }
}

async function ledgerRow(db: Db, id: string): Promise<ExpiryRow | null> {
  const result = await db.execute(sql`
    SELECT l.id, l.lot_id, s.variant_id, s.batch_no, s.expiry_date::text AS expiry_date, s.mrp_paise, s.case_size,
           l.qty_delta, l.idempotency_key, l.note, l.occurred_at
      FROM stock_ledger l JOIN stock_lots s ON s.id = l.lot_id
     WHERE l.id = ${id}
     LIMIT 1`)
  const r = result.rows[0]
  if (!r) return null
  return {
    id: String(r.id),
    lotId: String(r.lot_id),
    variantId: String(r.variant_id),
    batchNo: typeof r.batch_no === 'string' ? r.batch_no : '',
    expiryDate: (r.expiry_date as string | null) ?? null,
    mrpPaise: Number(r.mrp_paise),
    caseSize: r.case_size === null ? null : Number(r.case_size),
    qtyDelta: Number(r.qty_delta),
    idempotencyKey: String(r.idempotency_key),
    note: (r.note as string | null) ?? null,
    occurredAt: new Date(r.occurred_at as string | Date),
  }
}

async function discrepancyRow(
  db: Db,
  tenantId: string,
  id: string,
): Promise<{
  id: string
  kind: string
  qtyPcs: number
  amountPaise: number | null
  variantId: string | null
  lotId: string | null
  grnNo: string | null
  invoiceNo: string
  invoiceDate: string
  note: string | null
} | null> {
  const result = await db.execute(sql`
    SELECT d.id, d.kind::text AS kind, d.qty_pcs, d.amount_paise, gl.variant_id, gl.lot_id, g.grn_no,
           si.invoice_no, si.invoice_date::text AS invoice_date, d.note
      FROM inbound_discrepancies d
      JOIN grns g ON g.id = d.grn_id
      JOIN supplier_invoices si ON si.id = g.supplier_invoice_id
      LEFT JOIN grn_lines gl ON gl.id = d.grn_line_id
     WHERE d.tenant_id = ${tenantId} AND d.id = ${id}
     LIMIT 1`)
  const r = result.rows[0]
  if (!r) return null
  return {
    id: String(r.id),
    kind: String(r.kind),
    qtyPcs: Number(r.qty_pcs),
    amountPaise: r.amount_paise === null ? null : Number(r.amount_paise),
    variantId: (r.variant_id as string | null) ?? null,
    lotId: (r.lot_id as string | null) ?? null,
    grnNo: (r.grn_no as string | null) ?? null,
    invoiceNo: String(r.invoice_no),
    invoiceDate: String(r.invoice_date),
    note: (r.note as string | null) ?? null,
  }
}

/** CLM-0001's sheet is on disk as far as the row is concerned (a succeeded export); CLM-0002's waits for the worker. */
async function seedStatements(
  db: Db,
  tenantId: string,
  specs: ClaimSpec[],
  variantById: Map<string, VariantRow>,
  people: PeopleResult,
): Promise<void> {
  // The live `statements.generate` names the shop on every scheme line; the seeded snapshot must
  // too, or the demo's own claim sheet prints an empty "Party" column.
  const shopIds = [
    ...new Set(
      specs
        .filter((sp) => sp.key === 'CLM-0001' || sp.key === 'CLM-0002')
        .flatMap((sp) => sp.lines.map((l) => l.retailerId))
        .filter((id): id is string => id !== null),
    ),
  ]
  const shopById = new Map(
    shopIds.length === 0
      ? []
      : (
          await db
            .select({ id: retailers.id, code: retailers.code, name: retailers.name })
            .from(retailers)
            .where(and(eq(retailers.tenantId, tenantId), inArray(retailers.id, shopIds)))
        ).map((r) => [r.id, r] as const),
  )
  const snapshot = (spec: ClaimSpec, format: string, at: Date) => ({
    claimId: demoId('claim', spec.key),
    claimNo: spec.claimNo,
    kind: spec.kind,
    claimChannel: spec.claimChannel,
    periodFrom: spec.periodFrom,
    periodTo: spec.periodTo,
    format,
    supplier: {
      id: spec.supplierId,
      name: spec.key.startsWith('CLM-0001')
        ? 'Reliance Consumer Products — Kalyan Depot'
        : 'Guru Kripa Agencies (Balaji Super-Stockist)',
    },
    brand: spec.brandId
      ? { id: spec.brandId, name: spec.key === 'CLM-0001' ? 'Campa' : 'Balaji' }
      : null,
    rows: spec.lines.map((l, i) => ({
      lineNo: i + 1,
      sourceType: l.sourceType,
      status: lineStatusFor(spec.status),
      invoiceNo: (l.detail.invoiceNo as string | null) ?? null,
      creditNoteNo: null,
      sourceDate: (l.detail.sourceDate as string | null) ?? null,
      retailerName: l.retailerId ? (shopById.get(l.retailerId)?.name ?? null) : null,
      retailerCode: l.retailerId ? (shopById.get(l.retailerId)?.code ?? null) : null,
      variantName: l.variantId ? (variantById.get(l.variantId)?.name ?? null) : null,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      mrpPaise: l.mrpPaise,
      qtyPcs: l.qtyPcs,
      caseSize: l.caseSize,
      ratePaise: l.ratePaise,
      basis: l.basis,
      amountPaise: l.amountPaise,
      schemeName: (l.detail.schemeName as string | null) ?? null,
      schemeRef: (l.detail.schemeRef as string | null) ?? null,
      reason: null,
    })),
    totals: {
      lines: spec.lines.length,
      qtyPcs: spec.lines.reduce((s, l) => s + l.qtyPcs, 0),
      amountPaise: spec.lines.reduce((s, l) => s + l.amountPaise, 0),
    },
    snapshotAt: at.toISOString(),
  })
  const first = specs.find((s) => s.key === 'CLM-0001')
  const second = specs.find((s) => s.key === 'CLM-0002')
  if (first && first.lines.length > 0) {
    const statementId = demoId('claim-statement', 'CLM-0001')
    const exportId = demoId('export', 'claim-sheet-CLM-0001')
    const at = atIstTime(daysAgo(29), 10, 0)
    const key = `tenant/${tenantId}/exports/${exportId}/claim-sheet.xlsx`
    await insertMany(db, exportJobs, [
      {
        id: exportId,
        tenantId,
        kind: 'claim_sheet',
        params: { claimId: demoId('claim', 'CLM-0001'), statementId, format: 'reliance_xlsx' },
        status: 'succeeded',
        requestedBy: people.manager.id,
        objectKey: key,
        rowCount: first.lines.length,
        startedAt: at,
        finishedAt: new Date(at.getTime() + 2_000),
        createdAt: at,
        updatedAt: at,
      },
    ])
    await insertMany(db, claimStatements, [
      {
        id: statementId,
        tenantId,
        claimId: demoId('claim', 'CLM-0001'),
        format: 'reliance_xlsx',
        objectKey: key,
        exportJobId: exportId,
        rowCount: first.lines.length,
        generatedAt: new Date(at.getTime() + 2_000),
        payload: snapshot(first, 'reliance_xlsx', at),
      },
    ])
  }
  if (second && second.lines.length > 0) {
    const statementId = demoId('claim-statement', 'CLM-0002')
    const exportId = demoId('export', 'claim-sheet-CLM-0002')
    const at = atIstTime(daysAgo(5), 10, 45)
    await insertMany(db, exportJobs, [
      {
        id: exportId,
        tenantId,
        kind: 'claim_sheet',
        params: { claimId: demoId('claim', 'CLM-0002'), statementId, format: 'guru_kripa_xlsx' },
        status: 'queued',
        requestedBy: people.manager.id,
        createdAt: at,
        updatedAt: at,
      },
    ])
    await insertMany(db, claimStatements, [
      {
        id: statementId,
        tenantId,
        claimId: demoId('claim', 'CLM-0002'),
        format: 'guru_kripa_xlsx',
        objectKey: null,
        exportJobId: exportId,
        rowCount: null,
        generatedAt: null,
        payload: snapshot(second, 'guru_kripa_xlsx', at),
      },
    ])
  }
}
