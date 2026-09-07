/**
 * P2 — every distributorship on the platform, with the state and the size of each.
 *
 * The four numbers on a row (staff logins, shops, orders in 30 days, when they were last seen) are
 * COUNTS: they say how big a customer is and whether they are still working, which is what a console
 * needs to know. What they never say is what any of it was worth — that is the distributor's own
 * trade, and it is not readable from here (the `admin` contract's header, docs/22 §9 item 9).
 *
 * Selecting a row opens the distributorship itself rather than a side panel: everything a console
 * does to a customer — the plan, suspension, asking for a support window — happens there, and a
 * refresh or a shared link has to land on it.
 */
import { usePlatformApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Register,
  Screen,
  Search,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import type { TenantPlan, TenantSummary } from '@dos/contracts'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import {
  Async,
  chipColumn,
  countColumn,
  searchState,
  showingCount,
  subscriptionFamily,
  textColumn,
} from '../../src/lib/ui'
import { instantWithClock, longDate } from '../../src/lib/dates'
import { stateName, useWord } from '../../src/lib/words'

const PLANS: readonly TenantPlan[] = ['pilot', 'starter', 'growth', 'standard', 'pro']

export default function Distributors(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all')
  const [plan, setPlan] = useState<TenantPlan | null>(null)

  /*
   * The search term only reaches the service once it is worth a round trip. `q` is a `min(1).max(60)`
   * on the contract, so a single character IS legal — but a console typing "tarsun" would otherwise
   * be six reads of a table with thousands of rows in it (docs/20).
   */
  const term = query.trim()
  const search = term.length >= 2 ? term : undefined

  const tenants = useQuery(['admin', 'tenants', search ?? '', status, plan ?? ''], () =>
    api.api.admin.tenants.list({
      limit: 200,
      ...(search === undefined ? {} : { q: search }),
      ...(status === 'all' ? {} : { status }),
      ...(plan === null ? {} : { plan }),
    }),
  )

  const rows = tenants.data?.items ?? []

  const columns: readonly RegisterColumn<TenantSummary>[] = [
    {
      key: 'name',
      head: t('p2.name'),
      priority: 'identity',
      cell: (row) => (
        <Stack gap={1}>
          <Txt field="bodyStrong" desk="cell" numberOfLines={1}>
            {row.legalName}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={1}>
            {`${row.slug} · ${stateName(row.stateCode)}`}
          </Txt>
        </Stack>
      ),
    },
    textColumn('plan', t('p2.plan'), (row) => word(row.plan)),
    chipColumn('subscription', t('p2.subscription'), (row) => ({
      label:
        row.subscriptionStatus === null ? t('p2.noSubscription') : word(row.subscriptionStatus),
      family: subscriptionFamily(row.subscriptionStatus),
      solid: row.subscriptionStatus === 'past_due',
    })),
    {
      key: 'status',
      head: t('p2.status'),
      priority: 'detail',
      cell: (row) =>
        row.status === 'active' ? (
          <Txt field="body" desk="cell" color={colors.text.secondary}>
            {word(row.status)}
          </Txt>
        ) : (
          <StatusChip label={word(row.status)} family="brick" solid />
        ),
    },
    countColumn('staff', t('p2.staff'), (row) => row.staffCount),
    countColumn('shops', t('p2.shops'), (row) => row.retailerCount),
    countColumn('orders', t('p2.orders30d'), (row) => row.orders30d, {
      priority: 'value',
      unit: t('p2.ordersUnit'),
    }),
    textColumn('lastActivity', t('p2.lastActivity'), (row) =>
      row.lastActivityAt === null ? t('app.never') : instantWithClock(row.lastActivityAt),
    ),
    textColumn('since', t('p2.since'), (row) => longDate(row.createdAt.slice(0, 10))),
  ]

  return (
    <Screen
      title={t('p2.title')}
      context={showingCount(t, tenants, rows.length)}
      actions={
        <Button
          label={t('p2.onboard')}
          variant="primary"
          testID="onboard"
          onPress={() => {
            router.push('/distributors/new')
          }}
        />
      }
    >
      <Stack gap={4}>
        <Search
          testID="distributor-search"
          value={query}
          onChange={setQuery}
          placeholder={t('p2.searchPlaceholder')}
          state={searchState(tenants, term, rows.length)}
        />
        <Segments
          testID="status-segments"
          value={status}
          onChange={(id) => {
            setStatus(id as 'all' | 'active' | 'suspended')
          }}
          items={[
            { id: 'all', label: t('app.all') },
            { id: 'active', label: t('p1.working') },
            { id: 'suspended', label: t('p1.suspended') },
          ]}
        />
        <Chips
          testID="plan-chips"
          items={PLANS.map((id) => ({ id, label: word(id), selected: plan === id }))}
          onToggle={(id) => {
            setPlan((current) => (current === id ? null : (id as TenantPlan)))
          }}
          {...(plan === null
            ? {}
            : {
                onClear: () => {
                  setPlan(null)
                },
              })}
        />
        <Async state={[tenants]} rows={10}>
          <Register
            testID="distributors-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="name"
            state="ready"
            emptyMessage={t('p2.empty')}
            onSelect={(row) => {
              router.push(`/distributors/${row.id}`)
            }}
          />
        </Async>
      </Stack>
    </Screen>
  )
}
