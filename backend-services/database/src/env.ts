import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { config } from 'dotenv'

/**
 * Loads the repo-root `.env` no matter which package the script runs from (pnpm --filter sets cwd to the
 * package). Real environment variables always win over the file. Safe to call more than once.
 */
export function loadDotenv(startDir: string = process.cwd()): string | null {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) {
      config({ path: candidate, override: false, quiet: true })
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
