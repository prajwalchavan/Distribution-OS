/**
 * The doorstep writes lifted out of D3, D4 and D5 (founder, 2026-09-28): the home's one-tap buttons
 * write exactly what those screens write, because both call these functions. These tests pin the
 * payloads field by field, and pin the one claim the home rests on — "Delivered, all items" is the
 * same write as opening D4 and pressing record without touching a line.
 */
import { describe, expect, it } from 'vitest'

import {
  arrivalFix,
  arrivalGeoProof,
  billedPieces,
  collectionRecordInput,
  deliveryLinePayload,
  deliveryRecordInput,
  moneyNeedsReference,
  podWire,
  queuedDelivery,
  queuedReceipt,
  receiptNumber,
  type DoorLineEntry,
  type DoorMoney,
} from './door-writes'
import type { LocalDelivery, LocalInvoiceLine } from './local'

/** Ids handed out in order, so a payload can be compared whole. */
function ids(prefix: string): () => string {
  let n = 0
  return () => {
    n += 1
    return `${prefix}-${String(n)}`
  }
}

const line = (id: string, qty: number, free = 0): LocalInvoiceLine => ({
  id,
  invoice_id: 'inv-1',
  line_no: 1,
  variant_id: 'v-1',
  lot_id: null,
  description: `Item ${id}`,
  batch_no: null,
  expiry_date: null,
  mrp_paise: null,
  qty_pcs: qty,
  free_qty_pcs: free,
  case_size: 12,
  rate_paise: 1000,
  line_total_paise: qty * 1000,
})

const delivery: LocalDelivery = {
  id: 'del-1',
  trip_id: 'trip-1',
  stop_id: 'stop-1',
  retailer_id: 'shop-1',
  order_id: 'order-1',
  invoice_id: 'inv-1',
  outcome: null,
  delivered_by: null,
  delivered_at: null,
  receiver_name: null,
  note: null,
  device_id: null,
  updated_at: '2026-09-28 09:00:00.000000+05:30',
}

describe('the lines of one bill', () => {
  const lines = [line('l1', 24, 2), line('l2', 6)]

  it('free pieces are delivered like any other piece', () => {
    expect(billedPieces({ qty_pcs: 24, free_qty_pcs: 2 })).toBe(26)
  })

  it('with no entries every piece on the bill goes in — the full delivery', () => {
    expect(deliveryLinePayload(lines, {}, ids('dl'))).toEqual([
      {
        id: 'dl-1',
        invoiceLineId: 'l1',
        deliveredQtyPcs: 26,
        returnedQtyPcs: 0,
        returnedSaleable: true,
      },
      {
        id: 'dl-2',
        invoiceLineId: 'l2',
        deliveredQtyPcs: 6,
        returnedQtyPcs: 0,
        returnedSaleable: true,
      },
    ])
  })

  it('a driver entry wins, reason and all', () => {
    const entries: Record<string, DoorLineEntry> = {
      l1: {
        id: 'kept',
        deliveredQtyPcs: 20,
        returnedQtyPcs: 6,
        returnedSaleable: false,
        reason: 'damaged',
      },
    }
    expect(deliveryLinePayload(lines, entries, ids('dl'))[0]).toEqual({
      id: 'kept',
      invoiceLineId: 'l1',
      deliveredQtyPcs: 20,
      returnedQtyPcs: 6,
      returnedSaleable: false,
      reason: 'damaged',
    })
  })

  it('"Delivered, all items" is the same write as D4 opened and recorded untouched', () => {
    // D4 opens on the likeliest outcome: every line in full, nothing back, no reason (deliver.tsx).
    const newId = ids('d4')
    const d4Entries: Record<string, DoorLineEntry> = Object.fromEntries(
      lines.map((one) => [
        one.id,
        {
          id: newId(),
          deliveredQtyPcs: billedPieces(one),
          returnedQtyPcs: 0,
          returnedSaleable: true,
          reason: null,
        },
      ]),
    )
    const strip = (rows: ReturnType<typeof deliveryLinePayload>): unknown[] =>
      rows.map(({ id: _id, ...rest }) => rest)
    expect(strip(deliveryLinePayload(lines, d4Entries, ids('x')))).toEqual(
      strip(deliveryLinePayload(lines, {}, ids('home'))),
    )
  })
})

describe('DOS-070 the arrival point travels only when there is one', () => {
  it('one geo row from the arrival fix', () => {
    expect(arrivalGeoProof({ arrived_lat: 19.23, arrived_lng: 73.14 }, ids('g'))).toEqual([
      { id: 'g-1', kind: 'geo', lat: 19.23, lng: 73.14 },
    ])
  })

  it('no fix, no row', () => {
    expect(arrivalGeoProof({ arrived_lat: null, arrived_lng: 73.14 }, ids('g'))).toEqual([])
    expect(arrivalGeoProof({ arrived_lat: 19.23, arrived_lng: null }, ids('g'))).toEqual([])
    expect(arrivalGeoProof(null, ids('g'))).toEqual([])
    expect(arrivalGeoProof(undefined, ids('g'))).toEqual([])
  })
})

describe('deliveries.record and its outbox twin', () => {
  it('a photo carries exactly one of objectKey / inline, and geo its point', () => {
    expect(
      podWire([
        { id: 'p1', kind: 'photo', objectKey: 'tenant/t/pod/1.jpg' },
        { id: 'p2', kind: 'photo', contentBase64: 'AAAA' },
        { id: 'p3', kind: 'geo', lat: 1, lng: 2 },
      ]),
    ).toEqual([
      { id: 'p1', kind: 'photo', objectKey: 'tenant/t/pod/1.jpg' },
      { id: 'p2', kind: 'photo', inline: { mimeType: 'image/jpeg', contentBase64: 'AAAA' } },
      { id: 'p3', kind: 'geo', lat: 1, lng: 2 },
    ])
  })

  it('the online call names the planned row, trims words and never sends an outcome', () => {
    const lines = deliveryLinePayload([line('l1', 5)], {}, ids('dl'))
    const wire = deliveryRecordInput({
      idempotencyKey: 'key-1',
      delivery,
      fallbackId: 'unused',
      receiver: '  Ramesh ',
      note: '   ',
      deliveredAt: '2026-09-28T04:00:00.000Z',
      deviceId: 'device-1',
      lines,
      pod: [{ id: 'g1', kind: 'geo', lat: 1, lng: 2 }],
    })
    expect(wire).toEqual({
      idempotencyKey: 'key-1',
      id: 'del-1',
      tripId: 'trip-1',
      stopId: 'stop-1',
      invoiceId: 'inv-1',
      receiverName: 'Ramesh',
      deliveredAt: '2026-09-28T04:00:00.000Z',
      deviceId: 'device-1',
      lines,
      pod: [{ id: 'g1', kind: 'geo', lat: 1, lng: 2 }],
    })
    expect(wire).not.toHaveProperty('outcome')
    expect(wire).not.toHaveProperty('note')
  })

  it('a bill added at the door takes the fallback id', () => {
    const wire = deliveryRecordInput({
      idempotencyKey: 'k',
      delivery: null,
      fallbackId: 'fresh',
      receiver: '',
      note: '',
      deliveredAt: 'now',
      deviceId: 'd',
      lines: [],
      pod: [],
    })
    expect(wire.id).toBe('fresh')
  })

  it('with no signal the SAME delivery is one op carrying its lines and its proof', () => {
    const lines = deliveryLinePayload([line('l1', 5)], {}, ids('dl'))
    const pod = arrivalGeoProof({ arrived_lat: 1, arrived_lng: 2 }, ids('g'))
    expect(
      queuedDelivery({ delivery, receiver: '', note: '', lines, pod, deviceId: 'device-1' }),
    ).toEqual({
      id: 'del-1',
      tripId: 'trip-1',
      stopId: 'stop-1',
      invoiceId: 'inv-1',
      retailerId: 'shop-1',
      orderId: 'order-1',
      receiverName: '',
      note: '',
      lines: [
        {
          id: 'dl-1',
          invoiceLineId: 'l1',
          deliveredQtyPcs: 5,
          returnedQtyPcs: 0,
          returnedSaleable: true,
          reason: undefined,
        },
      ],
      pod,
      deviceId: 'device-1',
      existing: delivery,
    })
  })
})

describe('collections.record and its outbox twin', () => {
  const stop = { id: 'stop-1', trip_id: 'trip-1', retailer_id: 'shop-1' }
  const cash: DoorMoney = {
    mode: 'cash',
    amountPaise: 1_200_00,
    reference: '',
    chequeDate: '2026-09-28',
    bankName: '',
    bookNo: '',
  }

  it('cash: no reference, no cheque date, no split — the office puts it on the oldest bill', () => {
    expect(
      collectionRecordInput({
        idempotencyKey: 'k',
        id: 'c1',
        receiptId: 'r1',
        stop,
        money: cash,
        allocations: null,
        collectedAt: 'at',
        deviceId: 'd',
      }),
    ).toEqual({
      idempotencyKey: 'k',
      id: 'c1',
      receiptId: 'r1',
      tripId: 'trip-1',
      stopId: 'stop-1',
      retailerId: 'shop-1',
      mode: 'cash',
      amountPaise: 1_200_00,
      collectedAt: 'at',
      deviceId: 'd',
    })
  })

  it('an empty split is not sent at all (DOS-062); a real one is', () => {
    const base = {
      idempotencyKey: 'k',
      id: 'c1',
      receiptId: 'r1',
      stop,
      money: cash,
      collectedAt: 'at',
      deviceId: 'd',
    }
    expect(collectionRecordInput({ ...base, allocations: [] })).not.toHaveProperty('allocations')
    expect(
      collectionRecordInput({
        ...base,
        allocations: [{ id: 'a1', invoiceId: 'inv-1', amountPaise: 100 }],
      }).allocations,
    ).toEqual([{ id: 'a1', invoiceId: 'inv-1', amountPaise: 100 }])
  })

  it('UPI carries its UTR; a cheque its number, its date and its bank; the book number travels', () => {
    const upi = collectionRecordInput({
      idempotencyKey: 'k',
      id: 'c1',
      receiptId: 'r1',
      stop,
      money: { ...cash, mode: 'upi', reference: ' UTR123 ', bookNo: ' B-7 ' },
      allocations: null,
      collectedAt: 'at',
      deviceId: 'd',
    })
    expect(upi.reference).toBe('UTR123')
    expect(upi.clientReceiptNo).toBe('B-7')
    expect(upi).not.toHaveProperty('chequeDate')
    const cheque = collectionRecordInput({
      idempotencyKey: 'k',
      id: 'c1',
      receiptId: 'r1',
      stop,
      money: { ...cash, mode: 'cheque', reference: '000123', bankName: ' SBI ' },
      allocations: null,
      collectedAt: 'at',
      deviceId: 'd',
    })
    expect(cheque).toMatchObject({
      reference: '000123',
      chequeDate: '2026-09-28',
      bankName: 'SBI',
    })
  })

  it('offline: the same money as a receipts op, the cheque date only for a cheque', () => {
    expect(queuedReceipt({ stop, money: cash, deviceId: 'd', receivedBy: 'u1' })).toEqual({
      tripId: 'trip-1',
      retailerId: 'shop-1',
      mode: 'cash',
      amountPaise: 1_200_00,
      reference: '',
      bankName: '',
      clientReceiptNo: '',
      deviceId: 'd',
      receivedBy: 'u1',
    })
    expect(
      queuedReceipt({
        stop,
        money: { ...cash, mode: 'cheque', reference: '9' },
        deviceId: 'd',
        receivedBy: null,
      }).chequeDate,
    ).toBe('2026-09-28')
  })

  it('a UPI payment needs its UTR and a cheque its number; cash needs neither', () => {
    expect(moneyNeedsReference({ mode: 'cash', reference: '' })).toBe(false)
    expect(moneyNeedsReference({ mode: 'upi', reference: '  ' })).toBe(true)
    expect(moneyNeedsReference({ mode: 'cheque', reference: '42' })).toBe(false)
  })

  it('a receipt is read out by the office number, else the book, else the head of its id', () => {
    expect(receiptNumber({ officeNo: 'RCP/0042', bookNo: 'B-7', id: 'abcdefgh-1234' })).toBe(
      'RCP/0042',
    )
    expect(receiptNumber({ officeNo: null, bookNo: ' B-7 ', id: 'abcdefgh-1234' })).toBe('B-7')
    expect(receiptNumber({ bookNo: '', id: 'abcdefgh-1234' })).toBe('abcdefgh')
  })
})

describe('"I am here" takes one fix and never blocks on it', () => {
  it('a fix becomes the arrival point', async () => {
    await expect(
      arrivalFix(() => Promise.resolve({ latitude: 19.2, longitude: 73.1 })),
    ).resolves.toEqual({ lat: 19.2, lng: 73.1 })
  })

  it('no fix, a refusal or a failure all still arrive — with nothing attached', async () => {
    await expect(arrivalFix(() => Promise.resolve(null))).resolves.toEqual({})
    await expect(arrivalFix(() => Promise.reject(new Error('denied')))).resolves.toEqual({})
  })
})
