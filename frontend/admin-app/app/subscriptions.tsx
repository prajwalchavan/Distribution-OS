/**
 * P5 — what every distributor pays us, and whether they are still a customer.
 *
 * This is the ONLY money in the console, and it is ours: our price to a distributor, never their
 * price to a shop. `trialing` → inside the free window a new distributorship is created with;
 * `active` → paying; `past_due` → an invoice of OURS is unpaid and their work still runs; `suspended`
 * → sign-in refused, data kept; `cancelled` → the relationship ended (the `admin` contract's own
 * definitions).
 *
 * A BACKEND GAP THIS SCREEN WORKS AROUND. `admin.subscriptions.list` rows carry `tenantId` and no
 * name, and there is no "these ids" filter on `tenants.list`, so the names on this register are read
 * one distributorship at a time for the rows actually on screen. It is bounded by the page size and
 * cached, and it is why the page is 50 rows and not 200. A `tenantName` on the subscription row (or
 * an `ids` filter) would make it one request; it is recorded as an open point rather than papered
 * over with a uuid on screen.
 */
import { usePlatformApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Register,
  Row,
  Screen,
  Segments,
  Stack,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import type { Subscription, SubscriptionStatus, TenantPlan } from '@dos/contracts'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import {
  Async,
  Note,
  ReloadButton,
  chipColumn,
  moneyColumn,
  showingCount,
  subscriptionFamily,
  textColumn,
  useCan,
} from '../src/lib/ui'
import { SubscriptionEditor } from '../src/lib/subscription'
import { daysFromToday, longDate } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

const PAGE = 50
const PLANS: readonly TenantPlan[] = ['pilot', 'starter', 'growth', 'standard', 'pro']
const STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
]

export default function Subscriptions(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()
  const router = useRouter()
  const can = useCan()
  const mayEdit = can('admin.subscriptions.upsert')

  const [status, setStatus] = useState<SubscriptionStatus | null>(null)
  const [plan, setPlan] = useState<TenantPlan | null>(null)
  const [endingSoon, setEndingSoon] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const subscriptions = useQuery(
    ['admin', 'subscriptions', status ?? '', plan ?? '', endingSoon],
    () =>
      api.api.admin.subscriptions.list({
        limit: PAGE,
        ...(status === null ? {} : { status }),
        ...(plan === null ? {} : { plan }),
        ...(endingSoon ? { endingWithinDays: 30 } : {}),
      }),
  )

  const rows = subscriptions.data?.items ?? []
  const tenantIds = [...new Set(rows.map((row) => row.tenantId))]

  /** One read per distributorship on this page, in parallel, cached by the ids on the page. */
  const names = useQuery(
    ['admin', 'tenant-names', tenantIds.join(',')],
    async () => {
      const answers = await Promise.all(
        tenantIds.map((id) =>
          api.api.admin.tenants
            .get({ id })
            .then((answer) => [id, answer.item.legalName] as const)
            .catch(() => [id, ''] as const),
        ),
      )
      return Object.fromEntries(answers)
    },
    { enabled: tenantIds.length > 0, staleTime: 300_000 },
  )

  const nameOf = (tenantId: string): string => names.data?.[tenantId] ?? '—'
  const current = rows.find((row) => row.id === selected) ?? null

  const columns: readonly RegisterColumn<Subscription>[] = [
    {
      key: 'tenant',
      head: t('p5.distributor'),
      priority: 'identity',
      cell: (row) => (
        <Stack gap={1}>
          <Txt field="bodyStrong" desk="cell" numberOfLines={1}>
            {nameOf(row.tenantId)}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {word(row.plan)}
          </Txt>
        </Stack>
      ),
    },
    chipColumn('state', t('p5.state'), (row) => ({
      label: word(row.status),
      family: subscriptionFamily(row.status),
      solid: row.status === 'past_due',
    })),
    moneyColumn('price', t('p5.price'), (row) => row.amountPaise),
    textColumn('interval', t('p5.interval'), (row) => word(row.billingInterval)),
    textColumn('seats', t('p5.seats'), (row) => row.seats),
    textColumn('renews', t('p5.renews'), (row) => longDate(row.currentPeriodEnd)),
    {
      key: 'trial',
      head: t('p5.trialEnds'),
      priority: 'detail',
      cell: (row) => {
        if (row.trialEndDate === null) {
          return (
            <Txt field="body" desk="cell">
              —
            </Txt>
          )
        }
        const left = daysFromToday(row.trialEndDate)
        return (
          <Txt
            field="body"
            desk="cell"
            color={left <= 7 ? colors.status.ochre.fg : colors.text.primary}
          >
            {longDate(row.trialEndDate)}
          </Txt>
        )
      },
    },
    textColumn('note', t('p5.note'), (row) => row.note),
  ]

  return (
    <Screen
      title={t('p5.title')}
      context={showingCount(t, subscriptions, rows.length)}
      actions={
        <ReloadButton
          onPress={() => {
            void subscriptions.refetch()
          }}
        />
      }
    >
      <Stack gap={4}>
        <Note testID="our-price">{t('p5.ourPrice')}</Note>
        <Chips
          testID="status-chips"
          items={STATUSES.map((id) => ({ id, label: word(id), selected: status === id }))}
          onToggle={(id) => {
            setStatus((value) => (value === id ? null : (id as SubscriptionStatus)))
          }}
          {...(status === null
            ? {}
            : {
                onClear: () => {
                  setStatus(null)
                },
              })}
        />
        <Chips
          testID="plan-chips"
          items={PLANS.map((id) => ({ id, label: word(id), selected: plan === id }))}
          onToggle={(id) => {
            setPlan((value) => (value === id ? null : (id as TenantPlan)))
          }}
          {...(plan === null
            ? {}
            : {
                onClear: () => {
                  setPlan(null)
                },
              })}
        />
        <Segments
          testID="ending-segments"
          value={endingSoon ? 'soon' : 'all'}
          onChange={(id) => {
            setEndingSoon(id === 'soon')
          }}
          items={[
            { id: 'all', label: t('app.all') },
            { id: 'soon', label: t('p5.endingSoon') },
          ]}
        />
        <Async state={[subscriptions]} rows={10}>
          <Register
            testID="subscriptions-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="tenant"
            state="ready"
            selectedKey={selected}
            emptyMessage={t('p5.empty')}
            onSelect={(row) => {
              setSelected(row.id)
              // Only a level that may change a subscription opens the editor (DOS-106): super, billing.
              if (mayEdit) setEditing(true)
            }}
          />
        </Async>
        {current === null ? null : (
          <Row gap={3} wrap>
            {mayEdit ? (
              <Button
                label={t('p5.edit')}
                variant="secondary"
                testID="edit-subscription"
                onPress={() => {
                  setEditing(true)
                }}
              />
            ) : null}
            <Button
              label={t('p3.doneOpen')}
              variant="ghost"
              testID="open-distributor"
              onPress={() => {
                router.push(`/distributors/${current.tenantId}`)
              }}
            />
          </Row>
        )}
      </Stack>

      {current === null || !mayEdit ? null : (
        <SubscriptionEditor
          open={editing}
          onClose={() => {
            setEditing(false)
          }}
          tenantId={current.tenantId}
          tenantName={nameOf(current.tenantId)}
          current={current}
          testID="subscription-sheet"
        />
      )}
    </Screen>
  )
}
