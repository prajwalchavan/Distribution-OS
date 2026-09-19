// NOTE (cleanup): variant.mjs needs react.tsx.dosbak / open.web.ts.dosbak beside the sources; re-create them with
//   cp libs/offline/src/react.tsx libs/offline/src/react.tsx.dosbak (same for store/open.web.ts) before re-running.
// diag.mjs needs a node_modules symlink beside it: ln -s ../../../../../tools/node_modules node_modules
// TEMPORARY, UNCOMMITTED edits in the worktree for the S-138 bisect. `node variant.mjs none` restores.
import { readFileSync, writeFileSync } from 'node:fs'
const W = '/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/b2-dos167r3/frontend/libs/offline/src'
const REACT = `${W}/react.tsx`
const OPEN = `${W}/store/open.web.ts`
const base = {
  react: readFileSync(`${REACT}.dosbak`, 'utf8'),
  open: readFileSync(`${OPEN}.dosbak`, 'utf8'),
}
const v = process.argv[2]
let react = base.react
let open = base.open

const KILL_LEGACY = ['  useEffect(() => {\n    if (storePrefix === undefined) return\n    let legacy: string',
                     '  useEffect(() => {\n    if (storePrefix === undefined) return\n    if (1 > 0) return // DOSDIAG variant: legacy destroy disabled\n    let legacy: string']
const KILL_INTERIM = ['    if (storePrefix === undefined || identity === null || idKey === null) return\n    if (sweptInterim.current.has(idKey)) return',
                      '    if (storePrefix === undefined || identity === null || idKey === null) return\n    if (1 > 0) return // DOSDIAG variant: interim sweep disabled\n    if (sweptInterim.current.has(idKey)) return']
const SERIALIZE = [
`export async function openStore(name: string): Promise<SyncStore> {
  const missing = whyNoOpfs()`,
`let openChain: Promise<unknown> = Promise.resolve()

export async function openStore(name: string): Promise<SyncStore> {
  const mine = openChain.then(
    () => openStoreInner(name),
    () => openStoreInner(name),
  )
  openChain = mine.then(
    () => undefined,
    () => undefined,
  )
  return mine
}

async function openStoreInner(name: string): Promise<SyncStore> {
  const missing = whyNoOpfs()`]

const apply = (src, [a, b], what) => {
  if (!src.includes(a)) throw new Error(`anchor missing: ${what}`)
  return src.replace(a, b)
}
if (v === 'A' || v === 'C') react = apply(react, KILL_LEGACY, 'legacy')
if (v === 'B' || v === 'C') react = apply(react, KILL_INTERIM, 'interim')
if (v === 'D') open = apply(open, SERIALIZE, 'serialize')
writeFileSync(REACT, react)
writeFileSync(OPEN, open)
console.log(`variant ${v}: react ${react.length} bytes (changed=${react !== base.react}), open ${open.length} bytes (changed=${open !== base.open})`)
