import { formatINR } from '@dos/ui'
import { paise } from '@dos/domain'

/** Renders integer paise as ₹ with Indian grouping. Null shows a dash. */
export function Money({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="muted">—</span>
  return <span>{formatINR(paise(value))}</span>
}

/** Input for rupees that stores paise; avoids floats by parsing the string. */
export function RupeeInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null
  onChange: (paise: number | null) => void
  placeholder?: string
}) {
  const text = value === null ? '' : (value / 100).toFixed(2)
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder ?? '₹'}
      defaultValue={text}
      key={text}
      onBlur={(e) => {
        const raw = e.currentTarget.value.trim().replace(/[₹,\s]/g, '')
        if (raw === '') return onChange(null)
        const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(raw)
        if (!m) return
        const rupees = Number(m[1])
        const p = Number(((m[2] ?? '') + '00').slice(0, 2))
        onChange(rupees * 100 + p)
      }}
      style={{ width: 110, textAlign: 'right' }}
    />
  )
}
