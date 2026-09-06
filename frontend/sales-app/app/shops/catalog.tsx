/**
 * S11 · Catalog and stock, and the deals worth pitching.
 *
 * The catalog itself is on the phone (`tenant_products` joined to the global product master), so
 * search works in a doorway. Availability is the one figure that is NOT: `sellable_stock` is not in
 * this role's manifest, so with no signal the rows carry no availability chip rather than a stale one.
 *
 * "Deals to pitch" is `schemes` valid today, read off the same rows `priceOrder()` prices with — the
 * banner and the price can never disagree, because they are the same table.
 *
 * There is no cost column and there is no cost row: `tenant_product_costs` is not on this device and
 * `tenantCatalog.costs` refuses this role at the server (docs/23 §3.3).
 */
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Group,
  ListRow,
  Row,
  Screen,
  Search,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useMemo, useState } from 'react'

import { shortDate, today } from '../../src/lib/dates'
import { useCatalog, useLocalState, useSchemes } from '../../src/lib/local'
import { LocalAsync, PageTabs, Panel } from '../../src/lib/ui'
import { formatBps } from '../../src/lib/words'
import { useWord } from '../../src/lib/words'

type View = 'all' | 'deals' | 'stock'

export default function Catalog(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const local = useLocalState()
  const word = useWord()
  const { items, loading } = useCatalog()
  const schemes = useSchemes()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>('all')

  const stock = useQuery(
    ['inventory', 'sellable', 'catalog'],
    () => api.api.inventory.stock.sellable({ limit: 500 }),
    { staleTime: 120_000 },
  )
  const availableByVariant = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of stock.data?.items ?? [])
      totals.set(row.variantId, (totals.get(row.variantId) ?? 0) + row.available)
    return totals
  }, [stock.data])

  const day = today()
  const liveSchemes = useMemo(
    () => schemes.filter((row) => row.valid_from <= day && row.valid_to >= day),
    [schemes, day],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const pool =
      view === 'stock'
        ? items.filter((item) => (availableByVariant.get(item.variantId) ?? 0) > 0)
        : items
    if (needle === '') return pool.slice(0, 60)
    return pool
      .filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.productName.toLowerCase().includes(needle) ||
          (item.brandName ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 60)
  }, [items, query, view, availableByVariant])

  return (
    <Screen
      title={t('s11.title')}
      chips={
        <Row gap={2} wrap>
          <StatusChip label={t('s11.itemCount', { count: items.length })} family="neutral" figure />
          <StatusChip
            label={t('s11.dealCount', { count: liveSchemes.length })}
            family={liveSchemes.length === 0 ? 'neutral' : 'clay'}
            figure
          />
        </Row>
      }
    >
      <Stack gap={4}>
        <PageTabs group="/shops" active="/shops/catalog" />

        <Segments
          testID="catalog-view"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'all', label: t('s11.viewAll') },
            { id: 'deals', label: t('s11.viewDeals') },
            { id: 'stock', label: t('s11.viewStock') },
          ]}
        />

        {view === 'deals' ? (
          <Panel title={t('s11.deals')} meta={t('s11.dealsMeta')}>
            {liveSchemes.length === 0 ? (
              <Txt field="body" desk="body" color={colors.text.secondary}>
                {t('s11.noDeals')}
              </Txt>
            ) : (
              <Group>
                {liveSchemes.map((scheme) => (
                  <ListRow
                    key={scheme.id}
                    primary={scheme.name}
                    secondary={t('s11.dealWindow', {
                      from: shortDate(scheme.valid_from),
                      to: shortDate(scheme.valid_to),
                      trigger: `${String(scheme.trigger_min)} ${word(scheme.trigger_unit)}`,
                    })}
                    trailing={
                      <StatusChip
                        label={
                          scheme.reward_kind.endsWith('_pct')
                            ? formatBps(scheme.reward_value)
                            : `${word(scheme.reward_kind)} ${String(scheme.reward_value)}`
                        }
                        family="clay"
                        figure
                      />
                    }
                  />
                ))}
              </Group>
            )}
          </Panel>
        ) : (
          <Stack gap={4}>
            <Search
              testID="catalog-search"
              value={query}
              onChange={setQuery}
              placeholder={t('s11.search')}
              state={query.trim() === '' ? 'idle' : filtered.length === 0 ? 'noResults' : 'results'}
            />
            {view === 'stock' && !local.online ? (
              <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
                {t('s11.stockNeedsSignal')}
              </Txt>
            ) : null}
            <LocalAsync
              loading={loading}
              hydrated={local.hydrated}
              empty={filtered.length === 0}
              emptyMessage={query.trim() === '' ? t('s11.empty') : t('s1.noMatch')}
              rows={6}
            >
              <Group>
                {filtered.map((item) => {
                  const available = availableByVariant.get(item.variantId)
                  return (
                    <ListRow
                      key={item.variantId}
                      primary={item.name}
                      secondary={[item.brandName, t('s3.caseOf', { pieces: item.caseSize })]
                        .filter((part) => part !== null && part !== '')
                        .join(' · ')}
                      trailingMoney={item.mrpPaise}
                      trailing={
                        available === undefined ? undefined : (
                          <StatusChip
                            label={t('qty.available', {
                              cases: Math.floor(available / Math.max(1, item.caseSize)),
                            })}
                            family={available === 0 ? 'brick' : 'moss'}
                            figure
                          />
                        )
                      }
                    />
                  )
                })}
              </Group>
            </LocalAsync>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('s11.mrpNote')}
            </Txt>
          </Stack>
        )}
      </Stack>
    </Screen>
  )
}
