/**
 * CSV writing for every export a spreadsheet must open cleanly (docs/plans/00-coordination.md §3.7:
 * one `renderCsv(rows, columns)`, built once). RFC 4180 — `\r\n` line ends, every cell quoted when
 * it holds a comma, a quote or a line break — with a UTF-8 BOM so Excel on Windows reads the rupee
 * sign and Devanagari shop names instead of mojibake. Money columns are the caller's choice: pass a
 * `value` that turns paise into a rupee string, or leave the integer paise as they are.
 *
 * FORMULA INJECTION (QA DOS-292, architect ruling 2026-09-28). A spreadsheet runs a cell that begins
 * with `=`, `+`, `-` or `@` as a formula, and treats a leading tab or carriage return the same way.
 * A shop name, a note or a reason typed into the app is written into these files verbatim, so a shop
 * called `=HYPERLINK(…)` would run on the accountant's machine. Every such TEXT cell is written with a
 * single quote in front, here and nowhere else, so no caller can forget it. A NUMBER is never touched:
 * a negative amount must stay a number for Tally and for the registers. Which cells are numbers is
 * decided by the column's type, never by what the text looks like: a `number` column keeps a numeric
 * value as it is, and a column without a type treats a JavaScript number as a number and everything
 * else as text. A `number` column that is handed text that is not a plain number is guarded like text.
 *
 * Plain function, no Nest DI: the worker's export renderers call it (coordination §3.9).
 */

export interface CsvColumn<T> {
  header: string
  /** Reads the cell; a missing `value` reads `row[key]`. */
  key?: keyof T
  value?: (row: T) => unknown
  /**
   * `number`: the column holds amounts or counts (a leading minus is a sign, not a formula). `text`:
   * everything is text, a number included. Omitted: a JavaScript number is a number, the rest is text.
   */
  type?: 'number' | 'text'
}

const BOM = '\uFEFF'

/** What a spreadsheet would start evaluating (DOS-292). */
const FORMULA_START = /^[=+\-@\t\r]/
/** A plain decimal number, the only thing a `number` column writes without a guard. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

function textOf(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value)
}

/** Whether a cell is written as a number, from the column's type and the value's own type. */
function isNumberCell(value: unknown, text: string, type: CsvColumn<unknown>['type']): boolean {
  if (type === 'text') return false
  if (type === 'number') return PLAIN_NUMBER.test(text)
  return typeof value === 'number' && Number.isFinite(value)
}

export function csvCell(value: unknown, type?: CsvColumn<unknown>['type']): string {
  if (value === null || value === undefined) return ''
  const raw = textOf(value)
  const text = !isNumberCell(value, raw, type) && FORMULA_START.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function renderCsv<T extends object>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const lines: string[] = [columns.map((c) => csvCell(c.header, 'text')).join(',')]
  for (const row of rows) {
    lines.push(
      columns
        .map((c) =>
          csvCell(
            c.value
              ? c.value(row)
              : c.key !== undefined
                ? (row as Record<keyof T, unknown>)[c.key]
                : '',
            c.type,
          ),
        )
        .join(','),
    )
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}
