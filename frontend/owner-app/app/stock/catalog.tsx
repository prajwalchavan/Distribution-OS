/**
 * O9 — the catalog: listed items, purchase cost, suppliers, brands and buy-side packs (docs/23 §1.1).
 *
 * Cost is on this screen and nowhere a rep, a driver, a shopkeeper or the godown can reach it: the
 * database refuses it to those roles (`tenant_product_costs`, back-office RLS) and this screen is only
 * ever served by owner-service. That is why the cost column carries the line saying so — a reader
 * should know which figures are the owner's own.
 */
import type { TenantBrand, TenantProduct } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Chips,
  Money,
  Register,
  Screen,
  Search,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import { Async, PageTabs, moneyColumn, textColumn } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

type View = 'items' | 'costs' | 'suppliers' | 'brands'

export default function Catalog(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const [view, setView] = useState<View>('items')
  const [q, setQ] = useState('')
  /*
   * The tab is called "Listed items", and `listedOnly: false` made it anything but: the global
   * catalog is curated across every distributor, so the first 300 rows this answered were 300
   * variants NOBODY here sells — the pilot's own 29 SKUs did not appear at all, each row showing a
   * blank brand, a blank MRP and "Active: No". Listed only is the default; the switch below is how a
   * variant gets found in order to be listed in the first place.
   */
  const [listedOnly, setListedOnly] = useState(true)

  const listings = useQuery(['tenantCatalog', 'list', q, listedOnly], () =>
    api.api.tenantCatalog.list({ limit: 300, listedOnly, ...(q === '' ? {} : { q }) }),
  )
  const costs = useQuery(
    ['tenantCatalog', 'costs'],
    () => api.api.tenantCatalog.costs({ limit: 300 }),
    { enabled: view === 'costs' },
  )
  const suppliers = useQuery(
    ['tenantCatalog', 'suppliers'],
    () => api.api.tenantCatalog.suppliers(),
    { enabled: view === 'suppliers' },
  )
  const brands = useQuery(['tenantCatalog', 'brands'], () => api.api.tenantCatalog.brands.list(), {
    enabled: view === 'brands',
  })

  /**
   * `tenantCatalog.costs` rows carry a `variantId` and no name (an API gap, docs/23 §8.17), so the
   * screen joins them to the listing it already has. A cost row for a variant this distributor does
   * not list — the only ones are left behind by smoke runs — keeps its short id rather than a lie.
   */
  const nameOf = (variantId: string): string =>
    listings.data?.items.find((row) => row.variantId === variantId)?.name ?? variantId.slice(0, 8)

  const itemColumns: readonly RegisterColumn<TenantProduct>[] = [
    textColumn('name', t('o9.item'), (row) => row.name, { priority: 'identity' }),
    textColumn('brand', t('o9.brand'), (row) => row.brandName),
    {
      key: 'case',
      head: t('o9.caseSize'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {row.caseSize ?? row.defaultCaseSize}
        </Txt>
      ),
    },
    moneyColumn('mrp', t('o9.mrp'), (row) => row.mrpPaise),
    {
      key: 'listed',
      head: t('word.active'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.listed ? t('word.yes') : t('word.no')}
          family={row.listed ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const costRows = costs.data?.items ?? []
  const supplierRows = suppliers.data?.items ?? []
  type Cost = (typeof costRows)[number]
  type Supplier = (typeof supplierRows)[number]

  const costColumns: readonly RegisterColumn<Cost>[] = [
    textColumn('item', t('o9.item'), (row) => nameOf(row.variantId), { priority: 'identity' }),
    moneyColumn('purchase', t('o9.cost'), (row) => row.purchaseRatePaise),
    moneyColumn('landed', t('o9.landed'), (row) => row.landedCostPaise),
    moneyColumn('ptd', t('o9.mrp'), (row) => row.ptdPaise),
    textColumn('from', t('o8.valid'), (row) => row.effectiveFrom.slice(0, 10)),
  ]

  const supplierColumns: readonly RegisterColumn<Supplier>[] = [
    textColumn('name', t('o9.supplier'), (row) => row.name, { priority: 'identity' }),
    textColumn('gstin', t('o9.gstin'), (row) => row.gstin),
    textColumn('state', t('o24.stateCode'), (row) => row.stateCode),
    {
      key: 'active',
      head: t('word.active'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.active ? t('word.yes') : t('word.no')}
          family={row.active ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const brandColumns: readonly RegisterColumn<TenantBrand>[] = [
    textColumn('brand', t('o9.brand'), (row) => row.brandName, { priority: 'identity' }),
    textColumn('mode', t('o9.packs'), (row) => word(row.fulfilmentMode)),
    textColumn('claims', t('o19.title'), (row) => word(row.claimChannel)),
    textColumn('force', t('o7.staff'), (row) => word(row.salesForce)),
  ]

  return (
    <Screen
      title={t('o9.title')}
      chips={<PageTabs group="/stock" active="/stock/catalog" />}
      actions={
        <Segments
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'items', label: t('o9.listed') },
            { id: 'costs', label: t('o9.costs') },
            { id: 'suppliers', label: t('o9.suppliers') },
            { id: 'brands', label: t('o9.brands') },
          ]}
          testID="catalog-view"
        />
      }
    >
      <Stack gap={4}>
        {view === 'items' ? (
          <Stack gap={3}>
            <Search
              testID="catalog-search"
              value={q}
              onChange={setQ}
              placeholder={t('o9.search')}
              state={q === '' ? 'idle' : listings.isFetching ? 'typing' : 'results'}
            />
            <Chips
              testID="catalog-listed"
              items={[{ id: 'listed', label: t('o9.listedOnly'), selected: listedOnly }]}
              onToggle={() => {
                setListedOnly((on) => !on)
              }}
            />
          </Stack>
        ) : null}

        {view === 'costs' ? (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('o9.ownerOnly')}
          </Txt>
        ) : null}

        {view === 'items' ? (
          <Async state={[listings]} rows={12} empty={(listings.data?.items.length ?? 0) === 0}>
            <Register
              testID="catalog-items"
              columns={itemColumns}
              rows={listings.data?.items ?? []}
              rowKey={(row) => row.variantId}
              frozen="name"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'costs' ? (
          <Async state={[costs]} rows={12} empty={(costs.data?.items.length ?? 0) === 0}>
            <Register
              testID="catalog-costs"
              columns={costColumns}
              rows={costRows}
              rowKey={(row) => row.id}
              frozen="item"
              state="ready"
              totals={{
                item: t('word.total'),
                landed: (
                  <Money
                    value={(costs.data?.items ?? []).reduce(
                      (sum, row) => sum + row.landedCostPaise,
                      0,
                    )}
                    size="cell"
                    symbol={false}
                  />
                ),
              }}
            />
          </Async>
        ) : null}

        {view === 'suppliers' ? (
          <Async state={[suppliers]} rows={8} empty={(suppliers.data?.items.length ?? 0) === 0}>
            <Register
              testID="catalog-suppliers"
              columns={supplierColumns}
              rows={supplierRows}
              rowKey={(row) => row.id}
              frozen="name"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'brands' ? (
          <Async state={[brands]} rows={8} empty={(brands.data?.items.length ?? 0) === 0}>
            <Register
              testID="catalog-brands"
              columns={brandColumns}
              rows={brands.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="brand"
              state="ready"
            />
          </Async>
        ) : null}
      </Stack>
    </Screen>
  )
}
