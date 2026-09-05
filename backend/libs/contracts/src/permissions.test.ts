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
    // docs/17 §D4: only the desk and the delivery crew take money; a rep never collects.
    for (const path of paths.filter((p) => p.startsWith('receivables.'))) {
      expect(isAllowed(permissionFor(path), 'salesperson'), `${path} must refuse salesperson`).toBe(
        false,
      )
    }
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
    ] as const) {
      expect(isAllowed(permissionFor(path), 'retailer'), `${path} must refuse retailer`).toBe(false)
    }
    expect(permissionFor('receivables.payments.initiate')).toEqual(['retailer'])
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
    expect(isAllowed(permissionFor('billing.invoices.issue'), 'warehouse')).toBe(true)
    expect(isAllowed(permissionFor('billing.invoices.setEwayBill'), 'warehouse')).toBe(true)
    expect(permissionFor('billing.invoices.cancel')).toEqual(['owner', 'manager'])
    expect(isAllowed(permissionFor('billing.invoices.cancel'), 'accountant')).toBe(false)
    // A van sale is billed at the door; a pack invoice is not.
    expect(isAllowed(permissionFor('billing.invoices.issueVanSale'), 'delivery')).toBe(true)
    expect(isAllowed(permissionFor('billing.invoices.issue'), 'delivery')).toBe(false)
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

  it('lets only auth and health be reached without a token', () => {
    const open = paths.filter((p) => permissionFor(p) === 'public')
    expect(open.sort()).toEqual(
      [
        'auth.jwks',
        'auth.login',
        'auth.logout',
        'auth.refresh',
        'auth.switchTenant',
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
