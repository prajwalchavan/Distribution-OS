/**
 * W6 (list) — what is ready to go into cartons, and what already has (docs/23 §4.1).
 *
 * Three groups, in the order the floor works them: orders being picked and therefore next to pack,
 * packs that went out today with their bill, and the backlog — packed WITHOUT a bill, which is the
 * desk's queue, shown here so the godown knows a carton it packed is still waiting on paper.
 *
 * `PackListItemSchema` carries a bill NUMBER and no total. `PackInvoiceRefSchema` does carry a sale
 * total and the warehouse may see it (a sale total is not a cost) — it is drawn on the order's own
 * pack screen, where it means "this is the bill in the carton", and not in a list where it would read
 * as a day's takings.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { Group, ListRow, Screen, Stack, StatusChip, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'

import { shortDate, today } from '../../src/lib/dates'
import { Async, Panel, workFamily } from '../../src/lib/ui'

export default function PackList(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null

  /** Orders on the floor: on a wave, being picked, not yet packed. */
  const picking = useQuery(
    ['queue', 'picking'],
    () => api.api.warehouse.queue.list({ state: 'picking', unpicklistedOnly: false, limit: 50 }),
    { enabled: signedIn },
  )
  const packedToday = useQuery(
    ['packs', 'today'],
    () => api.api.warehouse.packs.list({ from: today(), limit: 50 }),
    { enabled: signedIn },
  )
  const backlog = useQuery(
    ['packs', 'unbilled'],
    () => api.api.warehouse.packs.list({ invoiced: false, limit: 50 }),
    { enabled: signedIn },
  )

  return (
    <Screen title={t('w6.title')} context={session?.tenant.displayName} testID="w6-screen">
      <Stack gap={6}>
        <Panel title={t('w6.ready')} testID="w6-ready">
          <Async
            state={picking}
            empty={(picking.data?.items.length ?? 0) === 0}
            emptyMessage={t('w6.readyEmpty')}
          >
            <Group>
              {(picking.data?.items ?? []).map((item) => (
                <ListRow
                  key={item.orderId}
                  testID={`w6-ready-${item.orderId}`}
                  primary={item.retailerName}
                  secondary={`${item.orderNo ?? item.orderId.slice(0, 8)} · ${t('w.pieces', {
                    pieces: item.totalQtyPcs,
                  })}`}
                  trailing={<StatusChip label={item.state} family={workFamily(item.state)} />}
                  onPress={() => {
                    router.push(`/pack/${item.orderId}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w1.packsQueue')} testID="w6-backlog">
          <Async
            state={backlog}
            empty={(backlog.data?.items.length ?? 0) === 0}
            emptyMessage={t('w1.packsEmpty')}
          >
            <Group>
              {(backlog.data?.items ?? []).map((pack) => (
                <ListRow
                  key={pack.id}
                  testID={`w6-backlog-${pack.id}`}
                  primary={pack.retailerName}
                  secondary={`${pack.orderNo ?? pack.orderId.slice(0, 8)} · ${t('w6.packages')} ${String(
                    pack.packages,
                  )}`}
                  trailing={<StatusChip label={t('w6.noBill')} family="ochre" />}
                  reason={shortDate(pack.packedAt.slice(0, 10))}
                  onPress={() => {
                    router.push(`/pack/${pack.orderId}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w6.done')} testID="w6-done">
          <Async
            state={packedToday}
            empty={(packedToday.data?.items.length ?? 0) === 0}
            emptyMessage={t('w6.doneEmpty')}
          >
            <Group>
              {(packedToday.data?.items ?? []).map((pack) => (
                <ListRow
                  key={pack.id}
                  testID={`w6-done-${pack.id}`}
                  primary={pack.retailerName}
                  secondary={`${pack.orderNo ?? pack.orderId.slice(0, 8)} · ${t('w6.packages')} ${String(
                    pack.packages,
                  )}`}
                  trailing={
                    pack.invoiceNo === null ? (
                      <StatusChip label={t('w6.noBill')} family="ochre" />
                    ) : (
                      <StatusChip label={pack.invoiceNo} family="moss" />
                    )
                  }
                  {...(pack.shortPacked ? { reason: t('w6.shortPacked') } : {})}
                  onPress={() => {
                    router.push(`/pack/${pack.orderId}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
