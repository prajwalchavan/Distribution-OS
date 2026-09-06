import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bearer } from '../testing/app.js'
import { createAllInOne, prefixOf, type AllInOne } from './all-in-one.js'
import { SERVICE_DEFINITIONS } from './definitions.js'

const tenantId = '00000000-0000-7000-8000-0000000000a0'
const actorId = '00000000-0000-7000-8000-0000000000a1'

/** The all-in-one server is a plain Node server, so a spec drives it over a real socket. */
async function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${String(port)}${path}`, { headers })
  return { status: res.status, body: await res.text() }
}

/**
 * ALL-IN-ONE MODE (founder 2026-09-05, docs/26 §7): one process carrying all eight services behind
 * path prefixes, which is what stage 0 of the cost plan runs on a single small VM. What this spec is
 * really protecting is that mounting them together changes NOTHING about who may call what: the
 * prefix is the only difference between `/sales` here and :3003 there.
 */
describe('all-in-one runtime', () => {
  let all: AllInOne
  let port = 0

  beforeAll(async () => {
    all = await createAllInOne({ logger: false })
    await new Promise<void>((resolve) => {
      all.server.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    const address = all.server.address()
    port = typeof address === 'object' && address ? address.port : 0
  }, 60_000)

  afterAll(async () => {
    await all.close()
  })

  it('mounts every service under its own prefix, each answering its own /health', async () => {
    expect(all.mounted.map((m) => m.prefix)).toEqual(SERVICE_DEFINITIONS.map((d) => prefixOf(d)))
    for (const service of SERVICE_DEFINITIONS) {
      const health = await get(port, `${prefixOf(service)}/health`)
      expect(health.status, service.name).toBe(200)
      expect(health.body, service.name).toContain('ok')
    }
    // The root says what this process is carrying — the operator's one view of an all-in-one box.
    const root = await get(port, '/health')
    expect(root.status).toBe(200)
    expect(root.body).toContain('all-in-one')
    expect(root.body).toContain('/warehouse')
    // A path no service claims is a clear 404 listing the ones that exist, never a hang or a 500.
    const missing = await get(port, '/nope/health')
    expect(missing.status).toBe(404)
    expect(missing.body).toContain('/retailer')
  })

  it('serves each service its OWN docs under its prefix, with its own contract subset', async () => {
    const owner = await get(port, '/owner/docs/openapi.json')
    expect(owner.status).toBe(200)
    const ownerSpec = JSON.parse(owner.body) as {
      info: { title: string }
      paths: Record<string, unknown>
    }
    expect(ownerSpec.info.title).toContain('Owner service')
    // The paths are the service's own, unprefixed: behind a load balancer this document is served at
    // the same place it is served from on :3001, so an app's base URL is the only thing that changes.
    expect(Object.keys(ownerSpec.paths)).toContain('/health/ping')

    const auth = await get(port, '/auth/docs/openapi.json')
    const authSpec = JSON.parse(auth.body) as { paths: Record<string, unknown> }
    expect(Object.keys(authSpec.paths).some((p) => p.startsWith('/auth/'))).toBe(true)
    // ...and auth-service carries no business route, here as anywhere else.
    expect(Object.keys(authSpec.paths)).not.toContain('/orders')
  })

  it('refuses a role at the prefix of a service that does not serve it', async () => {
    const ownerToken = await bearer({ tenantId, actorId, role: 'owner' })
    // The owner's own service takes the token...
    const mine = await get(port, '/owner/health', ownerToken)
    expect(mine.status).toBe(200)
    // ...and the salesperson's refuses it, at the gate, before any handler — the same TenantGuard
    // reading the same `SERVICE_INFO` it reads on :3003. Mounting them in one process must never
    // become a way around that.
    const theirs = await get(port, '/sales/orders', ownerToken)
    expect(theirs.status).toBe(403)
    expect(theirs.body).toContain('sales')

    const rep = await bearer({ tenantId, actorId, role: 'salesperson' })
    const repOnOwner = await get(port, '/owner/orders', rep)
    expect(repOnOwner.status).toBe(403)

    // No token is 401 under a prefix exactly as it is on a port.
    const anonymous = await get(port, '/owner/orders')
    expect(anonymous.status).toBe(401)
  })

  it('stays inside the memory budget a 2 GB VM can carry (docs/26 §7)', () => {
    // Eight processes cost ~1.2 GB; the point of this mode is that one costs a fraction of that.
    // Measured 2026-09-06: 377 MB from `dist/` on Node 24, 420 MB under the `@swc-node` dev
    // transpiler (which holds the compiler in memory) — the budget is the founder's 400 MB, and the
    // number is in the message so a failure says how far over it went rather than just "false".
    expect(all.rssMb, `all-in-one RSS ${String(all.rssMb)} MB (budget 400)`).toBeLessThan(400)
  })
})
