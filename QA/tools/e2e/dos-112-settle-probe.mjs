// DOS-112: Day-end settle names its trip in the path — a LIVE API probe through the app's own client configuration.
//
// Signs in as the Tarsun manager through auth-service, then calls `delivery.trips.settle` through the same compact
// OpenAPILink configuration as frontend/libs/api-client/src/client.ts (url = the manager service, a Bearer header
// function, a fetch with a 20 s deadline, one interceptor) against manager-service, with the input shape
// frontend/manager-app/app/money/day-end.tsx sends: { id, idempotencyKey, tripId, handedOverCashPaise, acceptVariance }
// (a blank note is omitted, `counted` is never sent). The fetch wrapper records the URL and body that actually leave.
//
// Modes
//   (default)                 settle the newest Tarsun trip the Day-end screen lists (first 50 by id desc, state
//                             `closing`, no settlement row), counting exactly the preview's expected cash. WRITES a
//                             settlement (that is the point). Exit 2 with the query output when no such trip exists.
//   --path-only <TRIP_NO|id>  NON-MUTATING: the same call against an ALREADY-settled trip. The server resolves the
//                             trip from the path and refuses (409 "already settled") before any write; the
//                             transaction rolls back, so the idempotency key is not kept. Proves only the path half.
//
// Needs auth-service :3000 and manager-service :3002 on dos_qa, and `psql`. Refuses the founder's own database `dos`.
//   cd QA/tools && node e2e/dos-112-settle-probe.mjs [--path-only TRIP-20260911-2]
// Exit 0 = every assertion held · 1 = the failed ones are listed · 2 = a precondition (services or data) is missing.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const NAME = 'DOS-112: Day-end settle names its trip in the path, succeeds, and dos_qa holds the settlement row'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3002'
const AUTH_URL = process.env.AUTH_URL ?? 'http://127.0.0.1:3000'
const USER = process.env.DOS_USER ?? 'vikas.kadam'
const PASSWORD = process.env.DOS_PASSWORD ?? 'Dos@1234'
const TENANT = process.env.DOS_TENANT_SLUG ?? 'tarsun'
const DB = process.env.DATABASE_URL ?? 'postgres://dos:dos@127.0.0.1:5439/dos_qa'
const PSQL = existsSync('/opt/homebrew/opt/postgresql@17/bin/psql') ? '/opt/homebrew/opt/postgresql@17/bin/psql' : 'psql'
const EV = `${ROOT}QA/evidence/${process.env.EV_DIR ?? 'batch2/dos-112-settle'}/`
const argPathOnly = process.argv.indexOf('--path-only')
const PATH_ONLY = argPathOnly >= 0 ? (process.argv[argPathOnly + 1] ?? '') : null
const MODE = PATH_ONLY === null ? 'settle' : 'path-only'

class Precondition extends Error {}
const results = []
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
}

if (new URL(DB).pathname.replace(/^\//, '') !== 'dos_qa' && process.env.ALLOW_NON_QA_DB !== '1') {
  console.log(`PRECONDITION  DATABASE_URL names ${new URL(DB).pathname}; this probe runs on dos_qa only`)
  process.exit(2)
}

const q = (text) => text.replace(/'/g, "''")
function sqlRows(query) {
  const out = execFileSync(PSQL, [DB, '-X', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' })
  return out.trim().split('\n').filter(Boolean).map((line) => line.split('|'))
}
function sqlText(queries) {
  return queries
    .map(([title, query]) => {
      const out = execFileSync(PSQL, [DB, '-X', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' })
      return `== ${title}\n${query.trim()}\n${out}`
    })
    .join('\n')
}

// ---- the oRPC client, assembled the way client.ts assembles it -------------------------------------------------
const imp = (rel) => import(pathToFileURL(`${ROOT}${rel}`).href)
const { createORPCClient } = await imp('frontend/node_modules/@orpc/client/dist/index.mjs')
const { OpenAPILink } = await imp('frontend/node_modules/@orpc/openapi-client/dist/adapters/fetch/index.mjs')
const { contract, authContract } = await imp('backend/libs/contracts/dist/index.js')
const { uuidv7 } = await imp('backend/libs/domain/dist/index.js')

/** link.ts `join` with no prefix, as the manager app builds it (EXPO_PUBLIC_API_PREFIX unset). */
const join = (base, prefix) =>
  !prefix ? base.replace(/\/$/, '') : `${base.replace(/\/$/, '')}/${prefix.replace(/^\//, '').replace(/\/$/, '')}`

const wire = []
let accessToken = null
/** link.ts `fetchWithDeadline(20_000)`, plus a recorder of what leaves and what comes back. */
function recordingFetch(timeoutMs = 20_000) {
  return async (request, init) => {
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.clone().text()
    const headers = Object.fromEntries(request.headers.entries())
    if (headers.authorization) headers.authorization = `Bearer <redacted, ${headers.authorization.length - 7} chars>`
    const entry = { at: new Date().toISOString(), method: request.method, url: request.url, headers, body }
    wire.push(entry)
    const deadline = AbortSignal.timeout(timeoutMs)
    const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([request.signal, deadline]) : deadline
    const response = await fetch(request, { ...init, signal })
    entry.status = response.status
    entry.reply = await response.clone().text()
    return response
  }
}
const headersFn = async () => (accessToken === null ? {} : { authorization: `Bearer ${accessToken}` })
/** client.ts's interceptor minus the refresh: a 401 right after a fresh sign-in is a finding, not a retry. */
const passThrough = async (opts) => opts.next()

const authClient = createORPCClient(
  new OpenAPILink(authContract, {
    url: join(AUTH_URL, undefined),
    headers: headersFn,
    fetch: recordingFetch(),
    interceptors: [passThrough],
  }),
)
const api = createORPCClient(
  new OpenAPILink(contract, {
    url: join(API_URL, undefined),
    headers: headersFn,
    fetch: recordingFetch(),
    interceptors: [passThrough],
  }),
)

// ---- evidence helpers ------------------------------------------------------------------------------------------
mkdirSync(EV, { recursive: true })
const stamp = MODE
function snapshot(which, tripId, extra = []) {
  const text = sqlText([
    ['trip', `select id, trip_no, trip_date, state, opening_cash_paise, updated_at from trips where id = '${q(tripId)}'`],
    [
      'settlement rows for the trip',
      `select id, trip_id, expected_cash_paise, handed_over_cash_paise, cash_variance_paise, has_variance, settled_by, settled_at, approved_by, note
         from trip_settlements where trip_id = '${q(tripId)}' order by settled_at`,
    ],
    [
      'trip_settlement approvals for the trip',
      `select id, status, created_at from approvals where kind = 'trip_settlement' and entity_id = '${q(tripId)}' order by created_at`,
    ],
    ...extra,
  ])
  writeFileSync(`${EV}sql-${which}.${stamp}.txt`, text)
  return text
}

function tripRow(tripId) {
  const [row] = sqlRows(`select tr.id, coalesce(tr.trip_no, ''), tr.state, tr.updated_at, t.id
                           from trips tr join tenants t on t.id = tr.tenant_id
                          where t.slug = '${q(TENANT)}' and tr.id = '${q(tripId)}'`)
  return row ? { id: row[0], tripNo: row[1], state: row[2], updatedAt: row[3], tenantId: row[4] } : null
}

async function signIn() {
  try {
    const pair = await authClient.login({
      username: USER,
      password: PASSWORD,
      deviceId: uuidv7(),
      deviceName: 'QA dos-112-settle-probe',
      platform: 'web',
    })
    accessToken = pair.accessToken
  } catch (error) {
    throw new Precondition(`could not sign in as ${USER} at ${AUTH_URL}: ${error?.status ?? ''} ${error?.message ?? error}`)
  }
}

async function call(fn) {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return {
      ok: false,
      error: { name: error?.name, code: error?.code, status: error?.status, message: error?.message, data: error?.data },
    }
  }
}

// ---- the probe -------------------------------------------------------------------------------------------------
async function settleMode() {
  const findQuery = `with page as (
      select tr.* from trips tr join tenants t on t.id = tr.tenant_id
       where t.slug = '${q(TENANT)}' order by tr.id desc limit 50)
    select p.id, coalesce(p.trip_no, ''), p.state from page p
      left join trip_settlements s on s.tenant_id = p.tenant_id and s.trip_id = p.id
     where p.state = 'closing' and s.id is null
     order by p.id desc`
  const found = process.env.TRIP_ID ? [[process.env.TRIP_ID]] : sqlRows(findQuery)
  if (found.length === 0) {
    const text = sqlText([
      ['Day-end candidates (first 50 trips by id desc, closing, unsettled)', findQuery],
      [
        'Tarsun trips by state',
        `select tr.state, count(*) from trips tr join tenants t on t.id = tr.tenant_id where t.slug = '${q(TENANT)}' group by 1 order by 1`,
      ],
    ])
    writeFileSync(`${EV}sql-before.${stamp}.txt`, text)
    console.log(text)
    throw new Precondition(`no ${TENANT} trip is in closing without a settlement; the Day-end screen has nothing to settle`)
  }
  const trip = tripRow(found[0][0])
  if (trip === null || trip.state !== 'closing') throw new Precondition(`trip ${found[0][0]} is not a closing ${TENANT} trip`)
  console.log(`[trip] ${trip.tripNo} ${trip.id} (${trip.state})`)

  await signIn()
  const preview = await call(() => api.delivery.trips.settlementPreview({ id: trip.id }))
  if (!preview.ok) throw new Precondition(`settlementPreview refused: ${JSON.stringify(preview.error)}`)
  const p = preview.value
  const handedOver = process.env.HANDED_OVER_PAISE === undefined ? p.expectedCashPaise : Number(process.env.HANDED_OVER_PAISE)
  const beyondTolerance = Math.abs(handedOver - p.expectedCashPaise) > p.tolerancePaise
  console.log(
    `[preview] expected ${p.expectedCashPaise} tolerance ${p.tolerancePaise} van lots ${p.expectedVanStock.length} → handing over ${handedOver}`,
  )
  console.log(snapshot('before', trip.id))

  const meta = { id: uuidv7(), idempotencyKey: uuidv7() }
  const input = {
    id: meta.id,
    idempotencyKey: meta.idempotencyKey,
    tripId: trip.id,
    handedOverCashPaise: handedOver,
    acceptVariance: beyondTolerance,
  }
  const mark = wire.length
  const reply = await call(() => api.delivery.trips.settle(input))
  const sent = wire.slice(mark).find((w) => w.method === 'POST')
  console.log(`[request] ${sent?.method} ${sent?.url}\n[body] ${sent?.body}\n[status] ${sent?.status}\n[reply] ${sent?.reply}`)

  const after = snapshot('after', trip.id, [
    ['the settlement row by the probe id', `select id, trip_id, handed_over_cash_paise, has_variance from trip_settlements where id = '${q(meta.id)}'`],
    ['the idempotency key', `select key, created_at, response is not null as has_response from idempotency_keys where tenant_id = '${q(trip.tenantId)}' and key = '${q(meta.idempotencyKey)}'`],
    ['the journal entry', `select id, ref_type, ref_id, narration from journal_entries where ref_type = 'trip_settlement' and ref_id = '${q(meta.id)}'`],
  ])
  console.log(after)

  const url = sent ? new URL(sent.url) : null
  check('the request path names the trip', url?.pathname === `/delivery/trips/${trip.id}/settle`, url?.pathname)
  check('the request path does not carry the new settlement id', url !== null && !url.pathname.includes(meta.id))
  check('the request goes to manager-service', url?.origin === new URL(API_URL).origin, url?.origin)
  check('the reply is success (200)', reply.ok && sent?.status === 200, `status ${sent?.status}${reply.ok ? '' : ` ${JSON.stringify(reply.error)}`}`)
  check('the reply names the trip and the probe id', reply.ok && reply.value.item.tripId === trip.id && reply.value.item.id === meta.id)
  const [row] = sqlRows(`select id, trip_id from trip_settlements where id = '${q(meta.id)}'`)
  check('dos_qa holds the settlement row for that trip', row?.[0] === meta.id && row?.[1] === trip.id, row ? row.join(' / ') : 'no row')
  const [state] = sqlRows(`select state from trips where id = '${q(trip.id)}'`)
  check('the trip left closing', state?.[0] === 'settled' || state?.[0] === 'settled_with_variance', state?.[0])
  return { trip, preview: p, input, reply }
}

async function pathOnlyMode() {
  if (!PATH_ONLY) throw new Precondition('--path-only needs a trip number or id')
  const [found] = sqlRows(`select tr.id from trips tr join tenants t on t.id = tr.tenant_id
                             where t.slug = '${q(TENANT)}' and (tr.trip_no = '${q(PATH_ONLY)}' or tr.id = '${q(PATH_ONLY)}')`)
  const trip = found ? tripRow(found[0]) : null
  if (trip === null) throw new Precondition(`no ${TENANT} trip ${PATH_ONLY}`)
  const settled = sqlRows(`select id, handed_over_cash_paise from trip_settlements where trip_id = '${q(trip.id)}'`)
  if (!['settled', 'settled_with_variance'].includes(trip.state) || settled.length !== 1)
    throw new Precondition(`--path-only needs an already-settled trip with one settlement row; ${trip.tripNo} is ${trip.state} with ${settled.length}`)
  console.log(`[trip] ${trip.tripNo} ${trip.id} (${trip.state}, settlement ${settled[0][0]}) — SUPPLEMENTARY, non-mutating`)
  const approvalsBefore = sqlRows(`select count(*) from approvals where kind = 'trip_settlement' and entity_id = '${q(trip.id)}'`)[0][0]

  await signIn()
  const preview = await call(() => api.delivery.trips.settlementPreview({ id: trip.id }))
  console.log(`[preview] ${preview.ok ? `state ${preview.value.tripState}, settlement ${preview.value.settlement?.id ?? 'none'}` : JSON.stringify(preview.error)}`)
  console.log(snapshot('before', trip.id))

  const meta = { id: uuidv7(), idempotencyKey: uuidv7() }
  const input = {
    id: meta.id,
    idempotencyKey: meta.idempotencyKey,
    tripId: trip.id,
    handedOverCashPaise: Number(settled[0][1]),
    acceptVariance: false,
  }
  const mark = wire.length
  const reply = await call(() => api.delivery.trips.settle(input))
  const sent = wire.slice(mark).find((w) => w.method === 'POST')
  console.log(`[request] ${sent?.method} ${sent?.url}\n[body] ${sent?.body}\n[status] ${sent?.status}\n[reply] ${sent?.reply}`)
  const after = snapshot('after', trip.id, [
    ['no row under the probe id', `select count(*) from trip_settlements where id = '${q(meta.id)}'`],
    ['no idempotency key kept', `select count(*) from idempotency_keys where tenant_id = '${q(trip.tenantId)}' and key = '${q(meta.idempotencyKey)}'`],
  ])
  console.log(after)

  const url = sent ? new URL(sent.url) : null
  check('the request path names the trip', url?.pathname === `/delivery/trips/${trip.id}/settle`, url?.pathname)
  check('the request path does not carry the new settlement id', url !== null && !url.pathname.includes(meta.id))
  check(
    'the server resolved the trip from the path: 409 naming that trip as already settled (not a 404 for an unknown trip)',
    !reply.ok && sent?.status === 409 && typeof reply.error.message === 'string' && reply.error.message.includes(trip.tripNo || trip.id) && /already settled/.test(reply.error.message),
    `status ${sent?.status} ${reply.ok ? 'success?!' : reply.error.message}`,
  )
  const now = tripRow(trip.id)
  const settledAfter = sqlRows(`select id from trip_settlements where trip_id = '${q(trip.id)}'`)
  const keyAfter = sqlRows(`select count(*) from idempotency_keys where tenant_id = '${q(trip.tenantId)}' and key = '${q(meta.idempotencyKey)}'`)[0][0]
  const approvalsAfter = sqlRows(`select count(*) from approvals where kind = 'trip_settlement' and entity_id = '${q(trip.id)}'`)[0][0]
  check(
    'nothing was written: same single settlement row, trip untouched, no key kept, no approval filed',
    settledAfter.length === 1 && settledAfter[0][0] === settled[0][0] && now.state === trip.state && now.updatedAt === trip.updatedAt && keyAfter === '0' && approvalsAfter === approvalsBefore,
    `settlements ${settledAfter.map((r) => r[0]).join(',')} · state ${now.state} · updated_at ${now.updatedAt === trip.updatedAt ? 'same' : 'CHANGED'} · key rows ${keyAfter} · approvals ${approvalsBefore}→${approvalsAfter}`,
  )
  return { trip, input, reply }
}

console.log(`${NAME}\n[mode] ${MODE} · api ${API_URL} · auth ${AUTH_URL} · user ${USER} · db ${new URL(DB).pathname.slice(1)}`)
let exit = 0
let outcome = null
try {
  outcome = MODE === 'settle' ? await settleMode() : await pathOnlyMode()
  exit = results.every((r) => r.ok) ? 0 : 1
} catch (error) {
  if (error instanceof Precondition) {
    console.log(`PRECONDITION  ${error.message}`)
    exit = 2
  } else {
    console.log(`ERROR  ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    exit = 1
  }
}
writeFileSync(
  `${EV}wire.${stamp}.json`,
  JSON.stringify({ name: NAME, mode: MODE, at: new Date().toISOString(), results, outcome, wire }, null, 2),
)
const failed = results.filter((r) => !r.ok).length
console.log(
  exit === 0
    ? `GREEN  ${results.length} assertions held`
    : exit === 2
      ? 'NOT RUN  a precondition is missing'
      : `RED  ${failed} of ${results.length} assertions failed${results.length === 0 ? ' (stopped by an error)' : ''}`,
)
process.exit(exit)
