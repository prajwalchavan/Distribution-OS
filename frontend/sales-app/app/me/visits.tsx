/**
 * S8 · My visits — every call this rep has recorded, with the reason a shop did not order.
 *
 * Off the phone: `visits` is in this role's manifest and the pull scopes it to the rep's own rows, so
 * the history is there in a dead spot. Recording a NEW visit happens at the shop card, where the rep
 * is standing, and needs signal — `visits` has no sync handler yet (docs/23 §3.4).
 *
 * The no-order reasons are the point of the screen: a beat where "Enough stock already" is written
 * eleven times is a beat with a supply problem, and it is the rep who sees it first.
 */
import {
  Group,
  ListRow,
  Row,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { instantWithClock } from '../../src/lib/dates'
import { useAllShops, useLocalState, useMyVisits } from '../../src/lib/local'
import { LocalAsync, PageTabs, useMyUserId } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

type View = 'all' | 'no_order' | 'ordered'

export default function Visits(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const word = useWord()
  const local = useLocalState()
  const userId = useMyUserId()
  const visits = useMyVisits(userId, 200)
  const { shops } = useAllShops()
  const [view, setView] = useState<View>('all')

  const byShop = useMemo(() => new Map(shops.map((shop) => [shop.id, shop])), [shops])
  const rows = useMemo(
    () => (view === 'all' ? visits : visits.filter((visit) => visit.outcome === view)),
    [visits, view],
  )

  const productive = visits.filter((visit) => visit.outcome === 'ordered').length

  return (
    <Screen
      title={t('s8.title')}
      chips={
        <Row gap={2} wrap>
          <StatusChip label={t('s8.count', { count: visits.length })} family="neutral" figure />
          <StatusChip
            label={t('s8.productive', { count: productive })}
            family={productive === 0 ? 'neutral' : 'moss'}
            figure
          />
        </Row>
      }
    >
      <Stack gap={4}>
        <PageTabs group="/me" active="/me/visits" />

        <Segments
          testID="visit-view"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'all', label: t('s8.viewAll') },
            { id: 'no_order', label: t('s8.viewNoOrder') },
            { id: 'ordered', label: t('s8.viewOrdered') },
          ]}
        />

        <LocalAsync
          loading={false}
          hydrated={local.hydrated}
          empty={rows.length === 0}
          emptyMessage={t('s8.empty')}
          rows={6}
        >
          <Group>
            {rows.map((visit) => (
              <ListRow
                key={visit.id}
                primary={byShop.get(visit.retailer_id)?.name ?? visit.retailer_id.slice(0, 8)}
                secondary={`${instantWithClock(visit.started_at)}${
                  visit.reason === null || visit.reason === '' ? '' : ` · ${visit.reason}`
                }`}
                trailing={
                  <StatusChip
                    label={word(visit.outcome)}
                    family={
                      visit.outcome === 'ordered'
                        ? 'moss'
                        : visit.outcome === 'no_order'
                          ? 'ochre'
                          : 'neutral'
                    }
                  />
                }
                onPress={() => {
                  router.push(`/shops/${visit.retailer_id}`)
                }}
              />
            ))}
          </Group>
        </LocalAsync>

        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('s8.recordAtShop')}
        </Txt>
      </Stack>
    </Screen>
  )
}
