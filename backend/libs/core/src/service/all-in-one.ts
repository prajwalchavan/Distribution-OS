import 'reflect-metadata'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type pg from 'pg'
import { PG_POOL } from '../platform/index.js'
import { createServiceApp } from './bootstrap.js'
import type { ServiceDefinition } from './define.js'
import { SERVICE_DEFINITIONS } from './definitions.js'

/**
 * ALL-IN-ONE MODE (founder decision 2026-09-05, docs/22 §8 and docs/26 §7).
 *
 * Stage 0 of the cost plan is "the first run at ₹0": one small VM carrying the whole product. Eight
 * Node processes would cost ~1.2 GB of RSS on a 2 GB box before a single order is placed, so this
 * entry point mounts every service on ONE process behind a path prefix — `/auth`, `/owner`,
 * `/manager`, `/sales`, `/warehouse`, `/delivery`, `/retailer`, `/admin` — and can run the worker
 * in-process as well. Splitting back out is a change of command, not of code (docs/20's scale path).
 *
 * WHAT IS NOT SHARED. Each prefix is the real service, built by the same `createServiceApp` its own
 * `main.ts` calls, with its own `SERVICE_INFO`, its own `TenantGuard` role gate, its own `/health`,
 * `/docs` and `/swagger`. A `salesperson` token is refused on `/owner` here exactly as it is refused
 * on :3001, because it is the same guard reading the same definition. Nothing is merged: there is no
 * combined router, no union of roles, no shared contract subset — which is what makes the split-out
 * deployment identical in behaviour to this one.
 *
 * HOW THE PREFIX WORKS. Each Nest app owns a Fastify instance that is initialised but never listens;
 * one Node HTTP server in front strips the prefix from the URL and hands the raw request to that
 * instance's own router. This is deliberately not a Fastify plugin tree: a Nest app registers its
 * routes during `init()`, which is long after a parent instance would have sealed its plugin
 * encapsulation, and a "clever" mount would break in ways that only show up under load.
 */

/** What the root `/health` answers, and what the process logs on start. */
export interface MountedService {
  name: string
  prefix: string
  roles: readonly string[]
  contractKeys: readonly string[]
}

export interface AllInOne {
  server: Server
  apps: { def: ServiceDefinition; app: NestFastifyApplication }[]
  mounted: MountedService[]
  /** Resident set size right after every service is mounted, in MB (docs/26 §7 budgets ~300 MB). */
  rssMb: number
  close: () => Promise<void>
}

export interface RunAllOptions {
  /** Which services to mount; defaults to all eight (`SERVICE_DEFINITIONS`). */
  services?: readonly ServiceDefinition[]
  /**
   * Starts the pg-boss worker inside this process. `backend/all-in-one` passes
   * `() => import('@dos/worker/dist/main.js')`; the library cannot import the worker itself, because
   * the worker imports the library. Called only when `DOS_MODE=all` and `WORKER_INLINE=1`.
   */
  worker?: () => Promise<unknown>
  logger?: boolean
}

/** `/owner` → the owner service. The prefix is the service's own name, so nothing has to be mapped. */
export const prefixOf = (def: ServiceDefinition): string => `/${def.name}`

export function allInOnePort(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.ALL_IN_ONE_PORT ?? 3100)
  return Number.isInteger(value) && value > 0 ? value : 3100
}

/**
 * Eight pools of ten connections would be eighty on a Postgres that allows a hundred, and the worker
 * still has to get in. Unless the operator has said otherwise, all-in-one mode gives each service a
 * small pool — the process is one box serving one distributorship at this stage, not a fleet.
 */
function capPoolSize(count: number, env: NodeJS.ProcessEnv = process.env): void {
  if (env.DATABASE_POOL_MAX) return
  env.DATABASE_POOL_MAX = String(Math.max(2, Math.floor(32 / Math.max(1, count))))
}

/**
 * Builds every service and the HTTP server in front of them, without listening — the shape a spec
 * boots and `runAll` starts. The returned `close()` shuts every app and its pool down.
 */
export async function createAllInOne(options: RunAllOptions = {}): Promise<AllInOne> {
  const services = options.services ?? SERVICE_DEFINITIONS
  capPoolSize(services.length)
  const apps: { def: ServiceDefinition; app: NestFastifyApplication }[] = []
  for (const def of services) {
    const app = await createServiceApp(def, { logger: options.logger ?? false })
    await app.init()
    // Nest wires the routes during init(); `ready()` seals the Fastify instance so `routing()` may be
    // called by hand. Without it the first request would race the plugin boot.
    await app.getHttpAdapter().getInstance().ready()
    apps.push({ def, app })
  }
  const mounted: MountedService[] = apps.map(({ def }) => ({
    name: def.name,
    prefix: prefixOf(def),
    roles: def.roles,
    contractKeys: def.contractKeys,
  }))
  const routers = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  for (const { def, app } of apps) {
    const instance = app.getHttpAdapter().getInstance()
    routers.set(prefixOf(def), (req, res) => {
      instance.routing(req, res)
    })
  }

  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    const prefix = matchPrefix(url, routers)
    if (!prefix) {
      // The root is the operator's view: which services this process is carrying, and where they are.
      if (url === '/health' || url === '/') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', mode: 'all-in-one', services: mounted }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'no service is mounted at this path',
          services: mounted.map((m) => m.prefix),
        }),
      )
      return
    }
    // The service must see the path it would see on its own port, so the prefix comes off here and
    // an app's own `/health` stays `/health` in its logs, its OpenAPI and its route table.
    req.url = url.slice(prefix.length) || '/'
    if (!req.url.startsWith('/')) req.url = `/${req.url}`
    routers.get(prefix)?.(req, res)
  })

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    for (const { app } of apps) {
      const pool = app.get<pg.Pool | null>(PG_POOL, { strict: false })
      await app.close()
      await pool?.end()
    }
  }
  return {
    server,
    apps,
    mounted,
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    close,
  }
}

/** `/owner/health` → `/owner`; `/ownerish` → nothing, so one service's name cannot swallow another's. */
function matchPrefix(url: string, routers: ReadonlyMap<string, unknown>): string | undefined {
  for (const prefix of routers.keys()) {
    if (url === prefix) return prefix
    if (url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)) return prefix
  }
  return undefined
}

/** Entry point of `backend/all-in-one`: mount everything, optionally the worker, and listen. */
export async function runAll(options: RunAllOptions = {}): Promise<void> {
  const all = await createAllInOne({ logger: options.logger ?? true, ...options })
  const port = allInOnePort()
  await new Promise<void>((resolve) => {
    all.server.listen(port, '0.0.0.0', () => {
      resolve()
    })
  })
  console.warn(
    `all-in-one on http://localhost:${String(port)}  ${all.mounted
      .map((m) => `${m.prefix} (${m.roles.join('/')})`)
      .join('  ')}  rss ${String(all.rssMb)} MB`,
  )
  if (process.env.DOS_MODE === 'all' && process.env.WORKER_INLINE === '1') {
    if (options.worker) {
      await options.worker()
      console.warn('worker started in-process (DOS_MODE=all, WORKER_INLINE=1)')
    } else {
      console.warn(
        'WORKER_INLINE=1 but no worker starter was passed to runAll(); worker not started',
      )
    }
  }
  const stop = async (): Promise<void> => {
    await all.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
}
