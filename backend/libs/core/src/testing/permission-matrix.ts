import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ALL_ROLES,
  isAllowed,
  listProcedures as contractProcedures,
  type MembershipRole,
  type ProcedureSummary,
} from '@dos/contracts'
import { pickContract, type ServiceDefinition } from '../service/define.js'
import { bearer, type Actor } from './app.js'

export interface PermissionMatrixOptions {
  /** Tenant/actor ids put in the test tokens. Nothing needs to exist: the gate answers before any row is read. */
  tenantId?: string
  actorId?: string
  /** Substituted for every `{param}` in a route. */
  paramId?: string
}

const DEFAULTS: Required<PermissionMatrixOptions> = {
  tenantId: '00000000-0000-7000-8000-00000000f001',
  actorId: '00000000-0000-7000-8000-00000000f002',
  paramId: '00000000-0000-7000-8000-00000000f003',
}

/**
 * Registers a vitest suite that calls every non-public procedure this service serves as an anonymous
 * caller and as each membership role, asserting only the GATE: anonymous → 401; a role the service does
 * not serve → 403; a served role the matrix forbids → 403; an allowed role → anything but the guard's
 * own 401/403 (validation 400s, 404s and business errors are fine here — the point is who gets in).
 *
 * Use from a service spec: `describePermissionMatrix(service, () => createServiceApp(service, { logger: false }))`.
 */
export function describePermissionMatrix(
  service: ServiceDefinition,
  boot: () => Promise<NestFastifyApplication>,
  options: PermissionMatrixOptions = {},
): void {
  const opts = { ...DEFAULTS, ...options }
  const procedures = contractProcedures(pickContract(service.contractKeys)).filter(
    (p) => p.permission !== 'public',
  )

  describe(`${service.name}-service permission matrix (${procedures.length} procedures × ${ALL_ROLES.length} roles + anonymous)`, () => {
    let app: NestFastifyApplication
    const tokens = new Map<MembershipRole, Record<string, string>>()

    beforeAll(async () => {
      app = await boot()
      await app.init()
      await app.getHttpAdapter().getInstance().ready()
      for (const role of ALL_ROLES) tokens.set(role, await bearer(actor(opts, role)))
    })

    afterAll(async () => {
      await app.close()
    })

    for (const p of procedures) {
      it(`${p.method} ${p.httpPath}  [${p.path}: ${describePermission(p)}]`, async () => {
        const url = routeUrl(p, opts.paramId)
        const anonymous = await request(app, p.method, url, {})
        expect(anonymous.statusCode, `anonymous ${p.path}`).toBe(401)
        for (const role of ALL_ROLES) {
          const res = await request(app, p.method, url, tokens.get(role) ?? {})
          const served = service.roles.includes(role)
          const allowed = isAllowed(p.permission, role)
          const label = `${role} on ${p.method} ${url} → ${res.statusCode} ${res.body.slice(0, 200)}`
          if (!served || !allowed) {
            expect(res.statusCode, label).toBe(403)
            expect(isGateRefusal(res), label).toBe(true)
          } else {
            expect(isGateRefusal(res), label).toBe(false)
          }
        }
      })
    }

    const probe = procedures[0]
    if (probe) {
      const url = routeUrl(probe, opts.paramId)
      const anyServed = ALL_ROLES.find((r) => service.roles.includes(r)) ?? 'owner'

      it('refuses an expired token with 401 "token expired"', async () => {
        const headers = await bearer(actor(opts, anyServed), { ttlSeconds: -120 })
        const res = await request(app, probe.method, url, headers)
        expect(res.statusCode).toBe(401)
        expect(res.json<{ message: string }>().message).toBe('token expired')
      })

      it('refuses a malformed or foreign token with 401 "sign in required"', async () => {
        for (const value of ['Bearer not.a.jwt', 'Basic abc', 'Bearer ']) {
          const res = await request(app, probe.method, url, { authorization: value })
          expect(res.statusCode, value).toBe(401)
          expect(res.json<{ message: string }>().message, value).toBe('sign in required')
        }
      })

      if (probe.permission !== 'authenticated') {
        it('refuses a token without an active tenant on a role-gated procedure with 403', async () => {
          const headers = await bearer(actor(opts, anyServed), { withoutTenant: true })
          const res = await request(app, probe.method, url, headers)
          expect(res.statusCode).toBe(403)
          expect(res.json<{ message: string }>().message).toMatch(/no active tenant/)
        })
      }
    }
  })
}

function actor(opts: Required<PermissionMatrixOptions>, role: MembershipRole): Actor {
  return { tenantId: opts.tenantId, actorId: opts.actorId, role }
}

function describePermission(p: ProcedureSummary): string {
  if (p.permission === undefined) return 'UNDECLARED'
  return typeof p.permission === 'string' ? p.permission : p.permission.join(', ')
}

/** `/retailers/{id}` → `/retailers/<paramId>`; `{+path}` catch-alls get the same value. */
function routeUrl(p: ProcedureSummary, paramId: string): string {
  return p.httpPath.replace(/\{\+?[^}]+\}/g, paramId)
}

async function request(
  app: NestFastifyApplication,
  method: string,
  url: string,
  headers: Record<string, string>,
): Promise<LightMyRequestResponse> {
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') {
    return app.inject({ method: verb, url, headers })
  }
  return app.inject({
    method: verb as 'POST',
    url,
    headers: { ...headers, 'content-type': 'application/json' },
    payload: '{}',
  })
}

/**
 * True when the status is a guard's own 401/403. Guards throw Nest HttpExceptions, whose body is
 * `{ statusCode, message, error? }`; handlers answer business refusals as ORPCErrors, whose body is
 * `{ code, status, message }` and never carries `statusCode` — so the shape alone tells the two apart.
 */
function isGateRefusal(res: LightMyRequestResponse): boolean {
  if (res.statusCode !== 401 && res.statusCode !== 403) return false
  let body: unknown
  try {
    body = res.json()
  } catch {
    return false
  }
  if (!body || typeof body !== 'object') return false
  const { statusCode, message } = body as { statusCode?: unknown; message?: unknown }
  return typeof statusCode === 'number' && typeof message === 'string'
}
