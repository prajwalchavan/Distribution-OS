const fs = require('node:fs')
const path = require('node:path')

const { getDefaultConfig } = require('expo/metro-config')

/**
 * Metro for a Distribution OS app (docs/08 §0).
 *
 * Three things are not the default:
 *
 * 1. **Two workspaces, one repo.** The app lives in `frontend/`, but `@dos/contracts` and
 *    `@dos/domain` are `link:`ed from `backend/libs` — a symlink, never a copy — so Metro has to
 *    watch that folder as well or an edit to the contract never reaches the bundle.
 * 2. **The lookup paths are pinned.** A linked backend package resolving `zod` would otherwise walk
 *    up to `backend/node_modules` and pull a SECOND copy into the bundle. `disableHierarchicalLookup`
 *    plus an explicit `nodeModulesPaths` makes every import — the app's, the kit's and the linked
 *    contract's — resolve out of the frontend's own hoisted `node_modules`.
 * 3. **Package exports are on**, which is how `@dos/ui` swaps renderers: the `browser` condition
 *    picks `src/index.web.ts` (real DOM) and `react-native` picks `src/index.native.ts`.
 */
const projectRoot = __dirname

/**
 * Walk up to the workspace root rather than counting `..` segments: the template lives at
 * `frontend/libs/app-template` and a generated app at `frontend/<role>-app`, one level shallower, and
 * a hard-coded `../..` would silently point a generated app at the wrong tree.
 */
function findFrontendRoot(from) {
  let dir = from
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('metro.config.js: no pnpm-workspace.yaml above ' + from)
    dir = parent
  }
}

const frontendRoot = findFrontendRoot(projectRoot)
const repoRoot = path.resolve(frontendRoot, '..')
const backendLibs = path.join(repoRoot, 'backend', 'libs')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [frontendRoot, backendLibs]

config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(frontendRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true
config.resolver.unstable_enablePackageExports = true

/**
 * 3b. **`.wasm` is an asset.**
 *
 * Any app that declares `expo-sqlite` (every app that uses `@dos/offline` must, or autolinking never
 * links it and the offline store silently falls back to memory) gets wa-sqlite on the web, and
 * `expo-sqlite/web/worker.ts` does `import wasmModule from './wa-sqlite/wa-sqlite.wasm'` — which
 * Metro cannot resolve, because `wasm` is in neither `sourceExts` nor `assetExts` by default. The
 * bundle fails outright: "None of these files exist: ... wa-sqlite.wasm".
 *
 * Adding the extension to `assetExts` is the whole fix: the file is copied and handed to the worker
 * as a URL, which is exactly what wa-sqlite wants.
 */
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts = [...config.resolver.assetExts, 'wasm']
}

/**
 * 4. **`./thing.js` may mean `./thing.ts`.**
 *
 * Every workspace package here is consumed as TypeScript SOURCE, and the repo writes relative imports
 * the way Node's ESM resolver wants them — `import { QueryCache } from '../cache.js'` — because the
 * backend emits real `.js` and the two workspaces share one convention. `tsc` and Vite rewrite that
 * specifier to the `.ts` file; Metro does not, and answers "None of these files exist: ../cache.js".
 *
 * So: for a RELATIVE `.js` specifier, try the extensionless form first (which lets Metro's own
 * platform-extension search find `.ts`, `.tsx`, `.web.ts` or `.native.ts`), and fall back to the
 * literal name for a specifier that really is a `.js` file. Anything resolving to the importer itself
 * is rejected — that is what a platform variant beside its shared barrel would do, and a barrel that
 * imports itself is a stack overflow at start-up rather than an error anyone can read.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const relative = moduleName.startsWith('./') || moduleName.startsWith('../')
  if (relative && moduleName.endsWith('.js')) {
    try {
      const resolution = context.resolveRequest(context, moduleName.slice(0, -3), platform)
      if (resolution.type !== 'sourceFile' || resolution.filePath !== context.originModulePath) {
        return resolution
      }
    } catch {
      // Not a TypeScript source under another extension; fall through to the literal specifier.
    }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
