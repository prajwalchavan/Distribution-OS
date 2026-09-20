/**
 * DOS-102 — the cross-distributor summary is read from AUTH-SERVICE, and from nowhere else.
 *
 * WHAT WAS WRONG. `app/index.tsx` read it as `api.api.auth.memberships.summary()`. `api.api` is the
 * TENANT client: `@dos/api-client`'s `client.ts` builds it over the FULL contract at `options.apiUrl`,
 * and `src/api.ts` passes `apiUrl: API_URL` — `EXPO_PUBLIC_API_URL`, default `http://127.0.0.1:3006`,
 * retailer-service. retailer-service mounts neither the auth module nor the `auth` contract key
 * (`backend/libs/core/src/service/definitions.ts`, `retailerServiceDefinition`), and
 * `grep -c 'auth/memberships' backend/retailer-service/README.md` is 0 while auth-service publishes
 * `GET /auth/memberships/summary` on :3000. The auth-bound client is `api.auth`, built at
 * `options.authUrl`. The wrong spelling TYPECHECKS only because the full contract re-exports
 * `auth: authContract`.
 *
 * WHAT A SHOPKEEPER SAW. `ramesh.gupta` signs in, the read 404s, `across.data` stays undefined and the
 * panel falls through `?? 0`: a shop that owes ₹91,494 was told "You owe ₹0.00 across 3 distributors",
 * every card that was not the open one showed no dues, and every one read "No bills yet" with no van
 * line. A WRONG MONEY FIGURE, not an error — the worst shape a failure can take on this screen.
 *
 * HOW IT IS READ. The first test drives the real client and shows which ORIGIN each spelling reaches.
 * The second reads the screens as source, in the style of `dos-167-persistent-null.guard.test.ts`:
 * importing a screen in Node pulls in `react-native`, which does not resolve outside Metro, so there is
 * no render to assert on. `@types/node` is deliberately absent from an app, so the Node functions come
 * in through non-literal specifiers.
 */
import { createApiClient, type ApiClient } from '@dos/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
  readdirSync: (path: string, options: { withFileTypes: true }) => NodeDirent[]
}

interface NodeDirent {
  name: string
  isDirectory: () => boolean
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** The two origins this app is built against (`src/config.ts` defaults, the founder's Mac). */
const RETAILER_SERVICE = 'http://127.0.0.1:3006'
const AUTH_SERVICE = 'http://127.0.0.1:3000'

/** The URL the FIRST request of one call goes to, with no service running. */
async function originOf(call: (client: ApiClient) => Promise<unknown>): Promise<string> {
  const seen: string[] = []
  vi.stubGlobal('fetch', (request: Request) => {
    seen.push(request.url)
    return Promise.resolve(
      new Response('{"message":"Not Found"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
  const client = createApiClient({ apiUrl: RETAILER_SERVICE, authUrl: AUTH_SERVICE })
  await call(client).catch(() => undefined)
  return seen[0] ?? '(no request was made)'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DOS-102 the summary the home screen reads reaches auth-service', () => {
  it('`api.auth.*` reaches auth-service; `api.api.auth.*` reaches the retailer service, which serves no such route', async () => {
    expect(await originOf((client) => client.auth.memberships.summary())).toBe(
      `${AUTH_SERVICE}/auth/memberships/summary`,
    )
    // The spelling that was on the screen. The path is right; the ORIGIN is a service that 404s it.
    expect(await originOf((client) => client.api.auth.memberships.summary())).toBe(
      `${RETAILER_SERVICE}/auth/memberships/summary`,
    )
  })
})

/** Every `.tsx`/`.ts` under `app/`, with its comments taken out: a comment may TALK about the bug. */
async function screenSources(): Promise<Map<string, string>> {
  const { readFileSync, readdirSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  const root = fileURLToPath(new URL('../../app/', import.meta.url))
  const out = new Map<string, string>()
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`${dir}${entry.name}/`, `${prefix}${entry.name}/`)
        continue
      }
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue
      out.set(
        `${prefix}${entry.name}`,
        readFileSync(`${dir}${entry.name}`, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      )
    }
  }
  walk(root, '')
  return out
}

describe('DOS-102 no screen of this app reads an auth procedure through the tenant client', () => {
  it('no `api.api.auth.` anywhere under app/, and the home screen does read the summary off `api.auth`', async () => {
    const sources = await screenSources()

    // The guard would be vacuous if it found nothing to read: the screens are there.
    expect(sources.size).toBeGreaterThan(5)
    // And the summary is still read — a rename must not let this pass by guarding a call that is gone.
    expect(sources.get('index.tsx')).toContain('api.auth.memberships.summary()')

    const throughTheTenantClient = [...sources]
      .filter(([, source]) => source.includes('api.api.auth.'))
      .map(([path]) => path)
    expect(throughTheTenantClient).toEqual([])
  })
})
