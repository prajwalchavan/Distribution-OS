import type { SyncOp } from '@dos/contracts'
import { pickLines, type Db } from '@dos/db'
import { eq } from 'drizzle-orm'
import { SyncRejection } from '../sync/index.js'
import type { PicklistsService, RecordedPick } from './picklists.service.js'

/**
 * ADR 0007: what a godown phone is allowed to push while it is offline.
 *
 * ONLY `pick_lines`. `picklists`, `pack_confirmations`, `load_sheets` and `delivery_challans` are
 * deliberately NOT registered: packing issues a numbered legal invoice and loading issues a numbered
 * challan, and both take their number from `numbering_series` under a row lock (ADR 0001, docs/20 rule
 * 13). A device cannot hold that lock, so those stay online-only procedures — which is also why nothing
 * here creates a wave: the phone records picks against a sheet the server already raised.
 *
 * EVERY BUSINESS FAULT IS A `SyncRejection` — 2xx plus a `sync_errors` row — never a 4xx that would
 * wedge the device's queue behind an op it can never get past. Replays are handled upstream by
 * `sync_ops(tenant, device, op_id)`; the rules themselves are `PicklistsService.applyPicks`, so an
 * offline pick and an online one cannot drift apart.
 */

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isSafeInteger(n) ? n : null
}

export async function applyPickLineSync(
  tx: Db,
  op: SyncOp,
  picklists: PicklistsService,
): Promise<void> {
  if (op.op !== 'PUT')
    throw new SyncRejection(
      'unsupported_op',
      `pick_lines accepts PUT from a device, not ${op.op}`,
      'डिवाइस से केवल पिक की गई मात्रा भेजी जा सकती है',
    )
  const data = op.data ?? {}
  const picklistId = str(data.picklist_id)
  const orderLineId = str(data.order_line_id)
  const lotId = str(data.lot_id)
  const pickedQtyPcs = int(data.picked_qty_pcs)
  if (!picklistId || !orderLineId || !lotId || pickedQtyPcs === null || pickedQtyPcs < 0)
    throw new SyncRejection(
      'pick_invalid',
      'A pick needs a picklist, an order line, a batch and a whole number of pieces',
      'पिक में पिकलिस्ट, लाइन, बैच और मात्रा ज़रूरी है',
    )

  const sheet = await picklists.findPicklist(tx, picklistId).catch(() => null)
  if (!sheet)
    throw new SyncRejection(
      'picklist_not_found',
      `Picklist ${picklistId} has not arrived on the server yet`,
      `पिकलिस्ट ${picklistId} अभी सर्वर पर नहीं आई`,
    )
  // DOS-040: a wave nobody has started is not closed, it is not open to picks YET. The picker is told
  // to start it (the W5 sheet's Start step, `warehouse.picklists.start`), never that it is "no longer
  // being picked". The handler still accepts only `picking`: starting is an online state-machine step
  // the manager's cancel depends on, so a queued pick must never start a wave by itself.
  const no = sheet.picklistNo ?? sheet.id
  if (sheet.status === 'open')
    throw new SyncRejection(
      'picklist_not_started',
      `Picklist ${no} has not been started; start it before picking`,
      `पिकलिस्ट ${no} अभी शुरू नहीं हुई; पहले पिकिंग शुरू करें`,
    )
  if (sheet.status !== 'picking')
    throw new SyncRejection(
      'picklist_closed',
      `Picklist ${sheet.picklistNo ?? sheet.id} is ${sheet.status}; it is no longer being picked`,
      `पिकलिस्ट ${sheet.picklistNo ?? sheet.id} अब ${sheet.status} है`,
    )

  /*
   * DOS-051 — PIECES LEFT ON THE RACK ARE EXPLAINED, OR THEY ARE NOT RECORDED.
   *
   * The desk reads the short report, rings the supplier and holds a batch on the strength of the
   * reason beside each figure, so a short with no reason is worse than no short at all. W5 used to
   * preselect the first chip and save it for a picker who chose nothing; the screen no longer offers
   * a default, and this is the half of that rule the SERVER owns, because a screen is not a guarantee.
   *
   * The ask is the STORED row's, read the same way `applyPicks` reads it for the over-pick rule
   * (DOS-041): a split row (a new id, recording a second lot for the same line) asks for nothing of
   * its own and is therefore never short. A full pick needs no reason; nothing was left behind.
   */
  const shortReason = str(data.short_reason)
  if (shortReason === null) {
    const [asking] = await tx
      .select({ requestedQtyPcs: pickLines.requestedQtyPcs })
      .from(pickLines)
      .where(eq(pickLines.id, op.id))
    const asked = asking?.requestedQtyPcs ?? 0
    if (asked > 0 && pickedQtyPcs < asked)
      throw new SyncRejection(
        'short_reason_required',
        `${asked - pickedQtyPcs} of ${asked} pcs were left on the rack; say why before saving`,
        `${asked} में से ${asked - pickedQtyPcs} पीस रह गए; कारण बताए बिना सेव नहीं होगा`,
      )
  }

  const pick: RecordedPick = {
    id: op.id,
    orderLineId,
    lotId,
    pickedQtyPcs,
    ...(shortReason === null ? {} : { shortReason }),
  }
  try {
    await picklists.applyPicks(tx, sheet, [pick])
  } catch (error) {
    // A business refusal from the shared rules (over-picked, unknown lot, line not on the sheet) is a
    // rejection the device can show the picker, not a transport failure it should retry for ever.
    const message = error instanceof Error ? error.message : 'The pick was refused'
    if (isBusinessFault(error)) throw new SyncRejection('pick_rejected', message, message)
    throw error
  }
}

/** oRPC's 4xx codes are business faults; anything else is transient and must stay a 5xx. */
function isBusinessFault(error: unknown): boolean {
  const code = (error as { code?: string }).code
  return code === 'BAD_REQUEST' || code === 'CONFLICT' || code === 'NOT_FOUND'
}
