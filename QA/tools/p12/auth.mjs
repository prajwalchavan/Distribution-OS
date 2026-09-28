// Phase 11 — authentication. Uses spare users for anything that locks, and anil.tarsun (2nd owner)
// for admin ops so the primary owner is never locked. Checks tenant-service calls, not only /auth/me.
import { readFileSync, writeFileSync } from 'node:fs'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { execSync } from 'node:child_process'
import { login, req, uuid } from './lib.mjs'

const F = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))
const PW = 'Dos@1234'
const TAR = F.tenants.tarsun
const out = []
function log(name, detail) {
  out.push({ name, ...detail })
  console.log(`- ${name}: ${JSON.stringify(detail).slice(0, 260)}`)
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const did = (at) => JSON.parse(Buffer.from(at.split('.')[1], 'base64url')).did
async function loginFull(username, extra = {}) {
  return login(username, PW, { deviceId: uuid(), ...extra })
}
function resetLocks() {
  try {
    execSync(
      `PGHOST=127.0.0.1 PGPORT=5439 PGUSER=dos /opt/homebrew/opt/postgresql@17/bin/psql -d dos_test_p12_access -c "update users set locked_until=null, failed_login_count=0 where locked_until is not null or failed_login_count>0"`,
      { stdio: 'ignore' },
    )
  } catch {
    /* ignore */
  }
}

resetLocks()

// ---------- 1. wrong password vs unknown user: message + timing (stay under lockout threshold) ----------
{
  const wrong = []
  const unknown = []
  for (let i = 0; i < 3; i++) {
    let t = Date.now()
    const r1 = await req('POST', '/auth/auth/login', { body: { username: 'raju.yadav', password: 'WrongX99', deviceId: uuid() } })
    wrong.push({ ms: Date.now() - t, status: r1.status, msg: r1.body?.message })
    t = Date.now()
    const r2 = await req('POST', '/auth/auth/login', { body: { username: 'ghost.user.zzz', password: 'WrongX99', deviceId: uuid() } })
    unknown.push({ ms: Date.now() - t, status: r2.status, msg: r2.body?.message })
  }
  resetLocks()
  const med = (a) => a.map((x) => x.ms).sort((x, y) => x - y)[1]
  log('wrong-vs-unknown', {
    wrongStatus: wrong[0].status,
    wrongMsg: wrong[0].msg,
    unknownStatus: unknown[0].status,
    unknownMsg: unknown[0].msg,
    identicalResponse: wrong[0].status === unknown[0].status && wrong[0].msg === unknown[0].msg,
    medianWrongMs: med(wrong),
    medianUnknownMs: med(unknown),
    enumerationRisk: wrong[0].msg !== unknown[0].msg ? 'MESSAGE DIFFERS' : 'no (same message + status)',
  })
}

// ---------- 2. lockout after repeated wrong passwords ----------
{
  const user = 'ruksana.shaikh' // spare salesperson, not reused
  const statuses = []
  for (let i = 0; i < 22; i++) {
    const r = await req('POST', '/auth/auth/login', { body: { username: user, password: `Bad${i}xy9`, deviceId: uuid() } })
    statuses.push(r.status)
  }
  const correct = await req('POST', '/auth/auth/login', { body: { username: user, password: PW, deviceId: uuid() } })
  const firstLockAt = statuses.findIndex((s) => s !== 401) + 1
  log('lockout', {
    firstNon401AtAttempt: firstLockAt,
    lockStatus: statuses.find((s) => s !== 401),
    correctPwWhileLocked: correct.status,
    lockoutEnforced: correct.status !== 200,
  })
  resetLocks()
}

// ---------- 3. refresh rotation + reuse of an old refresh token ----------
{
  const r = await loginFull('vikas.kadam')
  const dev = did(r.body.accessToken)
  const rt0 = r.body.refreshToken
  const ref1 = await req('POST', '/auth/auth/refresh', { body: { refreshToken: rt0, deviceId: dev } })
  const rt1 = ref1.body?.refreshToken
  const reuse = await req('POST', '/auth/auth/refresh', { body: { refreshToken: rt0, deviceId: dev } })
  const child = await req('POST', '/auth/auth/refresh', { body: { refreshToken: rt1, deviceId: dev } })
  log('refresh-rotation-and-reuse', {
    firstRefresh: ref1.status,
    rotated: rt1 !== rt0,
    reuseOldTokenStatus: reuse.status,
    legitChildAfterReuse: child.status,
    familyKilledOnReuse: child.status !== 200 && reuse.status !== 200,
  })
}

// ---------- 4. access token after logout — auth AND a tenant service ----------
{
  const r = await loginFull('meena.joshi', { actAs: 'accountant' })
  const at = r.body.accessToken
  const tenantBefore = await req('GET', '/manager/reporting/dashboard/owner', { token: at })
  await req('POST', '/auth/auth/logout', { body: { refreshToken: r.body.refreshToken } })
  const me = await req('GET', '/auth/auth/me', { token: at })
  const tenantAfter = await req('GET', '/manager/reporting/dashboard/owner', { token: at })
  log('access-after-logout', {
    authMeAfter: me.status,
    tenantBefore: tenantBefore.status,
    tenantAfterLogout: tenantAfter.status,
    tenantStillWorks: tenantAfter.status === 200,
    note: tenantAfter.status === 200 ? 'access token STILL works on tenant service after logout (stateless JWT until exp)' : 'rejected on tenant service too',
  })
}

// ---------- 5. deactivation — access token on a tenant service after owner disables the staff ----------
{
  const spare = 'sandeep.mane'
  const spareId = '008fa1f5-ecd7-790e-8467-bcb88d4d3646'
  const r = await loginFull(spare)
  const at = r.body.accessToken
  const rt = r.body.refreshToken
  const owner = await loginFull('anil.tarsun') // 2nd Tarsun owner, unlocked
  const disable = await req('POST', '/owner/tenancy/staff/set-status', {
    token: owner.body.accessToken,
    body: { idempotencyKey: `p12-${uuid()}`, userId: spareId, status: 'disabled' },
  })
  const tenantCall = await req('GET', '/sales/orders?limit=1', { token: at })
  const refreshCall = await req('POST', '/auth/auth/refresh', { body: { refreshToken: rt, deviceId: did(at) } })
  await req('POST', '/owner/tenancy/staff/set-status', {
    token: owner.body.accessToken,
    body: { idempotencyKey: `p12-${uuid()}`, userId: spareId, status: 'active' },
  })
  log('deactivation', {
    disableStatus: disable.status,
    tenantCallAfterDisable: tenantCall.status,
    refreshAfterDisable: refreshCall.status,
    accessStillWorksOnTenant: tenantCall.status === 200,
    note: tenantCall.status === 200 ? 'DISABLED staff keeps operating on tenant API with the live access token until it expires (<=15 min); refresh revoked' : 'access rejected after disable',
  })
}

// ---------- 6. password change — other session on a tenant service ----------
{
  const user = 'kavita.sawant'
  const s1 = await loginFull(user)
  const s2 = await loginFull(user)
  const s2at = s2.body.accessToken
  const chg = await req('POST', '/auth/auth/change-password', { token: s1.body.accessToken, body: { currentPassword: PW, newPassword: PW } })
  const s2me = await req('GET', '/auth/auth/me', { token: s2at })
  const s2tenant = await req('GET', '/warehouse/inventory/balances?limit=1', { token: s2at })
  const s2refresh = await req('POST', '/auth/auth/refresh', { body: { refreshToken: s2.body.refreshToken, deviceId: did(s2at) } })
  log('password-change-other-session', {
    changeStatus: chg.status,
    otherAuthMe: s2me.status,
    otherTenantCall: s2tenant.status,
    otherRefresh: s2refresh.status,
    otherAccessStillWorksOnTenant: s2tenant.status === 200,
  })
}

// ---------- 7. tampered / forged tokens ----------
{
  // Use a NON-owner token so a role->owner change is a real tamper (payload bytes differ).
  const r = await loginFull('rahul.deshmukh', { tenantId: TAR })
  const at = r.body.accessToken
  const [h, p, s] = at.split('.')
  const payload = JSON.parse(Buffer.from(p, 'base64url')) // role: salesperson
  const T = async (tok) => (await req('GET', '/owner/orders?limit=1', { token: tok })).status
  const algNone = await T(`${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`)
  const roleTamper = await T(`${h}.${b64url({ ...payload, role: 'owner' })}.${s}`) // salesperson -> owner
  const tidTamper = await T(`${h}.${b64url({ ...payload, tid: F.tenants.sai })}.${s}`)
  const { privateKey } = generateKeyPairSync('ed25519')
  const si = `${h}.${b64url({ ...payload })}`
  const forged = await T(`${si}.${edSign(null, Buffer.from(si), privateKey).toString('base64url')}`)
  const expiredTamper = await T(`${h}.${b64url({ ...payload, exp: 1000000000 })}.${s}`)
  const garbage = await T('not.a.jwt')
  const none2 = await T('')
  log('tampered-tokens', {
    algNone, roleClaimTamper: roleTamper, tenantClaimTamper: tidTamper, forgedWrongKey: forged,
    expiredOrTamperedExp: expiredTamper, garbage, empty: none2,
    allRejected: [algNone, roleTamper, tidTamper, forged, expiredTamper, garbage, none2].every((x) => x === 401 || x === 403),
  })
}

// ---------- 8. actAs unheld role; switchTenant to unheld tenant ----------
{
  const actAs = await loginFull('rahul.deshmukh', { tenantId: TAR, actAs: 'owner' })
  log('actAs-unheld-role', { status: actAs.status, grantedRole: actAs.body?.role, escalated: actAs.status === 200 && actAs.body?.role === 'owner', body: actAs.status === 200 ? undefined : actAs.body?.message })
  const base = await loginFull('anil.tarsun')
  const sw = await req('POST', '/auth/auth/switch-tenant', { body: { refreshToken: base.body.refreshToken, deviceId: did(base.body.accessToken), tenantId: F.tenants.sai } })
  log('switchTenant-unheld-tenant', { status: sw.status, crossed: sw.status === 200 && sw.body?.tenant?.id === F.tenants.sai, body: sw.status === 200 ? { role: sw.body?.role, tid: sw.body?.tenant?.id } : sw.body?.message })
}

// ---------- 9. must-change-password: can such a user operate before changing? ----------
{
  const owner = await loginFull('anil.tarsun')
  const uname = `p12mcp${Date.now().toString().slice(-6)}`
  const create = await req('POST', '/owner/tenancy/staff', {
    token: owner.body.accessToken,
    body: { idempotencyKey: `p12-${uuid()}`, name: 'P12 MCP User', username: uname, role: 'salesperson', password: 'Temp@1234' },
  })
  let mcp = { createStatus: create.status }
  if (create.status === 200 || create.status === 201) {
    const lo = await login(uname, 'Temp@1234', { deviceId: uuid() })
    if (lo.status === 200) {
      mcp.mustChangePassword = lo.body.user?.mustChangePassword
      const call = await req('GET', '/sales/orders?limit=1', { token: lo.body.accessToken })
      mcp.apiCallBeforeChange = call.status
      mcp.canOperateBeforeChange = call.status === 200
    } else {
      mcp.loginStatus = lo.status
      mcp.loginMsg = lo.body?.message
    }
  } else mcp.createMsg = create.body?.message
  log('must-change-password', { ...mcp, note: 'observation; defect only if money can move without changing the temp password' })
}

resetLocks()
writeFileSync(new URL('../../evidence/p12/auth.json', import.meta.url), JSON.stringify(out, null, 1))
console.log('\nwrote auth.json with', out.length, 'checks')
