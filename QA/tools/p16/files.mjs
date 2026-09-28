// File & document security against the LOCAL API.
import { fileURLToPath } from 'node:url'; import { writeFileSync } from 'node:fs'
import { http, login, uuidv7, BASE } from './lib.mjs'
const EV = fileURLToPath(new URL('../../evidence/p16/', import.meta.url))
const TARSUN = '01a0999a-28c3-7341-93f5-e0e84b0189a1'
const SAI = '82f5c562-b7eb-7521-8e19-4aa6befc64f8'
const owner = await login('sunil.tarsun')
const T = owner.access
const out = {}

// 1) mint upload-url (logo), upload a tiny PNG, read it back
const fid = uuidv7()
const mint = await http('POST', '/owner/files/upload-url', { token: T, body: { idempotencyKey: 'p16-up-' + Date.now(), id: fid, domain: 'logo', entityId: TARSUN, mimeType: 'image/png', bytes: 70 } })
out.uploadUrl = { status: mint.status, objectKey: mint.json?.objectKey, inline: mint.json?.inline, method: mint.json?.method, urlSigned: /signature=/.test(mint.json?.url ?? '') }
const putUrl = mint.json?.url // relative signed URL
const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c4890000000a49444154789c6360000002000100' + '05fe02fea7', 'hex')
const putRes = await fetch(BASE + putUrl.replace(/^https?:\/\/[^/]+/, ''), { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png })
out.put = { status: putRes.status }
const read = await http('GET', '/owner/files/read-url?objectKey=' + encodeURIComponent(mint.json.objectKey), { token: T })
out.readUrl = { status: read.status, urlSigned: /signature=/.test(read.json?.url ?? ''), returnsRawKey: read.json && !read.json.url }
const relRead = read.json?.url?.replace(/^https?:\/\/[^/]+/, '')
const fetched = await fetch(BASE + relRead)
out.fetch = { status: fetched.status, contentType: fetched.headers.get('content-type'), bytes: (await fetched.arrayBuffer()).byteLength }

// 2) tamper the signed GET url: flip signature, bump/rewind expires
const u = new URL('http://x' + relRead)
const goodSig = u.searchParams.get('signature'); const goodExp = u.searchParams.get('expires')
const badSig = goodSig.slice(0, -2) + (goodSig.endsWith('aa') ? 'bb' : 'aa')
const tamperSig = await fetch(BASE + u.pathname + '?expires=' + goodExp + '&signature=' + badSig)
const noSig = await fetch(BASE + u.pathname)
const pastExp = await fetch(BASE + u.pathname + '?expires=1&signature=' + goodSig)
const bumpExp = await fetch(BASE + u.pathname + '?expires=' + (Number(goodExp) + 99999) + '&signature=' + goodSig)
out.tamper = { badSignature: tamperSig.status, noSignature: noSig.status, expiresInPast: pastExp.status, expiresBumped_sigCoversExpiry: bumpExp.status }

// 3) cross-tenant: tarsun owner asks for a read-url for a SAI-tenant key
const foreignKey = `tenant/${SAI}/logo/${SAI}/${uuidv7()}.png`
const cross = await http('GET', '/owner/files/read-url?objectKey=' + encodeURIComponent(foreignKey), { token: T })
out.crossTenantReadUrl = { status: cross.status, body: cross.text.slice(0, 160) }

// 4) path traversal / weird keys
for (const [tag, key] of [['traversal', `tenant/${TARSUN}/../../etc/passwd`], ['dotdot', `tenant/${TARSUN}/logo/../../../secret`], ['absolute', '/etc/passwd'], ['backslash', `tenant\\${TARSUN}\\logo`], ['bad', 'not-a-key']]) {
  const r = await http('GET', '/owner/files/read-url?objectKey=' + encodeURIComponent(key), { token: T })
  out['key_' + tag] = { status: r.status, body: r.text.slice(0, 120) }
}
// storage controller traversal directly
const st = await fetch(BASE + '/owner/storage/' + encodeURIComponent('../../../../etc/passwd') + '?expires=' + (Math.floor(Date.now()/1000)+900) + '&signature=' + 'x'.repeat(64))
out.storageTraversalNoSig = { status: st.status }

// 5) retailer cross-retailer: ramesh.gupta (tarsun) tries read-url for ANOTHER tarsun retailer's invoice
const ret = await login('ramesh.gupta', { tenantId: TARSUN })
const otherRetInvoiceKey = `tenant/${TARSUN}/invoices/${uuidv7()}/${uuidv7()}.pdf`
const retCross = await http('GET', '/retailer/files/read-url?objectKey=' + encodeURIComponent(otherRetInvoiceKey), { token: ret.access })
out.retailerReadsForeignInvoice = { status: retCross.status, body: retCross.text.slice(0, 160) }

// 6) signed URL survives sign-out? (stateless HMAC) — logout owner, refetch the earlier good read URL
await http('POST', '/auth/auth/logout', { body: { refreshToken: owner.refresh } })
const afterLogout = await fetch(BASE + relRead)
out.signedUrlAfterLogout = { status: afterLogout.status, note: 'signed URLs are stateless; valid until expiry regardless of session' }

writeFileSync(`${EV}files.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1))
