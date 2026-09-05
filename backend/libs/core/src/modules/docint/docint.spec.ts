import { createHash } from 'node:crypto'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { sql } from 'drizzle-orm'
import type { ExtractedInvoice, ExtractedLine } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  hsnRates,
  manufacturers,
  memberships,
  productAliases,
  productExternalCodes,
  productVariants,
  products,
  supplierPackConfigs,
  suppliers,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { ProcurementModule } from '../procurement/index.js'
import { DocintModule } from './index.js'
import { registerStubReading } from './pipeline/engines/index.js'

process.env.DOCINT_ENGINE = 'stub'
process.env.DOCINT_INLINE_JOBS = '1'
// Two failed arithmetic checks would auto-escalate to the second engine; the spec asserts on ONE
// reading per submit and exercises escalation by hand through extractions.run.
process.env.DOCINT_AUTO_ESCALATE = '0'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/**
 * "Page images": the stub engine never opens the bytes and the local driver stores whatever it is
 * given under a .png key, so a page is a small unique string — two documents that share every page
 * hash the same (the duplicate case), any other pair differs.
 */
const page = (run: string, tag: string, n: number): string =>
  Buffer.from(`docint-spec-${run}-${tag}-page-${String(n)}`).toString('base64')

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function makeGstin(stateCode: string, panLike: string, entityCode = '1'): string {
  const base = `${stateCode}${panLike.toUpperCase()}${entityCode}Z`
  let total = 0
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_ALPHABET.indexOf(base[i] ?? '0')
    const factor = i % 2 === 0 ? 1 : 2
    const product = value * factor
    total += Math.floor(product / 36) + (product % 36)
  }
  return `${base}${GSTIN_ALPHABET[(36 - (total % 36)) % 36] ?? '0'}`
}

interface DocBody {
  id: string
  status: string
  supplierId: string | null
  irn: string | null
  irnVerified: boolean
  qrStatus: string
  pageCount: number
  attemptCount: number
  failureCode: string | null
  rejectedReason: string | null
  committedEntityId: string | null
  pages: { pageNo: number; objectKey: string; readUrl: string; sha256: string | null }[]
  checkSummary: { errors: number; warnings: number } | null
  lock: { reviewerId: string; reviewerName: string | null } | null
  latestExtractionId: string | null
}
interface CheckBody {
  check: string
  passed: boolean
  severity: string
  lineNo: number | null
}
interface CandidateBody {
  id: string
  lineNo: number
  variantId: string
  score: number
  reason: string
  chosen: boolean
  matchedBy: string
  packPcsPerCase: number | null
}
interface SessionBody {
  id: string
  status: string
  reviewerId: string
  reviewerName: string | null
  editsCount: number
  blocking: number
  checks: CheckBody[]
  reviewed: {
    header: Record<string, unknown>
    lines: {
      lineNo: number
      variantId: string | null
      caseSize: number | null
      qtyPcs: number | null
      taxablePaise: number | null
    }[]
  }
}

describeDb('docint (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `1${run.slice(-7)}`
  const tenantGstin = makeGstin('27', `AADTR${run.slice(4, 8)}T`)
  const supplierGstin = makeGstin('27', `AAJST${run.slice(0, 4)}Q`)

  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerAId = uuidv7()
  const managerBId = uuidv7()
  const accountantId = uuidv7()
  const gateId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()
  const shopUserId = uuidv7()
  const otherOwnerId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const managerA: Actor = { tenantId, actorId: managerAId, role: 'manager' }
  const managerB: Actor = { tenantId, actorId: managerBId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const gate: Actor = { tenantId, actorId: gateId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const otherOwner: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  const supplierId = uuidv7()
  const variantA = uuidv7()
  const variantB = uuidv7()
  const variantC = uuidv7()
  const variantD = uuidv7()
  let app: NestFastifyApplication

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  const count = async (table: string, where = sql`true`): Promise<number> =>
    Number(
      (
        (
          await db.execute(
            sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
          )
        ).rows[0] as { n: number }
      ).n,
    )
  const outboxTypes = async (aggregateId: string): Promise<string[]> =>
    (
      (
        await db.execute(
          sql`select event_type from outbox_events where aggregate_id = ${aggregateId} order by id`,
        )
      ).rows as { event_type: string }[]
    ).map((r) => r.event_type)

  const sha = (b64: string): string =>
    createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')
  const contentHashOf = (pages: string[]): string =>
    createHash('sha256').update(pages.map(sha).join('\n')).digest('hex')

  /** The scripted reading: two green lines, one amber, one red; line 3 off by ₹4, total off by ₹9. */
  function reading(invoiceNo: string, opts: { fixed?: boolean } = {}): ExtractedInvoice {
    const line = (
      n: number,
      over: Partial<ExtractedLine>,
      cases: number,
      ratePaise: number,
    ): ExtractedLine => {
      const taxable = ratePaise * cases
      const tax = Math.round(taxable * 0.12)
      return {
        lineNo: n,
        description: `LINE ${String(n)}`,
        supplierCode: null,
        hsnCode: hsn,
        batchNo: `B${run}${String(n)}`,
        mfgDate: '2026-08-01',
        expiryDate: '2027-03-01',
        mrpPaise: 2000,
        printedQty: cases,
        printedUnit: 'CS',
        caseSize: 12,
        qtyPcs: cases * 12,
        freeQtyPcs: 0,
        ratePaise,
        rateBasis: 'case',
        basisQty: 12,
        discountBps: 0,
        discountPaise: 0,
        gstBps: 1200,
        cessBps: 0,
        taxablePaise: taxable,
        taxPaise: tax,
        lineTotalPaise: taxable + tax,
        evidence: {
          pageNo: 1,
          rowText: `${String(n)} ${over.description ?? 'LINE'} ${String(cases)} CS`,
          bbox: null,
        },
        ...over,
      }
    }
    const lines = [
      line(1, { description: `NAMKEEN CLASSIC 45G X 12 ${run}` }, 2, 12000),
      line(2, { description: `Namkeen Masala 45 g ${run}`, supplierCode: `EXT-${run}` }, 3, 12000),
      line(
        3,
        {
          description: 'NAMKEEN TANGY 45G',
          taxablePaise: opts.fixed ? 24000 : 24400,
          taxPaise: opts.fixed ? 2880 : 2928,
          lineTotalPaise: opts.fixed ? 26880 : 27328,
        },
        2,
        12000,
      ),
      line(
        4,
        {
          description: 'ZZZ UNKNOWN WAFERS 99G',
          hsnCode: '99999999',
          mrpPaise: 999,
          caseSize: null,
        },
        1,
        6000,
      ),
    ]
    const subtotal = lines.reduce((s, l) => s + (l.taxablePaise ?? 0), 0)
    const tax = lines.reduce((s, l) => s + (l.taxPaise ?? 0), 0)
    const total = lines.reduce((s, l) => s + (l.lineTotalPaise ?? 0), 0)
    return {
      header: {
        supplierName: `Namkeen Traders ${run}`,
        supplierGstin,
        buyerName: 'Docint Traders',
        buyerGstin: tenantGstin,
        invoiceNo,
        invoiceDate: new Date().toISOString().slice(0, 10),
        irn: null,
        ewayBillNo: null,
        placeOfSupplyState: '27',
        subtotalPaise: subtotal,
        discountPaise: 0,
        cgstPaise: tax / 2,
        sgstPaise: tax / 2,
        igstPaise: 0,
        cessPaise: 0,
        freightPaise: 0,
        roundOffPaise: 0,
        totalPaise: opts.fixed ? total : total + 900,
      },
      lines,
      fieldConfidence: { 'header.invoiceNo': 0.98, 'lines[2].taxablePaise': 0.61 },
      handwrittenAnnotations: [],
      pageCount: 2,
    }
  }

  /** Capture a document through the API as the gate: create, mint slots, register pages inline. */
  async function capture(
    actor: Actor,
    pages: string[],
    opts: { expectedPages?: number; tag: string; kind?: string; supplier?: boolean },
  ) {
    const id = uuidv7()
    const created = await call<{ item: DocBody }>(app, actor, 'POST', '/docint/documents', {
      idempotencyKey: `create-${opts.tag}-${run}`,
      id,
      kind: opts.kind ?? 'supplier_invoice',
      ...(opts.supplier === false ? {} : { supplierId }),
      ...(opts.expectedPages ? { expectedPages: opts.expectedPages } : {}),
      note: `spec ${opts.tag}`,
    })
    expect(created.status, `create ${opts.tag}: ${JSON.stringify(created.body)}`).toBe(200)
    const slots = await call<{
      slots: { pageNo: number; objectKey: string; url: string | null; inline: boolean }[]
    }>(app, actor, 'POST', `/docint/documents/${id}/pages/upload-urls`, {
      idempotencyKey: `slots-${opts.tag}-${run}`,
      id,
      pages: pages.map((_, i) => ({ pageNo: i + 1, mimeType: 'image/png', bytes: 70 })),
    })
    expect(slots.status, JSON.stringify(slots.body)).toBe(200)
    let last: DocBody | null = null
    for (const [i, png] of pages.entries()) {
      const slot = slots.body.slots[i]
      if (!slot) throw new Error('slot missing')
      const added = await call<{ item: DocBody }>(
        app,
        actor,
        'POST',
        `/docint/documents/${id}/pages`,
        {
          idempotencyKey: `page-${opts.tag}-${String(i + 1)}-${run}`,
          id,
          pageId: uuidv7(),
          pageNo: i + 1,
          mimeType: 'image/png',
          objectKey: slot.objectKey,
          contentBase64: png,
          printedPageLabel: `${String(i + 1)} of ${String(pages.length)}`,
        },
      )
      expect(
        added.status,
        `addPage ${opts.tag} ${String(i + 1)}: ${JSON.stringify(added.body)}`,
      ).toBe(200)
      last = added.body.item
    }
    return { id, detail: last, slots: slots.body.slots }
  }

  beforeAll(async () => {
    await db.insert(tenants).values([
      {
        id: tenantId,
        slug: `di-${run}`,
        legalName: 'Docint Traders',
        stateCode: '27',
        gstin: tenantGstin,
      },
      { id: otherTenantId, slug: `dj-${run}`, legalName: 'Other Traders', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91974${run}1`, name: 'Owner' },
      { id: managerAId, phone: `+91974${run}2`, name: 'Vikas Kadam' },
      { id: managerBId, phone: `+91974${run}3`, name: 'Second Manager' },
      { id: accountantId, phone: `+91974${run}4`, name: 'Accountant' },
      { id: gateId, phone: `+91974${run}5`, name: 'Gate' },
      { id: repId, phone: `+91974${run}6`, name: 'Rep' },
      { id: driverId, phone: `+91974${run}7`, name: 'Driver' },
      { id: shopUserId, phone: `+91974${run}8`, name: 'Shopkeeper' },
      { id: otherOwnerId, phone: `+91974${run}9`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerAId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: managerBId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: gateId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)
    await db.insert(suppliers).values({
      id: supplierId,
      tenantId,
      name: `Namkeen Traders ${run}`,
      gstin: supplierGstin,
      stateCode: '27',
      eInvoicing: true,
      paymentTermsDays: 21,
    })
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker di ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: `Namkeen ${run}`, category: 'namkeen' })
    const variant = (id: string, name: string) => ({
      id,
      productId,
      name,
      netQty: 45,
      netUnit: 'g' as const,
      defaultCaseSize: 24,
      hsnCode: hsn,
      mrpPaise: 2000,
    })
    // The dated rate for the spec's HSN: without it a run whose HSN happens to share a 4-digit prefix
    // with a real code would draw an amber `hsn_dated_rate` and the "only reds" assertions would drift.
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })
    await db
      .insert(productVariants)
      .values([
        variant(variantA, `Namkeen Classic 45 g ${run}`),
        variant(variantB, `Namkeen Masala 45 g ${run}`),
        variant(variantC, `Namkeen Tangy 45 g ${run}`),
        variant(variantD, `Namkeen Wafers 99 g ${run}`),
      ])
    // The tenant has resolved line 1's printed description before (green via supplier_alias, pack of 12).
    await db.insert(supplierPackConfigs).values({
      id: uuidv7(),
      tenantId,
      supplierId,
      variantId: variantA,
      pcsPerCase: 12,
      supplierCode: 'NC45',
      supplierDescription: `NAMKEEN CLASSIC 45G X 12 ${run}`,
    })
    // Line 2's printed supplier code is a curated external code (green via external_code).
    await db
      .insert(productExternalCodes)
      .values({ id: uuidv7(), variantId: variantB, system: 'spec', code: `EXT-${run}` })
    await db.insert(productAliases).values({
      id: uuidv7(),
      variantId: variantC,
      alias: `NAMKEEN TANGY 45G ${run} X 12`,
      normalized: `namkeen tangy 45g ${run} x 12`,
      source: 'docint',
    })
    app = await bootTestApp([ProcurementModule, DocintModule])
  })

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // shared across the ordered steps below
  let docId = ''
  let extractionId = ''
  let sessionId = ''
  let supplierInvoiceId = ''
  let acceptedVariant = ''
  const invoiceNo = `NT/26-27/${run.slice(-4)}`

  it('captures a bill at the gate: create → upload slots → pages → submit runs the pipeline inline', async () => {
    const pages = [page(run, 'main', 1), page(run, 'main', 2)]
    registerStubReading(contentHashOf(pages), reading(invoiceNo))
    const captured = await capture(gate, pages, { expectedPages: 2, tag: 'main' })
    docId = captured.id
    expect(captured.slots[0]?.objectKey).toBe(`tenant/${tenantId}/docs/${docId}/page-1.png`)
    expect(captured.slots[0]?.url).toContain('/storage/')
    expect(captured.detail?.pageCount).toBe(2)
    expect(captured.detail?.pages[0]?.readUrl).toContain('/storage/')
    expect(captured.detail?.pages[0]?.sha256).toBe(sha(page(run, 'main', 1)))

    const submitted = await call<{ item: DocBody; jobId: string | null }>(
      app,
      gate,
      'POST',
      `/docint/documents/${docId}/submit`,
      {
        idempotencyKey: `submit-main-${run}`,
        id: docId,
      },
    )
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    // Two red checks (line 3 arithmetic, total) and an amber/red line → needs_review, never extracted.
    expect(submitted.body.item.status).toBe('needs_review')
    expect(submitted.body.item.attemptCount).toBe(1)
    // The gate reads the document but not the priced rows: RLS hides them, so the summary is null.
    expect(submitted.body.item.checkSummary).toBeNull()
    expect(submitted.body.item.latestExtractionId).toBeNull()
    expect(await outboxTypes(docId)).toEqual([
      'docint.document.submitted',
      'docint.document.extracted',
      'docint.document.needs_review',
    ])

    const asDesk = await call<{ item: DocBody }>(app, managerA, 'GET', `/docint/documents/${docId}`)
    expect(asDesk.status).toBe(200)
    expect(asDesk.body.item.checkSummary?.errors).toBe(2)
    expect(asDesk.body.item.latestExtractionId).not.toBeNull()
    extractionId = asDesk.body.item.latestExtractionId ?? ''

    const extractions = await call<{
      items: {
        id: string
        engine: string
        model: string
        lineCount: number
        checks: CheckBody[]
        result: ExtractedInvoice | null
      }[]
    }>(app, managerA, 'GET', `/docint/documents/${docId}/extractions`, { includeResult: true })
    expect(extractions.status).toBe(200)
    expect(extractions.body.items).toHaveLength(1)
    const ex = extractions.body.items[0]
    expect(ex?.engine).toBe('llm_vision')
    expect(ex?.model).toBe('claude-sonnet-5')
    expect(ex?.lineCount).toBe(4)
    expect(ex?.result?.fieldConfidence['lines[2].taxablePaise']).toBe(0.61)
    const failed = (ex?.checks ?? []).filter((c) => !c.passed)
    expect(failed.map((c) => `${c.check}:${String(c.lineNo)}`)).toEqual(
      expect.arrayContaining(['line_arithmetic:3', 'sum_lines_equals_total:null']),
    )
    expect(failed.every((c) => c.severity === 'error')).toBe(true)
  })

  it('replays submit idempotently: one reading, one submitted event, the same body', async () => {
    const again = await call<{ item: DocBody }>(
      app,
      gate,
      'POST',
      `/docint/documents/${docId}/submit`,
      {
        idempotencyKey: `submit-main-${run}`,
        id: docId,
      },
    )
    expect(again.status).toBe(200)
    expect(again.body.item.status).toBe('needs_review')
    expect(await count('extractions', sql`document_id = ${docId}`)).toBe(1)
    expect(
      (await outboxTypes(docId)).filter((t) => t === 'docint.document.submitted'),
    ).toHaveLength(1)
    const changed = await call(app, gate, 'POST', `/docint/documents/${docId}/submit`, {
      idempotencyKey: `submit-main-${run}`,
      id: docId,
      deviceId: 'another-phone',
    })
    expect(changed.status).toBe(409)
  })

  it('ranks the SKU candidates: alias green, external code green, trigram amber, unknown red', async () => {
    const matches = await call<{ items: CandidateBody[] }>(
      app,
      managerA,
      'GET',
      `/docint/extractions/${extractionId}/candidates`,
    )
    expect(matches.status, JSON.stringify(matches.body)).toBe(200)
    const byLine = (n: number) => matches.body.items.filter((c) => c.lineNo === n)
    expect(byLine(1)[0]).toMatchObject({
      variantId: variantA,
      reason: 'supplier_alias',
      chosen: true,
      matchedBy: 'auto',
      packPcsPerCase: 12,
    })
    expect(byLine(1)[0]?.score).toBeGreaterThanOrEqual(0.9)
    expect(byLine(2)[0]).toMatchObject({
      variantId: variantB,
      reason: 'external_code',
      chosen: true,
    })
    const third = byLine(3)
    expect(third.length).toBeGreaterThanOrEqual(1)
    expect(third.some((c) => c.chosen)).toBe(false)
    expect(third[0]?.reason).toBe('trgm')
    expect(byLine(4)).toHaveLength(0)
    const queue = await call<{
      items: {
        documentId: string
        redCount: number
        unmatchedLines: number
        totalPaise: number | null
        invoiceNo: string | null
      }[]
    }>(app, managerA, 'GET', '/docint/queue', { status: 'needs_review', supplierId })
    expect(queue.status).toBe(200)
    const row = queue.body.items.find((i) => i.documentId === docId)
    expect(row).toMatchObject({ redCount: 2, unmatchedLines: 2, invoiceNo })
    expect(row?.totalPaise).toBeGreaterThan(0)
  })

  it('lets the reviewer accept a candidate and choose another variant; the pack is remembered', async () => {
    const third = await call<{ items: CandidateBody[] }>(
      app,
      managerA,
      'GET',
      `/docint/extractions/${extractionId}/candidates`,
      { lineNo: 3 },
    )
    const candidate = third.body.items.find((c) => c.variantId === variantC) ?? third.body.items[0]
    if (!candidate) throw new Error('no candidate on line 3')
    acceptedVariant = candidate.variantId
    const accepted = await call<{ line: { band: string; items: CandidateBody[] } }>(
      app,
      managerA,
      'POST',
      `/docint/extractions/${extractionId}/matches/accept`,
      {
        idempotencyKey: `accept-3-${run}`,
        id: extractionId,
        lineNo: 3,
        candidateId: candidate.id,
      },
    )
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body.line.band).toBe('green')
    expect(accepted.body.line.items.find((c) => c.id === candidate.id)?.chosen).toBe(true)

    const chosen = await call<{ line: { band: string; items: CandidateBody[] } }>(
      app,
      managerA,
      'POST',
      `/docint/extractions/${extractionId}/matches/choose`,
      {
        idempotencyKey: `choose-4-${run}`,
        id: extractionId,
        lineNo: 4,
        variantId: variantD,
        pcsPerCase: 120,
      },
    )
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(200)
    expect(chosen.body.line.band).toBe('green')
    expect(chosen.body.line.items[0]).toMatchObject({
      variantId: variantD,
      reason: 'reviewer',
      matchedBy: 'reviewer',
      chosen: true,
      packPcsPerCase: 120,
    })
    const pack = (
      await db.execute(
        sql`select pcs_per_case, supplier_description from supplier_pack_configs where tenant_id = ${tenantId} and variant_id = ${variantD}`,
      )
    ).rows[0] as { pcs_per_case: number; supplier_description: string } | undefined
    expect(pack).toMatchObject({
      pcs_per_case: 120,
      supplier_description: 'ZZZ UNKNOWN WAFERS 99G',
    })
    // The global alias table is curator-only: the reviewer's pick never wrote there.
    expect(await count('product_aliases', sql`variant_id = ${variantD}`)).toBe(0)
    const rerun = await call<{ green: number; amber: number; red: number }>(
      app,
      managerA,
      'POST',
      `/docint/extractions/${extractionId}/rematch`,
      {
        idempotencyKey: `rerun-${run}`,
        id: extractionId,
      },
    )
    expect(rerun.status).toBe(200)
    expect(rerun.body).toEqual({ green: 4, amber: 0, red: 0 })
  })

  it('holds a single-writer review lock: the second manager sees who has it', async () => {
    sessionId = uuidv7()
    const started = await call<{ session: SessionBody }>(
      app,
      managerA,
      'POST',
      `/docint/documents/${docId}/review`,
      {
        idempotencyKey: `review-a-${run}`,
        id: docId,
        sessionId,
      },
    )
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    expect(started.body.session).toMatchObject({
      status: 'open',
      reviewerId: managerAId,
      reviewerName: 'Vikas Kadam',
      editsCount: 0,
    })
    expect(started.body.session.reviewed.lines.map((l) => l.variantId)).toEqual([
      variantA,
      variantB,
      acceptedVariant,
      variantD,
    ])
    expect(started.body.session.reviewed.lines[3]?.caseSize).toBe(120)
    expect(started.body.session.blocking).toBeGreaterThanOrEqual(2)

    const second = await call<{ message: string; data?: { code: string; reviewerName: string } }>(
      app,
      managerB,
      'POST',
      `/docint/documents/${docId}/review`,
      {
        idempotencyKey: `review-b-${run}`,
        id: docId,
        sessionId: uuidv7(),
      },
    )
    expect(second.status).toBe(409)
    expect(second.body.data?.code).toBe('locked')
    expect(second.body.data?.reviewerName).toBe('Vikas Kadam')

    const beat = await call<{ lockedUntil: string }>(
      app,
      managerA,
      'POST',
      `/docint/review-sessions/${sessionId}/heartbeat`,
      {
        idempotencyKey: `beat-${run}`,
        id: sessionId,
      },
    )
    expect(beat.status).toBe(200)
    const foreignBeat = await call(
      app,
      managerB,
      'POST',
      `/docint/review-sessions/${sessionId}/heartbeat`,
      {
        idempotencyKey: `beat-b-${run}`,
        id: sessionId,
      },
    )
    expect(foreignBeat.status).toBe(403)

    const released = await call<{ session: SessionBody }>(
      app,
      managerA,
      'POST',
      `/docint/review-sessions/${sessionId}/release`,
      {
        idempotencyKey: `release-a-${run}`,
        id: sessionId,
      },
    )
    expect(released.status).toBe(200)
    expect(released.body.session.status).toBe('abandoned')
    const doc = await call<{ item: DocBody }>(app, managerA, 'GET', `/docint/documents/${docId}`)
    // Released, but the two red checks still stand: the document is flagged again, not "ready".
    expect(doc.body.item.status).toBe('needs_review')
    expect(doc.body.item.lock).toBeNull()

    const bStarts = await call<{ session: SessionBody }>(
      app,
      managerB,
      'POST',
      `/docint/documents/${docId}/review`,
      {
        idempotencyKey: `review-b2-${run}`,
        id: docId,
        sessionId: uuidv7(),
      },
    )
    expect(bStarts.status).toBe(200)
    await call(
      app,
      managerB,
      'POST',
      `/docint/review-sessions/${bStarts.body.session.id}/release`,
      {
        idempotencyKey: `release-b-${run}`,
        id: bStarts.body.session.id,
      },
    )
    sessionId = uuidv7()
    const aAgain = await call<{ session: SessionBody }>(
      app,
      managerA,
      'POST',
      `/docint/documents/${docId}/review`,
      {
        idempotencyKey: `review-a2-${run}`,
        id: docId,
        sessionId,
      },
    )
    expect(aAgain.status).toBe(200)
  })

  it('logs every correction, refuses submit while a red stands, then submits once fixed', async () => {
    const blocked = await call<{ data?: { code: string } }>(
      app,
      managerA,
      'POST',
      `/docint/review-sessions/${sessionId}/submit`,
      {
        idempotencyKey: `submit-review-early-${run}`,
        id: sessionId,
      },
    )
    expect(blocked.status).toBe(400)
    expect(blocked.body.data?.code).toBe('checks_blocking')

    const fixed = reading(invoiceNo, { fixed: true })
    const saved = await call<{ session: SessionBody; blocking: number; checks: CheckBody[] }>(
      app,
      managerA,
      'POST',
      `/docint/review-sessions/${sessionId}`,
      {
        idempotencyKey: `save-${run}`,
        id: sessionId,
        patch: {
          header: {
            subtotalPaise: fixed.header.subtotalPaise,
            cgstPaise: fixed.header.cgstPaise,
            sgstPaise: fixed.header.sgstPaise,
            totalPaise: fixed.header.totalPaise,
          },
          lines: [{ lineNo: 3, taxablePaise: 24000, taxPaise: 2880, lineTotalPaise: 26880 }],
        },
      },
    )
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.session.editsCount).toBe(7)
    expect(saved.body.blocking).toBe(0)
    expect(await count('corrections_log', sql`review_session_id = ${sessionId}`)).toBe(7)
    const paths = (
      (
        await db.execute(
          sql`select path from corrections_log where review_session_id = ${sessionId} order by path`,
        )
      ).rows as { path: string }[]
    ).map((r) => r.path)
    expect(paths).toContain('lines[2].taxablePaise')
    expect(paths).toContain('header.totalPaise')

    const gstinByManager = await call(
      app,
      managerA,
      'POST',
      `/docint/review-sessions/${sessionId}`,
      {
        idempotencyKey: `save-gstin-${run}`,
        id: sessionId,
        patch: { header: { buyerGstin: supplierGstin } },
      },
    )
    expect(gstinByManager.status).toBe(403)

    const submitted = await call<{ session: SessionBody; blocking: number }>(
      app,
      managerA,
      'POST',
      `/docint/review-sessions/${sessionId}/submit`,
      {
        idempotencyKey: `submit-review-${run}`,
        id: sessionId,
      },
    )
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(submitted.body.session.status).toBe('submitted')
    expect(submitted.body.blocking).toBe(0)
    const doc = await call<{ item: DocBody }>(app, managerA, 'GET', `/docint/documents/${docId}`)
    expect(doc.body.item.status).toBe('reviewed')
    expect(await outboxTypes(docId)).toContain('docint.document.reviewed')
  })

  it('approves into a supplier invoice DRAFT and posts nothing to stock, cost or the journal', async () => {
    const before = {
      ledger: await count('stock_ledger', sql`tenant_id = ${tenantId}`),
      lots: await count('stock_lots', sql`tenant_id = ${tenantId}`),
      costs: await count('tenant_product_costs', sql`tenant_id = ${tenantId}`),
      journal: await count('journal_lines', sql`tenant_id = ${tenantId}`),
      balances: await count('stock_balances', sql`tenant_id = ${tenantId}`),
    }
    supplierInvoiceId = uuidv7()
    const lineIds = [1, 2, 3, 4].map((lineNo) => ({ lineNo, id: uuidv7() }))
    const approved = await call<{
      item: DocBody
      supplierInvoice: {
        id: string
        source: string
        status: string
        documentId: string | null
        totalPaise: number
        lines: { lineNo: number; variantId: string | null; qtyPcs: number }[]
      }
    }>(app, accountant, 'POST', `/docint/documents/${docId}/approve`, {
      idempotencyKey: `approve-${run}`,
      id: docId,
      supplierInvoiceId,
      lineIds,
    })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.item.status).toBe('committed')
    expect(approved.body.item.committedEntityId).toBe(supplierInvoiceId)
    expect(approved.body.supplierInvoice).toMatchObject({
      id: supplierInvoiceId,
      source: 'docint',
      status: 'approved',
      documentId: docId,
      totalPaise: 100800,
    })
    expect(approved.body.supplierInvoice.lines.map((l) => l.variantId)).toEqual([
      variantA,
      variantB,
      acceptedVariant,
      variantD,
    ])
    const printed = (
      await db.execute(
        sql`select rate_basis::text as rate_basis, basis_qty from supplier_invoice_lines where supplier_invoice_id = ${supplierInvoiceId} order by line_no`,
      )
    ).rows as { rate_basis: string; basis_qty: number }[]
    expect(printed).toEqual([
      { rate_basis: 'case', basis_qty: 12 },
      { rate_basis: 'case', basis_qty: 12 },
      { rate_basis: 'case', basis_qty: 12 },
      { rate_basis: 'case', basis_qty: 12 },
    ])
    expect({
      ledger: await count('stock_ledger', sql`tenant_id = ${tenantId}`),
      lots: await count('stock_lots', sql`tenant_id = ${tenantId}`),
      costs: await count('tenant_product_costs', sql`tenant_id = ${tenantId}`),
      journal: await count('journal_lines', sql`tenant_id = ${tenantId}`),
      balances: await count('stock_balances', sql`tenant_id = ${tenantId}`),
    }).toEqual(before)
    expect(await count('grns', sql`supplier_invoice_id = ${supplierInvoiceId}`)).toBe(0)
    expect(await outboxTypes(supplierInvoiceId)).toEqual(['docint.supplier_invoice.drafted'])
    // The supplier's printed name is now an alias the next capture resolves.
    expect(
      await count('supplier_aliases', sql`tenant_id = ${tenantId} and supplier_id = ${supplierId}`),
    ).toBe(1)

    const replay = await call<{ supplierInvoice: { id: string } }>(
      app,
      accountant,
      'POST',
      `/docint/documents/${docId}/approve`,
      {
        idempotencyKey: `approve-${run}`,
        id: docId,
        supplierInvoiceId,
        lineIds,
      },
    )
    expect(replay.status).toBe(200)
    expect(replay.body.supplierInvoice.id).toBe(supplierInvoiceId)
    expect(await count('supplier_invoices', sql`document_id = ${docId}`)).toBe(1)

    const rejectCommitted = await call(app, managerA, 'POST', `/docint/documents/${docId}/reject`, {
      idempotencyKey: `reject-committed-${run}`,
      id: docId,
      reason: 'duplicate',
    })
    expect(rejectCommitted.status).toBe(409)
  })

  it('flags a duplicate invoice number on the next bill and refuses approve out of state; reject records the reason', async () => {
    const pages = [page(run, 'dup', 1), page(run, 'dup', 2)]
    registerStubReading(contentHashOf(pages), reading(invoiceNo, { fixed: true }))
    const dup = await capture(managerA, pages, { tag: 'dup' })
    const submitted = await call<{ item: DocBody }>(
      app,
      managerA,
      'POST',
      `/docint/documents/${dup.id}/submit`,
      {
        idempotencyKey: `submit-dup-${run}`,
        id: dup.id,
      },
    )
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(submitted.body.item.status).toBe('needs_review')
    const listed = await call<{ items: { id: string; checks: CheckBody[] }[] }>(
      app,
      managerA,
      'GET',
      `/docint/documents/${dup.id}/extractions`,
    )
    const duplicate = listed.body.items[0]?.checks.find((c) => c.check === 'duplicate_invoice')
    expect(duplicate).toMatchObject({ passed: false, severity: 'error' })

    const early = await call(app, managerA, 'POST', `/docint/documents/${dup.id}/approve`, {
      idempotencyKey: `approve-dup-${run}`,
      id: dup.id,
      supplierInvoiceId: uuidv7(),
      lineIds: [{ lineNo: 1, id: uuidv7() }],
    })
    expect(early.status).toBe(409)

    const rejected = await call<{ item: DocBody }>(
      app,
      managerA,
      'POST',
      `/docint/documents/${dup.id}/reject`,
      {
        idempotencyKey: `reject-dup-${run}`,
        id: dup.id,
        reason: 'duplicate',
        note: 'already booked from the first photo',
      },
    )
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)
    expect(rejected.body.item.status).toBe('rejected')
    expect(rejected.body.item.rejectedReason).toBe('duplicate')
    const list = await call<{ items: { id: string; status: string }[] }>(
      app,
      managerA,
      'GET',
      '/docint/documents',
      { status: 'rejected', supplierId },
    )
    expect(list.body.items.map((i) => i.id)).toContain(dup.id)
  })

  it('refuses the same pages twice, blocks submit on a missing page, and reads the QR', async () => {
    const late = await call(app, gate, 'POST', `/docint/documents/${docId}/pages`, {
      idempotencyKey: `late-page-${run}`,
      id: docId,
      pageId: uuidv7(),
      pageNo: 3,
      mimeType: 'image/png',
      objectKey: `tenant/${tenantId}/docs/${docId}/page-3.png`,
      contentBase64: page(run, 'main', 3),
    })
    expect(late.status).toBe(409) // committed: no more pages

    // The main bill photographed again: page 1 is fine on its own, page 2 completes the same hash → 409.
    const twinId = uuidv7()
    const created = await call(app, gate, 'POST', '/docint/documents', {
      idempotencyKey: `create-twin-${run}`,
      id: twinId,
      kind: 'supplier_invoice',
      supplierId,
    })
    expect(created.status).toBe(200)
    const p1 = await call(app, gate, 'POST', `/docint/documents/${twinId}/pages`, {
      idempotencyKey: `twin-1-${run}`,
      id: twinId,
      pageId: uuidv7(),
      pageNo: 1,
      mimeType: 'image/png',
      objectKey: `tenant/${tenantId}/docs/${twinId}/page-1.png`,
      contentBase64: page(run, 'main', 1),
    })
    expect(p1.status).toBe(200)
    const p2 = await call<{ data?: { code: string; documentId: string } }>(
      app,
      gate,
      'POST',
      `/docint/documents/${twinId}/pages`,
      {
        idempotencyKey: `twin-2-${run}`,
        id: twinId,
        pageId: uuidv7(),
        pageNo: 2,
        mimeType: 'image/png',
        objectKey: `tenant/${tenantId}/docs/${twinId}/page-2.png`,
        contentBase64: page(run, 'main', 2),
      },
    )
    expect(p2.status).toBe(409)
    expect(p2.body.data).toMatchObject({ code: 'duplicate_document', documentId: docId })

    const short = await capture(gate, [page(run, 'short', 1)], { expectedPages: 3, tag: 'short' })
    const blocked = await call<{ data?: { code: string; missing: number[] } }>(
      app,
      gate,
      'POST',
      `/docint/documents/${short.id}/submit`,
      {
        idempotencyKey: `submit-short-${run}`,
        id: short.id,
      },
    )
    expect(blocked.status).toBe(400)
    expect(blocked.body.data).toMatchObject({ code: 'pages_missing', missing: [2, 3] })

    const irn = 'ab'.repeat(32)
    const qrText = JSON.stringify({
      SellerGstin: supplierGstin,
      BuyerGstin: tenantGstin,
      DocNo: `QR/${run}`,
      DocTyp: 'INV',
      DocDt: '01/09/2026',
      TotInvVal: 1008.0,
      ItemCnt: 4,
      MainHsnCode: hsn.slice(0, 4),
      Irn: irn,
      IrnDt: '2026-09-01 09:12:00',
    })
    const qr = await call<{
      item: DocBody
      qr: { irn: string; docNo: string } | null
      duplicate: { documentId: string | null } | null
    }>(app, gate, 'POST', `/docint/documents/${short.id}/qr`, {
      idempotencyKey: `qr-short-${run}`,
      id: short.id,
      qrText,
    })
    expect(qr.status, JSON.stringify(qr.body)).toBe(200)
    expect(qr.body.qr?.irn).toBe(irn)
    expect(qr.body.duplicate).toBeNull()
    expect(qr.body.item).toMatchObject({ irn, qrStatus: 'decoded', irnVerified: false, supplierId })

    const twin = await capture(gate, [page(run, 'qr-twin', 1)], { tag: 'qr-twin', supplier: false })
    const qr2 = await call<{ item: DocBody; duplicate: { documentId: string | null } | null }>(
      app,
      gate,
      'POST',
      `/docint/documents/${twin.id}/qr`,
      {
        idempotencyKey: `qr-twin-${run}`,
        id: twin.id,
        qrText,
      },
    )
    expect(qr2.status).toBe(200)
    expect(qr2.body.duplicate?.documentId).toBe(short.id)
    expect(qr2.body.item.irn).toBeNull()
    expect(qr2.body.item.supplierId).toBe(supplierId)
    const garbage = await call<{ qr: unknown }>(
      app,
      gate,
      'POST',
      `/docint/documents/${twin.id}/qr`,
      {
        idempotencyKey: `qr-garbage-${run}`,
        id: twin.id,
        qrText: 'not a qr at all',
      },
    )
    expect(garbage.status).toBe(200)
    expect(garbage.body.qr).toBeNull()
  })

  it('escalates by hand to the secondary engine and keeps the better reading as the base', async () => {
    const pages = [page(run, 'esc', 1), page(run, 'esc', 2)]
    registerStubReading(contentHashOf(pages), reading(`ESC/${run}`))
    const doc = await capture(managerA, pages, { tag: 'esc' })
    const submitted = await call<{ item: DocBody }>(
      app,
      managerA,
      'POST',
      `/docint/documents/${doc.id}/submit`,
      { idempotencyKey: `submit-esc-${run}`, id: doc.id },
    )
    expect(submitted.status).toBe(200)
    const noForce = await call(app, managerA, 'POST', `/docint/documents/${doc.id}/extract`, {
      idempotencyKey: `esc-noforce-${run}`,
      id: doc.id,
      engine: 'llm_vision_secondary',
    })
    expect(noForce.status).toBe(409)
    registerStubReading(contentHashOf(pages), reading(`ESC/${run}`, { fixed: true }))
    const escalated = await call<{ item: DocBody }>(
      app,
      managerA,
      'POST',
      `/docint/documents/${doc.id}/extract`,
      {
        idempotencyKey: `esc-force-${run}`,
        id: doc.id,
        engine: 'llm_vision_secondary',
        force: true,
      },
    )
    expect(escalated.status, JSON.stringify(escalated.body)).toBe(200)
    expect(escalated.body.item.attemptCount).toBe(2)
    const list = await call<{
      items: {
        id: string
        engine: string
        model: string
        escalatedFromExtractionId: string | null
        checks: CheckBody[]
      }[]
    }>(app, managerA, 'GET', `/docint/documents/${doc.id}/extractions`)
    expect(list.body.items).toHaveLength(2)
    const second = list.body.items.find((e) => e.engine === 'llm_vision_secondary')
    expect(second?.model).toBe('claude-opus-5')
    expect(second?.escalatedFromExtractionId).toBe(
      list.body.items.find((e) => e.engine === 'llm_vision')?.id,
    )
    expect(second?.checks.filter((c) => !c.passed && c.severity === 'error')).toHaveLength(0)
    expect(escalated.body.item.latestExtractionId).toBe(second?.id)
    expect(await count('engine_disagreements', sql`document_id = ${doc.id}`)).toBeGreaterThan(0)
  })

  it('keeps the gate on the capture surface: no rate on its wire, 403 on the priced procedures', async () => {
    const detail = await call<{ item: DocBody }>(app, gate, 'GET', `/docint/documents/${docId}`)
    expect(detail.status).toBe(200)
    const json = JSON.stringify(detail.body)
    for (const key of [
      'ratePaise',
      'totalPaise',
      'taxablePaise',
      'lineTotalPaise',
      'subtotalPaise',
      'costPaise',
    ])
      expect(json, key).not.toContain(`"${key}"`)
    const status = await call<{
      status: string
      checkSummary: unknown
      latestExtractionId: unknown
    }>(app, gate, 'GET', `/docint/documents/${docId}/status`)
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      status: 'committed',
      checkSummary: null,
      latestExtractionId: null,
    })
    const pageUrl = await call<{ url: string }>(
      app,
      gate,
      'GET',
      `/docint/documents/${docId}/page-url`,
      { pageNo: 1 },
    )
    expect(pageUrl.status).toBe(200)
    expect(pageUrl.body.url).toContain('/storage/')
    const mine = await call<{ items: { id: string }[] }>(app, gate, 'GET', '/docint/documents', {
      mine: true,
    })
    expect(mine.body.items.map((i) => i.id)).toContain(docId)

    const refused: [string, string, Record<string, unknown> | undefined][] = [
      ['GET', `/docint/documents/${docId}/extractions`, undefined],
      ['GET', `/docint/extractions/${extractionId}/candidates`, undefined],
      ['GET', '/docint/queue', undefined],
      ['GET', '/docint/stats', { from: '2026-01-01', to: '2026-12-31' }],
      [
        'POST',
        `/docint/documents/${docId}/review`,
        { idempotencyKey: `g-review-${run}`, id: docId, sessionId: uuidv7() },
      ],
      [
        'POST',
        `/docint/documents/${docId}/approve`,
        {
          idempotencyKey: `g-approve-${run}`,
          id: docId,
          supplierInvoiceId: uuidv7(),
          lineIds: [{ lineNo: 1, id: uuidv7() }],
        },
      ],
      [
        'POST',
        `/docint/documents/${docId}/reject`,
        { idempotencyKey: `g-reject-${run}`, id: docId, reason: 'other' },
      ],
    ]
    for (const [method, path, payload] of refused) {
      const res = await call(app, gate, method as 'GET' | 'POST', path, payload)
      expect(res.status, `${method} ${path}`).toBe(403)
    }
    // And the database agrees: the gate reads zero rows of every priced docint table.
    for (const table of [
      'extractions',
      'extraction_checks',
      'sku_match_candidates',
      'review_sessions',
      'corrections_log',
    ]) {
      const n = Number(
        (
          (
            await as(ctxOf(gateId, 'warehouse'), (tx) =>
              tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`),
            )
          ).rows[0] as { n: number }
        ).n,
      )
      expect(n, table).toBe(0)
    }
  })

  it('answers the alarm surface for the desk', async () => {
    const stats = await call<{
      documents: number
      committed: number
      rejected: number
      escalated: number
      editsPerTenLines: number
      bySupplier: { supplierId: string; documents: number }[]
    }>(app, owner, 'GET', '/docint/stats', { from: '2026-01-01', to: '2027-12-31', supplierId })
    expect(stats.status, JSON.stringify(stats.body)).toBe(200)
    expect(stats.body.committed).toBeGreaterThanOrEqual(1)
    expect(stats.body.rejected).toBeGreaterThanOrEqual(1)
    expect(stats.body.escalated).toBeGreaterThanOrEqual(1)
    expect(stats.body.editsPerTenLines).toBeGreaterThan(0)
    expect(
      stats.body.bySupplier.find((s) => s.supplierId === supplierId)?.documents,
    ).toBeGreaterThanOrEqual(2)
  })

  it('refuses the field, the shop and the stranger; 401 without a token', async () => {
    for (const actor of [rep, driver, shop]) {
      const res = await call(app, actor, 'GET', '/docint/documents')
      expect(res.status, actor.role).toBe(403)
      const create = await call(app, actor, 'POST', '/docint/documents', {
        idempotencyKey: `x-${actor.role}-${run}`,
        id: uuidv7(),
        kind: 'pod',
      })
      expect(create.status, actor.role).toBe(403)
    }
    expect((await call(app, null, 'GET', '/docint/documents')).status).toBe(401)
    expect((await call(app, null, 'GET', `/docint/documents/${docId}`)).status).toBe(401)
    const stranger = await call(app, otherOwner, 'GET', `/docint/documents/${docId}`)
    expect(stranger.status).toBe(404)
    const strangerList = await call<{ items: { id: string }[] }>(
      app,
      otherOwner,
      'GET',
      '/docint/documents',
    )
    expect(strangerList.status).toBe(200)
    expect(strangerList.body.items).toHaveLength(0)
    const strangerExtraction = await call(
      app,
      otherOwner,
      'GET',
      `/docint/extractions/${extractionId}`,
    )
    expect(strangerExtraction.status).toBe(404)
  })
})
