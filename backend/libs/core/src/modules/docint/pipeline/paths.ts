import type { ReviewedInvoice, ReviewHeaderPatch, ReviewLinePatch } from '@dos/contracts'

/**
 * Review paths are ONE grammar shared by `fieldConfidence`, `corrections_log.path` and
 * `engine_disagreements.path` (docint.ts header): `header.<field>` and `lines[<index>].<field>`,
 * where `<index>` is the 0-based position of the line in `reviewed.lines` (lines are kept in
 * `lineNo` order, so index = lineNo − 1 on an untouched reading).
 */

export interface Correction {
  path: string
  before: unknown
  after: unknown
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export const headerPath = (field: string): string => `header.${field}`
export const linePath = (index: number, field: string): string => `lines[${String(index)}].${field}`

/**
 * Apply a `review.save` patch to the reviewed invoice and list every path whose value changed.
 * Header fields and line fields are merged key by key; a line patch names its line by `lineNo` and
 * a `lineNo` with no line is ignored (the desk cannot invent a printed line — that is `catalog.propose`
 * plus a re-read). Annotations are recorded applied/dismissed by id.
 */
export function applyReviewPatch(
  reviewed: ReviewedInvoice,
  patch: {
    header?: ReviewHeaderPatch | undefined
    lines?: ReviewLinePatch[] | undefined
    annotations?: { id: string; applied: boolean }[] | undefined
  },
): { next: ReviewedInvoice; corrections: Correction[] } {
  const corrections: Correction[] = []
  const header: Record<string, unknown> = { ...reviewed.header }
  for (const [field, value] of Object.entries(patch.header ?? {})) {
    if (value === undefined) continue
    if (same(header[field], value)) continue
    corrections.push({ path: headerPath(field), before: header[field] ?? null, after: value })
    header[field] = value
  }
  const lines: Record<string, unknown>[] = reviewed.lines.map((line) => ({ ...line }))
  for (const linePatch of patch.lines ?? []) {
    const index = lines.findIndex((l) => l.lineNo === linePatch.lineNo)
    if (index < 0) continue
    const target = lines[index]
    if (!target) continue
    for (const [field, value] of Object.entries(linePatch)) {
      if (field === 'lineNo' || value === undefined) continue
      if (same(target[field], value)) continue
      corrections.push({
        path: linePath(index, field),
        before: target[field] ?? null,
        after: value,
      })
      target[field] = value
    }
  }
  const annotations = reviewed.annotations.map((a) => ({ ...a }))
  for (const a of patch.annotations ?? []) {
    const existing = annotations.find((x) => x.id === a.id)
    if (existing) {
      if (existing.applied !== a.applied) {
        corrections.push({
          path: `header.annotation`,
          before: { id: a.id, applied: existing.applied },
          after: { id: a.id, applied: a.applied },
        })
        existing.applied = a.applied
      }
    } else {
      annotations.push({ id: a.id, applied: a.applied })
      corrections.push({
        path: `header.annotation`,
        before: null,
        after: { id: a.id, applied: a.applied },
      })
    }
  }
  return {
    next: {
      header: header as ReviewedInvoice['header'],
      lines: lines as unknown as ReviewedInvoice['lines'],
      annotations,
    },
    corrections,
  }
}

/** Every path where two readings differ (engine disagreements, docs/05 step 7). */
export function diffReadings(
  a: { header: Record<string, unknown>; lines: Record<string, unknown>[] },
  b: { header: Record<string, unknown>; lines: Record<string, unknown>[] },
): { path: string; a: unknown; b: unknown }[] {
  const out: { path: string; a: unknown; b: unknown }[] = []
  const headerKeys = new Set([...Object.keys(a.header), ...Object.keys(b.header)])
  for (const key of [...headerKeys].sort()) {
    if (!same(a.header[key], b.header[key]))
      out.push({ path: headerPath(key), a: a.header[key] ?? null, b: b.header[key] ?? null })
  }
  const count = Math.max(a.lines.length, b.lines.length)
  for (let i = 0; i < count; i++) {
    const la = a.lines[i] ?? {}
    const lb = b.lines[i] ?? {}
    const keys = new Set([...Object.keys(la), ...Object.keys(lb)])
    for (const key of [...keys].sort()) {
      if (key === 'evidence') continue
      if (!same(la[key], lb[key]))
        out.push({ path: linePath(i, key), a: la[key] ?? null, b: lb[key] ?? null })
    }
  }
  return out
}
