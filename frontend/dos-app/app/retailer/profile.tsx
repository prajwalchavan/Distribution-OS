/**
 * Me — the fourth entry a shopping app has (founder, 2026-09-28: Shop, Orders, Money, Me).
 *
 * It is a hub, not a new feature: the shop's distributors (the same cards the home's chip opens,
 * `DistributorList`), and one row for each page that is not a tab of its own — shop details, messages,
 * returns and help, offers, the phones this login is signed in on, the password — plus signing out.
 * Every one of those pages already existed; this is where a shopkeeper finds them without knowing the
 * ⋯ menu is there.
 *
 * SIGNING OUT ASKS FIRST, because it empties the basket on this phone (`useLeave`), and says so.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Dialog,
  Group,
  ListRow,
  Screen,
  Stack,
  Txt,
  routeFor,
  useColors,
  useGo,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { DistributorList } from '../../src/groups/retailer/lib/distributors'
import { useMyShop } from '../../src/groups/retailer/lib/shop'
import { useLeave } from '../../src/groups/retailer/lib/shopping'
import { Panel, useCan } from '../../src/groups/retailer/lib/ui'

export default function Me(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const go = useGo()
  const router = useRouter()
  const can = useCan()
  const { session } = useSession()
  const my = useMyShop()
  const leave = useLeave()
  const [asking, setAsking] = useState(false)

  const inbox = useQuery(
    ['notifications', 'unread'],
    () => api.api.notifications.messages.list({ limit: 1 }),
    { enabled: session !== null, staleTime: 60_000 },
  )
  const unread = inbox.data?.unreadCount ?? 0

  /** Each row is a page that already exists, shown only where the matrix lets this shop in. */
  const pages: { id: string; label: string; detail?: string; path: string; permission: string }[] =
    [
      { id: 'shop', label: t('nav.shop'), path: '/shop', permission: 'retailers.updateOwn' },
      {
        id: 'inbox',
        label: t('nav.inbox'),
        ...(unread > 0 ? { detail: t('r12.unread', { count: String(unread) }) } : {}),
        path: '/inbox',
        permission: 'notifications.messages.list',
      },
      {
        id: 'returns',
        label: t('nav.returns'),
        path: '/returns',
        permission: 'billing.creditNotes.list',
      },
      { id: 'deals', label: t('nav.deals'), path: '/deals', permission: 'pricing.schemes.list' },
      { id: 'settings', label: t('nav.account'), path: '/settings', permission: 'tenancy.me' },
    ]

  return (
    <Screen title={t('me.title')} context={session?.tenant.displayName} testID="me-screen">
      <Stack gap={6}>
        <Stack gap={1}>
          <Txt field="title" desk="section" testID="me-name">
            {session?.user.name ?? ''}
          </Txt>
          {my.shop === null ? null : (
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {my.shop.name}
            </Txt>
          )}
        </Stack>

        <Panel title={t('me.pages')} testID="me-pages">
          <Group>
            {pages
              .filter((page) => can(page.permission))
              .map((page) => (
                <ListRow
                  key={page.id}
                  primary={page.label}
                  secondary={page.detail}
                  onPress={() => {
                    go.push(page.path)
                  }}
                  testID={`me-${page.id}`}
                />
              ))}
            <ListRow
              primary={t('me.password')}
              onPress={() => {
                // A ROOT route shared by all six groups: `routeFor` hands it back unchanged.
                router.push(routeFor('retailer', '/change-password'))
              }}
              testID="me-password"
            />
            <ListRow
              primary={t('me.signOut')}
              onPress={() => {
                setAsking(true)
              }}
              testID="me-sign-out"
            />
          </Group>
        </Panel>

        <Panel title={t('me.distributors')} testID="me-distributors">
          <DistributorList />
        </Panel>
      </Stack>

      <Dialog
        open={asking}
        onClose={() => {
          setAsking(false)
        }}
        title={t('me.signOutTitle')}
        body={t('me.signOutBody')}
        confirmLabel={t('me.signOut')}
        cancelLabel={t('me.stay')}
        onConfirm={() => {
          setAsking(false)
          leave()
        }}
        testID="me-sign-out-dialog"
      />
    </Screen>
  )
}
