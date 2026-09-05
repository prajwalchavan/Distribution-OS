import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { uuidv7 } from '@dos/domain'
import type { TenantProduct } from '@dos/contracts'
import { api, newIdempotencyKey, qk } from '../lib/api.js'
import { Money } from '../components/Money.js'

/**
 * Owner's catalog: what the distributor sells. Global variants come from the curated master; listing,
 * alias and order rules are the tenant overlay (ADR 0005). Costs live on a separate, role-gated page.
 */
export function Catalog() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [listedOnly, setListedOnly] = useState(false)
  const list = useQuery({
    queryKey: qk.tenantCatalog(q, listedOnly),
    queryFn: () => api.tenantCatalog.list({ q: q || undefined, listedOnly, limit: 200 }),
  })
  const upsert = useMutation({
    mutationFn: (item: TenantProduct & { listed: boolean }) =>
      api.tenantCatalog.upsertListing({
        idempotencyKey: newIdempotencyKey(),
        id: item.tenantProductId ?? uuidv7(),
        variantId: item.variantId,
        listed: item.listed,
        localAlias: item.localAlias,
        caseSizeOverride: item.caseSize === item.defaultCaseSize ? null : item.caseSize,
        minOrderQty: item.minOrderQty,
        orderIncrement: item.orderIncrement,
        maxPerOrder: item.maxPerOrder,
        sortOrder: item.sortOrder,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenantCatalog'] }),
  })

  return (
    <div>
      <h1>Catalog</h1>
      <div className="card row">
        <input
          type="search"
          className="grow"
          placeholder="Search product, brand, manufacturer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="row">
          <input
            type="checkbox"
            checked={listedOnly}
            onChange={(e) => setListedOnly(e.target.checked)}
          />{' '}
          listed only
        </label>
        <span className="muted">{list.data ? `${list.data.items.length} variants` : ''}</span>
      </div>
      {list.isError && <p className="error">Could not load the catalog.</p>}
      {upsert.isError && <p className="error">Save failed: {upsert.error.message}</p>}
      <table>
        <thead>
          <tr>
            <th>Sell</th>
            <th>Product</th>
            <th>Brand</th>
            <th>Pack</th>
            <th className="num">MRP</th>
            <th className="num">Case size</th>
            <th className="num">MOQ</th>
            <th>Alias (bill name)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <CatalogRow
              key={item.variantId}
              item={item}
              saving={upsert.isPending}
              onSave={(next) => upsert.mutate(next)}
            />
          ))}
        </tbody>
      </table>
      {list.data?.items.length === 0 && (
        <p className="muted">
          No variants. Propose products from the salesperson app or ask the curator to add the
          brand.
        </p>
      )}
    </div>
  )
}

function CatalogRow({
  item,
  saving,
  onSave,
}: {
  item: TenantProduct
  saving: boolean
  onSave: (next: TenantProduct) => void
}) {
  const [draft, setDraft] = useState<TenantProduct>(item)
  const dirty = JSON.stringify(draft) !== JSON.stringify(item)
  const pack = `${item.netQty} ${item.netUnit}${item.promoExtra ? ` + ${item.promoExtra}` : ''}`
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={draft.listed}
          onChange={(e) => setDraft({ ...draft, listed: e.target.checked })}
        />
      </td>
      <td>
        {item.productName} <span className="muted">· {item.name}</span>
      </td>
      <td>{item.brandName ?? <span className="muted">{item.manufacturerName}</span>}</td>
      <td>{pack}</td>
      <td className="num">
        <Money value={item.mrpPaise} />
      </td>
      <td className="num">
        <input
          type="number"
          min={1}
          value={draft.caseSize}
          style={{ width: 64 }}
          onChange={(e) => setDraft({ ...draft, caseSize: Number(e.target.value) || 1 })}
        />
      </td>
      <td className="num">
        <input
          type="number"
          min={1}
          value={draft.minOrderQty}
          style={{ width: 64 }}
          onChange={(e) => setDraft({ ...draft, minOrderQty: Number(e.target.value) || 1 })}
        />
      </td>
      <td>
        <input
          type="text"
          value={draft.localAlias ?? ''}
          placeholder={item.name}
          onChange={(e) => setDraft({ ...draft, localAlias: e.target.value || null })}
        />
      </td>
      <td>
        {item.status === 'proposed' ? (
          <span className="badge warn">proposed</span>
        ) : (
          <span className="badge ok">{item.status}</span>
        )}{' '}
        {dirty && (
          <button className="primary" disabled={saving} onClick={() => onSave(draft)}>
            Save
          </button>
        )}
      </td>
    </tr>
  )
}
