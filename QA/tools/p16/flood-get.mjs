// 500 rapid requests on ONE protected GET with a valid token — is there any throttle/429?
import { fileURLToPath } from 'node:url'; import { writeFileSync } from 'node:fs'
import { http, login } from './lib.mjs'
const EV = fileURLToPath(new URL('../../evidence/p16/', import.meta.url))
const owner = await login('sunil.tarsun')
const N = 500, conc = 50, statuses = {}, msAll = []
const t0 = performance.now()
let i = 0
async function worker() { while (i < N) { i++; const r = await http('GET', '/owner/orders?limit=20', { token: owner.access }); statuses[r.status] = (statuses[r.status] ?? 0) + 1; msAll.push(r.ms) } }
await Promise.all(Array.from({ length: conc }, worker))
const totalMs = Math.round(performance.now() - t0)
msAll.sort((a, b) => a - b)
const out = { N, concurrency: conc, totalMs, rps: Math.round((N / totalMs) * 1000), statuses, latency: { median: msAll[250], p95: msAll[475], max: msAll[499] } }
writeFileSync(`${EV}flood-get.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out))
