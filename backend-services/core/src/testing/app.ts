import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { ORPCModule } from '@orpc/nest'
import type { ModuleMetadata } from '@nestjs/common'
import { DbModule } from '../platform/index.js'

/**
 * Boots a Nest app for a spec exactly as main.ts does (Fastify + oRPC), with the real DbModule so
 * DATABASE_URL-backed specs run against a migrated database and the rest run with db = null.
 */
export async function bootTestApp(
  imports: NonNullable<ModuleMetadata['imports']>,
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ORPCModule.forRoot({}), DbModule, ...imports],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return app
}

export interface Actor {
  tenantId: string
  actorId: string
  role: 'owner' | 'manager' | 'salesperson' | 'delivery' | 'accountant' | 'retailer'
}

/** Placeholder-auth headers understood by TenantGuard until Better Auth lands. */
export function actorHeaders(a: Actor): Record<string, string> {
  return { 'x-tenant-id': a.tenantId, 'x-actor-id': a.actorId, 'x-actor-role': a.role }
}

/** oRPC/OpenAPI GET input goes in the query string; POST input is the JSON body. */
export async function call<T>(
  app: NestFastifyApplication,
  actor: Actor | null,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: T }> {
  const headers = { ...(actor ? actorHeaders(actor) : {}), 'content-type': 'application/json' }
  const res =
    method === 'GET'
      ? await app.inject({ method, url, headers, query: toQuery(payload) })
      : await app.inject({ method, url, headers, payload: JSON.stringify(payload ?? {}) })
  const body: T = res.json()
  return { status: res.statusCode, body }
}

function toQuery(payload?: Record<string, unknown>): Record<string, string> {
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (v === undefined) continue
    q[k] =
      typeof v === 'string'
        ? v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : JSON.stringify(v)
  }
  return q
}
