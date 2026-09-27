/**
 * DOS-257 — the owner writes off the 12 phantom toor on his own Stock screen, so the screen has to show
 * him what they are.
 *
 * The audit found 12 toor (batch B20260909, Godown) that a pre-DOS-251 bill cancel wrote into the books
 * and nothing took out again. The fix the finding names is a write-off on the stock-adjust dialog. Before
 * this, the dialog said only "On hand now: 12 pcs", and the stock ledger listed "+12 · Adjusted by hand ·
 * Bill cancelled" without saying WHICH item, batch or place moved — the owner could not tell a phantom from
 * a real count. Now:
 *   - the dialog reads the batch's last movements AT THAT PLACE (`stock.ledger` by lot and location), so
 *     "+12 · Adjusted by hand · Bill cancelled — cancelled invoice INV/9034" is in front of him when he
 *     takes the pieces off, and a failed read says so instead of showing nothing;
 *   - the ledger names the item and batch of every movement (the contract's `variantName` / `batchNo`)
 *     and, with no place picked, the place.
 *
 * Read as SOURCE, like the other guards here: importing a screen in Node pulls in `react-native` and
 * `expo-router`, which resolve only under Metro.
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

describe('O15 stock: the write-off shows what it writes off', () => {
  it('DOS-257: the adjust dialog lists the batch’s last movements at that place, and says when it cannot', async () => {
    const screen = await read('../../../../app/owner/stock/index.tsx')
    const dialog = /<Dialog\s+open=\{adjustLot !== null\}[\s\S]*?testID="stock-adjust-dialog"/.exec(
      screen,
    )?.[0]
    expect(dialog, 'the adjust dialog is gone').toBeDefined()
    expect({
      readsTheBatchAtThatPlace:
        /inventory\.stock\.ledger\(\{\s*lotId: adjustLot\?\.lotId[^}]*locationId: adjustLot\?\.locationId/.test(
          screen,
        ),
      onlyWhileOpen: /enabled: adjustLot !== null/.test(screen),
      // keyed under 'inventory', so the adjustment's own invalidation reads it again after a save
      refreshedBySave: /\['inventory', 'ledger', 'batch'/.test(screen),
      listedInTheDialog: /o15\.lately'/.test(dialog ?? ''),
      saysWhenTheReadFailed: /o15\.latelyFailed/.test(dialog ?? ''),
      carriesTheNote: /o15\.latelyRowNote/.test(dialog ?? ''),
    }).toEqual({
      readsTheBatchAtThatPlace: true,
      onlyWhileOpen: true,
      refreshedBySave: true,
      listedInTheDialog: true,
      saysWhenTheReadFailed: true,
      carriesTheNote: true,
    })
    expect(catalogue['o15.lately']).toBe('Last movements of this batch here')
    expect(catalogue['o15.latelyRowNote']).toContain('{note}')
  })

  it('DOS-257: every ledger row names the item and batch that moved, and the place when none is picked', async () => {
    const screen = await read('../../../../app/owner/stock/index.tsx')
    const columns = /const ledgerColumns[\s\S]*?\n {2}\]/.exec(screen)?.[0] ?? ''
    expect({
      item: /textColumn\('item', t\('o15\.item'\), itemBatch/.test(columns),
      place: /locationId === null[\s\S]*?textColumn<LedgerEntry>\('where'/.test(columns),
      namesFromTheWire: /row\.variantName[\s\S]*?row\.batchNo/.test(screen),
    }).toEqual({ item: true, place: true, namesFromTheWire: true })
    expect(catalogue['o15.itemBatch']).toBe('{item} · {batch}')
  })
})
