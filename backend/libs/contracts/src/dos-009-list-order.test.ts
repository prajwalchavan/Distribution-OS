/**
 * DOS-009 — every windowed list says, on its own contract, which column it orders by.
 *
 * The rule is one sentence (QA DOS-009, founder 2026-09-21 delegated to the architect; the reading at
 * register grain of his DOS-023 row): **every list orders newest first on the same column its own
 * `from`/`to` window filters — server time `created_at` for a queue of work, the document's own
 * stamped date for a dated register — with the row id only ever breaking a tie.**
 *
 * The queries already obey it (`orders.list` on `created_at`, `billing.invoices.list` on
 * `invoice_date`, `delivery.trips.list` on `trip_date`, each with a `(column, id)` keyset), and the
 * core specs prove the walk. What was missing is the half a reader of the API sees: three of the four
 * windowed list inputs named neither the order nor the column, so the only way to learn that an
 * August-dated bill typed in September sits under August was to read the service. `StopsListInput`
 * already states it; these three did not, and a screen that cannot read the order from the contract
 * invents its own (delivery-app D11 re-sorted the page by trip number for exactly this reason).
 *
 * The guard has two halves, because a doc sentence on its own is only a claim:
 *   1. each list input carries a doc that says NEWEST FIRST, names its ordering column in backticks,
 *      and names the id tie-break — and the column it names is the same one its `from`/`to` doc says
 *      the window filters on;
 *   2. that column is the column the SERVICE actually sorts by, read out of its `.orderBy(...)`.
 * So a doc that lies, or a query that moves without its doc, fails here.
 *
 * Read as source: JSDoc is erased at runtime, so there is nothing on the Zod schema to assert against.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** The doc block immediately above `export const <symbol> = z.object({`, and the schema body. */
function schemaOf(source: string, symbol: string): { doc: string; body: string } {
  const doc =
    new RegExp(`/\\*\\*([\\s\\S]*?)\\*/\\s*export const ${symbol} = z\\.object\\(\\{`).exec(
      source,
    )?.[1] ?? ''
  const body =
    new RegExp(`export const ${symbol} = z\\.object\\(\\{([\\s\\S]*?)\\n\\}\\)`).exec(
      source,
    )?.[1] ?? ''
  return { doc, body }
}

/** Every column name this doc quotes in backticks. */
function columnsNamed(doc: string): string[] {
  return [...doc.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? '')
}

/** The doc lines attached to the `from`/`to` pair inside a schema body. */
function windowDoc(body: string): string {
  return /\/\*\*([\s\S]*?)\*\/\s*from: IsoDateSchema/.exec(body)?.[1] ?? ''
}

interface Windowed {
  /** What the list is called on the wire. */
  readonly procedure: string
  readonly contract: string
  readonly symbol: string
  /** The column the ruling says this list windows AND orders on. */
  readonly column: string
  /** The service file and the Drizzle table alias its `orderBy` uses. */
  readonly service: string
  readonly orderBy: string
}

const WINDOWED: readonly Windowed[] = [
  {
    procedure: 'orders.list',
    contract: './orders.ts',
    symbol: 'OrdersListInput',
    column: 'created_at',
    service: '../../core/src/modules/orders/orders.internals.ts',
    orderBy: 'desc(salesOrders.createdAt), desc(salesOrders.id)',
  },
  {
    procedure: 'billing.invoices.list',
    contract: './billing.ts',
    symbol: 'InvoicesListInput',
    column: 'invoice_date',
    service: '../../core/src/modules/billing/invoices.service.ts',
    orderBy: 'desc(invoices.invoiceDate), desc(invoices.id)',
  },
  {
    procedure: 'delivery.trips.list',
    contract: './delivery.ts',
    symbol: 'TripsListInput',
    column: 'trip_date',
    service: '../../core/src/modules/delivery/trips.service.ts',
    orderBy: 'desc(trips.tripDate), desc(trips.id)',
  },
]

describe('DOS-009: a windowed list states its order on its own contract', () => {
  for (const list of WINDOWED) {
    it(`DOS-009: ${list.procedure} documents newest first on \`${list.column}\` — the column its own window filters — with the id as tie-break`, () => {
      const { doc, body } = schemaOf(read(list.contract), list.symbol)

      expect({
        docFound: doc !== '',
        saysNewestFirst: /newest first/i.test(doc),
        namesTheOrderingColumn: columnsNamed(doc).includes(list.column),
        namesTheIdTieBreak: /\bid\b[\s\S]{0,60}?tie/i.test(doc),
        /* The window and the order are ONE column: the doc on `from`/`to` must name the same one. */
        windowDocNamesTheSameColumn: columnsNamed(windowDoc(body)).includes(list.column),
      }).toEqual({
        docFound: true,
        saysNewestFirst: true,
        namesTheOrderingColumn: true,
        namesTheIdTieBreak: true,
        windowDocNamesTheSameColumn: true,
      })
    })

    it(`DOS-009: the column ${list.procedure} documents is the column the service sorts by`, () => {
      /* Half two: the doc is only a claim until the query agrees with it. */
      expect(read(list.service)).toContain(`.orderBy(${list.orderBy})`)
    })
  }
})
