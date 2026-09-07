/**
 * W7 (list) — the load sheets, and building a new one (docs/23 §4.1).
 *
 * A sheet is built WITHOUT moving anything: pick the vehicle, pick the packed orders, and the sheet
 * exists as paper. Stock moves at check-out, and check-out waits for the manager (docs/22 decision
 * 2026-09-05) — which is why every draft row here says whose step is next rather than showing a
 * button that would 403.
 *
 * The orders are kept in the order they are chosen, because "last stop first" is a loading decision
 * the floor makes and the server deliberately does not: reading `trip_stops` would make warehouse
 * depend on delivery (coordination §4 item 3).
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { newId } from '@dos/api-client'
import { haptics } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { shortDate } from '../../src/lib/dates'
import { Async, Panel, PageTabs, workFamily } from '../../src/lib/ui'

export default function LoadSheets(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null

  const [vehicleId, setVehicleId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<readonly string[]>([])

  const sheets = useQuery(
    ['loadSheets', 'all'],
    () => api.api.warehouse.loadSheets.list({ limit: 30 }),
    { enabled: signedIn },
  )
  const vehicles = useQuery(
    ['locations', 'vehicle'],
    () => api.api.inventory.locations.list({ kind: 'vehicle', activeOnly: true }),
    { enabled: signedIn },
  )
  /** Packed and waiting for a vehicle: `packs.list` is the register of what is on the dock. */
  const packed = useQuery(['packs', 'recent'], () => api.api.warehouse.packs.list({ limit: 50 }), {
    enabled: signedIn,
  })

  const create = useMutation(
    (input: { toLocationId: string; orderIds: readonly string[] }, meta) =>
      api.api.warehouse.loadSheets.create({
        id: newId(),
        idempotencyKey: meta.idempotencyKey,
        toLocationId: input.toLocationId,
        orderIds: [...input.orderIds],
        vanStock: [],
      }),
    {
      invalidates: [['loadSheets'], ['packs']],
      onSuccess: (result) => {
        haptics.success()
        setChosen([])
        router.push(`/load/${result.item.id}`)
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const toggle = (orderId: string): void => {
    setChosen((held) =>
      held.includes(orderId) ? held.filter((one) => one !== orderId) : [...held, orderId],
    )
  }

  const ready = chosen.length > 0 && vehicleId !== null

  return (
    <Screen
      title={t('w7.title')}
      context={session?.tenant.displayName}
      testID="w7-screen"
      bottomBar={
        chosen.length === 0 ? undefined : (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('w4.selected', { count: chosen.length, pieces: 0 })}
            </Txt>
            <Button
              label={t('w7.build')}
              variant="primary"
              loading={create.status === 'pending'}
              disabled={!ready}
              {...(ready ? {} : { disabledReason: t('w7.vehicle') })}
              onPress={() => {
                if (vehicleId === null) return
                create.mutate({ toLocationId: vehicleId, orderIds: chosen })
              }}
              testID="w7-build"
            />
          </Row>
        )
      }
    >
      <Stack gap={6}>
        <PageTabs group="/load" active="/load" />

        <Panel title={t('w7.sheets')} testID="w7-sheets">
          <Async
            state={sheets}
            empty={(sheets.data?.items.length ?? 0) === 0}
            emptyMessage={t('w7.sheetsEmpty')}
          >
            <Group>
              {(sheets.data?.items ?? []).map((sheet) => (
                <ListRow
                  key={sheet.id}
                  testID={`w7-sheet-${sheet.id}`}
                  primary={sheet.vehicleRegNo ?? t('w7.vehicle')}
                  secondary={`${shortDate(sheet.sheetDate)} · ${t('w7.expected', {
                    count: sheet.expectedPackages,
                  })}`}
                  trailing={
                    <StatusChip
                      label={
                        sheet.status === 'draft' && sheet.approvedBy === null
                          ? t('w7.waitingApproval')
                          : sheet.status
                      }
                      family={
                        sheet.status === 'draft' && sheet.approvedBy === null
                          ? 'ochre'
                          : workFamily(sheet.status)
                      }
                    />
                  }
                  {...(sheet.challanNo === null
                    ? {}
                    : { reason: t('w7.challan', { no: sheet.challanNo }) })}
                  onPress={() => {
                    router.push(`/load/${sheet.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w7.vehicle')} testID="w7-vehicles">
          <Async state={vehicles} empty={(vehicles.data?.items.length ?? 0) === 0}>
            <Group>
              {(vehicles.data?.items ?? []).map((location) => (
                <ListRow
                  key={location.id}
                  testID={`w7-vehicle-${location.id}`}
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

        <Panel title={t('w7.packedOrders')} testID="w7-packed">
          <Async
            state={packed}
            empty={(packed.data?.items.length ?? 0) === 0}
            emptyMessage={t('w7.packedEmpty')}
          >
            <Group>
              {(packed.data?.items ?? []).map((pack) => (
                <ListRow
                  key={pack.id}
                  testID={`w7-packed-${pack.orderId}`}
                  primary={pack.retailerName}
                  secondary={`${pack.orderNo ?? pack.orderId.slice(0, 8)} · ${t('w6.packages')} ${String(
                    pack.packages,
                  )}`}
                  state={chosen.includes(pack.orderId) ? 'selected' : 'default'}
                  trailing={
                    pack.invoiceNo === null ? (
                      <StatusChip label={t('w6.noBill')} family="ochre" />
                    ) : (
                      <StatusChip label={pack.invoiceNo} family="moss" />
                    )
                  }
                  onPress={() => {
                    toggle(pack.orderId)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        {create.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {create.error.message}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
