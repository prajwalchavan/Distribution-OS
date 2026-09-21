/**
 * M14 — the shop panel and the shops register, as pure functions of what the two reads answer.
 *
 * The screen holds the layout; everything that decides WHAT a figure or a row says lives here, where a
 * vitest can read it without a browser. Money is integer paise in and a formatted rupee string out, at
 * the edge and nowhere earlier.
 */
import type { RetailerLedgerKind, RetailerLedgerRow } from '@dos/contracts'
import { formatINR, paise } from '@dos/domain'

/**
 * The overdue figure printed under "Owes" on the shop panel (`m1.overdue`).
 *
 * `receivables.outstanding.get` answers integer paise, and the token this feeds is a plain `{amount}`
 * in the sentence — so the screen, not the string, decides how the number reads. `String(paise)` put
 * the database integer on the panel ("6042250 overdue" under "₹60,422.50", DOS-035); the money
 * formatter is the same one the home tile's overdue line uses.
 */
export function overdueAmount(overduePaise: number | null | undefined): string {
  return formatINR(paise(overduePaise ?? 0))
}

// ---------------------------------------------------------------------------
// The statement of account
// ---------------------------------------------------------------------------

/** One line of the shop panel's statement: what the document was for, and where it left the account. */
export interface StatementRow {
  readonly key: string
  readonly kind: RetailerLedgerKind
  readonly refNo: string | null
  /** IST calendar date: the document's own, and the window's first day for the opening row. */
  readonly date: string
  /** What the document ADDED to the account (a bill), or `null` where that column is empty. */
  readonly debitPaise: number | null
  /** What it TOOK OFF (a receipt, a credit note), or `null`. */
  readonly creditPaise: number | null
  /** The account's balance after this row. */
  readonly balancePaise: number
}

export interface StatementWindow {
  /** The first day of the window the ledger was read for; the opening row's date. */
  readonly from: string
  /** How many documents the panel shows. */
  readonly limit: number
}

/**
 * `receivables.ledger.get` answers the window's documents oldest first, each with the balance AFTER it,
 * and `openingPaise` — everything that happened BEFORE the window — separately.
 *
 * The panel printed the balance column alone, with no head (DOS-036): a ₹3,683 bill read
 * "INV/0175 ₹22,789.00", and the ₹9,182 the first row already carried was nowhere on the screen. A
 * manager reading the account to a shopkeeper on the phone quoted the wrong bill amounts. So the
 * opening balance is a row of its own, dated the day the window starts, and every document states what
 * it added or took off beside the balance it left behind. A zero column is `null`, printed as "—":
 * a bill has no credit figure and "₹0.00" in that cell reads as one.
 */
export function statementRows(
  ledger: { readonly openingPaise: number; readonly items: readonly RetailerLedgerRow[] },
  window: StatementWindow,
): StatementRow[] {
  const opening: StatementRow = {
    key: 'opening',
    kind: 'opening',
    refNo: null,
    date: window.from,
    debitPaise: null,
    creditPaise: null,
    balancePaise: ledger.openingPaise,
  }
  return [
    opening,
    ...ledger.items.slice(0, window.limit).map((row) => ({
      key: `${row.kind}-${row.refId}-${row.date}`,
      kind: row.kind,
      refNo: row.refNo,
      date: row.date,
      debitPaise: row.debitPaise === 0 ? null : row.debitPaise,
      creditPaise: row.creditPaise === 0 ? null : row.creditPaise,
      balancePaise: row.balancePaise,
    })),
  ]
}

// ---------------------------------------------------------------------------
// The shops register
// ---------------------------------------------------------------------------

export type ShopColumnKey = 'code' | 'name' | 'beat' | 'tier' | 'terms' | 'limit' | 'mode' | 'phone'

/** A `<Register>` column of M14, as far as this file decides it: which column, and what it is FOR. */
export interface ShopColumnSpec {
  readonly key: ShopColumnKey
  /** The kit's own word: `identity` names the row, `value` is its figure, `chip` its status. */
  readonly priority: 'identity' | 'value' | 'chip' | 'detail'
}

/**
 * The columns M14 lists, in order. The screen supplies each one's head and cell.
 *
 * WHICH COLUMN NAMES THE ROW (DOS-038). A desk sees all eight; a phone sees the `identity` column, the
 * first `value` column and the `chip` one. With the CODE as the identity and the credit limit as the
 * value, a phone row read "R-0046 · Blocked · 0.00" — the one column a manager recognises a shop by was
 * the one the narrow layout dropped, on the list whose whole job is to find a shop. The name is the
 * identity, the credit policy stays beside it, and the code and the limit are in the panel the row
 * opens (they remain columns, so a desk still lists them).
 */
export const SHOP_COLUMNS: readonly ShopColumnSpec[] = [
  { key: 'code', priority: 'detail' },
  { key: 'name', priority: 'identity' },
  { key: 'beat', priority: 'detail' },
  { key: 'tier', priority: 'detail' },
  { key: 'terms', priority: 'detail' },
  { key: 'limit', priority: 'detail' },
  { key: 'mode', priority: 'chip' },
  { key: 'phone', priority: 'detail' },
]

/** What a phone shows of a row: the kit's rule (`@dos/ui` web/list.tsx and native/list.tsx). */
export interface PhoneRow {
  readonly primary: ShopColumnKey | undefined
  readonly trailing: ShopColumnKey | undefined
  readonly secondary: ShopColumnKey | undefined
}

/**
 * Below desk width a `<Register>` is not a table: it is one `<ListRow>` per row, carrying the
 * `identity` column as its line, the first `value` column as its trailing figure and the `chip`
 * column beside it. Every other column is in the panel the row opens. This is that rule, so a vitest
 * can read what a phone will actually show.
 */
export function phoneRow(columns: readonly ShopColumnSpec[]): PhoneRow {
  const identity = columns.find((column) => column.priority === 'identity') ?? columns[0]
  return {
    primary: identity?.key,
    trailing: columns.find((column) => column.priority === 'value')?.key,
    secondary: columns.find((column) => column.priority === 'chip')?.key,
  }
}
