/**
 * DOS-014 — an export the owner chose, and a button that says what happened.
 *
 * Three faults in one finding. "Request export" fired a fixed GST-sales export for a fixed 90 days
 * with no dialog and no message. `ExportButton` read `exports.get` once: when the worker renders off
 * process the job is still queued, `url` is null, and nothing ever re-read it (DOS-008's class), so
 * the label fell back to "Export CSV" and the file never appeared. And Orders → "Export CSV"
 * exported the daily-sales register, because there was no orders register to export.
 *
 * The backend half is `reporting.spec.ts` (the `orders` register). This guards the app: the button
 * polls until the file is there, Orders exports ORDERS, and Request export asks what and when.
 *
 * Read as SOURCE, like `dos-015-rebuild-ageing.guard.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

describe('DOS-014 exports: chosen, and reported', () => {
  it('DOS-014: the export button polls the queued job until the file is there, and gives up out loud', async () => {
    const lib = await read('./ui.tsx')
    const button = /export function ExportButton\(\{[\s\S]*?\n\}\n/.exec(lib)?.[0]
    expect(button, 'ExportButton is gone').toBeDefined()

    expect({
      // `useQuery` has no refetch interval; the component owns the timer and clears it.
      polls: /setInterval\(/.test(button ?? ''),
      refetches:
        /const refetch = job\.refetch/.test(button ?? '') && /void refetch\(\)/.test(button ?? ''),
      clearsTimer: /clearInterval\(/.test(button ?? ''),
      // "Preparing…" while it is queued, so the label is never a lie.
      saysPreparing: /app\.exportPreparing/.test(button ?? ''),
      // and a failure or a long queue is said, not swallowed.
      saysFailed: /app\.exportFailed/.test(button ?? ''),
      saysSlow: /app\.exportSlow/.test(button ?? ''),
      // never opens a download without a tap (popup blockers): the button flips to Download.
      opensOnPress: /onPress=\{\(\) => \{[\s\S]{0,200}?documents\.open/.test(button ?? ''),
    }).toEqual({
      polls: true,
      refetches: true,
      clearsTimer: true,
      saysPreparing: true,
      saysFailed: true,
      saysSlow: true,
      opensOnPress: true,
    })

    expect(catalogue['app.exportPreparing']).toBe('Preparing…')
    expect(catalogue['app.exportSlow']).toBe('Still preparing — see Reports → Exports')
  })

  it('DOS-014: Orders exports the orders, with the filters the screen is showing', async () => {
    const screen = await read('../../app/orders/index.tsx')
    const button = /<ExportButton[\s\S]*?testID="orders-export"[\s\S]*?\/>/.exec(screen)?.[0]
    expect(button, 'the Orders export button is gone').toBeDefined()
    expect(button).toMatch(/register="orders"/)
    expect(button).not.toMatch(/dailySales/)
    // the register's own filters: the range on screen and the state chips
    expect(button).toMatch(/span\.from/)
    expect(button).toMatch(/states/)
  })

  it('DOS-014: Request export asks which register and which period before it queues one', async () => {
    const screen = await read('../../app/reports/exports.tsx')

    expect({
      // no fixed register any more: the dialog offers what the contract lists
      hardCoded: /register: 'gstSalesRegister'/.test(screen),
      offersEveryRegister: /ReportRegisterSchema\.options/.test(screen),
      offersPeriods: /RangeSegments/.test(screen),
      // the window is clamped to the register's own cap, so no export can 400 window_too_wide
      clamps: /clampWindow/.test(screen),
      // and the dialog states exactly what will be queued
      dialog: /<Dialog[\s\S]*?testID="exports-request-dialog"/.test(screen),
      saysWhat: /o22\.requestBody/.test(screen),
      // a queued job is reported, and the list follows it until it stops moving
      toast: /o22\.queuedToast/.test(screen),
      pollsTheList:
        /const refetchJobs = jobs\.refetch/.test(screen) && /void refetchJobs\(\)/.test(screen),
      // design E: a register whose input has no from/to sends `{}` — never dates the server strips
      noWindowForUnwindowed: /cap === undefined \? \{\}/.test(screen),
    }).toEqual({
      hardCoded: false,
      offersEveryRegister: true,
      offersPeriods: true,
      clamps: true,
      dialog: true,
      saysWhat: true,
      toast: true,
      pollsTheList: true,
      noWindowForUnwindowed: true,
    })

    expect(catalogue['o22.queue']).toBe('Queue export')
    expect(catalogue['o22.queuedToast']).toBe('Export queued')
  })

  /*
   * `stockValue` and `outstanding` are point-in-time registers: `StockValueInput` and
   * `OutstandingListInput` carry no `from` / `to`, so Zod strips the window the dialog sent and the
   * worker renders the WHOLE register. The dialog offered a period anyway and the summary line read
   * "Stock value · CSV · 14 Aug to 12 Sep" — a sentence the file then contradicted. Design E: the
   * period control is hidden for those registers, `filters` is `{}`, and the line says so.
   */
  it('DOS-014: a register with no window offers no period, promises none, and sends none', async () => {
    const screen = await read('../../app/reports/exports.tsx')
    const dialog = /<Dialog[\s\S]*?testID="exports-request-dialog"/.exec(screen)?.[0] ?? ''

    expect({
      // the period label and the segments only exist when the register HAS a window
      hidesPeriodLabel: /cap === undefined \? null : \(/.test(dialog),
      // …and the segments themselves sit INSIDE that branch, never before it
      periodIsConditional:
        dialog.indexOf('cap === undefined ? null : (') >= 0 &&
        dialog.indexOf('cap === undefined ? null : (') < dialog.indexOf('<RangeSegments'),
      // and the summary line drops the dates instead of inventing them
      saysWholeRegister: /o22\.requestBodyWhole/.test(dialog),
      // the request itself carries no dates for those registers
      sendsNoDates:
        /filters: cap === undefined \? \{\} : \{ from: span\.from, to: span\.to \}/.test(screen),
    }).toEqual({
      hidesPeriodLabel: true,
      periodIsConditional: true,
      saysWholeRegister: true,
      sendsNoDates: true,
    })

    expect(catalogue['o22.requestBody']).toBe('{register} · {format} · {from} to {to}')
    expect(catalogue['o22.requestBodyWhole']).toBe('{register} · {format} · whole register')
  })
})
