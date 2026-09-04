import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { uuidv7 } from '@dos/domain'
import { api, newIdempotencyKey, qk } from '../lib/api.js'
import { Money, RupeeInput } from '../components/Money.js'
import { useSession } from '../lib/session.js'

/**
 * Purchase cost per variant. Owner/manager/accountant only: the API returns 403 and the database returns
 * nothing for any other role, so this page is the only place a margin is ever visible.
 */
export function Costs() {
  const { session } = useSession()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const listed = useQuery({
    queryKey: qk.tenantCatalog(q, true),
    queryFn: () => api.tenantCatalog.list({ q: q || undefined, listedOnly: true, limit: 500 }),
  })
  const costs = useQuery({
    queryKey: qk.costs(),
    queryFn: () => api.tenantCatalog.costs({ limit: 500 }),
  })
  const suppliers = useQuery({
    queryKey: qk.suppliers(),
    queryFn: () => api.tenantCatalog.suppliers(),
  })
  const save = useMutation({
    mutationFn: (input: {
      variantId: string
      purchaseRatePaise: number
      landedCostPaise: number
      supplierId: string | null
    }) =>
      api.tenantCatalog.upsertCost({ idempotencyKey: newIdempotencyKey(), id: uuidv7(), ...input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenantCatalog', 'costs'] }),
  })
  if (session && !['owner', 'manager', 'accountant'].includes(session.role)) {
    return (
      <div>
        <h1>Purchase costs</h1>
        <p className="error">Your role cannot see purchase costs.</p>
      </div>
    )
  }
  const latestByVariant = new Map<string, NonNullable<typeof costs.data>['items'][number]>()
  for (const c of costs.data?.items ?? [])
    if (!latestByVariant.has(c.variantId)) latestByVariant.set(c.variantId, c)

  return (
    <div>
      <h1>Purchase costs</h1>
      <div className="card row">
        <input
          type="search"
          className="grow"
          placeholder="Search listed products"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">
          Costs update automatically from posted GRNs; edit here for opening stock or corrections.
        </span>
      </div>
      {costs.isError && (
        <p className="error">Costs unavailable (403 means your role is not allowed).</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">MRP</th>
            <th className="num">Purchase rate</th>
            <th className="num">Landed cost</th>
            <th className="num">Margin on MRP</th>
            <th>Supplier</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {listed.data?.items.map((item) => {
            const cost = latestByVariant.get(item.variantId)
            return (
              <CostRow
                key={item.variantId}
                name={`${item.productName} · ${item.name}`}
                mrp={item.mrpPaise}
                current={
                  cost
                    ? {
                        purchase: cost.purchaseRatePaise,
                        landed: cost.landedCostPaise,
                        supplierId: cost.supplierId,
                      }
                    : null
                }
                suppliers={suppliers.data?.items ?? []}
                saving={save.isPending}
                onSave={(v) => save.mutate({ variantId: item.variantId, ...v })}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CostRow(props: {
  name: string
  mrp: number | null
  current: { purchase: number; landed: number; supplierId: string | null } | null
  suppliers: { id: string; name: string }[]
  saving: boolean
  onSave: (v: {
    purchaseRatePaise: number
    landedCostPaise: number
    supplierId: string | null
  }) => void
}) {
  const [purchase, setPurchase] = useState<number | null>(props.current?.purchase ?? null)
  const [landed, setLanded] = useState<number | null>(props.current?.landed ?? null)
  const [supplierId, setSupplierId] = useState<string | null>(props.current?.supplierId ?? null)
  const marginBps =
    props.mrp && landed ? Math.round(((props.mrp - landed) / props.mrp) * 10_000) : null
  const dirty =
    purchase !== (props.current?.purchase ?? null) ||
    landed !== (props.current?.landed ?? null) ||
    supplierId !== (props.current?.supplierId ?? null)
  return (
    <tr>
      <td>{props.name}</td>
      <td className="num">
        <Money value={props.mrp} />
      </td>
      <td className="num">
        <RupeeInput
          value={purchase}
          onChange={(p) => {
            setPurchase(p)
            if (landed === null && p !== null) setLanded(p)
          }}
        />
      </td>
      <td className="num">
        <RupeeInput value={landed} onChange={setLanded} />
      </td>
      <td className="num">
        {marginBps === null ? <span className="muted">—</span> : `${(marginBps / 100).toFixed(2)}%`}
      </td>
      <td>
        <select value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value || null)}>
          <option value="">—</option>
          {props.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        {dirty && purchase !== null && landed !== null && (
          <button
            className="primary"
            disabled={props.saving}
            onClick={() =>
              props.onSave({ purchaseRatePaise: purchase, landedCostPaise: landed, supplierId })
            }
          >
            Save
          </button>
        )}
      </td>
    </tr>
  )
}
