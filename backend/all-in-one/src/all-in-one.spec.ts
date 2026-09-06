import { prefixOf, SERVICE_DEFINITIONS } from '@dos/core'
import { describe, expect, it } from 'vitest'

/**
 * The package itself is three lines (`main.ts`), so this is what there is to check here: that the
 * process really carries every service, each at its own prefix. The RUNTIME — prefix routing, the
 * per-service role gate, the memory budget — is specced where the code lives, in
 * `libs/core/src/service/all-in-one.spec.ts`, which boots the whole thing over a real socket.
 */
describe('all-in-one package', () => {
  it('carries all eight services, one prefix and one default port each', () => {
    expect(SERVICE_DEFINITIONS.map((d) => prefixOf(d))).toEqual([
      '/auth',
      '/owner',
      '/manager',
      '/sales',
      '/warehouse',
      '/delivery',
      '/retailer',
      '/admin',
    ])
    expect(new Set(SERVICE_DEFINITIONS.map((d) => d.defaultPort)).size).toBe(
      SERVICE_DEFINITIONS.length,
    )
    // Every service names the roles it serves; a service that served none would 403 everything.
    for (const def of SERVICE_DEFINITIONS) expect(def.roles.length).toBeGreaterThan(0)
  })
})
