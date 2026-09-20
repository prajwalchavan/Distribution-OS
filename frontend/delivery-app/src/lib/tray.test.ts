/**
 * DOS-178 — what D10 may offer on a refusal, and what it may never offer on money.
 *
 * A crew takes ₹2,500 in cash at a door with no signal. The office settles that trip before the phone
 * finds one, so the receipt comes back refused `trip_settled` — correctly: that money now goes over the
 * counter to the cashier (founder answer A, 2026-09-14). Until this, the tray's card carried a
 * destructive "Throw it away", and on a settled trip the outbox row is the ONLY record anywhere that the
 * shop paid. Never-list #13: money a person has entered is never offered for deletion.
 *
 * Pure rules, no React, no kit — the tray screen reads them, and both halves are provable here.
 */
import { describe, expect, it } from 'vitest'

import { trayActions } from './tray'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

/** `@types/node` is deliberately absent from an app, so the two Node functions come in unliterally. */
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very string it explains. */
async function readSource(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The tray screen itself — importing it in Node would pull in `react-native`, which Metro resolves. */
const readTray = (): Promise<string> => readSource('../../app/attention.tsx')
/** This app's string table, to prove the key the rule returns is really declared. */
const readStrings = (): Promise<string> => readSource('../strings.ts')

/** One tray entry, shaped exactly as `engine.needsAttention()` hands it over. */
function item(input: {
  table: string
  code: string
  data?: Record<string, unknown> | null
  handedOverAt?: string | null
  withOp?: boolean
}) {
  const withOp = input.withOp ?? true
  return {
    error: {
      opId: 'op-1',
      table: input.table,
      rowId: 'rc1',
      code: input.code,
      message: 'Trip TRIP-0031 is settled; money is collected while the trip is out',
      createdAt: '2026-09-19T06:30:00.000Z',
      discardedAt: null,
      handedOverAt: input.handedOverAt ?? null,
      // DOS-046: an entry the tray still draws has not been sent again under another opId.
      retriedAs: null,
    },
    op: withOp
      ? {
          seq: 1,
          opId: 'op-1',
          table: input.table,
          rowId: 'rc1',
          op: 'PUT' as const,
          data: input.data === undefined ? CASH : input.data,
          baseUpdatedAt: null,
          idempotencyKey: 'op-1',
          status: 'rejected' as const,
          attempts: 1,
          createdAt: '2026-09-19T06:30:00.000Z',
          sentAt: null,
          ackedAt: null,
          rejectionCode: input.code,
          rejectionMessage: 'Trip TRIP-0031 is settled',
        }
      : null,
    serverRow: null,
    kept: input.table === 'receipts' || input.table === 'collections',
  }
}

const CASH = {
  retailer_id: 'r1',
  mode: 'cash',
  amount_paise: 250000,
  client_receipt_no: '41',
} as const

describe('DOS-178 a refused payment is kept and handed to the cashier', () => {
  it('DOS-178 a refused receipt offers Handed to the cashier and never Throw it away or Send it again', () => {
    const card = trayActions(item({ table: 'receipts', code: 'trip_settled' }))

    expect(card.actions).toEqual(['handOver'])
    expect(card.actions).not.toContain('discard')
    expect(card.actions).not.toContain('retry')
    expect(card.money).toEqual({
      amountPaise: 250000,
      mode: 'cash',
      bookNo: '41',
      instruction: 'tray.handCash',
    })
    expect(card.handedOverAt).toBeNull()
  })

  it('DOS-178 the rule is the TABLE, not the code: any refusal on a money table is kept', () => {
    for (const code of ['trip_settled', 'trip_not_found', 'trip_not_on_road', 'not_permitted'])
      expect(trayActions(item({ table: 'receipts', code })).actions).toEqual(['handOver'])
  })

  it('DOS-178 UPI is already in the account, so the cashier is told rather than handed anything', () => {
    const card = trayActions(
      item({
        table: 'receipts',
        code: 'trip_settled',
        data: { ...CASH, mode: 'upi', reference: 'UPI/9921' },
      }),
    )
    expect(card.money?.instruction).toBe('tray.handUpi')
  })

  it('DOS-178 a payment already handed over offers nothing and says when', () => {
    const card = trayActions(
      item({ table: 'receipts', code: 'trip_settled', handedOverAt: '2026-09-19T07:02:00.000Z' }),
    )
    expect(card.actions).toEqual([])
    expect(card.handedOverAt).toBe('2026-09-19T07:02:00.000Z')
  })

  it('DOS-178 money the phone no longer holds is still never offered for deletion', () => {
    // `pullErrors` brings the office's rejections back after a reinstall: no op, so no figures — and
    // still no "Throw it away", because the table alone decides.
    const card = trayActions(item({ table: 'receipts', code: 'trip_settled', withOp: false }))
    expect(card.actions).toEqual(['handOver'])
    expect(card.money).toBeNull()
  })

  it('DOS-178 review: money the phone no longer holds is never told to record it again and throw it away', () => {
    // The card above has no figures, so it used to fall into the tray's "not on this phone" arm and
    // print "Record it again, then throw this away." beside its own Handed-to-the-cashier button —
    // never-list #13 arriving as a SENTENCE after the buttons were fixed (merge review, 2026-09-19).
    // Which line a card may print is decided here, next to which buttons it may show.
    expect(
      trayActions(item({ table: 'receipts', code: 'trip_settled', withOp: false })).notHeld,
    ).toBe('tray.moneyNotOnPhone')
    expect(trayActions(item({ table: 'trip_stops', code: 'stale', withOp: false })).notHeld).toBe(
      'tray.notOnPhone',
    )
    // A phone that still holds the write says nothing: "Send it again" or the hand-over button is there.
    expect(trayActions(item({ table: 'receipts', code: 'trip_settled' })).notHeld).toBeNull()
    expect(trayActions(item({ table: 'deliveries', code: 'stale' })).notHeld).toBeNull()
  })

  it('DOS-178 a refusal that is not money keeps today’s Send it again and Throw it away', () => {
    const card = trayActions(item({ table: 'deliveries', code: 'stale' }))
    expect(card.actions).toEqual(['retry', 'discard'])
    expect(card.money).toBeNull()
  })

  it('DOS-178 a non-money refusal the phone no longer holds keeps Throw it away alone', () => {
    const card = trayActions(item({ table: 'trip_stops', code: 'stale', withOp: false }))
    expect(card.actions).toEqual(['discard'])
  })

  it('DOS-178 review: D10 takes that line from the rule and never reaches for the throw-away one', async () => {
    const source = await readTray()
    expect({
      viaCard: /t\(card\.notHeld\)/.test(source),
      direct: source.includes("t('tray.notOnPhone')"),
      declared: (await readStrings()).includes("'tray.moneyNotOnPhone':"),
    }).toEqual({ viaCard: true, direct: false, declared: true })
  })
})
