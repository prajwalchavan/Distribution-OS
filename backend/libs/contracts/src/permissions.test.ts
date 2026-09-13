import { describe, expect, it } from 'vitest'
import { contract } from './contract.js'
import {
  MembershipRoleSchema,
  PlatformAdminLevelSchema,
  PlatformRoleSchema,
  type MembershipRole,
  type PlatformRole,
} from './common.js'
import {
  ADMIN_LEVELS,
  ALL_ROLES,
  allProcedures,
  isAllowed,
  levelAllows,
  listProcedures,
  PERMISSIONS,
  permissionFor,
  PLATFORM_ROLES,
  ROLE_GROUPS,
  type AdminProcedurePath,
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

  it('names only real roles, and mixes membership with platform roles nowhere', () => {
    for (const [path, permission] of Object.entries(PERMISSIONS)) {
      if (permission === 'public' || permission === 'authenticated') continue
      expect(permission.length, path).toBeGreaterThan(0)
      const membership = permission.filter((r) => MembershipRoleSchema.safeParse(r).success)
      const platform = permission.filter((r) => PlatformRoleSchema.safeParse(r).success)
      // Every named role is one or the other...
      expect(membership.length + platform.length, `${path} names an unknown role`).toBe(
        permission.length,
      )
      // ...and never both in one row: a procedure is either a distributor's or the platform's, and a
      // row that mixed them would be the one way a tenant role could reach the console.
      expect(
        membership.length === 0 || platform.length === 0,
        `${path} mixes membership and platform roles`,
      ).toBe(true)
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
      // A damage / expiry claim line is valued at PTD: `ratePaise` on it IS purchase cost.
      'claims.lines.list',
      'claims.get',
      'claims.build',
      // Stock at cost, MTD margin, the margin and stock series (reporting).
      'reporting.dashboard.owner',
      'reporting.registers.stockValue',
      'reporting.series.stock',
      'reporting.series.grossMargin',
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
      // ...the registers and the money series are its home screen (M12, reporting)...
      'reporting.dashboard.owner',
      'reporting.series.collections',
      'reporting.registers.collections',
      'reporting.registers.gstSalesRegister',
      'reporting.registers.gstPurchaseRegister',
      'reporting.exports.request',
      'reporting.exports.get',
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
    ] as const) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    expect(permissionFor('retailers.updateOwn')).toEqual(['retailer'])
  })

  it('gives every app the offline reads and keeps the write queue with the staff (sync)', () => {
    // docs/22 2026-09-05: the offline protocol is ours. The manifest and the delta download are the
    // read half, and the shop's app is offline-capable for its own rows, so both are ANY_MEMBER.
    for (const path of ['sync.manifest', 'sync.pull'] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.ANY_MEMBER)
      for (const role of ALL_ROLES) {
        expect(isAllowed(permissionFor(path), role), `${path} must allow ${role}`).toBe(true)
      }
    }
    // The write queue and its rejection tray stay with the distributor's own people: a shop places an
    // order through `orders.*` online, and never holds a device queue of its own.
    for (const path of ['sync.upload', 'sync.errors.list'] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.STAFF)
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
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

  it('keeps claims to the desk: policy with the owner, the loss with the owner and the accountant (claims)', () => {
    const claimsPaths = paths.filter((p) => p.startsWith('claims.'))
    expect(claimsPaths.length).toBeGreaterThan(0)
    // No field role and no shop anywhere: a damage line is valued at purchase cost and a scheme line
    // says which schemes the brand funds (brief §4.21); the five tables are BACK_OFFICE_ROLES in RLS
    // and only owner- and manager-service mount the key.
    for (const path of claimsPaths) {
      for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
      // The owner may do everything in the module.
      expect(isAllowed(permissionFor(path), 'owner'), `${path} must allow owner`).toBe(true)
    }
    // A brand's claim policy is a setting about what money the business believes it can recover.
    expect(permissionFor('claims.policies.upsert')).toEqual(ROLE_GROUPS.OWNER_ONLY)
    // Accepting a loss is the owner's or the accountant's, never the manager's (brief §2).
    expect(permissionFor('claims.writeOff')).toEqual(['owner', 'accountant'])
    expect(isAllowed(permissionFor('claims.writeOff'), 'manager')).toBe(false)
    // Everything else is the three desk roles, the accountant included: a claim is an entry in the
    // books (coordination §6 "every claims.* = BACK_OFFICE").
    for (const path of claimsPaths.filter(
      (p) => p !== 'claims.policies.upsert' && p !== 'claims.writeOff',
    )) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
    }
    // The money-moving writes the accountant shares with the desk, and the one it shares with the owner alone.
    for (const path of [
      'claims.open',
      'claims.build',
      'claims.submit',
      'claims.settlements.record',
      'claims.reject',
      'claims.writeOff',
      'claims.statements.generate',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must allow accountant`).toBe(
        true,
      )
    }
    // The manager builds and submits but neither sets the policy nor writes off.
    expect(isAllowed(permissionFor('claims.submit'), 'manager')).toBe(true)
    expect(isAllowed(permissionFor('claims.policies.upsert'), 'manager')).toBe(false)
    // Every claims write is a POST that refuses the field and the shop; every read is a GET the
    // accountant shares. The static reads keep their own paths beside `GET /claims/{id}`.
    for (const row of allProcedures().filter((r) => r.path.startsWith('claims.'))) {
      if (row.method === 'GET') {
        expect(isAllowed(row.permission, 'accountant'), `${row.path} must allow accountant`).toBe(
          true,
        )
      }
      for (const role of ['salesperson', 'delivery', 'retailer'] as const) {
        expect(isAllowed(row.permission, role), `${row.path} must refuse ${role}`).toBe(false)
      }
    }
    for (const [path, httpPath] of [
      ['claims.policies.list', '/claims/policies'],
      ['claims.periods.list', '/claims/periods'],
      ['claims.ageing', '/claims/ageing'],
      ['claims.register', '/claims/register'],
      ['claims.reconcile.suggest', '/claims/reconcile'],
      ['claims.get', '/claims/{id}'],
    ] as const) {
      const row = allProcedures().find((r) => r.path === path)
      expect(row?.httpPath, path).toBe(httpPath)
      expect(row?.method, path).toBe('GET')
    }
  })

  it('keeps the wording and the audience with the desk, the inbox with everyone (notifications)', () => {
    const notificationPaths = paths.filter((p) => p.startsWith('notifications.'))
    expect(notificationPaths).toHaveLength(14)
    // The log / inbox and "mark my notice read" reach every member, the shop included: RLS scopes the
    // shop to rows addressed to its own shop, the handler scopes the rep to its beats' shops.
    const inbox = [
      'notifications.messages.list',
      'notifications.messages.get',
      'notifications.messages.markRead',
    ]
    for (const path of inbox) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.ANY_MEMBER)
    }
    // The shop reads its inbox and nothing else: no template, no broadcast, no resend, no send, no
    // triage, no push token (the retailer app is WhatsApp / in-app first, brief §8.7).
    for (const path of notificationPaths.filter((p) => !inbox.includes(p))) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    // Every write in the block is a POST that refuses the shop, except marking its own notice read.
    for (const row of allProcedures().filter((r) => r.path.startsWith('notifications.'))) {
      if (row.method === 'POST' && row.path !== 'notifications.messages.markRead')
        expect(isAllowed(row.permission, 'retailer'), `${row.path} must refuse retailer`).toBe(
          false,
        )
    }
    // Wording and audience are the owner's and the manager's (coordination §6: the same two people it
    // calls PIN_HOLDERS); the accountant reads templates and broadcast history and resends a failed row.
    for (const path of [
      'notifications.templates.upsert',
      'notifications.broadcasts.create',
    ] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager'])
      expect(permissionFor(path), path).toEqual(permissionFor('pricing.schemes.upsert'))
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} must refuse accountant`).toBe(
        false,
      )
    }
    for (const path of [
      'notifications.templates.list',
      'notifications.broadcasts.list',
      'notifications.broadcasts.get',
      'notifications.messages.resend',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
    }
    // The rep READS what went to its shops and what they wrote back, and sends nothing: never a
    // template, a broadcast, a resend or an on-demand send (notifications.ts founder answer 3).
    for (const path of [
      'notifications.messages.list',
      'notifications.messages.get',
      'notifications.inbound.list',
      'notifications.inbound.markHandled',
      'notifications.pushTokens.register',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must allow salesperson`).toBe(
        true,
      )
    }
    for (const path of [
      'notifications.messages.send',
      'notifications.messages.resend',
      'notifications.templates.list',
      'notifications.templates.upsert',
      'notifications.broadcasts.create',
      'notifications.broadcasts.list',
      'notifications.broadcasts.get',
    ] as const) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must refuse salesperson`).toBe(
        false,
      )
    }
    // On-demand "send this bill to the shop now" is the desk and the crew at the door (docs/23 §8.8:
    // D9, M9, O6) — the same four who take money at the door, and never the rep or the godown.
    expect(permissionFor('notifications.messages.send')).toEqual([
      'owner',
      'manager',
      'accountant',
      'delivery',
    ])
    expect(permissionFor('notifications.messages.send')).toEqual(
      permissionFor('receivables.receipts.create'),
    )
    expect(isAllowed(permissionFor('notifications.messages.send'), 'warehouse')).toBe(false)
    // Triage is the desk plus the beat-owning rep; the godown and the crew are not in the room.
    for (const path of [
      'notifications.inbound.list',
      'notifications.inbound.markHandled',
    ] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'accountant', 'salesperson'])
      for (const role of ['warehouse', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // Every staff member registers its own device; the godown and the crew otherwise only read their inbox.
    for (const path of [
      'notifications.pushTokens.register',
      'notifications.pushTokens.unregister',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.STAFF)
    }
    const crewMay = [
      ...inbox,
      'notifications.pushTokens.register',
      'notifications.pushTokens.unregister',
    ]
    for (const path of notificationPaths.filter((p) => !crewMay.includes(p))) {
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must refuse warehouse`).toBe(
        false,
      )
      if (path !== 'notifications.messages.send')
        expect(isAllowed(permissionFor(path), 'delivery'), `${path} must refuse delivery`).toBe(
          false,
        )
    }
    // The on-demand send lives beside the resend under one prefix, and neither is a GET.
    for (const [path, httpPath] of [
      ['notifications.messages.send', '/notifications/messages/send'],
      ['notifications.messages.resend', '/notifications/messages/{id}/resend'],
      ['notifications.messages.markRead', '/notifications/messages/{id}/read'],
      ['notifications.inbound.markHandled', '/notifications/inbound/{id}/handled'],
    ] as const) {
      const row = allProcedures().find((r) => r.path === path)
      expect(row?.httpPath, path).toBe(httpPath)
      expect(row?.method, path).toBe('POST')
    }
  })

  it('keeps the tiles, the graphs and the registers with the desk, a field role to its own (reporting)', () => {
    const reportingPaths = paths.filter((p) => p.startsWith('reporting.'))
    expect(reportingPaths).toHaveLength(33)
    // A shop never opens a report (docs/plans/reporting.md §1): no row of the block names the retailer,
    // and retailer-service does not mount the key at all.
    for (const path of reportingPaths) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    // Everything is a read except queueing an export, which is the one POST.
    for (const row of allProcedures().filter((r) => r.path.startsWith('reporting.'))) {
      expect(row.method, row.path).toBe(row.path === 'reporting.exports.request' ? 'POST' : 'GET')
    }
    // The owner reads everything; the manager everything but the margin trend (O17 is owner-only).
    for (const path of reportingPaths) {
      expect(isAllowed(permissionFor(path), 'owner'), `${path} must allow owner`).toBe(true)
      expect(isAllowed(permissionFor(path), 'manager'), `${path} must allow manager`).toBe(
        path !== 'reporting.series.grossMargin',
      )
    }
    expect(permissionFor('reporting.series.grossMargin')).toEqual(ROLE_GROUPS.OWNER_ONLY)
    // The accountant reads and exports everything (docs/22 2026-09-05) — the registers, the money
    // series, the rankings, stock at cost — and never the margin series.
    for (const path of reportingPaths) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} for accountant`).toBe(
        path !== 'reporting.series.grossMargin',
      )
    }
    expect(permissionFor('reporting.exports.request')).toEqual(ROLE_GROUPS.MONEY_DESK)
    expect(permissionFor('reporting.exports.request')).toEqual(
      permissionFor('integrations.exports.request'),
    )
    // The rep sees ITS OWN numbers and its shops' habits — nothing tenant-wide, no register of money,
    // no export, and never a cost.
    const repMay = [
      'reporting.dashboard.rep',
      'reporting.dailyStats.rep',
      'reporting.retailers.behaviour',
      'reporting.retailers.series',
      'reporting.retailers.lapsed',
      'reporting.registers.repProductivity',
      'reporting.series.productivity',
    ]
    for (const path of repMay) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'accountant', 'salesperson'])
    }
    for (const path of reportingPaths.filter((p) => !repMay.includes(p))) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must refuse salesperson`).toBe(
        false,
      )
    }
    // The godown reads the fill rate (register and series) and nothing else.
    const warehouseMay = ['reporting.registers.fillRate', 'reporting.series.fillRate']
    for (const path of warehouseMay) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'accountant', 'warehouse'])
      expect(permissionFor(path), path).toEqual(permissionFor('inventory.stock.adjust'))
    }
    for (const path of reportingPaths.filter((p) => !warehouseMay.includes(p))) {
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must refuse warehouse`).toBe(
        false,
      )
    }
    // The crew reads its own trips' performance (register and series) and nothing else.
    const crewMay = [
      'reporting.registers.deliveryPerformance',
      'reporting.series.deliveryPerformance',
    ]
    for (const path of crewMay) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'accountant', 'delivery'])
    }
    for (const path of reportingPaths.filter((p) => !crewMay.includes(p))) {
      expect(isAllowed(permissionFor(path), 'delivery'), `${path} must refuse delivery`).toBe(false)
    }
    // Cost and margin never reach the field: the never-list (docs/22 §9 item 1) at the matrix.
    for (const path of [
      'reporting.dashboard.owner',
      'reporting.registers.stockValue',
      'reporting.series.stock',
      'reporting.series.grossMargin',
      'reporting.series.schemeSpend',
      'reporting.registers.schemeSpend',
    ] as const) {
      for (const role of ['salesperson', 'warehouse', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // The wrapped GST register is guarded exactly like the register it wraps.
    expect(permissionFor('reporting.registers.gstSalesRegister')).toEqual(
      permissionFor('billing.registers.gstSummary'),
    )
    // The series family lives under one prefix; the docs/23 §1.2 generic read keeps its path.
    for (const [path, httpPath] of [
      ['reporting.series.get', '/reporting/series'],
      ['reporting.series.growth', '/reporting/series/growth'],
      ['reporting.series.grossMargin', '/reporting/series/gross-margin'],
      ['reporting.retailers.series', '/reporting/retailers/{id}/series'],
      ['reporting.registers.gstSalesRegister', '/reporting/registers/gst-sales'],
      ['reporting.exports.request', '/reporting/exports'],
      ['reporting.exports.get', '/reporting/exports/{id}'],
    ] as const) {
      const row = allProcedures().find((r) => r.path === path)
      expect(row?.httpPath, path).toBe(httpPath)
    }
  })

  it('keeps assigning a target and signing off a payout with the owner (incentives)', () => {
    const incentivePaths = paths.filter((p) => p.startsWith('incentives.'))
    expect(incentivePaths).toHaveLength(14)
    // Internal staff performance data: the shopkeeper and the godown appear in no row, and the key is
    // not mounted on retailer- or warehouse-service at all (coordination §6).
    for (const path of incentivePaths) {
      for (const role of ['retailer', 'warehouse'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
      // The owner reads and decides everything EXCEPT `progress.mine`, which is the field's own screen
      // (coordination §6: `ROLE_GROUPS.FIELD`) — an owner holds no target and reads the team instead.
      expect(isAllowed(permissionFor(path), 'owner'), `${path} for owner`).toBe(
        path !== 'incentives.progress.mine',
      )
    }
    // Only the owner assigns a target or signs off a statement (coordination §7 q20, brief §4.8) —
    // narrower than `computed_payouts`' back-office write policy on purpose.
    const ownerOnly = [
      'incentives.targets.upsert',
      'incentives.targets.bulkAssign',
      'incentives.targets.remove',
      'incentives.statements.approve',
      'incentives.statements.reopen',
    ]
    for (const path of ownerOnly) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.OWNER_ONLY)
    }
    // The manager and the accountant see the whole team and run the numbers, and change nothing.
    const deskMayRun = [
      'incentives.targets.whatIf',
      'incentives.targets.refresh',
      'incentives.progress.team',
      'incentives.statements.compute',
    ]
    for (const path of deskMayRun) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.BACK_OFFICE)
    }
    for (const path of ownerOnly) {
      for (const role of ['manager', 'accountant'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // A rep and a crew member read their own target and their own statement (RLS narrows the row), and
    // `progress.mine` is theirs alone — the desk has `progress.team` for the same question.
    const ownReads = [
      'incentives.targets.get',
      'incentives.targets.list',
      'incentives.statements.get',
      'incentives.statements.list',
    ]
    for (const path of ownReads) {
      expect(permissionFor(path), path).toEqual([
        'owner',
        'manager',
        'accountant',
        'salesperson',
        'delivery',
      ])
    }
    expect(permissionFor('incentives.progress.mine')).toEqual(ROLE_GROUPS.FIELD)
    for (const path of incentivePaths.filter(
      (p) => !ownReads.includes(p) && p !== 'incentives.progress.mine',
    )) {
      for (const role of ['salesperson', 'delivery'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // Reads are GETs; everything that computes or changes something is a POST, `whatIf` included (it is
    // POST because it carries a slab table, not because it writes — it writes nothing).
    const gets = new Set([...ownReads, 'incentives.progress.mine', 'incentives.progress.team'])
    for (const row of allProcedures().filter((r) => r.path.startsWith('incentives.'))) {
      expect(row.method, row.path).toBe(gets.has(row.path) ? 'GET' : 'POST')
    }
    for (const [path, httpPath] of [
      ['incentives.targets.upsert', '/incentives/targets'],
      ['incentives.targets.bulkAssign', '/incentives/targets/bulk'],
      ['incentives.targets.whatIf', '/incentives/targets/what-if'],
      ['incentives.targets.get', '/incentives/targets/{id}'],
      ['incentives.targets.refresh', '/incentives/targets/{id}/refresh'],
      ['incentives.progress.mine', '/incentives/progress'],
      ['incentives.progress.team', '/incentives/progress/team'],
      ['incentives.statements.compute', '/incentives/statements/compute'],
      ['incentives.statements.approve', '/incentives/statements/{id}/approve'],
    ] as const) {
      const row = allProcedures().find((r) => r.path === path)
      expect(row?.httpPath, path).toBe(httpPath)
    }
  })

  it('keeps the assistant advisory: drafts with the order takers, buying with the desk, routes with the crew (ai)', () => {
    const aiPaths = paths.filter((p) => p.startsWith('ai.'))
    expect(aiPaths).toHaveLength(11)
    // Nothing on this contract is a money surface, so the accountant — the money desk and nothing more
    // (docs/22, 2026-09-05) — reads only the forecast, which is BACK_OFFICE.
    const accountantMay = ['ai.forecast.run', 'ai.forecast.list']
    for (const path of aiPaths) {
      expect(isAllowed(permissionFor(path), 'accountant'), `${path} for accountant`).toBe(
        accountantMay.includes(path),
      )
      // The owner reaches every AI surface; it is the app the whole assistant was asked for.
      expect(isAllowed(permissionFor(path), 'owner'), `${path} for owner`).toBe(true)
    }
    // Intake and drafts: the desk, the rep for its own shops, the shop for itself. Never the accountant,
    // the godown or the crew. `confirm` creates the order through orders.create/setLines/submit, all of
    // which are ANY_MEMBER, so this tuple can only narrow the ordering surface.
    const draftPaths = aiPaths.filter(
      (p) => p.startsWith('ai.intake.') || p.startsWith('ai.drafts.'),
    )
    expect(draftPaths).toHaveLength(6)
    for (const path of draftPaths) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'salesperson', 'retailer'])
      for (const role of ['accountant', 'warehouse', 'delivery'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
      // Every draft procedure is a narrowing of an ordering procedure the same role already reaches.
      for (const role of ALL_ROLES) {
        if (!isAllowed(permissionFor(path), role)) continue
        expect(
          isAllowed(permissionFor('orders.create'), role),
          `${path} widens orders.create`,
        ).toBe(true)
        expect(
          isAllowed(permissionFor('orders.submit'), role),
          `${path} widens orders.submit`,
        ).toBe(true)
      }
    }
    // Buying: the desk runs the pass, the godown reads what is short. A suggestion carries pieces, days
    // of cover and a supplier and no purchase rate — that is what makes the warehouse read safe.
    expect(permissionFor('ai.forecast.run')).toEqual(ROLE_GROUPS.BACK_OFFICE)
    expect(permissionFor('ai.forecast.list')).toEqual([
      'owner',
      'manager',
      'accountant',
      'warehouse',
    ])
    expect(isAllowed(permissionFor('ai.forecast.run'), 'warehouse')).toBe(false)
    for (const path of ['ai.forecast.run', 'ai.forecast.list'] as const) {
      for (const role of ['salesperson', 'delivery', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // Routing: the desk and the crew compute and apply, the godown also reads (it loads the van in that
    // order). `apply` writes through `delivery.stops.reorder`, so it must not admit a role that cannot
    // already re-sequence a trip by hand.
    for (const path of ['ai.routing.plan', 'ai.routing.apply'] as const) {
      expect(permissionFor(path), path).toEqual(['owner', 'manager', 'delivery'])
      expect(isAllowed(permissionFor(path), 'warehouse'), `${path} must refuse warehouse`).toBe(
        false,
      )
      for (const role of ALL_ROLES) {
        if (!isAllowed(permissionFor(path), role)) continue
        expect(
          isAllowed(permissionFor('delivery.stops.reorder'), role),
          `${path} widens delivery.stops.reorder`,
        ).toBe(true)
      }
    }
    expect(permissionFor('ai.routing.get')).toEqual(['owner', 'manager', 'warehouse', 'delivery'])
    for (const path of aiPaths.filter((p) => p.startsWith('ai.routing.'))) {
      for (const role of ['accountant', 'salesperson', 'retailer'] as const) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
    // Reads are GETs; everything that writes a draft, a run or a sequence is a POST.
    const gets = new Set(['ai.drafts.list', 'ai.drafts.get', 'ai.forecast.list', 'ai.routing.get'])
    for (const row of allProcedures().filter((r) => r.path.startsWith('ai.'))) {
      expect(row.method, row.path).toBe(gets.has(row.path) ? 'GET' : 'POST')
    }
    for (const [path, httpPath] of [
      ['ai.intake.parseText', '/ai/intake/text'],
      ['ai.intake.transcribe', '/ai/intake/voice'],
      ['ai.drafts.list', '/ai/drafts'],
      ['ai.drafts.get', '/ai/drafts/{id}'],
      ['ai.drafts.confirm', '/ai/drafts/{id}/confirm'],
      ['ai.drafts.reject', '/ai/drafts/{id}/reject'],
      ['ai.forecast.run', '/ai/forecast/run'],
      ['ai.forecast.list', '/ai/forecast'],
      ['ai.routing.plan', '/ai/routing/trips/{tripId}/plan'],
      ['ai.routing.get', '/ai/routing/trips/{tripId}/plan'],
      ['ai.routing.apply', '/ai/routing/trips/{tripId}/plan/apply'],
    ] as const) {
      const row = allProcedures().find((r) => r.path === path)
      expect(row?.httpPath, path).toBe(httpPath)
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
        // The platform console's sign-in and its refresh: public for the same reason every sign-in is.
        'auth.platformLogin',
        'auth.platformRefresh',
        'health.ping',
      ].sort(),
    )
  })

  it('keeps the platform console and the six apps out of each other (admin)', () => {
    const adminPaths = paths.filter((p) => p.startsWith('admin.'))
    expect(adminPaths).toHaveLength(15)
    // Every admin row is the platform group and only the platform group.
    for (const path of adminPaths) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.PLATFORM)
      expect(permissionFor(path), path).toEqual(['platform_admin'])
    }
    // NO tenant role may call `admin.*` — not the owner of a distributorship, not any of the other six.
    for (const path of adminPaths) {
      for (const role of ALL_ROLES) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
      expect(isAllowed(permissionFor(path), null), `${path} must refuse an anonymous caller`).toBe(
        false,
      )
    }
    // ...and `platform_admin` may call NOTHING under any tenant service: the only paths outside
    // `admin.*` it reaches are on the auth service (its own sign-in, refresh and `me`) and health.
    const platformMayReach = new Set([
      ...adminPaths,
      'auth.platformLogin',
      'auth.platformRefresh',
      'auth.platformMe',
      // The support pass: the console's only route to a distributor's own data, and it opens nothing
      // by itself — the handler refuses a grant the distributor's owner has not approved.
      'auth.supportPass',
      // Shared session management: 'authenticated', and a platform session is a session.
      'auth.login',
      'auth.refresh',
      'auth.logout',
      'auth.switchTenant',
      'auth.jwks',
      'auth.forgotPassword',
      'auth.resetPassword',
      'auth.me',
      'auth.sessions',
      'auth.revokeSession',
      'auth.changePassword',
      'health.ping',
    ])
    for (const path of paths) {
      expect(isAllowed(permissionFor(path), 'platform_admin'), `${path} for platform_admin`).toBe(
        platformMayReach.has(path),
      )
    }
    // Said the other way round, because this is the guarantee the founder asked for: nothing a
    // distributor's app calls is reachable by the console.
    for (const path of paths.filter((p) => !p.startsWith('auth.') && !p.startsWith('health.'))) {
      expect(
        isAllowed(permissionFor(path), 'platform_admin'),
        `${path} must refuse platform_admin`,
      ).toBe(path.startsWith('admin.'))
    }
    // Reads are GETs; onboarding, suspension, plans, a support ask and a user lock are POSTs.
    const gets = new Set([
      'admin.tenants.list',
      'admin.tenants.get',
      'admin.subscriptions.list',
      'admin.subscriptions.get',
      'admin.support.list',
      'admin.users.list',
      'admin.metrics.overview',
      'admin.audit.list',
    ])
    for (const row of allProcedures().filter((r) => r.path.startsWith('admin.'))) {
      expect(row.method, row.path).toBe(gets.has(row.path) ? 'GET' : 'POST')
      expect(row.httpPath.startsWith('/admin/'), row.path).toBe(true)
    }
    for (const [path, httpPath] of [
      ['admin.tenants.create', '/admin/tenants'],
      ['admin.tenants.get', '/admin/tenants/{id}'],
      ['admin.tenants.suspend', '/admin/tenants/{id}/suspend'],
      ['admin.tenants.reactivate', '/admin/tenants/{id}/reactivate'],
      ['admin.subscriptions.upsert', '/admin/subscriptions'],
      ['admin.support.request', '/admin/support-grants'],
      ['admin.support.revoke', '/admin/support-grants/{id}/revoke'],
      ['admin.users.disable', '/admin/users/{id}/disable'],
      ['admin.metrics.overview', '/admin/metrics'],
      ['admin.audit.list', '/admin/audit'],
    ] as const) {
      const row = allProcedures().find((r) => r.path === path)
      expect(row?.httpPath, path).toBe(httpPath)
    }
  })

  it('gives the console the ask and the owner the decision (support access)', () => {
    // docs/17 §B [57] and docs/22 §2: time-boxed, OWNER-approved, audited. The two halves live in two
    // contracts that cannot reach each other, and only the owner's half can open a window.
    for (const path of [
      'tenancy.support.list',
      'tenancy.support.approve',
      'tenancy.support.revoke',
    ] as const) {
      expect(permissionFor(path), path).toEqual(ROLE_GROUPS.OWNER_ONLY)
      // Not the manager's (not day-to-day running) and not the accountant's (not money).
      for (const role of ALL_ROLES.filter((r) => r !== 'owner')) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
      expect(
        isAllowed(permissionFor(path), 'platform_admin'),
        `${path} must refuse platform_admin`,
      ).toBe(false)
    }
    // The console asks and withdraws; there is no procedure under `admin.` that approves.
    expect(paths).toContain('admin.support.request')
    expect(paths).toContain('admin.support.revoke')
    expect(paths).not.toContain('admin.support.approve')
    expect(paths).not.toContain('admin.support.grant')
    for (const path of ['admin.support.request', 'admin.support.revoke'] as const) {
      for (const role of ALL_ROLES) {
        expect(isAllowed(permissionFor(path), role), `${path} must refuse ${role}`).toBe(false)
      }
    }
  })

  it('gives platform staff their own sign-in, with no tenant in it (auth)', () => {
    // A platform admin holds no membership, so `auth.login`'s tenant machinery is meaningless for it:
    // it gets three procedures of its own rather than a nullable tenant on every app's token pair.
    expect(permissionFor('auth.platformLogin')).toBe('public')
    expect(permissionFor('auth.platformRefresh')).toBe('public')
    expect(permissionFor('auth.platformMe')).toEqual(ROLE_GROUPS.PLATFORM)
    // "Who am I as platform staff" has no answer for a membership role, so it is refused, not nulled.
    for (const role of ALL_ROLES) {
      expect(isAllowed(permissionFor('auth.platformMe'), role), `platformMe refuses ${role}`).toBe(
        false,
      )
    }
    for (const [path, httpPath, method] of [
      ['auth.platformLogin', '/auth/platform/login', 'POST'],
      ['auth.platformRefresh', '/auth/platform/refresh', 'POST'],
      ['auth.platformMe', '/auth/platform/me', 'GET'],
    ] as const) {
      const row = allProcedures().find((r) => r.path === path)
      expect(row?.httpPath, path).toBe(httpPath)
      expect(row?.method, path).toBe(method)
    }
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

  it('keeps the platform group disjoint from every membership group', () => {
    expect(ROLE_GROUPS.PLATFORM).toEqual(PLATFORM_ROLES)
    expect(PLATFORM_ROLES).toEqual(['platform_admin'])
    for (const role of PLATFORM_ROLES) {
      expect(PlatformRoleSchema.safeParse(role).success).toBe(true)
      // Never a membership: `ALL_ROLES` is the six apps' roles and the platform is not one of them.
      expect(MembershipRoleSchema.safeParse(role).success).toBe(false)
      expect(ALL_ROLES as readonly string[]).not.toContain(role)
    }
    // No other group lets platform staff in through a side door.
    for (const [name, group] of Object.entries(ROLE_GROUPS)) {
      if (name === 'PLATFORM') continue
      for (const role of PLATFORM_ROLES) {
        expect(group as readonly string[], `${name} must not contain ${role}`).not.toContain(role)
      }
    }
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
    // A platform session is a session: the shared auth procedures serve it unchanged.
    expect(isAllowed('authenticated', 'platform_admin')).toBe(true)
  })

  it('matches the role against the list', () => {
    expect(isAllowed(ROLE_GROUPS.BACK_OFFICE, 'accountant')).toBe(true)
    expect(isAllowed(ROLE_GROUPS.BACK_OFFICE, 'salesperson')).toBe(false)
    expect(isAllowed(ROLE_GROUPS.BACK_OFFICE, null)).toBe(false)
    expect(isAllowed(ROLE_GROUPS.STOCK_KEEPERS, 'warehouse')).toBe(true)
    // The two enums never satisfy each other's lists.
    expect(isAllowed(ROLE_GROUPS.PLATFORM, 'platform_admin')).toBe(true)
    expect(isAllowed(ROLE_GROUPS.PLATFORM, 'owner')).toBe(false)
    expect(isAllowed(ROLE_GROUPS.OWNER_ONLY, 'platform_admin')).toBe(false)
    expect(isAllowed(ROLE_GROUPS.ANY_MEMBER, 'platform_admin')).toBe(false)
  })

  it('refuses an undeclared procedure', () => {
    expect(isAllowed(undefined, 'owner')).toBe(false)
    expect(isAllowed(permissionFor('orders.thisDoesNotExist'), 'owner')).toBe(false)
  })

  it('agrees with the matrix for every procedure and every role', () => {
    const everyRole: readonly (MembershipRole | PlatformRole)[] = [...ALL_ROLES, ...PLATFORM_ROLES]
    for (const p of allProcedures()) {
      const allowedRoles = everyRole.filter((role) => isAllowed(p.permission, role))
      if (p.permission === 'public' || p.permission === 'authenticated') {
        expect(allowedRoles.length, p.path).toBe(everyRole.length)
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
      'auth.platformLogin',
      'auth.platformRefresh',
      'auth.platformMe',
      'auth.supportPass',
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

/**
 * DOS-106. Inside the one platform role there are three LEVELS (`platform_admins.role`), and the job
 * split is the schema's own (`platform_admin_role`) and docs/18's: a super onboards, sets plans,
 * suspends and locks; support reads and ASKS; billing reads and keeps what a distributor pays us.
 * `ADMIN_LEVELS` is the single table the server enforces and the console hides buttons by.
 */
describe('console levels (DOS-106)', () => {
  it('DOS-106: declares a console level for every admin.* procedure — super does everything, support only reads and asks or withdraws, billing only reads and sets a subscription', () => {
    // The database enum, value for value and in its on-disk order.
    expect(PlatformAdminLevelSchema.options).toEqual(['super', 'support', 'billing'])

    const adminPaths = allProcedures()
      .map((row) => row.path)
      .filter((path): path is AdminProcedurePath => path.startsWith('admin.'))
    expect(adminPaths).toHaveLength(15)
    // Exactly one row per console procedure: a new `admin.*` procedure without a level fails here
    // (and fails to compile, because the table is keyed by the contract's own paths).
    expect(Object.keys(ADMIN_LEVELS).sort()).toEqual([...adminPaths].sort())
    for (const path of adminPaths) expect(ADMIN_LEVELS[path], path).toContain('super')

    const reads: readonly AdminProcedurePath[] = [
      'admin.tenants.list',
      'admin.tenants.get',
      'admin.subscriptions.list',
      'admin.subscriptions.get',
      'admin.support.list',
      'admin.users.list',
      'admin.metrics.overview',
      'admin.audit.list',
    ]
    const superOnly: readonly AdminProcedurePath[] = [
      'admin.tenants.create',
      'admin.tenants.suspend',
      'admin.tenants.reactivate',
      'admin.users.disable',
    ]
    for (const path of superOnly) expect(ADMIN_LEVELS[path], path).toEqual(['super'])
    for (const path of reads) {
      expect(ADMIN_LEVELS[path], path).toEqual(['super', 'support', 'billing'])
    }

    // support: the reads, and its own ask and withdrawal — never a plan, a suspension or a lock.
    for (const path of [...reads, 'admin.support.request', 'admin.support.revoke'] as const) {
      expect(levelAllows(path, 'support'), `support may call ${path}`).toBe(true)
    }
    for (const path of [...superOnly, 'admin.subscriptions.upsert'] as const) {
      expect(levelAllows(path, 'support'), `support must not call ${path}`).toBe(false)
    }
    // billing: the reads and what a distributor pays us — never an ask, a suspension or a lock.
    for (const path of [...reads, 'admin.subscriptions.upsert'] as const) {
      expect(levelAllows(path, 'billing'), `billing may call ${path}`).toBe(true)
    }
    for (const path of [...superOnly, 'admin.support.request', 'admin.support.revoke'] as const) {
      expect(levelAllows(path, 'billing'), `billing must not call ${path}`).toBe(false)
    }
    for (const path of adminPaths) expect(levelAllows(path, 'super'), path).toBe(true)

    // Fail closed: no level, or a console path nobody declared, is a refusal.
    for (const path of adminPaths) expect(levelAllows(path, null), path).toBe(false)
    expect(levelAllows('admin.tenants.thisDoesNotExist', 'super')).toBe(false)
    // Outside `admin.*` the level narrows nothing: the console's own auth procedures stay role-gated.
    expect(levelAllows('auth.platformMe', null)).toBe(true)
    expect(levelAllows('auth.supportPass', null)).toBe(true)

    // The generated README and OpenAPI render `x-roles: platform_admin` for every console route, so
    // each route's summary names the levels that may call it, from this same table.
    for (const row of allProcedures().filter((r) => r.path.startsWith('admin.'))) {
      const levels = ADMIN_LEVELS[row.path as AdminProcedurePath]
      const note = `${levels.length === 1 ? 'console level' : 'console levels'}: ${levels.join(', ')}`
      expect(row.summary.endsWith(` · ${note}`), `${row.path}: "${row.summary}"`).toBe(true)
    }
  })
})
