/**
 * M15 — prices, schemes and shop rates (docs/23 §2.1).
 *
 * The three tables the pricing engine reads, in the order it reads them: the tier PRICE LIST, then a
 * shop's own OVERRIDE, then the SCHEMES (stacked in priority order; a `final` override blocks them).
 * Nothing here recomputes a price — `priceOrder()` is the only engine and it runs on the server.
 *
 * Units are the thing this screen has to get right, because the contract stores them as integers:
 * `triggerMin` is PAISE when the unit is `inr` and a piece or case count otherwise, and `rewardValue`
 * is BASIS POINTS for the three `_pct` kinds, free PIECES for `free_qty` and PAISE for
 * `net_scheme_amount`. Printing the raw integer under the raw enum is how "2% off bills over ₹5,000"
 * becomes "order_pct 200 · value ≥ 500000" — a defect the owner slice's gate found on its own most
 * price-sensitive screen, and the reason these two helpers exist here too.
 *
 * The whole destination is hidden from the accountant: `pricing.priceLists.upsert` is owner +
 * manager, which is the matrix half of the founder's "the accountant has NO prices or schemes"
 * (docs/22 §8, 2026-09-05).
 */
import type { PriceList, PriceListItem, RetailerPriceOverride } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  formatINR,
  paise,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Panel, moneyColumn, textColumn, useCan, useNames } from '../../src/lib/ui'
import { longDate } from '../../src/lib/dates'
import { formatBps, useWord } from '../../src/lib/words'

/** The scheme row as the contract serves it; the two integer fields are the whole point. */
interface Scheme {
  id: string
  name: string
  triggerKind: string
  triggerMin: number
  triggerUnit: string
  rewardKind: string
  rewardValue: number
  validFrom: string
  validTo: string | null
  stackable: boolean
  final: boolean
  fundingSource: string
  claimable: boolean
  active: boolean
}

type View = 'lists' | 'schemes' | 'overrides'

export default function Prices(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const [view, setView] = useState<View>('lists')
  const [listId, setListId] = useState<string | null>(null)

  const lists = useQuery(['pricing', 'priceLists'], () => api.api.pricing.priceLists.list({}))
  const schemes = useQuery(
    ['pricing', 'schemes'],
    () => api.api.pricing.schemes.list({ limit: 200 }),
    { enabled: view === 'schemes' },
  )
  const overrides = useQuery(
    ['pricing', 'overrides'],
    () => api.api.pricing.overrides.list({ limit: 200 }),
    { enabled: view === 'overrides' },
  )

  const listRows = lists.data?.items ?? []
  const current = listRows.find((row) => row.id === listId) ?? listRows[0]

  const trigger = (row: Scheme): string =>
    /* A threshold of nothing is not "≥ ₹0.00"; it is a scheme that always applies. */
    row.triggerMin === 0
      ? t('m15.triggerAlways')
      : row.triggerUnit === 'inr'
        ? t('m15.triggerValue', { amount: formatINR(paise(row.triggerMin)) })
        : t('m15.triggerQty', { count: row.triggerMin })

  const reward = (row: Scheme): string => {
    if (row.rewardKind === 'free_qty') return t('m15.rewardFree', { count: row.rewardValue })
    if (row.rewardKind === 'net_scheme_amount')
      return t('m15.rewardAmount', {
        label: word(row.rewardKind),
        amount: formatINR(paise(row.rewardValue)),
      })
    return t('m15.rewardPct', { label: word(row.rewardKind), pct: formatBps(row.rewardValue) })
  }

  const listColumns: readonly RegisterColumn<PriceList>[] = [
    textColumn('name', t('m15.listName'), (row) => row.name, { priority: 'identity' }),
    textColumn('tier', t('m15.tier'), (row) => row.tier),
    textColumn('from', t('m15.validFrom'), (row) => longDate(row.validFrom)),
    textColumn('to', t('m15.validTo'), (row) => longDate(row.validTo)),
    textColumn('items', t('m15.items'), (row) => row.items.length, { align: 'right' }),
    {
      key: 'active',
      head: t('m15.active'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.active ? t('word.yes') : t('word.no')}
          family={row.active ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const itemColumns: readonly RegisterColumn<PriceListItem>[] = [
    textColumn('item', t('m15.item'), (row) => names.variant(row.variantId), {
      priority: 'identity',
    }),
    moneyColumn('rate', t('m15.rate'), (row) => row.ratePaise),
  ]

  const schemeColumns: readonly RegisterColumn<Scheme>[] = [
    textColumn('name', t('m15.schemeName'), (row) => row.name, { priority: 'identity' }),
    textColumn('trigger', t('m15.trigger'), trigger),
    textColumn('reward', t('m15.reward'), reward),
    textColumn('funding', t('m15.funding'), (row) => word(row.fundingSource)),
    textColumn(
      'valid',
      t('m15.validFrom'),
      (row) => `${longDate(row.validFrom)} – ${longDate(row.validTo)}`,
    ),
    {
      /*
       * `stackable` means the scheme stacks WITH others; the head said "On its own", so a stacking
       * scheme read "On its own: Yes" — the exact opposite of what the engine does with it. The head
       * now names the field it is showing, and `final` (which blocks every other rule) says so.
       */
      key: 'flags',
      head: t('m15.stacks'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.final ? t('m15.final') : row.stackable ? t('word.yes') : t('m15.exclusive')}
          family={row.active ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const overrideColumns: readonly RegisterColumn<RetailerPriceOverride>[] = [
    textColumn('shop', t('m15.shop'), (row) => names.retailer(row.retailerId), {
      priority: 'identity',
    }),
    textColumn('item', t('m15.item'), (row) => names.variant(row.variantId)),
    moneyColumn('rate', t('m15.rate'), (row) => row.ratePaise),
    {
      key: 'final',
      head: t('m15.final'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.final ? t('word.yes') : t('word.no')}
          family={row.final ? 'ochre' : 'neutral'}
        />
      ),
    },
    textColumn('valid', t('m15.validFrom'), (row) => longDate(row.validFrom)),
  ]

  return (
    <Screen
      title={t('m15.title')}
      actions={
        <Segments
          testID="prices-view"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'lists', label: t('m15.priceLists') },
            { id: 'schemes', label: t('m15.schemes') },
            { id: 'overrides', label: t('m15.overrides') },
          ]}
        />
      }
    >
      <Stack gap={6}>
        {view === 'lists' ? (
          <>
            <Async
              state={[lists]}
              rows={6}
              empty={listRows.length === 0}
              emptyMessage={t('m15.empty')}
            >
              <Register
                testID="pricelists-register"
                columns={listColumns}
                rows={listRows}
                rowKey={(row) => row.id}
                frozen="name"
                selectedKey={current?.id ?? null}
                onSelect={(row) => {
                  setListId(row.id)
                }}
                state="ready"
              />
            </Async>

            {current === undefined ? null : (
              <Panel
                title={current.name}
                /* A list with no start date carries NO caption; it used to draw a bare "—". */
                {...(current.validFrom === null
                  ? {}
                  : { meta: t('m15.validFromMeta', { date: longDate(current.validFrom) }) })}
                testID="pricelist-items"
              >
                <Register
                  testID="pricelist-items-register"
                  columns={itemColumns}
                  rows={current.items}
                  rowKey={(row) => row.variantId}
                  frozen="item"
                  state="ready"
                  /*
                   * The rate column carries NO total. Adding twenty-nine per-piece rates together
                   * produces a rupee figure that means nothing — it is not the value of the list,
                   * of an order or of anything a distributor has a word for — and it was printed
                   * in the same weight and place as the sales register's real totals.
                   */
                  totals={{
                    item: t('app.rows', { count: current.items.length }),
                  }}
                />
              </Panel>
            )}
          </>
        ) : view === 'schemes' ? (
          <Async
            state={[schemes]}
            rows={10}
            empty={(schemes.data?.items.length ?? 0) === 0}
            emptyMessage={t('m15.empty')}
          >
            <Register
              testID="schemes-register"
              columns={schemeColumns}
              rows={(schemes.data?.items ?? []) as readonly Scheme[]}
              rowKey={(row) => row.id}
              frozen="name"
              state="ready"
              totals={{ name: t('app.rows', { count: schemes.data?.items.length ?? 0 }) }}
            />
          </Async>
        ) : (
          <Async
            state={[overrides]}
            rows={10}
            empty={(overrides.data?.items.length ?? 0) === 0}
            emptyMessage={t('m15.empty')}
          >
            <Register
              testID="overrides-register"
              columns={overrideColumns}
              rows={overrides.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="shop"
              state="ready"
            />
          </Async>
        )}

        {can('pricing.schemes.upsert') ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('m15.readOnly')}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
