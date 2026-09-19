// DOS-167 S-138 — the instrumentation the permanent gate's VFS invariant is read from (Fable amendment A3,
// 2026-09-19). Promoted unchanged in substance from the diagnosis throwaway
// `QA/evidence/batch2/dos-167/reproof2/diagnose/patch-nm.mjs`; only the paths were generalised, so it patches
// whichever checkout it is run from instead of the worktree the diagnosis happened to live in.
//
// WHY A GATE NEEDS IT. `dos-167-s138-web-store.mjs` must assert AT MOST ONE `AccessHandlePoolVFS` construction and
// ONE WASM init per page load: the pool-header walk alone passes over a latent second VFS, and the concurrency mode
// that destroyed the store fired at delay 0 (`runs/warm-instr.json`: vfsInstances 3, initCREATES 3, pool 12, at no
// injected delay at all). Neither count is observable from outside the library, so the gate runs against a tree whose
// `expo-sqlite/web` prints `DOSDIAG vfs-construct` and `DOSDIAG init-CREATES`.
//
// It writes ONLY into node_modules, keeps the untouched originals beside them, and is reversed with `--restore`.
//
// Usage: node QA/tools/e2e/dos-167-s138-instrument.mjs [--frontend <dir>]
//        node QA/tools/e2e/dos-167-s138-instrument.mjs --restore [--frontend <dir>]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
/** QA/tools/e2e -> the repo root -> the frontend workspace whose node_modules carries expo-sqlite. */
const FRONTEND = resolve(arg('frontend', join(HERE, '..', '..', '..', 'frontend')))
const W = join(FRONTEND, 'node_modules', 'expo-sqlite', 'web')
const B = join(FRONTEND, 'node_modules', '.dos-167-s138-orig')
const files = [
  ['wa-sqlite/AccessHandlePoolVFS.js', 'AccessHandlePoolVFS.js.orig'],
  ['worker.ts', 'worker.ts.orig'],
  ['SQLiteModule.ts', 'SQLiteModule.ts.orig'],
]
const write = (rel, text) => { rmSync(`${W}/${rel}`, { force: true }); writeFileSync(`${W}/${rel}`, text) }
if (!existsSync(W)) throw new Error(`expo-sqlite/web not found under ${W} — pass --frontend <dir>`)
if (process.argv.includes('--restore')) {
  if (!existsSync(B)) throw new Error(`nothing to restore: ${B} does not exist`)
  for (const [rel, orig] of files) write(rel, readFileSync(`${B}/${orig}`, 'utf8'))
  rmSync(B, { recursive: true, force: true })
  console.log(`restored ${W}`)
  process.exit(0)
}
// The originals are taken ONCE, from a tree nobody has patched yet; a second run re-patches from them, never from
// an already-patched file.
if (!existsSync(B)) {
  mkdirSync(B, { recursive: true })
  for (const [rel, orig] of files) cpSync(`${W}/${rel}`, `${B}/${orig}`)
}
const must = (before, after, src, what) => {
  if (!src.includes(before)) throw new Error(`anchor missing: ${what}`)
  return src.replace(before, after)
}

// ---- AccessHandlePoolVFS.js
let v = readFileSync(`${B}/AccessHandlePoolVFS.js.orig`, 'utf8')
v = must(
  `  constructor(name, module) {
    super(name, module);
    this.#directoryPath = name;
  }`,
  `  constructor(name, module) {
    super(name, module);
    this.#directoryPath = name;
    globalThis.__vfsSeq = (globalThis.__vfsSeq ?? 0) + 1;
    this.__id = globalThis.__vfsSeq;
    console.warn('DOSDIAG vfs-construct id=' + this.__id + ' dir=' + name + ' t=' + Math.round(performance.now()));
  }`,
  v, 'vfs constructor')
v = must(
  `      await this.#acquireAccessHandles();
      if (this.getCapacity() === 0) {
        await this.addCapacity(DEFAULT_CAPACITY);
      }`,
  `      console.warn('DOSDIAG vfs-ready-begin id=' + this.__id + ' t=' + Math.round(performance.now()));
      await this.#acquireAccessHandles();
      console.warn('DOSDIAG vfs-acquired id=' + this.__id + ' capacity=' + this.getCapacity() + ' size=' + this.getSize() + ' paths=' + JSON.stringify([...this.__paths()]) + ' t=' + Math.round(performance.now()));
      if (this.getCapacity() === 0) {
        await this.addCapacity(DEFAULT_CAPACITY);
        console.warn('DOSDIAG vfs-addcapacity id=' + this.__id + ' capacity=' + this.getCapacity() + ' t=' + Math.round(performance.now()));
      }`,
  v, 'isReady')
v = must(
  `  jOpen(zName, fileId, flags, pOutFlags) {
    try {`,
  `  __paths() { return this.#mapPathToAccessHandle.keys(); }

  jOpen(zName, fileId, flags, pOutFlags) {
    console.warn('DOSDIAG jOpen id=' + this.__id + ' zName=' + JSON.stringify(zName) + ' flags=0x' + flags.toString(16) + ' size=' + this.getSize() + '/' + this.getCapacity() + ' t=' + Math.round(performance.now()));
    try {`,
  v, 'jOpen head')
v = must(
      `    } catch (e) {
      console.error(e.message);
      return VFS.SQLITE_CANTOPEN;
    }`,
      `    } catch (e) {
      console.error('DOSDIAG jOpen-FAILED id=' + this.__id + ' zName=' + JSON.stringify(zName) + ' flags=0x' + flags.toString(16) + ' size=' + this.getSize() + '/' + this.getCapacity() + ': ' + e.message);
      return VFS.SQLITE_CANTOPEN;
    }`,
  v, 'jOpen catch')
v = must(
  `  #setAssociatedPath(accessHandle, path, flags) {`,
  `  #setAssociatedPath(accessHandle, path, flags) {
    console.warn('DOSDIAG setPath id=' + this.__id + ' name=' + this.#mapAccessHandleToName.get(accessHandle) + ' path=' + JSON.stringify(path) + ' flags=0x' + flags.toString(16) + ' t=' + Math.round(performance.now()));`,
  v, 'setAssociatedPath')
v = must(
  `  jDelete(zName, syncDir) {
    const path = this.#getPath(zName);`,
  `  jDelete(zName, syncDir) {
    const path = this.#getPath(zName);
    console.warn('DOSDIAG jDelete id=' + this.__id + ' zName=' + JSON.stringify(zName) + ' path=' + JSON.stringify(path) + ' known=' + this.#mapPathToAccessHandle.has(path) + ' t=' + Math.round(performance.now()));`,
  v, 'jDelete')
write('wa-sqlite/AccessHandlePoolVFS.js', v)

// ---- worker.ts
let w = readFileSync(`${B}/worker.ts.orig`, 'utf8')
w = must(
  `async function maybeInitAsync(): Promise<{`,
  `let __initCalls = 0;
async function maybeInitAsync(): Promise<{`,
  w, 'init counter')
w = must(
  `  if (!_sqlite3) {
    const module = await WaSQLiteFactory({`,
  `  const __call = ++__initCalls;
  console.warn('DOSDIAG init-enter call=' + __call + ' sqlite3=' + !!_sqlite3 + ' vfs=' + !!_vfs + ' t=' + Math.round(performance.now()));
  if (!_sqlite3) {
    console.warn('DOSDIAG init-CREATES call=' + __call + ' t=' + Math.round(performance.now()));
    const module = await WaSQLiteFactory({`,
  w, 'init enter')
w = must(
  `  if (_vfs == null || _vfsMemory == null) {
    throw new Error('Invalid VFS state');
  }
  return { sqlite3: _sqlite3, vfs: _vfs, vfsMemory: _vfsMemory };`,
  `  if (_vfs == null || _vfsMemory == null) {
    throw new Error('Invalid VFS state');
  }
  console.warn('DOSDIAG init-return call=' + __call + ' vfsId=' + (_vfs as any).__id + ' t=' + Math.round(performance.now()));
  return { sqlite3: _sqlite3, vfs: _vfs, vfsMemory: _vfsMemory };`,
  w, 'init return')
w = must(
  `self.onmessage = async (event: MessageEvent<SQLiteWorkerMessage>) => {`,
  `self.onmessage = async (event: MessageEvent<SQLiteWorkerMessage>) => {
  console.warn('DOSDIAG msg type=' + (event.data as any).type + ' path=' + JSON.stringify((event.data as any).data?.databasePath ?? null) + ' id=' + (event.data as any).id + ' t=' + Math.round(performance.now()));`,
  w, 'onmessage')
write('worker.ts', w)

// ---- SQLiteModule.ts (main thread): when each open/delete is issued
let m = readFileSync(`${B}/SQLiteModule.ts.orig`, 'utf8')
m = must(
  `  async initAsync(): Promise<void> {
    await invokeWorkerAsync(getWorker(), 'open', {`,
  `  async initAsync(): Promise<void> {
    console.warn('DOSDIAG main-open path=' + JSON.stringify(this.databasePath) + ' t=' + Math.round(performance.now()));
    await invokeWorkerAsync(getWorker(), 'open', {`,
  m, 'initAsync')
m = must(
  `function getWorker(): Worker {
  if (!worker) {`,
  `function getWorker(): Worker {
  if (!worker) {
    console.warn('DOSDIAG main-worker-create t=' + Math.round(performance.now()));`,
  m, 'getWorker')
write('SQLiteModule.ts', m)
console.log(`patched ${W} (originals in ${B})`)
