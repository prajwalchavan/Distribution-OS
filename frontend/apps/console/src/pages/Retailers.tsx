import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { uuidv7 } from '@dos/domain'
import type { Retailer, RetailerView } from '@dos/contracts'
import { api, newIdempotencyKey } from '../lib/api.js'
import { Money, RupeeInput } from '../components/Money.js'
import { useSession } from '../lib/session.js'

const isStaffRow = (r: RetailerView): r is Retailer => 'code' in r

/** Retailers of this distributor: list, search by name/phone/code, credit terms (back-office), quick add. */
export function Retailers() {
  const { session } = useSession()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const list = useQuery({
    queryKey: ['retailers', 'list', q],
    queryFn: () => api.retailers.list({ q: q || undefined, limit: 200 }),
  })
  const beats = useQuery({ queryKey: ['beats'], queryFn: () => api.retailers.beats.list({}) })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['retailers'] })
  const backOffice = !!session && ['owner', 'manager', 'accountant'].includes(session.role)
  const beatName = (id: string | null) => beats.data?.items.find((b) => b.id === id)?.name ?? '—'

  return (
    <div>
      <h1>Retailers</h1>
      <div className="card row">
        <input
          type="search"
          className="grow"
          placeholder="Search name, phone, code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">{list.data ? `${list.data.items.length} shops` : ''}</span>
        <button className="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : 'Add retailer'}
        </button>
      </div>
      {adding && (
        <NewRetailer
          beats={beats.data?.items ?? []}
          onDone={() => {
            setAdding(false)
            invalidate()
          }}
        />
      )}
      {list.isError && <p className="error">Could not load retailers.</p>}
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Shop</th>
            <th>Phone</th>
            <th>Beat</th>
            <th>Terms</th>
            <th>Tier</th>
            <th className="num">Credit limit</th>
            <th className="num">Days</th>
            <th>Mode</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((r) => (
            <RetailerRow
              key={r.id}
              r={r}
              beat={beatName(r.beatId)}
              canEditCredit={backOffice}
              onSaved={invalidate}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RetailerRow({
  r,
  beat,
  canEditCredit,
  onSaved,
}: {
  r: RetailerView
  beat: string
  canEditCredit: boolean
  onSaved: () => void
}) {
  const staff = isStaffRow(r) ? r : null
  const [edit, setEdit] = useState(false)
  const [tier, setTier] = useState<Retailer['tier']>(staff?.tier ?? 'C')
  const [limit, setLimit] = useState<number | null>(staff?.creditLimitPaise ?? 0)
  const [days, setDays] = useState(staff?.creditDays ?? 0)
  const [mode, setMode] = useState<Retailer['creditMode']>(staff?.creditMode ?? 'indicate')
  const save = useMutation({
    mutationFn: () =>
      api.retailers.setCredit({
        idempotencyKey: newIdempotencyKey(),
        id: r.id,
        tier,
        creditLimitPaise: limit ?? 0,
        creditLimitBills: staff?.creditLimitBills ?? 0,
        creditDays: days,
        creditMode: mode,
      }),
    onSuccess: () => {
      setEdit(false)
      onSaved()
    },
  })
  return (
    <tr>
      <td>{staff?.code ?? <span className="muted">—</span>}</td>
      <td>
        {r.name}
        {r.ownerName && <span className="muted"> · {r.ownerName}</span>}
        {!r.active && (
          <span className="badge bad" style={{ marginLeft: 6 }}>
            inactive
          </span>
        )}
      </td>
      <td>{r.phone}</td>
      <td>{beat}</td>
      <td>
        {r.paymentTerms === 'POST_FULFILLMENT'
          ? 'credit'
          : r.paymentTerms === 'ON'
            ? 'on delivery'
            : 'prepaid'}
      </td>
      {staff ? (
        edit ? (
          <>
            <td>
              <select value={tier} onChange={(e) => setTier(e.target.value as Retailer['tier'])}>
                {(['A', 'B', 'C', 'D'] as const).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </td>
            <td className="num">
              <RupeeInput value={limit} onChange={setLimit} />
            </td>
            <td className="num">
              <input
                type="number"
                min={0}
                max={365}
                value={days}
                style={{ width: 64 }}
                onChange={(e) => setDays(Number(e.target.value) || 0)}
              />
            </td>
            <td>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as Retailer['creditMode'])}
              >
                <option value="indicate">indicate</option>
                <option value="strict">strict</option>
                <option value="stop">stop</option>
              </select>
            </td>
            <td>
              <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
                Save
              </button>{' '}
              <button onClick={() => setEdit(false)}>Cancel</button>
              {save.isError && <div className="error">{save.error.message}</div>}
            </td>
          </>
        ) : (
          <>
            <td>
              <span className="badge">{staff.tier}</span>
            </td>
            <td className="num">
              <Money value={staff.creditLimitPaise} />
            </td>
            <td className="num">{staff.creditDays}</td>
            <td>
              <span
                className={`badge ${staff.creditMode === 'stop' ? 'bad' : staff.creditMode === 'strict' ? 'warn' : ''}`}
              >
                {staff.creditMode}
              </span>
            </td>
            <td>{canEditCredit && <button onClick={() => setEdit(true)}>Credit…</button>}</td>
          </>
        )
      ) : (
        <>
          <td colSpan={5} className="muted">
            credit fields hidden for this role
          </td>
        </>
      )}
    </tr>
  )
}

function NewRetailer({
  beats,
  onDone,
}: {
  beats: { id: string; name: string }[]
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('+91')
  const [beatId, setBeatId] = useState<string>('')
  const [line1, setLine1] = useState('')
  const [pincode, setPincode] = useState('')
  const create = useMutation({
    mutationFn: () =>
      api.retailers.upsert({
        idempotencyKey: newIdempotencyKey(),
        id: uuidv7(),
        name,
        ownerName: ownerName || null,
        phone,
        beatId: beatId || null,
        address: line1 || pincode ? { line1, pincode } : null,
        stateCode: '27',
        gstRegType: 'unregistered',
        paymentTerms: 'POST_FULFILLMENT',
        cashDiscountBps: 0,
        cashDiscountDays: 0,
        active: true,
      }),
    onSuccess: onDone,
  })
  const valid = name.trim().length >= 2 && /^\+91[6-9]\d{9}$/.test(phone)
  return (
    <div className="card">
      <div className="row">
        <label className="field grow">
          Shop name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Owner
          <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
        </label>
        <label className="field">
          Phone
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\s/g, ''))}
            placeholder="+919876543210"
          />
        </label>
        <label className="field">
          Beat
          <select value={beatId} onChange={(e) => setBeatId(e.target.value)}>
            <option value="">—</option>
            {beats.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="field grow">
          Address
          <input type="text" value={line1} onChange={(e) => setLine1(e.target.value)} />
        </label>
        <label className="field">
          Pincode
          <input type="text" value={pincode} onChange={(e) => setPincode(e.target.value)} />
        </label>
        <button
          className="primary"
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
        >
          Create (code assigned by server)
        </button>
      </div>
      {create.isError && <p className="error">{create.error.message}</p>}
    </div>
  )
}
