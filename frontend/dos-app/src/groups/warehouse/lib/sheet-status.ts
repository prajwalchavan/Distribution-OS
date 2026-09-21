/**
 * What W5's header says this sheet is — one question, one place (the shape `pick-gate.ts` uses).
 *
 * DOS-120. The screen used to read `startedHere ?? sheet.status`, and that kept the Start reply for as
 * long as the screen stayed mounted: PICK-0083 was closed by the server (`status picked`), the pull
 * brought that back, and for all 13 s sampled the chip still said `picking` beside "7 of 7 picked"
 * and an enabled "Take it to packing". It read `picked` only after navigating away and back. The
 * smaller instance of the "three truths on one sheet" problem DOS-042 fixed.
 *
 * The Start reply is a STAND-IN, not a second truth. `warehouse.picklists.start` answers before any
 * pull has repainted the device's own row — and `SyncEngine.sync()` returns early while a pull is
 * already running, so that row can still read `open` for a while after a start that succeeded. A
 * stand-in is consulted while the thing it stands in for has not spoken (`open`, or no row at all)
 * and never after it has.
 */
export function sheetStatus(input: {
  /** The status `warehouse.picklists.start` answered for THIS sheet, when it has answered. */
  startedHere: string | undefined
  /** The device's own `picklists` row: its status, or null/undefined when the device holds no row. */
  deviceStatus: string | null | undefined
}): string | undefined {
  const device = input.deviceStatus ?? undefined
  if (device === undefined || device === 'open') return input.startedHere ?? device
  return device
}
