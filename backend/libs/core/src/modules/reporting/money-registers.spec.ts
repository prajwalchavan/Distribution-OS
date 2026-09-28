import { eq } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessDate, financialYear, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  creditNoteLines,
  creditNotes,
  dailyTenantStats,
  exportJobs,
  invoiceLines,
  invoices,
  manufacturers,
  memberships,
  products,
  productVariants,
  retailers,
  salesOrders,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { createObjectStorage, tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { ExportJobsService, registeredExportKinds } from '../integrations/index.js'
import { ReceivablesService } from '../receivables/index.js'
import { ReportingModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/**
 * THE DESK'S REGISTERS (QA phase 7 · lane "credit", architect ruling 7 of 2026-09-28 and the DOS-292
 * ruling of the simulation report):
 *
 *  - DOS-317 the GST summary and the GST sales register count DISTINCT bills and credit notes, whatever
 *    the grouping, and count the cancelled ones apart — the values were right to the paisa and stay so;
 *  - DOS-321 the daily sales register carries the day's credit notes beside what was billed;
 *  - DOS-292 every CSV the product writes guards a cell that a spreadsheet would run as a formula, and a
 *    negative amount stays a number.
 */

const HOSTILE_SHOP = '=HYPERLINK("http://evil.example/x","Pay here")'

/** RFC 4180 parse, enough for the files `renderCsv` writes (quoted cells, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? ''
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && body[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell])
  return rows
}

const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

describeDb('the desk’s registers: GST documents, credit notes, CSV cells (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const accountantId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  const today = businessDate().date
  const from = today
  const to = today
  const hostile = uuidv7()
  const plain = uuidv7()
  const variantFive = uuidv7() // HSN A, 5 %
  const variantEighteen = uuidv7() // HSN B, 18 %
  const hsnA = `11${run.slice(-6)}`
  const hsnB = `22${run.slice(-6)}`
  let app: NestFastifyApplication
  let receivables: ReceivablesService

  interface LineSpec {
    variantId: string
    hsn: string
    gstBps: number
    taxablePaise: number
  }
  const billLines = new Map<string, string[]>()

  /** One bill with its lines, dated today; `cancelled` keeps its number and holds no money. */
  async function bill(
    n: number,
    retailerId: string,
    lines: LineSpec[],
    opts: { cancelled?: boolean; roundOffPaise?: number } = {},
  ): Promise<string> {
    const id = uuidv7()
    const tax = lines.reduce((s, l) => s + Math.round((l.taxablePaise * l.gstBps) / 10_000), 0)
    const taxable = lines.reduce((s, l) => s + l.taxablePaise, 0)
    const roundOff = opts.roundOffPaise ?? 0
    const total = taxable + tax + roundOff
    await db.insert(invoices).values({
      id,
      tenantId,
      invoiceNo: `INV/R${run}/${String(n)}`,
      seriesCode: 'INV',
      fy: financialYear(),
      invoiceDate: today,
      retailerId,
      state: opts.cancelled ? 'cancelled' : 'issued',
      buyerName: retailerId === hostile ? HOSTILE_SHOP : `Plain Shop ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: taxable,
      taxablePaise: taxable,
      cgstPaise: Math.floor(tax / 2),
      sgstPaise: tax - Math.floor(tax / 2),
      roundOffPaise: roundOff,
      totalPaise: total,
      dueDate: today,
      ...(opts.cancelled ? { cancelledAt: new Date(), cancelReason: 'typed twice' } : {}),
    })
    const ids: string[] = []
    let lineNo = 0
    for (const l of lines) {
      lineNo += 1
      const lineId = uuidv7()
      ids.push(lineId)
      const lineTax = Math.round((l.taxablePaise * l.gstBps) / 10_000)
      await db.insert(invoiceLines).values({
        id: lineId,
        tenantId,
        invoiceId: id,
        lineNo,
        variantId: l.variantId,
        description: 'Register item',
        hsnCode: l.hsn,
        qtyPcs: 1,
        ratePaise: l.taxablePaise,
        taxablePaise: l.taxablePaise,
        gstBps: l.gstBps,
        cgstPaise: Math.floor(lineTax / 2),
        sgstPaise: lineTax - Math.floor(lineTax / 2),
        lineTotalPaise: l.taxablePaise + lineTax,
      })
    }
    billLines.set(id, ids)
    if (!opts.cancelled)
      await asOwner((tx) =>
        receivables.postInvoiceIssued(tx, {
          id,
          retailerId,
          invoiceDate: today,
          subtotalPaise: taxable,
          discountPaise: 0,
          cgstPaise: Math.floor(tax / 2),
          sgstPaise: tax - Math.floor(tax / 2),
          igstPaise: 0,
          cessPaise: 0,
          roundOffPaise: roundOff,
          totalPaise: total,
          dueDate: today,
        }),
      )
    return id
  }

  /** A credit note on every line of `invoiceId` given, at one rupee of taxable each. */
  async function note(
    n: number,
    invoiceId: string,
    retailerId: string,
    gstOf: number[],
    state: 'issued' | 'cancelled' = 'issued',
  ): Promise<void> {
    const id = uuidv7()
    await db.insert(creditNotes).values({
      id,
      tenantId,
      creditNoteNo: `CN/R${run}/${String(n)}`,
      fy: financialYear(),
      noteDate: today,
      invoiceId,
      retailerId,
      reason: 'return_saleable',
      state,
      taxablePaise: 100 * gstOf.length,
      totalPaise: gstOf.reduce((s, g) => s + 100 + Math.round((100 * g) / 10_000), 0),
    })
    const lines = billLines.get(invoiceId) ?? []
    await db.insert(creditNoteLines).values(
      gstOf.map((gstBps, i) => ({
        id: uuidv7(),
        tenantId,
        creditNoteId: id,
        invoiceLineId: lines[i] ?? '',
        qtyPcs: 1,
        ratePaise: 100,
        taxablePaise: 100,
        gstBps,
        taxPaise: Math.round((100 * gstBps) / 10_000),
        lineTotalPaise: 100 + Math.round((100 * gstBps) / 10_000),
      })),
    )
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `reg-${run}`, legalName: 'Registers test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91908${run}1`, name: 'Owner' },
      { id: accountantId, phone: `+91908${run}2`, name: 'Accountant' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker reg ${run}` })
    await db.insert(products).values({ id: productId, manufacturerId, name: 'Register item' })
    await db.insert(productVariants).values([
      {
        id: variantFive,
        productId,
        name: 'Register item 100 g',
        netQty: 100,
        netUnit: 'g',
        defaultCaseSize: 12,
        hsnCode: hsnA,
      },
      {
        id: variantEighteen,
        productId,
        name: 'Register item 200 g',
        netQty: 200,
        netUnit: 'g',
        defaultCaseSize: 12,
        hsnCode: hsnB,
      },
    ])
    await db.insert(retailers).values([
      {
        id: hostile,
        tenantId,
        code: `H-${run}`,
        name: HOSTILE_SHOP,
        phone: `+91909${run}1`,
        stateCode: '27',
        tier: 'C',
      },
      {
        id: plain,
        tenantId,
        code: `P-${run}`,
        name: `Plain Shop ${run}`,
        phone: `+91909${run}2`,
        stateCode: '27',
        tier: 'C',
      },
    ])
    app = await bootTestApp([ReportingModule])
    receivables = app.get(ReceivablesService)

    const five = (taxablePaise: number): LineSpec => ({
      variantId: variantFive,
      hsn: hsnA,
      gstBps: 500,
      taxablePaise,
    })
    const eighteen = (taxablePaise: number): LineSpec => ({
      variantId: variantEighteen,
      hsn: hsnB,
      gstBps: 1_800,
      taxablePaise,
    })
    // Three live bills: each rate carries TWO bills, so the old "maximum per row" read 2, not 3.
    const b1 = await bill(1, hostile, [five(10_000), eighteen(20_000)], { roundOffPaise: -40 })
    const b2 = await bill(2, plain, [eighteen(30_000)])
    const b3 = await bill(3, plain, [five(40_000)])
    // One bill cancelled the same day: not in the values, counted apart.
    const b4 = await bill(4, plain, [five(50_000)], { cancelled: true })
    // Three live credit notes spread the same way, and one cancelled.
    await note(1, b1, hostile, [500, 1_800])
    await note(2, b2, plain, [1_800])
    await note(3, b3, plain, [500])
    await note(4, b2, plain, [1_800], 'cancelled')
    void b4

    // An order for the hostile shop with a negative round-off, and a refusal whose words look like a sum.
    const base = {
      tenantId,
      source: 'phone' as const,
      createdBy: ownerId,
      paymentTerms: 'POST_FULFILLMENT' as const,
      subtotalPaise: 10_000,
      totalPaise: 9_960,
      roundOffPaise: -40,
    }
    await db.insert(salesOrders).values([
      { ...base, id: uuidv7(), retailerId: hostile, state: 'confirmed', orderNo: `SO-R${run}-1` },
      {
        ...base,
        id: uuidv7(),
        retailerId: plain,
        state: 'cancelled',
        orderNo: `SO-R${run}-2`,
        cancelReason: '-2+3 cases short',
      },
    ])
    await db.insert(dailyTenantStats).values({
      tenantId,
      day: today,
      ordersCount: 2,
      invoicedPaise: 123_400,
      creditedPaise: 1_639,
      collectedPaise: 0,
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-317

  it('DOS-317: the GST summary counts 3 distinct bills and 3 distinct credit notes by rate and by HSN, with the cancelled ones apart', async () => {
    for (const groupBy of ['rate', 'hsn'] as const) {
      const res = await call<{
        rows: { gstBps: number; documentCount: number; taxablePaise: number }[]
        totals: { documentCount: number; cancelledDocumentCount?: number; taxablePaise: number }
        creditNoteRows: { documentCount: number }[]
        creditNoteTotals: { documentCount: number; cancelledDocumentCount?: number }
      }>(app, accountant, 'GET', '/billing/gst-summary', { from, to, groupBy })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      // every row still carries its own distinct count: two bills at each rate
      expect(res.body.rows.map((r) => r.documentCount)).toEqual([2, 2])
      expect(res.body.totals.documentCount, `${groupBy}: three bills, not the largest row`).toBe(3)
      expect(res.body.totals.cancelledDocumentCount).toBe(1)
      expect(res.body.creditNoteRows.map((r) => r.documentCount)).toEqual([2, 2])
      expect(res.body.creditNoteTotals.documentCount).toBe(3)
      expect(res.body.creditNoteTotals.cancelledDocumentCount).toBe(1)
      // the values are what they were: the cancelled bill's ₹500 is not in them
      expect(res.body.totals.taxablePaise).toBe(10_000 + 20_000 + 30_000 + 40_000)

      const register = await call(app, accountant, 'GET', '/reporting/registers/gst-sales', {
        from,
        to,
        groupBy,
      })
      expect(register.status).toBe(200)
      expect(register.body, 'the register is billing’s own summary, byte for byte').toEqual(
        res.body,
      )
    }
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-321

  it('DOS-321: the daily sales register carries the day’s credit notes beside what was billed', async () => {
    const res = await call<{
      items: { day: string; invoicedPaise: number; creditedPaise?: number | null }[]
      totals: { invoicedPaise: number; creditedPaise?: number }
    }>(app, owner, 'GET', '/reporting/registers/daily-sales', { from, to })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.items[0]).toMatchObject({
      day: today,
      invoicedPaise: 123_400,
      creditedPaise: 1_639,
    })
    expect(res.body.totals.creditedPaise).toBe(1_639)
  })

  // ---------------------------------------------------------------------------------------------------
  // DOS-292

  it('DOS-292: every CSV export the product has guards formula cells in text columns and keeps negative amounts as numbers', async () => {
    const exportsSvc = app.get(ExportJobsService)
    const kinds = registeredExportKinds().filter((kind) => kind.endsWith('_csv'))
    // every register of reporting and both of integrations' CSV twins
    expect(kinds).toEqual(
      expect.arrayContaining([
        'report_orders_csv',
        'report_outstanding_csv',
        'report_dailySales_csv',
        'report_gstSalesRegister_csv',
        'sales_register_csv',
        'outstanding_csv',
      ]),
    )
    const files = new Map<string, string>()
    for (const kind of kinds) {
      const id = uuidv7()
      await asOwner((tx) =>
        exportsSvc.enqueueExport(tx, { id, kind, params: { from, to }, requestedBy: ownerId }),
      )
      await tenantStorage.run(ownerCtx, () => exportsSvc.renderNow(id))
      const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, id))
      expect(job?.status, `${kind}: ${job?.error ?? ''}`).toBe('succeeded')
      const text = (await createObjectStorage().get(job?.objectKey ?? '')).toString('utf8')
      files.set(kind, text)
      for (const row of parseCsv(text))
        for (const cell of row)
          expect(
            FORMULA_START.test(cell) && !PLAIN_NUMBER.test(cell),
            `${kind}: a cell a spreadsheet would run — ${cell}`,
          ).toBe(false)
    }

    // The hostile shop name is written, guarded, where a register names the shop.
    for (const kind of ['sales_register_csv', 'outstanding_csv', 'report_outstanding_csv'])
      expect(files.get(kind), kind).toContain(
        `"'=HYPERLINK(""http://evil.example/x"",""Pay here"")"`,
      )
    // Words that only look like a sum are text: guarded.
    expect(files.get('report_orders_csv')).toContain(`'-2+3 cases short`)
    // A negative amount is a number and stays one: the round-off of the bill and of the order.
    const sales = parseCsv(files.get('sales_register_csv') ?? '')
    const roundOff = sales[0]?.indexOf('Round off (₹)') ?? -1
    expect(sales.map((r) => r[roundOff])).toContain('-0.4')
    const orders = parseCsv(files.get('report_orders_csv') ?? '')
    const orderRoundOff = orders[0]?.indexOf('roundOffPaise') ?? -1
    expect(orders.map((r) => r[orderRoundOff])).toContain('-40')
    // DOS-317 in the file too: each section ends on its total, with the DISTINCT documents and the
    // cancelled ones apart — the column of per-rate counts alone sums a two-rate bill twice.
    const gst = parseCsv(files.get('report_gstSalesRegister_csv') ?? '')
    const head = gst[0] ?? []
    const at = (name: string): number => head.indexOf(name)
    const totalOf = (section: string) => gst.find((r) => r[at('section')] === section)
    expect(totalOf('salesTotal')?.[at('documentCount')]).toBe('3')
    expect(totalOf('salesTotal')?.[at('cancelledDocumentCount')]).toBe('1')
    expect(totalOf('creditNoteTotal')?.[at('documentCount')]).toBe('3')
    expect(totalOf('creditNoteTotal')?.[at('cancelledDocumentCount')]).toBe('1')
    const perRow = gst
      .filter((r) => r[at('section')] === 'sales')
      .reduce((sum, r) => sum + Number(r[at('documentCount')]), 0)
    expect(
      perRow,
      'the per-row counts, summed, overcount — which is why the total row exists',
    ).toBe(4)
    // DOS-321 in the file too: the credit notes of the day beside what was billed.
    const daily = parseCsv(files.get('report_dailySales_csv') ?? '')
    const credited = daily[0]?.indexOf('creditedPaise') ?? -1
    expect(credited).toBeGreaterThan(0)
    expect(daily[1]?.[credited]).toBe('1639')
  })
})
