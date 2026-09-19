/**
 * W5's one question: may this sheet be picked right now, and if not, why not.
 *
 * Pure, and the only place the answer is decided.
 */

/**
 * `waiting` — the device has not answered about this sheet yet: no rows, no actions, no sentence
 *   claiming either way.
 * `not-started` — the device HOLDS the sheet and it reads `open`. Starting moves every order
 *   `confirmed -> picking` and takes away the manager's cancel, so it is an online call and the only
 *   action on offer; a pick here could only ever be refused, so it is never queued (DOS-040).
 * `pickable` — the wave is on this phone and the picker may work.
 */
export type PickGate = 'waiting' | 'not-started' | 'pickable'

export function pickGate(input: {
  /** The status `picklists.start` answered for THIS sheet, when it has answered. */
  startedHere: string | undefined
  /** The device's own `picklists` row: its status, or null when the device holds no such row. */
  deviceStatus: string | null | undefined
  /** True while the device's own reads of `picklists` and `pick_lines` have not answered yet. */
  reading: boolean
  /** How many of this wave's lines the device is holding. */
  linesOnDevice: number
}): PickGate {
  const status = input.startedHere ?? input.deviceStatus ?? undefined
  // What the device KNOWS wins, and it needs no signal to know it.
  if (status !== undefined) return status === 'open' ? 'not-started' : 'pickable'
  /*
   * DOS-182 — ABSENCE IS NOT A STATUS.
   *
   * `picklists` and `pick_lines` are separate pages of one pull, so a phone can hold a wave's LINES
   * with no sheet row to go with them — and until DOS-182 that absence was read as "not started" and
   * locked every row. Measured on a Pixel 7 with the office away: 5 min 48 s with the work in hand,
   * unlocked seconds after the signal came back.
   *
   * So the two unknowns are told apart. Still reading: nothing is claimed either way. Read, and the
   * wave's lines are here: the picker picks, which is what the offline copy is for — the picks land in
   * the local table and drain through the outbox, and if the sheet really was still `open`, the server
   * refuses them into the attention tray (2xx + `sync_errors`, ADR 0007), which is exactly the path a
   * refused pick already takes. Locking a picker out of work the device is holding is the worse
   * failure, and the screen says whose word the wave is being picked on.
   */
  if (input.reading) return 'waiting'
  return input.linesOnDevice > 0 ? 'pickable' : 'waiting'
}
