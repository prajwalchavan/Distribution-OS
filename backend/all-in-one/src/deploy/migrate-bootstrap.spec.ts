import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDb, createPool } from '@dos/db'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT, readArtifact } from './paths.js'

/**
 * DEP-04 — the migrate and bootstrap steps.
 *
 * Two faults, one in each half:
 *
 * 1. The image copied `libs/database/migrations` to `/app/migrations`, and NOTHING read that path.
 *    `migrate.ts` resolves `../migrations` from its own built location, so inside a deploy tree it
 *    looks in `node_modules/@dos/db/migrations` — which is exactly where it lands, because @dos/db's
 *    package.json lists `migrations` in `files`. The fix was to delete the dead copy and run the
 *    package's own entry point, not to add a second path to keep in sync.
 * 2. There was no production bootstrap at all. `pnpm db:seed` is the DEV seed: three demo
 *    distributors, ~30 demo accounts on one shared password, a demo catalogue, a month of demo
 *    orders, a demo console admin (docs/23 §10 — the seed and `pnpm smoke` leave rows behind). None
 *    of that may exist on a database a real distributor signs into. `infra/docker/bootstrap.mjs`
 *    writes the tenant, its owner, the membership and `bootstrapTenant()`, and nothing else.
 *
 * The end-to-end half (a real migrate and a real bootstrap on a fresh database, from the tree the
 * image ships) is opt-in, because it DROPS a database and takes a couple of minutes:
 *
 *   DOS_DEPLOY_PROOF=1 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_b2_deploy \
 *     pnpm --filter @dos/all-in-one exec vitest run src/deploy/migrate-bootstrap.spec.ts
 *
 * Run this file ON ITS OWN. It and the DEP-05 round trip both own `dos_test_b2_deploy`, and
 * vitest runs files in parallel: together, one would be dropping the database the other is dumping.
 */
const entrypoint = readArtifact('backend/infra/docker/entrypoint.sh')
const dockerfile = readArtifact('backend/infra/docker/Dockerfile')
const bootstrap = readArtifact('backend/infra/docker/bootstrap.mjs')
const dbManifest = JSON.parse(readArtifact('backend/libs/database/package.json')) as {
  files?: string[]
}
const journal = JSON.parse(readArtifact('backend/libs/database/migrations/meta/_journal.json')) as {
  entries: { tag: string }[]
}

const ENABLED = process.env.DOS_DEPLOY_PROOF === '1'
const DB_URL = process.env.DATABASE_URL ?? ''

describe('DEP-04 migrate and bootstrap', () => {
  it('DEP-04 runs the migrations from inside the package that owns them, not a dead /app/migrations', () => {
    expect(entrypoint).toMatch(/node \/app\/node_modules\/@dos\/db\/dist\/migrate\.js/)
    // @dos/db publishes `migrations` beside `dist`; that is what makes the path above exist after
    // `pnpm deploy`. Drop it from `files` and the image would migrate nothing.
    expect(dbManifest.files).toContain('migrations')
    expect(dbManifest.files).toContain('dist')
    expect(dockerfile).not.toMatch(/\/app\/migrations/)
  })

  it('DEP-04 has a journal entry for every migration file, which is what decides what runs', () => {
    const files = readdirSync(resolve(BACKEND_ROOT, 'libs/database/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
    expect(journal.entries.map((e) => e.tag).sort()).toEqual(files.sort())
  })

  it('DEP-04 bootstraps a production tenant and never the dev seed', () => {
    expect(bootstrap).toMatch(/bootstrapTenant\(/)
    // The four things that make `pnpm db:seed` a DEV seed. None may be reachable from here.
    expect(bootstrap).not.toMatch(/seedDemo|seedExtraTenants|seedPlatformConsole|DEMO_PASSWORD/)
    // Every write is on a unique key, so a re-run after a half-finished first run is safe.
    expect(bootstrap.match(/onConflictDoNothing\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    // A password must come from .env.prod; it is never invented and never printed to `docker logs`.
    expect(bootstrap).toMatch(/required\('OWNER_PASSWORD'\)/)
    expect(bootstrap).not.toMatch(/console\.(log|warn)\([^)]*ownerPassword/)
  })

  it.runIf(ENABLED)(
    'DEP-04 migrates a fresh database and bootstraps one tenant with one owner, from the deploy tree',
    async () => {
      expect(DB_URL, 'point DATABASE_URL at a test database').toMatch(/dos_test_/)
      const dbName = DB_URL.slice(DB_URL.lastIndexOf('/') + 1).replace(/\?.*$/, '')
      await recreateDatabase(dbName)

      const tree = deployTree()
      const migrateJs = join(tree, 'node_modules/@dos/db/dist/migrate.js')
      expect(existsSync(migrateJs), `no migrate entry point in the deploy tree at ${tree}`).toBe(
        true,
      )

      const env = {
        ...process.env,
        DATABASE_URL: DB_URL,
        DATABASE_POOL_MAX: '2',
        NODE_ENV: 'production',
        TENANT_SLUG: 'tarsun',
        TENANT_LEGAL_NAME: 'M/s. Tarsun Enterprise',
        TENANT_STATE_CODE: '27',
        OWNER_NAME: 'Pilot Owner',
        OWNER_USERNAME: 'owner.tarsun',
        OWNER_PHONE: '+919000000001',
        OWNER_PASSWORD: 'a-proof-only-password-12',
      }
      const migrated = spawnSync('node', [migrateJs], { cwd: tree, encoding: 'utf8', env })
      expect(`${migrated.stdout}${migrated.stderr}`).toContain('migrations applied')
      expect(migrated.status).toBe(0)

      // The Dockerfile copies it to /app/bootstrap.mjs, beside the deployed node_modules. Node
      // resolves a bare specifier from the FILE's directory, not the cwd, so running it from the
      // repo would never find @dos/db — put it where the image puts it.
      const bootstrapJs = join(tree, 'bootstrap.mjs')
      copyFileSync(resolve(BACKEND_ROOT, 'infra/docker/bootstrap.mjs'), bootstrapJs)
      const boot = spawnSync('node', [bootstrapJs], { cwd: tree, encoding: 'utf8', env })
      expect(`${boot.stdout}${boot.stderr}`, 'bootstrap failed').toContain(
        'bootstrapped tenant tarsun',
      )
      expect(boot.status).toBe(0)
      expect(`${boot.stdout}${boot.stderr}`).not.toContain(env.OWNER_PASSWORD)

      const pool = createPool(DB_URL, 2)
      const db = createDb(pool)
      try {
        const applied = await db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
        )
        expect(applied.rows[0]?.n).toBe(journal.entries.length)

        const tenants = await db.execute<{ slug: string }>(sql`SELECT slug FROM tenants`)
        expect(tenants.rows.map((r) => r.slug)).toEqual(['tarsun'])

        const owner = await db.execute<{ username: string; role: string }>(
          sql`SELECT u.username, m.role FROM users u JOIN memberships m ON m.user_id = u.id`,
        )
        expect(owner.rows).toEqual([{ username: 'owner.tarsun', role: 'owner' }])

        // bootstrapTenant()'s own work: the chart of accounts, the three locations, the numbering
        // series for this financial year, the feature flags and the white-label settings.
        for (const [table, atLeast] of [
          ['accounts', 1],
          ['locations', 3],
          ['numbering_series', 1],
          ['feature_flags', 5],
          ['tenant_settings', 1],
        ] as const) {
          const row = await db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
          )
          expect(row.rows[0]?.n, `${table} is empty after bootstrap`).toBeGreaterThanOrEqual(
            atLeast,
          )
        }

        // And NOT the demo data: no second distributor, no demo staff, no shelf, no orders.
        for (const table of [
          'sales_orders',
          'invoices',
          'retailers',
          'retailer_identities',
          'tenant_products',
          'auth_sessions',
        ] as const) {
          const row = await db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
          )
          expect(row.rows[0]?.n, `${table} carries demo rows after a production bootstrap`).toBe(0)
        }

        // Re-running must change nothing: a box can be rebooted mid-deploy.
        const again = spawnSync('node', [bootstrapJs], { cwd: tree, encoding: 'utf8', env })
        expect(again.status).toBe(0)
        const after = await db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM memberships`,
        )
        expect(after.rows[0]?.n).toBe(1)
      } finally {
        await pool.end()
      }
    },
    20 * 60_000,
  )
})

/** A database that has never run a migration; the claim is about a box on its first day. */
async function recreateDatabase(dbName: string): Promise<void> {
  const adminUrl = `${DB_URL.slice(0, DB_URL.lastIndexOf('/'))}/postgres`
  const pool = createPool(adminUrl, 1)
  const admin = createDb(pool)
  try {
    await admin.execute(
      sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${dbName} AND pid <> pg_backend_pid()`,
    )
    await admin.execute(sql`DROP DATABASE IF EXISTS ${sql.identifier(dbName)}`)
    await admin.execute(sql`CREATE DATABASE ${sql.identifier(dbName)} OWNER dos`)
  } finally {
    await pool.end()
  }
}

/**
 * The tree the image ships: `pnpm deploy --prod --legacy`, which is what the Dockerfile runs. Set
 * DOS_DEPLOY_TREE to reuse one that is already built instead of spending the minutes again.
 */
function deployTree(): string {
  const reuse = process.env.DOS_DEPLOY_TREE
  if (reuse && existsSync(join(reuse, 'node_modules/@dos/db/dist/migrate.js'))) return reuse
  const out = join(mkdtempSync(join(tmpdir(), 'dos-deploy-')), 'app')
  rmSync(out, { recursive: true, force: true })
  // `pnpm deploy --prod` rewrites the WORKSPACE's own node_modules/.pnpm-workspace-state-v1.json to
  // say the last install was production-only. node_modules itself is untouched, but every later
  // `pnpm <script>` in this checkout then decides the tree is stale, tries to re-install with
  // --prod, and aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. Putting the file back is the
  // whole repair, and doing it here means the trap is never left armed for the next person.
  const state = resolve(BACKEND_ROOT, 'node_modules/.pnpm-workspace-state-v1.json')
  const before = existsSync(state) ? readFileSync(state, 'utf8') : null
  const run = spawnSync(
    'pnpm',
    ['--filter', '@dos/all-in-one', 'deploy', '--prod', '--legacy', out],
    {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    },
  )
  if (before !== null) writeFileSync(state, before)
  if (run.status !== 0) throw new Error(`pnpm deploy failed:\n${run.stdout}\n${run.stderr}`)
  return out
}
