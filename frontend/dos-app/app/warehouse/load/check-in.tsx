/**
 * W9 — van check-in: the stock that came back, counted at the gate (docs/23 §4.1).
 *
 * This is the godown's half of the return leg. The crew's unsold cases and the goods a shop refused
 * are still standing on the vehicle's own stock location; the loader counts them, and what he counts
 * leaves the vehicle through `delivery.trips.unload` (QA DOS-244): the pieces of a bill that came back
 * undelivered — a shut shop, a refusal — go to the DOCK for that bill's next trip, and only the free van
 * stock goes back on the rack (docs/22 §8 ruling S1). Before, every piece went to the rack as free stock:
 * FEFO sold Balaji's returned oil to the next shop (DOS-241) and Patel's bill could never be loaded again
 * (DOS-244). Each row says which bill its pieces belong to before anything is counted, and the toast says
 * where they went. The MONEY side of the trip — the cash, the short collections, the
 * settlement — is desk work (`trips.settlementPreview` is MONEY_COLLECTORS and does not include this
 * role, docs/23 §4.1 W9), and this screen says so instead of pretending otherwise.
 *
 * The count is blind in the same sense the gate count is: what the vehicle SHOULD hold is on screen,
 * because that is what a check-in is against, but nothing is pre-filled into the pad (UX-00 §6.3:
 * "printed above the pad and never pre-filled").
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  NumberPad,
  Row,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useColors,
  useGo,
  useStrings,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'
import { useState } from 'react'

import type { StockBalanceRow } from '@dos/contracts'
import { allPages } from '../../../src/groups/warehouse/lib/all-pages'
import { useLotCaseSize } from '../../../src/groups/warehouse/lib/local'
import {
  Async,
  DeskOnly,
  ExpiryChip,
  Panel,
  PageTabs,
  qtyLine,
} from '../../../src/groups/warehouse/lib/ui'

export default function VanCheckIn(): React.JSX.Element {
  const t = useStrings()
  const go = useGo()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null

  const [vehicleId, setVehicleId] = useState<string | null>(null)
  const [counting, setCounting] = useState<StockBalanceRow | null>(null)
  const [pieces, setPieces] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const locations = useQuery(
    ['locations', 'all'],
    () => api.api.inventory.locations.list({ activeOnly: true }),
    { enabled: signedIn },
  )
  const vehicles = (locations.data?.items ?? []).filter((one) => one.kind === 'vehicle')

  /*
   * DOS-234: EVERY lot still standing on the vehicle, however long its history. A balance row stays at zero
   * once a lot has ever been on a van, so one page of 200 ordered by lot id was almost all zeros on an older
   * vehicle: Loader 2 showed 12 of its 166 pieces, then "Nothing is loaded on this vehicle" with 154 still on
   * it. The server now leaves the zeros out (`nonZero`), and the pages are followed to the end.
   */
  const balances = useQuery(
    ['balances', vehicleId ?? 'none', 'on-vehicle'],
    () =>
      allPages((cursor) =>
        api.api.inventory.stock.balances({
          locationId: vehicleId ?? '',
          nonZero: true,
          limit: 500,
          ...(cursor === null ? {} : { cursor }),
        }),
      ),
    { enabled: signedIn && vehicleId !== null },
  )

  /*
   * QA DOS-244: which of the pieces on this vehicle belong to a bill that came back and must stand on the
   * dock for its next trip. Asked of the server, which knows the trip, the bills and what is already staged.
   */
  const returns = useQuery(
    ['balances', vehicleId ?? 'none', 'van-returns'],
    () => api.api.delivery.trips.vanReturns({ vehicleLocationId: vehicleId ?? '' }),
    { enabled: signedIn && vehicleId !== null },
  )
  const forBills = (lotId: string): { pcs: number; line: string } => {
    const owed = (returns.data?.items ?? []).filter((item) => item.lotId === lotId && item.pcs > 0)
    return {
      pcs: owed.reduce((n, item) => n + item.pcs, 0),
      line: owed
        .map((item) =>
          t('w9.forBill', {
            count: item.pcs,
            bill: item.invoiceNo ?? t('w9.aBill'),
            shop: item.retailerName,
          }),
        )
        .join(' · '),
    }
  }

  const moveBack = useMutation(
    (input: { lotId: string; qtyPcs: number }, meta) =>
      api.api.delivery.trips.unload({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        vehicleLocationId: vehicleId ?? '',
        lotId: input.lotId,
        qtyPcs: input.qtyPcs,
      }),
    {
      invalidates: [['balances']],
      onSuccess: (reply) => {
        haptics.success()
        setCounting(null)
        setPieces(null)
        setToast(
          reply.dockPcs > 0
            ? reply.rackPcs > 0
              ? t('w9.movedBoth', {
                  dock: reply.dockPcs,
                  rack: reply.rackPcs,
                  bills: reply.bills.map((b) => b.invoiceNo ?? b.retailerName).join(', '),
                })
              : t('w9.movedDock', {
                  dock: reply.dockPcs,
                  bills: reply.bills.map((b) => b.invoiceNo ?? b.retailerName).join(', '),
                })
            : t('w9.moved'),
        )
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  /*
   * DOS-049: only what the vehicle still holds. `stock.balances` keeps a row at zero once a lot has
   * ever stood in a location, and "EXPECTED ON THE VEHICLE" listed those too — a "0 pc" row with a
   * count pad behind it, which is either noise or an invitation to a stray transfer.
   */
  const rows = (balances.data?.items ?? []).filter((row) => row.onHand > 0)
  /*
   * `StockBalanceRow` carries no case size (the balance is pieces), and this line used to be
   * `caseLine(row.onHand, 1, t)` — so 201 pieces of a 48-piece case printed "201 cs = 201 pc" to
   * the loader counting them back off the vehicle. The pack comes from the device's own lots.
   */
  const { caseSizeOf } = useLotCaseSize()

  return (
    <Screen title={t('w9.title')} context={session?.tenant.displayName} testID="w9-screen">
      <Stack gap={6}>
        <PageTabs group={go.href('/load')} active={go.href('/load/check-in')} />

        <Txt field="body" desk="body" color={colors.text.secondary}>
          {t('w9.body')}
        </Txt>

        <Panel title={t('w.vehicle')} testID="w9-vehicles">
          <Async state={locations} empty={vehicles.length === 0}>
            <Group>
              {vehicles.map((location) => (
                <ListRow
                  key={location.id}
                  testID={`w9-vehicle-${location.id}`}
                  primary={location.name}
                  state={location.id === vehicleId ? 'selected' : 'default'}
                  onPress={() => {
                    setVehicleId(location.id === vehicleId ? null : location.id)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        {vehicleId === null ? null : (
          <Panel
            title={t('w9.expectedOnVan')}
            {...(rows.length === 0
              ? {}
              : {
                  meta: t('w9.onVan', {
                    count: rows.reduce((n, row) => n + row.onHand, 0),
                    lots: rows.length,
                  }),
                })}
            testID="w9-stock"
          >
            <Async state={balances} empty={rows.length === 0} emptyMessage={t('w9.expectedEmpty')}>
              <Group>
                {rows.map((row) => {
                  const bills = forBills(row.lotId)
                  const batch = row.batchNo === '' ? null : t('w.batch', { batch: row.batchNo })
                  return (
                    <ListRow
                      key={`${row.lotId}-${row.locationId}`}
                      testID={`w9-lot-${row.lotId}`}
                      primary={row.variantName}
                      secondary={qtyLine(row.onHand, caseSizeOf(row.lotId), t)}
                      trailing={<ExpiryChip expiryDate={row.expiryDate} />}
                      {...(bills.pcs > 0
                        ? {
                            state: 'needsAttention' as const,
                            reason: [batch, bills.line].filter((p) => p !== null).join(' · '),
                          }
                        : batch === null
                          ? {}
                          : { reason: batch })}
                      onPress={() => {
                        moveBack.reset()
                        setCounting(row)
                        setPieces(null)
                      }}
                    />
                  )
                })}
              </Group>
              {balances.data?.complete === false ? (
                <Txt field="body" desk="body" color={colors.status.brick.fg} testID="w9-partial">
                  {t('w9.partial', { lots: rows.length })}
                </Txt>
              ) : null}
            </Async>
          </Panel>
        )}

        <DeskOnly>{t('w9.settlementIsDesk')}</DeskOnly>
      </Stack>

      <Sheet
        open={counting !== null}
        onClose={() => {
          setCounting(null)
        }}
        title={counting?.variantName ?? ''}
        testID="w9-sheet"
      >
        <Stack gap={4}>
          {/* The refusal sits in the sheet, where the count was pressed — never behind it. */}
          {moveBack.error === undefined ? null : (
            <Txt field="body" desk="body" color={colors.status.brick.fg} testID="w9-refusal">
              {moveBack.error.message}
            </Txt>
          )}
          <NumberPad
            testID="w9-pad"
            mode="count"
            label={t('w9.pieces')}
            value={pieces}
            expected={counting?.onHand ?? null}
            expectedLabel={t('w9.countedBack', {
              counted: pieces ?? 0,
              expected: counting?.onHand ?? 0,
            })}
            onChange={setPieces}
            doneLabel={
              counting !== null && forBills(counting.lotId).pcs > 0
                ? t('w9.moveBackSplit')
                : t('w9.moveBack')
            }
            onDone={() => {
              if (counting === null || pieces === null || pieces <= 0) return
              moveBack.mutate({ lotId: counting.lotId, qtyPcs: pieces })
            }}
          />
          {counting === null || forBills(counting.lotId).pcs === 0 ? null : (
            <Txt field="body" desk="body" testID="w9-to-dock">
              {t('w9.toDock', { line: forBills(counting.lotId).line })}
            </Txt>
          )}
          {counting === null || pieces === null ? null : (
            <Row gap={3} wrap>
              <StatusChip
                label={
                  pieces === counting.onHand
                    ? t('w9.match')
                    : pieces < counting.onHand
                      ? t('w9.short', { count: counting.onHand - pieces })
                      : t('w9.over', { count: pieces - counting.onHand })
                }
                family={pieces === counting.onHand ? 'moss' : 'ochre'}
                testID="w9-variance"
              />
            </Row>
          )}
          <Button
            label={t('w.close')}
            variant="ghost"
            onPress={() => {
              setCounting(null)
            }}
            testID="w9-cancel"
          />
        </Stack>
      </Sheet>
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="w9-toast"
      />
    </Screen>
  )
}
