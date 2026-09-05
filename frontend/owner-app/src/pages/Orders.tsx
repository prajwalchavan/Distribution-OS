import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Order, OrderDetail, Approval } from '@dos/contracts'
import { formatQty, pieces } from '@dos/domain'
import { api, newIdempotencyKey } from '../lib/api.js'
import { Money } from '../components/Money.js'
import { useSession } from '../lib/session.js'

const STATES = [
  'draft',
  'submitted',
  'confirmed',
  'picking',
  'packed',
  'dispatched',
  'delivered',
  'partially_delivered',
  'closed',
  'cancelled',
] as const
type State = (typeof STATES)[number]

const stateTone = (s: string) =>
  s === 'cancelled'
    ? 'bad'
    : s === 'submitted'
      ? 'warn'
      : ['confirmed', 'packed', 'dispatched', 'delivered', 'closed'].includes(s)
        ? 'ok'
        : ''

/** Orders & approvals: the owner's queue of what needs a decision, and every order with its lines and history. */
export function Orders() {
  const [tab, setTab] = useState<'approvals' | 'orders'>('approvals')
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div>
      <h1>Orders &amp; approvals</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className={tab === 'approvals' ? 'primary' : ''}
          onClick={() => setTab('approvals')}
        >
          Approvals queue
        </button>
        <button className={tab === 'orders' ? 'primary' : ''} onClick={() => setTab('orders')}>
          All orders
        </button>
      </div>
      {tab === 'approvals' ? (
        <ApprovalsQueue onOpen={setSelected} />
      ) : (
        <OrdersList onOpen={setSelected} />
      )}
      {selected && <OrderDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function useNames() {
  const retailers = useQuery({
    queryKey: ['retailers', 'list', ''],
    queryFn: () => api.retailers.list({ limit: 500 }),
  })
  const catalog = useQuery({
    queryKey: ['tenantCatalog', 'list', '', false],
    queryFn: () => api.tenantCatalog.list({ listedOnly: false, limit: 500 }),
  })
  return {
    shop: (id: string) => retailers.data?.items.find((r) => r.id === id)?.name ?? id.slice(0, 8),
    item: (id: string) => {
      const v = catalog.data?.items.find((x) => x.variantId === id)
      return v ? `${v.productName} · ${v.name}` : id.slice(0, 8)
    },
  }
}

function ApprovalsQueue({ onOpen }: { onOpen: (orderId: string) => void }) {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api.orders.approvals.list({ status: 'pending', limit: 100 }),
    refetchInterval: 15_000,
  })
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: 'approve' | 'reject' }) =>
      api.orders.approvals.decide({ idempotencyKey: newIdempotencyKey(), ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
  const describe = (a: Approval) => {
    const p = a.payload
    switch (a.kind) {
      case 'credit_limit':
        return (
          <>
            Outstanding <Money value={Number(p.outstandingPaise ?? 0)} /> + this order{' '}
            <Money value={Number(p.orderTotalPaise ?? 0)} /> exceeds limit{' '}
            <Money value={Number(p.creditLimitPaise ?? 0)} />
          </>
        )
      case 'bargain':
        return <>Rate asked below the auto-approve bound</>
      case 'below_floor':
        return <>A line is priced below the tier price without an approved override</>
      default:
        return <>{a.kind}</>
    }
  }
  return (
    <div>
      {decide.isError && <p className="error">{decide.error.message}</p>}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Kind</th>
            <th>Order</th>
            <th>Why</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.createdAt).toLocaleString('en-IN')}</td>
              <td>
                <span className="badge warn">{a.kind.replace('_', ' ')}</span>
              </td>
              <td>
                {a.orderId ? (
                  <a
                    href="#/orders"
                    onClick={(e) => {
                      e.preventDefault()
                      onOpen(a.orderId ?? '')
                    }}
                  >
                    {a.orderId.slice(0, 8)}…
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td>{describe(a)}</td>
              <td>
                <button
                  className="primary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: a.id, decision: 'approve' })}
                >
                  Approve
                </button>{' '}
                <button
                  className="danger"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: a.id, decision: 'reject' })}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.items.length === 0 && (
        <p className="muted">
          Nothing waiting. Orders inside credit limits and bargain bounds confirm on their own.
        </p>
      )}
    </div>
  )
}

function OrdersList({ onOpen }: { onOpen: (orderId: string) => void }) {
  const names = useNames()
  const [state, setState] = useState<State | ''>('')
  const [q, setQ] = useState('')
  const list = useQuery({
    queryKey: ['orders', 'list', state, q],
    queryFn: () => api.orders.list({ state: state || undefined, q: q || undefined, limit: 100 }),
  })
  return (
    <div>
      <div className="card row">
        <input
          type="search"
          className="grow"
          placeholder="Search order no. or shop"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={state} onChange={(e) => setState(e.target.value as State | '')}>
          <option value="">all states</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="muted">{list.data ? `${list.data.items.length} orders` : ''}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Date</th>
            <th>Shop</th>
            <th>Source</th>
            <th>State</th>
            <th className="num">Total</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((o: Order) => (
            <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(o.id)}>
              <td>{o.orderNo ?? <span className="muted">draft</span>}</td>
              <td>{new Date(o.createdAt).toLocaleDateString('en-IN')}</td>
              <td>{names.shop(o.retailerId)}</td>
              <td>{o.source}</td>
              <td>
                <span className={`badge ${stateTone(o.state)}`}>{o.state}</span>
              </td>
              <td className="num">
                <Money value={o.totalPaise} />
              </td>
              <td>
                {o.approvalFlags.map((f) => (
                  <span key={f} className="badge warn" style={{ marginRight: 4 }}>
                    {f}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { session } = useSession()
  const names = useNames()
  const order = useQuery({ queryKey: ['orders', 'get', id], queryFn: () => api.orders.get({ id }) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['orders'] })
    void qc.invalidateQueries({ queryKey: ['approvals'] })
  }
  const confirm = useMutation({
    mutationFn: () => api.orders.confirm({ idempotencyKey: newIdempotencyKey(), id }),
    onSuccess: refresh,
  })
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      api.orders.cancel({ idempotencyKey: newIdempotencyKey(), id, reason }),
    onSuccess: refresh,
  })
  const o: OrderDetail | undefined = order.data?.item
  const backOffice = !!session && ['owner', 'manager', 'accountant'].includes(session.role)
  return (
    <div
      className="card"
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        bottom: 16,
        width: 'min(720px, 90vw)',
        overflow: 'auto',
        boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        zIndex: 10,
      }}
    >
      <div className="row">
        <h2 style={{ margin: 0 }}>{o?.orderNo ?? 'Draft order'}</h2>
        {o && <span className={`badge ${stateTone(o.state)}`}>{o.state}</span>}
        <span className="grow" />
        <button onClick={onClose}>Close</button>
      </div>
      {order.isError && <p className="error">Could not load this order.</p>}
      {o && (
        <>
          <p className="muted">
            {names.shop(o.retailerId)} · {o.source} · {o.paymentTerms} · created{' '}
            {new Date(o.createdAt).toLocaleString('en-IN')}
            {o.note ? ` · “${o.note}”` : ''}
          </p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th className="num">Entered</th>
                <th className="num">Pieces</th>
                <th className="num">Free</th>
                <th className="num">Rate</th>
                <th className="num">Disc</th>
                <th className="num">GST</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.lineNo}</td>
                  <td>
                    {names.item(l.variantId)}
                    {l.appliedRules.length > 0 && (
                      <span className="muted">
                        {' '}
                        · {l.appliedRules.map((r) => r.kind).join(', ')}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {l.enteredQty} {l.enteredUnit}
                    {l.enteredUnit === 'case' ? ` (×${l.packSizeAtEntry})` : ''}
                  </td>
                  <td className="num">{formatQty(pieces(l.qtyPcs), l.packSizeAtEntry)}</td>
                  <td className="num">{l.freeQtyPcs || '—'}</td>
                  <td className="num">
                    <Money value={l.ratePaise} />
                  </td>
                  <td className="num">
                    {l.discountPaise ? <Money value={l.discountPaise} /> : '—'}
                  </td>
                  <td className="num">{(l.gstBps / 100).toFixed(0)}%</td>
                  <td className="num">
                    <Money value={l.lineTotalPaise} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8, gap: 24 }}>
            <span className="muted">
              Subtotal <Money value={o.subtotalPaise} />
            </span>
            <span className="muted">
              Discount <Money value={o.discountPaise} />
            </span>
            <span className="muted">
              GST <Money value={o.taxPaise} />
            </span>
            <span className="muted">
              Round off <Money value={o.roundOffPaise} />
            </span>
            <strong>
              Total <Money value={o.totalPaise} />
            </strong>
          </div>
          {o.approvals.length > 0 && (
            <>
              <h3>Approvals</h3>
              <ul className="steps">
                {o.approvals.map((a) => (
                  <li key={a.id}>
                    <b>{a.kind}</b> · {a.status}
                    {a.decisionNote ? ` · ${a.decisionNote}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>History</h3>
          <ul className="steps">
            {o.transitions.map((t) => (
              <li key={t.id}>
                <b>{t.toState}</b> · {t.event} · {new Date(t.occurredAt).toLocaleString('en-IN')}
                {t.reason ? ` · ${t.reason}` : ''}
              </li>
            ))}
          </ul>
          {backOffice && (
            <div className="row" style={{ marginTop: 12 }}>
              {o.state === 'submitted' && (
                <button
                  className="primary"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate()}
                >
                  Confirm &amp; reserve stock
                </button>
              )}
              {['draft', 'submitted', 'confirmed'].includes(o.state) && (
                <button
                  className="danger"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate('cancelled from console')}
                >
                  Cancel order
                </button>
              )}
              {(confirm.isError || cancel.isError) && (
                <span className="error">{(confirm.error ?? cancel.error)?.message}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
