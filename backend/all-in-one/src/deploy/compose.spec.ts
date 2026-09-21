import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_ROOT, readArtifact } from './paths.js'

/**
 * DEP-02 — the compose file the VM runs.
 *
 * `infra/docker-compose.yml` is the LOCAL one: a bare Postgres for `pnpm db:up`, no app, no proxy,
 * no migrations. The VM needs a different file, and it needs the four things that make a box come
 * back by itself after a reboot: the app restarts, the database is a named volume with a healthcheck,
 * the migrations run to completion BEFORE the app starts, and the uploads live on a volume rather
 * than in a container layer.
 *
 * The shape is checked by asking Docker Compose itself to resolve the file (`docker compose config`
 * needs no daemon), so this fails on a typo the way the VM would, not on a regex.
 */
const composeFile = resolve(BACKEND_ROOT, 'infra/compose.prod.yml')
const raw = readArtifact('backend/infra/compose.prod.yml')

/**
 * `.env.prod` is written on the box by gen-secrets.sh and is never in the repo, so resolution runs in
 * a throwaway project directory holding a copy of the EXAMPLE under that name. That also checks the
 * example really does declare every variable the compose file interpolates — a missing one would
 * come back as an empty string and a warning, which the first test reads.
 */
const projectDir = mkdtempSync(join(tmpdir(), 'dos-compose-'))
writeFileSync(join(projectDir, '.env.prod'), readArtifact('backend/infra/.env.prod.example'))
const envFile = join(projectDir, '.env.prod')

/**
 * The Docker CLI is not part of the toolchain CLAUDE.md declares, so a developer without it gets a
 * clear skip rather than a red on a file they did not touch. CI's ubuntu runner ships Compose v2, so
 * these really do run there, and `docker compose config` never needs a daemon.
 */
const hasCompose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0

interface Resolved {
  services: Record<
    string,
    {
      image?: string
      restart?: string
      command?: unknown
      volumes?: { source?: string; target?: string; type?: string }[]
      depends_on?: Record<string, { condition?: string }>
      healthcheck?: { test?: unknown }
      ports?: { published?: string; target?: number }[]
    }
  >
  volumes?: Record<string, unknown>
}

/** One call, both streams: compose writes its "variable is not set" warnings to stderr. */
function compose(args: string[]): { stdout: string; stderr: string } {
  const run = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      '--project-directory',
      projectDir,
      '--env-file',
      envFile,
      ...args,
    ],
    { cwd: BACKEND_ROOT, encoding: 'utf8' },
  )
  if (run.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} exited ${String(run.status)}:\n${run.stderr}`)
  }
  return { stdout: run.stdout, stderr: run.stderr }
}

function warningsOf(args: string[]): string {
  return compose(args).stderr
}

function resolved(): Resolved {
  return JSON.parse(compose(['config', '--format', 'json']).stdout) as Resolved
}

describe.runIf(hasCompose)('DEP-02 compose for the VM', () => {
  it('DEP-02 resolves with docker compose config, with no unset variable', () => {
    const config = resolved()
    expect(Object.keys(config.services).sort()).toEqual(['app', 'caddy', 'db', 'migrate'])
    // An unset variable resolves to the empty string and compose only WARNS about it, so the
    // warnings are the assertion: a typo'd ${VAR} must not slip through as a silent blank.
    expect(warningsOf(['config', '-q'])).not.toMatch(/variable is not set/i)
  })

  it('DEP-02 starts the app only after migrate has COMPLETED and the database is healthy', () => {
    const { services } = resolved()
    expect(services.app?.depends_on?.migrate?.condition).toBe('service_completed_successfully')
    expect(services.migrate?.depends_on?.db?.condition).toBe('service_healthy')
    // A one-shot must not be restarted, or a finished migration becomes a restart loop.
    expect(services.migrate?.restart ?? 'no').toBe('no')
    expect(JSON.stringify(services.migrate?.command)).toContain('migrate')
  })

  it('DEP-02 brings the box back by itself: restart policies and a healthcheck on the database', () => {
    const { services } = resolved()
    expect(services.app?.restart).toBe('unless-stopped')
    expect(services.caddy?.restart).toBe('unless-stopped')
    expect(services.db?.restart).toBe('unless-stopped')
    expect(JSON.stringify(services.db?.healthcheck?.test)).toMatch(/pg_isready/)
    expect(services.db?.image).toMatch(/^postgres:17/)
  })

  it('DEP-02 keeps the database, the uploads and Caddy’s certificates on named volumes', () => {
    const config = resolved()
    const named = Object.keys(config.volumes ?? {})
    expect(named).toContain('dos-pgdata')
    expect(named).toContain('dos-storage')
    expect(named).toContain('caddy-data')
    const appMounts = (config.services.app?.volumes ?? []).map((v) => v.target)
    // The local object-storage driver's directory: invoice PDFs, POD photos, claim evidence. In a
    // container layer they would vanish on the next `docker compose up -d`.
    expect(appMounts).toContain('/data/storage')
    const dbMounts = (config.services.db?.volumes ?? []).map((v) => v.target)
    expect(dbMounts).toContain('/var/lib/postgresql/data')
  })

  it('DEP-02 sizes max_connections above every pool the image opens', () => {
    const { services } = resolved()
    const command = JSON.stringify(services.db?.command)
    const max = /max_connections=(\d+)/.exec(command)
    expect(max, `db has no explicit max_connections: ${command}`).not.toBeNull()
    // All-in-one opens one pool per mounted service plus the worker's. DATABASE_POOL_MAX is set in
    // .env.prod.example; the ceiling must clear 9 x that with room for the migrate one-shot,
    // psql from the runbook and Postgres's own superuser reservation.
    const poolMax = /^DATABASE_POOL_MAX=(\d+)$/m.exec(
      readArtifact('backend/infra/.env.prod.example'),
    )
    expect(poolMax, '.env.prod.example must pin DATABASE_POOL_MAX').not.toBeNull()
    expect(Number(max![1])).toBeGreaterThanOrEqual(9 * Number(poolMax![1]) + 10)
  })

  it('DEP-02 exposes only the proxy: the database is never published to the internet', () => {
    const { services } = resolved()
    expect(services.db?.ports ?? []).toEqual([])
    const appPorts = (services.app?.ports ?? []).map((p) => p.published)
    // The app answers Caddy on the compose network; nothing but 80/443 leaves the box.
    expect(appPorts, 'the app must not publish a port of its own').toEqual([])
    const caddyPorts = (services.caddy?.ports ?? []).map((p) => String(p.published))
    expect(caddyPorts.sort()).toEqual(['443', '80'])
    // Belt and braces: the raw file must not carry a stray host binding for Postgres either.
    expect(raw).not.toMatch(/^\s*-\s*'?5432:5432'?\s*$/m)
  })
})
