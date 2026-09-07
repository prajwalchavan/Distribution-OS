/**
 * W11 — what the godown is holding, and for whom (docs/23 §4.1).
 *
 * A reservation is the pieces an order took out of `sellable_stock` the moment it was confirmed. The
 * floor reads them, because "why is there stock on the rack that I cannot pick" has exactly one
 * answer and it is this list. FREEING a hold is `warehouse.reservations.release`, which is
 * BACK_OFFICE by design — a live order stops being live when the desk says so, not when a loader
 * needs the space — so this screen shows the holds and names whose step that is.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { Group, ListRow, Screen, Stack, StatusChip, useStrings } from '@dos/ui'

import { Async, DeskOnly, Panel, PageTabs, workFamily } from '../../src/lib/ui'

export default function Reservations(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const { session } = useSession()
  const signedIn = session !== null

  const held = useQuery(
    ['reservations', 'pending'],
    () => api.api.warehouse.reservations.list({ state: 'pending', limit: 100 }),
    { enabled: signedIn },
  )

  return (
    <Screen title={t('w11.title')} context={session?.tenant.displayName} testID="w11-screen">
      <Stack gap={6}>
        <PageTabs group="/" active="/stock/reservations" />

        <Panel title={t('w11.rows')} testID="w11-rows">
          <Async
            state={held}
            empty={(held.data?.items.length ?? 0) === 0}
            emptyMessage={t('w11.rowsEmpty')}
          >
            <Group>
              {(held.data?.items ?? []).map((row) => (
                <ListRow
                  key={row.id}
                  testID={`w11-row-${row.id}`}
                  primary={row.variantName}
                  secondary={`${t('w.pieces', { pieces: row.qtyPcs })} · ${
                    row.batchNo === null ? t('w.noBatch') : t('w.batch', { batch: row.batchNo })
                  }`}
                  trailing={<StatusChip label={row.state} family={workFamily(row.state)} />}
                  reason={t('w11.forOrder', {
                    order: row.orderNo ?? row.orderId?.slice(0, 8) ?? '—',
                  })}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <DeskOnly>{t('w11.releaseIsDesk')}</DeskOnly>
      </Stack>
    </Screen>
  )
}
