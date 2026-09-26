/**
 * O8 — prices and schemes (docs/23 §1.1).
 *
 * Four things live here and they are read in this order: the rate cards per tier, the schemes that
 * bend them, the per-shop overrides that beat both, and a what-if that prices a real basket through
 * `pricing.quote` — the SAME engine an order goes through, so what this screen says is what the shop
 * will be charged.
 *
 * DOS-214: all three are EDITED here now, not only read. A rate on a list (`priceLists.setItems`, one
 * item per call), a shop's own rate with the `final` mark, and a scheme — created, changed, paused
 * (`schemes.upsert`). The editors are `src/pricing/editors.tsx`, shared with the manager's desk, and
 * each says "saved" only after the service has answered 2xx (never-list #12). The same finding named
 * two caps on this screen, both gone: every price list is offered (Tier C was cut off by a three-item
 * `Segments`) and the what-if view is reachable (the view switch is a four-tab row now).
 */
import type { PriceList, PriceListItem, RetailerPriceOverride, Scheme } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Money,
  Register,
  Screen,
  Search,
  Stack,
  StatusChip,
  Tabs,
  TextInput,
  Toast,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { formatINR, paise } from '@dos/domain'
import { useState } from 'react'

import {
  Async,
  Field,
  Panel,
  moneyColumn,
  textColumn,
  useNames,
} from '../../../src/groups/owner/lib/ui'
import { longDate, today } from '../../../src/groups/owner/lib/dates'
import { formatBps, useWord } from '../../../src/groups/owner/lib/words'
import { overrideState, schemeState } from '../../../src/pricing/forms'
import {
  OverrideSheet,
  PriceRateDialog,
  SchemeSheet,
  deskScheme,
  useMayWrite,
} from '../../../src/pricing/editors'

type View = 'lists' | 'schemes' | 'overrides' | 'quote'

export default function Prices(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const may = useMayWrite()
  const [view, setView] = useState<View>('lists')
  const [listId, setListId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [quoteRetailer, setQuoteRetailer] = useState('')
  const [quoteVariant, setQuoteVariant] = useState('')
  const [quoteQty, setQuoteQty] = useState('12')
  const [toast, setToast] = useState<string | null>(null)

  /* Which editor is open, and on what: `null` row = a new one. */
  const [rateFor, setRateFor] = useState<{ item: PriceListItem | null } | null>(null)
  const [schemeFor, setSchemeFor] = useState<{ row: Scheme | null } | null>(null)
  const [overrideFor, setOverrideFor] = useState<{ row: RetailerPriceOverride | null } | null>(null)

  const mayRates = may('pricing.priceLists.setItems')
  const maySchemes = may('pricing.schemes.upsert')
  const mayOverrides = may('pricing.overrides.upsert')

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

  /*
   * The tenant's LISTED catalogue names an override row, which carries no name of its own. It must not name
   * a price-list row: a list may price a variant the tenant never listed (DOS-013 — Chamak Glass Cleaner is
   * priced in all four lists and listed in none), and the id showed instead of the item. A price-list item
   * now carries `variantName` from the server, resolved the same way an order line is.
   */
  const variantName = (variantId: string): string =>
    catalog.data?.items.find((row) => row.variantId === variantId)?.name ?? variantId.slice(0, 8)

  const listRows: readonly PriceList[] = lists.data?.items ?? []
  const current = listRows.find((row) => row.id === listId) ?? listRows[0] ?? null
  const itemRows = (current?.items ?? []).filter((item) =>
    q === '' ? true : item.variantName.toLowerCase().includes(q.toLowerCase()),
  )
  const schemeRows = (schemes.data?.items ?? [])
    .map((row) => deskScheme(row))
    .filter((row): row is NonNullable<typeof row> => row !== null)
  const overrideRows = overrides.data?.items ?? []
  const day = today()

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
    textColumn('item', t('o8.item'), (row) => row.variantName, {
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

  /*
   * The scheme's own economics, in the units the contract states and NOT the integers it stores:
   * `triggerMin` is PAISE when the unit is `inr` and a piece/case count otherwise, and `rewardValue`
   * is BASIS POINTS for the three `_pct` kinds, free pieces for `free_qty` and paise for
   * `net_scheme_amount` (`pricing.ts`, "free pieces, bps for the pct kinds, paise for
   * net_scheme_amount"). This register printed the raw integer under the raw enum, so the pilot's own
   * "2% off on bills over ₹5,000" read `value ≥ 500000 inr` / `order_pct 200` — a threshold a hundred
   * times too big beside a discount a hundred times too big.
   */
  const trigger = (row: Scheme): string =>
    row.triggerUnit === 'inr'
      ? `${word(row.triggerKind)} ≥ ${formatINR(paise(row.triggerMin))}`
      : `${word(row.triggerKind)} ≥ ${String(row.triggerMin)} ${word(row.triggerUnit)}`

  const reward = (row: Scheme): string => {
    if (row.rewardKind === 'free_qty') {
      return `${word(row.rewardKind)}: ${String(row.rewardValue)}`
    }
    // DOS-087: `per_unit_amount` is money too — paise per case or per piece, not a percentage.
    if (row.rewardKind === 'net_scheme_amount' || row.rewardKind === 'per_unit_amount') {
      return `${word(row.rewardKind)}: ${formatINR(paise(row.rewardValue))}`
    }
    return `${word(row.rewardKind)}: ${formatBps(row.rewardValue)}`
  }

  const schemeColumns: readonly RegisterColumn<Scheme>[] = [
    textColumn('name', t('o8.scheme'), (row) => row.name, { priority: 'identity' }),
    {
      key: 'state',
      head: t('px.status'),
      priority: 'chip',
      cell: (row) => {
        const state = schemeState(row, day)
        return (
          <StatusChip
            label={t(`px.state.${state}`)}
            family={state === 'running' ? 'moss' : 'neutral'}
          />
        )
      },
    },
    textColumn('trigger', t('o8.trigger'), trigger),
    textColumn('reward', t('o8.reward'), reward),
    textColumn('funding', t('o8.funding'), (row) => word(row.fundingSource)),
    textColumn(
      'valid',
      t('o8.valid'),
      (row) => `${longDate(row.validFrom)} – ${longDate(row.validTo)}`,
    ),
    {
      key: 'flags',
      head: t('o8.stackable'),
      cell: (row) => (
        <StatusChip
          label={row.final ? t('o8.final') : row.stackable ? t('o8.stackable') : t('px.exclusive')}
          family="neutral"
        />
      ),
    },
  ]

  const overrideColumns: readonly RegisterColumn<RetailerPriceOverride>[] = [
    textColumn('shop', t('o8.quoteShop'), (row) => names.retailer(row.retailerId), {
      priority: 'identity',
    }),
    textColumn('item', t('o8.item'), (row) => variantName(row.variantId)),
    moneyColumn('rate', t('o8.overrideRate'), (row) => row.ratePaise),
    {
      key: 'final',
      head: t('o8.final'),
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
    {
      key: 'state',
      head: t('px.status'),
      priority: 'chip',
      cell: (row) => {
        const state = overrideState(row, day)
        return (
          <StatusChip
            label={t(`px.state.${state}`)}
            family={state === 'running' ? 'moss' : 'neutral'}
          />
        )
      },
    },
  ]

  /* The one primary action of the view in front of the desk, and only where the matrix allows it. */
  const action =
    view === 'lists' && mayRates && current !== null ? (
      <Button
        label={t('px.addItem')}
        variant="primary"
        onPress={() => {
          setRateFor({ item: null })
        }}
        testID="prices-add-item"
      />
    ) : view === 'schemes' && maySchemes ? (
      <Button
        label={t('px.newScheme')}
        variant="primary"
        onPress={() => {
          setSchemeFor({ row: null })
        }}
        testID="prices-new-scheme"
      />
    ) : view === 'overrides' && mayOverrides ? (
      <Button
        label={t('px.setShopRate')}
        variant="primary"
        onPress={() => {
          setOverrideFor({ row: null })
        }}
        testID="prices-new-override"
      />
    ) : undefined

  const hint = (allowed: boolean): React.JSX.Element => (
    <Txt field="label" desk="meta" color={colors.text.secondary}>
      {allowed ? t('px.tapToEdit') : t('px.readOnly')}
    </Txt>
  )

  return (
    <Screen title={t('o8.title')} actions={action}>
      <Stack gap={4}>
        <Tabs
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'lists', label: t('px.tab.lists') },
            { id: 'schemes', label: t('px.tab.schemes') },
            { id: 'overrides', label: t('px.tab.shopRates') },
            { id: 'quote', label: t('px.tab.whatIf') },
          ]}
          testID="prices-view"
        />

        {view === 'lists' ? (
          <>
            {/* Every list, not the first three: Tier C and Tier D are lists a distributor prices too. */}
            <Chips
              testID="prices-lists"
              items={listRows.map((row) => ({
                id: row.id,
                label: row.isDefault ? `${row.name} · ${t('o8.default')}` : row.name,
                selected: row.id === current?.id,
              }))}
              onToggle={setListId}
            />
            <Search
              testID="prices-search"
              value={q}
              onChange={setQ}
              placeholder={t('px.filterList')}
              state={q === '' ? 'idle' : itemRows.length === 0 ? 'noResults' : 'results'}
            />
            {hint(mayRates)}
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
                {...(mayRates
                  ? {
                      onSelect: (row: PriceListItem) => {
                        setRateFor({ item: row })
                      },
                    }
                  : {})}
              />
            </Async>
          </>
        ) : null}

        {view === 'schemes' ? (
          <>
            {hint(maySchemes)}
            <Async state={[schemes]} rows={10} empty={schemeRows.length === 0}>
              <Register
                testID="prices-schemes"
                columns={schemeColumns}
                rows={schemeRows}
                rowKey={(row) => row.id}
                frozen="name"
                state="ready"
                totals={{ name: t('app.rows', { count: schemeRows.length }) }}
                {...(maySchemes
                  ? {
                      onSelect: (row: Scheme) => {
                        setSchemeFor({ row })
                      },
                    }
                  : {})}
              />
            </Async>
          </>
        ) : null}

        {view === 'overrides' ? (
          <>
            {hint(mayOverrides)}
            <Async state={[overrides]} rows={10} empty={overrideRows.length === 0}>
              <Register
                testID="prices-overrides"
                columns={overrideColumns}
                rows={overrideRows}
                rowKey={(row) => row.id}
                frozen="shop"
                state="ready"
                totals={{ shop: t('app.rows', { count: overrideRows.length }) }}
                {...(mayOverrides
                  ? {
                      onSelect: (row: RetailerPriceOverride) => {
                        setOverrideFor({ row })
                      },
                    }
                  : {})}
              />
            </Async>
          </>
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

      <PriceRateDialog
        list={current}
        item={rateFor?.item ?? null}
        open={rateFor !== null}
        onClose={() => {
          setRateFor(null)
        }}
        onSaved={setToast}
      />
      <SchemeSheet
        open={schemeFor !== null}
        row={schemeFor?.row ?? null}
        onClose={() => {
          setSchemeFor(null)
        }}
        onSaved={setToast}
      />
      <OverrideSheet
        open={overrideFor !== null}
        row={overrideFor?.row ?? null}
        rows={overrideRows}
        onClose={() => {
          setOverrideFor(null)
        }}
        onSaved={setToast}
      />
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="prices-toast"
      />
    </Screen>
  )
}
