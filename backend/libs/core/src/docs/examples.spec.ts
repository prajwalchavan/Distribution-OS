import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import type { z } from 'zod'
import {
  bargainRequests,
  createDb,
  createPool,
  importJobs,
  retailerLinks,
  salesOrders,
  supplierInvoices,
  supplierPackConfigs,
  users,
  withSystem,
  type Db,
} from '@dos/db'
import { allProcedures, type ProcedureSummary } from '@dos/contracts'
import {
  buildExamples,
  createdId,
  describeExamples,
  DocExamplesService,
  docsIdempotencyKey,
  docsInvoiceNo,
  inputSchemaFor,
  routeKey,
  type ExampleContext,
  type ProcedureExample,
  SPARE_LANE,
} from './examples.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** What Swagger UI shows when nothing tells it better — the whole reason this module exists. */
const FORBIDDEN = new Set(['string', '3fa85f64-5717-4562-b3fc-2c963f66afa6'])

const PROCEDURES = allProcedures()
const MUTATIONS = PROCEDURES.filter((p) => p.method.toUpperCase() !== 'GET')
const POSTS = PROCEDURES.filter((p) => p.method.toUpperCase() === 'POST')

/** The roles each running service serves (`backend-services/*-service/src/service.ts`). */
const SERVICE_ROLES: Record<string, readonly string[]> = {
  auth: ['owner', 'manager', 'accountant', 'salesperson', 'warehouse', 'delivery', 'retailer'],
  owner: ['owner'],
  manager: ['manager', 'accountant'],
  sales: ['salesperson'],
  warehouse: ['warehouse'],
  delivery: ['delivery'],
  retailer: ['retailer'],
}

/** Only owner/manager/accountant may send these on `retailers.upsert`; anyone else is refused 403. */
const CREDIT_ONLY = ['tier', 'creditLimitPaise', 'creditLimitBills', 'creditDays', 'creditMode']

/** The procedures that create a row under an id the client supplies, and the table it lands in. */
const CREATES_A_ROW = [
  'orders.create',
  'orders.repeatLast',
  'pricing.bargains.request',
  'procurement.supplierInvoices.create',
] as const

/** Ids a caller supplies for rows NESTED in the body, with the procedure that writes them. */
const CREATES_A_NESTED_ROW: Record<string, string> = {
  'orders.create': 'lines[0].id',
  'orders.setLines': 'lines[0].id',
  'procurement.supplierInvoices.create': 'lines[0].id',
}

/** Every scalar in an example, with the dotted place it sits in, so a failure names the field. */
function leaves(value: unknown, at = '', out: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(value)) value.forEach((item, i) => leaves(item, `${at}[${i}]`, out))
  else if (value !== null && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) leaves(child, at ? `${at}.${key}` : key, out)
  else out.push([at, value])
  return out
}

function everyLeaf(example: ProcedureExample): [string, unknown][] {
  return leaves({ ...example.pathParams, ...example.query, ...(example.body ?? {}) })
}

/** Parses an example against the very schema the handler validates with. */
function parse(
  procedure: ProcedureSummary,
  input: Record<string, unknown>,
): z.ZodSafeParseResult<unknown> | null {
  const schema = inputSchemaFor(procedure.path) as unknown as z.ZodType | undefined
  return schema ? schema.safeParse(input) : null
}

function issuesOf(result: z.ZodSafeParseResult<unknown>): string {
  return result.success
    ? ''
    : result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

/**
 * A context with every field present, so the pure tests exercise the same code path a seeded
 * database does without needing one. The ids are obviously synthetic but well-formed.
 */
const FIXTURE: ExampleContext = {
  tenantId: '01a06c94-5a6c-752a-8b3c-65716a473001',
  tenantSlug: 'fixture',
  users: {
    owner: { id: '01a06c94-5a6c-752a-8b3c-65716a473002', username: 'fixture.owner', name: 'Owner' },
    salesperson: {
      id: '01a06c94-5a6c-752a-8b3c-65716a473003',
      username: 'fixture.rep',
      name: 'Rep',
    },
  },
  spareUserId: '01a06c94-5a6c-752a-8b3c-65716a473004',
  deviceId: '01a06c94-5a6c-752a-8b3c-65716a473005',
  retailerId: '01a06c94-5a6c-752a-8b3c-65716a473006',
  retailerCode: 'R-0001',
  retailerName: 'Fixture Kirana',
  retailerPhone: '+919876543210',
  retailerSearch: 'Fixture',
  beatId: '01a06c94-5a6c-752a-8b3c-65716a473007',
  identityId: '01a06c94-5a6c-752a-8b3c-65716a473008',
  variantId: '01a06c94-5a6c-752a-8b3c-65716a473009',
  variantName: 'Fixture Wafers 45 g',
  productSearch: 'Fixture',
  productId: '01a06c94-5a6c-752a-8b3c-65716a47300a',
  brandId: '01a06c94-5a6c-752a-8b3c-65716a47300b',
  manufacturerId: '01a06c94-5a6c-752a-8b3c-65716a47300c',
  secondVariantId: '01a06c94-5a6c-752a-8b3c-65716a47300d',
  orderQty: 12,
  listing: {
    variantId: '01a06c94-5a6c-752a-8b3c-65716a473009',
    localAlias: null,
    caseSizeOverride: null,
    minOrderQty: 1,
    orderIncrement: 1,
    maxPerOrder: null,
    sortOrder: 0,
  },
  cost: {
    variantId: '01a06c94-5a6c-752a-8b3c-65716a473009',
    supplierId: '01a06c94-5a6c-752a-8b3c-65716a473010',
    purchaseRatePaise: 1829,
    landedCostPaise: 1866,
    ptdPaise: 1829,
    schemeMarginBps: 1200,
  },
  locationId: '01a06c94-5a6c-752a-8b3c-65716a473011',
  vehicleLocationId: '01a06c94-5a6c-752a-8b3c-65716a473012',
  vehicleId: '01a06c94-5a6c-752a-8b3c-65716a473013',
  lotId: '01a06c94-5a6c-752a-8b3c-65716a473014',
  lotLocationId: '01a06c94-5a6c-752a-8b3c-65716a473011',
  lotQty: 3150,
  supplierId: '01a06c94-5a6c-752a-8b3c-65716a473010',
  purchaseOrderId: '01a06c94-5a6c-752a-8b3c-65716a473015',
  supplierInvoiceId: '01a06c94-5a6c-752a-8b3c-65716a473016',
  supplierInvoiceLineId: '01a06c94-5a6c-752a-8b3c-65716a473017',
  grnId: '01a06c94-5a6c-752a-8b3c-65716a473018',
  grnLineId: '01a06c94-5a6c-752a-8b3c-65716a473019',
  grnStatus: 'reconciled',
  priceListId: '01a06c94-5a6c-752a-8b3c-65716a47301a',
  priceListItem: {
    id: '01a06c94-5a6c-752a-8b3c-65716a47301b',
    variantId: '01a06c94-5a6c-752a-8b3c-65716a473009',
    ratePaise: 2048,
    inclusiveOfGst: false,
  },
  schemeId: '01a06c94-5a6c-752a-8b3c-65716a47301c',
  bargainRequestId: '01a06c94-5a6c-752a-8b3c-65716a47301d',
  bargainStatus: 'requested',
  draftOrderIds: [
    '01a06c94-5a6c-752a-8b3c-65716a47301e',
    '01a06c94-5a6c-752a-8b3c-65716a47301f',
    '01a06c94-5a6c-752a-8b3c-65716a473020',
  ],
  submittedOrderId: '01a06c94-5a6c-752a-8b3c-65716a473021',
  confirmedOrderId: '01a06c94-5a6c-752a-8b3c-65716a473022',
  orderId: '01a06c94-5a6c-752a-8b3c-65716a473023',
  orderLineId: '01a06c94-5a6c-752a-8b3c-65716a473024',
  approvalId: '01a06c94-5a6c-752a-8b3c-65716a473025',
  invoiceId: '01a06c94-5a6c-752a-8b3c-65716a473026',
  allocationId: '01a06c94-5a6c-752a-8b3c-65716a473027',
}

/** The same tenant seen from the shopkeeper app: one linked shop, its own orders, used-up id slots. */
const LINKED: ExampleContext = {
  ...FIXTURE,
  linkedRetailer: {
    userId: '01a06c94-5a6c-752a-8b3c-65716a473030',
    retailerId: '01a06c94-5a6c-752a-8b3c-65716a473031',
    code: 'R-0001',
    name: 'Shree Ganesh Kirana',
    phone: '+919812345678',
  },
  linkedOrders: {
    orderId: '01a06c94-5a6c-752a-8b3c-65716a473032',
    orderLineId: '01a06c94-5a6c-752a-8b3c-65716a473033',
    draftOrderIds: ['01a06c94-5a6c-752a-8b3c-65716a473034'],
    submittedOrderId: '01a06c94-5a6c-752a-8b3c-65716a473035',
    confirmedOrderId: '01a06c94-5a6c-752a-8b3c-65716a473036',
  },
  // Free slots as the probe reads them: one lane per role, so no two services publish the same id.
  slotLanes: {
    'orders.create': [2, 3, 4, 5, 6, 7, 8, 9],
    'orders.repeatLast': [0, 1, 2, 3, 4, 5, 6, 7],
    'orders.setLines': [7, 8, 9, 10, 11, 12, 13, 14],
    'pricing.bargains.request': [5, 6, 7, 8, 9, 10, 11, 12],
    'procurement.supplierInvoices.create': [3, 4, 5, 6, 7, 8, 9, 10],
  },
}

/** Lane of each service = its most senior role (owner 0, manager 1, … retailer 6). */
const SERVICE_LANE: Record<string, number> = {
  auth: 0,
  owner: 0,
  manager: 1,
  sales: 3,
  warehouse: 4,
  delivery: 5,
  retailer: 6,
}

const slotFor = (service: string, path: string): number =>
  LINKED.slotLanes?.[path]?.[SERVICE_LANE[service] ?? 0] ?? 0

describe('doc examples', () => {
  const examples = buildExamples(PROCEDURES, FIXTURE, { roles: ['owner'] })

  it('covers every procedure of the contract', () => {
    expect(examples.size).toBe(PROCEDURES.length)
  })

  it('validates against the contract schema of every procedure', () => {
    const broken: string[] = []
    for (const procedure of PROCEDURES) {
      const example = examples.get(procedure.path)
      expect(example, procedure.path).toBeDefined()
      const result = parse(procedure, example?.input ?? {})
      if (result && !result.success) broken.push(`${procedure.path} — ${issuesOf(result)}`)
    }
    expect(broken).toEqual([])
  })

  it('gives every path parameter a value', () => {
    const missing: string[] = []
    for (const example of examples.values()) {
      for (const name of example.httpPath.matchAll(/\{([^}]+)\}/g)) {
        const key = name[1] ?? ''
        const value = example.pathParams[key]
        if (typeof value !== 'string' || value.length === 0)
          missing.push(`${example.path}.${key} = ${String(value)}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('never shows Swagger’s own placeholders', () => {
    const offenders: string[] = []
    for (const example of examples.values()) {
      for (const [at, value] of everyLeaf(example)) {
        if (typeof value === 'string' && FORBIDDEN.has(value))
          offenders.push(`${example.path}.${at} = ${value}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('is deterministic — the same context builds the same document', () => {
    const again = buildExamples(PROCEDURES, FIXTURE, { roles: ['owner'] })
    expect([...again.values()]).toEqual([...examples.values()])
  })

  it('keys every mutation to its procedure so a second Execute replays', () => {
    for (const procedure of MUTATIONS) {
      const body = examples.get(procedure.path)?.body
      if (!body || !('idempotencyKey' in body)) continue
      expect(body.idempotencyKey, procedure.path).toBe(`docs-${procedure.path}`)
    }
  })

  it('puts path parameters in the path, never in the body', () => {
    for (const example of examples.values()) {
      for (const key of Object.keys(example.pathParams)) {
        expect(example.body?.[key], `${example.path}.${key}`).toBeUndefined()
      }
    }
  })

  it('leaves optional GET filters blank unless they keep the call returning rows', () => {
    const list = examples.get('orders.list')
    expect(list?.query).toEqual({ retailerId: FIXTURE.retailerId })
    // `state`, `from`, `to` and `q` exist on the input but stacking them would return nothing.
    expect(list?.input.state).toBeDefined()
  })

  it('reads a real row for a path id and a fresh one for a client-generated id', () => {
    expect(examples.get('retailers.get')?.pathParams.id).toBe(FIXTURE.retailerId)
    expect(examples.get('orders.cancel')?.pathParams.id).toBe(FIXTURE.draftOrderIds?.[2])
    expect(examples.get('orders.confirm')?.pathParams.id).toBe(FIXTURE.submittedOrderId)
    // The desk's undo and the cancel both name a row that exists, and the goods of a cancelled bill
    // go back to a godown that exists — a made-up uuid in any of the three is a 404 on Execute.
    expect(examples.get('receivables.allocations.remove')?.pathParams.id).toBe(FIXTURE.allocationId)
    expect(examples.get('billing.invoices.cancel')?.pathParams.id).toBe(FIXTURE.invoiceId)
    expect(examples.get('billing.invoices.cancel')?.body?.restockLocationId).toBe(
      FIXTURE.locationId,
    )
    const created = examples.get('retailers.upsert')?.body?.id
    expect(created).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(created).not.toBe(FIXTURE.retailerId)
  })

  it('does not invent an optional foreign key it has no row for', () => {
    const thin = buildExamples(PROCEDURES, { ...FIXTURE, purchaseOrderId: undefined })
    expect(thin.get('procurement.supplierInvoices.create')?.body).not.toHaveProperty(
      'purchaseOrderId',
    )
  })

  it('falls back to the schema sampler with no demo data at all', () => {
    const bare = buildExamples(PROCEDURES, {})
    expect(bare.size).toBe(PROCEDURES.length)
    const broken: string[] = []
    for (const procedure of PROCEDURES) {
      const result = parse(procedure, bare.get(procedure.path)?.input ?? {})
      if (result && !result.success) broken.push(`${procedure.path} — ${issuesOf(result)}`)
    }
    expect(broken).toEqual([])
    expect(describeExamples({})).toContain('No demo data found')
  })

  // `claims.evidence.attach` refines "exactly one of documentId / objectKey", which no sampler can
  // satisfy on its own. The example carries the tenant-scoped upload key of the claim in its path
  // (the claim this document opens — the handler refuses any other claim's folder) and no document id.
  it('gives claims.evidence.attach exactly one of documentId or objectKey, in the claim’s own folder', () => {
    const tenantId = '01a06c94-5a6c-752a-ab3c-65716a47362f'
    const examples = buildExamples(PROCEDURES, { tenantId })
    const example = examples.get('claims.evidence.attach')
    const body = example?.body ?? {}
    expect(example?.pathParams.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(example?.pathParams.id).toBe(
      examples.get('claims.open')?.pathParams.id ?? examples.get('claims.open')?.input.id,
    )
    expect('documentId' in body).toBe(false)
    expect(body.objectKey).toBe(
      `tenant/${tenantId}/claims/${String(example?.pathParams.id)}/depot-letter.jpg`,
    )
  })

  // A payout table carries three refinements the sampler cannot satisfy (exactly one reward per
  // slab, `[fromPct, toPct)` half-open and never empty, `payoutBps` only on a money metric), so all
  // three slab-taking procedures share one hand-written table. Asserted here by shape, not only by
  // "it parses", so a later edit cannot quietly leave a slab paying twice or an empty range.
  it('gives every incentives payout example a real slab table on a money metric', () => {
    const examples = buildExamples(PROCEDURES, {})
    for (const path of [
      'incentives.targets.upsert',
      'incentives.targets.bulkAssign',
      'incentives.targets.whatIf',
    ]) {
      const body = examples.get(path)?.body ?? {}
      expect(body.metric, path).toBe('value')
      const slabs = body.payoutRule as
        | { fromPct: number; toPct: number | null; payoutBps?: number; flatPaise?: number }[]
        | undefined
      expect(slabs?.length, path).toBeGreaterThan(0)
      for (const slab of slabs ?? []) {
        const rewards = [slab.payoutBps, slab.flatPaise].filter((v) => v !== undefined)
        expect(rewards.length, `${path} slab reward`).toBe(1)
        if (slab.toPct !== null && slab.toPct !== undefined)
          expect(slab.toPct, `${path} slab range`).toBeGreaterThan(slab.fromPct)
      }
    }
  })

  // The claims story hangs off the claim `claims.open` creates: every child id and key derives from
  // that one slot, so the whole chain replays together and walks forward together.
  it('keeps every claims mutation on the claim the document opens', () => {
    const tenantId = '01a06c94-5a6c-752a-ab3c-65716a47362f'
    const examples = buildExamples(PROCEDURES, { tenantId })
    const opened = String(examples.get('claims.open')?.input.id)
    for (const path of [
      'claims.lines.add',
      'claims.lines.adjust',
      'claims.submit',
      'claims.acknowledge',
      'claims.settlements.record',
      'claims.reject',
      'claims.writeOff',
      'claims.cancel',
    ]) {
      expect(examples.get(path)?.pathParams.id, path).toBe(opened)
    }
    expect(examples.get('claims.lines.adjust')?.pathParams.lineId).toBe(
      examples.get('claims.lines.add')?.body?.lineId,
    )
  })

  it('names an operation the way the OpenAPI document does', () => {
    expect(routeKey('get', '/orders/{id}')).toBe('GET /orders/{id}')
  })
})

/**
 * A POST is the one a reader can break something with, so every service's copy of every POST is held
 * to the same three rules: it parses, it shows no placeholder, and it names only rows the roles of
 * THAT service may touch.
 */
describe('every POST, on every service that serves it', () => {
  const byService = new Map(
    Object.entries(SERVICE_ROLES).map(([service, roles]) => [
      service,
      buildExamples(PROCEDURES, LINKED, { roles }),
    ]),
  )

  it('parses against the contract schema of the procedure', () => {
    const broken: string[] = []
    for (const [service, examples] of byService) {
      for (const procedure of POSTS) {
        const result = parse(procedure, examples.get(procedure.path)?.input ?? {})
        if (result && !result.success)
          broken.push(`${service}: ${procedure.path} — ${issuesOf(result)}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('never shows a Swagger placeholder', () => {
    const offenders: string[] = []
    for (const [service, examples] of byService) {
      for (const procedure of POSTS) {
        const example = examples.get(procedure.path)
        if (!example) continue
        for (const [at, value] of everyLeaf(example)) {
          if (typeof value === 'string' && FORBIDDEN.has(value))
            offenders.push(`${service}: ${procedure.path}.${at}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * Mutations whose body `id` is not the procedure's slot id: the shop editing its own EXISTING row,
   * and the upload intent, whose id is per domain (one per service) and replays like any other.
   */
  // `delivery.vehicles.upsert` echoes the demo vehicle; `delivery.deliveries.record` completes the
  // planned row the stop created (its id is the stop's, docs/plans/delivery.md), never a new one.
  // `integrations.tally.mappings.upsert` is an upsert on (entityType, entityId): its id follows the
  // ENTITY, so the same item replays and another item gets a row of its own, never a clash on the id.
  const EXISTING_ROW_ID = new Set([
    'retailers.updateOwn',
    'files.uploadUrl',
    'delivery.vehicles.upsert',
    'delivery.deliveries.record',
    'integrations.tally.mappings.upsert',
    // echoes the tenant's own wording back: the id is the override's, the natural key decides
    'notifications.templates.upsert',
  ])

  it('keys every mutation to the id it creates, so a second Execute replays', () => {
    for (const [service, examples] of byService) {
      for (const procedure of MUTATIONS) {
        const body = examples.get(procedure.path)?.body
        if (!body || !('idempotencyKey' in body)) continue
        const slot = slotFor(service, procedure.path)
        expect(body.idempotencyKey, `${service}: ${procedure.path}`).toBe(
          docsIdempotencyKey(procedure.path, slot),
        )
        if (
          typeof body.id === 'string' &&
          !examples.get(procedure.path)?.pathParams.id &&
          !EXISTING_ROW_ID.has(procedure.path)
        ) {
          expect(body.id, `${service}: ${procedure.path}`).toBe(
            createdId(procedure.path, 'id', slot),
          )
        }
      }
    }
  })

  it('offers credit terms only to the services that may send them', () => {
    for (const [service, examples] of byService) {
      const body = examples.get('retailers.upsert')?.body ?? {}
      const carried = CREDIT_ONLY.filter((field) => field in body)
      const mayCarry = ['auth', 'owner', 'manager'].includes(service)
      expect(carried, `${service}: retailers.upsert`).toEqual(mayCarry ? CREDIT_ONLY : [])
    }
  })

  it('scopes the shopkeeper app to the shop its login is linked to', () => {
    const retailer = byService.get('retailer')
    const linked = LINKED.linkedRetailer?.retailerId
    expect(retailer?.get('orders.create')?.body?.retailerId).toBe(linked)
    expect(retailer?.get('orders.repeatLast')?.body?.retailerId).toBe(linked)
    expect(retailer?.get('pricing.quote')?.body?.retailerId).toBe(linked)
    expect(retailer?.get('pricing.bargains.request')?.body?.retailerId).toBe(linked)
    expect(retailer?.get('orders.get')?.pathParams.id).toBe(LINKED.linkedOrders?.orderId)
    // A retailer login may only order under `retailer_app`; staff may not use that source at all.
    expect(retailer?.get('orders.create')?.body?.source).toBe('retailer_app')
    expect(byService.get('sales')?.get('orders.create')?.body?.source).toBe('salesperson')
  })

  it('leaves every other service on the busiest shop', () => {
    for (const service of ['owner', 'manager', 'sales', 'warehouse', 'delivery']) {
      expect(byService.get(service)?.get('orders.create')?.body?.retailerId).toBe(
        FIXTURE.retailerId,
      )
    }
  })

  it('walks the id sequence of a creating procedure past the rows the database holds', () => {
    const owner = byService.get('owner')
    expect(owner?.get('orders.create')?.body?.id).toBe(createdId('orders.create', 'id', 2))
    expect(owner?.get('orders.create')?.body?.idempotencyKey).toBe('docs-orders.create-2')
    // Slot 0 is the untouched database, and must still read exactly as it always has.
    expect(owner?.get('orders.repeatLast')?.body?.id).toBe(createdId('orders.repeatLast', 'id'))
    expect(owner?.get('orders.repeatLast')?.body?.idempotencyKey).toBe('docs-orders.repeatLast')
    // A supplier invoice number is unique per supplier, so it moves with the slot as well.
    expect(owner?.get('procurement.supplierInvoices.create')?.body?.invoiceNo).toBe(
      docsInvoiceNo(3),
    )
    const lines = owner?.get('procurement.supplierInvoices.create')?.body?.lines
    expect((lines as { id: string }[])[0]?.id).toBe(
      createdId('procurement.supplierInvoices.create', 'lines[0].id', 3),
    )
  })

  it('never writes an existing row’s id into a row the call creates', () => {
    for (const [service, examples] of byService) {
      for (const [path, trail] of Object.entries(CREATES_A_NESTED_ROW)) {
        const example = examples.get(path)
        if (!example?.body) continue
        const lines = example.body.lines as { id?: unknown }[] | undefined
        const slot = slotFor(service, path)
        // `lines[0].id` is the id of a NEW line, not the {id} of the order in the route.
        expect(lines?.[0]?.id, `${service}: ${path}.${trail}`).toBe(createdId(path, trail, slot))
        expect(lines?.[0]?.id, `${service}: ${path}.${trail}`).not.toBe(example.pathParams.id)
      }
    }
  })

  it('gives every service its own lane, so two documents never publish the same new id', () => {
    // All seven can rebuild in the same second; a shared id would put six of them back on a 409.
    const business = [...byService].filter(([service]) => service !== 'auth')
    for (const path of CREATES_A_ROW) {
      const ids = business.map(([, examples]) => examples.get(path)?.body?.id)
      expect(new Set(ids).size, path).toBe(business.length)
    }
    const numbers = business.map(
      ([, examples]) => examples.get('procurement.supplierInvoices.create')?.body?.invoiceNo,
    )
    expect(new Set(numbers).size, 'supplier invoice numbers').toBe(business.length)
  })

  it('is deterministic per service', () => {
    for (const [service, roles] of Object.entries(SERVICE_ROLES)) {
      const again = buildExamples(PROCEDURES, LINKED, { roles })
      expect([...again.values()], service).toEqual([...(byService.get(service)?.values() ?? [])])
    }
  })
})

describeDb('doc examples against the demo database (DATABASE_URL)', () => {
  /**
   * ONE pool and ONE read for the whole file. `DocExamplesService.load()` is eighteen collectors and
   * something like a hundred sequential round trips, and this block used to run six copies of it —
   * one per test, each on a pool of its own — for a context that is a pure READ of the demo rows and
   * is identical every time. Under `turbo run build typecheck lint test --force` the eight-way build
   * saturates the machine, and a 30 s budget for six hundred round trips stopped being generous: the
   * independent gate of 2026-09-06 timed out here twice, on a different test each time. One copy
   * serves every test, exactly as one copy serves a running service (the service caches it too).
   */
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const examplesService = new DocExamplesService(db)
  const context = (): Promise<Awaited<ReturnType<DocExamplesService['load']>>> =>
    examplesService.load()

  afterAll(async () => {
    await pool.end()
  })

  it('reads a tenant with shops, products and orders', async () => {
    const ctx = await context()
    expect(ctx.tenantId).toBeTruthy()
    expect(ctx.retailerId).toBeTruthy()
    expect(ctx.variantId).toBeTruthy()
    expect(ctx.orderId).toBeTruthy()
    expect(describeExamples(ctx)).toContain(ctx.tenantId ?? '')
  }, 30_000)

  it('builds examples that are real rows and still parse', async () => {
    const ctx = await context()
    const examples = buildExamples(PROCEDURES, ctx, { roles: ['owner'] })

    const broken: string[] = []
    const offenders: string[] = []
    for (const procedure of PROCEDURES) {
      const example = examples.get(procedure.path)
      if (!example) continue
      const result = parse(procedure, example.input)
      if (result && !result.success) broken.push(`${procedure.path} — ${issuesOf(result)}`)
      for (const [at, value] of everyLeaf(example)) {
        if (typeof value === 'string' && FORBIDDEN.has(value))
          offenders.push(`${procedure.path}.${at}`)
      }
    }
    expect(broken).toEqual([])
    expect(offenders).toEqual([])

    // The ids really came from the database, not from the sampler.
    expect(examples.get('retailers.get')?.pathParams.id).toBe(ctx.retailerId)
    expect(examples.get('orders.list')?.query.retailerId).toBe(ctx.retailerId)
    expect(examples.get('inventory.stock.balances')?.query.lotId).toBe(ctx.lotId)
    expect(examples.get('auth.login')?.body?.username).toBe(ctx.users?.owner?.username)
  }, 30_000)

  it('creates rows under ids and document numbers the database does not hold yet', async () => {
    const ctx = await context()
    // The spare lane: the service specs run alongside this one under turbo and spend the role lanes.
    const examples = buildExamples(PROCEDURES, ctx, { roles: ['owner'], lane: SPARE_LANE })

    const created = new Map(
      CREATES_A_ROW.map((path) => [path, String(examples.get(path)?.body?.id)]),
    )
    const idOf = (path: (typeof CREATES_A_ROW)[number]): string => created.get(path) ?? ''
    expect([...created.values()].every((id) => id.startsWith('01a0d0c5-'))).toBe(true)

    const taken = await withSystem(db, async (tx: Db) => ({
      orders: await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(inArray(salesOrders.id, [idOf('orders.create'), idOf('orders.repeatLast')])),
      bargains: await tx
        .select({ id: bargainRequests.id })
        .from(bargainRequests)
        .where(eq(bargainRequests.id, idOf('pricing.bargains.request'))),
      invoices: await tx
        .select({ id: supplierInvoices.id })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.id, idOf('procurement.supplierInvoices.create'))),
      // The number, not just the id: it is unique per supplier, so a used one is a permanent 409.
      numbers: await tx
        .select({ invoiceNo: supplierInvoices.invoiceNo })
        .from(supplierInvoices)
        .where(
          eq(
            supplierInvoices.invoiceNo,
            String(examples.get('procurement.supplierInvoices.create')?.body?.invoiceNo),
          ),
        ),
    }))
    expect(taken.orders).toEqual([])
    expect(taken.bargains).toEqual([])
    expect(taken.invoices).toEqual([])
    expect(taken.numbers).toEqual([])

    // An upsert on a natural key: the id it publishes is either the row (supplier, variant) already
    // resolves to, or one no pack config holds — never an id that names ANOTHER pair, which is the
    // `supplier_pack_configs_pkey` 500 the delivery gate hit once the demo variant moved.
    const pack = examples.get('tenantCatalog.packConfigs.upsert')?.body
    const held = await withSystem(db, (tx: Db) =>
      tx
        .select({
          supplierId: supplierPackConfigs.supplierId,
          variantId: supplierPackConfigs.variantId,
        })
        .from(supplierPackConfigs)
        .where(eq(supplierPackConfigs.id, String(pack?.id))),
    )
    for (const row of held) {
      expect(row.supplierId).toBe(pack?.supplierId)
      expect(row.variantId).toBe(pack?.variantId)
    }
  }, 30_000)

  /**
   * EVERY lane, not only the spare one. Each running service publishes its OWN lane's slot, and the
   * test above reads the spare lane — which sits past the used range, so it stays green while the
   * lanes the services actually use are already spent. That is precisely how
   * `procurement.supplierInvoices.create` reached a permanent 409 on the founder's database at
   * `DOCS/26-27/0257`: its slot picker probed a SINGLE window of 256, and once weeks of demoing and
   * smoke runs had spent it, the "give up" fallback published a fixed range the previous run had
   * already taken. `tenancy.staff.create` was seven slots from the same wall. Both now walk the
   * same `SLOT_WINDOWS` windows `freeSlots` walks, and this case is what says so.
   *
   * It asserts the natural keys too, not just the ids: an invoice number is unique per supplier and
   * a username and a phone are unique platform-wide, so a spent one is a 409 the id check misses.
   */
  it('gives every service lane an id, a document number and a login the database does not hold', async () => {
    const ctx = await context()
    for (let lane = 0; lane <= SPARE_LANE; lane++) {
      const laneExamples = buildExamples(PROCEDURES, ctx, { roles: ['owner'], lane })
      const invoice = laneExamples.get('procurement.supplierInvoices.create')?.body
      const staff = laneExamples.get('tenancy.staff.create')?.body
      const orderIds = ['orders.create', 'orders.repeatLast'].map((path) =>
        String(laneExamples.get(path)?.body?.id),
      )
      const held = await withSystem(db, async (tx: Db) => ({
        invoiceIds: await tx
          .select({ id: supplierInvoices.id })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, String(invoice?.id))),
        invoiceNumbers: await tx
          .select({ invoiceNo: supplierInvoices.invoiceNo })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.invoiceNo, String(invoice?.invoiceNo))),
        logins: await tx
          .select({ username: users.username })
          .from(users)
          .where(
            or(eq(users.username, String(staff?.username)), eq(users.phone, String(staff?.phone))),
          ),
        orders: await tx
          .select({ id: salesOrders.id })
          .from(salesOrders)
          .where(inArray(salesOrders.id, orderIds)),
      }))
      expect(held.invoiceIds, `lane ${lane}: supplier invoice id`).toEqual([])
      expect(held.invoiceNumbers, `lane ${lane}: ${String(invoice?.invoiceNo)}`).toEqual([])
      expect(held.logins, `lane ${lane}: ${String(staff?.username)}`).toEqual([])
      expect(held.orders, `lane ${lane}: order id`).toEqual([])
    }
  }, 60_000)

  // The wizard example re-stages a file that must EXIST in the object store: the key of a party
  // master that parsed once (`total_rows` set), whether or not a staged job is left in the demo.
  // A made-up key stages `failed` and every later step of the chain answers 409 (found by the gate
  // after `pnpm smoke --destructive` cancelled the seeded staged job).
  it('re-stages a party-master file that really parsed, never a made-up key', async () => {
    const ctx = await context()
    const examples = buildExamples(PROCEDURES, ctx, { roles: ['owner'] })
    const key = String(examples.get('integrations.imports.create')?.body?.sourceObjectKey)
    expect(key.startsWith(`tenant/${ctx.tenantId ?? ''}/import/`)).toBe(true)
    const parsed = await withSystem(db, (tx: Db) =>
      tx
        .select({ id: importJobs.id, totalRows: importJobs.totalRows })
        .from(importJobs)
        .where(and(eq(importJobs.sourceObjectKey, key), isNotNull(importJobs.totalRows)))
        .limit(1),
    )
    expect(parsed, key).toHaveLength(1)
  }, 30_000)

  it('gives the shopkeeper app a shop that is really linked to its sign-in', async () => {
    const ctx = await context()
    const examples = buildExamples(PROCEDURES, ctx, { roles: ['retailer'] })
    const retailerId = String(examples.get('orders.create')?.body?.retailerId)
    const userId = ctx.users?.retailer?.id

    const links = await withSystem(db, (tx: Db) =>
      tx
        .select({ id: retailerLinks.id })
        .from(retailerLinks)
        .where(
          and(
            eq(retailerLinks.tenantId, ctx.tenantId ?? ''),
            eq(retailerLinks.retailerId, retailerId),
            eq(retailerLinks.userId, userId ?? ''),
            eq(retailerLinks.status, 'active'),
            isNotNull(retailerLinks.userId),
          ),
        ),
    )
    expect(userId, 'a demo retailer login').toBeTruthy()
    expect(links.length, `${retailerId} is linked to ${String(userId)}`).toBeGreaterThan(0)
    // Every retailer-service example that names a shop names THAT one.
    for (const path of ['orders.create', 'orders.repeatLast', 'pricing.quote']) {
      expect(examples.get(path)?.body?.retailerId, path).toBe(retailerId)
    }
  }, 30_000)
})
