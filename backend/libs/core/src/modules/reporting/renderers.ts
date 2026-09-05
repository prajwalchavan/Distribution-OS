import {
  parseReportExportKind,
  REPORT_EXPORT_KIND_PREFIX,
  ReportExportFormatSchema,
  ReportRegisterSchema,
  type ReportExportFormat,
  type ReportRegister,
} from '@dos/contracts'
import { registerExportRenderer, type ExportRenderContext } from '../integrations/index.js'
import { renderCsv, type CsvColumn } from '../../platform/csv.js'
import { REGISTER_SPECS } from './register-specs.js'
import { createReportingStack } from './worker-services.js'

/**
 * The `report_<register>_<format>` renderers on integrations' ONE `exports.render` queue
 * (coordination §3.5: one queue, one table, one place a kind is looked up — never a second
 * `reporting.export.render` job). CSV writing itself is the platform's `renderCsv`
 * (coordination §3.7), so every export a spreadsheet opens is written by the same RFC-4180 code.
 *
 * A renderer re-reads the register through reporting's own services with the STORED filters, so the
 * file and the screen can never disagree: the same role check, the same window cap, the same
 * arithmetic. The whole register is written, not a page — `limit` is raised to the register's own
 * bound and `cursor` is walked until it runs out, which is exactly why an export is asynchronous.
 */

/** Pages walked per export: the cap that keeps one huge file from starving another tenant (docs/20 rule 3). */
const MAX_PAGES = 200
const PAGE_SIZE = 200

const FILE_STEM: Record<ReportRegister, string> = {
  dailySales: 'daily-sales',
  repProductivity: 'rep-productivity',
  schemeSpend: 'scheme-spend',
  stockValue: 'stock-value',
  fillRate: 'fill-rate',
  deliveryPerformance: 'delivery-performance',
  collections: 'collections',
  gstSalesRegister: 'gst-sales',
  gstPurchaseRegister: 'gst-purchase',
  outstanding: 'outstanding',
}

/**
 * Reads every page of one register with the job's own filters. `gstSalesRegister` and
 * `gstPurchaseRegister` are single documents rather than paged lists, so they answer one "row set"
 * and stop.
 */
async function readAll(
  rc: ExportRenderContext,
  register: ReportRegister,
): Promise<Record<string, unknown>[]> {
  const spec = REGISTER_SPECS[register]
  const stack = createReportingStack(rc.db)
  const filters = { ...rc.params }
  delete filters.limit
  delete filters.cursor
  const rows: Record<string, unknown>[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const parsed = spec.input.parse(
      spec.paged ? { ...filters, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } : filters,
    )
    const result = await spec.read(stack, parsed)
    rows.push(...result.rows)
    cursor = result.nextCursor
    if (!cursor) break
  }
  return rows
}

function csvColumnsOf(
  rows: readonly Record<string, unknown>[],
): CsvColumn<Record<string, unknown>>[] {
  const keys: string[] = []
  for (const row of rows)
    for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key)
  return keys.map((key) => ({ header: key, key }))
}

async function render(
  rc: ExportRenderContext,
  register: ReportRegister,
  format: ReportExportFormat,
): Promise<{ body: Buffer; mimeType: string; rowCount: number; ext: string }> {
  const rows = await readAll(rc, register)
  if (format === 'json') {
    const body = Buffer.from(
      JSON.stringify({ register, filters: rc.params, rowCount: rows.length, rows }, null, 2),
      'utf8',
    )
    return { body, mimeType: 'application/json', rowCount: rows.length, ext: 'json' }
  }
  const csv = renderCsv(rows, csvColumnsOf(rows))
  return { body: Buffer.from(csv, 'utf8'), mimeType: 'text/csv', rowCount: rows.length, ext: 'csv' }
}

let registered = false

/**
 * Registers all twenty `report_*` kinds (ten registers × csv/json). Called from `ReportingModule`'s
 * `onModuleInit` in every service and from `backend/worker/src/main.ts` — the registry is per process,
 * so both halves must arm it (coordination §3.5).
 */
export function registerReportRenderers(): void {
  if (registered) return
  registered = true
  for (const register of ReportRegisterSchema.options) {
    for (const format of ReportExportFormatSchema.options) {
      const kind = `${REPORT_EXPORT_KIND_PREFIX}${register}_${format}`
      registerExportRenderer(
        kind,
        async (rc) => {
          const parsedKind = parseReportExportKind(rc.kind)
          if (!parsedKind) throw new Error(`not a report export kind: ${rc.kind}`)
          return render(rc, parsedKind.register, parsedKind.format)
        },
        {
          ext: format,
          mimeType: format === 'json' ? 'application/json' : 'text/csv',
          stem: FILE_STEM[register],
        },
      )
    }
  }
}
