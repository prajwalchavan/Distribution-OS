/**
 * S1 · Aaj ka beat — the screen the day starts on.
 *
 * Every figure here comes off the PHONE (docs/23 §3.4): the beats this rep is assigned to today, the
 * shops of the chosen beat in the order the round is walked (`pjp.sequence`), what each shop owes and
 * whether it has been visited yet. No service is called, so it is the same screen in a lift, in a
 * basement and under the Kalyan flyover.
 *
 * What a rep needs before the first tap, in the order they need it: which beat · how much of it is
 * done · which shop is next · what that shop owes. The row's tap target is the whole row, well over
 * the 69 dp field floor.
 */
import {
  Money,
  Screen,
  Chips,
  Row,
  Stack,
  StatusChip,
  Search,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useMemo, useState } from 'react'
import { useRouter } from 'expo-router'

import { clockOnly, shortInstant, startOfIstDay, today } from '../src/lib/dates'
import {
  useBeatShops,
  useBeats,
  useLocalState,
  useMyBeatIds,
  useOrdersForShops,
  useOutstandingByShop,
  useVisitsByShop,
} from '../src/lib/local'
import { LocalAsync, TwoLine, duesFamily, useMyUserId } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

export default function Beat(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const word = useWord()
  const userId = useMyUserId()
  const local = useLocalState()

  const day = today()
  const beats = useBeats()
  const myBeatIds = useMyBeatIds(userId, day)
  const [chosen, setChosen] = useState<string | null>(null)
  const beatId = chosen ?? myBeatIds[0] ?? null

  const { shops, loading } = useBeatShops(beatId)
  const visits = useVisitsByShop(userId, startOfIstDay(day))
  const dues = useOutstandingByShop()
  /*
   * The beat's own orders, not "my newest 200". Ninety days of a busy beat is hundreds of orders, so
   * a count cap ended inside 5 September on the pilot data and printed "No order yet" over six shops
   * whose own cards said 4 September. Scoped by shop, the answer is exact (`useOrdersForShops`).
   */
  const shopIds = useMemo(() => shops.map((shop) => shop.id), [shops])
  const orders = useOrdersForShops(shopIds)
  const [query, setQuery] = useState('')

  /**
   * Two facts the beat rows need, off the same ninety days of orders the device already holds:
   * which shops have an order written TODAY (the tick that says "done here"), and when each shop
   * last ordered at all (the line that decides where a rep spends the next ten minutes).
   */
  const orderedToday = useMemo(() => {
    const since = startOfIstDay(day)
    const set = new Set<string>()
    for (const order of orders)
      if (order.created_at >= since && order.state !== 'cancelled') set.add(order.retailer_id)
    return set
  }, [orders, day])

  const lastOrderAt = useMemo(() => {
    const byShop = new Map<string, string>()
    for (const order of orders) {
      if (order.state === 'cancelled') continue
      const held = byShop.get(order.retailer_id)
      if (held === undefined || order.created_at > held)
        byShop.set(order.retailer_id, order.created_at)
    }
    return byShop
  }, [orders])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return shops
    return shops.filter(
      (shop) =>
        shop.name.toLowerCase().includes(needle) ||
        (shop.code ?? '').toLowerCase().includes(needle) ||
        (shop.address?.area ?? '').toLowerCase().includes(needle),
    )
  }, [shops, query])

  const visited = shops.filter((shop) => visits.has(shop.id)).length
  /*
   * COUNT WHAT THE ROWS SHOW. `orderedToday` is every shop this rep wrote an order for today across
   * every beat, and printing its size here read "4 ordered" over nine rows that all said "To visit" —
   * the four were on the OTHER beat. A header figure that the list underneath contradicts is worse
   * than no figure.
   */
  const orderedHere = shops.filter((shop) => orderedToday.has(shop.id)).length
  const beatName = beats.find((beat) => beat.id === beatId)?.name ?? t('s1.noBeat')

  return (
    <Screen
      title={t('s1.title')}
      context={beatName}
      chips={
        <Row gap={2} wrap>
          <StatusChip label={t('s1.shopsCount', { count: shops.length })} family="neutral" figure />
          <StatusChip
            label={t('s1.visitedCount', { count: visited })}
            family={visited === 0 ? 'neutral' : 'moss'}
            figure
          />
          <StatusChip
            label={t('s1.orderedCount', { count: orderedHere })}
            family={orderedHere === 0 ? 'neutral' : 'clay'}
            figure
          />
        </Row>
      }
    >
      <Stack gap={4}>
        {myBeatIds.length > 1 ? (
          <Chips
            testID="beat-picker"
            items={myBeatIds.map((id) => ({
              id,
              label: beats.find((beat) => beat.id === id)?.name ?? id.slice(0, 8),
              selected: id === beatId,
            }))}
            onToggle={setChosen}
          />
        ) : null}

        <Search
          testID="beat-search"
          value={query}
          onChange={setQuery}
          placeholder={t('s1.search')}
          state={query.trim() === '' ? 'idle' : filtered.length === 0 ? 'noResults' : 'results'}
        />

        <LocalAsync
          loading={loading}
          hydrated={local.hydrated}
          empty={filtered.length === 0}
          emptyMessage={query.trim() === '' ? t('s1.empty') : t('s1.noMatch')}
          rows={6}
        >
          <Stack testID="beat-list">
            {filtered.map((shop) => {
              const visit = visits.get(shop.id)
              const due = dues.get(shop.id)
              const ordered = orderedToday.has(shop.id)
              return (
                <TwoLine
                  key={shop.id}
                  testID={`beat-row-${shop.id}`}
                  primary={shop.name}
                  secondary={
                    visit === undefined
                      ? `${shop.address?.area ?? shop.code ?? ''} · ${
                          lastOrderAt.get(shop.id) === undefined
                            ? t('s1.lastOrderNone')
                            : t('s1.lastOrderAt', {
                                when: shortInstant(lastOrderAt.get(shop.id)),
                              })
                        }`
                      : t('s1.visitedAt', {
                          when: clockOnly(visit.started_at),
                          outcome: word(visit.outcome),
                        })
                  }
                  trailing={
                    <Stack gap={1} align="end">
                      <Money
                        value={
                          due === undefined || due.outstanding_paise === 0
                            ? null
                            : due.outstanding_paise
                        }
                        size="moneyM"
                        tone={
                          (due?.overdue_paise ?? 0) > 0
                            ? 'critical'
                            : (due?.outstanding_paise ?? 0) === 0
                              ? 'secondary'
                              : 'default'
                        }
                      />
                      <StatusChip
                        label={
                          ordered
                            ? t('s1.stateOrdered')
                            : visit !== undefined
                              ? t('s1.stateVisited')
                              : t('s1.statePending')
                        }
                        family={
                          ordered
                            ? 'clay'
                            : visit !== undefined
                              ? 'moss'
                              : duesFamily(due?.overdue_paise ?? 0, due?.outstanding_paise ?? 0)
                        }
                      />
                    </Stack>
                  }
                  onPress={() => {
                    router.push(`/shops/${shop.id}`)
                  }}
                />
              )
            })}
          </Stack>
        </LocalAsync>

        {local.online ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('s0.offlineNote')}
          </Txt>
        )}
        {local.persistent ? null : (
          <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
            {t('s0.notPersisted')}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
