import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The text of the customer-master PDF in layout mode.
 *
 * Node has no PDF text extractor in this repository (the only PDF code is the invoice WRITER in
 * `@dos/core/documents`), and a Crystal-report PDF keeps its text in font-subset streams that a small
 * hand-written reader cannot decode honestly. So the importer shells out to `pdf-to-text.py` (pypdf), the
 * one place a PDF is opened; a `.txt` produced by that script — or any layout-mode text — is read as is.
 * Set `LEGACY_PYTHON` to a specific interpreter (a venv with pypdf) when `python3` lacks it.
 */
export function readCustomerMasterText(path: string): string {
  if (!/\.pdf$/i.test(path)) return readFileSync(path, 'utf8')
  const script = resolve(dirname(fileURLToPath(import.meta.url)), 'pdf-to-text.py')
  const python = process.env.LEGACY_PYTHON ?? 'python3'
  const run = spawnSync(python, [script, path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (run.error) throw new Error(`cannot run ${python}: ${run.error.message}`)
  if (run.status !== 0)
    throw new Error(
      `reading the customer PDF failed (exit ${String(run.status)}): ${run.stderr.trim().split('\n').slice(-1)[0] ?? ''}`,
    )
  return run.stdout
}
