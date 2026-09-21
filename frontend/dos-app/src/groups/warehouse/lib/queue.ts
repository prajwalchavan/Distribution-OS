/**
 * Putting a pick into the outbox — the write path with no signal.
 *
 * `backend/libs/core/src/modules/warehouse/warehouse.sync.ts` decides exactly what a godown phone may
 * push, and this file sends that and nothing else:
 *
 *   `pick_lines`   picklist_id · order_line_id · lot_id · picked_qty_pcs · short_reason
 *
 * NO STATE, NO LEDGER ROW, NO INVOICE. Picking is paper: the pieces leave the rack at PACK, so a
 * half-picked wave abandoned at six in the evening leaves the stock ledger untouched, and a phone
 * that has been in a dead corner for an hour cannot have moved anything it should not have. The
 * server re-applies the same `PicklistsService.applyPicks` rules an online pick goes through, so an
 * offline pick and an online one cannot drift apart; a business refusal comes back as a rejection in
 * the tray, never as a 4xx that would wedge the queue behind an op it can never get past.
 *
 * `enqueue` also writes the row into the device's own `pick_lines` table, so the sheet repaints on
 * the instant — UX-00 §9.4: "every tap persists on the instant; there is no Save step".
 */
import { useOutbox } from '@dos/offline/react'
import { useCallback } from 'react'

import type { LocalPickLine } from './local'

export interface RecordPickInput {
  line: LocalPickLine
  pickedQtyPcs: number
  shortReason?: string | null
}

/**
 * The `updated_at` the device holds, as an instant `sync.upload` will actually accept.
 *
 * THIS IS NOT A TIDY-UP. `sync.pull` hands a device Postgres's own text form —
 * `2026-09-05 07:12:11.711714+05:30`, a SPACE where ISO-8601 puts a `T` — and `SyncOpSchema.baseUpdatedAt`
 * is `z.iso.datetime({ offset: true })`, which refuses it. So a device echoing back the timestamp it was
 * given gets **400 `Input validation failed … ops.0.baseUpdatedAt`**, and a 400 is the one answer
 * `/sync/upload` must never give (ADR 0007): the outbox releases the batch, retries the same op for
 * ever, and every write queued behind it is stuck too. Measured on this app: one pick recorded in a
 * dead spot, nine upload attempts, "1 waiting to send" still on screen sixty seconds after the signal
 * came back, and `pick_lines.picked_qty_pcs` still 0 on the server.
 *
 * Converting through `Date` keeps the same INSTANT — which is all the last-writer-wins veto compares —
 * and gives the schema the shape it asks for. The mismatch itself is a backend item (see the slice
 * report): the two halves of one protocol disagree about a format, and the frontend cannot be the
 * only place that knows.
 */
function isoInstant(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const ms = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'))
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

export function useRecordPick(): (input: RecordPickInput) => Promise<void> {
  const outbox = useOutbox()
  return useCallback(
    async ({ line, pickedQtyPcs, shortReason }: RecordPickInput) => {
      if (line.lot_id === null) return
      const base = isoInstant(line.updated_at)
      await outbox.enqueue({
        table: 'pick_lines',
        id: line.id,
        op: 'PUT',
        ...(base === undefined ? {} : { baseUpdatedAt: base }),
        data: {
          picklist_id: line.picklist_id,
          order_id: line.order_id,
          order_line_id: line.order_line_id,
          variant_id: line.variant_id,
          line_no: line.line_no,
          lot_id: line.lot_id,
          requested_qty_pcs: line.requested_qty_pcs,
          picked_qty_pcs: Math.max(0, Math.trunc(pickedQtyPcs)),
          free_qty_pcs: line.free_qty_pcs,
          case_size: line.case_size,
          short_reason: shortReason === undefined ? line.short_reason : shortReason,
        },
      })
    },
    [outbox],
  )
}
