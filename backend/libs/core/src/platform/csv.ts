/**
 * CSV writing for every export a spreadsheet must open cleanly (docs/plans/00-coordination.md §3.7:
 * one `renderCsv(rows, columns)`, built once). RFC 4180 — `\r\n` line ends, every cell quoted when
 * it holds a comma, a quote or a line break — with a UTF-8 BOM so Excel on Windows reads the rupee
 * sign and Devanagari shop names instead of mojibake. Money columns are the caller's choice: pass a
 * `value` that turns paise into a rupee string, or leave the integer paise as they are.
 *
 * Plain function, no Nest DI: the worker's export renderers call it (coordination §3.9).
 */

export interface CsvColumn<T> {
  header: string
  /** Reads the cell; a missing `value` reads `row[key]`. */
  key?: keyof T
  value?: (row: T) => unknown
}

const BOM = '\uFEFF'

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : value instanceof Date
          ? value.toISOString()
          : JSON.stringify(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function renderCsv<T extends object>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const lines: string[] = [columns.map((c) => cell(c.header)).join(',')]
  for (const row of rows) {
    lines.push(
      columns
        .map((c) =>
          cell(
            c.value
              ? c.value(row)
              : c.key !== undefined
                ? (row as Record<keyof T, unknown>)[c.key]
                : '',
          ),
        )
        .join(','),
    )
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}
