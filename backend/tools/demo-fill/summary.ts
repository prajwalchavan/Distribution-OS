/**
 * What a run did, in counts and ids only. A refusal from the API is an answer: it is counted with the API's
 * status and code, the run goes on, and the row it belonged to is marked. Nothing here ever holds a shop's
 * name, a phone number, a GSTIN or an address.
 */

/** The seven rows of the brief's second table, plus the run's own housekeeping. */
export const ROWS = [
  'shopkeeper',
  'sales',
  'manager',
  'godown',
  'driver',
  'accountant',
  'owner',
] as const
export type Row = (typeof ROWS)[number]
export type Section = Row | 'people' | 'masters' | 'yesterday'

/** Each row's features, as the brief names them. A row is "made" when every feature is there. */
export const ROW_FEATURES: Record<Row, readonly string[]> = {
  shopkeeper: ['login', 'on-the-way', 'delivered-bill', 'dues', 'offer', 'order-again'],
  sales: ['beat-today', 'two-orders', 'over-limit-shop'],
  manager: [
    'approvals-waiting',
    'held-for-credit',
    'load-sheet-to-sign',
    'supplier-bill-review',
    'return-to-approve',
  ],
  godown: ['gate-to-count', 'wave-to-pick', 'packs-to-make', 'van-to-load'],
  driver: ['trip-today', 'doors-paid', 'door-part', 'door-refused', 'doors-to-do'],
  accountant: ['collections-to-match', 'cheques-to-deposit', 'yesterday-settled', 'dues-by-age'],
  owner: ['sales-today', 'collections-today', 'dues', 'stock-value', 'approvals-waiting'],
}

/** Features no role can produce through the API, with the finding that records why. */
export const KNOWN_GAPS: Record<string, string> = {
  'shopkeeper:login': 'DOS-400',
}

export type FeatureState = 'there' | 'missing' | 'would' | 'gap'
const FEATURE_RANK: Record<FeatureState, number> = { there: 0, would: 1, gap: 2, missing: 3 }
export type RowState = 'made' | 'partly' | 'not made' | 'would be made' | 'would be partly'

export class Summary {
  /** A dry run: the table says what WOULD be made, never "made". */
  dryRun = false
  readonly made = new Map<string, number>()
  readonly found = new Map<string, number>()
  readonly would = new Map<string, number>()
  readonly refused = new Map<string, number>()
  readonly notes: string[] = []
  readonly features = new Map<string, FeatureState>()

  private bump(map: Map<string, number>, key: string, by = 1): void {
    map.set(key, (map.get(key) ?? 0) + by)
  }

  madeOne(section: Section, what: string): void {
    this.bump(this.made, `${section}:${what}`)
  }
  foundOne(section: Section, what: string): void {
    this.bump(this.found, `${section}:${what}`)
  }
  wouldOne(section: Section, what: string): void {
    this.bump(this.would, `${section}:${what}`)
  }
  refusedOne(section: Section, what: string, label: string): void {
    this.bump(this.refused, `${section}:${what} → ${label}`)
  }
  note(line: string): void {
    this.notes.push(line)
  }

  /**
   * Record a feature of a row. A feature read more than once (one per rep, one per driver) keeps the worst
   * answer: one van without a refused door is a van without one.
   */
  feature(row: Row, name: string, state: FeatureState): void {
    const key = `${row}:${name}`
    const was = this.features.get(key)
    if (was === undefined || FEATURE_RANK[state] > FEATURE_RANK[was]) this.features.set(key, state)
  }

  rowState(row: Row): { state: RowState; missing: string[] } {
    const names = ROW_FEATURES[row]
    const missing = names.filter((n) => {
      const s = this.features.get(`${row}:${n}`)
      return s !== 'there' && s !== 'would'
    })
    const produced = names.length - missing.length
    if (produced === 0) return { state: 'not made', missing }
    if (this.dryRun)
      return { state: missing.length === 0 ? 'would be made' : 'would be partly', missing }
    return { state: missing.length === 0 ? 'made' : 'partly', missing }
  }

  /** Exit 1 only when a whole row could not be produced. */
  exitCode(): number {
    return ROWS.some((r) => this.rowState(r).state === 'not made') ? 1 : 0
  }

  totals(): { made: number; found: number; would: number; refused: number } {
    const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0)
    return {
      made: sum(this.made),
      found: sum(this.found),
      would: sum(this.would),
      refused: sum(this.refused),
    }
  }

  lines(): string[] {
    const out: string[] = []
    const t = this.totals()
    out.push(
      `rows written: ${String(t.made)}  already there: ${String(t.found)}  would write: ${String(t.would)}  refused: ${String(t.refused)}`,
    )
    const section = (title: string, m: Map<string, number>): void => {
      if (m.size === 0) return
      out.push(title)
      for (const [k, v] of [...m.entries()].sort()) out.push(`  ${k.padEnd(56)} ${String(v)}`)
    }
    section('made', this.made)
    section('already there', this.found)
    section('would make (dry run)', this.would)
    section('refused by the API (status code)', this.refused)
    out.push("the brief's table")
    for (const r of ROWS) {
      const { state, missing } = this.rowState(r)
      const gaps = missing.map((n) =>
        KNOWN_GAPS[`${r}:${n}`] ? `${n} (${KNOWN_GAPS[`${r}:${n}`] ?? ''})` : n,
      )
      out.push(
        `  ${r.padEnd(11)} ${state.padEnd(16)}${gaps.length ? ` missing: ${gaps.join(', ')}` : ''}`,
      )
    }
    for (const n of this.notes) out.push(`note: ${n}`)
    return out
  }

  toJSON(): Record<string, unknown> {
    return {
      totals: this.totals(),
      made: Object.fromEntries(this.made),
      found: Object.fromEntries(this.found),
      would: Object.fromEntries(this.would),
      refused: Object.fromEntries(this.refused),
      rows: Object.fromEntries(ROWS.map((r) => [r, this.rowState(r)])),
      notes: this.notes,
    }
  }
}
