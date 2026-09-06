/**
 * O8 — prices and schemes (docs/23 §1.1).
 *
 * Four things live here and they are read in this order: the rate cards per tier, the schemes that
 * bend them, the per-shop overrides that beat both, and a what-if that prices a real basket through
 * `pricing.quote` — the SAME engine an order goes through, so what this screen says is what the shop
 * will be charged.
 */
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  Money,
  Register,
  Screen,
  Search,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, Panel, moneyColumn, textColumn, useNames } from '../../src/lib/ui'
import { longDate, today } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

type PriceListItem = {
  id: string
  priceListId: string
  variantId: string
  ratePaise: number
  inclusiveOfGst: boolean
}
type PriceList = {
  id: string
  name: string
  tier: string | null
  isDefault: boolean
  validFrom: string | null
  validTo: string | null
  active: boolean
  items: readonly PriceListItem[]
}
type Scheme = {
  id: string
  name: string
  brandId: string | null
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

type View = 'lists' | 'schemes' | 'overrides' | 'quote'

export default function Prices(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const names = useNames()
  const [view, setView] = useState<View>('lists')
  const [listId, setListId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [quoteRetailer, setQuoteRetailer] = useState('')
  const [quoteVariant, setQuoteVariant] = useState('')
  const [quoteQty, setQuoteQty] = useState('12')

  const lists = useQuery(['pricing', 'priceLists'], () => api.api.pricing.priceLists.list({}))
  const schemes = useQuery(['pricing', 'schemes'], () =>
    api.api.pricing.schemes.list({ limit: 200, activeOnly: false }),
  )
  const overrides = useQuery(['pricing', 'overrides'], () =>
    api.api.pricing.overrides.list({ limit: 200 }),
  )
  const catalog = useQuery(['tenantCatalog', 'forPrices'], () =>
    api.api.tenantCatalog.list({ limit: 500, listedOnly: true }),
  )

  const [quote, setQuote] = useState<{
    netPaise: number
    rules: readonly string[]
  } | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const variantName = (variantId: string): string =>
    catalog.data?.items.find((row) => row.variantId === variantId)?.name ?? variantId.slice(0, 8)

  const listRows = (lists.data?.items ?? []) as readonly PriceList[]
  const current = listRows.find((row) => row.id === listId) ?? listRows[0] ?? null
  const itemRows = (current?.items ?? []).filter((item) =>
    q === '' ? true : variantName(item.variantId).toLowerCase().includes(q.toLowerCase()),
  )

  const runQuote = (): void => {
    setQuoteError(null)
    const retailer = quoteRetailer.trim()
    const variant = quoteVariant.trim()
    const qty = Number.parseInt(quoteQty, 10)
    if (retailer === '' || variant === '' || !Number.isInteger(qty) || qty <= 0) return
    void api.api.pricing
      .quote({
        retailerId: retailer,
        pricingDate: today(),
        lines: [{ lineId: 'what-if-1', variantId: variant, qtyPcs: qty }],
      })
      .then(
        (result) => {
          const first = result.lines[0]
          setQuote({
            netPaise: result.totals.netPaise,
            rules: [...(first?.appliedRules ?? []), ...result.orderRules].map(
              (rule) =>
                `${word(rule.kind)}${rule.rewardKind === undefined ? '' : ` · ${word(rule.rewardKind)}`}`,
            ),
          })
        },
        (error: unknown) => {
          setQuoteError(error instanceof Error ? error.message : t('state.error'))
        },
      )
  }

  const itemColumns: readonly RegisterColumn<PriceListItem>[] = [
    textColumn('item', t('o8.item'), (row) => variantName(row.variantId), {
      priority: 'identity',
    }),
    moneyColumn('rate', t('o8.rate'), (row) => row.ratePaise),
    {
      /*
       * The head used to read "GST" and the chip "No", which together say the opposite of what the
       * column means: this is whether the RATE BESIDE IT already has tax in it, not whether the item
       * is taxed. It names the question now, so the answer is readable on its own.
       */
      key: 'incl',
      head: t('o8.gstIncluded'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={row.inclusiveOfGst ? t('word.yes') : t('word.no')} family="neutral" />
      ),
    },
  ]

  const schemeColumns: readonly RegisterColumn<Scheme>[] = [
    textColumn('name', t('o8.scheme'), (row) => row.name, { priority: 'identity' }),
    textColumn(
      'trigger',
      t('o8.trigger'),
      (row) => `${row.triggerKind} ≥ ${String(row.triggerMin)} ${row.triggerUnit}`,
    ),
    textColumn('reward', t('o8.reward'), (row) => `${row.rewardKind} ${String(row.rewardValue)}`),
    textColumn('funding', t('o8.funding'), (row) => row.fundingSource),
    textColumn(
      'valid',
      t('o8.valid'),
      (row) => `${longDate(row.validFrom)} – ${longDate(row.validTo)}`,
    ),
    {
      key: 'flags',
      head: t('o8.stackable'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.final ? t('o8.final') : row.stackable ? t('o8.stackable') : t('word.no')}
          family={row.active ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const overrideRows = overrides.data?.items ?? []
  type Override = (typeof overrideRows)[number]

  const overrideColumns: readonly RegisterColumn<Override>[] = [
    textColumn('shop', t('o8.quoteShop'), (row) => names.retailer(row.retailerId), {
      priority: 'identity',
    }),
    textColumn('item', t('o8.item'), (row) => variantName(row.variantId)),
    moneyColumn('rate', t('o8.overrideRate'), (row) => row.ratePaise),
    {
      key: 'final',
      head: t('o8.final'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.final ? t('o8.final') : t('o8.stackable')}
          family={row.final ? 'clay' : 'neutral'}
        />
      ),
    },
    textColumn(
      'valid',
      t('o8.valid'),
      (row) => `${longDate(row.validFrom)} – ${longDate(row.validTo)}`,
    ),
  ]

  return (
    <Screen
      title={t('o8.title')}
      actions={
        <Segments
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'lists', label: t('o8.priceLists') },
            { id: 'schemes', label: t('o8.schemes') },
            { id: 'overrides', label: t('o8.overrides') },
            { id: 'quote', label: t('o8.quote') },
          ]}
          testID="prices-view"
        />
      }
    >
      <Stack gap={4}>
        {view === 'lists' ? (
          <>
            <Segments
              value={current?.id ?? ''}
              onChange={setListId}
              items={listRows.slice(0, 3).map((row) => ({
                id: row.id,
                label: row.isDefault ? `${row.name} · ${t('o8.default')}` : row.name,
              }))}
              testID="prices-lists"
            />
            <Search
              testID="prices-search"
              value={q}
              onChange={setQ}
              placeholder={t('o9.search')}
              state={q === '' ? 'idle' : itemRows.length === 0 ? 'noResults' : 'results'}
            />
            <Async
              state={[lists]}
              rows={10}
              empty={itemRows.length === 0}
              emptyMessage={t('o8.empty')}
            >
              <Register
                testID="prices-items"
                columns={itemColumns}
                rows={itemRows}
                rowKey={(row) => row.id}
                frozen="item"
                state="ready"
                totals={{ item: t('app.rows', { count: itemRows.length }) }}
              />
            </Async>
          </>
        ) : null}

        {view === 'schemes' ? (
          <Async state={[schemes]} rows={10} empty={(schemes.data?.items.length ?? 0) === 0}>
            <Register
              testID="prices-schemes"
              columns={schemeColumns}
              rows={(schemes.data?.items ?? []) as readonly Scheme[]}
              rowKey={(row) => row.id}
              frozen="name"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'overrides' ? (
          <Async state={[overrides]} rows={10} empty={(overrides.data?.items.length ?? 0) === 0}>
            <Register
              testID="prices-overrides"
              columns={overrideColumns}
              rows={overrideRows}
              rowKey={(row) => row.id}
              frozen="shop"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'quote' ? (
          <Panel title={t('o8.quote')} testID="prices-quote">
            <Stack gap={3} maxWidth={520}>
              <TextInput
                label={t('o8.quoteShop')}
                value={quoteRetailer}
                onChange={setQuoteRetailer}
                helper={t('o6.code')}
              />
              <TextInput
                label={t('o8.quoteItem')}
                value={quoteVariant}
                onChange={setQuoteVariant}
                helper={t('o9.item')}
              />
              <TextInput
                label={t('o8.quoteQty')}
                value={quoteQty}
                onChange={setQuoteQty}
                keyboard="decimal"
              />
              <Button
                label={t('o8.quoteRun')}
                variant="primary"
                onPress={runQuote}
                testID="prices-quote-run"
              />
              {quoteError === null ? null : (
                <Txt field="body" desk="body">
                  {quoteError}
                </Txt>
              )}
              {quote === null ? null : (
                <Stack gap={2}>
                  <Field label={t('o8.quoteNet')}>
                    <Money value={quote.netPaise} size="moneyL" />
                  </Field>
                  <Field label={t('o8.quoteRules')}>
                    {quote.rules.join(' · ') || t('app.none')}
                  </Field>
                </Stack>
              )}
            </Stack>
          </Panel>
        ) : null}
      </Stack>
    </Screen>
  )
}
