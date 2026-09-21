import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDb, createPool } from '@dos/db'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT, readArtifact } from './paths.js'

/**
 * DEP-05 — backups that leave the box, and a restore that has actually been run.
 *
 * A free Oracle VM can be reclaimed for idleness and a disk can die; a `pg_dump` sitting on the same
 * disk as the database is not a backup. And a restore that has never been run is not a restore — so
 * the round trip here really dumps a database, really drops it, really restores it, and compares row
 * counts table by table.
 *
 * The round trip is opt-in because it DROPS a database:
 *
 *   DOS_DEPLOY_PROOF=1 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_b2_deploy \
 *     pnpm --filter @dos/all-in-one exec vitest run src/deploy/backup.spec.ts
 */
const backup = readArtifact('backend/infra/backup.sh')
const restore = readArtifact('backend/infra/restore.sh')
const envExample = readArtifact('backend/infra/.env.prod.example')

const ENABLED = process.env.DOS_DEPLOY_PROOF === '1'
const DB_URL = process.env.DATABASE_URL ?? ''

/** Tables with rows after a production bootstrap; a restore that loses any of them is a failure. */
const COUNTED = [
  'tenants',
  'users',
  'memberships',
  'accounts',
  'locations',
  'numbering_series',
  'feature_flags',
  'tenant_settings',
]

function bashSyntaxOk(path: string): { status: number | null; stderr: string } {
  const run = spawnSync('bash', ['-n', resolve(BACKEND_ROOT, path)], { encoding: 'utf8' })
  return { status: run.status, stderr: run.stderr }
}

/** How many tables the database holds; 0 right after the drop, ~140 after the restore. */
async function tableCount(): Promise<number> {
  const pool = createPool(DB_URL, 1)
  const db = createDb(pool)
  try {
    const row = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    return row.rows[0]?.n ?? -1
  } finally {
    await pool.end()
  }
}

async function dropAndRecreate(): Promise<void> {
  const name = DB_URL.slice(DB_URL.lastIndexOf('/') + 1).replace(/\?.*$/, '')
  const pool = createPool(`${DB_URL.slice(0, DB_URL.lastIndexOf('/'))}/postgres`, 1)
  const admin = createDb(pool)
  try {
    await admin.execute(
      sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name} AND pid <> pg_backend_pid()`,
    )
    await admin.execute(sql`DROP DATABASE IF EXISTS ${sql.identifier(name)}`)
    await admin.execute(sql`CREATE DATABASE ${sql.identifier(name)} OWNER dos`)
  } finally {
    await pool.end()
  }
}

async function counts(): Promise<Record<string, number>> {
  const pool = createPool(DB_URL, 2)
  const db = createDb(pool)
  try {
    const out: Record<string, number> = {}
    for (const table of COUNTED) {
      const row = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
      )
      out[table] = row.rows[0]?.n ?? -1
    }
    return out
  } finally {
    await pool.end()
  }
}

describe('DEP-05 backups off the box', () => {
  it('DEP-05 both scripts are valid shell and stop on the first error', () => {
    for (const path of ['infra/backup.sh', 'infra/restore.sh']) {
      const { status, stderr } = bashSyntaxOk(path)
      expect(stderr).toBe('')
      expect(status, `${path} is not valid shell`).toBe(0)
    }
    // Without `-e` a failed pg_dump leaves a zero-byte file and the script reports success; without
    // `pipefail` a failure upstream of a pipe is invisible.
    for (const script of [backup, restore]) {
      expect(script).toMatch(/set -euo pipefail/)
    }
  })

  it('DEP-05 writes a custom-format dump and a tar of the object store, then rotates 7 daily and 4 weekly', () => {
    // Custom format (-Fc) is what pg_restore reads: selective, parallel, and compressed.
    expect(backup).toMatch(/pg_dump[^\n]*(--format=custom|-Fc)/)
    expect(backup).toMatch(/tar[^\n]*(czf|-c[^\n]*z)/)
    expect(backup).toMatch(/BACKUP_KEEP_DAILY/)
    expect(backup).toMatch(/BACKUP_KEEP_WEEKLY/)
    expect(envExample).toMatch(/^BACKUP_KEEP_DAILY=7$/m)
    expect(envExample).toMatch(/^BACKUP_KEEP_WEEKLY=4$/m)
  })

  it('DEP-05 uploads to any S3 endpoint, and never reports success when the upload did not happen', () => {
    // Cloudflare R2 is the decided store, but nothing in the script is R2-specific: it is the
    // endpoint, the bucket and a key pair, which is all an S3-compatible store ever is.
    expect(backup).toMatch(/BACKUP_S3_ENDPOINT/)
    expect(backup).toMatch(/BACKUP_S3_BUCKET/)
    expect(backup).toMatch(/\brclone\b/)
    expect(backup).toMatch(/\baws\b/)
    // The whole point of the item: a backup that stayed on the box is not a backup. Skipping the
    // upload has to be an explicit choice (BACKUP_UPLOAD=0), never the quiet default.
    expect(backup).toMatch(/BACKUP_UPLOAD/)
    expect(backup).toMatch(/exit 1/)
  })

  it('DEP-05 restore refuses to run against a database it was not pointed at on purpose', () => {
    // pg_restore --clean drops every object it is about to replace. A typo'd URL must not be able to
    // do that silently.
    expect(restore).toMatch(/pg_restore/)
    expect(restore).toMatch(/--clean/)
    expect(restore).toMatch(/RESTORE_CONFIRM|--force|CONFIRM/)
  })

  it.runIf(ENABLED)(
    'DEP-05 dump, drop, restore: every row count comes back the same',
    async () => {
      expect(DB_URL, 'point DATABASE_URL at a test database').toMatch(/dos_test_/)
      const before = await counts()
      expect(
        Object.values(before).some((n) => n > 0),
        'nothing to lose: seed or bootstrap first',
      ).toBe(true)

      const dir = mkdtempSync(join(tmpdir(), 'dos-backup-'))
      const storage = mkdtempSync(join(tmpdir(), 'dos-storage-'))
      try {
        const env = {
          ...process.env,
          DATABASE_URL: DB_URL,
          BACKUP_DIR: dir,
          OBJECT_STORAGE_DIR: storage,
          BACKUP_UPLOAD: '0',
          BACKUP_KEEP_DAILY: '7',
          BACKUP_KEEP_WEEKLY: '4',
        }
        const made = spawnSync('bash', [resolve(BACKEND_ROOT, 'infra/backup.sh')], {
          encoding: 'utf8',
          env,
        })
        expect(`${made.stdout}${made.stderr}`).toMatch(/backup complete/)
        expect(made.status).toBe(0)
        const dump = /dump:\s*(\S+)/.exec(`${made.stdout}${made.stderr}`)?.[1]
        expect(dump, `backup.sh did not name its dump:\n${made.stdout}${made.stderr}`).toBeTruthy()
        // The roles are cluster-wide and not in the database dump; without this file a restore onto
        // a fresh Postgres dies on the first GRANT to app_rw.
        expect(`${made.stdout}${made.stderr}`).toMatch(/globals:\s*\S+globals-\S+\.sql/)

        // The DROP half. Not `pg_restore --clean` into a live database — a real disaster leaves
        // nothing behind, and a restore that has only ever been run over its own objects has not
        // been tested.
        await dropAndRecreate()
        expect(await tableCount()).toBe(0)

        const restored = spawnSync('bash', [resolve(BACKEND_ROOT, 'infra/restore.sh'), dump!], {
          encoding: 'utf8',
          env: { ...env, RESTORE_CONFIRM: DB_URL.slice(DB_URL.lastIndexOf('/') + 1) },
        })
        expect(`${restored.stdout}${restored.stderr}`).toMatch(/restore complete/)
        expect(restored.status).toBe(0)

        expect(await tableCount()).toBeGreaterThan(100)
        expect(await counts()).toEqual(before)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(storage, { recursive: true, force: true })
      }
    },
    15 * 60_000,
  )
})
