/**
 * R8 (list) — every order this shop has placed, and where each one has got to (docs/23 §6.1 R8).
 *
 * `orders.list` for the retailer role answers only this shop's own rows — RLS, not a filter — so
 * there is no retailer id in the query and no way to widen it from here.
 *
 * The three chips are the three questions a shopkeeper actually asks: everything, what is still
 * coming, what has arrived. "Still coming" is the server's own `openOnly` (submitted, confirmed,
 * picking, packed, dispatched), not a list of states this screen decided on — one definition, and it
 * is the distributor's.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { Group, ListRow, Screen, Segments, Stack, StatusChip, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { longDate } from '../../src/lib/dates'
import { Async, Panel, orderFamily } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

type Filter = 'all' | 'open' | 'done'

export default function MyOrders(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const router = useRouter()
  const { session } = useSession()
  const [filter, setFilter] = useState<Filter>('all')

  const orders = useQuery(
    ['orders', filter],
    () =>
      api.api.orders.list({
        limit: 50,
        ...(filter === 'open' ? { openOnly: true } : {}),
        ...(filter === 'done' ? { states: ['delivered', 'closed'] as const } : {}),
      }),
    { enabled: session !== null },
  )
  const rows = orders.data?.items ?? []

  return (
    <Screen title={t('r8.title')} context={session?.tenant.displayName} testID="r8-screen">
      <Stack gap={5}>
        <Segments
          testID="r8-filter"
          items={[
            { id: 'all', label: t('r8.all') },
            { id: 'open', label: t('r8.open') },
            { id: 'done', label: t('r8.done') },
          ]}
          value={filter}
          onChange={(id) => {
            setFilter(id as Filter)
          }}
        />
        <Panel testID="r8-list">
          <Async state={[orders]} rows={5} empty={rows.length === 0} emptyMessage={t('r8.none')}>
            <Group>
              {/* The row is the tap target itself; a `<Pressable>` around a `<ListRow>` nests one
                  button inside another and the disabled inner one swallows the tap. */}
              {rows.map((order) => (
                <ListRow
                  key={order.id}
                  primary={
                    order.orderNo === null ? t('r8.draft') : t('r8.orderNo', { no: order.orderNo })
                  }
                  secondary={`${t('r8.placedOn', {
                    date: longDate((order.submittedAt ?? order.createdAt).slice(0, 10)),
                  })} · ${word(order.source)}`}
                  trailingMoney={order.totalPaise}
                  trailing={
                    <StatusChip label={word(order.state)} family={orderFamily(order.state)} />
                  }
                  onPress={() => {
                    router.push(`/orders/${order.id}`)
                  }}
                  testID={`r8-row-${order.id}`}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
