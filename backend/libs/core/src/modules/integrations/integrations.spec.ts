import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { sql } from 'drizzle-orm'
import type {
  ExportDownloadUrl,
  ExportJob,
  ImportJob,
  ImportJobDetail,
  ImportProfile,
  ImportRow,
  TallyMapping,
} from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  brands,
  createDb,
  createPool,
  manufacturers,
  memberships,
  productVariants,
  products,
  retailers,
  supplierInvoices,
  suppliers,
  tenantBrands,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { FilesModule } from '../files/index.js'
import { ExportJobsService, IntegrationsModule, builtinProfileId } from './index.js'
import { writeXlsx } from './xlsx.js'

process.env.INTEGRATIONS_INLINE_JOBS = '1'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name: string): string => readFileSync(join(fixtures, name), 'utf8')

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

interface Rollback {
  item: ImportJob
  reversedRows: number
  reversedByEntity: Record<string, number>
}

describeDb('integrations (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantGstin = makeGstin('27', `AADTR${run.slice(4, 8)}I`)

  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const repId = uuidv7()
  const gateId = uuidv7()
  const driverId = uuidv7()
  const shopUserId = uuidv7()
  const otherOwnerId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const gate: Actor = { tenantId, actorId: gateId, role: 'warehouse' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const otherOwner: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  /** Run-specific EANs replace the fixture's `89012345000NN` so the global unique index never collides. */
  const ean = (n: number): string => `890${run}${String(n).padStart(2, '0')}`
  const withRunEans = (csv: string): string =>
    csv.replace(/89012345000(\d\d)/g, (_, nn: string) => ean(Number(nn)))

  const retailerIds: Record<string, string> = {}
  const variantIds: Record<string, string> = {}
  const supplierId = uuidv7()
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

  /** The real wizard's first step: mint the upload, PUT the bytes through the local storage route, hand back the key. */
  async function upload(
    actor: Actor,
    jobId: string,
    fileName: string,
    body: Buffer,
    mimeType: 'text/csv' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ): Promise<string> {
    const minted = await call<{
      objectKey: string
      url: string | null
      headers: Record<string, string>
    }>(app, actor, 'POST', '/files/upload-url', {
      idempotencyKey: `upload-${jobId}-${run}`,
      id: uuidv7(),
      domain: 'import',
      entityId: jobId,
      mimeType,
      bytes: body.byteLength,
    })
    expect(minted.status, JSON.stringify(minted.body)).toBe(200)
    expect(minted.body.url).toBeTruthy()
    const put = await app.inject({
      method: 'PUT',
      url: minted.body.url ?? '',
      headers: { 'content-type': mimeType },
      payload: body,
    })
    expect(put.statusCode, put.body).toBe(200)
    void fileName
    return minted.body.objectKey
  }

  async function createImport(
    actor: Actor,
    opts: {
      source: string
      target: string
      file: string
      body: Buffer
      profileKey?: string
      tag: string
      mime?: 'text/csv' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      sheetName?: string
    },
  ): Promise<ImportJob> {
    const id = uuidv7()
    const key = await upload(actor, id, opts.file, opts.body, opts.mime ?? 'text/csv')
    const created = await call<{ item: ImportJob }>(app, actor, 'POST', '/integrations/imports', {
      idempotencyKey: `create-${opts.tag}-${run}`,
      id,
      source: opts.source,
      target: opts.target,
      sourceObjectKey: key,
      fileName: opts.file,
      ...(opts.profileKey ? { profileId: builtinProfileId(tenantId, opts.profileKey) } : {}),
      ...(opts.sheetName ? { sheetName: opts.sheetName } : {}),
    })
    expect(created.status, `create ${opts.tag}: ${JSON.stringify(created.body)}`).toBe(200)
    return created.body.item
  }

  const detail = async (actor: Actor, id: string): Promise<ImportJobDetail> => {
    const res = await call<{ item: ImportJobDetail }>(
      app,
      actor,
      'GET',
      `/integrations/imports/${id}`,
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.item
  }
  const rowsOf = async (
    actor: Actor,
    id: string,
    query: Record<string, unknown> = {},
  ): Promise<ImportRow[]> => {
    const res = await call<{ items: ImportRow[] }>(
      app,
      actor,
      'GET',
      `/integrations/imports/${id}/rows`,
      {
        limit: 200,
        ...query,
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.items
  }
  const dryRun = async (actor: Actor, id: string, tag: string): Promise<ImportJobDetail> => {
    const res = await call<{ item: ImportJobDetail }>(
      app,
      actor,
      'POST',
      `/integrations/imports/${id}/dry-run`,
      {
        idempotencyKey: `dry-${tag}-${run}`,
        id,
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.item
  }
  const commit = (actor: Actor, id: string, tag: string, skipUnresolved = false) =>
    call<{ item: ImportJob }>(app, actor, 'POST', `/integrations/imports/${id}/commit`, {
      idempotencyKey: `commit-${tag}-${run}`,
      id,
      skipUnresolved,
    })
  const rollback = (actor: Actor, id: string, tag: string) =>
    call<Rollback>(app, actor, 'POST', `/integrations/imports/${id}/rollback`, {
      idempotencyKey: `rollback-${tag}-${run}`,
      id,
      reason: 'spec rollback',
    })
  const confirm = (actor: Actor, id: string, tag: string) =>
    call<{ item: ImportJob }>(app, actor, 'POST', `/integrations/imports/${id}/confirm`, {
      idempotencyKey: `confirm-${tag}-${run}`,
      id,
    })

  beforeAll(async () => {
    await db.insert(tenants).values([
      {
        id: tenantId,
        slug: `in-${run}`,
        legalName: `Import Traders ${run}`,
        stateCode: '27',
        gstin: tenantGstin,
      },
      { id: otherTenantId, slug: `io-${run}`, legalName: 'Other Traders', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91973${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91973${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91973${run}3`, name: 'Accountant' },
      { id: repId, phone: `+91973${run}4`, name: 'Rep' },
      { id: gateId, phone: `+91973${run}5`, name: 'Gate' },
      { id: driverId, phone: `+91973${run}6`, name: 'Driver' },
      { id: shopUserId, phone: `+91973${run}7`, name: 'Shopkeeper' },
      { id: otherOwnerId, phone: `+91973${run}8`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: gateId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)

    // Seven shops the party master names by phone (phones are per tenant, so fixed values are safe).
    const shops = [
      ['R-0001', 'Shree Ganesh Kirana', '+919820000101'],
      ['R-0002', 'Om Sai Provision Store', '+919820000102'],
      ['R-0003', 'Mahalaxmi General Stores', '+919820000103'],
      ['R-0004', 'Sharma Kirana Stores', '+919820000104'],
      ['R-0005', 'Jai Bhavani Stores', '+919820000105'],
      ['R-0006', 'Shivshakti Traders', '+919820000106'],
      ['R-0008', 'Krishna Kirana Stores', '+919820000107'],
    ] as const
    for (const [code, name, phone] of shops) {
      const id = uuidv7()
      retailerIds[code] = id
      await db.insert(retailers).values({
        id,
        tenantId,
        code,
        name,
        ownerName: 'Before Import',
        phone,
        stateCode: '27',
        gstRegType: 'unregistered',
        tallyLedgerName: `${name} (${code})`,
      })
    }

    // Two brands: one exported to Tally normally, one keyed by the CA from the brand's DMS (Too Yumm).
    const manufacturerId = uuidv7()
    const dosBrand = uuidv7()
    const dmsBrand = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker in ${run}` })
    await db.insert(brands).values([
      { id: dosBrand, manufacturerId, name: `Campa ${run}` },
      { id: dmsBrand, manufacturerId, name: `Too Yumm ${run}` },
    ])
    await db.insert(tenantBrands).values({
      id: uuidv7(),
      tenantId,
      brandId: dmsBrand,
      tallyExportSource: 'brand_dms',
    })
    const product = async (brandId: string, name: string): Promise<string> => {
      const id = uuidv7()
      await db.insert(products).values({ id, manufacturerId, brandId, name, category: 'snacks' })
      return id
    }
    const variant = async (
      key: string,
      productId: string,
      name: string,
      n: number,
      caseSize: number,
      hsn: string,
      mrp: number,
    ) => {
      const id = uuidv7()
      variantIds[key] = id
      await db.insert(productVariants).values({
        id,
        productId,
        name,
        netQty: 100,
        netUnit: 'g',
        defaultCaseSize: caseSize,
        hsnCode: hsn,
        ean: ean(n),
        mrpPaise: mrp,
      })
    }
    const campaCola = await product(dosBrand, `Campa Cola ${run}`)
    const campaOrange = await product(dosBrand, `Campa Orange ${run}`)
    const karare = await product(dmsBrand, `Too Yumm Karare ${run}`)
    const balaji = await product(dosBrand, `Balaji Simply Salted ${run}`)
    const multigrain = await product(dmsBrand, `Too Yumm Multigrain Chips ${run}`)
    await variant('campa-cola', campaCola, `Campa Cola 750 ml ${run}`, 11, 24, '2202', 4000)
    await variant('campa-orange', campaOrange, `Campa Orange 750 ml ${run}`, 12, 24, '2202', 4000)
    await variant('karare', karare, `Too Yumm Karare 60 g ${run}`, 13, 48, '2106', 2000)
    await variant('balaji', balaji, `Balaji Simply Salted Wafers 45 g ${run}`, 14, 72, '2106', 1000)
    await variant(
      'multigrain',
      multigrain,
      `Too Yumm Multigrain Chips 60 g ${run}`,
      15,
      24,
      '2106',
      2000,
    )

    // A booked supplier bill for the Tally purchase voucher.
    await db.insert(suppliers).values({
      id: supplierId,
      tenantId,
      name: `Guiltfree Depot ${run}`,
      gstin: makeGstin('27', `AAJST${run.slice(0, 4)}D`),
      stateCode: '27',
      tallyLedgerName: 'Guiltfree Industries (Sundry Creditor)',
    })
    await db.insert(supplierInvoices).values({
      id: uuidv7(),
      tenantId,
      supplierId,
      source: 'manual',
      status: 'approved',
      invoiceNo: `GF/${run}/1`,
      invoiceDate: '2026-08-18',
      supplierGstin: makeGstin('27', `AAJST${run.slice(0, 4)}D`),
      placeOfSupplyState: '27',
      subtotalPaise: 100_000_00,
      cgstPaise: 6_000_00,
      sgstPaise: 6_000_00,
      totalPaise: 112_000_00,
    })

    app = await bootTestApp([IntegrationsModule, FilesModule])
  })

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // -------------------------------------------------------------------------------------------------------------

  it('ships the built-in vendor profiles per tenant and the mapping catalogue behind them', async () => {
    const res = await call<{ items: ImportProfile[] }>(
      app,
      accountant,
      'GET',
      '/integrations/import-profiles',
      {
        limit: 50,
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const names = res.body.items.map((p) => p.name)
    expect(names).toContain('TradeEzee party master (guessed columns)')
    expect(names).toContain('FieldAssist invoices (guessed columns)')
    expect(res.body.items.every((p) => p.builtIn)).toBe(true)
    const tradeezee = res.body.items.find(
      (p) => p.id === builtinProfileId(tenantId, 'tradeezee-party-master'),
    )
    expect(tradeezee?.target).toBe('party_master')
    expect(tradeezee?.mapping.columns.find((c) => c.field === 'phone')?.column).toBe('Mobile')
    // The other tenant sees its own copies, never ours.
    const other = await call<{ items: ImportProfile[] }>(
      app,
      otherOwner,
      'GET',
      '/integrations/import-profiles',
      {
        limit: 50,
      },
    )
    expect(other.body.items.some((p) => p.id === tradeezee?.id)).toBe(false)
  })

  it('upload → stage → preview → map → save profile → dry run: the party master, with English errors and a correct diff', async () => {
    const job = await createImport(manager, {
      source: 'tradeezee',
      target: 'party_master',
      file: 'tradeezee-party-master.csv',
      body: Buffer.from(fixture('tradeezee-party-master.csv'), 'utf8'),
      profileKey: 'tradeezee-party-master',
      tag: 'party-a',
    })
    // The profile carried the mapping, so staging scored the rows straight away.
    expect(job.status).toBe('staged')
    expect(job.totalRows).toBe(10)
    expect(job.profileId).toBe(builtinProfileId(tenantId, 'tradeezee-party-master'))

    const preview = await call<{
      columns: { header: string; suggestedField: string | null; samples: string[] }[]
      rows: { rowNo: number; cells: Record<string, string> }[]
      totalRows: number
      sheetNames: string[]
    }>(app, accountant, 'GET', `/integrations/imports/${job.id}/preview`, { rows: 3 })
    expect(preview.status).toBe(200)
    expect(preview.body.rows).toHaveLength(3)
    expect(preview.body.totalRows).toBe(10)
    expect(preview.body.sheetNames).toEqual([])
    expect(preview.body.columns.find((c) => c.header === 'Mobile')?.suggestedField).toBe('phone')
    expect(preview.body.columns.find((c) => c.header === 'Route')?.suggestedField).toBe('beatName')
    expect(preview.body.columns.find((c) => c.header === 'Party Name')?.samples[0]).toBe(
      'Shree Ganesh Kirana',
    )

    let d = await detail(manager, job.id)
    expect(d.dryRun?.status).toBe('done')
    expect(d.dryRun).toMatchObject({
      rows: 10,
      willUpdate: 7,
      willCreate: 1,
      willSkip: 1,
      errors: 1,
      needsReview: 0,
    })
    expect(d.dryRun?.amountPaise).toBeNull()
    expect(d.dryRun?.sampleErrors[0]).toMatchObject({ rowNo: 7, field: 'phone' })
    expect(d.dryRun?.sampleErrors[0]?.message).toContain('is not an Indian mobile number')

    // Map the columns again by hand (the same mapping, saved as the operator's own profile).
    const profileId = uuidv7()
    const mapped = await call<{ item: ImportJobDetail; profile: ImportProfile | null }>(
      app,
      manager,
      'POST',
      `/integrations/imports/${job.id}/mapping`,
      {
        idempotencyKey: `map-party-a-${run}`,
        id: job.id,
        mapping: {
          columns: [
            { column: 'Party Code', field: 'partyCode' },
            { column: 'Party Name', field: 'partyName' },
            { column: 'Contact Person', field: 'ownerName' },
            { column: 'Mobile', field: 'phone' },
            { column: 'PAN', field: 'pan' },
            { column: 'Address 1', field: 'addressLine1' },
            { column: 'Area', field: 'area' },
            { column: 'City', field: 'city' },
            { column: 'Pincode', field: 'pincode' },
            { column: 'State Code', field: 'stateCode' },
            { column: 'Ledger Name', field: 'tallyLedgerName' },
          ],
          constants: [],
          dateFormat: 'auto',
          amountUnit: 'rupees',
        },
        saveAsProfile: { id: profileId, name: `Tarsun TradeEzee parties ${run}` },
      },
    )
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200)
    expect(mapped.body.profile?.id).toBe(profileId)
    expect(mapped.body.profile?.builtIn).toBe(false)
    expect(mapped.body.item.dryRun).toBeNull()
    expect(mapped.body.item.rowCounts.staged).toBe(10)

    // A mapping that leaves the phone out is refused with the field named.
    const incomplete = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/integrations/imports/${job.id}/mapping`,
      {
        idempotencyKey: `map-party-bad-${run}`,
        id: job.id,
        mapping: { columns: [{ column: 'Party Name', field: 'partyName' }] },
      },
    )
    expect(incomplete.status).toBe(400)
    expect(incomplete.body.message).toContain('Mobile must be mapped')

    // Commit before a dry run is refused; the dry run answers the diff inline.
    const early = await commit(manager, job.id, 'party-a-early')
    expect(early.status).toBe(400)
    expect((early.body as unknown as { message: string }).message).toContain('dry_run_required')
    d = await dryRun(manager, job.id, 'party-a')
    expect(d.dryRun).toMatchObject({
      rows: 10,
      willUpdate: 7,
      willCreate: 1,
      willSkip: 1,
      errors: 1,
    })
    const problems = await rowsOf(manager, job.id, { problemsOnly: true })
    expect(problems.map((r) => r.rowNo)).toEqual([7])
    expect(problems[0]?.status).toBe('error')
    const updates = await rowsOf(manager, job.id, { plan: 'update' })
    expect(updates).toHaveLength(7)
    expect(updates.every((r) => r.retailerId !== null)).toBe(true)
    // The state written as a name and as MH both became 27.
    expect(updates.find((r) => r.rowNo === 4)?.normalized?.stateCode).toBe('27')
    expect(updates.find((r) => r.rowNo === 6)?.normalized?.stateCode).toBe('27')
    const dup = (await rowsOf(manager, job.id, { plan: 'skip' }))[0]
    expect(dup?.rowNo).toBe(9)
    expect(dup?.error).toContain('duplicate of row 2')

    // Commit with an unresolved row is refused; the reviewer fixes the phone, and the row becomes a create.
    const refused = await commit(manager, job.id, 'party-a-unresolved')
    expect(refused.status).toBe(400)
    expect((refused.body as unknown as { message: string }).message).toContain('unresolved_rows')
    const fixed = await call<{ item: ImportRow }>(
      app,
      manager,
      'POST',
      `/integrations/imports/${job.id}/rows/${problems[0]?.id ?? ''}/review`,
      {
        idempotencyKey: `review-party-a-${run}`,
        id: job.id,
        rowId: problems[0]?.id,
        values: [{ field: 'phone', value: '9820000108' }],
      },
    )
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200)
    expect(fixed.body.item.status).toBe('matched')
    expect(fixed.body.item.plan).toBe('create')
    expect(fixed.body.item.reviewedBy).toBe(managerId)

    // The accountant reads the wizard but may not drive it; the field roles see nothing at all.
    const accountantCommit = await commit(accountant, job.id, 'party-a-accountant')
    expect(accountantCommit.status).toBe(403)
    for (const actor of [rep, gate, driver, shop]) {
      expect((await call(app, actor, 'GET', '/integrations/imports', { limit: 5 })).status).toBe(
        403,
      )
      expect((await call(app, actor, 'GET', `/integrations/imports/${job.id}`)).status).toBe(403)
      expect((await commit(actor, job.id, `party-a-${actor.role}`)).status).toBe(403)
    }
    const commitRes = await commit(manager, job.id, 'party-a')
    expect(commitRes.status, JSON.stringify(commitRes.body)).toBe(200)
    expect(commitRes.body.item.status).toBe('committed')
    expect(commitRes.body.item.okRows).toBe(9)
    expect(commitRes.body.item.errorRows).toBe(0)

    // What commit did: seven shops updated (owner name from the file), two created, codes remembered.
    const ganesh = (
      await db
        .select()
        .from(retailers)
        .where(sql`${retailers.id} = ${retailerIds['R-0001']}`)
    )[0]
    expect(ganesh?.ownerName).toBe('Ganesh Patil')
    expect(ganesh?.pan).toBeNull()
    const sharma = (
      await db
        .select()
        .from(retailers)
        .where(sql`${retailers.id} = ${retailerIds['R-0004']}`)
    )[0]
    expect(sharma?.pan).toBe('AAPFU0939F')
    expect(
      await count(
        'retailers',
        sql`tenant_id = ${tenantId} and name in ('New Kalyan Super Mart', 'Ganesh General Store') and active`,
      ),
    ).toBe(2)
    expect(
      await count('external_party_codes', sql`tenant_id = ${tenantId} and system = 'tradeezee'`),
    ).toBe(9)
    const committedRows = await rowsOf(manager, job.id, { status: 'committed' })
    expect(committedRows).toHaveLength(9)
    expect(committedRows.every((r) => r.entityType === 'retailer' && r.entityId)).toBe(true)

    // Replaying the commit under its key is a no-op; a fresh key on a committed job is refused.
    const replay = await commit(manager, job.id, 'party-a')
    expect(replay.status).toBe(200)
    expect(
      await count('retailers', sql`tenant_id = ${tenantId} and name = 'New Kalyan Super Mart'`),
    ).toBe(1)
    const again = await commit(manager, job.id, 'party-a-second')
    expect(again.status).toBe(409)

    // Rollback before confirm: created shops deactivated, updated ones restored, codes forgotten.
    const undone = await rollback(manager, job.id, 'party-a')
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(undone.body.item.status).toBe('rolled_back')
    expect(undone.body.reversedRows).toBe(9)
    expect(undone.body.reversedByEntity).toMatchObject({
      retailer_deactivated: 2,
      retailer_restored: 7,
      external_party_code: 9,
    })
    const restored = (
      await db
        .select()
        .from(retailers)
        .where(sql`${retailers.id} = ${retailerIds['R-0001']}`)
    )[0]
    expect(restored?.ownerName).toBe('Before Import')
    expect(
      await count(
        'retailers',
        sql`tenant_id = ${tenantId} and name = 'New Kalyan Super Mart' and active`,
      ),
    ).toBe(0)
    expect(
      await count('external_party_codes', sql`tenant_id = ${tenantId} and system = 'tradeezee'`),
    ).toBe(0)
    expect((await commit(manager, job.id, 'party-a-after-rollback')).status).toBe(409)
    expect((await confirm(manager, job.id, 'party-a-after-rollback')).status).toBe(409)
    // The same key replays the first answer; a fresh key on a rolled-back job undoes nothing more.
    expect((await rollback(manager, job.id, 'party-a')).body.reversedRows).toBe(9)
    expect((await rollback(manager, job.id, 'party-a-twice')).body.reversedRows).toBe(0)
  })

  it('stages an XLSX workbook through the same wizard, with its sheet list', async () => {
    const table = fixture('tradeezee-party-master.csv')
      .split('\n')
      .filter((l) => l.trim() !== '' && !/^,+$/.test(l))
      .map((l) => l.split(','))
    const header = table[0] ?? []
    const bytes = writeXlsx([
      { name: 'Parties', header, rows: table.slice(1) },
      { name: 'Notes', header: ['x'], rows: [['ignored']] },
    ])
    const job = await createImport(owner, {
      source: 'tradeezee',
      target: 'party_master',
      file: 'tradeezee-party-master.xlsx',
      body: bytes,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sheetName: 'Parties',
      tag: 'party-xlsx',
    })
    expect(job.status).toBe('staged')
    expect(job.totalRows).toBe(10)
    const preview = await call<{ sheetNames: string[]; columns: { header: string }[] }>(
      app,
      owner,
      'GET',
      `/integrations/imports/${job.id}/preview`,
      { rows: 2 },
    )
    expect(preview.body.sheetNames).toEqual(['Parties', 'Notes'])
    expect(preview.body.columns.map((c) => c.header)).toContain('Ledger Name')
    // Abandoned: a staged job can be cancelled, and then nothing else.
    const cancelled = await call<{ item: ImportJob }>(
      app,
      owner,
      'POST',
      `/integrations/imports/${job.id}/cancel`,
      {
        idempotencyKey: `cancel-xlsx-${run}`,
        id: job.id,
        reason: 'wrong sheet',
      },
    )
    expect(cancelled.body.item.status).toBe('cancelled')
    const afterCancel = await call(app, owner, 'POST', `/integrations/imports/${job.id}/dry-run`, {
      idempotencyKey: `dry-xlsx-after-cancel-${run}`,
      id: job.id,
    })
    expect(afterCancel.status).toBe(409)
  }, 30_000)

  it('party master again, confirmed: the codes the outstanding file will match on', async () => {
    const job = await createImport(owner, {
      source: 'tradeezee',
      target: 'party_master',
      file: 'tradeezee-party-master.csv',
      body: Buffer.from(fixture('tradeezee-party-master.csv'), 'utf8'),
      profileKey: 'tradeezee-party-master',
      tag: 'party-b',
    })
    const committed = await commit(owner, job.id, 'party-b', true)
    expect(committed.status, JSON.stringify(committed.body)).toBe(200)
    expect(committed.body.item.status).toBe('committed')
    const confirmed = await confirm(owner, job.id, 'party-b')
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.item.status).toBe('confirmed')
    expect(confirmed.body.item.confirmedBy).toBe(ownerId)
    expect((await rollback(owner, job.id, 'party-b')).status).toBe(409)
    expect(
      await count('external_party_codes', sql`tenant_id = ${tenantId} and system = 'tradeezee'`),
    ).toBe(8)
  })

  it('item master: matches by EAN, lists the variant for the tenant, never proposes a product', async () => {
    const before = await count('product_variants')
    const job = await createImport(manager, {
      source: 'tradeezee',
      target: 'item_master',
      file: 'tradeezee-item-master.csv',
      body: Buffer.from(withRunEans(fixture('tradeezee-item-master.csv')), 'utf8'),
      profileKey: 'tradeezee-item-master',
      tag: 'items',
    })
    const d = await detail(manager, job.id)
    expect(d.dryRun).toMatchObject({ rows: 6, willCreate: 4, needsReview: 2, errors: 0 })
    const review = await rowsOf(manager, job.id, { status: 'needs_review' })
    expect(review.map((r) => r.rowNo)).toEqual([5, 6])
    expect(review[0]?.error).toContain('no item in the catalog matches')
    // The reviewer pins the unknown item to a variant; the other stays out with skipUnresolved.
    const pinned = await call<{ item: ImportRow }>(
      app,
      manager,
      'POST',
      `/integrations/imports/${job.id}/rows/${review[0]?.id ?? ''}/review`,
      {
        idempotencyKey: `review-items-${run}`,
        id: job.id,
        rowId: review[0]?.id,
        variantId: variantIds.multigrain,
      },
    )
    expect(pinned.body.item.status).toBe('matched')
    expect(pinned.body.item.variantId).toBe(variantIds.multigrain)
    const committed = await commit(manager, job.id, 'items', true)
    expect(committed.status, JSON.stringify(committed.body)).toBe(200)
    expect(committed.body.item.okRows).toBe(5)
    expect(await count('tenant_products', sql`tenant_id = ${tenantId} and listed`)).toBe(5)
    expect(
      await count(
        'tenant_products',
        sql`tenant_id = ${tenantId} and local_alias = 'Campa Cola 750'`,
      ),
    ).toBe(1)
    expect(await count('product_variants')).toBe(before)
    const rows = await rowsOf(manager, job.id, { status: 'skipped' })
    expect(rows.map((r) => r.rowNo)).toEqual([6])
    expect((await confirm(manager, job.id, 'items')).body.item.status).toBe('confirmed')
  })

  it('opening outstanding: bill by bill, owner only, balanced, reversible', async () => {
    const job = await createImport(manager, {
      source: 'tradeezee',
      target: 'opening_outstanding',
      file: 'tradeezee-outstanding.csv',
      body: Buffer.from(fixture('tradeezee-outstanding.csv'), 'utf8'),
      profileKey: 'tradeezee-outstanding',
      tag: 'opening-a',
    })
    const d = await detail(owner, job.id)
    expect(d.dryRun).toMatchObject({
      rows: 7,
      willCreate: 5,
      willSkip: 1,
      errors: 1,
      needsReview: 0,
    })
    expect(d.dryRun?.amountPaise).toBe(18_400_00 + 31_200_00 + 9_850_50 + 42_000_00 + 15_600_00)
    expect(d.dryRun?.sampleErrors[0]).toMatchObject({ rowNo: 6, field: 'amount' })
    const matched = await rowsOf(owner, job.id, { plan: 'create' })
    expect(matched.every((r) => r.normalized?.matchedBy === 'code')).toBe(true)
    expect(matched[0]?.normalized?.invoiceDate).toBe('2026-06-02')

    // The manager may map and dry-run, never commit or confirm this target.
    const managerCommit = await commit(manager, job.id, 'opening-a-manager', true)
    expect(managerCommit.status).toBe(403)
    const committed = await commit(owner, job.id, 'opening-a', true)
    expect(committed.status, JSON.stringify(committed.body)).toBe(200)
    expect(committed.body.item.status).toBe('committed')
    expect(committed.body.item.okRows).toBe(5)
    expect(
      await count(
        'invoices',
        sql`tenant_id = ${tenantId} and source = 'import' and state = 'issued'`,
      ),
    ).toBe(5)
    const entries = (
      await db.execute(sql`
        select e.id, coalesce(sum(l.amount_paise), 0)::bigint as total, count(l.id)::int as lines
          from journal_entries e join journal_lines l on l.entry_id = e.id
         where e.tenant_id = ${tenantId} and e.ref_type = 'opening'
         group by e.id`)
    ).rows as { total: string; lines: number }[]
    expect(entries).toHaveLength(5)
    expect(entries.every((e) => Number(e.total) === 0 && e.lines === 2)).toBe(true)
    const ar = (
      await db.execute(sql`
        select coalesce(sum(l.amount_paise), 0)::bigint as ar
          from journal_lines l join accounts a on a.id = l.account_id join journal_entries e on e.id = l.entry_id
         where l.tenant_id = ${tenantId} and a.code = 'AR' and e.ref_type = 'opening'`)
    ).rows[0] as { ar: string }
    expect(Number(ar.ar)).toBe(18_400_00 + 31_200_00 + 9_850_50 + 42_000_00 + 15_600_00)

    // Rollback: bills cancelled through the machine, entries mirrored, nothing deleted from the books.
    const undone = await rollback(owner, job.id, 'opening-a')
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(undone.body.reversedByEntity).toMatchObject({ invoice: 5, journal_entry: 5 })
    expect(
      await count(
        'invoices',
        sql`tenant_id = ${tenantId} and source = 'import' and state = 'cancelled'`,
      ),
    ).toBe(5)
    expect(
      await count(
        'journal_entries',
        sql`tenant_id = ${tenantId} and ref_type = 'opening_reversal'`,
      ),
    ).toBe(5)
    expect(
      await count(
        'journal_entries',
        sql`tenant_id = ${tenantId} and ref_type = 'opening' and reversed_by_entry_id is not null`,
      ),
    ).toBe(5)
    expect((await commit(owner, job.id, 'opening-a-again', true)).status).toBe(409)

    // The same file again: the cancelled numbers are still on file, so every row is a skip.
    const again = await createImport(owner, {
      source: 'tradeezee',
      target: 'opening_outstanding',
      file: 'tradeezee-outstanding.csv',
      body: Buffer.from(fixture('tradeezee-outstanding.csv'), 'utf8'),
      profileKey: 'tradeezee-outstanding',
      tag: 'opening-b',
    })
    const d2 = await detail(owner, again.id)
    expect(d2.dryRun).toMatchObject({ willCreate: 0, willSkip: 2 + 4, errors: 1 })
  })

  it('sales register: buying history with no ledger effect', async () => {
    const invoicesBefore = await count('invoices', sql`tenant_id = ${tenantId}`)
    const journalBefore = await count('journal_entries', sql`tenant_id = ${tenantId}`)
    const job = await createImport(manager, {
      source: 'tradeezee',
      target: 'sales_register',
      file: 'tradeezee-sales-register.csv',
      body: Buffer.from(fixture('tradeezee-sales-register.csv'), 'utf8'),
      profileKey: 'tradeezee-sales-register',
      tag: 'sales',
    })
    const d = await detail(manager, job.id)
    expect(d.dryRun).toMatchObject({ rows: 8, willCreate: 6, needsReview: 1, errors: 1 })
    const matched = await rowsOf(manager, job.id, { plan: 'create' })
    // "2 CS" of a 24-pack at ₹720 a case → 48 pieces at ₹30 a piece.
    expect(matched[0]?.normalized).toMatchObject({
      qtyPcs: 48,
      ratePaise: 3000,
      matchedItemBy: 'alias',
    })
    const committed = await commit(manager, job.id, 'sales', true)
    expect(committed.status, JSON.stringify(committed.body)).toBe(200)
    expect(committed.body.item.okRows).toBe(6)
    expect(
      await count(
        'retailer_purchase_history',
        sql`tenant_id = ${tenantId} and import_job_id = ${job.id}`,
      ),
    ).toBe(6)
    expect(await count('invoices', sql`tenant_id = ${tenantId}`)).toBe(invoicesBefore)
    expect(await count('journal_entries', sql`tenant_id = ${tenantId}`)).toBe(journalBefore)
    const undone = await rollback(manager, job.id, 'sales')
    expect(undone.body.reversedByEntity.purchase_history).toBe(6)
    expect(
      await count(
        'retailer_purchase_history',
        sql`tenant_id = ${tenantId} and import_job_id = ${job.id}`,
      ),
    ).toBe(0)
  })

  it('FieldAssist invoices: one brand-DMS bill per invoice number, no stock, duplicates skipped, reversible', async () => {
    const stockBefore = await count('stock_ledger', sql`tenant_id = ${tenantId}`)
    const job = await createImport(manager, {
      source: 'fieldassist',
      target: 'brand_dms_invoices',
      file: 'fieldassist-invoices.csv',
      body: Buffer.from(withRunEans(fixture('fieldassist-invoices.csv')), 'utf8'),
      profileKey: 'fieldassist-invoices',
      tag: 'fa-a',
    })
    const d = await detail(manager, job.id)
    expect(d.dryRun).toMatchObject({ rows: 4, willCreate: 3, needsReview: 1, errors: 0 })
    // Two lines of 000123: 48 × ₹17 and 24 × ₹17 − ₹24, plus 12 % GST; the case of 000124: 48 pcs at ₹17.
    expect(d.dryRun?.amountPaise).toBe(
      Math.round(48 * 1700 * 1.12) +
        Math.round((24 * 1700 - 2400) * 1.12) +
        Math.round(48 * 1700 * 1.12),
    )
    const committed = await commit(manager, job.id, 'fa-a', true)
    expect(committed.status, JSON.stringify(committed.body)).toBe(200)
    expect(committed.body.item.okRows).toBe(3)
    const bills = (
      await db.execute(sql`
        select id, external_invoice_no, invoice_no, order_id, state, total_paise, source::text as source
          from invoices where tenant_id = ${tenantId} and source = 'brand_dms_import' order by external_invoice_no`)
    ).rows as {
      id: string
      external_invoice_no: string
      invoice_no: string
      order_id: string | null
      total_paise: string
    }[]
    expect(bills.map((b) => b.external_invoice_no)).toEqual(['FA/2026/000123', 'FA/2026/000124'])
    expect(bills.every((b) => b.order_id === null && b.invoice_no === b.external_invoice_no)).toBe(
      true,
    )
    expect(await count('invoice_lines', sql`invoice_id = ${bills[0]?.id ?? ''}`)).toBe(2)
    expect(await count('stock_ledger', sql`tenant_id = ${tenantId}`)).toBe(stockBefore)
    // The outlet code was remembered under the FieldAssist system for the next monthly file.
    expect(
      await count('external_party_codes', sql`tenant_id = ${tenantId} and system = 'fieldassist'`),
    ).toBe(2)

    // The next month's export overlaps: the same numbers are skipped, never a second bill.
    const overlap = await createImport(manager, {
      source: 'fieldassist',
      target: 'brand_dms_invoices',
      file: 'fieldassist-invoices.csv',
      body: Buffer.from(withRunEans(fixture('fieldassist-invoices.csv')), 'utf8'),
      profileKey: 'fieldassist-invoices',
      tag: 'fa-b',
    })
    const d2 = await detail(manager, overlap.id)
    expect(d2.dryRun).toMatchObject({ willCreate: 0, willSkip: 3, needsReview: 1 })
    const skipRows = await rowsOf(manager, overlap.id, { plan: 'skip' })
    expect(skipRows[0]?.error).toContain('already on file')
    expect(skipRows[0]?.normalized?.matchedBy).toBe('code')
    const committedOverlap = await commit(manager, overlap.id, 'fa-b', true)
    expect(committedOverlap.body.item.okRows).toBe(0)
    expect(
      await count('invoices', sql`tenant_id = ${tenantId} and source = 'brand_dms_import'`),
    ).toBe(2)

    const undone = await rollback(manager, job.id, 'fa-a')
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(undone.body.reversedByEntity).toMatchObject({ invoice: 2, journal_entry: 2 })
    expect(
      await count(
        'invoices',
        sql`tenant_id = ${tenantId} and source = 'brand_dms_import' and state = 'cancelled'`,
      ),
    ).toBe(2)
    expect(await count('stock_ledger', sql`tenant_id = ${tenantId}`)).toBe(stockBefore)
  }, 30_000)

  it('exports: Tally XML with the brand-DMS lines left out, stable GUIDs, a CSV through the registry, a working download', async () => {
    // A mixed bill: one Campa line (exported) and one Too Yumm line (keyed from the brand's DMS).
    const mixed = [
      'Outlet Code,Outlet Name,Invoice No,Invoice Date,State Code,SKU Name,EAN,HSN,Qty,UOM,Rate,GST %',
      `FA-0001,Shree Ganesh Kirana,MIX/${run}/1,2026-08-22,27,Campa Cola 750 ml,${ean(11)},2202,24,PCS,30.00,28`,
      `FA-0001,Shree Ganesh Kirana,MIX/${run}/1,2026-08-22,27,Too Yumm Karare 60 g,${ean(13)},2106,48,PCS,17.00,12`,
      `FA-0002,Om Sai Provision Store,ONLY/${run}/1,2026-08-22,27,Too Yumm Karare 60 g,${ean(13)},2106,48,PCS,17.00,12`,
    ].join('\n')
    const job = await createImport(owner, {
      source: 'fieldassist',
      target: 'brand_dms_invoices',
      file: 'mixed.csv',
      body: Buffer.from(mixed, 'utf8'),
      tag: 'mixed',
    })
    const mapped = await call<{ item: ImportJobDetail }>(
      app,
      owner,
      'POST',
      `/integrations/imports/${job.id}/mapping`,
      {
        idempotencyKey: `map-mixed-${run}`,
        id: job.id,
        mapping: {
          columns: [
            { column: 'Outlet Code', field: 'partyCode' },
            { column: 'Outlet Name', field: 'partyName' },
            { column: 'Invoice No', field: 'invoiceNo' },
            { column: 'Invoice Date', field: 'invoiceDate' },
            { column: 'State Code', field: 'placeOfSupplyState' },
            { column: 'SKU Name', field: 'itemName' },
            { column: 'EAN', field: 'ean' },
            { column: 'HSN', field: 'hsnCode' },
            { column: 'Qty', field: 'qty' },
            { column: 'UOM', field: 'unit' },
            { column: 'Rate', field: 'rate' },
            { column: 'GST %', field: 'gstRate' },
          ],
        },
      },
    )
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200)
    await dryRun(owner, job.id, 'mixed')
    const committed = await commit(owner, job.id, 'mixed')
    expect(committed.status, JSON.stringify(committed.body)).toBe(200)
    expect(committed.body.item.okRows).toBe(3)

    const request = (id: string, tag: string, extra: Record<string, unknown> = {}) =>
      call<{ item: ExportJob }>(app, accountant, 'POST', '/integrations/exports', {
        idempotencyKey: `export-${tag}-${run}`,
        id,
        kind: 'tally_xml',
        from: '2026-08-01',
        to: '2026-08-31',
        ...extra,
      })
    const exportId = uuidv7()
    const first = await request(exportId, 'tally-a', {
      tallyCompanyName: `Import Traders ${run} (Tally)`,
    })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.item.status).toBe('succeeded')
    expect(first.body.item.fileName).toBe('tally-2026-08-01-to-2026-08-31.xml')
    // One sales voucher (the mixed bill, Campa line only), one purchase voucher; the Too-Yumm-only bill emits none.
    expect(first.body.item.rowCount).toBe(2)

    const link = await call<ExportDownloadUrl>(
      app,
      accountant,
      'GET',
      `/integrations/exports/${exportId}/download-url`,
    )
    expect(link.status).toBe(200)
    expect(link.body.url).toBeTruthy()
    const file = await app.inject({ method: 'GET', url: link.body.url ?? '' })
    expect(file.statusCode).toBe(200)
    const xml = file.body
    expect(xml).toContain(`<SVCURRENTCOMPANY>Import Traders ${run} (Tally)</SVCURRENTCOMPANY>`)
    expect(xml).toContain(`<VOUCHERNUMBER>MIX/${run}/1</VOUCHERNUMBER>`)
    expect(xml).not.toContain(`ONLY/${run}/1`)
    expect(xml).toContain('brand-DMS lines excluded')
    // 24 × ₹30 = ₹720 taxable, 28 % GST split in-state → ₹100.80 CGST + ₹100.80 SGST, party debited ₹921.60.
    expect(xml).toContain(
      '<LEDGERNAME>Shree Ganesh Kirana (R-0001)</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-921.60</AMOUNT>',
    )
    expect(xml).toContain(
      '<LEDGERNAME>Output CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.80</AMOUNT>',
    )
    expect(xml).toContain(
      '<LEDGERNAME>Guiltfree Industries (Sundry Creditor)</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>112000.00</AMOUNT>',
    )
    expect(xml).toContain(
      '<LEDGERNAME>Purchases</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100000.00</AMOUNT>',
    )
    expect(xml).not.toContain('Distribution OS')
    const guid = /<GUID>([0-9a-f-]+)<\/GUID>/.exec(xml)?.[1]
    expect(guid).toBeTruthy()

    // Re-running the window writes the SAME GUIDs: one ledger row per document, not two.
    const second = await request(uuidv7(), 'tally-b')
    expect(second.body.item.status).toBe('succeeded')
    const ledger = await call<{ items: { docType: string; docId: string; tallyGuid: string }[] }>(
      app,
      accountant,
      'GET',
      '/integrations/tally/sync-ledger',
      { limit: 50 },
    )
    expect(ledger.status, JSON.stringify(ledger.body)).toBe(200)
    expect(ledger.body.items.filter((e) => e.docType === 'invoice')).toHaveLength(1)
    expect(ledger.body.items.filter((e) => e.docType === 'supplier_invoice')).toHaveLength(1)
    expect(ledger.body.items.map((e) => e.tallyGuid)).toContain(guid)
    expect(await count('tally_sync_ledger', sql`tenant_id = ${tenantId}`)).toBe(2)

    // A CSV kind enqueued the way claims and reporting do, rendered through the registry.
    const exportsSvc = app.get(ExportJobsService)
    const csvId = uuidv7()
    await as(ctxOf(accountantId, 'accountant'), (tx) =>
      exportsSvc.enqueueExport(tx, {
        id: csvId,
        kind: 'sales_register_csv',
        params: { from: '2026-08-01', to: '2026-08-31' },
        requestedBy: accountantId,
      }),
    )
    await tenantStorage.run(ctxOf(accountantId, 'accountant'), () => exportsSvc.renderNow(csvId))
    const csvJob = await call<{ item: ExportJob }>(
      app,
      accountant,
      'GET',
      `/integrations/exports/${csvId}`,
    )
    expect(csvJob.body.item.status).toBe('succeeded')
    expect(csvJob.body.item.fileName).toBe('sales-register-2026-08-01-to-2026-08-31.csv')
    const csvLink = await call<ExportDownloadUrl>(
      app,
      accountant,
      'GET',
      `/integrations/exports/${csvId}/download-url`,
    )
    const csv = await app.inject({ method: 'GET', url: csvLink.body.url ?? '' })
    expect(csv.body.charCodeAt(0)).toBe(0xfeff)
    expect(csv.body).toContain('Invoice No,Date,Shop')
    expect(csv.body).toContain(`MIX/${run}/1`)

    // GSTR-1 and the register workbook render too; the exports list shows them all.
    const gstr = await call<{ item: ExportJob }>(app, accountant, 'POST', '/integrations/exports', {
      idempotencyKey: `export-gstr1-${run}`,
      id: uuidv7(),
      kind: 'gstr1_json',
      from: '2026-08-01',
      to: '2026-08-31',
    })
    expect(gstr.body.item.status).toBe('succeeded')
    const xlsx = await call<{ item: ExportJob }>(app, accountant, 'POST', '/integrations/exports', {
      idempotencyKey: `export-xlsx-${run}`,
      id: uuidv7(),
      kind: 'outstanding_xlsx',
      from: '2026-08-31',
      to: '2026-08-31',
    })
    expect(xlsx.body.item.status).toBe('succeeded')
    expect(xlsx.body.item.mimeType).toContain('spreadsheetml')
    const list = await call<{ items: ExportJob[] }>(
      app,
      accountant,
      'GET',
      '/integrations/exports',
      { limit: 20 },
    )
    expect(list.body.items.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['tally_xml', 'sales_register_csv', 'gstr1_json', 'outstanding_xlsx']),
    )
    // A window longer than a year is refused by the contract itself.
    const tooLong = await call(app, accountant, 'POST', '/integrations/exports', {
      idempotencyKey: `export-long-${run}`,
      id: uuidv7(),
      kind: 'tally_xml',
      from: '2025-01-01',
      to: '2026-08-31',
    })
    expect(tooLong.status).toBe(400)
  }, 60_000)

  it('Tally mappings: idempotent upsert on the natural key, labels resolved, roles honoured', async () => {
    const id = uuidv7()
    const body = {
      idempotencyKey: `tally-map-${run}`,
      id,
      entityType: 'stock_item',
      entityId: variantIds.karare,
      tallyName: `Too Yumm Karare 60g ${run}`,
      tallyParent: 'Snacks',
    }
    const one = await call<{ item: TallyMapping }>(
      app,
      accountant,
      'POST',
      '/integrations/tally/mappings',
      body,
    )
    expect(one.status, JSON.stringify(one.body)).toBe(200)
    expect(one.body.item.entityLabel).toContain('Too Yumm Karare 60 g')
    const two = await call<{ item: TallyMapping }>(
      app,
      accountant,
      'POST',
      '/integrations/tally/mappings',
      body,
    )
    expect(two.body.item.id).toBe(id)
    const renamed = await call<{ item: TallyMapping }>(
      app,
      manager,
      'POST',
      '/integrations/tally/mappings',
      {
        ...body,
        idempotencyKey: `tally-map-2-${run}`,
        id: uuidv7(),
        tallyName: `TY Karare ${run}`,
      },
    )
    expect(renamed.body.item.id).toBe(id)
    expect(
      await count(
        'tally_mappings',
        sql`tenant_id = ${tenantId} and entity_id = ${variantIds.karare ?? ''}`,
      ),
    ).toBe(1)
    const list = await call<{ items: TallyMapping[] }>(
      app,
      accountant,
      'GET',
      '/integrations/tally/mappings',
      {
        entityType: 'stock_item',
        q: `TY Karare ${run}`,
        limit: 10,
      },
    )
    expect(list.body.items.map((m) => m.tallyName)).toEqual([`TY Karare ${run}`])
    expect((await call(app, rep, 'POST', '/integrations/tally/mappings', body)).status).toBe(403)
    expect(
      (await call(app, driver, 'GET', '/integrations/tally/mappings', { limit: 5 })).status,
    ).toBe(403)
  })

  it('RLS is the guarantee: the field roles read zero rows of every integrations table', async () => {
    for (const [actorId, role] of [
      [repId, 'salesperson'],
      [gateId, 'warehouse'],
      [driverId, 'delivery'],
      [shopUserId, 'retailer'],
    ] as const) {
      const ctx = ctxOf(actorId, role)
      for (const table of [
        'import_jobs',
        'import_rows',
        'import_profiles',
        'export_jobs',
        'tally_mappings',
        'tally_sync_ledger',
      ]) {
        const rows = await as(ctx, (tx) => tx.execute(sql`select id from ${sql.identifier(table)}`))
        expect(rows.rows.length, `${role} reads ${table}`).toBe(0)
      }
    }
    const ownerRows = await as(ctxOf(ownerId, 'owner'), (tx) =>
      tx.execute(sql`select id from import_jobs`),
    )
    expect(ownerRows.rows.length).toBeGreaterThan(0)
  })

  it('tenant isolation and the missing token', async () => {
    const mine = await call<{ items: ImportJob[] }>(app, owner, 'GET', '/integrations/imports', {
      limit: 5,
    })
    const jobId = mine.body.items[0]?.id ?? ''
    expect((await call(app, otherOwner, 'GET', `/integrations/imports/${jobId}`)).status).toBe(404)
    const theirs = await call<{ items: ImportJob[] }>(
      app,
      otherOwner,
      'GET',
      '/integrations/imports',
      { limit: 50 },
    )
    expect(theirs.body.items).toHaveLength(0)
    const exportsMine = await call<{ items: ExportJob[] }>(
      app,
      owner,
      'GET',
      '/integrations/exports',
      { limit: 5 },
    )
    expect(
      (
        await call(
          app,
          otherOwner,
          'GET',
          `/integrations/exports/${exportsMine.body.items[0]?.id ?? ''}`,
        )
      ).status,
    ).toBe(404)
    expect((await call(app, null, 'GET', '/integrations/imports', { limit: 5 })).status).toBe(401)
    expect((await call(app, null, 'POST', '/integrations/exports', {})).status).toBe(401)
  })
})
