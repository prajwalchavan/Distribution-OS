/**
 * DOS-216 (never-list #12) — what the gate-count review may say about one line.
 *
 * The review used to print a green "Saved" against every line the hand had keyed, BEFORE "Save the
 * count" was pressed: the figure lived only in the screen's state and `procurement.grns.count` had not
 * been called. A gate hand who reads "Saved" walks away from a receipt the desk is still waiting on.
 *
 * A line is SAVED only when the server's own copy of it — `grns.get`, or the reply of the count that
 * just succeeded — holds the same good and damaged pieces this screen holds. A keyed figure the server
 * has not acknowledged is NOT SAVED YET, and a line nobody has counted is WAITING. Pure: no React, no
 * kit, no request.
 */

export type LineSaveState = 'waiting' | 'unsaved' | 'saved'

/** The two figures of a `GrnLine` the server acknowledged; `countedQtyPcs` null = never counted. */
export interface AcknowledgedLine {
  countedQtyPcs: number | null
  damagedQtyPcs: number
}

export function lineSaveState(
  keyed: number | undefined,
  keyedDamaged: number | undefined,
  server: AcknowledgedLine | undefined,
): LineSaveState {
  const onServer = server !== undefined && server.countedQtyPcs !== null
  if (keyed === undefined) return onServer ? 'saved' : 'waiting'
  if (!onServer) return 'unsaved'
  return server.countedQtyPcs === keyed && server.damagedQtyPcs === (keyedDamaged ?? 0)
    ? 'saved'
    : 'unsaved'
}

/**
 * The server's copy of each line, newest first: the reply of the count that just succeeded (it is the
 * acknowledgement itself, and arrives before the re-read), else the last `grns.get`.
 */
export function acknowledgedLines(
  fromRead: readonly ({ id: string } & AcknowledgedLine)[] | undefined,
  fromSave: readonly ({ id: string } & AcknowledgedLine)[] | undefined,
): ReadonlyMap<string, AcknowledgedLine> {
  const out = new Map<string, AcknowledgedLine>()
  for (const line of fromRead ?? []) out.set(line.id, line)
  for (const line of fromSave ?? []) out.set(line.id, line)
  return out
}

/** How many keyed lines the server does not hold yet — what the bottom bar warns about. */
export function unsavedCount(
  lineIds: readonly string[],
  keyed: Readonly<Record<string, number>>,
  keyedDamaged: Readonly<Record<string, number>>,
  server: ReadonlyMap<string, AcknowledgedLine>,
): number {
  return lineIds.filter(
    (id) => lineSaveState(keyed[id], keyedDamaged[id], server.get(id)) === 'unsaved',
  ).length
}
