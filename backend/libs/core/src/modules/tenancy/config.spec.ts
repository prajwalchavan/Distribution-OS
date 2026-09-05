import { and, eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  memberships,
  numberingSeries,
  retailerIdentities,
  retailerLinks,
  retailers,
  tenants,
  tenantSettings,
  users,
  withTenant,
} from '@dos/db'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { FilesModule } from '../files/index.js'
import { TenancyModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/**
 * The distributor's configuration (docs/23 §8.13): branding on every service including the shop's,
 * settings the owner writes and staff read (never `secret.*`), numbering as configuration that locks
 * after the first issue, feature flags, the tenant's identity, the audit trail — and the files
 * procedures that put a logo there.
 */
describeDb('tenancy config + files (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)

  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const retailerId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const stranger: Actor = { tenantId: otherTenantId, actorId: uuidv7(), role: 'owner' }

  let app: NestFastifyApplication

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `cfg-${run}`, legalName: `Config Traders ${run}`, stateCode: '27' },
      { id: otherTenantId, slug: `cfg-o-${run}`, legalName: 'Other', stateCode: '27' },
    ])
    await bootstrapTenant(db, tenantId)
    await db.insert(users).values([
      { id: ownerId, phone: `+919${run}1`, name: 'Owner', username: `c${run}.own` },
      { id: managerId, phone: `+919${run}2`, name: 'Manager', username: `c${run}.mgr` },
      { id: accountantId, phone: `+919${run}3`, name: 'Accountant', username: `c${run}.acc` },
      { id: repId, phone: `+919${run}4`, name: 'Rep', username: `c${run}.rep` },
      { id: shopUserId, phone: `+919${run}5`, name: 'Shopkeeper', username: `c${run}.shop` },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await db.insert(retailers).values({
      id: retailerId,
      tenantId,
      code: `R${run}`,
      name: 'Config Kirana',
      phone: `+918${run}1`,
      stateCode: '27',
      gstRegType: 'unregistered',
    })
    const identityId = uuidv7()
    await db
      .insert(retailerIdentities)
      .values({ id: identityId, phone: `+918${run}1`, shopName: 'Config Kirana' })
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
    })
    await db.insert(tenantSettings).values([
      { tenantId, key: 'upi_vpa', value: 'config@upi' },
      { tenantId, key: 'secret.whatsapp_token', value: 'hush' },
    ])
    app = await bootTestApp([TenancyModule, FilesModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // -------------------------------------------------------------------------------------------------------------
  // branding

  it('answers the white-label block to every member, the shop included, with the legal name as the fallback', async () => {
    for (const actor of [owner, manager, accountant, rep, shop]) {
      const res = await call<Record<string, unknown>>(app, actor, 'GET', '/tenancy/branding')
      expect(res.status, actor.role).toBe(200)
      expect(res.body.displayName).toBe(`Config Traders ${run}`)
      expect(res.body.legalName).toBe(`Config Traders ${run}`)
      expect(res.body.logoUrl).toBeNull()
      expect(JSON.stringify(res.body)).not.toContain('hush')
    }
    expect((await call(app, null, 'GET', '/tenancy/branding')).status).toBe(401)
  })

  // -------------------------------------------------------------------------------------------------------------
  // settings

  it('the owner sets settings (audited per key); staff read them without secret.*; the shop reads none', async () => {
    const set = await call<{ items: { key: string; value: unknown }[] }>(
      app,
      owner,
      'POST',
      '/tenancy/settings',
      {
        idempotencyKey: `settings-${run}`,
        items: [
          { key: 'branding.display_name', value: `Config Traders ${run} (Kalyan)` },
          { key: 'delivery.geofence_metres', value: 200 },
          { key: 'secret.gateway_key', value: 'top-secret' },
        ],
      },
    )
    expect(set.status).toBe(200)
    expect(set.body.items.map((i) => i.key).sort()).toEqual([
      'branding.display_name',
      'delivery.geofence_metres',
      'secret.gateway_key',
    ])
    const branding = await call<{ displayName: string }>(app, shop, 'GET', '/tenancy/branding')
    expect(branding.body.displayName).toBe(`Config Traders ${run} (Kalyan)`)

    const staffRead = await call<{ items: { key: string; value: unknown }[] }>(
      app,
      accountant,
      'GET',
      '/tenancy/settings',
    )
    expect(staffRead.status).toBe(200)
    const keys = staffRead.body.items.map((i) => i.key)
    expect(keys).toContain('delivery.geofence_metres')
    expect(keys).toContain('upi_vpa')
    expect(keys.some((k) => k.startsWith('secret.'))).toBe(false)
    const ownerRead = await call<{ items: { key: string; value: unknown }[] }>(
      app,
      owner,
      'GET',
      '/tenancy/settings',
      { 'keys[0]': 'secret.gateway_key' },
    )
    expect(ownerRead.body.items).toEqual([
      expect.objectContaining({ key: 'secret.gateway_key', value: 'top-secret' }),
    ])
    expect((await call(app, shop, 'GET', '/tenancy/settings')).status).toBe(403)

    // nobody but the owner writes — the accountant gets 403 from the guard and the database agrees
    const refused = await call(app, accountant, 'POST', '/tenancy/settings', {
      idempotencyKey: `settings-acc-${run}`,
      items: [{ key: 'branding.display_name', value: 'nope' }],
    })
    expect(refused.status).toBe(403)
    await expect(
      withTenant(db, { tenantId, actorId: accountantId, actorRole: 'accountant' }, (tx) =>
        tx
          .update(tenantSettings)
          .set({ value: 'nope' })
          .where(
            and(
              eq(tenantSettings.tenantId, tenantId),
              eq(tenantSettings.key, 'branding.display_name'),
            ),
          )
          .returning(),
      ),
    ).resolves.toEqual([])

    // the trail: one row per key, the secret redacted
    const trail = await call<{
      items: { action: string; entityId: string; after: Record<string, unknown> | null }[]
    }>(app, owner, 'GET', '/tenancy/audit', { action: 'setting.set' })
    expect(trail.status).toBe(200)
    const secretRow = trail.body.items.find((i) => i.entityId === 'secret.gateway_key')
    expect(secretRow?.after?.value).toBe('[redacted]')
    expect(trail.body.items.filter((i) => i.action === 'setting.set')).toHaveLength(3)
  })

  // -------------------------------------------------------------------------------------------------------------
  // numbering

  it('the owner configures a series until the first number is issued, then it is locked', async () => {
    const list = await call<{
      fy: string
      items: { seriesCode: string; nextNo: number; lockedAfterFirstIssue: boolean }[]
    }>(app, owner, 'GET', '/tenancy/numbering-series')
    expect(list.status).toBe(200)
    expect(list.body.items.find((i) => i.seriesCode === 'INV')).toMatchObject({
      nextNo: 1,
      lockedAfterFirstIssue: false,
    })
    const upsert = await call<{ item: { prefix: string; startingNo: number; nextNo: number } }>(
      app,
      owner,
      'POST',
      '/tenancy/numbering-series',
      { idempotencyKey: `series-${run}`, seriesCode: 'INV', prefix: 'GL/', startingNo: 1687 },
    )
    expect(upsert.status).toBe(200)
    expect(upsert.body.item).toMatchObject({ prefix: 'GL/', startingNo: 1687, nextNo: 1687 })
    // a brand-new code is created
    const created = await call<{ item: { seriesCode: string } }>(
      app,
      owner,
      'POST',
      '/tenancy/numbering-series',
      {
        idempotencyKey: `series-b2c-${run}`,
        seriesCode: 'INV-B2C',
        prefix: 'B2C/',
        startingNo: 1,
      },
    )
    expect(created.status).toBe(200)
    // simulate the first issue (as the migrating connection) and the series locks
    await db
      .update(numberingSeries)
      .set({ nextNo: 1688 })
      .where(and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.seriesCode, 'INV')))
    const locked = await call<{ data?: { code?: string } }>(
      app,
      owner,
      'POST',
      '/tenancy/numbering-series',
      {
        idempotencyKey: `series-locked-${run}`,
        seriesCode: 'INV',
        prefix: 'NEW/',
        startingNo: 1,
      },
    )
    expect(locked.status).toBe(409)
    expect(locked.body.data?.code).toBe('series_locked')
    const after = await call<{
      items: { seriesCode: string; lockedAfterFirstIssue: boolean; prefix: string }[]
    }>(app, owner, 'GET', '/tenancy/numbering-series')
    expect(after.body.items.find((i) => i.seriesCode === 'INV')).toMatchObject({
      lockedAfterFirstIssue: true,
      prefix: 'GL/',
    })
    // the manager reads nothing here and writes nothing (guard + database)
    expect((await call(app, manager, 'GET', '/tenancy/numbering-series')).status).toBe(403)
    expect(
      (
        await call(app, manager, 'POST', '/tenancy/numbering-series', {
          idempotencyKey: `series-mgr-${run}`,
          seriesCode: 'CN',
          prefix: 'X/',
          startingNo: 5,
        })
      ).status,
    ).toBe(403)
    await expect(
      withTenant(db, { tenantId, actorId: managerId, actorRole: 'manager' }, (tx) =>
        tx
          .update(numberingSeries)
          .set({ prefix: 'X/' })
          .where(and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.seriesCode, 'CN'))),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })

  // -------------------------------------------------------------------------------------------------------------
  // feature flags, tenant, audit, staff.update

  it('every member reads the flags, only the owner flips one, and the change is audited', async () => {
    const shopRead = await call<{ items: { flag: string; enabled: boolean }[] }>(
      app,
      shop,
      'GET',
      '/tenancy/feature-flags',
    )
    expect(shopRead.status).toBe(200)
    expect(shopRead.body.items.find((f) => f.flag === 'van_sales')?.enabled).toBe(false)
    const set = await call<{ items: { flag: string; enabled: boolean }[] }>(
      app,
      owner,
      'POST',
      '/tenancy/feature-flags',
      {
        idempotencyKey: `flags-${run}`,
        items: [{ flag: 'van_sales', enabled: true }],
      },
    )
    expect(set.status).toBe(200)
    expect(set.body.items.find((f) => f.flag === 'van_sales')?.enabled).toBe(true)
    expect(
      (
        await call(app, manager, 'POST', '/tenancy/feature-flags', {
          idempotencyKey: `flags-mgr-${run}`,
          items: [{ flag: 'van_sales', enabled: false }],
        })
      ).status,
    ).toBe(403)
    const trail = await call<{ items: { entityId: string }[] }>(
      app,
      manager,
      'GET',
      '/tenancy/audit',
      {
        action: 'feature_flag.set',
      },
    )
    expect(trail.body.items.map((i) => i.entityId)).toContain('van_sales')
  })

  it('the owner edits the legal identity and updates staff; the audit trail pages by time', async () => {
    const update = await call<{ item: { legalName: string; gstin: string | null } }>(
      app,
      owner,
      'POST',
      '/tenancy/tenant',
      {
        idempotencyKey: `tenant-${run}`,
        legalName: `Config Traders ${run} Pvt Ltd`,
        gstin: '27AAAPZ1234C1ZV',
        stateCode: '27',
      },
    )
    expect(update.status).toBe(200)
    expect(update.body.item).toMatchObject({
      legalName: `Config Traders ${run} Pvt Ltd`,
      gstin: '27AAAPZ1234C1ZV',
    })
    expect(
      (
        await call(app, accountant, 'POST', '/tenancy/tenant', {
          idempotencyKey: `tenant-acc-${run}`,
          legalName: 'nope',
          stateCode: '27',
        })
      ).status,
    ).toBe(403)

    const staff = await call<{ ok: boolean }>(app, manager, 'POST', '/tenancy/staff/update', {
      idempotencyKey: `staff-upd-${run}`,
      userId: repId,
      name: 'Rep Renamed',
    })
    expect(staff.status).toBe(200)
    const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, repId))
    expect(row?.name).toBe('Rep Renamed')
    // a manager may not edit the owner
    expect(
      (
        await call(app, manager, 'POST', '/tenancy/staff/update', {
          idempotencyKey: `staff-upd-own-${run}`,
          userId: ownerId,
          name: 'x',
        })
      ).status,
    ).toBe(403)

    const page1 = await call<{
      items: { id: string; occurredAt: string }[]
      nextCursor: string | null
    }>(app, owner, 'GET', '/tenancy/audit', { limit: 2 })
    expect(page1.status).toBe(200)
    expect(page1.body.items).toHaveLength(2)
    expect(page1.body.nextCursor).not.toBeNull()
    const page2 = await call<{ items: { id: string }[] }>(app, owner, 'GET', '/tenancy/audit', {
      limit: 2,
      cursor: page1.body.nextCursor ?? '',
    })
    expect(page2.status).toBe(200)
    expect(page2.body.items.map((i) => i.id)).not.toContain(page1.body.items[0]?.id)
    expect((await call(app, rep, 'GET', '/tenancy/audit')).status).toBe(403)
    expect((await call(app, stranger, 'GET', '/tenancy/audit')).body).toMatchObject({ items: [] })
  })

  // -------------------------------------------------------------------------------------------------------------
  // files

  it('mints a logo upload URL for the owner, PUTs the bytes through the local storage route and reads it back', async () => {
    const id = uuidv7()
    const minted = await call<{
      objectKey: string
      url: string | null
      method: string | null
      headers: Record<string, string>
      inline: boolean
    }>(app, owner, 'POST', '/files/upload-url', {
      idempotencyKey: `upload-${run}`,
      id,
      domain: 'logo',
      entityId: tenantId,
      mimeType: 'image/png',
      bytes: 512,
    })
    expect(minted.status).toBe(200)
    expect(minted.body.objectKey).toBe(`tenant/${tenantId}/logo/${tenantId}/${id}.png`)
    expect(minted.body.method).toBe('PUT')
    expect(minted.body.url).toMatch(/^\/storage\//)
    expect(minted.body.inline).toBe(false)
    const [pending] = (
      await db.execute(
        sql`select status from file_objects where tenant_id = ${tenantId} and object_key = ${minted.body.objectKey}`,
      )
    ).rows as { status: string }[]
    expect(pending?.status).toBe('pending')

    // the bytes: a tiny PNG header is enough for the storage route (the allow-list checks the type, not the pixels)
    const put = await app.inject({
      method: 'PUT',
      url: minted.body.url ?? '',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    })
    expect(put.statusCode).toBe(200)
    const [uploaded] = (
      await db.execute(
        sql`select status, bytes from file_objects where tenant_id = ${tenantId} and object_key = ${minted.body.objectKey}`,
      )
    ).rows as { status: string; bytes: number }[]
    expect(uploaded).toMatchObject({ status: 'uploaded', bytes: 12 })

    // a tampered signature never writes
    const tampered = await app.inject({
      method: 'PUT',
      url: (minted.body.url ?? '').replace(/signature=[0-9a-f]{4}/, 'signature=0000'),
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([1, 2, 3]),
    })
    expect(tampered.statusCode).toBe(403)

    // the shop reads the logo (any member); nobody reads another tenant's key
    const read = await call<{ url: string }>(app, shop, 'GET', '/files/read-url', {
      objectKey: minted.body.objectKey,
    })
    expect(read.status).toBe(200)
    const got = await app.inject({ method: 'GET', url: read.body.url })
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('image/png')
    expect(
      (await call(app, stranger, 'GET', '/files/read-url', { objectKey: minted.body.objectKey }))
        .status,
    ).toBe(400)

    // and once the owner sets the key, every sign-in and every document carries the logo URL
    await call(app, owner, 'POST', '/tenancy/settings', {
      idempotencyKey: `logo-key-${run}`,
      items: [{ key: 'branding.logo_object_key', value: minted.body.objectKey }],
    })
    const branding = await call<{ logoUrl: string | null }>(app, rep, 'GET', '/tenancy/branding')
    expect(branding.body.logoUrl).toMatch(/^\/storage\/tenant\//)
  })

  it('applies the per-domain table: a rep uploads nothing, a shop may not open a supplier page, the desk may', async () => {
    expect(
      (
        await call(app, rep, 'POST', '/files/upload-url', {
          idempotencyKey: `upload-rep-${run}`,
          id: uuidv7(),
          domain: 'damage',
          entityId: uuidv7(),
          mimeType: 'image/jpeg',
          bytes: 100,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, accountant, 'POST', '/files/upload-url', {
          idempotencyKey: `upload-acc-logo-${run}`,
          id: uuidv7(),
          domain: 'logo',
          entityId: tenantId,
          mimeType: 'image/png',
          bytes: 100,
        })
      ).status,
    ).toBe(403)
    const docsKey = `tenant/${tenantId}/docs/${uuidv7()}/page-1.jpg`
    expect((await call(app, shop, 'GET', '/files/read-url', { objectKey: docsKey })).status).toBe(
      403,
    )
    expect(
      (await call(app, manager, 'GET', '/files/read-url', { objectKey: docsKey })).status,
    ).toBe(200)
    expect(
      (await call(app, owner, 'GET', '/files/read-url', { objectKey: 'not/a/key' })).status,
    ).toBe(400)
  })
})
