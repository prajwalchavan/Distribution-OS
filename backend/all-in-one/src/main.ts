import { runAll } from '@dos/core'

/**
 * ALL-IN-ONE: one process, all eight services, optionally the worker (founder 2026-09-05, docs/26 §7).
 *
 *   pnpm --filter @dos/all-in-one dev        # :3100, /auth /owner /manager /sales /warehouse
 *                                            #        /delivery /retailer /admin
 *   DOS_MODE=all WORKER_INLINE=1 pnpm --filter @dos/all-in-one start
 *
 * The compositions come from `@dos/core` — the same objects `<name>-service/src/service.ts` exports —
 * so a role refused on :3001 is refused at `/owner` here, by the same guard reading the same
 * definition.
 */

/**
 * The worker's entry, as a value and not a literal on purpose. The worker imports `@dos/core`, so the
 * library cannot import the worker; this package is where the two meet, and it meets it at RUNTIME
 * only — `backend/worker` emits JavaScript without declarations, and a literal specifier would drag
 * its types into this build for no benefit. The import is a side effect: the worker's `main.ts` starts
 * pg-boss and its queues as soon as it is evaluated.
 */
const WORKER_ENTRY: string = '@dos/worker/dist/main.js'

await runAll({
  worker: async () => {
    await import(WORKER_ENTRY)
  },
})
