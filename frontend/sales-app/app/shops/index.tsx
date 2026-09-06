/**
 * Shops — every shop on the phone, searchable, and the way in to S7 (a new one).
 *
 * The beat screen is the day's round; this is the whole book, for the shop that rang up, the one two
 * streets over, the one a rep is standing outside for the first time. Search runs against the device
 * (UX-00 §6.5: local-first), so it answers with no signal and with no spinner.
 */
import { Money, Row, Screen, Search, Stack, StatusChip, Txt, useColors, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { useAllShops, useBeats, useLocalState, useOutstandingByShop } from '../../src/lib/local'
import { LocalAsync, PageTabs, TwoLine, duesFamily, useCan } from '../../src/lib/ui'

const PAGE = 60

export default function Shops(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const can = useCan()
  const local = useLocalState()
  const { shops, loading } = useAllShops()
  const beats = useBeats()
  const dues = useOutstandingByShop()
  const [query, setQuery] = useState('')

  /*
   * The whole book is on the phone (a distributor's shop list is thousands of rows, docs/20) and only
   * a page of it is ever drawn. Search narrows first, so the cap bites on the browse and not on the
   * answer — and the screen says when it has capped, rather than pretending the list ended.
   */
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return shops
    return shops.filter(
      (shop) =>
        shop.name.toLowerCase().includes(needle) ||
        (shop.code ?? '').toLowerCase().includes(needle) ||
        (shop.phone ?? '').includes(needle) ||
        (shop.address?.area ?? '').toLowerCase().includes(needle),
    )
  }, [shops, query])
  const filtered = matching.slice(0, PAGE)
  const capped = matching.length > PAGE

  return (
    <Screen
      title={t('s2.shopsTitle')}
      chips={
        <StatusChip label={t('s2.shopsCount', { count: shops.length })} family="neutral" figure />
      }
    >
      <Stack gap={4}>
        <PageTabs group="/shops" active="/shops" />

        <Search
          testID="shops-search"
          value={query}
          onChange={setQuery}
          placeholder={t('s2.searchShops')}
          state={query.trim() === '' ? 'idle' : filtered.length === 0 ? 'noResults' : 'results'}
          onAddNew={
            can('retailers.upsert')
              ? () => {
                  router.push('/shops/new')
                }
              : undefined
          }
        />

        <LocalAsync
          loading={loading}
          hydrated={local.hydrated}
          empty={filtered.length === 0}
          emptyMessage={query.trim() === '' ? t('s2.noShops') : t('s1.noMatch')}
          rows={6}
        >
          <Stack testID="shops-list">
            {filtered.map((shop) => {
              const due = dues.get(shop.id)
              return (
                <TwoLine
                  key={shop.id}
                  testID={`shop-row-${shop.id}`}
                  primary={shop.name}
                  secondary={[
                    shop.code,
                    beats.find((beat) => beat.id === shop.beat_id)?.name,
                    shop.address?.area,
                  ]
                    .filter((part) => typeof part === 'string' && part !== '')
                    .join(' · ')}
                  trailing={
                    <Row gap={2} align="center">
                      <Money
                        value={
                          due === undefined || due.outstanding_paise === 0
                            ? null
                            : due.outstanding_paise
                        }
                        size="moneyM"
                      />
                      <StatusChip
                        label={shop.tier ?? '—'}
                        family={duesFamily(due?.overdue_paise ?? 0, due?.outstanding_paise ?? 0)}
                      />
                    </Row>
                  }
                  onPress={() => {
                    router.push(`/shops/${shop.id}`)
                  }}
                />
              )
            })}
          </Stack>
        </LocalAsync>

        {capped ? (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('s2.capped', { shown: filtered.length, total: matching.length })}
          </Txt>
        ) : null}
      </Stack>
    </Screen>
  )
}
