// Unauthenticated amplification: N concurrent GET /owner/docs/openapi.json?fresh=1 while a signed-in
// owner reads /owner/orders. Records the owner's latency with and without the flood.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { http, login } from './lib.mjs'
const EV = fileURLToPath(new URL('../../evidence/p16/', import.meta.url))
const N = Number(process.argv[2] ?? 100)
const owner = await login('sunil.tarsun')
const probe = async () => { const r = await http('GET', '/owner/orders?limit=20', { token: owner.access }); return [r.status, r.ms] }
const base = []; for (let i = 0; i < 5; i++) base.push(await probe())
const t0 = performance.now()
const flood = Array.from({ length: N }, () => http('GET', '/owner/docs/openapi.json?fresh=1').then((r) => r.status))
const during = []; for (let i = 0; i < 5; i++) during.push(await probe())
const statuses = await Promise.all(flood)
const floodMs = Math.round(performance.now() - t0)
const hist = {}; for (const s of statuses) hist[s] = (hist[s] ?? 0) + 1
const rss = null
const out = { N, floodMs, floodStatuses: hist, ownerOrdersBaseline: base, ownerOrdersDuringFlood: during }
writeFileSync(`${EV}docs-fresh-flood.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out))
