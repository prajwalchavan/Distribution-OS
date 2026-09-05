import { and, eq } from 'drizzle-orm'
import { CLAIM_SHEET_EXPORT_KIND } from '@dos/contracts'
import { claimStatements, type Db } from '@dos/db'
import { objectKey } from '../../platform/object-storage.js'
import {
  exportFileName,
  registerExportRenderer,
  writeXlsx,
  type ExportRenderContext,
  type RenderedExport,
  type XlsxCell,
} from '../integrations/index.js'
import { retailerLabels } from '../retailers/index.js'
import { sellerBranding } from '../tenancy/index.js'
import { variantLabels } from '../tenant-catalog/index.js'
import { detailOf, type ClaimLineRow, type ClaimRow } from './claims.internals.js'
import { claimSheetFormat, type ClaimSheetPayload, type ClaimSheetRow } from './formats.js'

/**
 * The claim sheet: snapshotted on the request path (`claim_statements.payload`), rendered by the ONE
 * `exports.render` queue under the kind `claim_sheet` (coordination §3.5), never inline in a handler
 * (docs/20 rule 3). Plain functions: the pg-boss worker registers the renderer through
 * `@dos/core/claims` with no Nest DI (coordination §3.9), the API registers it in
 * `ClaimsModule.onModuleInit` — the registry is per process.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLSX_EXT = 'xlsx'
/** A sheet carries at most this many lines; the build caps a claim at 2 000 anyway. */
const MAX_SHEET_ROWS = 5_000

/**
 * What the sheet will print, frozen now: the non-rejected lines with the shop and product NAMES
 * resolved (a brand's clerk reads names, not ids), the source document numbers the build recorded
 * in `detail`, and the totals. Integer paise throughout; the renderer prints rupees.
 */
export async function snapshotClaimSheet(
  tx: Db,
  claim: ClaimRow,
  lines: readonly ClaimLineRow[],
  names: { supplierName: string; brandName: string | null },
  format: string,
  now: Date,
): Promise<ClaimSheetPayload> {
  const live = lines.filter((l) => l.status !== 'rejected').slice(0, MAX_SHEET_ROWS)
  const variantNames = await variantLabels(
    tx,
    live.map((l) => l.variantId).filter((v): v is string => v !== null),
  )
  const shops = await retailerLabels(
    tx,
    live.map((l) => l.retailerId).filter((r): r is string => r !== null),
  )
  const rows: ClaimSheetRow[] = live.map((l) => {
    const d = detailOf(l)
    const shop = l.retailerId ? shops.get(l.retailerId) : undefined
    return {
      lineNo: l.lineNo,
      sourceType: l.sourceType,
      status: l.status,
      invoiceNo: typeof d.invoiceNo === 'string' ? d.invoiceNo : null,
      creditNoteNo: typeof d.creditNoteNo === 'string' ? d.creditNoteNo : null,
      sourceDate: typeof d.sourceDate === 'string' ? d.sourceDate : null,
      retailerName: shop?.name ?? null,
      retailerCode: shop ? (shop.label.split(' ')[0] ?? null) : null,
      variantName: l.variantId ? (variantNames.get(l.variantId) ?? null) : null,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      mrpPaise: l.mrpPaise,
      qtyPcs: l.qtyPcs,
      caseSize: l.caseSize,
      ratePaise: l.ratePaise,
      basis: l.basis,
      amountPaise: l.amountPaise,
      schemeName: typeof d.schemeName === 'string' ? d.schemeName : null,
      schemeRef: typeof d.schemeRef === 'string' ? d.schemeRef : null,
      reason: typeof d.reason === 'string' ? d.reason : null,
    }
  })
  return {
    claimId: claim.id,
    claimNo: claim.claimNo,
    kind: claim.kind,
    claimChannel: claim.claimChannel,
    periodFrom: claim.periodFrom,
    periodTo: claim.periodTo,
    format,
    supplier: { id: claim.supplierId, name: names.supplierName },
    brand: claim.brandId ? { id: claim.brandId, name: names.brandName ?? '' } : null,
    rows,
    totals: {
      lines: rows.length,
      qtyPcs: rows.reduce((s, r) => s + r.qtyPcs, 0),
      amountPaise: rows.reduce((s, r) => s + r.amountPaise, 0),
    },
    snapshotAt: now.toISOString(),
  }
}

/** The key `renderExportJob` will store the file under — derived the same way, so the statement can name it before the bytes land. */
export function claimSheetObjectKey(
  tenantId: string,
  exportJobId: string,
  params: Record<string, unknown>,
): string {
  const fileName = exportFileName(CLAIM_SHEET_EXPORT_KIND, params)
  return objectKey({
    tenantId,
    domain: 'exports',
    entityId: exportJobId,
    name: fileName.replace(/\.[^.]+$/, ''),
    ext: XLSX_EXT,
  })
}

/**
 * THE `claim_sheet` RENDERER. Reads the statement's snapshot (never the live lines: the sheet is the
 * claim as submitted), prints it in the brand's column set under the DISTRIBUTOR'S OWN name
 * (`tenant_settings` branding — never "Distribution OS", docs/17 §D6), and fills
 * `claim_statements.object_key / row_count / generated_at` so `statements.list` answers `ready`.
 * Idempotent: a re-render writes the same key and the same row count.
 */
export async function renderClaimSheet(rc: ExportRenderContext): Promise<RenderedExport> {
  const statementId = typeof rc.params.statementId === 'string' ? rc.params.statementId : null
  const claimId = typeof rc.params.claimId === 'string' ? rc.params.claimId : null
  if (!statementId || !claimId)
    throw new Error('a claim_sheet export names its claimId and statementId in params')
  const key = claimSheetObjectKey(rc.ctx.tenantId, rc.exportJobId, rc.params)
  return rc.run(async (tx) => {
    const [statement] = await tx
      .select()
      .from(claimStatements)
      .where(
        and(
          eq(claimStatements.tenantId, rc.ctx.tenantId),
          eq(claimStatements.id, statementId),
          eq(claimStatements.claimId, claimId),
        ),
      )
      .limit(1)
    if (!statement) throw new Error(`claim statement ${statementId} not found`)
    const payload = statement.payload as ClaimSheetPayload
    const seller = await sellerBranding(tx)
    const format = claimSheetFormat(payload.format ?? statement.format)
    const rows = (payload.rows ?? []).map((r) => format.row(r))
    const summary: XlsxCell[][] = [
      ['Claimed by', seller.displayName],
      ['GSTIN', seller.gstin ?? ''],
      ['Claim no', payload.claimNo ?? '(draft)'],
      ['Kind', payload.kind],
      ['Supplier', payload.supplier.name],
      ['Brand', payload.brand?.name ?? ''],
      ['Period', `${payload.periodFrom} to ${payload.periodTo}`],
      ['Lines', payload.totals.lines],
      ['Pieces', payload.totals.qtyPcs],
      ['Claim amount (Rs)', Math.round(payload.totals.amountPaise) / 100],
      ['Prepared on', payload.snapshotAt.slice(0, 10)],
    ]
    const body = writeXlsx([
      { name: format.sheetName, header: format.header, rows },
      { name: 'Summary', header: ['Field', 'Value'], rows: summary },
    ])
    await tx
      .update(claimStatements)
      .set({ objectKey: key, rowCount: rows.length, generatedAt: new Date() })
      .where(
        and(eq(claimStatements.tenantId, rc.ctx.tenantId), eq(claimStatements.id, statementId)),
      )
    return { body, mimeType: XLSX_MIME, rowCount: rows.length, ext: XLSX_EXT }
  })
}

/** Called once per process: by `ClaimsModule.onModuleInit` in the API and by the worker's main. */
export function registerClaimSheetRenderer(): void {
  registerExportRenderer(CLAIM_SHEET_EXPORT_KIND, renderClaimSheet, {
    ext: XLSX_EXT,
    mimeType: XLSX_MIME,
    stem: 'claim-sheet',
  })
}
