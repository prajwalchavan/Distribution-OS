/**
 * W5's one question: may this sheet be picked right now, and if not, why not.
 *
 * Pure, and the only place the answer is decided.
 */

/**
 * `waiting` — the device has not answered about this sheet: no rows to act on, no actions in the bar,
 *   no sentence claiming either way.
 * `not-started` — the device HOLDS the sheet and it reads `open`. Starting moves every order
 *   `confirmed -> picking` and takes away the manager's cancel, so it is an online call and the only
 *   action on offer; a pick here could only ever be refused, so it is never queued (DOS-040).
 * `pickable` — the device holds the sheet and it is past `open`: the picker may work, with or without
 *   a signal.
 */
export type PickGate = 'waiting' | 'not-started' | 'pickable'

export function pickGate(input: {
  /** The status `picklists.start` answered for THIS sheet, when it has answered. */
  startedHere: string | undefined
  /** The device's own `picklists` row: its status, or null when the device holds no such row. */
  deviceStatus: string | null | undefined
}): PickGate {
  /*
   * DOS-120's precedence, and it lives HERE: the Start reply wins until the next pull repaints the
   * local row, because `engine.sync` returns early while a pull is already running and the local
   * `picklists` row can still read `open` after a start that succeeded.
   */
  const status = input.startedHere ?? input.deviceStatus ?? undefined

  /*
   * DOS-182 — ABSENCE IS NOT A STATUS, AND IT IS NOT A LICENCE EITHER.
   *
   * The first fix read "no sheet row but lines on the device" as `pickable`, on the theory that a
   * phone holding a wave's lines must be holding the wave. It is the wrong way round. `sync.pull`
   * cuts ONE page set at a single instant across every table (`sync.service.ts` `pull()`: one `until`
   * bound, one `cut`), so a pass that FINISHED — `hasMore === false`, cursor at `asOf` — has handed
   * over everything up to that instant, header and lines together. Lines with no header therefore
   * mean one thing: the pass is still running, which is exactly when the sheet on this phone may
   * still be INCOMPLETE. Calling that `pickable` hands the picker a half-read sheet and, worse, lets
   * W5's `left === 0` enable "Take it to packing" over lines that have not landed yet — a wave
   * confirmed into packing short of rows nobody has seen.
   *
   * So an unknown status is `waiting` — the honest answer, and the only safe one. What the device
   * KNOWS still wins and still needs no signal to know it; the measured 5 min 48 s of DOS-182 was
   * never this branch (the phone HELD the row as `picking`), it was two standing sentences pushing
   * the first card's Picked / Short under the sticky bar. That is fixed in the screen, where it lives.
   */
  if (status === undefined) return 'waiting'
  return status === 'open' ? 'not-started' : 'pickable'
}
