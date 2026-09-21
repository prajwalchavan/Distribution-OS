import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT, REPO_ROOT, readArtifact } from './paths.js'

/**
 * DEP-06 — the secrets a box needs, and the one file that holds them.
 *
 * Nothing about the deployment may require a developer to remember a variable. `.env.prod.example`
 * is the whole list; `gen-secrets.sh` turns it into a real `.env.prod` with a fresh EdDSA key pair,
 * a database password, a storage signing secret and the first owner's password — and that file is
 * never committed, which is checked here by asking git.
 */
const example = readArtifact('backend/infra/.env.prod.example')
const gen = readArtifact('backend/infra/gen-secrets.sh')

/**
 * Every variable the image actually reads and that a box cannot boot (or cannot be trusted) without.
 * docs/26 §2 is the full reference; these are the ones with no safe default in production.
 */
const REQUIRED = [
  'NODE_ENV',
  'DATABASE_URL',
  'DATABASE_POOL_MAX',
  'APP_DB_ROLE',
  'AUTH_JWT_PRIVATE_KEY',
  'AUTH_JWT_PUBLIC_KEY',
  'AUTH_ACCESS_TTL_SECONDS',
  'AUTH_REFRESH_TTL_DAYS',
  'CORS_ORIGINS',
  'OBJECT_STORAGE_DRIVER',
  'OBJECT_STORAGE_DIR',
  'OBJECT_STORAGE_SIGNING_SECRET',
  'OBJECT_STORAGE_PUBLIC_URL',
  'DOCINT_ENGINE',
  'DOS_MODE',
  'WORKER_INLINE',
  'ALL_IN_ONE_PORT',
]

/** The secrets gen-secrets.sh must fill in; an empty one is a box that cannot start or cannot sign. */
const GENERATED = [
  'AUTH_JWT_PRIVATE_KEY',
  'AUTH_JWT_PUBLIC_KEY',
  'OBJECT_STORAGE_SIGNING_SECRET',
  'POSTGRES_PASSWORD',
  'OWNER_PASSWORD',
]

function valuesOf(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) out[m[1]!] = m[2]!
  }
  return out
}

describe('DEP-06 secrets', () => {
  it('DEP-06 the example lists every variable the image needs', () => {
    const declared = valuesOf(example)
    for (const key of REQUIRED) {
      expect(Object.keys(declared), `.env.prod.example does not declare ${key}`).toContain(key)
    }
    // Stub, deliberately: the founder has not decided to pay per page (docs/26 §3).
    expect(declared.DOCINT_ENGINE).toBe('stub')
    expect(declared.NODE_ENV).toBe('production')
    // Empty CORS_ORIGINS means "any localhost", which is a development shortcut, not a production one.
    expect(declared.CORS_ORIGINS).not.toBe('')
  })

  it('DEP-06 the example carries no usable secret', () => {
    const declared = valuesOf(example)
    for (const key of [
      'AUTH_JWT_PRIVATE_KEY',
      'AUTH_JWT_PUBLIC_KEY',
      'OBJECT_STORAGE_SIGNING_SECRET',
      'OWNER_PASSWORD',
    ]) {
      expect(declared[key], `${key} must be blank in the example`).toBe('')
    }
    expect(declared.POSTGRES_PASSWORD).toMatch(/replace-me/)
  })

  it('DEP-06 a real .env.prod is refused by git', () => {
    const run = spawnSync('git', ['check-ignore', '-v', 'backend/infra/.env.prod'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(run.stdout, 'backend/infra/.env.prod is NOT ignored').toMatch(/\.env/)
    expect(run.status).toBe(0)
    // ...and the example still is not, or nobody would know what to fill in.
    const kept = spawnSync('git', ['check-ignore', 'backend/infra/.env.prod.example'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(kept.status, 'the example must stay in the repo').not.toBe(0)
  })

  it('DEP-06 gen-secrets.sh writes a usable file, fills every secret, and never overwrites one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dos-secrets-'))
    try {
      const out = join(dir, '.env.prod')
      const env = { ...process.env, ENV_OUT: out }
      const first = spawnSync('bash', [resolve(BACKEND_ROOT, 'infra/gen-secrets.sh')], {
        encoding: 'utf8',
        env,
        cwd: BACKEND_ROOT,
      })
      expect(`${first.stdout}${first.stderr}`).toMatch(/wrote/)
      expect(first.status, first.stderr).toBe(0)

      const written = valuesOf(readFileSync(out, 'utf8'))
      for (const key of GENERATED) {
        expect(written[key] ?? '', `${key} was left empty`).not.toBe('')
        expect(written[key], `${key} still holds the example's placeholder`).not.toMatch(
          /replace-me/,
        )
      }
      // The EdDSA pair is base64url(JSON JWK) — the shape decodeJwk() expects.
      const priv = JSON.parse(
        Buffer.from(written.AUTH_JWT_PRIVATE_KEY!, 'base64url').toString(),
      ) as Record<string, string>
      const pub = JSON.parse(
        Buffer.from(written.AUTH_JWT_PUBLIC_KEY!, 'base64url').toString(),
      ) as Record<string, string>
      expect(priv.alg).toBe('EdDSA')
      expect(priv.d, 'the private JWK has no private half').toBeTruthy()
      expect(pub.d, 'the PUBLIC key must not carry the private half').toBeUndefined()
      expect(pub.kid).toBe(priv.kid)

      // The database password appears in two places and they must agree, or the app cannot connect.
      expect(written.DATABASE_URL).toContain(written.POSTGRES_PASSWORD!)
      expect(written.OWNER_PASSWORD!.length).toBeGreaterThanOrEqual(12)

      // 0600: the file holds the signing key, the database password and the owner's password.
      expect(statSync(out).mode & 0o777).toBe(0o600)

      // Running it twice must never quietly replace a live box's keys: every session on every
      // device is signed with them.
      const again = spawnSync('bash', [resolve(BACKEND_ROOT, 'infra/gen-secrets.sh')], {
        encoding: 'utf8',
        env,
        cwd: BACKEND_ROOT,
      })
      expect(again.status, 'gen-secrets.sh overwrote an existing .env.prod').not.toBe(0)
      expect(`${again.stdout}${again.stderr}`).toMatch(/exists/)
      expect(readFileSync(out, 'utf8')).toContain(written.AUTH_JWT_PRIVATE_KEY!)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('DEP-06 gen-secrets.sh is valid shell and stops on the first error', () => {
    const syntax = spawnSync('bash', ['-n', resolve(BACKEND_ROOT, 'infra/gen-secrets.sh')], {
      encoding: 'utf8',
    })
    expect(syntax.stderr).toBe('')
    expect(syntax.status).toBe(0)
    expect(gen).toMatch(/set -euo pipefail/)
  })
})
