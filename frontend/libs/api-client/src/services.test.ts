/**
 * docs/31 §2 — one table between the elected role and the service that answers it.
 *
 * Getting this wrong is silent: a request leaves for an origin that answers 403 (another service) or
 * nothing at all (a port with no listener), and the screen says "No connection". So the table is
 * walked against the contract's own enum rather than against a copy of it, and both deployments —
 * the split ports this Mac runs and the one-origin prefixes of docs/26 §7 — are asserted.
 */
import { MembershipRoleSchema } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { SERVICE_OF, serviceFor } from './services.js'

describe('SERVICE_OF', () => {
  it('maps every MembershipRole, with nothing left over', () => {
    const roles = [...MembershipRoleSchema.options].sort()
    expect(Object.keys(SERVICE_OF).sort()).toEqual(roles)
  })

  it('never names the console: admin-service is not a membership role s service', () => {
    for (const service of Object.values(SERVICE_OF)) {
      expect(service.port).not.toBe(3007)
      expect(service.prefix).not.toBe('/admin')
    }
  })

  it('puts the accountant on manager-service, the money desk inside the manager app (ruling Q5)', () => {
    expect(SERVICE_OF.accountant).toEqual(SERVICE_OF.manager)
  })

  it('carries docs/26 §7 s ports and prefixes verbatim', () => {
    expect(SERVICE_OF.owner).toEqual({ port: 3001, prefix: '/owner' })
    expect(SERVICE_OF.manager).toEqual({ port: 3002, prefix: '/manager' })
    expect(SERVICE_OF.salesperson).toEqual({ port: 3003, prefix: '/sales' })
    expect(SERVICE_OF.warehouse).toEqual({ port: 3004, prefix: '/warehouse' })
    expect(SERVICE_OF.delivery).toEqual({ port: 3005, prefix: '/delivery' })
    expect(SERVICE_OF.retailer).toEqual({ port: 3006, prefix: '/retailer' })
  })
})

describe('serviceFor', () => {
  it('gives each role its own port when there is no base: the split mode this Mac runs', () => {
    expect(serviceFor('owner')).toBe('http://127.0.0.1:3001')
    expect(serviceFor('salesperson')).toBe('http://127.0.0.1:3003')
    expect(serviceFor('delivery')).toBe('http://127.0.0.1:3005')
    expect(serviceFor('retailer')).toBe('http://127.0.0.1:3006')
  })

  it('appends the prefix under one origin when there is a base (docs/26 §7)', () => {
    expect(serviceFor('owner', 'https://api.distributionos.in')).toBe(
      'https://api.distributionos.in/owner',
    )
    expect(serviceFor('salesperson', 'https://api.distributionos.in')).toBe(
      'https://api.distributionos.in/sales',
    )
    expect(serviceFor('accountant', 'https://api.distributionos.in')).toBe(
      'https://api.distributionos.in/manager',
    )
  })

  it('treats a trailing slash on the base as the same origin, never as a second path segment', () => {
    expect(serviceFor('delivery', 'https://api.distributionos.in/')).toBe(
      'https://api.distributionos.in/delivery',
    )
  })

  it('treats an empty base as no base: an unset EXPO_PUBLIC_API_URL reads as the empty string', () => {
    expect(serviceFor('warehouse', '')).toBe('http://127.0.0.1:3004')
  })

  it('gives two roles of one group the same origin, and two groups different ones', () => {
    expect(serviceFor('manager')).toBe(serviceFor('accountant'))
    expect(serviceFor('owner')).not.toBe(serviceFor('delivery'))
  })
})
