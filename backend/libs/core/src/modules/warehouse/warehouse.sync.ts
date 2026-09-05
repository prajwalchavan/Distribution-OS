import type { SyncOp } from '@dos/contracts'
import type { Db } from '@dos/db'
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
  if (sheet.status !== 'picking')
    throw new SyncRejection(
      'picklist_closed',
      `Picklist ${sheet.picklistNo ?? sheet.id} is ${sheet.status}; it is no longer being picked`,
      `पिकलिस्ट ${sheet.picklistNo ?? sheet.id} अब ${sheet.status} है`,
    )

  const pick: RecordedPick = {
    id: op.id,
    orderLineId,
    lotId,
    pickedQtyPcs,
    ...(str(data.short_reason) ? { shortReason: str(data.short_reason) as string } : {}),
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
