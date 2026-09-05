import { eq, sql } from 'drizzle-orm'
import { tallyMappings, tallySyncLedger, type Db } from '@dos/db'
import { currentTenant } from '../../../platform/index.js'
import { sellerBranding } from '../../tenancy/index.js'
import { contentHash, stableUuid, tallyGuidFor } from '../integrations.internals.js'
import { escapeXml } from '../xlsx.js'
import type { ExportRenderContext, RenderedExport } from './registry.js'

/**
 * TALLYPRIME IMPORT XML — `tally_xml` (docs/10, ADR 0014, the contract header). One `<VOUCHER>` per
 * document in the window: sales (issued bills, with the window's credit notes as `Credit Note`
 * vouchers so the sales register matches to the paisa), receipts, purchases (booked supplier bills).
 *
 * WHAT NEVER DOUBLE-POSTS. Every voucher carries a GUID derived from (tenant, docType, docId) and is
 * recorded in `tally_sync_ledger` with a hash of its content: exporting an overlapping window emits
 * the SAME GUID, so Tally's GUID-keyed import updates the voucher instead of adding a second one.
 *
 * WHAT IS LEFT OUT. A line whose brand is `tally_export_source = brand_dms | none` on `tenant_brands`
 * (Too Yumm: the CA keys those from the brand's own DMS, coordination §7 q7) is excluded from the
 * voucher amount; a bill with no eligible line emits no voucher. A mixed-brand bill emits a voucher
 * for the eligible subset only (brief §8.6, a flagged assumption): its round-off is left out because
 * it belongs to the whole bill.
 *
 * NAMES. The company is the DISTRIBUTOR's own (`tenants.legal_name`, or `tallyCompanyName` when the
 * CA's Tally company differs) — never ours (§D6). Party ledgers come from `retailers /
 * suppliers.tally_ledger_name` first and `tally_mappings(party)` second, else the party's name;
 * accounts from `tally_mappings(ledger, <code>)` else the account's own Tally name else a plain
 * default ("Sales", "Output CGST"); stock items, units and voucher types from `tally_mappings`.
 *
 * SIGNS. Tally's XML convention: a debit is a NEGATIVE amount with `ISDEEMEDPOSITIVE = Yes`, a credit
 * a positive amount with `No`. Amounts are rupees with two decimals, from integer paise.
 */

const rupees = (paise: number): string => (paise / 100).toFixed(2)
const tallyDate = (iso: string): string => iso.replace(/-/g, '').slice(0, 8)

interface Names {
  ledger: (code: string, fallback: string) => string
  party: (retailerId: string, name: string, own: string | null) => string
  supplier: (supplierId: string, name: string, own: string | null) => string
  stockItem: (variantId: string, label: string) => string
  unit: (code: string, fallback: string) => string
  voucherType: (key: string, fallback: string) => string
}

/** Every `tally_mappings` row of the tenant plus the chart's own Tally names, folded into resolvers. */
async function loadNames(tx: Db, rc: ExportRenderContext): Promise<Names> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      entityType: tallyMappings.entityType,
      entityId: tallyMappings.entityId,
      tallyName: tallyMappings.tallyName,
    })
    .from(tallyMappings)
    .where(eq(tallyMappings.tenantId, tenantId))
  const map = new Map(rows.map((r) => [`${r.entityType}:${r.entityId}`, r.tallyName]))
  const accounts = await rc.services.receivables.listAccounts({ withBalances: false })
  const accountNames = new Map<string, string>()
  for (const a of accounts.items) if (a.tallyLedgerName) accountNames.set(a.code, a.tallyLedgerName)
  return {
    ledger: (code, fallback) =>
      map.get(`ledger:${code}`) ??
      accountNames.get(code) ??
      map.get(`ledger:${fallback}`) ??
      fallback,
    party: (id, name, own) => own ?? map.get(`party:${id}`) ?? name,
    supplier: (id, name, own) => own ?? map.get(`party:${id}`) ?? name,
    stockItem: (id, label) => map.get(`stock_item:${id}`) ?? label,
    unit: (code, fallback) => map.get(`unit:${code}`) ?? fallback,
    voucherType: (key, fallback) => map.get(`voucher_type:${key}`) ?? fallback,
  }
}

interface LedgerEntry {
  name: string
  /** Debit when true (negative amount in the XML). */
  debit: boolean
  paise: number
  extra?: string
}

interface InventoryEntry {
  stockItem: string
  qtyPcs: number
  unit: string
  ratePaise: number
  amountPaise: number
  hsn: string
  salesLedger: string
}

interface Voucher {
  docType: 'invoice' | 'credit_note' | 'receipt' | 'supplier_invoice'
  docId: string
  type: string
  number: string
  date: string
  party: string
  partyGstin: string | null
  narration: string
  isInvoice: boolean
  ledgers: LedgerEntry[]
  inventory: InventoryEntry[]
  reference: string | null
}

function voucherXml(v: Voucher, guid: string): string {
  const ledgerXml = v.ledgers
    .filter((l) => l.paise !== 0)
    .map(
      (l) =>
        `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(l.name)}</LEDGERNAME>` +
        `<ISDEEMEDPOSITIVE>${l.debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>` +
        `<AMOUNT>${l.debit ? '-' : ''}${rupees(l.paise)}</AMOUNT>${l.extra ?? ''}</ALLLEDGERENTRIES.LIST>`,
    )
    .join('')
  const inventoryXml = v.inventory
    .map(
      (i) =>
        `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${escapeXml(i.stockItem)}</STOCKITEMNAME>` +
        `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><RATE>${rupees(i.ratePaise)}/${escapeXml(i.unit)}</RATE>` +
        `<AMOUNT>${rupees(i.amountPaise)}</AMOUNT><ACTUALQTY>${String(i.qtyPcs)} ${escapeXml(i.unit)}</ACTUALQTY>` +
        `<BILLEDQTY>${String(i.qtyPcs)} ${escapeXml(i.unit)}</BILLEDQTY>` +
        `<GSTHSNNAME>${escapeXml(i.hsn)}</GSTHSNNAME>` +
        `<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${escapeXml(i.salesLedger)}</LEDGERNAME>` +
        `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${rupees(i.amountPaise)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>` +
        `</ALLINVENTORYENTRIES.LIST>`,
    )
    .join('')
  return (
    `<TALLYMESSAGE xmlns:UDF="TallyUDF">` +
    `<VOUCHER REMOTEID="${guid}" VCHKEY="${guid}" VCHTYPE="${escapeXml(v.type)}" ACTION="Create" OBJVIEW="${v.isInvoice ? 'Invoice Voucher View' : 'Accounting Voucher View'}">` +
    `<DATE>${tallyDate(v.date)}</DATE><GUID>${guid}</GUID>` +
    `<VOUCHERTYPENAME>${escapeXml(v.type)}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${escapeXml(v.number)}</VOUCHERNUMBER>` +
    (v.reference ? `<REFERENCE>${escapeXml(v.reference)}</REFERENCE>` : '') +
    `<PARTYLEDGERNAME>${escapeXml(v.party)}</PARTYLEDGERNAME>` +
    (v.partyGstin ? `<PARTYGSTIN>${escapeXml(v.partyGstin)}</PARTYGSTIN>` : '') +
    `<NARRATION>${escapeXml(v.narration)}</NARRATION>` +
    `<PERSISTEDVIEW>${v.isInvoice ? 'Invoice Voucher View' : 'Accounting Voucher View'}</PERSISTEDVIEW>` +
    `<ISINVOICE>${v.isInvoice ? 'Yes' : 'No'}</ISINVOICE>` +
    ledgerXml +
    inventoryXml +
    `</VOUCHER></TALLYMESSAGE>`
  )
}

const RECEIPT_ACCOUNT: Record<string, { code: string; fallback: string }> = {
  cash: { code: 'CASH', fallback: 'Cash' },
  upi: { code: 'UPI', fallback: 'UPI Collections' },
  cheque: { code: 'CHEQUES', fallback: 'Cheques in Hand' },
  bank: { code: 'BANK', fallback: 'Bank' },
  neft: { code: 'BANK', fallback: 'Bank' },
}

export interface TallyRenderResult extends RenderedExport {
  vouchers: number
  skipped: { invoiceId: string; reason: string }[]
}

/** Build the file and record every voucher in `tally_sync_ledger`. */
export async function renderTallyXml(rc: ExportRenderContext): Promise<TallyRenderResult> {
  const p = rc.params
  const from = String(p.from)
  const to = String(p.to)
  const types = new Set(
    Array.isArray(p.voucherTypes) && p.voucherTypes.length > 0
      ? (p.voucherTypes as string[])
      : ['sales', 'receipts', 'purchases'],
  )
  const retailerId = typeof p.retailerId === 'string' ? p.retailerId : undefined
  const supplierId = typeof p.supplierId === 'string' ? p.supplierId : undefined

  return rc.run(async (tx) => {
    const seller = await sellerBranding(tx)
    const company =
      typeof p.tallyCompanyName === 'string' && p.tallyCompanyName.trim()
        ? p.tallyCompanyName.trim()
        : seller.legalName
    const names = await loadNames(tx, rc)
    const vouchers: Voucher[] = []
    const skipped: TallyRenderResult['skipped'] = []
    const pcs = names.unit('PCS', 'Pcs')

    if (types.has('sales')) {
      const invoices = await rc.services.registers.invoicesForExport(tx, {
        from,
        to,
        retailerId,
      })
      const variantIds = invoices.flatMap((i) => i.lines.map((l) => l.variantId))
      const sources = await rc.services.tenantCatalog.tallyExportSourceByVariant(tx, variantIds)
      const labels = await rc.services.tenantCatalog.variantLabels(tx, variantIds)
      const parties = await rc.services.retailers.labels(
        tx,
        invoices.map((i) => i.retailerId),
      )
      for (const inv of invoices) {
        const eligible = inv.lines.filter((l) => (sources.get(l.variantId) ?? 'dos') === 'dos')
        if (eligible.length === 0) {
          skipped.push({
            invoiceId: inv.id,
            reason: inv.lines.length === 0 ? 'no lines' : 'every line is keyed from the brand DMS',
          })
          continue
        }
        const whole = eligible.length === inv.lines.length
        const taxable = eligible.reduce((s, l) => s + l.taxablePaise, 0)
        const cgst = eligible.reduce((s, l) => s + l.cgstPaise, 0)
        const sgst = eligible.reduce((s, l) => s + l.sgstPaise, 0)
        const igst = eligible.reduce((s, l) => s + l.igstPaise, 0)
        const cess = eligible.reduce((s, l) => s + l.cessPaise, 0)
        const roundOff = whole ? inv.roundOffPaise : 0
        const total = taxable + cgst + sgst + igst + cess + roundOff
        const party = parties.get(inv.retailerId)
        const salesLedger = names.ledger('SALES', 'Sales')
        vouchers.push({
          docType: 'invoice',
          docId: inv.id,
          type: names.voucherType('sales', 'Sales'),
          number: inv.invoiceNo ?? inv.externalInvoiceNo ?? inv.id,
          date: inv.invoiceDate,
          party: names.party(inv.retailerId, inv.buyerName, party?.tallyLedgerName ?? null),
          partyGstin: inv.buyerGstin,
          narration: whole
            ? `Sales ${inv.invoiceNo ?? ''}`.trim()
            : `Sales ${inv.invoiceNo ?? ''} (brand-DMS lines excluded)`.trim(),
          isInvoice: true,
          reference: inv.invoiceNo,
          ledgers: [
            {
              name: names.party(inv.retailerId, inv.buyerName, party?.tallyLedgerName ?? null),
              debit: true,
              paise: total,
            },
            { name: names.ledger('OUTPUT_CGST', 'Output CGST'), debit: false, paise: cgst },
            { name: names.ledger('OUTPUT_SGST', 'Output SGST'), debit: false, paise: sgst },
            { name: names.ledger('OUTPUT_IGST', 'Output IGST'), debit: false, paise: igst },
            { name: names.ledger('OUTPUT_CESS', 'Output Cess'), debit: false, paise: cess },
            {
              name: names.ledger('ROUND_OFF', 'Round Off'),
              debit: roundOff < 0,
              paise: Math.abs(roundOff),
            },
          ],
          inventory: eligible.map((l) => ({
            stockItem: names.stockItem(l.variantId, labels.get(l.variantId) ?? l.description),
            qtyPcs: l.qtyPcs,
            unit: pcs,
            ratePaise: l.ratePaise,
            amountPaise: l.taxablePaise,
            hsn: l.hsnCode,
            salesLedger,
          })),
        })
      }
      const notes = await rc.services.registers.creditNotesForExport(tx, { from, to, retailerId })
      const noteParties = await rc.services.retailers.labels(
        tx,
        notes.map((n) => n.retailerId),
      )
      for (const cn of notes) {
        const party = noteParties.get(cn.retailerId)
        const partyName = names.party(
          cn.retailerId,
          party?.name ?? cn.retailerId,
          party?.tallyLedgerName ?? null,
        )
        vouchers.push({
          docType: 'credit_note',
          docId: cn.id,
          type: names.voucherType('credit_note', 'Credit Note'),
          number: cn.creditNoteNo ?? cn.id,
          date: cn.noteDate,
          party: partyName,
          partyGstin: party?.gstin ?? null,
          narration: `Credit note ${cn.creditNoteNo ?? ''} against ${cn.invoiceNo ?? cn.invoiceId} (${cn.reason})`,
          isInvoice: false,
          reference: cn.invoiceNo,
          ledgers: [
            { name: names.ledger('SALES', 'Sales'), debit: true, paise: cn.taxablePaise },
            { name: names.ledger('OUTPUT_CGST', 'Output CGST'), debit: true, paise: cn.cgstPaise },
            { name: names.ledger('OUTPUT_SGST', 'Output SGST'), debit: true, paise: cn.sgstPaise },
            { name: names.ledger('OUTPUT_IGST', 'Output IGST'), debit: true, paise: cn.igstPaise },
            { name: names.ledger('OUTPUT_CESS', 'Output Cess'), debit: true, paise: cn.cessPaise },
            {
              name: names.ledger('ROUND_OFF', 'Round Off'),
              debit: cn.roundOffPaise > 0,
              paise: Math.abs(cn.roundOffPaise),
            },
            { name: partyName, debit: false, paise: cn.totalPaise },
          ],
          inventory: [],
        })
      }
    }

    if (types.has('receipts')) {
      const receipts = await rc.services.receivables.receiptsForExport(tx, { from, to, retailerId })
      const parties = await rc.services.retailers.labels(
        tx,
        receipts.map((r) => r.retailerId),
      )
      for (const r of receipts) {
        const party = parties.get(r.retailerId)
        const partyName = names.party(
          r.retailerId,
          party?.name ?? r.retailerId,
          party?.tallyLedgerName ?? null,
        )
        const account = RECEIPT_ACCOUNT[r.mode] ??
          RECEIPT_ACCOUNT.cash ?? { code: 'CASH', fallback: 'Cash' }
        vouchers.push({
          docType: 'receipt',
          docId: r.id,
          type: names.voucherType('receipts', 'Receipt'),
          number: r.receiptNo ?? r.id,
          date: r.receivedAt.slice(0, 10),
          party: partyName,
          partyGstin: party?.gstin ?? null,
          narration: `${r.mode} received${r.reference ? ` (${r.reference})` : ''}${r.bankName ? ` ${r.bankName}` : ''}`,
          isInvoice: false,
          reference: r.reference,
          ledgers: [
            {
              name: names.ledger(account.code, account.fallback),
              debit: true,
              paise: r.amountPaise,
            },
            { name: partyName, debit: false, paise: r.amountPaise },
          ],
          inventory: [],
        })
      }
    }

    if (types.has('purchases')) {
      const bills = await rc.services.supplierInvoices.listForExport(tx, { from, to, supplierId })
      const suppliers = await rc.services.tenantCatalog.supplierLabels(
        tx,
        bills.map((b) => b.supplierId),
      )
      for (const b of bills) {
        const s = suppliers.get(b.supplierId)
        const supplierName = names.supplier(
          b.supplierId,
          s?.name ?? b.supplierId,
          s?.tallyLedgerName ?? null,
        )
        const taxable = b.subtotalPaise - b.discountPaise
        vouchers.push({
          docType: 'supplier_invoice',
          docId: b.id,
          type: names.voucherType('purchases', 'Purchase'),
          number: b.invoiceNo,
          date: b.invoiceDate,
          party: supplierName,
          partyGstin: b.supplierGstin ?? s?.gstin ?? null,
          narration: `Purchase ${b.invoiceNo}`,
          isInvoice: false,
          reference: b.invoiceNo,
          ledgers: [
            { name: names.ledger('PURCHASES', 'Purchases'), debit: true, paise: taxable },
            { name: names.ledger('INPUT_CGST', 'Input CGST'), debit: true, paise: b.cgstPaise },
            { name: names.ledger('INPUT_SGST', 'Input SGST'), debit: true, paise: b.sgstPaise },
            { name: names.ledger('INPUT_IGST', 'Input IGST'), debit: true, paise: b.igstPaise },
            { name: names.ledger('INPUT_CESS', 'Input Cess'), debit: true, paise: b.cessPaise },
            { name: names.ledger('FREIGHT', 'Freight Inward'), debit: true, paise: b.freightPaise },
            {
              name: names.ledger('ROUND_OFF', 'Round Off'),
              debit: b.roundOffPaise > 0,
              paise: Math.abs(b.roundOffPaise),
            },
            { name: supplierName, debit: false, paise: b.totalPaise },
          ],
          inventory: [],
        })
      }
    }

    // The ledger of what this run pushed: same GUID for the same document every time.
    const { tenantId } = currentTenant()
    const messages: string[] = []
    for (const v of vouchers) {
      const guid = tallyGuidFor(tenantId, v.docType, v.docId)
      const xml = voucherXml(v, guid)
      messages.push(xml)
      await tx
        .insert(tallySyncLedger)
        .values({
          id: stableUuid(`tally-sync:${tenantId}:${v.docType}:${v.docId}`),
          tenantId,
          docType: v.docType,
          docId: v.docId,
          tallyGuid: guid,
          tallyVoucherId: v.number,
          exportJobId: rc.exportJobId,
          exportedAt: new Date(),
          contentHash: contentHash(v),
        })
        .onConflictDoUpdate({
          target: [tallySyncLedger.tenantId, tallySyncLedger.docType, tallySyncLedger.docId],
          set: {
            tallyGuid: guid,
            tallyVoucherId: v.number,
            exportJobId: rc.exportJobId,
            exportedAt: sql`now()`,
            contentHash: contentHash(v),
          },
        })
    }
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>` +
      `<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>` +
      `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
      `<REQUESTDATA>${messages.join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`
    return {
      body: Buffer.from(body, 'utf8'),
      mimeType: 'application/xml',
      rowCount: vouchers.length,
      ext: 'xml',
      vouchers: vouchers.length,
      skipped,
    }
  })
}
