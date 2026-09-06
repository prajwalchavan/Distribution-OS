#!/usr/bin/env node
/**
 * Copies IBM Plex Sans (the founder's typeface, 2026-09-05) from the design system into this app's
 * `public/fonts`, which is what an Expo web build serves at `/fonts/…` and what `FONT_CSS` in
 * `@dos/ui/web` points its four `@font-face` rules at.
 *
 * The binaries live once, in `frontend/libs/ui/assets/fonts` (OFL-1.1, licence beside them). Copying
 * rather than importing keeps the woff2 out of the JS bundle: a font that is bundled is downloaded
 * before first paint even when the platform face would have done, and a font served from `public/`
 * is cached by the browser across releases.
 *
 * Runs before `web`, `export:web` and `build`. Idempotent: a file whose size already matches is left
 * alone, so a warm start copies nothing.
 */
import { createRequire } from 'node:module'
import { copyFile, mkdir, stat, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')

/** `@dos/ui` is a workspace link; resolve its package.json to find the assets beside it. */
function kitFontsDir() {
  try {
    return resolve(dirname(require.resolve('@dos/ui/package.json')), 'assets/fonts')
  } catch {
    // Fallback for a checkout where the link is not installed yet.
    return resolve(appRoot, '../../libs/ui/assets/fonts')
  }
}

async function sizeOf(path) {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}

const source = kitFontsDir()
const target = join(appRoot, 'public', 'fonts')

let files
try {
  files = (await readdir(source)).filter((f) => f.endsWith('.woff2'))
} catch {
  console.warn(
    `sync-fonts: no design-system fonts at ${source}; the app will use the platform face`,
  )
  process.exit(0)
}

if (files.length === 0) {
  console.warn('sync-fonts: the design system ships no woff2 yet; using the platform face')
  process.exit(0)
}

await mkdir(target, { recursive: true })
let copied = 0
for (const file of files) {
  const from = join(source, file)
  const to = join(target, file)
  if ((await sizeOf(from)) === (await sizeOf(to))) continue
  await copyFile(from, to)
  copied += 1
}
console.log(
  `sync-fonts: ${String(files.length)} weights in public/fonts (${String(copied)} copied)`,
)
