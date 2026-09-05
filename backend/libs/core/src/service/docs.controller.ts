import { Controller, Get, Header, Inject, Optional, Query } from '@nestjs/common'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import type { Db } from '@dos/db'
import { listProcedures as contractProcedures, type Permission } from '@dos/contracts'
import { DB } from '../platform/db.module.js'
import {
  buildExamples,
  describeExamples,
  DocExamplesService,
  routeKey,
  type ExampleContext,
  type ProcedureExample,
} from '../docs/examples.js'
import { pickContract, SERVICE_INFO, servicePort, type ServiceDefinition } from './define.js'

const AUTH_PORT = 3000

/**
 * `GET /docs` — interactive API reference (Scalar) for THIS service's endpoints; `GET /docs/openapi.json` — the spec.
 * Generated from the shared contract subset, so the docs cannot drift from what the controllers implement.
 * Every operation carries `x-roles` from the permission matrix; public ones clear `security`.
 *
 * Request examples are real rows of the seeded demo tenant (`docs/examples.ts`), so "Try it out →
 * Execute" in Swagger UI runs against data that exists. The document is cached per process;
 * `GET /docs/openapi.json?fresh=1` rebuilds it after a re-seed.
 */
@Controller('docs')
export class DocsController {
  private spec: Promise<OpenApiDocument> | null = null
  private readonly examples: DocExamplesService

  constructor(
    @Inject(SERVICE_INFO) private readonly service: ServiceDefinition,
    @Optional() @Inject(DB) db: Db | null = null,
  ) {
    // Not a registered provider: the docs controllers are the only consumers, and the cache lives
    // here so a service without a database still serves the document from the schemas alone.
    this.examples = new DocExamplesService(db)
  }

  @Get('openapi.json')
  openapi(@Query('fresh') fresh?: string): Promise<unknown> {
    if (isTruthy(fresh)) this.spec = this.generate(true)
    else this.spec ??= this.generate(false)
    return this.spec
  }

  private async generate(fresh: boolean): Promise<OpenApiDocument> {
    const subset = pickContract(this.service.contractKeys)
    const procedures = contractProcedures(subset)
    const examples: ExampleContext = fresh
      ? await this.examples.refresh()
      : await this.examples.load()
    const doc = (await new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }).generate(subset, {
      info: {
        title: `${this.service.title} — Distribution OS`,
        version: process.env.APP_VERSION ?? '0.0.0',
        description: `${describeAuth(this.service)}\n\n---\n\n${describeExamples(examples)}`,
      },
      servers: [{ url: `http://localhost:${servicePort(this.service)}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: `Access token from POST http://localhost:${AUTH_PORT}/auth/login (EdDSA JWT, 15 min); refresh at /auth/refresh.`,
          },
        },
      },
      security: [{ bearerAuth: [] }],
    })) as OpenApiDocument
    annotateRoles(doc, procedures)
    annotateExamples(doc, buildExamples(procedures, examples, { roles: this.service.roles }))
    return doc
  }

  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  page(): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${this.service.title} API</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0"><script id="api-reference" data-url="/docs/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0"></script></body></html>`
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

type OpenApiParameter = { name?: unknown; in?: unknown; example?: unknown }
type OpenApiMediaType = { example?: unknown }
type OpenApiOperation = Record<string, unknown> & {
  security?: unknown
  'x-roles'?: unknown
  parameters?: unknown[]
  requestBody?: { content?: Record<string, OpenApiMediaType | undefined> }
}
type OpenApiDocument = {
  paths?: Record<string, Record<string, OpenApiOperation | undefined> | undefined>
} & Record<string, unknown>

/**
 * Sets `x-roles` on every operation from PERMISSIONS (a role array, or 'public' / 'authenticated')
 * and clears `security` on public operations so the reference does not ask for a token there.
 * Operations are matched by method + path, exactly as the contract declares them.
 */
function annotateRoles(
  doc: OpenApiDocument,
  procedures: { method: string; httpPath: string; permission: Permission | undefined }[],
): void {
  const byRoute = new Map<string, Permission | undefined>()
  for (const p of procedures) byRoute.set(routeKey(p.method, p.httpPath), p.permission)
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!operation || typeof operation !== 'object') continue
      const permission = byRoute.get(routeKey(method, path))
      operation['x-roles'] = permission === undefined ? [] : permission
      if (permission === 'public') operation.security = []
    }
  }
}

/**
 * Pre-fills "Try it out": Swagger UI seeds every field from the operation's `example`, so a path
 * parameter gets a row that exists and a request body gets one that the handler accepts.
 */
function annotateExamples(doc: OpenApiDocument, examples: Map<string, ProcedureExample>): void {
  const byRoute = new Map<string, ProcedureExample>()
  for (const example of examples.values()) {
    byRoute.set(routeKey(example.method, example.httpPath), example)
  }
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!operation || typeof operation !== 'object') continue
      const example = byRoute.get(routeKey(method, path))
      if (!example) continue
      if (example.note) operation['x-dos-note'] = example.note
      applyParameterExamples(operation, example)
      applyBodyExample(operation, example)
    }
  }
}

function applyParameterExamples(operation: OpenApiOperation, example: ProcedureExample): void {
  const parameters = operation.parameters
  if (!Array.isArray(parameters)) return
  for (const entry of parameters) {
    if (entry === null || typeof entry !== 'object') continue
    const parameter = entry as OpenApiParameter
    const name = typeof parameter.name === 'string' ? parameter.name : undefined
    if (name === undefined) continue
    // Path params always get their row; only the query filters that keep the call returning rows do.
    const value = parameter.in === 'path' ? example.pathParams[name] : example.query[name]
    if (value !== undefined) parameter.example = value
  }
}

function applyBodyExample(operation: OpenApiOperation, example: ProcedureExample): void {
  if (!example.body) return
  const media = operation.requestBody?.content?.['application/json']
  if (media) media.example = example.body
}

function describeAuth(service: ServiceDefinition): string {
  // Module 13: a console account holds no membership, so it signs in at its own endpoint and there is
  // no distributor to pick. Pointing its readers at /auth/login would send them somewhere that
  // correctly refuses them.
  const platform = service.roles.includes('platform_admin')
  const signIn = platform
    ? `Sign in at POST http://localhost:${AUTH_PORT}/auth/platform/login with username + password (the demo console account is \`dos.admin\` / \`Dos@1234\`, printed by \`pnpm db:seed\`) and a client-generated deviceId. NOT /auth/login: a Distribution OS console account is a member of no distributor, so the tenant sign-in has nothing to give it. The reply carries an accessToken (EdDSA JWT, 15 minutes, \`role: platform_admin\` and no tenant) and a refreshToken (opaque, rotates on every use).`
    : `Sign in at POST http://localhost:${AUTH_PORT}/auth/login with username + password (demo credentials are printed by \`pnpm db:seed\`; every demo user's password is Dos@1234) and a client-generated deviceId. The reply carries an accessToken (EdDSA JWT, 15 minutes) and a refreshToken (opaque, rotates on every use).`
  const refresh = platform
    ? 'Send `Authorization: Bearer <accessToken>` on every request here. When the access token expires, POST the refreshToken to /auth/platform/refresh on the auth service for a new pair (it re-reads `platform_admins`, so a closed console account is out at the next refresh); POST /auth/logout revokes the session.'
    : 'Send `Authorization: Bearer <accessToken>` on every request here. When the access token expires, POST the refreshToken to /auth/refresh on the auth service for a new pair; POST /auth/logout revokes the session.'
  const gate =
    'Each operation lists who may call it in `x-roles` (the permission matrix in @dos/contracts): a role array, `authenticated` (any valid token) or `public` (no token). The guard answers 401 without a valid token and 403 for a role this service does not serve or the matrix does not allow, before any business logic runs.'
  const support = platform
    ? [
        '',
        "Reading a distributor's OWN data is not part of this service and never will be. It needs a `support_grants` row that that distributor's owner approved from their own app, exchanged for a five-minute pass at POST /auth/platform/support-pass and sent to owner-service (:3001) in the `x-support-grant` header. Every call made with it is written to `platform_audit`, and the window closes on its own.",
      ]
    : []
  return [
    `Roles served by this service: ${service.roles.join(', ')}.`,
    '',
    signIn,
    '',
    refresh,
    '',
    gate,
    ...support,
  ].join('\n')
}
