import { renderCsv, type CsvColumn } from '../../../platform/csv.js'
import { sellerBranding } from '../../tenancy/index.js'
import { writeXlsx, type XlsxCell } from '../xlsx.js'
import type { ExportRenderContext, RenderedExport } from './registry.js'

/**
 * The register files and the government-shaped JSON bundles. Every renderer reads through the owning
 * module's service (billing's registers, receivables' outstanding list) — the same arithmetic the
 * screens show — and never a table of another module.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const rupees = (paise: number): number => Math.round(paise) / 100
const rupeeText = (paise: number): string => (paise / 100).toFixed(2)
const ddmmyyyy = (iso: string): string =>
  `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
/** Register pages are 200 rows; a year of bills for the pilot is a few thousand, capped well above. */
const MAX_ROWS = 20_000

// ---------------------------------------------------------------------------------------------------------------
// sales register

interface SalesRow {
  invoiceNo: string
  date: string
  shop: string
  gstin: string
  supplyType: string
  pos: string
  taxable: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  roundOff: number
  total: number
  state: string
  source: string
  tallyLedger: string
}

async function salesRows(rc: ExportRenderContext): Promise<SalesRow[]> {
  const p = rc.params
  const out: SalesRow[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await rc.services.registers.salesRegister({
      from: String(p.from),
      to: String(p.to),
      ...(typeof p.retailerId === 'string' ? { retailerId: p.retailerId } : {}),
      issuedOnly: false,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })
    for (const r of page.items) {
      out.push({
        invoiceNo: r.invoiceNo ?? r.externalInvoiceNo ?? r.id,
        date: r.invoiceDate,
        shop: r.buyerName,
        gstin: r.buyerGstin ?? '',
        supplyType: r.supplyType,
        pos: r.placeOfSupplyState,
        taxable: rupees(r.taxablePaise),
        cgst: rupees(r.cgstPaise),
        sgst: rupees(r.sgstPaise),
        igst: rupees(r.igstPaise),
        cess: rupees(r.cessPaise),
        roundOff: rupees(r.roundOffPaise),
        total: rupees(r.totalPaise),
        state: r.state,
        source: r.source,
        tallyLedger: r.tallyLedgerName ?? '',
      })
    }
    if (!page.nextCursor || out.length >= MAX_ROWS) break
    cursor = page.nextCursor
  }
  return out
}

const SALES_COLUMNS: { header: string; key: keyof SalesRow }[] = [
  { header: 'Invoice No', key: 'invoiceNo' },
  { header: 'Date', key: 'date' },
  { header: 'Shop', key: 'shop' },
  { header: 'GSTIN', key: 'gstin' },
  { header: 'Supply', key: 'supplyType' },
  { header: 'Place of supply', key: 'pos' },
  { header: 'Taxable (₹)', key: 'taxable' },
  { header: 'CGST (₹)', key: 'cgst' },
  { header: 'SGST (₹)', key: 'sgst' },
  { header: 'IGST (₹)', key: 'igst' },
  { header: 'Cess (₹)', key: 'cess' },
  { header: 'Round off (₹)', key: 'roundOff' },
  { header: 'Total (₹)', key: 'total' },
  { header: 'State', key: 'state' },
  { header: 'Source', key: 'source' },
  { header: 'Tally ledger', key: 'tallyLedger' },
]

export async function renderSalesRegisterXlsx(rc: ExportRenderContext): Promise<RenderedExport> {
  const rows = await salesRows(rc)
  const body = writeXlsx([
    {
      name: 'Sales register',
      header: SALES_COLUMNS.map((c) => c.header),
      rows: rows.map((r) => SALES_COLUMNS.map((c) => r[c.key] as XlsxCell)),
    },
  ])
  return { body, mimeType: XLSX_MIME, rowCount: rows.length, ext: 'xlsx' }
}

export async function renderSalesRegisterCsv(rc: ExportRenderContext): Promise<RenderedExport> {
  const rows = await salesRows(rc)
  const columns: CsvColumn<SalesRow>[] = SALES_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
  }))
  return {
    body: Buffer.from(renderCsv(rows, columns), 'utf8'),
    mimeType: 'text/csv',
    rowCount: rows.length,
    ext: 'csv',
  }
}

// ---------------------------------------------------------------------------------------------------------------
// outstanding

interface OutstandingRow {
  code: string
  shop: string
  outstanding: number
  overdue: number
  openBills: number
  oldestDue: string
  creditMode: string
}

async function outstandingRows(rc: ExportRenderContext): Promise<OutstandingRow[]> {
  const out: OutstandingRow[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await rc.services.receivables.listOutstanding({
      sort: 'outstanding',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })
    for (const r of page.items) {
      out.push({
        code: r.code ?? '',
        shop: r.name,
        outstanding: rupees(r.outstandingPaise),
        overdue: rupees(r.overduePaise),
        openBills: r.openBills,
        oldestDue: r.oldestDueDate ?? '',
        creditMode: r.creditMode,
      })
    }
    if (!page.nextCursor || out.length >= MAX_ROWS) break
    cursor = page.nextCursor
  }
  return out
}

const OUTSTANDING_COLUMNS: { header: string; key: keyof OutstandingRow }[] = [
  { header: 'Code', key: 'code' },
  { header: 'Shop', key: 'shop' },
  { header: 'Outstanding (₹)', key: 'outstanding' },
  { header: 'Overdue (₹)', key: 'overdue' },
  { header: 'Open bills', key: 'openBills' },
  { header: 'Oldest due', key: 'oldestDue' },
  { header: 'Credit mode', key: 'creditMode' },
]

export async function renderOutstandingXlsx(rc: ExportRenderContext): Promise<RenderedExport> {
  const rows = await outstandingRows(rc)
  const asOf = typeof rc.params.to === 'string' ? rc.params.to : ''
  const body = writeXlsx([
    {
      name: `Outstanding ${asOf}`.trim().slice(0, 31),
      header: OUTSTANDING_COLUMNS.map((c) => c.header),
      rows: rows.map((r) => OUTSTANDING_COLUMNS.map((c) => r[c.key] as XlsxCell)),
    },
  ])
  return { body, mimeType: XLSX_MIME, rowCount: rows.length, ext: 'xlsx' }
}

export async function renderOutstandingCsv(rc: ExportRenderContext): Promise<RenderedExport> {
  const rows = await outstandingRows(rc)
  const columns: CsvColumn<OutstandingRow>[] = OUTSTANDING_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
  }))
  return {
    body: Buffer.from(renderCsv(rows, columns), 'utf8'),
    mimeType: 'text/csv',
    rowCount: rows.length,
    ext: 'csv',
  }
}

// ---------------------------------------------------------------------------------------------------------------
// GSTR-1

interface Gstr1Item {
  num: number
  itm_det: { rt: number; txval: number; camt: number; samt: number; iamt: number; csamt: number }
}

/** Lines folded by GST rate: the return wants one item per rate, not per SKU. */
function itemsByRate(
  lines: readonly {
    gstBps: number
    taxablePaise: number
    cgstPaise: number
    sgstPaise: number
    igstPaise: number
    cessPaise: number
  }[],
): Gstr1Item[] {
  const byRate = new Map<number, Gstr1Item['itm_det']>()
  for (const l of lines) {
    const rate = l.gstBps / 100
    const acc = byRate.get(rate) ?? { rt: rate, txval: 0, camt: 0, samt: 0, iamt: 0, csamt: 0 }
    acc.txval += l.taxablePaise
    acc.camt += l.cgstPaise
    acc.samt += l.sgstPaise
    acc.iamt += l.igstPaise
    acc.csamt += l.cessPaise
    byRate.set(rate, acc)
  }
  return [...byRate.values()]
    .sort((a, b) => a.rt - b.rt)
    .map((d, i) => ({
      num: i + 1,
      itm_det: {
        rt: d.rt,
        txval: rupees(d.txval),
        camt: rupees(d.camt),
        samt: rupees(d.samt),
        iamt: rupees(d.iamt),
        csamt: rupees(d.csamt),
      },
    }))
}

/**
 * GSTR-1 (the government's JSON offline-tool shape, `GST3.0.4`): B2B by buyer GSTIN with one item per
 * rate, B2CS aggregated by place of supply and rate, CDNR for credit notes against registered buyers,
 * the HSN summary and Table 13 (documents issued, cancelled ones counted). `supplyType` narrows to
 * B2B or B2C; `from` / `to` are normally one GST month and `fp` is taken from `from`.
 */
export async function renderGstr1Json(rc: ExportRenderContext): Promise<RenderedExport> {
  const p = rc.params
  const from = String(p.from)
  const to = String(p.to)
  const supplyType = typeof p.supplyType === 'string' ? p.supplyType : 'all'
  return rc.run(async (tx) => {
    const seller = await sellerBranding(tx)
    const invoices = await rc.services.registers.invoicesForExport(tx, {
      from,
      to,
      includeCancelled: true,
    })
    const notes = await rc.services.registers.creditNotesForExport(tx, { from, to })
    const live = invoices.filter((i) => i.state !== 'cancelled')
    const b2bByCtin = new Map<string, unknown[]>()
    const b2cs = new Map<
      string,
      {
        sply_ty: string
        pos: string
        typ: string
        rt: number
        txval: number
        camt: number
        samt: number
        iamt: number
        csamt: number
      }
    >()
    const hsn = new Map<
      string,
      {
        hsn_sc: string
        desc: string
        uqc: string
        qty: number
        txval: number
        rt: number
        camt: number
        samt: number
        iamt: number
        csamt: number
      }
    >()
    for (const inv of live) {
      for (const l of inv.lines) {
        const key = `${l.hsnCode}:${String(l.gstBps)}`
        const acc = hsn.get(key) ?? {
          hsn_sc: l.hsnCode,
          desc: l.description.slice(0, 30),
          uqc: 'PCS',
          qty: 0,
          txval: 0,
          rt: l.gstBps / 100,
          camt: 0,
          samt: 0,
          iamt: 0,
          csamt: 0,
        }
        acc.qty += l.qtyPcs + l.freeQtyPcs
        acc.txval += l.taxablePaise
        acc.camt += l.cgstPaise
        acc.samt += l.sgstPaise
        acc.iamt += l.igstPaise
        acc.csamt += l.cessPaise
        hsn.set(key, acc)
      }
      if (inv.supplyType === 'B2B' && inv.buyerGstin) {
        if (supplyType === 'B2C') continue
        const list = b2bByCtin.get(inv.buyerGstin) ?? []
        list.push({
          inum: inv.invoiceNo ?? inv.externalInvoiceNo ?? inv.id,
          idt: ddmmyyyy(inv.invoiceDate),
          val: rupees(inv.totalPaise),
          pos: inv.placeOfSupplyState,
          rchrg: 'N',
          inv_typ: 'R',
          itms: itemsByRate(inv.lines),
        })
        b2bByCtin.set(inv.buyerGstin, list)
      } else {
        if (supplyType === 'B2B') continue
        for (const l of inv.lines) {
          const rt = l.gstBps / 100
          const key = `${inv.placeOfSupplyState}:${String(rt)}`
          const acc = b2cs.get(key) ?? {
            sply_ty: inv.isInterState ? 'INTER' : 'INTRA',
            pos: inv.placeOfSupplyState,
            typ: 'OE',
            rt,
            txval: 0,
            camt: 0,
            samt: 0,
            iamt: 0,
            csamt: 0,
          }
          acc.txval += l.taxablePaise
          acc.camt += l.cgstPaise
          acc.samt += l.sgstPaise
          acc.iamt += l.igstPaise
          acc.csamt += l.cessPaise
          b2cs.set(key, acc)
        }
      }
    }
    const invoiceById = new Map(invoices.map((i) => [i.id, i]))
    const cdnrByCtin = new Map<string, unknown[]>()
    for (const cn of notes) {
      const inv = invoiceById.get(cn.invoiceId)
      if (!inv?.buyerGstin || supplyType === 'B2C') continue
      const list = cdnrByCtin.get(inv.buyerGstin) ?? []
      list.push({
        ntty: 'C',
        nt_num: cn.creditNoteNo ?? cn.id,
        nt_dt: ddmmyyyy(cn.noteDate),
        val: rupees(cn.totalPaise),
        pos: inv.placeOfSupplyState,
        rchrg: 'N',
        inv_typ: 'R',
        itms: [
          {
            num: 1,
            itm_det: {
              rt: 0,
              txval: rupees(cn.taxablePaise),
              camt: rupees(cn.cgstPaise),
              samt: rupees(cn.sgstPaise),
              iamt: rupees(cn.igstPaise),
              csamt: rupees(cn.cessPaise),
            },
          },
        ],
      })
      cdnrByCtin.set(inv.buyerGstin, list)
    }
    const numbered = invoices.filter((i) => i.invoiceNo)
    const cancelled = numbered.filter((i) => i.state === 'cancelled').length
    const first = numbered[0]?.invoiceNo ?? ''
    const last = numbered[numbered.length - 1]?.invoiceNo ?? ''
    const doc = {
      gstin: seller.gstin ?? '',
      fp: `${from.slice(5, 7)}${from.slice(0, 4)}`,
      version: 'GST3.0.4',
      hash: 'hash',
      b2b: [...b2bByCtin].map(([ctin, inv]) => ({ ctin, inv })),
      b2cs: [...b2cs.values()].map((r) => ({
        ...r,
        txval: rupees(r.txval),
        camt: rupees(r.camt),
        samt: rupees(r.samt),
        iamt: rupees(r.iamt),
        csamt: rupees(r.csamt),
      })),
      cdnr: [...cdnrByCtin].map(([ctin, nt]) => ({ ctin, nt })),
      hsn: {
        data: [...hsn.values()].map((h, i) => ({
          num: i + 1,
          ...h,
          txval: rupees(h.txval),
          camt: rupees(h.camt),
          samt: rupees(h.samt),
          iamt: rupees(h.iamt),
          csamt: rupees(h.csamt),
        })),
      },
      doc_issue: {
        doc_det: [
          {
            doc_num: 1,
            docs: [
              {
                num: 1,
                from: first,
                to: last,
                totnum: numbered.length,
                cancel: cancelled,
                net_issue: numbered.length - cancelled,
              },
            ],
          },
        ],
      },
    }
    return {
      body: Buffer.from(JSON.stringify(doc, null, 2), 'utf8'),
      mimeType: 'application/json',
      rowCount: live.length,
      ext: 'json',
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// e-way bill / e-invoice bundles (stubs on purpose: recorded fields, never a GSP call)

async function bundledInvoices(rc: ExportRenderContext) {
  const p = rc.params
  return rc.run(async (tx) => {
    const seller = await sellerBranding(tx)
    const invoices = await rc.services.registers.invoicesForExport(tx, {
      from: String(p.from),
      to: String(p.to),
      ...(Array.isArray(p.invoiceIds) ? { invoiceIds: p.invoiceIds as string[] } : {}),
    })
    const parties = await rc.services.retailers.labels(
      tx,
      invoices.map((i) => i.retailerId),
    )
    return { seller, invoices, parties }
  })
}

export async function renderEwayBillJson(rc: ExportRenderContext): Promise<RenderedExport> {
  const { seller, invoices } = await bundledInvoices(rc)
  const bills = invoices.map((inv) => ({
    supplyType: 'O',
    subSupplyType: 1,
    docType: 'INV',
    docNo: inv.invoiceNo ?? inv.externalInvoiceNo ?? inv.id,
    docDate: ddmmyyyy(inv.invoiceDate),
    fromGstin: seller.gstin,
    fromTrdName: seller.legalName,
    fromStateCode: seller.stateCode,
    toGstin: inv.buyerGstin ?? 'URP',
    toTrdName: inv.buyerName,
    toStateCode: inv.placeOfSupplyState,
    totalValue: rupeeText(inv.taxablePaise),
    cgstValue: rupeeText(inv.cgstPaise),
    sgstValue: rupeeText(inv.sgstPaise),
    igstValue: rupeeText(inv.igstPaise),
    cessValue: rupeeText(inv.cessPaise),
    totInvValue: rupeeText(inv.totalPaise),
    transMode: inv.transportMode ?? '1',
    vehicleNo: inv.vehicleNo,
    itemList: inv.lines.map((l) => ({
      productName: l.description,
      hsnCode: l.hsnCode,
      quantity: l.qtyPcs + l.freeQtyPcs,
      qtyUnit: 'PCS',
      taxableAmount: rupeeText(l.taxablePaise),
      cgstRate: l.igstPaise > 0 ? 0 : l.gstBps / 200,
      sgstRate: l.igstPaise > 0 ? 0 : l.gstBps / 200,
      igstRate: l.igstPaise > 0 ? l.gstBps / 100 : 0,
      cessRate: l.cessBps / 100,
    })),
    recorded: { ewayBillNo: inv.ewayBillNo },
  }))
  return {
    body: Buffer.from(JSON.stringify({ version: '1.0.0621', billLists: bills }, null, 2), 'utf8'),
    mimeType: 'application/json',
    rowCount: bills.length,
    ext: 'json',
  }
}

export async function renderEinvoiceJson(rc: ExportRenderContext): Promise<RenderedExport> {
  const { seller, invoices } = await bundledInvoices(rc)
  const docs = invoices.map((inv) => ({
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: inv.supplyType === 'B2B' ? 'B2B' : 'B2C', RegRev: 'N' },
    DocDtls: {
      Typ: 'INV',
      No: inv.invoiceNo ?? inv.externalInvoiceNo ?? inv.id,
      Dt: ddmmyyyy(inv.invoiceDate),
    },
    SellerDtls: { Gstin: seller.gstin, LglNm: seller.legalName, Stcd: seller.stateCode },
    BuyerDtls: {
      Gstin: inv.buyerGstin ?? 'URP',
      LglNm: inv.buyerName,
      Pos: inv.placeOfSupplyState,
      Stcd: inv.placeOfSupplyState,
    },
    ItemList: inv.lines.map((l, i) => ({
      SlNo: String(i + 1),
      PrdDesc: l.description,
      IsServc: 'N',
      HsnCd: l.hsnCode,
      Qty: l.qtyPcs,
      FreeQty: l.freeQtyPcs,
      Unit: 'PCS',
      UnitPrice: rupees(l.ratePaise),
      TotAmt: rupees(l.ratePaise * l.qtyPcs),
      Discount: rupees(l.discountPaise),
      AssAmt: rupees(l.taxablePaise),
      GstRt: l.gstBps / 100,
      CgstAmt: rupees(l.cgstPaise),
      SgstAmt: rupees(l.sgstPaise),
      IgstAmt: rupees(l.igstPaise),
      CesAmt: rupees(l.cessPaise),
      TotItemVal: rupees(l.lineTotalPaise),
    })),
    ValDtls: {
      AssVal: rupees(inv.taxablePaise),
      CgstVal: rupees(inv.cgstPaise),
      SgstVal: rupees(inv.sgstPaise),
      IgstVal: rupees(inv.igstPaise),
      CesVal: rupees(inv.cessPaise),
      RndOffAmt: rupees(inv.roundOffPaise),
      TotInvVal: rupees(inv.totalPaise),
    },
    recorded: { irn: inv.irn, ackNo: inv.ackNo, ackDate: inv.ackDate },
  }))
  return {
    body: Buffer.from(JSON.stringify(docs, null, 2), 'utf8'),
    mimeType: 'application/json',
    rowCount: docs.length,
    ext: 'json',
  }
}
