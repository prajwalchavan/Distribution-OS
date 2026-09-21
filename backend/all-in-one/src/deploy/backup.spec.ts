import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDb, createPool, withTenant } from '@dos/db'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT, readArtifact } from './paths.js'

/**
 * DEP-05 — backups that leave the box, and a restore that has actually been run.
 *
 * A free Oracle VM can be reclaimed for idleness and a disk can die; a `pg_dump` sitting on the same
 * disk as the database is not a backup. And a restore that has never been run is not a restore — so
 * the round trip here really dumps a database, really drops it, really restores it, and compares row
 * counts table by table AND the application roles' privileges on the way out against the way in.
 *
 * The second half is not decoration. Row counts alone cannot fail for the failure mode backup.sh
 * documents in its own comment: `pg_dump --no-acl` (or `--no-owner` restored by a different
 * superuser) carries every row and every RLS policy and drops the GRANTs, so the counts match
 * perfectly and `app_rw` — the role every policy names and the role the whole application connects
 * through — can read nothing at all. `appRolePrivileges()` below reads the restored database the way
 * the product does, through `withTenant`.
 *
 * The round trip is opt-in because it DROPS a database:
 *
 *   DOS_DEPLOY_PROOF=1 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_b2_deploy \
 *     pnpm --filter @dos/all-in-one exec vitest run src/deploy/backup.spec.ts
 *
 * Run this file ON ITS OWN, and after DEP-04 has bootstrapped the database: it and the DEP-04
 * proof both own `dos_test_b2_deploy`, and vitest runs files in parallel.
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

/**
 * The table the privilege check is made on: `accounts` is a tenant table with rows after a
 * production bootstrap, an RLS read policy written `TO app_rw`, and explicit GRANTs to both runtime
 * roles from migration 0001/0003. Any tenant table would do; this one is named so a failure says
 * which object lost its privileges.
 */
const PRIVILEGED_TABLE = 'accounts'

/**
 * What a restore has to bring back BESIDES the rows.
 *
 * backup.sh's own comment names the failure mode this guards: a dump taken with `--no-acl` (or
 * `--no-owner` onto a cluster whose restoring user is not the migration owner) still carries every
 * row and every RLS policy, so a round trip that only compares row counts passes — and leaves a
 * database where `app_rw` holds no GRANT on anything. Every policy in this schema is written
 * `TO app_rw` and the whole application connects through `SET LOCAL ROLE app_rw` (withTenant), so
 * that database serves 100% "permission denied" while looking, table by table and row by row, like
 * a perfect restore.
 *
 * `visibleToAppRw` is taken through `withTenant` — the production read path, not a superuser SELECT
 * dressed up as one: RLS applies because the role is app_rw, and `denied` carries Postgres's own
 * message when the GRANT is the thing that went missing.
 */
async function appRolePrivileges(): Promise<{
  owner: string
  grantees: string[]
  visibleToAppRw: number
  denied: string | null
}> {
  const pool = createPool(DB_URL, 2)
  const db = createDb(pool)
  try {
    const acl = await db.execute<{ grantee: string }>(sql`
      SELECT DISTINCT r.rolname AS grantee
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(c.relacl) AS a
        JOIN pg_roles r ON r.oid = a.grantee
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname = ${PRIVILEGED_TABLE}
         AND a.privilege_type = 'SELECT'
    `)
    const owned = await db.execute<{ owner: string }>(sql`
      SELECT pg_get_userbyid(relowner) AS owner
        FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relname = ${PRIVILEGED_TABLE}
    `)
    const tenant = await db.execute<{ id: string }>(sql`SELECT id FROM tenants LIMIT 1`)
    let visibleToAppRw = -1
    let denied: string | null = null
    try {
      visibleToAppRw = await withTenant(
        db,
        {
          tenantId: tenant.rows[0]?.id ?? '',
          actorId: '00000000-0000-0000-0000-000000000000',
          actorRole: 'owner',
        },
        async (tx) => {
          const row = await tx.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM ${sql.identifier(PRIVILEGED_TABLE)}`,
          )
          return row.rows[0]?.n ?? -1
        },
      )
    } catch (error) {
      // Drizzle wraps the driver error, and its own message is only the SQL it tried. The sentence
      // that identifies the fault — "permission denied for table accounts" — is on `cause`, and
      // that sentence is the entire point of this check, so it is carried out with the rest.
      const cause =
        error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
      const outer = error instanceof Error ? error.message : String(error)
      denied = cause ? `${cause} (${outer.split('\n')[0] ?? ''})` : outer
    }
    return {
      owner: owned.rows[0]?.owner ?? '',
      grantees: acl.rows.map((r) => r.grantee).sort(),
      visibleToAppRw,
      denied,
    }
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

  it('DEP-05 keeps ownership and ACLs in the dump, because every RLS policy names app_rw', () => {
    // The flags that would quietly hollow out a restore. `--no-acl` drops the GRANTs of migration
    // 0001/0003; `--no-owner` hands every object to whoever runs pg_restore. The rows and the
    // policies survive both, which is exactly why the round trip below checks privileges too and
    // why these two flags must never appear here.
    // Comment lines are stripped first: backup.sh explains this trap in prose right above the
    // pg_dump call, and a grep over the whole file would match its own warning.
    const commands = backup
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')
    expect(commands).not.toMatch(/--no-acl\b/)
    expect(commands).not.toMatch(/--no-owner\b/)
    // `pg_dumpall --globals-only` is the other half of the same guarantee: the roles named by those
    // GRANTs are cluster-wide and are not in a database dump at all.
    expect(backup).toMatch(/--globals-only/)
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
    'DEP-05 dump, drop, restore: every row count comes back, and app_rw can still read it',
    async () => {
      expect(DB_URL, 'point DATABASE_URL at a test database').toMatch(/dos_test_/)
      const before = await counts()
      expect(
        Object.values(before).some((n) => n > 0),
        'nothing to lose: seed or bootstrap first',
      ).toBe(true)
      const privilegesBefore = await appRolePrivileges()
      expect(
        privilegesBefore.denied,
        `app_rw cannot read ${PRIVILEGED_TABLE} BEFORE the backup, so this run could not tell a
         lost GRANT from a database that never had one: ${privilegesBefore.denied ?? ''}`,
      ).toBeNull()
      expect(privilegesBefore.visibleToAppRw).toBe(before[PRIVILEGED_TABLE])
      expect(privilegesBefore.visibleToAppRw).toBeGreaterThan(0)
      expect(privilegesBefore.grantees).toEqual(expect.arrayContaining(['app_rw', 'app_worker']))

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

        // And the half the row counts cannot see. A --no-acl dump gets this far with every count
        // identical; here `app_rw` is asked to read the restored table through withTenant (SET LOCAL
        // ROLE app_rw + the tenant context, RLS applying), and the table's GRANTs are read back out
        // of pg_class.relacl.
        const privilegesAfter = await appRolePrivileges()
        expect(
          privilegesAfter.denied,
          `the rows came back but the application cannot read them: ${privilegesAfter.denied ?? ''}`,
        ).toBeNull()
        expect(
          privilegesAfter.grantees,
          `${PRIVILEGED_TABLE} lost a GRANT in the round trip`,
        ).toEqual(expect.arrayContaining(['app_rw', 'app_worker']))
        // Ownership too: on this cluster the restoring user IS the migration owner, so `--no-owner`
        // alone cannot go red here — on a fresh cluster restored by a different superuser it is the
        // flag that does the damage, and this is the assertion that would catch it there.
        expect(privilegesAfter.owner).toBe(privilegesBefore.owner)
        expect(privilegesAfter, 'the restore lost privileges the rows do not show').toEqual(
          privilegesBefore,
        )
      } finally {
        rmSync(dir, { recursive: true, force: true })
        rmSync(storage, { recursive: true, force: true })
      }
    },
    15 * 60_000,
  )
})
