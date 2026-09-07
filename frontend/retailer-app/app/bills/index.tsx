/**
 * R4 (list) — every bill this shop has been issued (docs/23 §6.1 R3/R4).
 *
 * `billing.invoices.list` for the retailer role is RLS-narrowed to this shop's own rows, so there is
 * no shop filter here and no way to widen it. `q` matches the bill number, which is what a shopkeeper
 * has in their hand when they ring up.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { Group, ListRow, Screen, Search, Segments, Stack, StatusChip, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { longDate } from '../../src/lib/dates'
import { Async, PageTabs, Panel, billFamily } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

export default function Bills(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const router = useRouter()
  const { session } = useSession()
  const [openOnly, setOpenOnly] = useState(false)
  const [query, setQuery] = useState('')

  const search = query.trim()
  const bills = useQuery(
    ['invoices', openOnly, search],
    () =>
      api.api.billing.invoices.list({
        limit: 50,
        ...(openOnly ? { openOnly: true } : {}),
        ...(search.length >= 2 ? { q: search } : {}),
      }),
    { enabled: session !== null },
  )
  const rows = bills.data?.items ?? []

  return (
    <Screen title={t('r4.title')} context={session?.tenant.displayName} testID="r4-screen">
      <Stack gap={5}>
        <PageTabs group="/dues" active="/bills" />
        <Segments
          testID="r4-filter"
          items={[
            { id: 'all', label: t('r4.all') },
            { id: 'open', label: t('r4.openOnly') },
          ]}
          value={openOnly ? 'open' : 'all'}
          onChange={(id) => {
            setOpenOnly(id === 'open')
          }}
        />
        <Search
          testID="r4-search"
          value={query}
          onChange={setQuery}
          placeholder={t('r4.search')}
          state={
            search.length < 2
              ? 'idle'
              : bills.isFetching
                ? 'typing'
                : rows.length === 0
                  ? 'noResults'
                  : 'results'
          }
        />
        <Panel testID="r4-list">
          <Async state={[bills]} rows={5} empty={rows.length === 0} emptyMessage={t('r4.none')}>
            <Group>
              {rows.map((bill) => (
                <ListRow
                  key={bill.id}
                  primary={bill.invoiceNo ?? bill.externalInvoiceNo ?? '—'}
                  secondary={`${longDate(bill.invoiceDate)} · ${
                    bill.amountDuePaise > 0
                      ? t('r3.due', { date: longDate(bill.dueDate) })
                      : t('r4.paid')
                  }`}
                  trailingMoney={bill.totalPaise}
                  trailing={<StatusChip label={word(bill.state)} family={billFamily(bill.state)} />}
                  onPress={() => {
                    router.push(`/bills/${bill.id}`)
                  }}
                  testID={`r4-row-${bill.id}`}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
