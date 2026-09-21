import { execFileSync, execSync } from 'node:child_process'
import { encodeJwk, generateAuthKeys } from '@dos/core'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT } from './paths.js'

/**
 * DEP-01 — the build-and-run half of the proof. This one really builds the image on a Docker daemon
 * and really runs it against a database, so it is OPT-IN:
 *
 *   colima start --cpu 2 --memory 4 --disk 20 --arch aarch64
 *   DOS_DOCKER_PROOF=1 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_b2_deploy \
 *     pnpm --filter @dos/all-in-one exec vitest run src/deploy/docker-image.proof.spec.ts
 *
 * It is not part of any gate: a Docker daemon is a 4 GB Linux VM on this Mac and three other runs
 * share the machine (QA/STATE.md). Everything that can be checked without a daemon lives in
 * `dockerfile.spec.ts`, which always runs.
 */
interface Health {
  status?: string
  services?: { name: string; prefix: string }[]
}

const ENABLED = process.env.DOS_DOCKER_PROOF === '1'
const IMAGE = 'dos:proof'
const CONTAINER = 'dos-proof-app'
/** The container reaches the Mac's Homebrew Postgres through Docker's host alias, not 127.0.0.1. */
const DB_URL = (process.env.DATABASE_URL ?? '').replace('127.0.0.1', 'host.docker.internal')

function docker(args: string[], timeout = 20 * 60_000): string {
  return execFileSync('docker', args, {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    timeout,
    stdio: 'pipe',
  })
}

/** Both streams: the process writes its start-up lines with console.warn, which is stderr. */
function dockerLogs(): string {
  return execSync(`docker logs ${CONTAINER} 2>&1`, { cwd: BACKEND_ROOT, encoding: 'utf8' })
}

function quiet(args: string[]): void {
  try {
    docker(args, 60_000)
  } catch {
    /* absent is the desired state */
  }
}

describe.runIf(ENABLED)('DEP-01 the image builds and runs (needs a Docker daemon)', () => {
  it(
    'DEP-01 builds for linux/arm64, serves /health with all eight services and the worker, under 500 MB idle',
    async () => {
      expect(DB_URL, 'DATABASE_URL must point at a test database').toMatch(/dos_test_/)
      quiet(['rm', '-f', CONTAINER])

      docker([
        'build',
        '--platform',
        'linux/arm64',
        '-f',
        'infra/docker/Dockerfile',
        '-t',
        IMAGE,
        '.',
      ])

      // Real, ephemeral EdDSA keys: the image runs NODE_ENV=production, where loadAuthKeys() refuses
      // to invent a pair (that shortcut exists only under NODE_ENV=test). This is also the proof that
      // a production process boots on nothing but environment variables.
      const keys = await generateAuthKeys()

      const arch = docker([
        'image',
        'inspect',
        IMAGE,
        '--format',
        '{{.Os}}/{{.Architecture}}',
      ]).trim()
      expect(arch).toBe('linux/arm64')
      const user = docker(['image', 'inspect', IMAGE, '--format', '{{.Config.User}}']).trim()
      expect(user).toBe('node')
      expect(
        docker(['image', 'inspect', IMAGE, '--format', '{{.Config.Healthcheck.Test}}']),
      ).toContain('/health')

      docker(
        [
          'run',
          '-d',
          '--name',
          CONTAINER,
          '--add-host',
          'host.docker.internal:host-gateway',
          '-e',
          `DATABASE_URL=${DB_URL}`,
          '-e',
          'DATABASE_POOL_MAX=2',
          '-e',
          `AUTH_JWT_PRIVATE_KEY=${encodeJwk(keys.privateJwk)}`,
          '-e',
          `AUTH_JWT_PUBLIC_KEY=${encodeJwk(keys.publicJwk)}`,
          '-e',
          'OBJECT_STORAGE_SIGNING_SECRET=proof-only-not-a-real-secret-0123456789',
          '-p',
          '3199:3100',
          IMAGE,
        ],
        120_000,
      )

      let health: Health | null = null
      for (let i = 0; i < 60 && health === null; i++) {
        try {
          const res = await fetch('http://127.0.0.1:3199/health')
          if (res.ok) health = (await res.json()) as Health
        } catch {
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
      expect(health, `never answered /health:\n${dockerLogs()}`).not.toBeNull()

      const prefixes = (health?.services ?? []).map((s) => s.prefix)
      for (const name of [
        'auth',
        'owner',
        'manager',
        'sales',
        'warehouse',
        'delivery',
        'retailer',
        'admin',
      ]) {
        expect(prefixes, `/health does not mount ${name}`).toContain(`/${name}`)
      }
      // runAll() logs this line only after the in-process pg-boss worker has actually started.
      expect(dockerLogs()).toMatch(/worker started in-process/)

      // docker stats reports the container's whole memory footprint; the budget in docs/26 §7 is
      // 377 MB measured on the Mac, and 500 MB is the line the founder set.
      const used = docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', CONTAINER]).trim()
      const mib = /^([\d.]+)\s*([KMG])iB/.exec(used)
      expect(mib, `could not read memory from "${used}"`).not.toBeNull()
      const bytes =
        Number(mib![1]) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[mib![2] as 'K' | 'M' | 'G']
      expect(bytes / 1024 ** 2).toBeLessThan(500)

      quiet(['rm', '-f', CONTAINER])
    },
    25 * 60_000,
  )
})
