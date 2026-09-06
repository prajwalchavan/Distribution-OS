/**
 * The home screen of the skeleton — the smallest honest proof that the whole chain works.
 *
 * It reads two procedures every service serves (`tenancy.me` and `tenancy.branding.get`), draws them
 * with three UX-00 §6 components, and does it from ONE file that renders as a website, an Android app
 * and an iOS app. A role app replaces this screen with the "most likely next action" its own §N.1 in
 * docs/23 names; nothing else in the template changes.
 *
 * There is not a paisa on this screen on purpose: the template is generated into seven apps, four of
 * which may never see a cost or a margin (docs/22 §9 rule 1), and a skeleton that leaked one would
 * teach the wrong habit.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  EmptyState,
  ErrorState,
  KpiStrip,
  Register,
  Screen,
  Skeleton,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import type { MembershipSummary } from '@dos/contracts'

export default function Home(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const { session } = useSession()

  const me = useQuery(['tenancy', 'me'], () => api.api.tenancy.me())
  const branding = useQuery(['tenancy', 'branding'], () => api.api.tenancy.branding.get())

  const memberships = session?.memberships ?? []

  const columns: readonly RegisterColumn<MembershipSummary>[] = [
    {
      key: 'name',
      head: t('app.membershipName'),
      priority: 'identity',
      cell: (row) => (
        <Txt field="body" desk="cell">
          {row.displayName}
        </Txt>
      ),
    },
    {
      key: 'role',
      head: t('app.membershipRole'),
      priority: 'detail',
      cell: (row) => (
        <Txt field="body" desk="cell">
          {row.role}
        </Txt>
      ),
    },
    {
      key: 'status',
      head: t('app.membershipStatus'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={row.status} family={row.status === 'active' ? 'moss' : 'neutral'} />
      ),
    },
  ]

  return (
    <Screen
      title={t('app.home')}
      context={branding.data?.displayName ?? session?.tenant.displayName}
      actions={
        <Button
          label={t('app.reload')}
          variant="secondary"
          onPress={() => {
            void me.refetch()
            void branding.refetch()
          }}
          testID="home-reload"
        />
      }
    >
      <Stack gap={6}>
        {me.isLoading ? (
          <Skeleton rows={3} />
        ) : me.error ? (
          <ErrorState message={me.error.message} detail={me.error.kind} />
        ) : (
          <KpiStrip
            testID="home-kpis"
            items={[
              {
                label: t('app.distributor'),
                value: branding.data?.displayName ?? me.data?.tenant.legalName ?? '—',
              },
              { label: t('app.role'), value: me.data?.membership.role ?? '—' },
              { label: t('app.person'), value: me.data?.user.name ?? '—' },
              { label: t('app.state'), value: me.data?.tenant.stateCode ?? '—' },
            ]}
          />
        )}

        <Register
          testID="home-memberships"
          columns={columns}
          rows={memberships}
          rowKey={(row) => row.tenantId}
          state={memberships.length === 0 ? 'empty' : 'ready'}
          emptyMessage={t('app.noMemberships')}
        />

        {memberships.length > 1 ? null : <EmptyState message={t('app.templateBody')} />}
      </Stack>
    </Screen>
  )
}
