/**
 * D10 — what a refused write may be DONE with (DOS-178; never-list #13, founder 2026-09-19).
 *
 * Pure rules, no React, no kit, so the whole of the decision can be read in a test without Metro.
 *
 * The tray used to put the same two buttons on every card: "Send it again" and "Throw it away". On a
 * doorstep payment the office refused, both are wrong. Sending it again replays the server's stored
 * refusal (S-73) — the same answer, for ever — and throwing it away deletes the ONLY record anywhere that
 * the shop paid: the phone's, because the office refused it, and the books', because it never reached
 * them. So a money refusal gets one button, and it is not destructive: the crew hands the money and the
 * slip to the cashier, who records it at the office against the same paper-book number.
 *
 * KEPT IS DECIDED BY THE TABLE, NEVER BY THE CODE. `@dos/offline` marks the item (`MONEY_TABLES`:
 * `receipts`, `allocations`, `collections`) and the engine refuses `discard` on one outright, so a screen
 * cannot get this wrong by forgetting a code the server added last week — `trip_settled`,
 * `trip_not_found` and `trip_not_on_road` all mean the same thing to a driver holding notes.
 */
import type { NeedsAttentionItem } from '@dos/offline'

/** What the card may offer. `handOver` is never destructive; `discard` never appears on money. */
export type TrayAction = 'retry' | 'discard' | 'handOver'

/** The figures under the server's sentence, and which of the two money lines goes with them. */
export interface TrayMoney {
  readonly amountPaise: number
  readonly mode: string
  /** The crew's paper book number — the link between this card and the cashier's entry. */
  readonly bookNo: string | null
  /**
   * `tray.handCash` for cash and cheques (a person carries them to the counter); `tray.handUpi` for money
   * that is already in the account and only has to be told to the cashier.
   */
  readonly instruction: 'tray.handCash' | 'tray.handUpi'
}

export interface TrayCard {
  /** In the order they are shown. Empty once the money has been handed over: nothing is left to do. */
  readonly actions: readonly TrayAction[]
  /** Null on anything that is not money, and on money this phone no longer holds the op for. */
  readonly money: TrayMoney | null
  /**
   * The sentence for a write this phone no longer holds, or null while it still holds it.
   *
   * The two are NOT the same sentence, and the merge review of 2026-09-19 found the tray printing the
   * wrong one: a kept payment pulled back from the office after a reload has no op either, so it fell
   * into the ordinary arm and read "Record it again, then throw this away." beside its own
   * Handed-to-the-cashier button — never-list #13 as a sentence, one commit after the buttons were
   * fixed. Money says where the money goes instead; nothing here ever offers deletion.
   */
  readonly notHeld: 'tray.notOnPhone' | 'tray.moneyNotOnPhone' | null
  /** When the crew handed it to the cashier, so the card can sit in its own section with the time. */
  readonly handedOverAt: string | null
}

/** Cash and a cheque are carried to the counter; everything else has already reached the account. */
function instructionFor(mode: string): TrayMoney['instruction'] {
  return mode === 'cash' || mode === 'cheque' ? 'tray.handCash' : 'tray.handUpi'
}

function moneyOf(item: NeedsAttentionItem): TrayMoney | null {
  const data = item.op?.data
  if (data === null || data === undefined) return null
  const amount = data.amount_paise
  const mode = data.mode
  if (typeof amount !== 'number' || typeof mode !== 'string') return null
  const bookNo = data.client_receipt_no
  return {
    amountPaise: amount,
    mode,
    bookNo: typeof bookNo === 'string' && bookNo !== '' ? bookNo : null,
    instruction: instructionFor(mode),
  }
}

/**
 * What D10 offers on one tray entry.
 *
 * Money: one button, "Handed to the cashier", and none at all once it has been. Everything else keeps
 * what the tray has always done — "Send it again" when the phone still holds the write, "Throw it away"
 * either way (DOS-056: a rejection pulled back from the office after a reinstall has no op to resend,
 * and leaving it undismissable stranded the tray).
 */
export function trayActions(item: NeedsAttentionItem): TrayCard {
  if (item.kept)
    return {
      actions: item.error.handedOverAt === null ? ['handOver'] : [],
      money: moneyOf(item),
      /*
       * `pullErrors` brings a refusal back from the office after a reload or a reinstall, so a kept card
       * can exist with no op and no figures. It still owes the shop a receipt: the line says where the
       * money goes, never "Record it again, then throw this away".
       */
      notHeld: item.op === null ? 'tray.moneyNotOnPhone' : null,
      handedOverAt: item.error.handedOverAt,
    }
  return {
    actions: item.op === null ? ['discard'] : ['retry', 'discard'],
    money: null,
    notHeld: item.op === null ? 'tray.notOnPhone' : null,
    handedOverAt: null,
  }
}
