import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { uuidv7 } from '@dos/domain'
import type { PriceList, Scheme } from '@dos/contracts'
import { api, newIdempotencyKey } from '../lib/api.js'
import { Money, RupeeInput } from '../components/Money.js'

/**
 * Price lists per tier, schemes (the single typed table the engine reads) and the bargain queue.
 * Everything here is an input to `priceOrder()` in shared/domain; the bill prints exactly what the engine returns.
 */
export function Pricing() {
  const [tab, setTab] = useState<'lists' | 'schemes' | 'bargains'>('lists')
  return (
    <div>
      <h1>Price lists &amp; schemes</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        {(['lists', 'schemes', 'bargains'] as const).map((t) => (
          <button key={t} className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>
            {t === 'lists' ? 'Price lists' : t === 'schemes' ? 'Schemes' : 'Bargain queue'}
          </button>
        ))}
      </div>
      {tab === 'lists' && <PriceLists />}
      {tab === 'schemes' && <Schemes />}
      {tab === 'bargains' && <Bargains />}
    </div>
  )
}

function PriceLists() {
  const qc = useQueryClient()
  const lists = useQuery({
    queryKey: ['pricing', 'lists'],
    queryFn: () => api.pricing.priceLists.list({ withItems: true }),
  })
  const catalog = useQuery({
    queryKey: ['tenantCatalog', 'list', '', true],
    queryFn: () => api.tenantCatalog.list({ listedOnly: true, limit: 500 }),
  })
  const [selected, setSelected] = useState<string | null>(null)
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['pricing', 'lists'] })
  const create = useMutation({
    mutationFn: (input: { name: string; tier: PriceList['tier']; isDefault: boolean }) =>
      api.pricing.priceLists.upsert({
        idempotencyKey: newIdempotencyKey(),
        id: uuidv7(),
        ...input,
        active: true,
      }),
    onSuccess: invalidate,
  })
  const setItems = useMutation({
    mutationFn: (input: {
      priceListId: string
      items: { id: string; variantId: string; ratePaise: number; inclusiveOfGst: boolean }[]
    }) => api.pricing.priceLists.setItems({ idempotencyKey: newIdempotencyKey(), ...input }),
    onSuccess: invalidate,
  })
  const list = lists.data?.items.find((l) => l.id === selected) ?? lists.data?.items[0]
  return (
    <div>
      <div className="card row">
        {lists.data?.items.map((l) => (
          <button
            key={l.id}
            className={list?.id === l.id ? 'primary' : ''}
            onClick={() => setSelected(l.id)}
          >
            {l.name} {l.tier ? `(tier ${l.tier})` : ''} {l.isDefault ? '· default' : ''}
          </button>
        ))}
        <NewList onCreate={(v) => create.mutate(v)} busy={create.isPending} />
      </div>
      {list && catalog.data && (
        <RateTable
          key={list.id}
          list={list}
          variants={catalog.data.items.map((v) => ({
            variantId: v.variantId,
            name: `${v.productName} · ${v.name}`,
            mrpPaise: v.mrpPaise,
          }))}
          busy={setItems.isPending}
          onSave={(items) => setItems.mutate({ priceListId: list.id, items })}
        />
      )}
      {setItems.isError && <p className="error">{setItems.error.message}</p>}
    </div>
  )
}

function NewList({
  onCreate,
  busy,
}: {
  onCreate: (v: { name: string; tier: PriceList['tier']; isDefault: boolean }) => void
  busy: boolean
}) {
  const [name, setName] = useState('')
  const [tier, setTier] = useState<string>('')
  return (
    <span className="row">
      <input
        type="text"
        placeholder="New list name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select value={tier} onChange={(e) => setTier(e.target.value)}>
        <option value="">no tier (default)</option>
        {['A', 'B', 'C', 'D'].map((t) => (
          <option key={t} value={t}>
            tier {t}
          </option>
        ))}
      </select>
      <button
        disabled={!name || busy}
        onClick={() => {
          onCreate({ name, tier: (tier || null) as PriceList['tier'], isDefault: !tier })
          setName('')
        }}
      >
        Create
      </button>
    </span>
  )
}

function RateTable({
  list,
  variants,
  busy,
  onSave,
}: {
  list: PriceList
  variants: { variantId: string; name: string; mrpPaise: number | null }[]
  busy: boolean
  onSave: (
    items: { id: string; variantId: string; ratePaise: number; inclusiveOfGst: boolean }[],
  ) => void
}) {
  const current = useMemo(() => new Map(list.items.map((i) => [i.variantId, i])), [list])
  const [draft, setDraft] = useState<Record<string, number | null>>({})
  const changed = Object.entries(draft).filter(
    ([vid, rate]) => rate !== null && rate !== (current.get(vid)?.ratePaise ?? null),
  )
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>{list.name}</strong>
        <span className="muted">{list.items.length} rates · rates are per piece before GST</span>
        <span className="grow" />
        <button
          className="primary"
          disabled={changed.length === 0 || busy}
          onClick={() =>
            onSave(
              changed.map(([variantId, ratePaise]) => ({
                id: current.get(variantId)?.id ?? uuidv7(),
                variantId,
                ratePaise: ratePaise ?? 0,
                inclusiveOfGst: current.get(variantId)?.inclusiveOfGst ?? false,
              })),
            )
          }
        >
          Save {changed.length > 0 ? `(${changed.length})` : ''}
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">MRP</th>
            <th className="num">Rate</th>
            <th className="num">Margin to retailer</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const rate =
              draft[v.variantId] !== undefined
                ? draft[v.variantId]
                : (current.get(v.variantId)?.ratePaise ?? null)
            const margin = v.mrpPaise && rate ? ((v.mrpPaise - rate) / v.mrpPaise) * 100 : null
            return (
              <tr key={v.variantId}>
                <td>{v.name}</td>
                <td className="num">
                  <Money value={v.mrpPaise} />
                </td>
                <td className="num">
                  <RupeeInput
                    value={rate ?? null}
                    onChange={(p) => setDraft({ ...draft, [v.variantId]: p })}
                  />
                </td>
                <td className="num">
                  {margin === null ? <span className="muted">—</span> : `${margin.toFixed(1)}%`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Schemes() {
  const qc = useQueryClient()
  const schemes = useQuery({
    queryKey: ['pricing', 'schemes'],
    queryFn: () => api.pricing.schemes.list({ activeOnly: false, limit: 200 }),
  })
  const catalog = useQuery({
    queryKey: ['tenantCatalog', 'list', '', true],
    queryFn: () => api.tenantCatalog.list({ listedOnly: true, limit: 500 }),
  })
  const save = useMutation({
    mutationFn: (s: Parameters<typeof api.pricing.schemes.upsert>[0]) =>
      api.pricing.schemes.upsert(s),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pricing', 'schemes'] }),
  })
  const [adding, setAdding] = useState(false)
  const variantName = (id: string | null) =>
    catalog.data?.items.find((v) => v.variantId === id)?.name ?? '—'
  return (
    <div>
      <div className="card row">
        <span className="muted">{schemes.data ? `${schemes.data.items.length} schemes` : ''}</span>
        <span className="grow" />
        <button className="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : 'New scheme'}
        </button>
      </div>
      {adding && catalog.data && (
        <SchemeForm
          variants={catalog.data.items.map((v) => ({
            variantId: v.variantId,
            name: `${v.productName} · ${v.name}`,
          }))}
          busy={save.isPending}
          onSave={(s) => {
            save.mutate(s)
            setAdding(false)
          }}
        />
      )}
      {save.isError && <p className="error">{save.error.message}</p>}
      <table>
        <thead>
          <tr>
            <th>Scheme</th>
            <th>Trigger</th>
            <th>Reward</th>
            <th>Valid</th>
            <th>Funding</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {schemes.data?.items.map((s) => (
            <tr key={s.id}>
              <td>
                {s.name} <span className="muted">v{s.version}</span>
              </td>
              <td>
                {s.triggerKind} ≥ {s.triggerMin} {s.triggerUnit}
                {s.slabs?.length ? ` (${s.slabs.length} slabs)` : ''}
              </td>
              <td>{describeReward(s, variantName)}</td>
              <td>
                {s.validFrom} → {s.validTo}
              </td>
              <td>
                <span className="badge">
                  {s.fundingSource}
                  {s.claimable ? ' · claimable' : ''}
                </span>
              </td>
              <td>
                {!s.stackable && <span className="badge warn">exclusive</span>}{' '}
                {s.final && <span className="badge bad">final</span>}{' '}
                {!s.active && <span className="badge">inactive</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function describeReward(s: Scheme, variantName: (id: string | null) => string): string {
  switch (s.rewardKind) {
    case 'free_qty':
      return `${s.rewardValue} free ${s.freeVariantId ? variantName(s.freeVariantId) : '(same item)'}`
    case 'line_pct':
      return `${(s.rewardValue / 100).toFixed(2)}% off line`
    case 'order_pct':
      return `${(s.rewardValue / 100).toFixed(2)}% off order`
    case 'cash_discount_pct':
      return `${(s.rewardValue / 100).toFixed(2)}% cash discount`
    case 'net_scheme_amount':
      return `₹${(s.rewardValue / 100).toFixed(2)} off`
  }
}

function SchemeForm({
  variants,
  busy,
  onSave,
}: {
  variants: { variantId: string; name: string }[]
  busy: boolean
  onSave: (s: Parameters<typeof api.pricing.schemes.upsert>[0]) => void
}) {
  const [name, setName] = useState('')
  const [variantId, setVariantId] = useState('')
  const [triggerMin, setTriggerMin] = useState(12)
  const [triggerUnit, setTriggerUnit] = useState<'pcs' | 'case'>('pcs')
  const [rewardKind, setRewardKind] = useState<'free_qty' | 'line_pct'>('free_qty')
  const [rewardValue, setRewardValue] = useState(1)
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [validTo, setValidTo] = useState(
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  )
  const [funding, setFunding] = useState<'company' | 'distributor'>('company')
  return (
    <div className="card">
      <div className="row">
        <label className="field grow">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campa 750ml 12+1"
          />
        </label>
        <label className="field">
          Item (empty = all)
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">all listed items</option>
            {variants.map((v) => (
              <option key={v.variantId} value={v.variantId}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Buy at least
          <span className="row">
            <input
              type="number"
              min={1}
              value={triggerMin}
              style={{ width: 70 }}
              onChange={(e) => setTriggerMin(Number(e.target.value) || 1)}
            />
            <select
              value={triggerUnit}
              onChange={(e) => setTriggerUnit(e.target.value as 'pcs' | 'case')}
            >
              <option value="pcs">pcs</option>
              <option value="case">cases</option>
            </select>
          </span>
        </label>
        <label className="field">
          Reward
          <span className="row">
            <select
              value={rewardKind}
              onChange={(e) => setRewardKind(e.target.value as 'free_qty' | 'line_pct')}
            >
              <option value="free_qty">free pieces</option>
              <option value="line_pct">% off line</option>
            </select>
            <input
              type="number"
              min={0}
              value={rewardValue}
              style={{ width: 70 }}
              onChange={(e) => setRewardValue(Number(e.target.value) || 0)}
            />
            <span className="muted">{rewardKind === 'line_pct' ? '%' : 'pcs'}</span>
          </span>
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">
          From
          <input type="text" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </label>
        <label className="field">
          To
          <input type="text" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </label>
        <label className="field">
          Funded by
          <select
            value={funding}
            onChange={(e) => setFunding(e.target.value as 'company' | 'distributor')}
          >
            <option value="company">company (claimable)</option>
            <option value="distributor">distributor</option>
          </select>
        </label>
        <span className="grow" />
        <button
          className="primary"
          disabled={!name || busy}
          onClick={() =>
            onSave({
              idempotencyKey: newIdempotencyKey(),
              id: uuidv7(),
              name,
              brandId: null,
              scope: variantId ? { variantIds: [variantId] } : { all: true },
              triggerKind: 'qty',
              triggerMin,
              triggerUnit,
              slabs: null,
              rewardKind,
              rewardValue: rewardKind === 'line_pct' ? Math.round(rewardValue * 100) : rewardValue,
              freeVariantId: null,
              applicability: {},
              validFrom,
              validTo,
              stackable: true,
              final: false,
              fundingSource: funding,
              claimable: funding === 'company',
              claimWindowDays: funding === 'company' ? 45 : null,
              gstOnFreeGoods: false,
              pricingDateMode: 'order',
              sourceRef: null,
              active: true,
            })
          }
        >
          Save scheme
        </button>
      </div>
    </div>
  )
}

function Bargains() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['pricing', 'bargains'],
    queryFn: () => api.pricing.bargains.list({ limit: 100 }),
    refetchInterval: 15_000,
  })
  const retailers = useQuery({
    queryKey: ['retailers', 'list', ''],
    queryFn: () => api.retailers.list({ limit: 500 }),
  })
  const catalog = useQuery({
    queryKey: ['tenantCatalog', 'list', '', true],
    queryFn: () => api.tenantCatalog.list({ listedOnly: true, limit: 500 }),
  })
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: 'approve' | 'reject' }) =>
      api.pricing.bargains.decide({ idempotencyKey: newIdempotencyKey(), ...input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pricing', 'bargains'] }),
  })
  const shop = (id: string) =>
    retailers.data?.items.find((r) => r.id === id)?.name ?? id.slice(0, 8)
  const item = (id: string) =>
    catalog.data?.items.find((v) => v.variantId === id)?.name ?? id.slice(0, 8)
  return (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Shop</th>
          <th>Item</th>
          <th className="num">List</th>
          <th className="num">Asked</th>
          <th className="num">Off</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {list.data?.items.map((b) => (
          <tr key={b.id}>
            <td>{new Date(b.createdAt).toLocaleString('en-IN')}</td>
            <td>{shop(b.retailerId)}</td>
            <td>{item(b.variantId)}</td>
            <td className="num">
              <Money value={b.listRatePaise} />
            </td>
            <td className="num">
              <Money value={b.askedRatePaise} />
            </td>
            <td className="num">
              {b.listRatePaise
                ? `${(((b.listRatePaise - b.askedRatePaise) / b.listRatePaise) * 100).toFixed(1)}%`
                : '—'}
            </td>
            <td>
              <span
                className={`badge ${b.status === 'requested' ? 'warn' : b.status.includes('approved') ? 'ok' : ''}`}
              >
                {b.status}
              </span>
            </td>
            <td>
              {b.status === 'requested' && (
                <>
                  <button
                    className="primary"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: b.id, decision: 'approve' })}
                  >
                    Approve
                  </button>{' '}
                  <button
                    className="danger"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: b.id, decision: 'reject' })}
                  >
                    Reject
                  </button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
