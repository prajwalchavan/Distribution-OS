import { Inject, Injectable, Optional } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  GstSummaryInput,
  GstSummaryOutput,
  GstSummaryRow,
  GstSummaryTotals,
  SalesRegisterInput,
  SalesRegisterOutput,
  SalesRegisterRow,
} from '@dos/contracts'
import { withTenant, type AppliedRule, type Db } from '@dos/db'
import { BACK_OFFICE, currentTenant, DB, requireDb, requireRole } from '../../platform/index.js'

/**
 * The registers: GSTR-1-shaped tax summaries and the invoice-wise sales register.
 *
 * THE GST ARITHMETIC EXISTS EXACTLY ONCE, HERE. Reporting (slice 9) wraps `gstSummary` and
 * `salesRegister` for the owner's screens, integrations (slice 6) builds the Tally sales voucher from
 * `salesRegister`, and claims (slice 7) reads `invoiceLinesForPeriod` / `creditNoteLinesForPeriod` /
 * `schemeSpend` — none of them re-derive a rupee, so a voucher and a register can never disagree
 * (docs/plans/00-coordination.md §4).
 *
 * Every method is ONE grouped query over an IST date window with a bounded page (docs/20 rule 1): a
 * register never loads a tenant's history, and nothing here loops per invoice.
 *
 * A DRAFT invoice was never issued and a CANCELLED one was reversed, so neither contributes money.
 * A cancelled bill still appears in the sales register, with its number and zero money, because
 * GSTR-1 Table 13 wants the series to read consecutive.
 */

type GstIn = z.infer<typeof GstSummaryInput>
type GstOut = z.infer<typeof GstSummaryOutput>
type RegisterIn = z.infer<typeof SalesRegisterInput>
type RegisterOut = z.infer<typeof SalesRegisterOutput>

/** Raw aggregate rows come back as strings from `bigint`/`numeric`; every number crosses here once. */
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

interface RawSummaryRow {
  hsn_code: string | null
  gst_bps: number | string
  cess_bps: number | string
  qty_pcs: string | number
  free_qty_pcs: string | number
  taxable_paise: string | number
  cgst_paise: string | number
  sgst_paise: string | number
  igst_paise: string | number
  cess_paise: string | number
  total_paise: string | number
  document_count: string | number
}

/** One invoice line inside a window — the claim source (`applied_rules`) and the scheme spend base. */
export interface InvoiceLineForPeriod {
  invoiceId: string
  invoiceNo: string | null
  invoiceDate: string
  retailerId: string
  lineId: string
  variantId: string
  hsnCode: string
  qtyPcs: number
  freeQtyPcs: number
  ratePaise: number
  discountPaise: number
  taxablePaise: number
  appliedRules: AppliedRule[]
}

export interface CreditNoteLineForPeriod {
  creditNoteId: string
  creditNoteNo: string | null
  noteDate: string
  reason: string
  invoiceId: string
  retailerId: string
  lineId: string
  invoiceLineId: string
  variantId: string
  qtyPcs: number
  saleable: boolean
  ratePaise: number
  taxablePaise: number
}

/** What a price rule cost the distributor in a window, by rule — the claim accrual base. */
export interface SchemeSpendRow {
  ruleId: string
  kind: string
  documentCount: number
  freeQtyPcs: number
  amountPaise: number
}

export interface PeriodFilter {
  from: string
  to: string
  retailerId?: string | undefined
  variantId?: string | undefined
  limit?: number | undefined
}

@Injectable()
export class RegistersService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // =============================================================================================================
  // procedures
  // =============================================================================================================

  async gstSummary(input: GstIn): Promise<GstOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const rows = await this.invoiceSummary(tx, input)
      const creditNoteRows = await this.creditNoteSummary(tx, input)
      return {
        from: input.from,
        to: input.to,
        supplyType: input.supplyType ?? null,
        groupBy: input.groupBy,
        rows,
        totals: totalsOf(rows),
        creditNoteRows,
        creditNoteTotals: totalsOf(creditNoteRows),
      }
    })
  }

  async salesRegister(input: RegisterIn): Promise<RegisterOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const { tenantId } = currentTenant()
    return withTenant(db, currentTenant(), async (tx) => {
      const issuedOnly = input.issuedOnly === true
      const page = await tx.execute(sql`
        SELECT i.id, i.invoice_no, i.external_invoice_no, i.invoice_date, i.order_id, i.retailer_id,
               i.buyer_name, i.buyer_gstin, i.supply_type, i.place_of_supply_state, i.is_inter_state,
               i.state, i.source, i.taxable_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
               i.cess_paise, i.round_off_paise, i.total_paise, r.tally_ledger_name
          FROM invoices i
          JOIN retailers r ON r.id = i.retailer_id
         WHERE i.tenant_id = ${tenantId}
           AND i.state <> 'draft'
           AND (${issuedOnly} = false OR i.state <> 'cancelled')
           AND i.invoice_date BETWEEN ${input.from} AND ${input.to}
           AND (${input.retailerId ?? null}::text IS NULL OR i.retailer_id = ${input.retailerId ?? null})
           AND (${input.source ?? null}::text IS NULL OR i.source::text = ${input.source ?? null})
           AND (${input.cursor ?? null}::text IS NULL OR i.id > ${input.cursor ?? null})
         ORDER BY i.id ASC
         LIMIT ${input.limit + 1}`)
      const raw: Record<string, unknown>[] = page.rows
      const items: SalesRegisterRow[] = raw.slice(0, input.limit).map((row) => {
        // A cancelled bill keeps its number and shows zero money: the series must read consecutive.
        const cancelled = row.state === 'cancelled'
        const money = (key: string): number => (cancelled ? 0 : n(row[key]))
        return {
          id: String(row.id),
          invoiceNo: (row.invoice_no as string | null) ?? null,
          externalInvoiceNo: (row.external_invoice_no as string | null) ?? null,
          invoiceDate: String(row.invoice_date),
          orderId: (row.order_id as string | null) ?? null,
          retailerId: String(row.retailer_id),
          buyerName: String(row.buyer_name),
          buyerGstin: (row.buyer_gstin as string | null) ?? null,
          supplyType: row.supply_type as SalesRegisterRow['supplyType'],
          placeOfSupplyState: String(row.place_of_supply_state),
          isInterState: Boolean(row.is_inter_state),
          taxablePaise: money('taxable_paise'),
          cgstPaise: money('cgst_paise'),
          sgstPaise: money('sgst_paise'),
          igstPaise: money('igst_paise'),
          cessPaise: money('cess_paise'),
          roundOffPaise: money('round_off_paise'),
          totalPaise: money('total_paise'),
          state: row.state as SalesRegisterRow['state'],
          source: row.source as SalesRegisterRow['source'],
          tallyLedgerName: (row.tally_ledger_name as string | null) ?? null,
        }
      })
      // The totals cover the WHOLE window, not the page: a register footer that changed with the page
      // would be a lie, and paging through a filing document is normal.
      const totalRows = await tx.execute(sql`
        SELECT COALESCE(SUM(i.taxable_paise), 0)::bigint AS taxable_paise,
               COALESCE(SUM(i.cgst_paise), 0)::bigint    AS cgst_paise,
               COALESCE(SUM(i.sgst_paise), 0)::bigint    AS sgst_paise,
               COALESCE(SUM(i.igst_paise), 0)::bigint    AS igst_paise,
               COALESCE(SUM(i.cess_paise), 0)::bigint    AS cess_paise,
               COALESCE(SUM(i.total_paise), 0)::bigint   AS total_paise,
               COUNT(*)::int                             AS invoice_count
          FROM invoices i
         WHERE i.tenant_id = ${tenantId}
           AND i.state NOT IN ('draft', 'cancelled')
           AND i.invoice_date BETWEEN ${input.from} AND ${input.to}
           AND (${input.retailerId ?? null}::text IS NULL OR i.retailer_id = ${input.retailerId ?? null})
           AND (${input.source ?? null}::text IS NULL OR i.source::text = ${input.source ?? null})`)
      const t: Record<string, unknown> = totalRows.rows[0] ?? {}
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: raw.length > input.limit && last ? last.id : null,
        totals: {
          taxablePaise: n(t.taxable_paise),
          cgstPaise: n(t.cgst_paise),
          sgstPaise: n(t.sgst_paise),
          igstPaise: n(t.igst_paise),
          cessPaise: n(t.cess_paise),
          totalPaise: n(t.total_paise),
          invoiceCount: n(t.invoice_count),
        },
      }
    })
  }

  // =============================================================================================================
  // the in-process surface reporting (9) and claims (7) consume — no HTTP face
  // =============================================================================================================

  /** Invoice lines inside a window, with `applied_rules` — the source a scheme/damage claim is built from. */
  async invoiceLinesForPeriod(tx: Db, filter: PeriodFilter): Promise<InvoiceLineForPeriod[]> {
    const { tenantId } = currentTenant()
    const limit = Math.min(filter.limit ?? 5000, 20_000)
    const result = await tx.execute(sql`
      SELECT i.id AS invoice_id, i.invoice_no, i.invoice_date, i.retailer_id,
             l.id AS line_id, l.variant_id, l.hsn_code, l.qty_pcs, l.free_qty_pcs,
             l.rate_paise, l.discount_paise, l.taxable_paise, l.applied_rules
        FROM invoice_lines l
        JOIN invoices i ON i.id = l.invoice_id
       WHERE l.tenant_id = ${tenantId}
         AND i.state NOT IN ('draft', 'cancelled')
         AND i.invoice_date BETWEEN ${filter.from} AND ${filter.to}
         AND (${filter.retailerId ?? null}::text IS NULL OR i.retailer_id = ${filter.retailerId ?? null})
         AND (${filter.variantId ?? null}::text IS NULL OR l.variant_id = ${filter.variantId ?? null})
       ORDER BY i.invoice_date ASC, i.id ASC, l.line_no ASC
       LIMIT ${limit}`)
    return result.rows.map((row: Record<string, unknown>) => ({
      invoiceId: String(row.invoice_id),
      invoiceNo: (row.invoice_no as string | null) ?? null,
      invoiceDate: String(row.invoice_date),
      retailerId: String(row.retailer_id),
      lineId: String(row.line_id),
      variantId: String(row.variant_id),
      hsnCode: String(row.hsn_code),
      qtyPcs: n(row.qty_pcs),
      freeQtyPcs: n(row.free_qty_pcs),
      ratePaise: n(row.rate_paise),
      discountPaise: n(row.discount_paise),
      taxablePaise: n(row.taxable_paise),
      appliedRules: (row.applied_rules as AppliedRule[] | null) ?? [],
    }))
  }

  /** Credit-note lines inside a window: what a claim must NOT count twice. */
  async creditNoteLinesForPeriod(tx: Db, filter: PeriodFilter): Promise<CreditNoteLineForPeriod[]> {
    const { tenantId } = currentTenant()
    const limit = Math.min(filter.limit ?? 5000, 20_000)
    const result = await tx.execute(sql`
      SELECT c.id AS credit_note_id, c.credit_note_no, c.note_date, c.reason::text AS reason,
             c.invoice_id, c.retailer_id, cl.id AS line_id, cl.invoice_line_id, il.variant_id,
             cl.qty_pcs, cl.saleable, cl.rate_paise, cl.taxable_paise
        FROM credit_note_lines cl
        JOIN credit_notes c ON c.id = cl.credit_note_id
        JOIN invoice_lines il ON il.id = cl.invoice_line_id
       WHERE cl.tenant_id = ${tenantId}
         AND c.state IN ('issued', 'applied')
         AND c.note_date BETWEEN ${filter.from} AND ${filter.to}
         AND (${filter.retailerId ?? null}::text IS NULL OR c.retailer_id = ${filter.retailerId ?? null})
         AND (${filter.variantId ?? null}::text IS NULL OR il.variant_id = ${filter.variantId ?? null})
       ORDER BY c.note_date ASC, c.id ASC, cl.id ASC
       LIMIT ${limit}`)
    return result.rows.map((row: Record<string, unknown>) => ({
      creditNoteId: String(row.credit_note_id),
      creditNoteNo: (row.credit_note_no as string | null) ?? null,
      noteDate: String(row.note_date),
      reason: String(row.reason),
      invoiceId: String(row.invoice_id),
      retailerId: String(row.retailer_id),
      lineId: String(row.line_id),
      invoiceLineId: String(row.invoice_line_id),
      variantId: String(row.variant_id),
      qtyPcs: n(row.qty_pcs),
      saleable: Boolean(row.saleable),
      ratePaise: n(row.rate_paise),
      taxablePaise: n(row.taxable_paise),
    }))
  }

  /**
   * What each price rule cost in a window, straight out of `invoice_lines.applied_rules` — the same
   * jsonb the engine wrote, so "what did this scheme cost me" and "what may I claim from the brand"
   * are the same arithmetic. Free pieces and rupee rewards are reported separately because a brand
   * settles them differently.
   */
  async schemeSpend(tx: Db, filter: PeriodFilter): Promise<SchemeSpendRow[]> {
    const { tenantId } = currentTenant()
    const result = await tx.execute(sql`
      SELECT rule ->> 'ruleId'                                        AS rule_id,
             COALESCE(rule ->> 'kind', 'scheme')                      AS kind,
             COUNT(DISTINCT l.invoice_id)::int                        AS document_count,
             COALESCE(SUM(COALESCE((rule ->> 'freeQty')::int, 0)), 0)::bigint     AS free_qty_pcs,
             COALESCE(SUM(COALESCE((rule ->> 'amountPaise')::bigint, 0)), 0)::bigint AS amount_paise
        FROM invoice_lines l
        JOIN invoices i ON i.id = l.invoice_id
        CROSS JOIN LATERAL jsonb_array_elements(l.applied_rules) AS rule
       WHERE l.tenant_id = ${tenantId}
         AND i.state NOT IN ('draft', 'cancelled')
         AND i.invoice_date BETWEEN ${filter.from} AND ${filter.to}
         AND rule ->> 'ruleId' IS NOT NULL
       GROUP BY 1, 2
       ORDER BY amount_paise DESC, rule_id ASC`)
    return result.rows.map((row: Record<string, unknown>) => ({
      ruleId: String(row.rule_id),
      kind: String(row.kind),
      documentCount: n(row.document_count),
      freeQtyPcs: n(row.free_qty_pcs),
      amountPaise: n(row.amount_paise),
    }))
  }

  // =============================================================================================================
  // internals
  // =============================================================================================================

  /**
   * The outward-supply half of GSTR-1. Free pieces count in QUANTITY but not in value: a free case is a
   * composite supply whose consideration is already inside the paid lines (docs/17 B).
   */
  private async invoiceSummary(tx: Db, input: GstIn): Promise<GstSummaryRow[]> {
    const { tenantId } = currentTenant()
    const byHsn = input.groupBy === 'hsn'
    const result = await tx.execute(sql`
      SELECT ${byHsn ? sql`l.hsn_code` : sql`NULL::text`}  AS hsn_code,
             l.gst_bps, l.cess_bps,
             COALESCE(SUM(l.qty_pcs), 0)::bigint          AS qty_pcs,
             COALESCE(SUM(l.free_qty_pcs), 0)::bigint     AS free_qty_pcs,
             COALESCE(SUM(l.taxable_paise), 0)::bigint    AS taxable_paise,
             COALESCE(SUM(l.cgst_paise), 0)::bigint       AS cgst_paise,
             COALESCE(SUM(l.sgst_paise), 0)::bigint       AS sgst_paise,
             COALESCE(SUM(l.igst_paise), 0)::bigint       AS igst_paise,
             COALESCE(SUM(l.cess_paise), 0)::bigint       AS cess_paise,
             COALESCE(SUM(l.line_total_paise), 0)::bigint AS total_paise,
             COUNT(DISTINCT l.invoice_id)::int            AS document_count
        FROM invoice_lines l
        JOIN invoices i ON i.id = l.invoice_id
       WHERE l.tenant_id = ${tenantId}
         AND i.state NOT IN ('draft', 'cancelled')
         AND i.invoice_date BETWEEN ${input.from} AND ${input.to}
         AND (${input.supplyType ?? null}::text IS NULL OR i.supply_type::text = ${input.supplyType ?? null})
       GROUP BY 1, 2, 3
       ORDER BY 1 NULLS FIRST, 2, 3`)
    return (result.rows as unknown as RawSummaryRow[]).map(toSummaryRow)
  }

  /**
   * Credit notes are reported SEPARATELY, as their own positive rows: GSTR-1 has its own table for them
   * and the filer subtracts, not us. The intra/inter split is recomputed from the note's own invoice
   * because `credit_note_lines` stores one combined tax figure; `round(x/2)` mirrors `percentOf(taxable,
   * bps/2)` exactly for every rate in use (every GST rate is an even number of basis points).
   */
  private async creditNoteSummary(tx: Db, input: GstIn): Promise<GstSummaryRow[]> {
    const { tenantId } = currentTenant()
    const byHsn = input.groupBy === 'hsn'
    const result = await tx.execute(sql`
      SELECT ${byHsn ? sql`il.hsn_code` : sql`NULL::text`} AS hsn_code,
             cl.gst_bps, il.cess_bps,
             COALESCE(SUM(cl.qty_pcs), 0)::bigint       AS qty_pcs,
             0::bigint                                  AS free_qty_pcs,
             COALESCE(SUM(cl.taxable_paise), 0)::bigint AS taxable_paise,
             COALESCE(SUM(CASE WHEN i.is_inter_state THEN 0
                               ELSE round(cl.taxable_paise::numeric * cl.gst_bps / 20000) END), 0)::bigint AS cgst_paise,
             COALESCE(SUM(CASE WHEN i.is_inter_state THEN 0
                               ELSE round(cl.taxable_paise::numeric * cl.gst_bps / 20000) END), 0)::bigint AS sgst_paise,
             COALESCE(SUM(CASE WHEN i.is_inter_state
                               THEN round(cl.taxable_paise::numeric * cl.gst_bps / 10000)
                               ELSE 0 END), 0)::bigint AS igst_paise,
             COALESCE(SUM(round(cl.taxable_paise::numeric * il.cess_bps / 10000)), 0)::bigint AS cess_paise,
             COALESCE(SUM(cl.line_total_paise), 0)::bigint AS total_paise,
             COUNT(DISTINCT cl.credit_note_id)::int     AS document_count
        FROM credit_note_lines cl
        JOIN credit_notes c ON c.id = cl.credit_note_id
        JOIN invoices i ON i.id = c.invoice_id
        JOIN invoice_lines il ON il.id = cl.invoice_line_id
       WHERE cl.tenant_id = ${tenantId}
         AND c.state IN ('issued', 'applied')
         AND c.note_date BETWEEN ${input.from} AND ${input.to}
         AND (${input.supplyType ?? null}::text IS NULL OR i.supply_type::text = ${input.supplyType ?? null})
       GROUP BY 1, 2, 3
       ORDER BY 1 NULLS FIRST, 2, 3`)
    return (result.rows as unknown as RawSummaryRow[]).map(toSummaryRow)
  }
}

function toSummaryRow(row: RawSummaryRow): GstSummaryRow {
  return {
    hsnCode: row.hsn_code,
    gstBps: n(row.gst_bps),
    cessBps: n(row.cess_bps),
    qtyPcs: n(row.qty_pcs),
    freeQtyPcs: n(row.free_qty_pcs),
    taxablePaise: n(row.taxable_paise),
    cgstPaise: n(row.cgst_paise),
    sgstPaise: n(row.sgst_paise),
    igstPaise: n(row.igst_paise),
    cessPaise: n(row.cess_paise),
    totalPaise: n(row.total_paise),
    documentCount: n(row.document_count),
  }
}

/** `documentCount` is a MAXIMUM, not a sum: one bill contributes to several HSN rows. */
function totalsOf(rows: readonly GstSummaryRow[]): GstSummaryTotals {
  const add = (pick: (r: GstSummaryRow) => number): number => rows.reduce((s, r) => s + pick(r), 0)
  return {
    qtyPcs: add((r) => r.qtyPcs),
    freeQtyPcs: add((r) => r.freeQtyPcs),
    taxablePaise: add((r) => r.taxablePaise),
    cgstPaise: add((r) => r.cgstPaise),
    sgstPaise: add((r) => r.sgstPaise),
    igstPaise: add((r) => r.igstPaise),
    cessPaise: add((r) => r.cessPaise),
    totalPaise: add((r) => r.totalPaise),
    documentCount: rows.reduce((m, r) => Math.max(m, r.documentCount), 0),
  }
}
