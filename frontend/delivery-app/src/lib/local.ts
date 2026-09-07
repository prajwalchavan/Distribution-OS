/**
 * What the crew's phone reads off its own SQLite, and what it may write back.
 *
 * docs/23 §5.4: "a driver is out of coverage for hours" — so this is the one app where the DEVICE is
 * the primary source for the screens that decide something at a shop door (D1, D3, D4, D5, D8, D10),
 * and the service is what fills the device in. `sync.manifest` publishes NINETEEN tables for the
 * delivery role and exactly three of them are writable (`warehouse` gets one):
 *
 *   `trip_stops`   PATCH state -> started | arrived | failed
 *   `deliveries`   PUT with its lines and its proof INLINE (the doorstep write is one fact)
 *   `receipts`     PUT — money taken at the door
 *
 * WHAT IS NOT HERE, AND WHY IT MATTERS. `collections`, `trip_expenses` and `pod_evidence` all have
 * server-side sync handlers (`delivery.sync.ts` registers them) but are absent from
 * `SYNC_PULL_TABLES`, so `SyncRegistry.manifest()` can never mark them writable and
 * `engine.enqueue()` refuses them by name. A doorstep receipt collected with no signal therefore
 * reaches receivables as a RECEIPT (correctly allocated, correctly posted to the trip's cash account,
 * because the handler takes `trip_id`) and does NOT write the trip's own `collections` row — which is
 * what `trips.settlementPreview` adds up. The screens say so rather than pretending; the backend half
 * is in the slice report's open points.
 *
 * The joins below are done in JS because `useTable` is one table at a time by design (docs/27 §11):
 * a trip is a dozen stops and a few dozen bills, and a join written as SQL in a screen is the first
 * step towards a screen that writes SQL.
 */
import { useSyncStatus, useTable } from '@dos/offline/react'
import { useMemo } from 'react'

// ---------------------------------------------------------------------------
// The rows, exactly as `sync.pull` delivers them (snake_case, SQLite scalars)
// ---------------------------------------------------------------------------

/** SQLite has no boolean: the manifest's `boolean` columns arrive as 0 / 1. */
export const bool = (value: boolean | number | null | undefined): boolean =>
  value === true || value === 1

export interface LocalTrip {
  id: string
  trip_no: string | null
  trip_date: string
  vehicle_id: string
  driver_id: string | null
  helper_id: string | null
  state: string
  van_sales_enabled: boolean | number
  planned_stops: number
  start_odometer_km: number | null
  end_odometer_km: number | null
  opening_cash_paise: number
  started_at: string | null
  ended_at: string | null
  updated_at: string
}

export interface LocalStop {
  id: string
  trip_id: string
  sequence: number
  retailer_id: string
  state: string
  failure_reason: string | null
  failure_note: string | null
  planned_collection_paise: number | null
  eta_at: string | null
  started_at: string | null
  arrived_at: string | null
  completed_at: string | null
  arrived_lat: number | null
  arrived_lng: number | null
  updated_at: string
  _pending?: 'queued' | 'sending' | 'rejected' | null
}

export interface LocalDelivery {
  id: string
  trip_id: string
  stop_id: string
  retailer_id: string
  order_id: string | null
  invoice_id: string
  outcome: string | null
  delivered_by: string | null
  delivered_at: string | null
  receiver_name: string | null
  note: string | null
  device_id: string | null
  updated_at: string
  _pending?: 'queued' | 'sending' | 'rejected' | null
}

export interface LocalInvoice {
  id: string
  invoice_no: string | null
  invoice_date: string
  retailer_id: string
  order_id: string | null
  state: string
  buyer_name: string | null
  total_paise: number
  due_date: string | null
  upi_qr_payload: string | null
  updated_at: string
}

export interface LocalInvoiceLine {
  id: string
  invoice_id: string
  line_no: number
  variant_id: string
  lot_id: string | null
  description: string
  batch_no: string | null
  expiry_date: string | null
  mrp_paise: number | null
  qty_pcs: number
  free_qty_pcs: number
  case_size: number | null
  rate_paise: number
  line_total_paise: number
}

export interface LocalRetailer {
  id: string
  name: string
  owner_name: string | null
  phone: string | null
  address: string | null
  lat: number | null
  lng: number | null
  gstin: string | null
  payment_terms: string
  credit_mode: string | null
}

export interface LocalOutstanding {
  retailer_id: string
  outstanding_paise: number
  overdue_paise: number
  unallocated_credit_paise: number
  open_bills: number
  oldest_due_date: string | null
  as_of: string
}

export interface LocalReceipt {
  id: string
  receipt_no: string | null
  retailer_id: string
  mode: string
  amount_paise: number
  received_at: string
  trip_id: string | null
  reference: string | null
  client_receipt_no: string | null
  status: string
  _pending?: 'queued' | 'sending' | 'rejected' | null
}

export interface LocalVehicle {
  id: string
  reg_no: string
  name: string | null
  kind: string
  location_id: string
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/**
 * Has this device finished ONE COMPLETE pull? "This stop has no bills" and "the phone has not
 * finished filling up" are different sentences, and at a shop door the first one sends a driver away.
 *
 * `pulling` is true for the whole `pullLoop`, not per page, so `!pulling && lastPulledAt` IS "a
 * complete pass has finished". `lastError === null` is load-bearing: `sync()` swallows a failure and
 * its `finally` clears `pulling`, so an interrupted pass would otherwise latch over a half-filled
 * device. It is latched because the 60-second poll flips `pulling` again, and a screen that fell back
 * to "still filling" every minute would be its own lie.
 */
let devicePulled = false

export function useHydrated(): boolean {
  const status = useSyncStatus()
  /*
   * THE LATCH IS SESSION-WIDE, NOT PER COMPONENT, and that is the whole point of it.
   *
   * Held in a `useRef` it starts false in every screen that mounts — so a stop opened DURING the
   * 60-second poll (`pulling` true again over a device that is already complete) drew "Still filling
   * this phone from the office" over a full set of bills. Measured on the stop for Navjeevan Stores:
   * the sentence, and the bill row printing the invoice's raw id, on a device that had finished its
   * read set thirty seconds earlier on the home screen. A driver pushes into a stop constantly; the
   * fact being latched is a fact about the DEVICE, not about this render tree.
   *
   * It resets when the engine does (`ready` false on a sign-out, a distributor switch or a schema
   * change), which is exactly when the device stops being complete.
   */
  if (!status.ready) devicePulled = false
  if (status.ready && status.lastPulledAt !== null && !status.pulling && status.lastError === null)
    devicePulled = true
  return devicePulled
}

// ---------------------------------------------------------------------------
// The trip
// ---------------------------------------------------------------------------

const OPEN_STATES = ['active', 'loading', 'planned', 'closing'] as const

/**
 * The trip this crew member is on, from the device.
 *
 * "Today's" is deliberately not a date filter. `trips_read` already narrows a delivery actor to the
 * trips it is crew on, and a trip that left at six in the morning and is checked in at eleven at
 * night crosses the IST business date it was planned for — so the app opens on the OPEN trip
 * (`active` first, then `closing`, then a `loading` or `planned` one), and prints its date. A driver
 * whose van is on the road at 00:05 must not be told there is no trip today.
 */
export function useLocalTrips(): { rows: LocalTrip[]; loading: boolean } {
  return useTable<LocalTrip>(
    'trips',
    useMemo(
      () => ({
        where: `state IN (${OPEN_STATES.map(() => '?').join(', ')})`,
        params: [...OPEN_STATES],
        orderBy: 'trip_date DESC, created_at DESC',
        limit: 50,
      }),
      [],
    ),
  )
}

/** The open trip a crew member should be looking at, and the others behind it. */
export function pickCurrentTrip(trips: readonly LocalTrip[]): LocalTrip | null {
  const rank = (state: string): number => OPEN_STATES.indexOf(state as (typeof OPEN_STATES)[number])
  const sorted = [...trips].sort(
    (a, b) => rank(a.state) - rank(b.state) || (a.trip_date < b.trip_date ? 1 : -1),
  )
  return sorted[0] ?? null
}

export function useLocalTrip(id: string | null): { trip: LocalTrip | null; loading: boolean } {
  const { rows, loading } = useTable<LocalTrip>(
    'trips',
    useMemo(() => ({ where: 'id = ?', params: [id ?? ''], limit: 1 }), [id]),
  )
  return { trip: rows[0] ?? null, loading }
}

export function useLocalStops(tripId: string | null): { rows: LocalStop[]; loading: boolean } {
  return useTable<LocalStop>(
    'trip_stops',
    useMemo(
      () => ({
        where: 'trip_id = ?',
        params: [tripId ?? ''],
        orderBy: 'sequence ASC, id ASC',
        limit: 200,
      }),
      [tripId],
    ),
  )
}

export function useLocalStop(id: string | null): { stop: LocalStop | null; loading: boolean } {
  const { rows, loading } = useTable<LocalStop>(
    'trip_stops',
    useMemo(() => ({ where: 'id = ?', params: [id ?? ''], limit: 1 }), [id]),
  )
  return { stop: rows[0] ?? null, loading }
}

/** The deliveries planned for (or recorded at) one stop — the row `deliveries.record` completes. */
export function useLocalDeliveries(stopId: string | null): {
  rows: LocalDelivery[]
  loading: boolean
} {
  return useTable<LocalDelivery>(
    'deliveries',
    useMemo(
      () => ({
        where: 'stop_id = ?',
        params: [stopId ?? ''],
        orderBy: 'created_at ASC',
        limit: 60,
      }),
      [stopId],
    ),
  )
}

export function useLocalTripDeliveries(tripId: string | null): {
  rows: LocalDelivery[]
  loading: boolean
} {
  return useTable<LocalDelivery>(
    'deliveries',
    useMemo(
      () => ({
        where: 'trip_id = ?',
        params: [tripId ?? ''],
        orderBy: 'created_at ASC',
        limit: 400,
      }),
      [tripId],
    ),
  )
}

// ---------------------------------------------------------------------------
// The shop, its bills and its dues — read BY ID, never as a page of a big table
// ---------------------------------------------------------------------------

/** A stable identity for a set of ids, so a screen may build the array inline every render. */
function useIdSet(ids: readonly string[]): string[] {
  const key = useMemo(
    () =>
      [...new Set(ids)]
        .filter((id) => id !== '' && id !== null && id !== undefined)
        .sort()
        .join(','),
    [ids],
  )
  return useMemo(() => (key === '' ? [] : key.split(',')), [key])
}

function byIdQuery(column: string, wanted: readonly string[]): Record<string, unknown> {
  if (wanted.length === 0) return { where: '1 = 0', limit: 1 }
  return {
    where: `${column} IN (${wanted.map(() => '?').join(', ')})`,
    params: [...wanted],
    limit: Math.max(wanted.length, 1) * 200,
  }
}

export function useLocalRetailers(ids: readonly string[]): {
  byId: Map<string, LocalRetailer>
  loading: boolean
} {
  const wanted = useIdSet(ids)
  const query = useMemo(() => byIdQuery('id', wanted), [wanted])
  const { rows, loading } = useTable<LocalRetailer>('retailers', query)
  return useMemo(
    () => ({
      byId: new Map(rows.map((row) => [row.id, row])),
      loading: wanted.length > 0 && loading,
    }),
    [rows, loading, wanted.length],
  )
}

export function useLocalInvoices(ids: readonly string[]): {
  byId: Map<string, LocalInvoice>
  loading: boolean
} {
  const wanted = useIdSet(ids)
  const query = useMemo(() => byIdQuery('id', wanted), [wanted])
  const { rows, loading } = useTable<LocalInvoice>('invoices', query)
  return useMemo(
    () => ({
      byId: new Map(rows.map((row) => [row.id, row])),
      loading: wanted.length > 0 && loading,
    }),
    [rows, loading, wanted.length],
  )
}

/** The lines of ONE bill, in the order they are printed on it. */
export function useLocalInvoiceLines(invoiceId: string | null): {
  rows: LocalInvoiceLine[]
  loading: boolean
} {
  return useTable<LocalInvoiceLine>(
    'invoice_lines',
    useMemo(
      () => ({
        where: 'invoice_id = ?',
        params: [invoiceId ?? ''],
        orderBy: 'line_no ASC',
        limit: 400,
      }),
      [invoiceId],
    ),
  )
}

export function useLocalOutstanding(retailerId: string | null): {
  row: LocalOutstanding | null
  loading: boolean
} {
  const { rows, loading } = useTable<LocalOutstanding>(
    'retailer_outstanding_summary',
    useMemo(
      () => ({ where: 'retailer_id = ?', params: [retailerId ?? ''], limit: 1 }),
      [retailerId],
    ),
  )
  return { row: rows[0] ?? null, loading }
}

/** Receipts written on this trip — including the ones still in the outbox, which is the point. */
export function useLocalTripReceipts(tripId: string | null): {
  rows: LocalReceipt[]
  loading: boolean
} {
  return useTable<LocalReceipt>(
    'receipts',
    useMemo(
      () => ({
        where: 'trip_id = ?',
        params: [tripId ?? ''],
        orderBy: 'received_at DESC',
        limit: 200,
      }),
      [tripId],
    ),
  )
}

export function useLocalVehicle(id: string | null): {
  vehicle: LocalVehicle | null
  loading: boolean
} {
  const { rows, loading } = useTable<LocalVehicle>(
    'vehicles',
    useMemo(() => ({ where: 'id = ?', params: [id ?? ''], limit: 1 }), [id]),
  )
  return { vehicle: rows[0] ?? null, loading }
}

// ---------------------------------------------------------------------------
// Derived facts a screen would otherwise re-derive three times
// ---------------------------------------------------------------------------

/** A stop is finished when it can take no more work at the door. */
export function isStopTerminal(state: string): boolean {
  return state === 'delivered' || state === 'partial' || state === 'failed' || state === 'skipped'
}

/**
 * The next stop to drive to: the first by `sequence` that is not finished. Null when the road is
 * done and it is time to head back.
 */
export function nextOpenStop(stops: readonly LocalStop[]): LocalStop | null {
  return (
    [...stops].sort((a, b) => a.sequence - b.sequence).find((s) => !isStopTerminal(s.state)) ?? null
  )
}

/**
 * The address of a shop as one line.
 *
 * `retailers.address` is `jsonb` on the wire and TEXT in the device's SQLite (`sync.pull` sends what
 * Postgres gives it), so a screen gets a string it has to parse. A malformed one prints nothing
 * rather than throwing on a road with no signal.
 */
export function addressLine(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  let value: unknown = raw
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      value = JSON.parse(raw)
    } catch {
      return raw
    }
  }
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return null
  const parts = value as Record<string, unknown>
  const line = ['line1', 'line2', 'area', 'city', 'pincode']
    .map((key) => (typeof parts[key] === 'string' ? parts[key] : ''))
    .filter((part) => part !== '')
    .join(', ')
  return line === '' ? null : line
}
