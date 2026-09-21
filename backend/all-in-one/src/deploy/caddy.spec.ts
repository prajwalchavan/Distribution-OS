import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT, readArtifact } from './paths.js'

/**
 * DEP-03 — the proxy and its certificate.
 *
 * The box answers on `api.<domain>` over TLS, and the certificate is Caddy's business: it asks
 * Let's Encrypt on first start and renews on its own. Nothing else about the deployment may assume a
 * certificate exists, and nothing may terminate TLS twice.
 *
 * There is NO static-file root and NO single-page fallback in this file on purpose: the seven web
 * apps (and the one merged app that replaces them before go-live, docs/22 §8 2026-09-21) are served
 * by Cloudflare Pages, not by this box.
 */
const caddyfile = readArtifact('backend/infra/Caddyfile')
/** The file with its comments taken out: what Caddy actually reads. */
const directives = caddyfile
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/** `caddy validate` is the real check. It runs wherever the binary is (brew install caddy). */
const caddyBin = spawnSync('caddy', ['version'], { encoding: 'utf8' }).status === 0

describe('DEP-03 Caddyfile and TLS', () => {
  it('DEP-03 serves api.<domain> and proxies it to the app, taking the domain from the environment', () => {
    // {$VAR} is Caddy's own environment substitution, read at load time from the container's env —
    // which compose fills from .env.prod. One file, every environment.
    expect(caddyfile).toMatch(/^api\.\{\$DOMAIN\}\s*\{/m)
    expect(caddyfile).toMatch(/reverse_proxy\s+\{\$APP_UPSTREAM\}/)
  })

  it('DEP-03 lets Caddy get and renew the certificate itself, with a real ACME address', () => {
    expect(caddyfile).toMatch(/email\s+\{\$ACME_EMAIL\}/)
    // `tls internal` or a manual cert path would mean a self-signed certificate that every phone
    // refuses; `auto_https off` would mean plain HTTP on the internet.
    expect(directives).not.toMatch(/tls\s+internal/)
    expect(directives).not.toMatch(/auto_https\s+off/)
  })

  it('DEP-03 sets HSTS and does not answer CORS itself', () => {
    expect(directives).toMatch(/Strict-Transport-Security/)
    expect(directives).toMatch(/X-Content-Type-Options\s+nosniff/)
    // CORS is the API's, from CORS_ORIGINS through corsOptions(). A second Access-Control-Allow-Origin
    // added by the proxy would either duplicate the header or silently widen it.
    expect(directives).not.toMatch(/Access-Control-Allow-Origin/)
  })

  it('DEP-03 caps the request body below the largest file the API will accept', () => {
    // object-storage.ts allows 25 MB for a HEIC page image, the largest entry in ALLOWED_CONTENT_TYPES.
    const cap = /max_size\s+(\d+)MB/.exec(directives)
    expect(cap, 'no request_body max_size in the Caddyfile').not.toBeNull()
    expect(Number(cap![1])).toBeGreaterThanOrEqual(25)
    expect(Number(cap![1])).toBeLessThanOrEqual(64)
  })

  it.runIf(caddyBin)('DEP-03 is a Caddyfile that caddy itself accepts', () => {
    const run = spawnSync(
      'caddy',
      ['validate', '--adapter', 'caddyfile', '--config', resolve(BACKEND_ROOT, 'infra/Caddyfile')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DOMAIN: 'distributionos.in',
          ACME_EMAIL: 'founder@example.in',
          APP_UPSTREAM: 'app:3100',
        },
      },
    )
    expect(`${run.stdout}${run.stderr}`).toMatch(/Valid configuration/)
    expect(run.status).toBe(0)
  })
})
