/**
 * The pull that has to follow a write the next screen reads off this phone (DOS-119).
 *
 * W4 raises a wave online and navigates straight to `/pick/{id}`, and W5 draws everything from the
 * device's own `picklists` and `pick_lines` — so until a pull has run, the sheet the picker is looking
 * at is a wave this phone has never heard of. Measured: PICK-0083 read "Nothing here yet · 0 of 0
 * picked" for 57 s, PICK-0082 for 33 s, with the bottom bar offering "Take it to packing".
 *
 * Asking the engine to pull is the whole fix — but `SyncEngine.sync()` opens with
 * `if (this.pulling || this.ended || !this.started) return` (`@dos/offline` engine.ts), so an ask made
 * while the 60-second poll or an upload tail is already pulling is DROPPED, silently and at random,
 * and the symptom comes straight back. That is DOS-063's finding on the delivery app, proven there
 * against a stand-in engine; the same rule governs every screen that pulls after a write.
 *
 * So the engine is asked ONCE if it was idle, and otherwise asked again as soon as the pull that was
 * in flight finishes — this phone's wave was not in that pull, which started before the wave existed.
 * The wait is bounded and drops its listener on every exit, because the screen that started it has
 * usually navigated away by then and the engine outlives it (the provider is in `app/_layout.tsx`).
 *
 * The engine keeping a `pullAgain` flag of its own is the proper home for this and belongs to
 * `@dos/offline` (DOS-063 merge review, "Defects outside the group"); when it lands this costs one
 * extra pull in the rare mid-flight case, and the picker sees the wave either way.
 */

/**
 * The little of the sync engine a screen needs, narrowed to three calls off `useSyncEngine()` so the
 * rule below can be run against a stand-in under vitest. A screen never reaches past these.
 */
export interface PullableEngine {
  readonly sync: (reason: string) => Promise<void>
  readonly status: () => { readonly pulling: boolean }
  readonly onStatus: (listener: (status: { readonly pulling: boolean }) => void) => () => void
}

/** How long the pull waits behind a pull already running before it gives up. */
export const PULL_WAIT_MS = 20_000

/** What the pull actually managed to do — a word a test can read, not a promise that says nothing. */
export type PullOutcome = 'no-engine' | 'pulled' | 'pulled-after-wait' | 'gave-up'

/** The screen that asked is usually gone by now; a failed pull is the next poll's problem. */
async function swallow(pull: Promise<void>): Promise<void> {
  try {
    await pull
  } catch {
    // The engine has already kept the error for the connection strip (`lastError`).
  }
}

/** Resolves true when the engine is not pulling, false when the wait ran out. Leaves no listener behind. */
function waitForIdle(engine: PullableEngine, waitMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (idle: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (off !== null) off()
      resolve(idle)
    }
    timer = setTimeout(() => {
      finish(false)
    }, waitMs)
    const unsubscribe = engine.onStatus((status) => {
      if (!status.pulling) finish(true)
    })
    if (settled) unsubscribe()
    else off = unsubscribe
    // The pull may have ended between the caller's reading and this subscription.
    if (!engine.status().pulling) finish(true)
  })
}

/** Ask the device to fetch what the office has just been told, and mean it. */
export async function pullAfterWrite(
  engine: PullableEngine | null,
  reason: string,
  waitMs: number = PULL_WAIT_MS,
): Promise<PullOutcome> {
  if (engine === null) return 'no-engine'
  // Read BEFORE the call: if a pull is already running, ours is the one that gets dropped.
  const busy = engine.status().pulling
  await swallow(engine.sync(reason))
  if (!busy) return 'pulled'
  if (!(await waitForIdle(engine, waitMs))) return 'gave-up'
  await swallow(engine.sync(reason))
  return 'pulled-after-wait'
}
