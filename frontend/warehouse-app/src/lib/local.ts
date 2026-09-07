/**
 * What the godown phone reads off its own SQLite, and what it may write back.
 *
 * docs/23 §4.4 says offline is not a pilot requirement for this app, and then names the one flow that
 * cannot wait for it: **the pick and pack walk happens inside a godown**, where a picker is between a
 * steel rack and a wall with no signal at all. So the picking sheet — the one screen a hand holds for
 * twenty minutes at a stretch — reads the DEVICE and writes through the outbox, and every other
 * screen reads the service. That is exactly what the server allows: `sync.manifest` publishes
 * thirteen tables for the warehouse role and **`pick_lines` is the only writable one**
 * (`warehouse.sync.ts`); packing issues a numbered invoice under a row lock, so it stays online.
 *
 * The joins here are done in JS because `useTable` is one table at a time by design (docs/27 §11):
 * the tables are small (a tenant's variants and lots are hundreds of rows, not millions) and a join
 * written as SQL in a screen is the first step towards a screen that writes SQL.
 */
import { useSyncStatus, useTable } from '@dos/offline/react'
import { useMemo, useRef } from 'react'

/** `pick_lines` as the manifest publishes it (snake_case, exactly as `sync.pull` delivers). */
export interface LocalPickLine {
  id: string
  picklist_id: string
  order_id: string
  order_line_id: string
  variant_id: string
  line_no: number
  lot_id: string | null
  suggested_lot_id: string | null
  requested_qty_pcs: number
  picked_qty_pcs: number
  free_qty_pcs: number
  case_size: number | null
  fefo_override: boolean | number
  short_reason: string | null
  picked_by: string | null
  picked_at: string | null
  updated_at: string
  _pending?: 'queued' | 'sending' | 'rejected' | null
}

export interface LocalPicklist {
  id: string
  picklist_no: string | null
  status: string
  location_id: string
  pick_date: string
  trip_id: string | null
  beat_id: string | null
  note: string | null
  assigned_to: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

export interface LocalVariant {
  id: string
  name: string
  default_case_size: number
  ean: string | null
  mrp_paise: number | null
}

export interface LocalLot {
  id: string
  variant_id: string
  batch_no: string
  mrp_paise: number
  expiry_date: string | null
  case_size: number | null
}

/** One row of the picking sheet: the line, plus the two names a picker needs to find the carton. */
export interface PickRow {
  line: LocalPickLine
  variantName: string
  batchNo: string | null
  expiryDate: string | null
  ean: string | null
  /** THE LOT's pack, frozen at wave time, falling back to the sell-side pack (docs/17 A2). */
  caseSize: number
  mrpPaise: number | null
  /** True when an earlier-expiry lot was available and this one was taken anyway. */
  fefoOverride: boolean
  /** Picked, short with a reason, or still to do. */
  state: 'todo' | 'picked' | 'short'
}

const BOOL = (value: boolean | number | null | undefined): boolean => value === true || value === 1

/**
 * The variants a screen actually names, read BY ID.
 *
 * NEVER `useTable('product_variants', { limit: N })`. `product_variants` is the GLOBAL curated
 * catalogue (ADR 0005) — every manufacturer's every SKU, not this distributor's 29 listings — and it
 * was read whole under a 5,000-row cap against **5,768 rows on the pilot's own database**. The 768
 * that fell outside the window had no name, and the gate count printed "Item not on this phone yet"
 * over "Too Yumm Makhana Himalayan Salt 20 g": measured on the Pixel 7, invisible on the web only
 * because SQLite handed the pages back in a different order. It is the same page-one bug the
 * `tenantCatalog.list({ limit: 500 })` version had, with a bigger number in front of it — and a
 * bigger number is not a fix, because the catalogue is the one table here that grows without us.
 *
 * A screen needs a few dozen names, so it asks for those.
 */
function useVariantsByIds(ids: readonly string[]): {
  variants: Map<string, LocalVariant>
  loading: boolean
} {
  // The id SET is the identity, not the array's: a screen rebuilds `ids` inline every render.
  const key = useMemo(
    () =>
      [...new Set(ids)]
        .filter((id) => id !== '')
        .sort()
        .join(','),
    [ids],
  )
  const wanted = useMemo(() => (key === '' ? [] : key.split(',')), [key])
  const query = useMemo(
    () =>
      wanted.length === 0
        ? { where: '1 = 0', limit: 1 }
        : {
            where: `id IN (${wanted.map(() => '?').join(', ')})`,
            params: wanted,
            limit: wanted.length,
          },
    [wanted],
  )
  const { rows, loading } = useTable<LocalVariant>('product_variants', query)
  return useMemo(
    () => ({
      variants: new Map(rows.map((row) => [row.id, row])),
      loading: wanted.length > 0 && loading,
    }),
    [rows, loading, wanted.length],
  )
}

/**
 * Every LOT this distributor holds. Unlike the catalogue this one is per tenant and small (51 rows
 * on the pilot), so it is read whole — with a limit far above anything a godown can carry.
 */
function useLots(): { lots: Map<string, LocalLot>; loading: boolean } {
  const { rows, loading } = useTable<LocalLot>('stock_lots', { limit: 50000 })
  return useMemo(
    () => ({ lots: new Map(rows.map((row) => [row.id, row])), loading }),
    [rows, loading],
  )
}

/** The picklists this device holds, newest pick date first. */
export function useLocalPicklists(status?: string): {
  rows: LocalPicklist[]
  loading: boolean
} {
  const query = useMemo(
    () =>
      status === undefined
        ? { orderBy: 'pick_date DESC, created_at DESC', limit: 100 }
        : {
            where: 'status = ?',
            params: [status],
            orderBy: 'pick_date DESC, created_at DESC',
            limit: 100,
          },
    [status],
  )
  return useTable<LocalPicklist>('picklists', query)
}

export function useLocalPicklist(id: string | null): {
  sheet: LocalPicklist | null
  loading: boolean
} {
  const { rows, loading } = useTable<LocalPicklist>(
    'picklists',
    useMemo(() => ({ where: 'id = ?', params: [id ?? ''], limit: 1 }), [id]),
  )
  return { sheet: rows[0] ?? null, loading }
}

/**
 * The sheet's lines, in the order the picker walks them: still-to-do first, then what is done, and
 * within each the line number the wave was built with.
 */
export function useLocalPickLines(
  picklistId: string | null,
  orderId?: string,
): {
  rows: PickRow[]
  loading: boolean
} {
  const lines = useTable<LocalPickLine>(
    'pick_lines',
    useMemo(
      () =>
        orderId === undefined
          ? {
              where: 'picklist_id = ?',
              params: [picklistId ?? ''],
              orderBy: 'line_no ASC, id ASC',
              limit: 1000,
            }
          : {
              where: 'order_id = ?',
              params: [orderId],
              orderBy: 'line_no ASC, id ASC',
              limit: 1000,
            },
      [picklistId, orderId],
    ),
  )
  const { lots, loading: lotsLoading } = useLots()
  const variantIds = useMemo(
    () => [
      ...lines.rows.map((line) => line.variant_id),
      ...lines.rows.map((line) =>
        line.lot_id === null ? '' : (lots.get(line.lot_id)?.variant_id ?? ''),
      ),
    ],
    [lines.rows, lots],
  )
  const { variants, loading: variantsLoading } = useVariantsByIds(variantIds)
  const index = useMemo(
    () => ({ variants, lots, loading: variantsLoading || lotsLoading }),
    [variants, lots, variantsLoading, lotsLoading],
  )

  const rows = useMemo(() => {
    const built = lines.rows.map((line): PickRow => {
      const variant = index.variants.get(line.variant_id)
      const lot = line.lot_id === null ? undefined : index.lots.get(line.lot_id)
      const caseSize = line.case_size ?? lot?.case_size ?? variant?.default_case_size ?? 1
      return {
        line,
        variantName: variant?.name ?? line.variant_id,
        batchNo: lot?.batch_no === undefined || lot.batch_no === '' ? null : lot.batch_no,
        expiryDate: lot?.expiry_date ?? null,
        ean: variant?.ean ?? null,
        caseSize: caseSize > 0 ? caseSize : 1,
        mrpPaise: lot?.mrp_paise ?? variant?.mrp_paise ?? null,
        fefoOverride: BOOL(line.fefo_override),
        state:
          line.short_reason !== null && line.short_reason !== ''
            ? 'short'
            : line.picked_qty_pcs >= line.requested_qty_pcs && line.requested_qty_pcs > 0
              ? 'picked'
              : 'todo',
      }
    })
    return built.sort((a, b) => {
      const rank = (row: PickRow): number => (row.state === 'todo' ? 0 : 1)
      return rank(a) - rank(b) || a.line.line_no - b.line.line_no
    })
  }, [lines.rows, index.variants, index.lots])

  return { rows, loading: lines.loading || index.loading }
}

/**
 * Every variant this tenant has, by id — the device's own `product_variants`, which is the WHOLE
 * table for this tenant and not a page of it.
 *
 * It replaced `tenantCatalog.list({ listedOnly: false, limit: 500 })`, which looked like the obvious
 * source and was wrong in the way that shows: the pilot's catalogue is longer than 500 rows, the
 * procedure pages (`nextCursor` was set), and a `grn_lines` row whose variant fell on page two
 * printed its raw id. Measured at the gate: **"75002403-fdc3-7c6b-9792-87ddd32462dc"** where a carton
 * name belongs. `GrnLineSchema` and `CycleCountLineSchema` carry a `variantId` and no name by design
 * — the shapes are deliberately rate-free — so the name has to come from somewhere complete, and the
 * device's own copy is the only complete thing this role can read.
 */
export function useVariantNames(ids: readonly string[]): {
  names: Map<string, LocalVariant>
  loading: boolean
} {
  const { variants, loading } = useVariantsByIds(ids)
  return useMemo(() => ({ names: variants, loading }), [variants, loading])
}

/**
 * The pack a LOT is counted in, for the two screens that read `inventory.stock.balances`.
 *
 * `StockBalanceRow` carries `lotId`, `onHand` and `reserved` and **no case size at all** — the
 * balance is pieces, full stop. The van check-in printed those pieces through `caseLine(pcs, 1)`,
 * so 201 pieces of Balaji Chataka Pataka Wafers (`default_case_size` 48) read **"201 cs = 201 pc"**
 * to the loader counting them back off the vehicle. A wrong unit on a physical count is the one
 * error a check-in exists to catch.
 *
 * The device already holds `stock_lots` (their own `case_size`) and `product_variants`
 * (`default_case_size`), both whole for this tenant, so the number comes from there — and answers
 * `null` rather than guessing 1 while the read set is still arriving, which lets the caller say
 * "201 pc" instead of a case count it cannot back up.
 */
export function useLotCaseSize(): { caseSizeOf: (lotId: string) => number | null } {
  const { lots } = useLots()
  const variantIds = useMemo(() => [...lots.values()].map((lot) => lot.variant_id), [lots])
  const { variants } = useVariantsByIds(variantIds)
  return useMemo(() => {
    const caseSizeOf = (lotId: string): number | null => {
      const lot = lots.get(lotId)
      if (lot === undefined) return null
      const size = lot.case_size ?? variants.get(lot.variant_id)?.default_case_size ?? null
      return size !== null && size > 0 ? size : null
    }
    return { caseSizeOf }
  }, [lots, variants])
}

/**
 * Has this device finished ONE COMPLETE pull? "This sheet has no lines" and "the phone has not
 * finished filling up" are different sentences, and on a picking sheet the first one sends a picker
 * to an empty rack.
 *
 * It was `product_variants` having any row, and that was wrong in the one way that mattered: a cold
 * read set arrives table by table (thirteen of them, ~170 pages on the pilot's data), and
 * `product_variants` lands well before `pick_lines` — so for the ~30 seconds in between, an opened
 * sheet said **"Nothing here yet"** over four lines that were on their way. Measured on PICK-0224.
 *
 * `pulling` is true for the whole `pullLoop`, not per page (`engine.ts`), so `!pulling && lastPulledAt`
 * IS "a complete pass has finished". It is latched: the 60-second poll flips `pulling` again, and a
 * screen that fell back to "still filling" every minute would be its own lie.
 */
export function useHydrated(): boolean {
  const status = useSyncStatus()
  /*
   * `lastError === null` is load-bearing. `sync()` SWALLOWS a failure — it notes it and its `finally`
   * clears `pulling` — so an interrupted pass (a reload mid-read-set, a dead spot, a service
   * restart) leaves `pulling` false with `lastPulledAt` set from the pages that did land. Without
   * this clause the latch fired over a HALF-PULLED read set, and the picking sheet drew three of a
   * sheet's four lines as if that were the sheet. Measured: PICK-0224 rendered "0 of 3 picked" where
   * the server holds four lines, one of them already picked.
   */
  const done =
    status.ready && status.lastPulledAt !== null && !status.pulling && status.lastError === null
  const latched = useRef(false)
  if (done) latched.current = true
  return latched.current
}
