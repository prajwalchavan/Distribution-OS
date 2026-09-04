import { pickContract, type ServiceDefinition } from '../service/define.js'
import { fields, sample, type ZodLike } from './sample.js'

interface Procedure {
  key: string
  method: string
  path: string
  summary: string
  input: ZodLike | undefined
  output: ZodLike | undefined
}

type OrpcMeta = {
  route?: { method?: string; path?: string; summary?: string }
  inputSchema?: ZodLike
  outputSchema?: ZodLike
}

/** Flattens a contract router (nested objects of procedures) into a list in declaration order. */
export function listProcedures(router: unknown, prefix = ''): Procedure[] {
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
      })
    } else if (value && typeof value === 'object') {
      out.push(...listProcedures(value, key))
    }
  }
  return out
}

const json = (v: unknown) => JSON.stringify(v, null, 2)
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v))
const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``

function failureExamples(
  p: Procedure,
  def: ServiceDefinition,
  hasBody: boolean,
  hasIdParam: boolean,
): string {
  const blocks: string[] = []
  if (!p.path.startsWith('/health')) {
    blocks.push(
      `401 — headers missing (no tenant context)\n${fence('json', json({ statusCode: 401, message: 'tenant context missing', error: 'Unauthorized' }))}`,
    )
    blocks.push(
      `403 — role not served by this service (${def.roles.join(', ')} only), or the role may not perform this action\n${fence('json', json({ defined: false, code: 'FORBIDDEN', status: 403, message: 'This action needs one of: owner, manager, accountant, system' }))}`,
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
  const headers = [
    '-H "x-tenant-id: <tenant id>"',
    '-H "x-actor-id: <user id>"',
    `-H "x-actor-role: ${def.roles[0]}"`,
  ]
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
    return fence('bash', `curl "${url}" \\\n  ${headers.join(' \\\n  ')}`)
  }
  let path = p.path
  for (const m of p.path.match(/\{(\w+)\}/g) ?? []) {
    const k = m.slice(1, -1)
    path = path.replace(m, str(input?.[k] ?? '<id>'))
  }
  return `${fence('bash', `curl -X ${p.method} "${base}${path}" \\\n  ${headers.join(' \\\n  ')} \\\n  -H "content-type: application/json" \\\n  -d @request.json`)}\n\nrequest.json\n${fence('json', json(input ?? {}))}`
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

/** Markdown README for one service, generated from its contract subset. */
export function renderServiceReadme(def: ServiceDefinition): string {
  const procs = listProcedures(pickContract(def.contractKeys))
  const index = [
    '| Method | Path | What it does |',
    '|---|---|---|',
    ...procs.map((p) => `| ${p.method} | \`${p.path}\` | ${p.summary} |`),
  ].join('\n')
  const sections = procs.map((p) => {
    const hasBody = p.method !== 'GET'
    const hasIdParam = /\{\w+\}/.test(p.path)
    const parts = [
      `### ${p.method} \`${p.path}\``,
      '',
      p.summary + (p.key ? ` · contract \`${p.key}\`` : ''),
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
  return `<!-- GENERATED by \`pnpm docs:readme\` from shared/contracts — do not edit by hand; edit the contract or backend-services/core/src/docs/readme.ts -->

# ${def.title} (\`@dos/${def.name}-service\`)

${def.roles.length === 1 ? `Serves the **${def.roles[0]}** role.` : `Serves the roles **${def.roles.join(', ')}**.`} Port **${def.defaultPort}** (override with \`${def.name.toUpperCase()}_SERVICE_PORT\`). Stateless: run as many replicas as needed (docs/20). Shares one Postgres database and the \`@dos/core\` modules with the other services (docs/19).

## Run

\`\`\`bash
pnpm --filter @dos/${def.name}-service dev    # watch mode on :${def.defaultPort}
pnpm --filter @dos/${def.name}-service test   # smoke spec: health, docs, role gate
open http://localhost:${def.defaultPort}/docs           # interactive API reference (Scalar); /docs/openapi.json is the spec
\`\`\`

Needs the local database (\`DATABASE_URL\` in the repo-root \`.env\`; \`pnpm db:migrate && pnpm db:seed\` once). Until phone-OTP login lands every request carries three headers: \`x-tenant-id\`, \`x-actor-id\`, \`x-actor-role\` (\`pnpm db:seed\` prints demo ids per role; see docs/18-build-log.md).

Conventions: money is integer paise (₹40.00 = 4000), quantities integer pieces, percentages basis points (5% = 500), ids are client-generated UUIDv7, every write carries an \`idempotencyKey\` (same key + same payload → same answer; different payload → 409). GET inputs go in the query string. Lists return \`{ items, nextCursor }\`; pass \`cursor\` to page.

## Endpoints

${index}

${sections.join('\n')}
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
  const procs = listProcedures(pickContract(opts.service.contractKeys))
  const index = [
    '| Method | Path | Used for |',
    '|---|---|---|',
    ...procs.map((p) => `| ${p.method} | \`${p.path}\` | ${p.summary} |`),
  ].join('\n')
  return `<!-- GENERATED by \`pnpm docs:readme\` (endpoint table) — edit the prose in backend-services/core/src/docs/readme.ts or the app entry in scripts/generate-readmes.ts -->

# ${opts.title} (\`${opts.name}\`)

${opts.blurb}

Talks to the **${opts.service.title}** on port ${opts.service.defaultPort} (\`${opts.env}\`). Runs on its own: start the service, then the app.

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
