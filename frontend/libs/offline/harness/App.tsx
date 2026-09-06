/**
 * The offline harness — `@dos/offline` against the REAL sales-service, driven by hand in a browser.
 *
 * Everything on this page is the library doing its own work: the manifest handshake, the snapshot,
 * the local SQLite (or the memory fallback, which says so), the outbox, the replay and the tray. The
 * only thing the harness adds is a switch that makes the transport behave like a dead spot, because
 * that is the one condition a laptop on a desk will not produce by itself.
 *
 * Walk it: sign in as `rahul.deshmukh` / `Dos@1234` → the read set lands → Go offline → queue a draft
 * order → the row appears at once, marked waiting → Come back → the queue drains, once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createApiClient, type ApiClient } from '@dos/api-client'
import { uuidv7 } from '@dos/domain'
import { connectionStateFrom, openStore, transportFromApi, type SyncTransport } from '@dos/offline'
import {
  OfflineProvider,
  useNeedsAttention,
  useOutbox,
  useSyncEngine,
  useSyncStatus,
  useTable,
} from '@dos/offline/react'
import {
  Button,
  ConnectionStrip,
  Eyebrow,
  Group,
  ListRow,
  MapView,
  Row,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  ThemeProvider,
  Txt,
  type MapMarker,
} from '@dos/ui/web'

const AUTH_URL = 'http://127.0.0.1:3000'
const API_URL = 'http://127.0.0.1:3003'
const DEVICE_KEY = 'dos.harness.device'

function deviceId(): string {
  const held = localStorage.getItem(DEVICE_KEY)
  if (held !== null) return held
  const fresh = uuidv7()
  localStorage.setItem(DEVICE_KEY, fresh)
  return fresh
}

/**
 * A dead spot, on demand. It wraps the real transport rather than the fetch, so what is proved is
 * exactly what the engine does when a call never answers — the same path a rep's phone takes under
 * the flyover on the Kalyan road.
 */
function gate(inner: SyncTransport, offline: () => boolean): SyncTransport {
  const guard = <T,>(fn: () => Promise<T>): Promise<T> => {
    if (offline()) return Promise.reject(new TypeError('Failed to fetch'))
    return fn()
  }
  return {
    manifest: (input) => guard(() => inner.manifest(input)),
    pull: (input) => guard(() => inner.pull(input)),
    upload: (input) => guard(() => inner.upload(input)),
    ...(inner.listErrors === undefined
      ? {}
      : { listErrors: (input) => guard(() => inner.listErrors!(input)) }),
  }
}

export function App(): React.JSX.Element {
  const [client, setClient] = useState<ApiClient | null>(null)
  const [username, setUsername] = useState('rahul.deshmukh')
  const [password, setPassword] = useState('Dos@1234')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const offlineRef = useRef(offline)
  offlineRef.current = offline
  const [log, setLog] = useState<string[]>([])

  const device = useMemo(deviceId, [])

  const signIn = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const api = createApiClient({ apiUrl: API_URL, authUrl: AUTH_URL, platform: 'web' })
      await api.signIn({ username, password })
      setClient(api)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [username, password])

  const transport = useMemo(
    () => (client === null ? null : gate(transportFromApi(client.api), () => offlineRef.current)),
    [client],
  )

  const onLog = useCallback((line: string) => {
    setLog((lines) => [`${new Date().toLocaleTimeString()} ${line}`, ...lines].slice(0, 12))
  }, [])

  return (
    /*
     * `touch="phone"`, not `"desk"`: this page reviews the client a REP's phone runs, and the floor
     * has to follow the viewport the way an app's does (UX-00 §5.2, docs/08 §0). Declaring desk kept
     * every row in the map's list at 32 px on a 375 px screen — under the touch floor, on the one
     * surface where it is measured.
     */
    <ThemeProvider touch="phone" tenant={{ name: 'Offline harness' }}>
      {client === null || transport === null ? (
        <Screen title="Offline sync harness" context="@dos/offline · docs/27">
          <Stack gap={3}>
            <Txt field="body" desk="body" as="div">
              Sign in as a salesperson; sales-service on :3003 and auth-service on :3000 must be
              running.
            </Txt>
            <TextInput label="Username" value={username} onChange={setUsername} />
            <TextInput label="Password" value={password} onChange={setPassword} secure />
            <Button label="Sign in" onPress={() => void signIn()} loading={busy} />
            {error === null ? null : (
              <Txt field="body" desk="body" as="div">
                {error}
              </Txt>
            )}
          </Stack>
        </Screen>
      ) : (
        <OfflineProvider
          transport={transport}
          deviceId={device}
          storeFactory={openStore}
          databaseName="dos-harness.db"
          /*
           * The REAL foreground poll (docs/27 §5), not a switched-off one. Turning it off here is how
           * a device that stopped pulling after its first minute went unseen: leave the page open for
           * two minutes and "last pulled" must keep moving.
           */
          onLog={onLog}
        >
          <Board offline={offline} onToggleOffline={setOffline} log={log} />
        </OfflineProvider>
      )}
    </ThemeProvider>
  )
}

interface BoardProps {
  offline: boolean
  onToggleOffline: (offline: boolean) => void
  log: readonly string[]
}

function Board({ offline, onToggleOffline, log }: BoardProps): React.JSX.Element {
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const outbox = useOutbox()
  const attention = useNeedsAttention()
  const [counts, setCounts] = useState<{ table: string; rows: number; writable: boolean }[]>([])

  const shops = useTable<{ id: string; name: string; lat: number | null; lng: number | null }>(
    'retailers',
    { orderBy: 'name ASC', limit: 40 },
  )
  const orders = useTable<{
    id: string
    retailer_id: string
    state: string | null
    _pending: string | null
    /*
     * `_local_rev` first: a row this device has touched sorts above the 432 the server sent, whatever
     * its id. Ordering by id alone hid the order that had just been queued below a page of seed data
     * — which is the one row the person watching this page is looking for.
     */
  }>('sales_orders', { orderBy: '_local_rev DESC, id DESC', limit: 8 })

  useEffect(() => {
    if (engine === null) return
    let live = true
    const run = (): void => {
      void (async () => {
        const tables = engine.tables()
        const rows = await Promise.all(
          tables.map(async (table) => ({
            table: table.table,
            writable: table.writable,
            rows: await engine.countRows(table.table),
          })),
        )
        if (live) setCounts(rows.filter((row) => row.rows > 0 || row.writable))
      })()
    }
    run()
    const off = engine.onTables(run)
    return () => {
      live = false
      off()
    }
  }, [engine, status.lastPulledAt])

  const markers: MapMarker[] = shops.rows
    .filter((shop) => shop.lat !== null && shop.lng !== null)
    .slice(0, 25)
    .map((shop) => ({
      id: shop.id,
      label: shop.name,
      latitude: shop.lat!,
      longitude: shop.lng!,
      tone: 'moss' as const,
    }))

  const queueOrder = (): void => {
    const shop = shops.rows[0]
    if (engine === null || shop === undefined) return
    void engine.enqueue({
      table: 'sales_orders',
      id: uuidv7(),
      op: 'PUT',
      data: {
        retailer_id: shop.id,
        state: 'draft',
        source: 'salesperson',
        note: 'Queued from the offline harness',
      },
    })
  }

  return (
    <Screen
      title="Offline sync harness"
      context={`device ${status.store} · schema ${status.schemaVersion ?? '—'}`}
      actions={
        /*
         * `wrap`, because three verbs do not fit across a 375 px phone: an unwrapped `<Row>` is one
         * unbreakable flex item, so the header's own wrapping had nothing to wrap and "Queue a draft
         * order" ran 40 px off the right edge of a page that cannot be scrolled sideways.
         */
        <Row gap={2} wrap>
          <Button
            label={offline ? 'Come back online' : 'Go offline'}
            variant={offline ? 'primary' : 'secondary'}
            /*
             * The switch is the RADIO, not just the fake transport: a real phone's platform layer
             * calls `setNetworkHint` from NetInfo or the browser's own online/offline event, and that
             * is what clears the backoff and pulls straight away. Flipping only the transport left
             * this page waiting out an 8-second backoff after "Come back online" and never proved the
             * path an app actually takes.
             */
            onPress={() => {
              const next = !offline
              onToggleOffline(next)
              engine?.setNetworkHint(!next)
            }}
          />
          <Button
            label="Pull now"
            variant="secondary"
            onPress={() => void engine?.sync('harness')}
          />
          <Button label="Queue a draft order" onPress={queueOrder} />
        </Row>
      }
    >
      <Stack gap={4}>
        <ConnectionStrip state={connectionStateFrom(status)} />
        {status.persistent ? null : (
          <Txt field="label" desk="meta" as="div">
            Offline data is not saved on this browser (memory store).
          </Txt>
        )}

        <Group title="Status">
          <Stack gap={1}>
            <Txt field="body" desk="cell" as="div" numeric>
              {`online ${String(status.online)} · store ${status.store} · pulling ${String(
                status.pulling,
              )} · uploading ${String(status.uploading)}`}
            </Txt>
            <Txt field="body" desk="cell" as="div" numeric>
              {`pending ${String(status.pending)} · rejected ${String(
                status.rejected,
              )} · last pulled ${status.lastPulledAt ?? 'never'}`}
            </Txt>
            {status.lastError === null ? null : (
              <Txt field="label" desk="meta" as="div">
                {`last error: ${status.lastError}`}
              </Txt>
            )}
          </Stack>
        </Group>

        <Group title={`Outbox (${String(outbox.rows.length)})`}>
          <Stack gap={1}>
            {outbox.rows.length === 0 ? (
              <Txt field="body" desk="body" as="div">
                Nothing queued.
              </Txt>
            ) : (
              outbox.rows.map((op) => (
                <ListRow
                  key={op.opId}
                  primary={`${op.op} ${op.table}`}
                  secondary={`${op.rowId} · attempts ${String(op.attempts)} · ${op.opId}`}
                  trailing={
                    <StatusChip
                      family={
                        op.status === 'acked'
                          ? 'moss'
                          : op.status === 'rejected'
                            ? 'brick'
                            : 'ochre'
                      }
                      label={op.status}
                    />
                  }
                />
              ))
            )}
          </Stack>
        </Group>

        <Group title={`Needs attention (${String(attention.items.length)})`}>
          <Stack gap={1}>
            {attention.items.length === 0 ? (
              <Txt field="body" desk="body" as="div">
                No rejected writes.
              </Txt>
            ) : (
              attention.items.map((item) => (
                <ListRow
                  key={item.error.opId}
                  primary={`${item.error.table} · ${item.error.code}`}
                  secondary={item.error.message}
                  reason={item.serverRow === null ? undefined : 'The server holds a newer version'}
                  trailing={
                    <Row gap={1}>
                      <Button
                        label="Send again"
                        variant="secondary"
                        onPress={() => void outbox.retry(item.error.opId)}
                      />
                      <Button
                        label="Discard"
                        variant="destructive"
                        onPress={() => void outbox.discard(item.error.opId)}
                      />
                    </Row>
                  }
                />
              ))
            )}
          </Stack>
        </Group>

        <Group title={`Draft orders on this device (${String(orders.rows.length)})`}>
          <Stack gap={1}>
            {orders.rows.map((order) => (
              <ListRow
                key={order.id}
                primary={order.id}
                secondary={`shop ${order.retailer_id} · ${order.state ?? '—'}`}
                trailing={
                  order._pending === null ? (
                    <StatusChip family="moss" label="synced" />
                  ) : (
                    <StatusChip family="ochre" label={order._pending} />
                  )
                }
              />
            ))}
          </Stack>
        </Group>

        <Group title={`Shops on this device (${String(shops.rows.length)})`}>
          <MapView markers={markers} height={320} />
        </Group>

        <Group
          title={`Read set (${String(counts.length)} tables · ${String(
            counts.reduce((total, row) => total + row.rows, 0),
          )} rows on this device)`}
        >
          <Txt field="body" desk="cell" as="div" numeric>
            {counts
              .map((row) => `${row.table} ${String(row.rows)}${row.writable ? ' (writable)' : ''}`)
              .join(' · ')}
          </Txt>
        </Group>

        <Group title="Engine log">
          <Stack gap={1}>
            <Eyebrow>latest first</Eyebrow>
            {log.map((line) => (
              <Txt key={line} field="label" desk="meta" as="div">
                {line}
              </Txt>
            ))}
          </Stack>
        </Group>
      </Stack>
    </Screen>
  )
}
