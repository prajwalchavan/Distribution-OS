// DOS-167 / S-138 — THE PASS CONDITION of the permanent web-store gate, on its own so it can be imported.
//
// It was inside `dos-167-s138-web-store.mjs`, exported but unreachable: that file's top-level
// `await import('playwright')` runs on import, so anything that pulled it in for `verdict()` alone died with
// ERR_MODULE_NOT_FOUND (review finding, 2026-09-19). A pass condition nobody can unit-test is a pass condition
// nobody checks, and the counter below had two blind spots that exactly such a test would have caught. It now has
// no imports beyond `node:fs`, no side effects and no CLI: `import { verdict } from './dos-167-s138-verdict.mjs'`
// is safe anywhere, and `dos-167-s138-web-store.mjs --selfcheck` exercises it against both the ruling's recorded
// runs and synthetic console lists.
import { readFileSync } from 'node:fs'

/**
 * The two counts amendment A3 demands, read off the instrumented library's own console lines.
 *
 * COUNTING RULE, and why it is not the obvious one. Playwright reports a worker's console on BOTH the worker and
 * the page, so one construction arrives twice as the SAME text: distinct LINES are counted, which collapses the
 * echo. What is NOT counted is the `id=` inside the line. `id` comes from `globalThis.__vfsSeq`, a WORKER-scoped
 * counter, so a VFS built in a second worker also calls itself id=1; a set of ids silently reported two
 * constructions as one — the latent second VFS A3 exists to catch. Each construction carries its own `t=`, so its
 * line is its own; and `workers` is counted beside it, because a second SQLite worker is a second `__vfsSeq`
 * namespace and is by itself the hazard. (`dos-167-s138-instrument.mjs` now also stamps a per-worker tag into the
 * id, so runs recorded from here on are unambiguous either way; this parser reads both forms.)
 *
 * INSTRUMENTED means the counts can be asserted at all, and is anchored on `init-enter` — the line the worker
 * patch emits on EVERY maybeInitAsync call, whether or not anything is created. `any DOSDIAG line` was too weak:
 * a worker-only `DOSDIAG msg` line made `vfsInstances: 0` read as "asserted and satisfied" rather than
 * "unassertable".
 */
export function countInstrumentation(events = []) {
  const lines = new Set()
  for (const event of events) {
    const text = typeof event?.text === 'string' ? event.text : ''
    if (text.startsWith('DOSDIAG')) lines.add(text)
  }
  const distinct = (pattern) => [...lines].filter((line) => pattern.test(line)).length
  return {
    instrumented: distinct(/^DOSDIAG init-enter /) > 0,
    vfsInstances: distinct(/^DOSDIAG vfs-construct /),
    initCREATES: distinct(/^DOSDIAG init-CREATES /),
    workers: distinct(/^DOSDIAG main-worker-create /),
  }
}

/** The whole pass condition in one place, so `--verdict` judges a recorded run by exactly the rule a live run is judged by. */
export function verdict(result) {
  const counts = result.instrumentation ?? countInstrumentation(result.events)
  const headers = result.headers ?? []
  const wanted = result.wantedHeader
  const orphans = headers.filter((header) => /^0\./.test(header) || /-wal$/.test(header))
  const reasons = []
  if (result.crossOriginIsolated !== true) reasons.push(`not cross-origin isolated (${result.crossOriginIsolated})`)
  if (!headers.includes(wanted)) reasons.push(`this person's pool header ${wanted} is missing: ${JSON.stringify(headers)}`)
  if (headers.length !== 1) reasons.push(`the pool holds ${headers.length} named files, not one: ${JSON.stringify(headers)}`)
  if (orphans.length > 0) reasons.push(`orphan pool files that no VFS ever reclaims: ${JSON.stringify(orphans)}`)
  if (!(result.manifestCalls > 0)) reasons.push('no sync.manifest call')
  if (!(result.pullCalls > 0)) reasons.push('no sync.pull call')
  if (result.notADatabase !== 0) reasons.push(`${result.notADatabase} x "not a database"`)
  if (result.cannotCreate !== 0) reasons.push(`${result.cannotCreate} x "cannot create file"`)
  if (result.beatFinal?.notPersisted !== false) reasons.push('the "will not keep the offline copy" line is still on the screen')
  // Amendment A3: the CAUSE, not only the damage.
  if (!counts.instrumented)
    reasons.push('not instrumented: vfsInstances/initCREATES cannot be asserted (no DOSDIAG init-enter line — run dos-167-s138-instrument.mjs first)')
  if (counts.vfsInstances > 1) reasons.push(`vfsInstances ${counts.vfsInstances} > 1: concurrent opens each built their own VFS`)
  if (counts.initCREATES > 1) reasons.push(`initCREATES ${counts.initCREATES} > 1: concurrent opens each built their own WASM module`)
  if (counts.workers > 1)
    reasons.push(`workers ${counts.workers} > 1: a second SQLite worker is a second __vfsSeq namespace, where a second VFS counts itself id=1`)
  if (counts.instrumented && counts.initCREATES > 0 && counts.vfsInstances === 0)
    reasons.push(`the VFS module is not instrumented: ${counts.initCREATES} WASM init(s) created a VFS that logged no construction`)
  return { pass: reasons.length === 0, reasons, ...counts }
}

/** Judge one recorded run file and print the one-line result the gate prints for a live run. */
export function judge(file) {
  const result = JSON.parse(readFileSync(file, 'utf8'))
  const v = verdict(result)
  console.log(
    `[${result.label}] pass=${v.pass} vfsInstances=${v.vfsInstances} initCREATES=${v.initCREATES} workers=${v.workers} instrumented=${v.instrumented} pool=${result.poolFiles}`,
  )
  for (const reason of v.reasons) console.log(`   - ${reason}`)
  return v
}
