import {
  ALL_ROLES,
  isAllowed,
  permissionFor,
  type MembershipRole,
  type PermissionRole,
  type Permission,
} from '@dos/contracts'
import { pickContract, type ServiceDefinition } from '../service/define.js'
import { fields, sample, SAMPLE_ACCESS_TOKEN, type ZodLike } from './sample.js'

interface Procedure {
  key: string
  method: string
  path: string
  summary: string
  input: ZodLike | undefined
  output: ZodLike | undefined
  /** From `@dos/contracts` PERMISSIONS — the single source of truth the guard itself reads. */
  permission: Permission | undefined
}

type OrpcMeta = {
  route?: { method?: string; path?: string; summary?: string }
  inputSchema?: ZodLike
  outputSchema?: ZodLike
}

/**
 * Flattens a contract router (nested objects of procedures) into a list in declaration order, each
 * row carrying its schemas (for the field tables and samples) and its permission (from
 * `@dos/contracts`, the table the guard itself enforces — see permissions.test.ts for why `undefined`
 * here can only mean a contract addition without a matrix line, never "no restriction").
 */
function collectProcedures(router: unknown, prefix = ''): Procedure[] {
  const out: Procedure[] = []
  if (!router || typeof router !== 'object') return out
  for (const [name, value] of Object.entries(router as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${name}` : name
    const meta = (value as { '~orpc'?: OrpcMeta })?.['~orpc']
    if (meta?.route) {
      out.push({
        key,
        method: meta.route.method ?? 'POST',
        path: meta.route.path ?? `/${key.replace(/\./g, '/')}`,
        summary: meta.route.summary ?? '',
        input: meta.inputSchema,
        output: meta.outputSchema,
        permission: permissionFor(key),
      })
    } else if (value && typeof value === 'object') {
      out.push(...collectProcedures(value, key))
    }
  }
  return out
}

/** Single-letter column headers for the compact permission matrix. */
const ROLE_ABBR: Record<PermissionRole, string> = {
  owner: 'O',
  manager: 'M',
  accountant: 'A',
  salesperson: 'S',
  warehouse: 'W',
  delivery: 'D',
  retailer: 'R',
  /** Module 13. Not a membership, so it is a column only on the one service that serves it. */
  platform_admin: 'P',
}

/**
 * The columns of THIS service's matrix. The six tenant services keep the seven membership columns
 * they have always had; admin-service (:3007) gets an eighth for `platform_admin`, because a matrix
 * whose every cell is "–" would say the console can call nothing, which is the opposite of the truth.
 */
function matrixRoles(def: ServiceDefinition): readonly PermissionRole[] {
  return def.roles.includes('platform_admin') ? [...ALL_ROLES, 'platform_admin'] : ALL_ROLES
}

/** The legend under the matrix, in step with the columns above it. */
function matrixLegend(def: ServiceDefinition): string {
  const base =
    'O owner · M manager · A accountant · S salesperson · W warehouse · D delivery · R retailer'
  return def.roles.includes('platform_admin')
    ? `${base} · P platform_admin (Distribution OS staff)`
    : base
}

/** Human-readable rendering of a PERMISSIONS entry for the endpoint tables and per-endpoint sections. */
function describePermission(permission: Permission | undefined): string {
  if (permission === undefined) return '_undeclared (refused)_'
  if (permission === 'public') return 'public'
  if (permission === 'authenticated') return 'any signed-in role'
  return permission.join(', ')
}

/**
 * Whether `role` may reach this procedure on THIS service: both gates the guard actually applies —
 * the permission matrix, and the service's own role list (a role the matrix allows may still be one
 * this particular service does not serve, e.g. `manager` is back-office-allowed but owner-service
 * only serves `owner`). A `public` procedure skips both checks in the guard (it returns before ever
 * looking at the service's role list), so it is reachable regardless of `def.roles`.
 */
function reachableOnThisService(
  p: Procedure,
  def: ServiceDefinition,
  role: PermissionRole,
): boolean {
  if (p.permission === 'public') return true
  return isAllowed(p.permission, role) && def.roles.includes(role)
}

const json = (v: unknown) => JSON.stringify(v, null, 2)
const str = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : JSON.stringify(v)
const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``

/**
 * A real 403 this endpoint would produce, and for which role — mirrors the guard's own order of
 * checks (`tenant.guard.ts`): it refuses a role this SERVICE does not serve before it ever looks at
 * the permission matrix, and each path throws a different message. Picking the wrong one would show
 * a message the guard could never actually produce for that role.
 *
 * Prefers a role this service DOES serve but this specific endpoint excludes (the more instructive,
 * endpoint-specific case) over a role the service refuses outright; falls back to the latter, which
 * is the only kind possible on a single-role service. Returns null when no role would be refused.
 */
function forbiddenSample(
  p: Procedure,
  def: ServiceDefinition,
): { role: MembershipRole; message: string } | null {
  const notServed = (r: MembershipRole) => !def.roles.includes(r)
  if (!Array.isArray(p.permission)) {
    // 'public' never 403s. 'authenticated' passes the matrix for any role, so the only possible
    // refusal is the service itself not serving that role.
    if (p.permission === 'authenticated') {
      const role = ALL_ROLES.find(notServed)
      if (role) return { role, message: `${def.name}-service does not serve the ${role} role` }
    }
    return null
  }
  const permission = p.permission
  const servedButExcluded = ALL_ROLES.find((r) => !notServed(r) && !permission.includes(r))
  if (servedButExcluded)
    return {
      role: servedButExcluded,
      message: `the ${servedButExcluded} role may not call ${p.method} ${p.path}`,
    }
  const unserved = ALL_ROLES.find(notServed)
  if (unserved)
    return { role: unserved, message: `${def.name}-service does not serve the ${unserved} role` }
  return null
}

function failureExamples(
  p: Procedure,
  def: ServiceDefinition,
  hasBody: boolean,
  hasIdParam: boolean,
): string {
  const blocks: string[] = []
  if (p.permission !== 'public') {
    blocks.push(
      `401 — missing, malformed or expired access token\n${fence('json', json({ statusCode: 401, message: 'sign in required', error: 'Unauthorized' }))}`,
    )
    const forbidden = forbiddenSample(p, def)
    if (forbidden)
      blocks.push(
        `403 — role not allowed\n${fence('json', json({ statusCode: 403, message: forbidden.message, error: 'Forbidden' }))}`,
      )
  }
  if (p.input) {
    const bad = hasBody
      ? { path: ['phone'], message: 'Indian mobile in E.164, e.g. +919876543210' }
      : { path: ['limit'], message: 'Too big: expected number to be <=500' }
    blocks.push(
      `400 — input validation\n${fence('json', json({ defined: false, code: 'BAD_REQUEST', status: 400, message: 'Input validation failed', data: { issues: [bad] } }))}`,
    )
  }
  if (hasIdParam)
    blocks.push(
      `404 — no such row in this tenant\n${fence('json', json({ defined: false, code: 'NOT_FOUND', status: 404, message: 'not found' }))}`,
    )
  if (hasBody)
    blocks.push(
      `409 — same idempotencyKey reused with a different payload (a retry with the same payload returns the stored 200)\n${fence('json', json({ defined: false, code: 'CONFLICT', status: 409, message: 'idempotencyKey was already used with a different request' }))}`,
    )
  blocks.push(
    `503 — database not configured / unreachable\n${fence('json', json({ defined: false, code: 'SERVICE_UNAVAILABLE', status: 503, message: 'database is not configured' }))}`,
  )
  return blocks.join('\n\n')
}

function requestExample(p: Procedure, def: ServiceDefinition): string {
  const base = `http://localhost:${def.defaultPort}`
  const headers =
    p.permission === 'public' ? [] : [`-H "Authorization: Bearer ${SAMPLE_ACCESS_TOKEN}"`]
  const input = p.input ? (sample(p.input) as Record<string, unknown>) : undefined
  if (p.method === 'GET') {
    const params = p.path.match(/\{(\w+)\}/g)?.map((m) => m.slice(1, -1)) ?? []
    let path = p.path
    const query: string[] = []
    for (const [k, v] of Object.entries(input ?? {})) {
      if (params.includes(k)) path = path.replace(`{${k}}`, str(v))
      else if (v !== undefined && v !== null && typeof v !== 'object')
        query.push(`${k}=${encodeURIComponent(str(v))}`)
    }
    const url = `${base}${path}${query.length ? `?${query.join('&')}` : ''}`
    return fence(
      'bash',
      `curl "${url}"${headers.length ? ` \\\n  ${headers.join(' \\\n  ')}` : ''}`,
    )
  }
  let path = p.path
  for (const m of p.path.match(/\{(\w+)\}/g) ?? []) {
    const k = m.slice(1, -1)
    path = path.replace(m, str(input?.[k] ?? '<id>'))
  }
  const authLine = headers.length ? ` \\\n  ${headers.join(' \\\n  ')}` : ''
  return `${fence('bash', `curl -X ${p.method} "${base}${path}"${authLine} \\\n  -H "content-type: application/json" \\\n  -d @request.json`)}\n\nrequest.json\n${fence('json', json(input ?? {}))}`
}

function fieldTable(schema: ZodLike | undefined): string {
  if (!schema) return ''
  const rows = fields(schema)
  if (rows.length === 0) return ''
  return [
    '| Field | Type | Required |',
    '|---|---|---|',
    ...rows.map((r) => `| \`${r.key}\` | ${r.type} | ${r.required ? 'yes' : 'no'} |`),
  ].join('\n')
}

/** The "how do I get a token" section every service README opens with, right after the intro. */
function signInSection(def: ServiceDefinition): string {
  if (def.name === 'auth')
    return `## Sign in

This is the only service the other six trust for identity; nothing else calls into it.

**Sign in.** \`POST /auth/login\` with \`{ username, password, deviceId, deviceName?, platform?, tenantId? }\`. \`deviceId\` is a client-generated UUIDv7, stable for the life of the install — generate it once and reuse it for every login, refresh and \`sync.upload\` on the other services. An unknown username and a wrong password answer the identical \`401\` (an attacker must not learn which usernames exist); five wrong passwords in a row lock the account for fifteen minutes and answer \`423\`.

**What you get back.** \`accessToken\` — an EdDSA-signed JWT, default lifetime 15 minutes (\`AUTH_ACCESS_TTL_SECONDS\`). Send it as \`Authorization: Bearer <accessToken>\` on every request to any of the six role services; each verifies it with the public key alone, no call back here. Its claims: \`sub\` (user id), \`tid\` (active tenant), \`role\` (membership role in that tenant), \`sid\`/\`did\` (session/device), plus \`iss\`, \`aud\`, \`iat\`, \`exp\`, \`jti\`. Alongside it, \`refreshToken\` — opaque, random, one per device — and \`user\`, \`tenant\`, \`role\`, \`memberships\` so the app can render without a second call.

**Staying signed in.** \`POST /auth/refresh\` with the refresh token and the same \`deviceId\` before the access token expires returns a new pair. Refreshing **rotates** the refresh token: keep only the newest one — presenting one that was already rotated revokes the whole session (treated as theft, logged as \`refresh_reuse_detected\`).

**Everything else.** \`GET /auth/me\` is the same shape as login plus the current session; \`GET /auth/sessions\` lists every device signed in as this user; \`POST /auth/sessions/revoke\` signs one of them out; \`POST /auth/logout\` revokes this one; \`POST /auth/change-password\` revokes every *other* session of the user; \`GET /.well-known/jwks.json\` publishes the public half of the signing keys for anyone who wants to verify a token without importing this codebase. Request/response detail for each is below.
`
  return `## Sign in

Everything below except the endpoints marked **public** in the Roles column needs a token from **auth-service** (port 3000 — full flow in its README). In short: \`POST http://localhost:3000/auth/login\` with \`{ "username": "...", "password": "...", "deviceId": "<uuid>" }\` returns \`accessToken\` (an EdDSA JWT, ~15 minutes) and \`refreshToken\` (opaque, rotates on every use). Send the access token here as \`Authorization: Bearer <accessToken>\`; before it expires, \`POST /auth/refresh\` on auth-service for a new pair rather than signing in again.

A missing/expired token or a role this service or this endpoint does not allow gets a \`401\`/\`403\` — see the failure responses on each endpoint below, and the permission matrix at the end of this document.
`
}

/** Markdown README for one service, generated from its contract subset. */
export function renderServiceReadme(def: ServiceDefinition): string {
  const procs = collectProcedures(pickContract(def.contractKeys))
  const index = [
    '| Method | Path | What it does | Roles |',
    '|---|---|---|---|',
    ...procs.map(
      (p) => `| ${p.method} | \`${p.path}\` | ${p.summary} | ${describePermission(p.permission)} |`,
    ),
  ].join('\n')
  const sections = procs.map((p) => {
    const hasBody = p.method !== 'GET'
    const hasIdParam = /\{\w+\}/.test(p.path)
    const parts = [
      `### ${p.method} \`${p.path}\``,
      '',
      p.summary + (p.key ? ` · contract \`${p.key}\`` : ''),
      '',
      `**Roles:** ${describePermission(p.permission)}`,
      '',
    ]
    if (p.input)
      parts.push(
        hasBody ? '**Request body**' : '**Query / path parameters**',
        '',
        fieldTable(p.input),
        '',
      )
    parts.push('**Example request**', '', requestExample(p, def), '')
    parts.push(
      '**Success response** — `200`',
      '',
      fence('json', json(p.output ? sample(p.output) : { ok: true })),
      '',
    )
    parts.push('**Failure responses**', '', failureExamples(p, def, hasBody, hasIdParam), '')
    return parts.join('\n')
  })
  const roles = matrixRoles(def)
  const matrixHeader = `| Procedure | ${roles.map((r) => ROLE_ABBR[r]).join(' | ')} |`
  const matrixSep = `|---|${roles.map(() => '---').join('|')}|`
  const matrixRows = procs.map((p) => {
    const cells = roles.map((r) => (reachableOnThisService(p, def, r) ? '✓' : '–'))
    return `| \`${p.key}\` | ${cells.join(' | ')} |`
  })
  return `<!-- GENERATED by \`pnpm docs:readme\` from shared/contracts — do not edit by hand; edit the contract or backend-services/core/src/docs/readme.ts -->

# ${def.title} (\`@dos/${def.name}-service\`)

${def.roles.length === 1 ? `Serves the **${def.roles[0]}** role.` : `Serves the roles **${def.roles.join(', ')}**.`} Port **${def.defaultPort}** (override with \`${def.name.toUpperCase()}_SERVICE_PORT\`). Stateless: run as many replicas as needed (docs/20). Shares one Postgres database and the \`@dos/core\` modules with the other services (docs/19).

${signInSection(def)}
## Run

\`\`\`bash
pnpm --filter @dos/${def.name}-service dev    # watch mode on :${def.defaultPort}
pnpm --filter @dos/${def.name}-service test   # smoke spec: health, docs, role gate
open http://localhost:${def.defaultPort}/docs           # interactive API reference (Scalar); /docs/openapi.json is the spec
\`\`\`

Needs the local database (\`DATABASE_URL\` in the repo-root \`.env\`; \`pnpm db:migrate && pnpm db:seed\` once — the seed prints a username + password per demo role; see docs/18-build-log.md). Turn those into a token with "Sign in" above.

Conventions: money is integer paise (₹40.00 = 4000), quantities integer pieces, percentages basis points (5% = 500), ids are client-generated UUIDv7, every write carries an \`idempotencyKey\` (same key + same payload → same answer; different payload → 409). GET inputs go in the query string. Lists return \`{ items, nextCursor }\`; pass \`cursor\` to page.

## Endpoints

${index}

${sections.join('\n')}
## Permission matrix

Who may call what, from the \`PERMISSIONS\` table in \`@dos/contracts\` narrowed to the roles this service serves — ✓ = allowed, – = refused (either the matrix excludes the role, or this service does not serve it). ${matrixLegend(def)}.

${matrixHeader}
${matrixSep}
${matrixRows.join('\n')}
`
}

/** README for a frontend app: which service it talks to and the endpoints it uses. */
export function renderAppReadme(opts: {
  name: string
  title: string
  blurb: string
  service: ServiceDefinition
  run: string
  env: string
  screens: string[]
}): string {
  const procs = collectProcedures(pickContract(opts.service.contractKeys))
  const index = [
    '| Method | Path | Used for | Roles |',
    '|---|---|---|---|',
    ...procs.map(
      (p) => `| ${p.method} | \`${p.path}\` | ${p.summary} | ${describePermission(p.permission)} |`,
    ),
  ].join('\n')
  return `<!-- GENERATED by \`pnpm docs:readme\` (endpoint table) — edit the prose in backend-services/core/src/docs/readme.ts or the app entry in scripts/generate-readmes.ts -->

# ${opts.title} (\`${opts.name}\`)

${opts.blurb}

Talks to the **${opts.service.title}** on port ${opts.service.defaultPort} (\`${opts.env}\`). Runs on its own: start the service, then the app.

## Sign in

Signs in against **auth-service** (port 3000) with username + password and gets back an access token (\`Authorization: Bearer <accessToken>\`, ~15 minutes) plus a refresh token for this device. The app keeps the refresh token and exchanges it for a new access token before the old one expires, so a person stays signed in without a login screen per service — see auth-service's README for the full flow, and the Roles column below for who may call each endpoint.

## Run

\`\`\`bash
${opts.run}
\`\`\`

## Screens

${opts.screens.map((s) => `- ${s}`).join('\n')}

## Endpoints this app uses

Full request/response samples for each are in \`backend-services/${opts.service.name}-service/README.md\`.

${index}
`
}
