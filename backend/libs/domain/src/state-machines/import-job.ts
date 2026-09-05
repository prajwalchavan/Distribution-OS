import { defineMachine } from './machine.js'

/**
 * The generic importer's job (docs/17 §D7, docs/22 §8 2026-09-04: "upload → preview → map columns →
 * save profile → dry run → commit", and "a migration run must be reversible before it is confirmed").
 *
 *   queued ──stage──▶ staged ──commit──▶ running ──committed──▶ committed ──confirm──▶ confirmed
 *     │                 │                   │                        └────rollback──▶ rolled_back
 *     ├──fail──▶ failed ├──fail──▶ failed   └──fail──▶ failed
 *     └──cancel──▶ cancelled ◀──cancel──┘
 *
 * The states are exactly the values of the shared `job_status` Postgres enum (schema/integrations.ts;
 * `committed`, `confirmed` and `rolled_back` were added for this machine, `succeeded` belongs to
 * export jobs), so `machine.next()` writes straight into `import_jobs.status` — nothing assigns the
 * column by hand (never-list 7).
 *
 * WHO MOVES WHAT. The stage job fires `stage` (rows parsed) or `fail` (the file did not parse); a dry
 * run never changes the status; `imports.commit` fires `commit` and the commit run fires `committed`
 * (some rows may still be `error`) or `fail` (the run itself crashed); the sign-off fires `confirm`;
 * `imports.rollback` fires `rollback` while the run is still reversible; `imports.cancel` fires
 * `cancel` from `queued` / `staged` only — a running commit is never interrupted mid-batch. Every
 * other state is terminal: a rolled-back or failed run starts again with a new job.
 */
export type ImportJobState =
  | 'queued'
  | 'staged'
  | 'running'
  | 'committed'
  | 'confirmed'
  | 'rolled_back'
  | 'failed'
  | 'cancelled'

export type ImportJobEvent =
  'stage' | 'commit' | 'committed' | 'confirm' | 'rollback' | 'fail' | 'cancel'

export const importJobMachine = defineMachine<ImportJobState, ImportJobEvent>({
  name: 'import_job',
  initial: 'queued',
  terminal: ['confirmed', 'rolled_back', 'failed', 'cancelled'],
  transitions: {
    queued: { stage: 'staged', fail: 'failed', cancel: 'cancelled' },
    staged: { commit: 'running', fail: 'failed', cancel: 'cancelled' },
    running: { committed: 'committed', fail: 'failed' },
    committed: { confirm: 'confirmed', rollback: 'rolled_back' },
    confirmed: {},
    rolled_back: {},
    failed: {},
    cancelled: {},
  },
})
