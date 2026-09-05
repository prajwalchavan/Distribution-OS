import { describe, expect, it } from 'vitest'
import { contract } from './contract.js'
import { MembershipRoleSchema, type MembershipRole } from './common.js'
import {
  ALL_ROLES,
  allProcedures,
  isAllowed,
  listProcedures,
  PERMISSIONS,
  permissionFor,
  ROLE_GROUPS,
} from './permissions.js'

/** Walks the contract the way the guard and the README renderer do: a leaf is anything with a route. */
function leafPaths(router: unknown, prefix = ''): string[] {
  const out: string[] = []
  if (!router || typeof router !== 'object') return out
  for (const [name, value] of Object.entries(router as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${name}` : name
    const meta = (value as { '~orpc'?: { route?: unknown } })?.['~orpc']
    if (meta?.route) out.push(path)
    else if (value && typeof value === 'object') out.push(...leafPaths(value, path))
  }
  return out
}

const paths = leafPaths(contract)

describe('permission matrix', () => {
  it('covers every procedure of the contract', () => {
    const missing = paths.filter((p) => permissionFor(p) === undefined)
    expect(missing).toEqual([])
  })

  it('has no entry for a procedure that does not exist', () => {
    const known = new Set(paths)
    expect(Object.keys(PERMISSIONS).filter((p) => !known.has(p))).toEqual([])
  })

  it('names only real membership roles', () => {
    for (const [path, permission] of Object.entries(PERMISSIONS)) {
      if (permission === 'public' || permission === 'authenticated') continue
      expect(permission.length, path).toBeGreaterThan(0)
      for (const role of permission) expect(MembershipRoleSchema.safeParse(role).success).toBe(true)
      expect(new Set(permission).size, `${path} lists a role twice`).toBe(permission.length)
    }
  })

  it('keeps purchase cost away from the field and the shop', () => {
    const costly = [
      'tenantCatalog.costs',
      'tenantCatalog.upsertCost',
      'procurement.supplierInvoices.get',
      'procurement.supplierInvoices.list',
      'retailers.setCredit',
      // A supplier bill's reading carries printed purchase rates and becomes cost at `approve`.
      'docint.extractions.list',
      'docint.extractions.get',
      'docint.queue.list',
      'docint.review.start',
      'docint.documents.approve',
    ] as const
    for (const path of costly) {
      const permission = permissionFor(path)
      expect(Array.isArray(permission), path).toBe(true)
      for (const role of ['salesperson', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permission, role), `${path} must refuse ${role}`).toBe(false)
      }
    }
  })

  it('keeps money handling away from the rep and the books away from the field', () => {
    // docs/17 §D4: only the desk and the delivery crew take money; a rep never collects. "Never
    // collects" is not "never sees" (docs/22 §4, docs/23 §8.1): the rep reads a shop's dues, runs the
    // credit check before submit and opens the statement — exactly three reads, and nothing else.
    const repMayRead = [
      'receivables.outstanding.get',
      'receivables.creditCheck',
      'receivables.ledger.get',
    ]
    for (const path of repMayRead) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must allow salesperson`).toBe(
        true,
      )
    }
    for (const path of paths.filter(
      (p) => p.startsWith('receivables.') && !repMayRead.includes(p),
    )) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must refuse salesperson`).toBe(
        false,
      )
    }
    // The crew reads one shop's dues at the door, never the tenant register or its history.
    expect(isAllowed(permissionFor('receivables.outstanding.get'), 'delivery')).toBe(true)
    expect(isAllowed(permissionFor('receivables.outstanding.list'), 'delivery')).toBe(false)
    expect(isAllowed(permissionFor('receivables.ageing.history'), 'delivery')).toBe(false)
    // The credit verdict carries the credit limit, which the shop never sees.
    expect(isAllowed(permissionFor('receivables.creditCheck'), 'retailer')).toBe(false)
    // ADR 0002: PURCHASES, STOCK and GRN postings are reachable through the books.
    for (const path of ['receivables.journal.list', 'receivables.accounts.list'] as const) {
      for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // A shop never creates, allocates, reverses or writes off money — it only pays its own bills.
    for (const path of [
      'receivables.receipts.create',
      'receivables.receipts.reverse',
      'receivables.receipts.deposit',
      'receivables.receipts.bounce',
      'receivables.allocations.create',
      'receivables.allocations.remove',
      'receivables.writeOffs.create',
      'receivables.outstanding.list',
      'receivables.ageing.history',
      'receivables.ageing.rebuild',
      'receivables.statements.send',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    expect(permissionFor('receivables.payments.initiate')).toEqual(['retailer'])
    // The shop may print its own receipt (the third white-label document).
    expect(isAllowed(permissionFor('receivables.receipts.document'), 'retailer')).toBe(true)
  })

  it('makes the accountant the money desk and nothing more (docs/22, 2026-09-05)', () => {
    expect(ROLE_GROUPS.MONEY_DESK).toEqual(['owner', 'manager', 'accountant'])
    // May: record an office receipt, reverse, bank, bounce, allocate, write off, send statements.
    for (const path of [
      'receivables.receipts.create',
      'receivables.receipts.reverse',
      'receivables.receipts.deposit',
      'receivables.receipts.bounce',
      'receivables.allocations.create',
      'receivables.allocations.remove',
      'receivables.writeOffs.create',
      'receivables.statements.send',
      'receivables.cashDiscounts.list',
      // ...and the day-end trip desk: the crew's cash handed over, the collections it took.
      'delivery.trips.settle',
      'delivery.trips.settlementPreview',
      'delivery.collections.record',
      'delivery.collections.list',
      'delivery.expenses.list',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must allow accountant`).toBe(
        true,
      )
    }
    for (const path of [
      'receivables.receipts.reverse',
      'receivables.receipts.deposit',
      'receivables.receipts.bounce',
      'receivables.allocations.create',
      'receivables.allocations.remove',
      'receivables.writeOffs.create',
      'delivery.trips.settle',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.MONEY_DESK)
    }
    // May NOT: a price, a scheme, a credit limit, an approval, a setting, a catalog row.
    const accountantMustNot = [
      'pricing.priceLists.upsert',
      'pricing.priceLists.setItems',
      'pricing.overrides.upsert',
      'pricing.schemes.upsert',
      'pricing.bargains.decide',
      'pricing.bounds.set',
      'retailers.setCredit',
      'orders.confirm',
      'orders.approvals.decide',
      'procurement.discrepancies.resolve',
      'warehouse.loadSheets.approve',
      'tenancy.settings.set',
      'tenancy.numbering.list',
      'tenancy.numbering.upsert',
      'tenancy.featureFlags.set',
      'tenancy.tenant.update',
      'tenancy.staff.create',
      'tenantCatalog.upsertListing',
      'tenantCatalog.upsertSupplier',
      'tenantCatalog.upsertCost',
      'tenantCatalog.repAuthorisations.set',
      'tenantCatalog.brands.upsert',
      'tenantCatalog.packConfigs.upsert',
      // A trip plan, a vehicle, a doorstep write or the live map are not money-desk work.
      'delivery.trips.create',
      'delivery.trips.cancel',
      'delivery.vehicles.upsert',
      'delivery.vehicles.positions',
      'delivery.deliveries.record',
      'delivery.vanSales.create',
      'delivery.gps.trace',
      // A bulk file that creates shops and listings, or a saved mapping profile, is the manager's.
      'integrations.imports.create',
      'integrations.imports.commit',
      'integrations.imports.confirm',
      'integrations.imports.rollback',
      'integrations.profiles.upsert',
    ] as const
    for (const path of accountantMustNot) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must refuse accountant`).toBe(
        false,
      )
    }
    // ...while reading every one of those surfaces.
    for (const path of [
      'pricing.priceLists.list',
      'pricing.overrides.list',
      'pricing.schemes.list',
      'pricing.bargains.list',
      'pricing.bounds.list',
      'retailers.get',
      'orders.approvals.list',
      'procurement.discrepancies.list',
      'tenancy.settings.get',
      'tenancy.featureFlags.list',
      'tenancy.audit.list',
      'tenantCatalog.costs',
      'tenantCatalog.brands.list',
      'tenantCatalog.packConfigs.list',
      'billing.registers.gstSummary',
      'receivables.journal.list',
      // ...and takes the exports and keeps the Tally names (docs/22: "reads and exports everything").
      'integrations.imports.list',
      'integrations.imports.rows.list',
      'integrations.exports.request',
      'integrations.exports.downloadUrl',
      'integrations.tally.mappings.upsert',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must allow accountant`).toBe(
        true,
      )
    }
    // The owner and the manager keep every one of the writes the accountant lost.
    for (const path of accountantMustNot) {
      for (const role of ['owner', 'manager'] as const) {
        if (path === 'pricing.bounds.set' || path.startsWith('tenancy.')) continue
        expect(isAllowed(permissionFor(path), role), `${path} must allow ${role}`).toBe(true)
      }
    }
  })

  it('lets a shop place, submit and cancel its own order and read its deals', () => {
    // docs/22 §4 draws R1 → S5: the retailer app must be able to PLACE an order (docs/23 §8.15).
    for (const path of [
      'orders.create',
      'orders.setLines',
      'orders.repeatLast',
      'orders.submit',
      'orders.cancel',
      'orders.get',
      'orders.list',
      'pricing.quote',
      'pricing.schemes.list',
      'pricing.bargains.request',
      'pricing.bargains.list',
      'retailers.updateOwn',
      'tenancy.branding.get',
      'tenancy.featureFlags.list',
      'files.readUrl',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must allow retailer`).toBe(true)
    }
    // ...and never confirms, decides, edits the shop of record or uploads anything.
    for (const path of [
      'orders.confirm',
      'orders.approvals.list',
      'orders.approvals.decide',
      'pricing.bargains.decide',
      'pricing.bounds.list',
      'retailers.upsert',
      'retailers.setCredit',
      'retailers.beats.list',
      'retailers.beats.assignments.list',
      'tenancy.settings.get',
      'tenancy.audit.list',
      'files.uploadUrl',
      'sync.upload',
      'sync.errors.list',
      'sync.pull',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    expect(permissionFor('retailers.updateOwn')).toEqual(['retailer'])
  })

  it('keeps settings with the owner and beats with the desk', () => {
    for (const path of [
      'tenancy.settings.set',
      'tenancy.numbering.list',
      'tenancy.numbering.upsert',
      'tenancy.featureFlags.set',
      'tenancy.tenant.update',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.OWNER_ONLY)
    }
    // The branding block and the flags reach every screen of every app, the shop's included.
    for (const path of ['tenancy.branding.get', 'tenancy.featureFlags.list'] as const) {
      for (const role of ALL_ROLES) {
        expect(isAllowed(permissionFor(path), role), `${path} must allow ${role}`).toBe(true)
      }
    }
    expect(permissionFor('tenancy.settings.get')).toEqual(ROLE_GROUPS.STAFF)
    expect(permissionFor('tenancy.audit.list')).toEqual(ROLE_GROUPS.BACK_OFFICE)
    expect(permissionFor('tenancy.staff.update')).toEqual(['owner', 'manager'])
    // docs/23 §8.14: a rep, a loader or a driver could create beats and assign anyone.
    for (const path of ['retailers.beats.upsert', 'retailers.beats.assign'] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager'])
    }
    expect(permissionFor('retailers.beats.assignments.list')).toEqual(ROLE_GROUPS.STAFF)
    expect(permissionFor('files.uploadUrl')).toEqual(ROLE_GROUPS.STAFF)
    expect(permissionFor('files.readUrl')).toEqual(ROLE_GROUPS.ANY_MEMBER)
  })

  it('lets a shop and a rep read a bill but never write one', () => {
    // An invoice carries no cost, so reading it is ANY_MEMBER: the rep's pending-bills chip, the
    // shop's "my bills" tab. RLS narrows the shop to its own rows; the guard only gates the verb.
    for (const path of [
      'billing.invoices.get',
      'billing.invoices.list',
      'billing.invoices.pdf',
      'billing.creditNotes.get',
      'billing.creditNotes.list',
    ] as const) {
      for (const role of ALL_ROLES) {
        expect(isAllowed(permissionFor(path), role), `${path} must allow ${role}`).toBe(true)
      }
    }
    // Every billing write and every register refuses the shopkeeper.
    for (const path of paths.filter((p) => p.startsWith('billing.'))) {
      if (
        path === 'billing.invoices.get' ||
        path === 'billing.invoices.list' ||
        path === 'billing.invoices.pdf' ||
        path === 'billing.invoices.upiQr' ||
        path === 'billing.creditNotes.get' ||
        path === 'billing.creditNotes.list'
      ) {
        continue
      }
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    // The shop may pull the QR for its own bill; a rep never handles money (docs/17 §D4).
    expect(isAllowed(permissionFor('billing.invoices.upiQr'), 'retailer')).toBe(true)
    expect(isAllowed(permissionFor('billing.invoices.upiQr'), 'salesperson')).toBe(false)
  })

  it('keeps issuing, cancelling and the GST registers with the right desks', () => {
    // A salesperson may read a bill but never issues, cancels, credits or files one.
    const repMayRead = [
      'billing.invoices.get',
      'billing.invoices.list',
      'billing.invoices.pdf',
      'billing.creditNotes.get',
      'billing.creditNotes.list',
    ]
    for (const path of paths.filter((p) => p.startsWith('billing.') && !repMayRead.includes(p))) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must refuse salesperson`).toBe(
        false,
      )
    }
    // The warehouse packs and bills, but may not cancel a numbered document (coordination §7 q13).
    expect(isAllowed(permissionFor('warehouse.packs.confirm'), 'warehouse')).toBe(true)
    expect(isAllowed(permissionFor('billing.invoices.setEwayBill'), 'warehouse')).toBe(true)
    expect(permissionFor('billing.invoices.cancel')).toEqual(['owner', 'manager'])
    expect(isAllowed(permissionFor('billing.invoices.cancel'), 'accountant')).toBe(false)
    // A van sale is billed at the door; a pack invoice is issued by packing, not by an HTTP procedure.
    expect(isAllowed(permissionFor('billing.invoices.issueVanSale'), 'delivery')).toBe(true)
    expect(isAllowed(permissionFor('warehouse.packs.confirm'), 'delivery')).toBe(false)
    // The crew raises the doorstep short-delivery note.
    expect(isAllowed(permissionFor('billing.creditNotes.create'), 'delivery')).toBe(true)
    expect(isAllowed(permissionFor('billing.creditNotes.issue'), 'delivery')).toBe(true)
    expect(isAllowed(permissionFor('billing.creditNotes.cancel'), 'delivery')).toBe(false)
    // The registers are filing documents: the three desk roles only.
    for (const path of paths.filter((p) => p.startsWith('billing.registers.'))) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
    }
    expect(permissionFor('billing.invoices.importBrandDms')).toEqual(ROLE_GROUPS.BACK_OFFICE)
    expect(permissionFor('billing.invoices.requestIrn')).toEqual(ROLE_GROUPS.BACK_OFFICE)
  })

  it('has exactly one way to move stock for a pack invoice', () => {
    // `billing.invoices.issue` was removed with the warehouse slice (coordination §4 step 3): the
    // stock-and-state half now lives in `warehouse.packs.confirm`, which calls `issueForPack`. Two
    // HTTP callers would post `sale` rows twice for one order, so re-adding the procedure is a bug.
    // `billing.invoices.issueForPack` is NOT that procedure: it bills a pack that was PARKED with
    // `issueInvoice: false` and moves no stock (docs/23 §8.2); the same people who pack may call it.
    expect(paths).not.toContain('billing.invoices.issue')
    expect(permissionFor('billing.invoices.issue')).toBeUndefined()
    expect(paths).toContain('warehouse.packs.confirm')
    expect(permissionFor('billing.invoices.issueForPack')).toEqual([
      'owner',
      'manager',
      'accountant',
      'warehouse',
    ])
    expect(isAllowed(permissionFor('billing.invoices.issueForPack'), 'delivery')).toBe(false)
  })

  it('keeps the godown floor away from the rep and the shopkeeper', () => {
    const warehousePaths = paths.filter((p) => p.startsWith('warehouse.'))
    expect(warehousePaths.length).toBeGreaterThan(0)
    // A shop is not in the room at all, and a rep never sees the godown floor: the shop learns its
    // order is being packed from `orders.get`, and `staffReadPolicy` on the five tables is the
    // database half of the same rule (coordination §5.3).
    for (const path of warehousePaths) {
      for (const role of ['retailer', 'salesperson'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
  })

  it('lets the crew read its load and write nothing in the warehouse', () => {
    // delivery-service mounts the key for exactly these six reads (the STOCK_VIEWERS rows of
    // coordination §6): what was packed for it, its load sheet and the challan it carries.
    const crewReads = [
      'warehouse.packs.list',
      'warehouse.packs.get',
      'warehouse.loadSheets.list',
      'warehouse.loadSheets.get',
      'warehouse.challans.list',
      'warehouse.challans.get',
      'warehouse.challans.pdf',
    ]
    for (const path of crewReads) {
      expect(isAllowed(permissionFor(path), 'delivery'), `${path} must allow delivery`).toBe(true)
    }
    for (const path of paths.filter((p) => p.startsWith('warehouse.') && !crewReads.includes(p))) {
      expect(isAllowed(permissionFor(path), 'delivery'), `${path} must refuse delivery`).toBe(false)
    }
  })

  it('keeps the manager PIN steps away from the picker', () => {
    // Holding an owner/manager token IS the manager's PIN (coordination §7 q15), and the PIN is given
    // in the MANAGER app (docs/22 2026-09-05): cancelling a wave, APPROVING a load sheet and cancelling
    // a sheet all refuse the warehouse role; the warehouse phone then CONFIRMS the approved sheet with
    // the crew's count, and nothing else is typed on it.
    for (const path of [
      'warehouse.picklists.cancel',
      'warehouse.loadSheets.approve',
      'warehouse.loadSheets.cancel',
    ] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager'])
    }
    expect(permissionFor('warehouse.loadSheets.confirm')).toEqual(ROLE_GROUPS.STOCK_KEEPERS)
    expect(isAllowed(permissionFor('warehouse.loadSheets.confirm'), 'accountant')).toBe(false)
    // Freeing a live order's holds and typing a government e-way bill number are desk decisions.
    for (const path of [
      'warehouse.reservations.release',
      'warehouse.challans.recordEwb',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
    }
    // The floor itself is the stock keepers, and the accountant reads the paperwork without touching it.
    for (const path of [
      'warehouse.queue.list',
      'warehouse.picklists.create',
      'warehouse.picklists.start',
      'warehouse.picklists.pick',
      'warehouse.packs.confirm',
      'warehouse.loadSheets.create',
      'warehouse.loadSheets.confirm',
      'warehouse.reservations.list',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.STOCK_KEEPERS)
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must refuse accountant`).toBe(
        false,
      )
    }
    for (const path of ['warehouse.packs.list', 'warehouse.loadSheets.get'] as const) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must allow accountant`).toBe(
        true,
      )
    }
  })

  it('keeps the doorstep money with the crew and the desk, never the rep (delivery)', () => {
    const deliveryPaths = paths.filter((p) => p.startsWith('delivery.'))
    expect(deliveryPaths.length).toBeGreaterThan(0)
    // docs/17 §D4: the salesperson NEVER collects and is in no row of the delivery block at all,
    // except the one read every member has — where its shop's order is (`stops.list`).
    for (const path of deliveryPaths.filter((p) => p !== 'delivery.stops.list')) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must refuse salesperson`).toBe(
        false,
      )
    }
    // THE money-collection path of the field: the same four who may take a receipt.
    expect(permissionFor('delivery.collections.record')).toEqual(
      permissionFor('receivables.receipts.create'),
    )
    expect(permissionFor('delivery.collections.record')).toEqual([
      'owner',
      'manager',
      'accountant',
      'delivery',
    ])
    for (const path of [
      'delivery.collections.record',
      'delivery.collections.list',
      'delivery.expenses.record',
      'delivery.expenses.list',
      'delivery.trips.settlementPreview',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'delivery'), `${path} must allow delivery`).toBe(true)
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must allow accountant`).toBe(
        true,
      )
      // The godown never touches money (coordination §6): narrower than STOCK_VIEWERS on purpose.
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must refuse warehouse`).toBe(
        false,
      )
    }
    // Settling is the money desk's; the crew sees the cockpit and never posts the handover.
    expect(permissionFor('delivery.trips.settle')).toEqual(ROLE_GROUPS.MONEY_DESK)
    expect(isAllowed(permissionFor('delivery.trips.settle'), 'delivery')).toBe(false)
    expect(isAllowed(permissionFor('delivery.trips.settle'), 'warehouse')).toBe(false)
  })

  it('lets the crew work the door and the godown only plan the trip (delivery)', () => {
    // Doorstep writes: the crew, with the owner and the manager able to do the same from the office.
    for (const path of [
      'delivery.trips.return',
      'delivery.stops.reorder',
      'delivery.stops.start',
      'delivery.stops.arrive',
      'delivery.stops.fail',
      'delivery.deliveries.record',
      'delivery.deliveries.addPod',
      'delivery.vanSales.create',
      'delivery.gps.points',
      'delivery.consents.grant',
      'delivery.consents.get',
    ] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'delivery'])
      // The van sale is billed by billing's own DOORSTEP procedure: the two must agree.
      if (path === 'delivery.vanSales.create')
        expect(permissionFor(path)).toEqual(permissionFor('billing.invoices.issueVanSale'))
    }
    // Planning and loading: the desk, the godown and the crew; never the accountant or the shop.
    for (const path of [
      'delivery.trips.create',
      'delivery.trips.startLoading',
      'delivery.trips.depart',
      'delivery.stops.add',
    ] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'warehouse', 'delivery'])
    }
    // The godown reads the plan and writes nothing at the door and nothing about money.
    const warehouseMay = [
      'delivery.vehicles.list',
      'delivery.trips.create',
      'delivery.trips.list',
      'delivery.trips.get',
      'delivery.trips.startLoading',
      'delivery.trips.depart',
      'delivery.stops.list',
      'delivery.stops.next',
      'delivery.stops.add',
    ]
    for (const path of warehouseMay) {
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must allow warehouse`).toBe(true)
    }
    for (const path of paths.filter(
      (p) => p.startsWith('delivery.') && !warehouseMay.includes(p),
    )) {
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must refuse warehouse`).toBe(
        false,
      )
    }
    // Cancelling a trip, registering a vehicle and reading where people ARE (DPDP-audited: the live
    // map and the trace, which `trip_points` RLS already limits to owner/manager) are the PIN holders'.
    for (const path of [
      'delivery.trips.cancel',
      'delivery.vehicles.upsert',
      'delivery.vehicles.positions',
      'delivery.gps.trace',
    ] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager'])
    }
  })

  it('lets a shop read only its own delivery status (delivery)', () => {
    // The retailer app tracks its order (an ETA, never a coordinate) and opens its own POD.
    const shopMay = ['delivery.stops.list', 'delivery.deliveries.list', 'delivery.deliveries.get']
    for (const path of shopMay) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must allow retailer`).toBe(true)
    }
    for (const path of paths.filter((p) => p.startsWith('delivery.') && !shopMay.includes(p))) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    // Every delivery write refuses the shop: a POST in this block is never the retailer's.
    for (const row of allProcedures().filter((r) => r.path.startsWith('delivery.'))) {
      if (row.method === 'POST')
        expect(isAllowed(row.permission, 'retailer'), `${row.path} must refuse retailer`).toBe(
          false,
        )
    }
    // The GPS endpoint keeps its own path outside `/delivery` (ADR 0012) and is a doorstep write.
    const gps = allProcedures().find((r) => r.path === 'delivery.gps.points')
    expect(gps?.httpPath).toBe('/gps/points')
    expect(gps?.method).toBe('POST')
  })

  it('lets the gate capture a supplier bill and never read its rates (docint)', () => {
    const docintPaths = paths.filter((p) => p.startsWith('docint.'))
    expect(docintPaths.length).toBeGreaterThan(0)
    // The field and the shop are in no row at all: a supplier bill is a page full of purchase rates
    // (docs/17 A12, never-list 1); RLS scopes them to `pod` / `claim_sheet` / `other` by kind.
    for (const path of docintPaths) {
      for (const role of ['salesperson', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // CAP (coordination §6 = the existing BACK_OFFICE_OR_WAREHOUSE): capture and status on the phone.
    const capture = [
      'docint.documents.create',
      'docint.documents.pageUploadUrl',
      'docint.documents.addPage',
      'docint.documents.verifyQr',
      'docint.documents.submit',
      'docint.documents.list',
      'docint.documents.get',
      'docint.documents.status',
      'docint.documents.pageUrl',
    ]
    for (const path of capture) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'accountant', 'warehouse'])
    }
    // Every other docint procedure is the back office: the reading (printed rates), the SKU
    // candidates, the review, the queue, the stats, reject and approve. The warehouse role reads zero
    // rows of those tables in the database (rls.test.ts), so the matrix must agree.
    for (const path of docintPaths.filter((p) => !capture.includes(p))) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must refuse warehouse`).toBe(
        false,
      )
    }
    // Approving books a supplier invoice DRAFT, never a GRN: the two are the same three people, and
    // posting the GRN (where cost is written) stays a separate BACK_OFFICE call.
    expect(permissionFor('docint.documents.approve')).toEqual(ROLE_GROUPS.BACK_OFFICE)
    expect(permissionFor('docint.documents.approve')).toEqual(
      permissionFor('procurement.supplierInvoices.create'),
    )
    expect(permissionFor('procurement.grns.post')).toEqual(ROLE_GROUPS.BACK_OFFICE)
    // The accountant reviews and approves inbound bills (brief §5: the CA reviews them).
    for (const path of [
      'docint.review.start',
      'docint.review.save',
      'docint.review.submit',
      'docint.documents.approve',
      'docint.queue.list',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must allow accountant`).toBe(
        true,
      )
    }
    // Every docint write refuses the shop and the rep; every capture write admits the gate.
    for (const row of allProcedures().filter((r) => r.path.startsWith('docint.'))) {
      if (row.method !== 'POST') continue
      expect(isAllowed(row.permission, 'retailer'), `${row.path} must refuse retailer`).toBe(false)
      expect(isAllowed(row.permission, 'salesperson'), `${row.path} must refuse salesperson`).toBe(
        false,
      )
    }
    for (const path of capture.filter(
      (p) => allProcedures().find((r) => r.path === p)?.method === 'POST',
    )) {
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must allow warehouse`).toBe(true)
    }
  })

  it('keeps the file bridge with the desk: the accountant reads and exports, never imports (integrations)', () => {
    const integrationsPaths = paths.filter((p) => p.startsWith('integrations.'))
    expect(integrationsPaths.length).toBeGreaterThan(0)
    // No field role and no shop anywhere: a party master carries phones and GSTINs of every shop, an
    // outstanding file is money, and the six tables are BACK_OFFICE_ROLES in RLS since 0003.
    for (const path of integrationsPaths) {
      for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // The importer's writes are the owner's and the manager's: a bulk file creates retailers and
    // listings (rows the accountant may not edit one at a time either) and a saved profile is a setting.
    const importerWrites = [
      'integrations.imports.create',
      'integrations.imports.setMapping',
      'integrations.imports.dryRun',
      'integrations.imports.rows.review',
      'integrations.imports.commit',
      'integrations.imports.confirm',
      'integrations.imports.rollback',
      'integrations.imports.cancel',
      'integrations.profiles.upsert',
    ]
    for (const path of importerWrites) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager'])
      expect(permissionFor(path), path).toEqual(permissionFor('tenantCatalog.upsertListing'))
    }
    // The accountant reads every import, its rows and the profiles...
    for (const path of [
      'integrations.imports.list',
      'integrations.imports.get',
      'integrations.imports.preview',
      'integrations.imports.rows.list',
      'integrations.profiles.list',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
    }
    // ...takes every export and keeps the Tally names (ROLE_GROUPS.MONEY_DESK: "who takes the exports").
    for (const path of [
      'integrations.exports.request',
      'integrations.tally.mappings.upsert',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.MONEY_DESK)
    }
    for (const path of [
      'integrations.exports.list',
      'integrations.exports.get',
      'integrations.exports.downloadUrl',
      'integrations.tally.mappings.list',
      'integrations.tally.syncLedger.list',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must allow accountant`).toBe(
        true,
      )
    }
    // Every write in the block is a POST that admits the owner and the manager; every GET is a read
    // the accountant shares. Nothing here is ever a write the accountant alone could take.
    for (const row of allProcedures().filter((r) => r.path.startsWith('integrations.'))) {
      for (const role of ['owner', 'manager'] as const) {
        expect(isAllowed(row.permission, role), `${row.path} must allow ${role}`).toBe(true)
      }
      if (row.method === 'GET') {
        expect(isAllowed(row.permission, 'accountant'), `${row.path} must allow accountant`).toBe(
          true,
        )
      }
      if (importerWrites.includes(row.path)) {
        expect(row.method, row.path).toBe('POST')
        expect(isAllowed(row.permission, 'accountant'), `${row.path} must refuse accountant`).toBe(
          false,
        )
      }
    }
  })

  it('lets only auth and health be reached without a token', () => {
    const open = paths.filter((p) => permissionFor(p) === 'public')
    expect(open.sort()).toEqual(
      [
        'auth.jwks',
        'auth.login',
        'auth.logout',
        'auth.refresh',
        'auth.switchTenant',
        'auth.forgotPassword',
        'auth.resetPassword',
        'health.ping',
      ].sort(),
    )
  })
})

describe('role groups', () => {
  it('lists every membership role exactly once in ANY_MEMBER', () => {
    expect([...ROLE_GROUPS.ANY_MEMBER].sort()).toEqual([...ALL_ROLES].sort())
    expect(new Set(ALL_ROLES).size).toBe(ALL_ROLES.length)
    for (const role of ALL_ROLES) expect(MembershipRoleSchema.safeParse(role).success).toBe(true)
  })

  it('excludes the shopkeeper from STAFF and includes the new warehouse role', () => {
    expect(ROLE_GROUPS.STAFF).not.toContain('retailer')
    expect(ROLE_GROUPS.STAFF).toContain('warehouse')
    expect([...ROLE_GROUPS.STAFF].sort()).toEqual(
      ALL_ROLES.filter((r) => r !== 'retailer')
        .slice()
        .sort(),
    )
  })

  it('keeps the back office to the three desk roles', () => {
    expect(ROLE_GROUPS.BACK_OFFICE).toEqual(['owner', 'manager', 'accountant'])
    expect(ROLE_GROUPS.MONEY_DESK).toEqual(['owner', 'manager', 'accountant'])
    expect(ROLE_GROUPS.OWNER_ONLY).toEqual(['owner'])
    expect(ROLE_GROUPS.FIELD).toEqual(['salesperson', 'delivery'])
    expect(ROLE_GROUPS.STOCK_KEEPERS).toContain('warehouse')
  })
})

describe('isAllowed', () => {
  it('lets anyone through a public procedure', () => {
    expect(isAllowed('public', null)).toBe(true)
    expect(isAllowed('public', 'retailer')).toBe(true)
  })

  it('needs a token for an authenticated procedure', () => {
    expect(isAllowed('authenticated', null)).toBe(false)
    for (const role of ALL_ROLES) expect(isAllowed('authenticated', role)).toBe(true)
  })

  it('matches the role against the list', () => {
    expect(isAllowed(ROLE_GROUPS.BACK_OFFICE, 'accountant')).toBe(true)
    expect(isAllowed(ROLE_GROUPS.BACK_OFFICE, 'salesperson')).toBe(false)
    expect(isAllowed(ROLE_GROUPS.BACK_OFFICE, null)).toBe(false)
    expect(isAllowed(ROLE_GROUPS.STOCK_KEEPERS, 'warehouse')).toBe(true)
  })

  it('refuses an undeclared procedure', () => {
    expect(isAllowed(undefined, 'owner')).toBe(false)
    expect(isAllowed(permissionFor('orders.thisDoesNotExist'), 'owner')).toBe(false)
  })

  it('agrees with the matrix for every procedure and every role', () => {
    for (const p of allProcedures()) {
      const allowedRoles = ALL_ROLES.filter((role: MembershipRole) => isAllowed(p.permission, role))
      if (p.permission === 'public' || p.permission === 'authenticated') {
        expect(allowedRoles.length, p.path).toBe(ALL_ROLES.length)
      } else {
        expect(allowedRoles.length, p.path).toBe(p.permission?.length)
      }
    }
  })
})

describe('listProcedures', () => {
  it('returns a method, an HTTP path and a permission for every procedure', () => {
    const rows = allProcedures()
    expect(rows).toHaveLength(paths.length)
    for (const row of rows) {
      expect(['GET', 'POST'], row.path).toContain(row.method)
      expect(row.httpPath.startsWith('/'), row.path).toBe(true)
      expect(row.summary.length, row.path).toBeGreaterThan(0)
      expect(row.permission, row.path).toBeDefined()
    }
  })

  it('never routes two procedures to the same method and URL', () => {
    const seen = new Map<string, string>()
    for (const row of allProcedures()) {
      const key = `${row.method} ${row.httpPath}`
      expect(seen.get(key), `${key} is claimed by ${seen.get(key)} and ${row.path}`).toBeUndefined()
      seen.set(key, row.path)
    }
  })

  it('walks a subset of the contract with the same paths as the whole', () => {
    const rows = listProcedures({ auth: contract.auth })
    expect(rows.map((r) => r.path)).toEqual([
      'auth.login',
      'auth.refresh',
      'auth.logout',
      'auth.switchTenant',
      'auth.me',
      'auth.sessions',
      'auth.revokeSession',
      'auth.changePassword',
      'auth.forgotPassword',
      'auth.resetPassword',
      'auth.jwks',
    ])
    expect(rows.find((r) => r.path === 'auth.jwks')?.httpPath).toBe('/.well-known/jwks.json')
    expect(rows.find((r) => r.path === 'auth.me')?.method).toBe('GET')
  })

  it('is empty for something that is not a router', () => {
    expect(listProcedures(null)).toEqual([])
    expect(listProcedures('nope')).toEqual([])
  })
})
