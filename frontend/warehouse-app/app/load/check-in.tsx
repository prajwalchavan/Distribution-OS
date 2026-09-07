/**
 * W9 — van check-in: the stock that came back, counted at the gate (docs/23 §4.1).
 *
 * This is the godown's half of the return leg. The crew's unsold cases and the goods a shop refused
 * are still standing on the vehicle's own stock location; the loader counts them, and what he counts
 * is moved back to the godown as a real `transfer_out` / `transfer_in` pair through
 * `inventory.stock.transfer`. The MONEY side of the trip — the cash, the short collections, the
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
  useStrings,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'
import { useState } from 'react'

import type { StockBalanceRow } from '@dos/contracts'
import { useLotCaseSize } from '../../src/lib/local'
import { Async, DeskOnly, ExpiryChip, Panel, PageTabs, qtyLine } from '../../src/lib/ui'

export default function VanCheckIn(): React.JSX.Element {
  const t = useStrings()
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
  const godown = (locations.data?.items ?? []).find((one) => one.kind === 'warehouse') ?? null

  const balances = useQuery(
    ['balances', vehicleId ?? 'none'],
    () => api.api.inventory.stock.balances({ locationId: vehicleId ?? '', limit: 200 }),
    { enabled: signedIn && vehicleId !== null },
  )

  const moveBack = useMutation(
    (input: { lotId: string; qtyPcs: number }, meta) =>
      api.api.inventory.stock.transfer({
        idempotencyKey: meta.idempotencyKey,
        lotId: input.lotId,
        fromLocationId: vehicleId ?? '',
        toLocationId: godown?.id ?? '',
        qtyPcs: input.qtyPcs,
      }),
    {
      invalidates: [['balances']],
      onSuccess: () => {
        haptics.success()
        setCounting(null)
        setPieces(null)
        setToast(t('w9.moved'))
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const rows = balances.data?.items ?? []
  /*
   * `StockBalanceRow` carries no case size (the balance is pieces), and this line used to be
   * `caseLine(row.onHand, 1, t)` — so 201 pieces of a 48-piece case printed "201 cs = 201 pc" to
   * the loader counting them back off the vehicle. The pack comes from the device's own lots.
   */
  const { caseSizeOf } = useLotCaseSize()

  return (
    <Screen title={t('w9.title')} context={session?.tenant.displayName} testID="w9-screen">
      <Stack gap={6}>
        <PageTabs group="/load" active="/load/check-in" />

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
          <Panel title={t('w9.expectedOnVan')} testID="w9-stock">
            <Async state={balances} empty={rows.length === 0} emptyMessage={t('w9.expectedEmpty')}>
              <Group>
                {rows.map((row) => (
                  <ListRow
                    key={`${row.lotId}-${row.locationId}`}
                    testID={`w9-lot-${row.lotId}`}
                    primary={row.variantName}
                    secondary={qtyLine(row.onHand, caseSizeOf(row.lotId), t)}
                    trailing={<ExpiryChip expiryDate={row.expiryDate} />}
                    {...(row.batchNo === ''
                      ? {}
                      : { reason: t('w.batch', { batch: row.batchNo }) })}
                    onPress={() => {
                      setCounting(row)
                      setPieces(null)
                    }}
                  />
                ))}
              </Group>
            </Async>
          </Panel>
        )}

        <DeskOnly>{t('w9.settlementIsDesk')}</DeskOnly>

        {moveBack.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {moveBack.error.message}
          </Txt>
        )}
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
            doneLabel={t('w9.moveBack')}
            onDone={() => {
              if (counting === null || pieces === null || pieces <= 0) return
              moveBack.mutate({ lotId: counting.lotId, qtyPcs: pieces })
            }}
          />
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
