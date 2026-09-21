import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the deployment plumbing lives, resolved from this file rather than from `process.cwd()`:
 * these specs are run both as `pnpm --filter @dos/all-in-one test` (cwd = backend/all-in-one) and as
 * a single file from the backend root, and a deploy artifact that only exists relative to one of
 * those is not an artifact anyone can ship.
 */
const here = dirname(fileURLToPath(import.meta.url))

/** `backend/all-in-one/src/deploy` -> `backend` */
export const BACKEND_ROOT = resolve(here, '../../..')
/** `backend` -> the repository root (holds `docs/`, `frontend/`, `.github/`). */
export const REPO_ROOT = resolve(BACKEND_ROOT, '..')

export const INFRA_DIR = resolve(BACKEND_ROOT, 'infra')

/** Reads a deploy artifact as text. Throws with the absolute path when it does not exist yet. */
export function readArtifact(...segments: string[]): string {
  const path = resolve(REPO_ROOT, ...segments)
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw new Error(`deploy artifact missing: ${path}`)
  }
}
