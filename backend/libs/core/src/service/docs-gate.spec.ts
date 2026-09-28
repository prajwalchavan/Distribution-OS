import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeJwk, generateAuthKeys, resetAuthKeysForTests } from '../platform/auth-keys.js'
import { createAllInOne, type AllInOne } from './all-in-one.js'
import { SERVICE_DEFINITIONS } from './definitions.js'
import { docsEnabled, docsUseRows } from './docs-gate.js'

const owner = SERVICE_DEFINITIONS.filter((def) => def.name === 'owner')

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${String(port)}${path}`)
  return { status: res.status, body: await res.text() }
}

/** Boots the owner service the way the VM does, with the environment a production box carries. */
async function boot(env: Record<string, string | undefined>): Promise<{
  all: AllInOne
  port: number
  restore: () => void
}> {
  // A production process has no ephemeral keys: it carries its own, as the VM's env file does.
  const keys = await generateAuthKeys()
  const production = {
    ...env,
    AUTH_JWT_PRIVATE_KEY: encodeJwk(keys.privateJwk),
    AUTH_JWT_PUBLIC_KEY: encodeJwk(keys.publicJwk),
  }
  const before: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(production)) {
    before[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetAuthKeysForTests()
  const all = await createAllInOne({ services: owner, logger: false })
  await new Promise<void>((resolve) => {
    all.server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = all.server.address()
  return {
    all,
    port: typeof address === 'object' && address ? address.port : 0,
    restore: () => {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      resetAuthKeysForTests()
    },
  }
}

/**
 * DOS-290: the API reference carries no token check, and its examples were rows of the database. On
 * the public host that was a distributor's shops, phones and GSTINs, readable by anyone.
 */
describe('docs gate (DOS-290)', () => {
  it('is open everywhere except production, where the operator has to ask for it', () => {
    expect(docsEnabled({ NODE_ENV: 'development' })).toBe(true)
    expect(docsEnabled({ NODE_ENV: 'test' })).toBe(true)
    expect(docsEnabled({})).toBe(true)
    expect(docsEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(docsEnabled({ NODE_ENV: 'production', API_DOCS: 'off' })).toBe(false)
    expect(docsEnabled({ NODE_ENV: 'production', API_DOCS: '1' })).toBe(false)
    expect(docsEnabled({ NODE_ENV: 'production', API_DOCS: 'on' })).toBe(true)
  })

  it('never builds examples from rows in production, asked for or not', () => {
    expect(docsUseRows({ NODE_ENV: 'development' })).toBe(true)
    expect(docsUseRows({ NODE_ENV: 'production' })).toBe(false)
    expect(docsUseRows({ NODE_ENV: 'production', API_DOCS: 'on' })).toBe(false)
  })

  describe('a production process', () => {
    let booted: Awaited<ReturnType<typeof boot>>

    beforeAll(async () => {
      booted = await boot({ NODE_ENV: 'production', API_DOCS: undefined })
    }, 60_000)

    afterAll(async () => {
      await booted.all.close()
      booted.restore()
    })

    it('has no API reference at all', async () => {
      for (const path of ['/owner/docs', '/owner/docs/openapi.json', '/owner/swagger']) {
        const res = await get(booted.port, path)
        expect(res.status, path).toBe(404)
        expect(res.body, path).not.toContain('"paths"')
      }
      const fresh = await get(booted.port, '/owner/docs/openapi.json?fresh=1')
      expect(fresh.status).toBe(404)
    })

    it('still answers /health and still serves signed file links', async () => {
      const health = await get(booted.port, '/owner/health')
      expect(health.status).toBe(200)
      // The storage wire stays: an unsigned link is refused by the controller, not by a missing route.
      const file = await get(
        booted.port,
        '/owner/storage/tenant/x/logo/y/z.png?expires=1&signature=no',
      )
      expect(file.status).toBe(403)
    })
  })

  describe('a production process with API_DOCS=on', () => {
    let booted: Awaited<ReturnType<typeof boot>>

    beforeAll(async () => {
      booted = await boot({ NODE_ENV: 'production', API_DOCS: 'on' })
    }, 60_000)

    afterAll(async () => {
      await booted.all.close()
      booted.restore()
    })

    it('serves the document from the schemas alone, and names no demo account', async () => {
      for (const path of ['/owner/docs/openapi.json', '/owner/docs/openapi.json?fresh=1']) {
        const res = await get(booted.port, path)
        expect(res.status, path).toBe(200)
        const doc = JSON.parse(res.body) as { info: { description: string } }
        expect(doc.info.description, path).toContain('The examples come from the schemas alone')
        expect(doc.info.description, path).not.toContain('Dos@1234')
        expect(doc.info.description, path).not.toContain('db:seed')
        // No row was read: the document names no distributor and promises no real ids.
        expect(res.body, path).not.toContain('Every example below is real')
        expect(res.body, path).not.toContain('read from the database')
      }
    })
  })
})
