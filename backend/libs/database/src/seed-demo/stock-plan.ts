/**
 * The PLAN of the godown, computed before a single row is written and shared by the stock, sales and
 * warehouse seeds: which batches exist, when each arrived, what came in on which supplier bill, and
 * which batch every sold line left from.
 *
 * Why a plan and not a seed: stock has to be received before it is sold and the sales generator has
 * to know the batch a line is picked from, so the two cannot be written one after the other. The
 * order of business is
 *
 *   1. the sales seed builds its order book in memory (no batches yet) → demand per SKU per day;
 *   2. `planStock()` turns that demand into supplier bills on each house's cadence (Godavari's dairy
 *      van every third day, Reliance weekly, the small houses fortnightly) and the opening batches
 *      each SKU's profile asks for (a float, three batches for FEFO, near-expiry and expired dairy
 *      found on this morning's count, a dozen SKUs under a case, eight sold out);
 *   3. `allocateStock()` replays every sold line in date order against those batches, FEFO among the
 *      batches that were on the rack AND in date that day, and grows the batch that ran short — the
 *      most recent one received before the sale — until nothing is short and every SKU ends today at
 *      the stock its profile describes. Deterministic: same inputs, same batches, same picks.
 *
 * Everything here is pure. `stock.ts` writes the plan; `sales.ts` and `warehouse.ts` read the picks.
 */
import type { VariantRow } from './catalog.js'
import { demoId } from './ids.js'
import { atIstTime, daysAgo, isoDate, isWorkingDay, makeRng, pickWeighted, TODAY } from './util.js'

export type LotProfile = 'float' | 'fast' | 'normal' | 'near_expiry' | 'expired' | 'low' | 'zero'

const FLOAT_KEY = 'campa-cola-750ml'
const FAST_KEYS = new Set([
  'campa-orange-750ml',
  'campa-lemon-750ml',
  'too-yumm-karare-60g',
  'balaji-simply-salted-45g',
  'balaji-masala-masti-45g',
  'campa-cola-1000ml',
  'sunbake-glucose-55g',
  'sunbake-glucose-110g',
  'sunbake-marie-light-150g',
  'annapurna-chakki-fresh-atta-5kg',
  'annapurna-toor-dal-1kg',
  'annapurna-sunflower-refined-oil-1l',
  'godavari-toned-uht-milk-1l',
  'godavari-cow-ghee-500ml',
  'neelam-sandal-soap-100g',
  'chamak-detergent-powder-1kg',
  'konkan-aloo-bhujia-200g',
  'rajwadi-jeera-masala-soda-500ml',
])
/** The dairy that turns fast is what makes expiry land naturally; two withdrawn SKUs sit with it. */
const EXPIRED_KEYS = new Set([
  'godavari-fresh-paneer-200g',
  'godavari-dahi-200g',
  'godavari-masala-chaas-200ml',
  'rajwadi-apple-nectar-200ml',
  'sunbake-orange-cream-60g',
  'campa-lemon-1000ml',
  'annapurna-besan-500g',
])
const NEAR_EXPIRY_KEYS = new Set([
  'godavari-fresh-paneer-500g',
  'godavari-dahi-400g',
  'godavari-dahi-1kg',
  'godavari-masala-chaas-1l',
  'godavari-flavoured-milk-rose-180ml',
  'godavari-flavoured-milk-kesar-badam-180ml',
  'godavari-flavoured-milk-chocolate-180ml',
  'godavari-toned-uht-milk-500ml',
  'konkan-kerala-banana-chips-40g',
  'konkan-roasted-peanut-masala-40g',
  'campa-lemon-200ml',
  'campa-orange-200ml',
  'annapurna-thick-poha-500g',
  'annapurna-bombay-rava-500g',
])
const LOW_KEYS = new Set([
  'neelam-cold-cream-50g',
  'neelam-prickly-heat-talc-300g',
  'chamak-white-phenyl-5l',
  'chamak-floor-cleaner-2l',
  'annapurna-kolam-rice-25kg',
  'annapurna-basmati-classic-5kg',
  'sunbake-kaju-pista-cookies-200g',
  'sunbake-digestive-hi-fibre-250g',
  'rajwadi-josh-energy-drink-250ml',
  'konkan-masala-khakhra-360g',
  'godavari-cheese-slices-200g',
  'neelam-handwash-750ml',
])
const ZERO_KEYS = new Set([
  'chamak-glass-cleaner-500ml',
  'sunbake-choco-chip-cookies-120g',
  'annapurna-garam-masala-50g',
  'neelam-tooth-brush-2plus1',
  'rajwadi-soda-water-750ml',
  'konkan-farsan-mix-400g',
  'godavari-dairy-whitener-500g',
  'chamak-dishwash-gel-750ml',
])

/** Six lots get a carton moved to the damaged bin (the first three are the original demo's). */
export const DAMAGED_VARIANT_KEYS = [
  'campa-lemon-500ml',
  'too-yumm-veggie-stix-70g',
  'balaji-chataka-pataka-45g',
  'sunbake-bourbon-cream-120g',
  'godavari-table-butter-100g',
  'chamak-detergent-bar-250g',
]

/** The damaged-stock screen needs a handful of cartons in the bin on every shelf (spec §5 I-29). */
const MIN_DAMAGED = 5

/**
 * The named cartons above where the shelf carries them, made up to `MIN_DAMAGED` from the shelf's
 * ordinary SKUs by key order — never a sold-out or short one, whose story is a different screen.
 */
function damagedVariantKeysFor(
  variants: readonly VariantRow[],
  profileOf: (v: VariantRow) => LotProfile,
): string[] {
  const keys = new Set(variants.map((v) => v.key))
  const out = DAMAGED_VARIANT_KEYS.filter((k) => keys.has(k))
  if (out.length >= MIN_DAMAGED) return out
  const extra = [...variants]
    .filter(
      (v) =>
        !out.includes(v.key) &&
        v.status === 'active' &&
        (profileOf(v) === 'normal' || profileOf(v) === 'fast') &&
        v.defaultCaseSize >= 6,
    )
    .sort((a, b) => (a.key < b.key ? -1 : 1))
  for (const v of extra) {
    if (out.length >= MIN_DAMAGED) break
    out.push(v.key)
  }
  return out
}

/** Pieces of the OLDEST batch a later seed takes for its own story; the sales replay never sells them. */
const HELD_PCS_ON_OLDEST_LOT: Readonly<Record<string, number>> = {
  // claims.ts writes the expiry claim off these two (12 pcs each, `EXPIRY_QTY_PCS`)
  'mom-makhana-himalayan-salt-12g': 12,
  'mom-makhana-peri-peri-60g': 12,
}

export function lotProfileOf(v: VariantRow): LotProfile {
  if (v.key === FLOAT_KEY) return 'float'
  if (FAST_KEYS.has(v.key)) return 'fast'
  if (EXPIRED_KEYS.has(v.key)) return 'expired'
  if (NEAR_EXPIRY_KEYS.has(v.key)) return 'near_expiry'
  if (LOW_KEYS.has(v.key)) return 'low'
  if (ZERO_KEYS.has(v.key)) return 'zero'
  return 'normal'
}

/** The stock states every distributor's screens need, whatever its shelf (spec §5 I-28, I-29). */
const MIN_ZERO_STOCK = 6
const MIN_LOW_STOCK = 10
const MIN_EXPIRED = 3
const MIN_NEAR_EXPIRY = 8

/**
 * The profile of every SKU on THIS distributor's shelf. The named lists above cover the pilot; a
 * smaller shelf that carries few of those names still has to show six sold-out SKUs and ten under
 * a case, so the shortfall is made up from its ordinary SKUs — chosen by key order, never by
 * position in the overlay, so a brand added later does not move anyone's profile. The SKUs a later
 * seed reads by name (the fixed supplier bills, the damaged cartons, the claims) are never picked.
 */
export function lotProfilesFor(variants: readonly VariantRow[]): Map<string, LotProfile> {
  const out = new Map<string, LotProfile>()
  for (const v of variants) {
    const p = lotProfileOf(v)
    // "under a case" cannot be said of a SKU whose case is one piece (the 25 kg bag)
    out.set(v.id, p === 'low' && v.defaultCaseSize <= 1 ? 'normal' : p)
  }
  const count = (p: LotProfile): number => [...out.values()].filter((x) => x === p).length
  const short: Record<'zero' | 'low' | 'expired' | 'near_expiry', number> = {
    zero: MIN_ZERO_STOCK - count('zero'),
    low: MIN_LOW_STOCK - count('low'),
    expired: MIN_EXPIRED - count('expired'),
    near_expiry: MIN_NEAR_EXPIRY - count('near_expiry'),
  }
  const wanted = (['zero', 'low', 'expired', 'near_expiry'] as const).filter((k) => short[k] > 0)
  if (wanted.length === 0) return out
  const pinned = new Set<string>([
    ...FIXED_INVOICES.flatMap((f) => f.variantKeys),
    ...DAMAGED_VARIANT_KEYS,
    ...Object.keys(HELD_PCS_ON_OLDEST_LOT),
    'campa-cola-750ml',
    'campa-orange-750ml',
  ])
  const candidates = variants
    .filter(
      (v) =>
        out.get(v.id) === 'normal' &&
        !pinned.has(v.key) &&
        v.status === 'active' &&
        !v.productKey.includes('ghee') &&
        !v.productKey.includes('soap') &&
        !v.productKey.includes('glucose'),
    )
    .sort((a, b) => (a.key < b.key ? -1 : 1))
  // every third candidate, so the picks spread over the brands rather than exhausting one
  const stride = 3
  for (let offset = 0; offset < stride; offset++) {
    for (let i = offset; i < candidates.length; i += stride) {
      const v = candidates[i]
      if (!v || out.get(v.id) !== 'normal') continue
      const next = wanted.find((k) => short[k] > 0 && (k !== 'low' || v.defaultCaseSize > 1))
      if (!next) return out
      out.set(v.id, next)
      short[next] -= 1
    }
  }
  return out
}

export interface LotRef {
  id: string
  variantId: string
  variantKey: string
  batchNo: string
  caseSize: number
  mfgDate: Date
  expiryDate: Date
  /** When the batch was on the rack: the books' opening, its GRN, or this morning's count. */
  availableFrom: Date
  kind: 'opening' | 'grn' | 'count'
}

/** One batch of the plan: the reference plus the quantity the replay settles on. */
export interface PlannedLot extends LotRef {
  /** Opening pieces (opening/count lots) or the counted GRN pieces (grn lots). Grown by the replay. */
  qtyPcs: number
  /** Pieces the replay never allocates (kept for a later seed's story). */
  holdPcs: number
  /** For a `grn` lot: the bill line it came in on. */
  grn: { invoiceKey: string; variantKey: string } | null
  /** For a `count` lot: why it appeared today. */
  countNote: string | null
  /** A GRN line refused at the gate: the batch exists on paper, nothing of it was ever on the rack. */
  refused: boolean
}

/** The bill line the gate refused outright (stock.ts files the discrepancy; the replay never sells it). */
const REFUSED_GRN_LINES = new Set(['godavari-1:godavari-fresh-paneer-200g'])

export interface SupplierInvoicePlan {
  invoiceKey: string
  supplierKey: SupplierKey
  supplierStateCode: string
  invoiceDate: Date
  paymentTermsDays: number
  /** Ordered as the bill prints them. */
  lines: { variantKey: string; lot: PlannedLot; cases: number }[]
}

export type SupplierKey =
  | 'reliance'
  | 'guruKripa'
  | 'momMakhana'
  | 'guiltfree'
  | 'alansFoods'
  | 'rajwadiDepot'
  | 'sunriseStockist'
  | 'konkanAgency'
  | 'annapurnaMill'
  | 'godavariDairy'
  | 'shubhdaDist'

interface SupplierDef {
  key: SupplierKey
  stateCode: string
  brands: string[]
  /** Days between bills. */
  cadenceDays: number
  paymentTermsDays: number
  /** Printed batch prefix on this house's bills. */
  batchPrefix: string
  /** Days between manufacture and the bill (a chilling centre ships in two days, a biscuit plant in ten). */
  mfgLeadDays: number
}

const SUPPLIERS: SupplierDef[] = [
  {
    key: 'reliance',
    stateCode: '27',
    brands: ['campa', 'independence'],
    cadenceDays: 7,
    paymentTermsDays: 30,
    batchPrefix: 'RCP',
    mfgLeadDays: 12,
  },
  {
    key: 'guruKripa',
    stateCode: '27',
    brands: ['balaji'],
    cadenceDays: 7,
    paymentTermsDays: 21,
    batchPrefix: 'GK',
    mfgLeadDays: 8,
  },
  {
    key: 'momMakhana',
    stateCode: '08',
    brands: ['mommakhana'],
    cadenceDays: 21,
    paymentTermsDays: 30,
    batchPrefix: 'MOM',
    mfgLeadDays: 15,
  },
  {
    key: 'guiltfree',
    stateCode: '06',
    brands: ['tooyumm'],
    cadenceDays: 10,
    paymentTermsDays: 30,
    batchPrefix: 'TY',
    mfgLeadDays: 10,
  },
  {
    key: 'alansFoods',
    stateCode: '27',
    brands: ['mastioye'],
    cadenceDays: 14,
    paymentTermsDays: 15,
    batchPrefix: 'AF',
    mfgLeadDays: 6,
  },
  {
    key: 'rajwadiDepot',
    stateCode: '27',
    brands: ['rajwadi'],
    cadenceDays: 10,
    paymentTermsDays: 21,
    batchPrefix: 'RJ',
    mfgLeadDays: 9,
  },
  {
    key: 'sunriseStockist',
    stateCode: '27',
    brands: ['sunbake'],
    cadenceDays: 7,
    paymentTermsDays: 21,
    batchPrefix: 'SB',
    mfgLeadDays: 10,
  },
  {
    key: 'konkanAgency',
    stateCode: '27',
    brands: ['konkancrunch'],
    cadenceDays: 14,
    paymentTermsDays: 15,
    batchPrefix: 'KC',
    mfgLeadDays: 5,
  },
  {
    key: 'annapurnaMill',
    stateCode: '27',
    brands: ['annapurna'],
    cadenceDays: 7,
    paymentTermsDays: 15,
    batchPrefix: 'AN',
    mfgLeadDays: 4,
  },
  {
    key: 'godavariDairy',
    stateCode: '27',
    brands: ['godavari'],
    cadenceDays: 3,
    paymentTermsDays: 7,
    batchPrefix: 'GD',
    mfgLeadDays: 2,
  },
  {
    key: 'shubhdaDist',
    stateCode: '24',
    brands: ['neelam', 'chamak'],
    cadenceDays: 14,
    paymentTermsDays: 30,
    batchPrefix: 'SC',
    mfgLeadDays: 20,
  },
]

/**
 * The bills the docint, claims and integrations seeds read back by key (`demoId('supplier-invoice',
 * key)`): kept at their ages, with their lines, and the gate events hung on them. Every other bill of
 * the register is generated on the house's cadence.
 */
interface FixedInvoice {
  supplierKey: SupplierKey
  invoiceKey: string
  ageDays: number
  variantKeys: string[]
}
const FIXED_INVOICES: FixedInvoice[] = [
  {
    supplierKey: 'reliance',
    invoiceKey: 'reliance-1',
    ageDays: 9,
    variantKeys: ['campa-cola-750ml', 'campa-orange-750ml', 'independence-water-1l'],
  },
  {
    supplierKey: 'guruKripa',
    invoiceKey: 'guru-kripa-1',
    ageDays: 7,
    variantKeys: [
      'balaji-simply-salted-45g',
      'balaji-masala-masti-45g',
      'balaji-chataka-pataka-45g',
      'balaji-ratlami-sev-200g',
    ],
  },
  {
    supplierKey: 'momMakhana',
    invoiceKey: 'mom-makhana-1',
    ageDays: 11,
    variantKeys: ['mom-makhana-himalayan-salt-12g', 'mom-makhana-peri-peri-60g'],
  },
  {
    supplierKey: 'guiltfree',
    invoiceKey: 'guiltfree-1',
    ageDays: 6,
    variantKeys: [
      'too-yumm-karare-60g',
      'too-yumm-multigrain-chips-60g',
      'too-yumm-veggie-stix-70g',
      'too-yumm-makhana-20g',
    ],
  },
  {
    supplierKey: 'alansFoods',
    invoiceKey: 'alans-foods-1',
    ageDays: 10,
    variantKeys: [
      'masti-oye-classic-salted-30g',
      'masti-oye-tomato-twist-30g',
      'masti-oye-peri-peri-twist-30g',
    ],
  },
  {
    supplierKey: 'annapurnaMill',
    invoiceKey: 'annapurna-1',
    ageDays: 3,
    variantKeys: [
      'annapurna-chakki-fresh-atta-5kg',
      'annapurna-chakki-fresh-atta-10kg',
      'annapurna-toor-dal-1kg',
      'annapurna-sunflower-refined-oil-1l',
      'annapurna-sulphurless-sugar-1kg',
    ],
  },
  {
    supplierKey: 'godavariDairy',
    invoiceKey: 'godavari-1',
    ageDays: 2,
    variantKeys: [
      'godavari-toned-uht-milk-1l',
      'godavari-full-cream-uht-milk-1l',
      'godavari-cow-ghee-500ml',
      'godavari-fresh-paneer-200g',
      'godavari-table-butter-500g',
    ],
  },
]

/** A sold line the replay has to source: what left the rack, when. */
export interface DemandLine {
  key: string
  variantId: string
  day: Date
  /** Pieces that physically left (picked + free). */
  pcs: number
  /** Chosen by the replay. */
  lotId: string | null
  /** What FEFO would have suggested that day (the pick sheet records both). */
  suggestedLotId: string | null
  /** Set when the line is deliberately picked off the second in-date batch. */
  fefoOverride: boolean
}

/** A movement that is not a sale: the damaged carton, the stock take, the van load, an expiry sweep. */
export interface StockEvent {
  key: string
  kind: 'damage' | 'soldout' | 'van_load' | 'expiry_sweep'
  variantId: string
  lotId: string
  day: Date
  at: Date
  qtyPcs: number
  note: string
}

export interface StockPlan {
  lots: PlannedLot[]
  lotsByVariantId: Map<string, PlannedLot[]>
  profileByVariantId: Map<string, LotProfile>
  invoices: SupplierInvoicePlan[]
  events: StockEvent[]
  /** Every sold line with its batch, after the replay. */
  demand: DemandLine[]
}

export interface PlanStockInput {
  variants: VariantRow[]
  /** The sold lines, before batches are known (`lotId` null). */
  demand: DemandLine[]
  historyDays: number
  /** Lines the replay picks off the second in-date batch on purpose (FEFO overrides), by line key. */
  overrideLineKeys: ReadonlySet<string>
  /** SKUs the tempo carries as counter stock on today's trip: one case each. */
  vanLoadVariantKeys: readonly string[]
  /**
   * Pieces of a variant's OLDEST batch a later seed takes for its own story (billing.ts: the van
   * sale's 18 pieces, the cancelled bill's three cases), by variant key. The replay never sells
   * them, so the batch holds them the whole way through — including the afternoon the cancelled
   * bill's pieces went out and came back.
   */
  holdOnOldestLot: Readonly<Record<string, number>>
  /** The profile of every SKU on this shelf (`lotProfilesFor`). */
  profiles: ReadonlyMap<string, LotProfile>
}

const OPENING_AGE_DAYS = 95
const SOLDOUT_AGE_DAYS = 6
const DAMAGE_AGE_DAYS = 4

const workingDayOnOrBefore = (d: Date): Date => {
  let out = d
  while (!isWorkingDay(out)) out = new Date(out.getTime() - 86_400_000)
  return out
}

/** Builds every batch and every supplier bill, then replays the sold lines against them. */
export function planStock(input: PlanStockInput): StockPlan {
  const { variants, historyDays } = input
  const variantByKey = new Map(variants.map((v) => [v.key, v]))
  const profileOf = (v: VariantRow): LotProfile => input.profiles.get(v.id) ?? lotProfileOf(v)
  const profileRng = makeRng('dos-demo:stock:profiles')
  const lots: PlannedLot[] = []
  const lotsByVariantId = new Map<string, PlannedLot[]>()
  const profileByVariantId = new Map<string, LotProfile>()
  /** The godown stock each SKU should show today (godown, the flow lots only), in pieces. */
  const residualTarget = new Map<string, { pcs: number; checkpointAge: number }>()

  const addLot = (lot: PlannedLot): PlannedLot => {
    lots.push(lot)
    const arr = lotsByVariantId.get(lot.variantId) ?? []
    arr.push(lot)
    lotsByVariantId.set(lot.variantId, arr)
    return lot
  }
  const dropLot = (lot: PlannedLot): void => {
    const at = lots.indexOf(lot)
    if (at >= 0) lots.splice(at, 1)
    const arr = lotsByVariantId.get(lot.variantId) ?? []
    const i = arr.indexOf(lot)
    if (i >= 0) arr.splice(i, 1)
  }

  // --- 1. the opening batches, by profile ------------------------------------------------------------
  variants.forEach((v, vi) => {
    const profile = profileOf(v)
    profileByVariantId.set(v.id, profile)
    const cs = v.defaultCaseSize
    const sl = v.shelfLifeDays
    const freshAgo = Math.max(1, Math.min(10, Math.floor(sl / 4)))
    // one positional draw per variant keeps the stream honest even where the profile is fixed
    const spread = pickWeighted(profileRng, [
      [1, 0],
      [1, 1],
      [1, 2],
    ] as const)
    interface Batch {
      suffix: string
      mfgDaysAgo: number
      expiryDaysFromToday?: number
      pcs: number
      count?: string
    }
    let batches: Batch[]
    let target: number
    let checkpointAge = 0
    switch (profile) {
      case 'float':
        batches = [
          { suffix: 'b1', mfgDaysAgo: 120, pcs: 100 * cs },
          { suffix: 'b2', mfgDaysAgo: 60, pcs: 150 * cs },
          { suffix: 'b3', mfgDaysAgo: 15, pcs: 150 * cs },
        ]
        target = 400 * cs
        break
      case 'fast':
        batches = [
          { suffix: 'b1', mfgDaysAgo: 90, pcs: 3 * cs },
          { suffix: 'b2', mfgDaysAgo: 20, pcs: 6 * cs },
          { suffix: 'b3', mfgDaysAgo: 3, pcs: 10 * cs },
        ]
        target = 19 * cs
        break
      case 'near_expiry': {
        const window = Math.max(1, Math.min(21, sl - 8))
        const k = 8 + ((vi * 5 + spread) % window)
        batches = [
          {
            suffix: 'b1',
            mfgDaysAgo: sl - k,
            expiryDaysFromToday: k,
            pcs: 2 * cs,
            count: `Found at the back of rack 4 on this morning's count; expires in ${k} days.`,
          },
          { suffix: 'b2', mfgDaysAgo: freshAgo, pcs: 4 * cs },
        ]
        target = 4 * cs
        break
      }
      case 'expired': {
        const e = 4 + ((vi * 3 + spread) % 17)
        batches = [
          {
            suffix: 'b1',
            mfgDaysAgo: sl + e,
            expiryDaysFromToday: -e,
            pcs: 1 * cs,
            count: `Past expiry by ${e} days on this morning's count; held for the expiry claim.`,
          },
          { suffix: 'b2', mfgDaysAgo: freshAgo, pcs: 4 * cs },
        ]
        target = 4 * cs
        break
      }
      case 'low': {
        // no bills for a slow SKU: the one batch has been on the rack since the books opened
        const pcs = Math.max(1, Math.min(cs - 1, Math.floor(cs / 4) + spread))
        batches = [{ suffix: 'b1', mfgDaysAgo: Math.min(100, sl - 30), pcs }]
        target = pcs
        break
      }
      case 'zero':
        batches = [{ suffix: 'b1', mfgDaysAgo: Math.min(100, sl - 30), pcs: 2 * cs }]
        target = 2 * cs
        checkpointAge = SOLDOUT_AGE_DAYS
        break
      default:
        batches = [
          { suffix: 'b1', mfgDaysAgo: Math.min(45, sl - 1), pcs: 5 * cs },
          { suffix: 'b2', mfgDaysAgo: Math.min(10, Math.max(1, sl - 2)), pcs: 5 * cs },
        ]
        target = 10 * cs
    }
    residualTarget.set(v.id, { pcs: target, checkpointAge })
    // oldest first: `lotsByVariantId.get(id)[0]` is the oldest batch, as every reader expects
    batches.sort((a, b) => b.mfgDaysAgo - a.mfgDaysAgo)
    for (const b of batches) {
      const mfg = daysAgo(b.mfgDaysAgo)
      const expiry =
        b.expiryDaysFromToday === undefined
          ? new Date(mfg.getTime() + sl * 86_400_000)
          : new Date(TODAY.getTime() + b.expiryDaysFromToday * 86_400_000)
      const booksOpen = daysAgo(OPENING_AGE_DAYS)
      const isCount = b.count !== undefined
      addLot({
        id: demoId('stock-lot', `${v.key}:${b.suffix}`),
        variantId: v.id,
        variantKey: v.key,
        batchNo: `B${isoDate(mfg).replace(/-/g, '')}`,
        caseSize: cs,
        mfgDate: mfg,
        expiryDate: expiry,
        availableFrom: isCount ? TODAY : mfg.getTime() > booksOpen.getTime() ? mfg : booksOpen,
        kind: isCount ? 'count' : 'opening',
        qtyPcs: b.pcs,
        holdPcs: 0,
        grn: null,
        countNote: b.count ?? null,
        refused: false,
      })
    }
  })

  // --- 2. demand per SKU per day, for sizing the bills --------------------------------------------
  const demandByVariantAge = new Map<string, Map<number, number>>()
  for (const d of input.demand) {
    const age = Math.round((TODAY.getTime() - d.day.getTime()) / 86_400_000)
    const byAge = demandByVariantAge.get(d.variantId) ?? new Map<number, number>()
    byAge.set(age, (byAge.get(age) ?? 0) + d.pcs)
    demandByVariantAge.set(d.variantId, byAge)
  }
  const demandInWindow = (variantId: string, fromAge: number, toAge: number): number => {
    const byAge = demandByVariantAge.get(variantId)
    if (!byAge) return 0
    let sum = 0
    for (const [age, pcs] of byAge) if (age <= fromAge && age >= toAge) sum += pcs
    return sum
  }
  const totalDemand = (variantId: string): number =>
    [...(demandByVariantAge.get(variantId)?.values() ?? [])].reduce((s, n) => s + n, 0)

  // --- 3. the purchase register: fixed bills where a later seed reads them, the rest on cadence --------
  const invoices: SupplierInvoicePlan[] = []
  const grnLot = (
    supplier: SupplierDef,
    v: VariantRow,
    invoiceKey: string,
    invoiceDate: Date,
  ): PlannedLot => {
    const lead = Math.min(supplier.mfgLeadDays, Math.max(1, Math.floor(v.shelfLifeDays / 5)))
    const mfg = new Date(invoiceDate.getTime() - lead * 86_400_000)
    return addLot({
      id: demoId('stock-lot', `grn:${invoiceKey}:${v.key}`),
      variantId: v.id,
      variantKey: v.key,
      batchNo: `${supplier.batchPrefix}${isoDate(mfg).replace(/-/g, '')}`,
      caseSize: v.defaultCaseSize,
      mfgDate: mfg,
      expiryDate: new Date(mfg.getTime() + v.shelfLifeDays * 86_400_000),
      availableFrom: invoiceDate,
      kind: 'grn',
      qtyPcs: 0,
      holdPcs: 0,
      grn: { invoiceKey, variantKey: v.key },
      countNote: null,
      refused: REFUSED_GRN_LINES.has(`${invoiceKey}:${v.key}`),
    })
  }
  /**
   * BUYING FOR THE WINDOW AHEAD, the way a buyer with a stock card does it: on each bill day the
   * card is brought up to date — the pieces sold since the last bill are struck off the oldest
   * in-date batch first, a batch that turned is struck off in full — and the bill is sized to cover
   * the coming cadence window (plus a small margin) beyond what is still on the rack and will still
   * be in date at the end of it. Only what turned with pieces LEFT is lost, never a whole batch:
   * sizing every bill off the cumulative history re-bought each short-dated dairy batch in full and
   * an eighth of the godown ended in the expiry bin. Whatever the replay still finds short (the
   * margin was too thin, a batch turned mid-window) it grows on the batch that was drawn on.
   */
  interface CardLot {
    qtyPcs: number
    expiryDate: Date
    /** An opening batch made after the books opened is not on the rack until it is made. */
    availableFrom: Date
  }
  const cards = new Map<string, { lots: CardLot[]; struckThroughAge: number }>()
  const cardOf = (v: VariantRow): { lots: CardLot[]; struckThroughAge: number } => {
    let card = cards.get(v.id)
    if (!card) {
      card = {
        lots: (lotsByVariantId.get(v.id) ?? [])
          .filter((l) => l.kind === 'opening')
          .map((l) => ({
            qtyPcs: l.qtyPcs,
            expiryDate: l.expiryDate,
            availableFrom: l.availableFrom,
          })),
        struckThroughAge: historyDays + 6,
      }
      cards.set(v.id, card)
    }
    return card
  }
  /** Strike the pieces sold on the days before `ageDays` off the card, FEFO among the in-date batches. */
  const bringUpToDate = (v: VariantRow, ageDays: number): void => {
    const card = cardOf(v)
    const byAge = demandByVariantAge.get(v.id)
    for (let age = card.struckThroughAge - 1; age > ageDays; age--) {
      let left = byAge?.get(age) ?? 0
      if (left === 0) continue
      const day = daysAgo(age)
      for (const l of [...card.lots].sort(
        (a, b) => a.expiryDate.getTime() - b.expiryDate.getTime(),
      )) {
        if (left === 0) break
        if (
          l.expiryDate.getTime() <= day.getTime() ||
          l.availableFrom.getTime() > day.getTime() ||
          l.qtyPcs === 0
        )
          continue
        const take = Math.min(left, l.qtyPcs)
        l.qtyPcs -= take
        left -= take
      }
    }
    card.struckThroughAge = Math.min(card.struckThroughAge, ageDays + 1)
  }
  const casesFor = (
    v: VariantRow,
    ageDays: number,
    cadence: number,
    min: number,
    lot: PlannedLot,
  ): number => {
    bringUpToDate(v, ageDays)
    const card = cardOf(v)
    const horizon = Math.max(0, ageDays - cadence)
    const horizonDay = daysAgo(horizon)
    const billDay = daysAgo(ageDays)
    const wanted = Math.ceil(demandInWindow(v.id, ageDays, horizon) * 1.15)
    const usable = card.lots
      .filter(
        (l) =>
          l.expiryDate.getTime() > horizonDay.getTime() &&
          l.availableFrom.getTime() <= billDay.getTime(),
      )
      .reduce((sum, l) => sum + l.qtyPcs, 0)
    const cases = Math.max(min, Math.ceil(Math.max(0, wanted - usable) / v.defaultCaseSize))
    if (cases > 0)
      card.lots.push({
        qtyPcs: cases * v.defaultCaseSize,
        expiryDate: lot.expiryDate,
        availableFrom: lot.availableFrom,
      })
    return cases
  }
  /** The SKUs of a house this distributor lists, with any that never sells excluded from cadence bills. */
  const houseVariants = (supplier: SupplierDef): VariantRow[] =>
    variants.filter(
      (v) =>
        supplier.brands.includes(v.brandKey) &&
        profileOf(v) !== 'low' &&
        profileOf(v) !== 'zero' &&
        v.status !== 'discontinued',
    )

  for (const supplier of SUPPLIERS) {
    const mine = houseVariants(supplier)
    if (mine.length === 0) continue
    const fixed = FIXED_INVOICES.filter((f) => f.supplierKey === supplier.key)
    const fixedAges = fixed.map((f) => f.ageDays)
    const stopAt = fixedAges.length > 0 ? Math.min(...fixedAges) + 2 : 1
    // cadence bills, oldest first
    let seq = 0
    for (let age = historyDays + 4; age > stopAt; age -= supplier.cadenceDays) {
      seq += 1
      const invoiceDate = workingDayOnOrBefore(daysAgo(age))
      const invoiceKey = `${supplier.key}:c${seq}`
      const ranked = [...mine]
        .map((v) => ({
          v,
          pcs: demandInWindow(v.id, age, Math.max(0, age - supplier.cadenceDays)),
        }))
        .sort((a, b) => b.pcs - a.pcs || (a.v.key < b.v.key ? -1 : 1))
      const lines = ranked
        .filter((r) => r.pcs > 0)
        .map(({ v }) => {
          const lot = grnLot(supplier, v, invoiceKey, invoiceDate)
          return { v, lot, cases: casesFor(v, age, supplier.cadenceDays, 0, lot) }
        })
      const kept = lines.filter((l) => l.cases > 0)
      // a batch nothing came in on is no batch at all
      for (const l of lines) if (l.cases === 0) dropLot(l.lot)
      if (kept.length === 0) continue
      invoices.push({
        invoiceKey,
        supplierKey: supplier.key,
        supplierStateCode: supplier.stateCode,
        invoiceDate,
        paymentTermsDays: supplier.paymentTermsDays,
        lines: kept.map(({ v, lot, cases }) => ({ variantKey: v.key, lot, cases })),
      })
    }
    for (const f of fixed) {
      const invoiceDate = daysAgo(f.ageDays)
      const keys = f.variantKeys.filter((k) => variantByKey.has(k))
      if (keys.length === 0) continue
      invoices.push({
        invoiceKey: f.invoiceKey,
        supplierKey: supplier.key,
        supplierStateCode: supplier.stateCode,
        invoiceDate,
        paymentTermsDays: supplier.paymentTermsDays,
        lines: keys.map((k) => {
          const v = variantByKey.get(k)
          if (!v) throw new Error(`unknown variant ${k}`)
          const lot = grnLot(supplier, v, f.invoiceKey, invoiceDate)
          return { variantKey: k, lot, cases: casesFor(v, f.ageDays, supplier.cadenceDays, 3, lot) }
        }),
      })
    }
  }
  invoices.sort(
    (a, b) =>
      a.invoiceDate.getTime() - b.invoiceDate.getTime() || (a.invoiceKey < b.invoiceKey ? -1 : 1),
  )
  for (const inv of invoices)
    for (const line of inv.lines) {
      line.lot.qtyPcs = line.cases * line.lot.caseSize
      if (line.lot.refused) line.lot.holdPcs = line.lot.qtyPcs
    }
  // A SKU sold before any batch above was on the rack (a withdrawn SKU, a slow one the houses no
  // longer bill) had an older batch from the books' opening: add it, sized by the replay.
  for (const v of variants) {
    const byAge = demandByVariantAge.get(v.id)
    if (!byAge) continue
    const earliest = daysAgo(Math.max(...byAge.keys()))
    const covered = (lotsByVariantId.get(v.id) ?? []).some(
      (l) =>
        l.kind !== 'count' &&
        l.availableFrom.getTime() <= earliest.getTime() &&
        l.expiryDate.getTime() > earliest.getTime(),
    )
    if (covered) continue
    const mfg = daysAgo(OPENING_AGE_DAYS + 5)
    addLot({
      id: demoId('stock-lot', `${v.key}:b0`),
      variantId: v.id,
      variantKey: v.key,
      batchNo: `B${isoDate(mfg).replace(/-/g, '')}`,
      caseSize: v.defaultCaseSize,
      mfgDate: mfg,
      expiryDate: new Date(mfg.getTime() + v.shelfLifeDays * 86_400_000),
      availableFrom: daysAgo(OPENING_AGE_DAYS),
      kind: 'opening',
      qtyPcs: v.defaultCaseSize,
      holdPcs: 0,
      grn: null,
      countNote: null,
      refused: false,
    })
  }
  // a batch's position in the variant's list is by manufacture date (FEFO readers rely on `[0]`)
  for (const arr of lotsByVariantId.values())
    arr.sort((a, b) => a.mfgDate.getTime() - b.mfgDate.getTime() || (a.id < b.id ? -1 : 1))
  // the pieces later seeds take from the OLDEST batch stay put (after the sort: that is the `[0]`
  // those seeds read)
  for (const [key, held] of Object.entries(HELD_PCS_ON_OLDEST_LOT)) {
    const v = variantByKey.get(key)
    const oldest = v ? lotsByVariantId.get(v.id)?.[0] : undefined
    if (oldest) oldest.holdPcs += held
  }
  for (const [key, held] of Object.entries(input.holdOnOldestLot)) {
    const v = variantByKey.get(key)
    const oldest = v ? lotsByVariantId.get(v.id)?.[0] : undefined
    if (oldest) oldest.holdPcs += held
  }

  // --- 4. the non-sale movements the replay has to make room for ----------------------------------------
  const events: StockEvent[] = []
  for (const vk of damagedVariantKeysFor(variants, profileOf)) {
    const v = variantByKey.get(vk)
    if (!v) continue
    events.push({
      key: `damage:${vk}`,
      kind: 'damage',
      variantId: v.id,
      lotId: '',
      day: daysAgo(DAMAGE_AGE_DAYS),
      at: atIstTime(daysAgo(DAMAGE_AGE_DAYS), 15, 0),
      qtyPcs: 6,
      note: 'Carton wet from monsoon leak, moved to damaged bin.',
    })
  }
  for (const v of variants) {
    if (profileOf(v) !== 'zero') continue
    const lot = lotsByVariantId.get(v.id)?.[0]
    if (!lot) continue
    events.push({
      key: `soldout:${v.key}`,
      kind: 'soldout',
      variantId: v.id,
      lotId: lot.id,
      day: daysAgo(SOLDOUT_AGE_DAYS),
      at: atIstTime(daysAgo(SOLDOUT_AGE_DAYS), 18, 0),
      qtyPcs: 0, // settled by the replay: whatever was left that evening
      note: 'Stock take: the last cases went out on van sales that were billed by hand.',
    })
  }
  for (const vk of input.vanLoadVariantKeys) {
    const v = variantByKey.get(vk)
    if (!v || totalDemand(v.id) === 0) continue
    events.push({
      key: `van-load:${vk}`,
      kind: 'van_load',
      variantId: v.id,
      lotId: '',
      day: TODAY,
      at: atIstTime(TODAY, 8, 40),
      qtyPcs: v.defaultCaseSize,
      note: 'Counter stock for van sales on today’s trip.',
    })
  }

  // --- 5. the replay ----------------------------------------------------------------------------------
  const demand = input.demand.map((d) => ({ ...d }))
  allocateStock({
    lots,
    lotsByVariantId,
    demand,
    events,
    residualTarget,
    overrideLineKeys: input.overrideLineKeys,
  })

  // --- 6. expired flow stock is swept to the bin the day after it expired ---------------------------
  const consumed = consumedByLot(demand, events)
  for (const lot of lots) {
    if (lot.kind === 'count') continue
    if (lot.expiryDate.getTime() >= TODAY.getTime()) continue
    const left = lot.qtyPcs - (consumed.get(lot.id) ?? 0) - lot.holdPcs
    if (left <= 0) continue
    const day = new Date(lot.expiryDate.getTime() + 86_400_000)
    events.push({
      key: `expiry-sweep:${lot.id}`,
      kind: 'expiry_sweep',
      variantId: lot.variantId,
      lotId: lot.id,
      day,
      at: atIstTime(day, 9, 30),
      qtyPcs: left,
      note: 'Past expiry on the weekly check; moved to the expiry bin for the claim.',
    })
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.key < b.key ? -1 : 1))

  return { lots, lotsByVariantId, profileByVariantId, invoices, events, demand }
}

function consumedByLot(demand: DemandLine[], events: StockEvent[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of demand) if (d.lotId) out.set(d.lotId, (out.get(d.lotId) ?? 0) + d.pcs)
  for (const e of events)
    if (e.lotId && e.kind !== 'expiry_sweep') out.set(e.lotId, (out.get(e.lotId) ?? 0) + e.qtyPcs)
  return out
}

interface AllocateInput {
  lots: PlannedLot[]
  lotsByVariantId: Map<string, PlannedLot[]>
  demand: DemandLine[]
  events: StockEvent[]
  residualTarget: Map<string, { pcs: number; checkpointAge: number }>
  overrideLineKeys: ReadonlySet<string>
}

/**
 * Replays the sold lines and the other movements in date order, FEFO among the batches that were on
 * the rack and in date that day, growing what ran short until the plan is feasible and every SKU ends
 * where its profile says. Mutates `lots[].qtyPcs`, `demand[].lotId` and `events[].lotId/qtyPcs`.
 */
function allocateStock(input: AllocateInput): void {
  const { lots, lotsByVariantId, demand, events, residualTarget } = input
  const byDay = (a: { day: Date; key: string }, b: { day: Date; key: string }): number =>
    a.day.getTime() - b.day.getTime() || (a.key < b.key ? -1 : 1)
  type Step = { kind: 'demand'; line: DemandLine } | { kind: 'event'; event: StockEvent }
  const steps: Step[] = [
    ...demand.map((line): Step => ({ kind: 'demand', line })),
    ...events.map((event): Step => ({ kind: 'event', event })),
  ].sort((a, b) => {
    const da = a.kind === 'demand' ? a.line : a.event
    const db = b.kind === 'demand' ? b.line : b.event
    return byDay(da, db)
  })
  const lotById = new Map(lots.map((l) => [l.id, l]))

  let lastChanges: string[] = []
  for (let iteration = 0; iteration < 16; iteration++) {
    const changes: string[] = []
    const used = new Map<string, number>()
    const remaining = (lot: PlannedLot): number =>
      lot.qtyPcs - lot.holdPcs - (used.get(lot.id) ?? 0)
    const take = (lot: PlannedLot, pcs: number): void =>
      void used.set(lot.id, (used.get(lot.id) ?? 0) + pcs)
    /** Batches on the rack and in date on `day`, FEFO order. */
    const candidates = (variantId: string, day: Date): PlannedLot[] =>
      (lotsByVariantId.get(variantId) ?? [])
        .filter(
          (l) =>
            l.availableFrom.getTime() <= day.getTime() && l.expiryDate.getTime() > day.getTime(),
        )
        .sort(
          (a, b) =>
            a.expiryDate.getTime() - b.expiryDate.getTime() ||
            a.availableFrom.getTime() - b.availableFrom.getTime() ||
            (a.id < b.id ? -1 : 1),
        )
    /** Shortfalls: (variant, day, pcs, the batch the pieces were taken from) → the batch to grow. */
    const shortfalls: { variantId: string; day: Date; pcs: number; lotId: string | null }[] = []
    /** Stock on hand per lot on the day of a checkpoint (the sold-out SKUs' stock take). */
    const checkpointBalance = new Map<string, number>()

    for (const step of steps) {
      if (step.kind === 'demand') {
        const line = step.line
        const cands = candidates(line.variantId, line.day)
        const inStock = cands.filter((l) => remaining(l) > 0)
        line.suggestedLotId = inStock[0]?.id ?? cands[0]?.id ?? null
        const second = inStock[1]
        const override =
          input.overrideLineKeys.has(line.key) &&
          second !== undefined &&
          remaining(second) >= line.pcs
        const ordered =
          override && second ? [second, ...inStock.filter((l) => l.id !== second.id)] : inStock
        const fits = ordered.find((l) => remaining(l) >= line.pcs)
        if (fits) {
          line.lotId = fits.id
          line.fefoOverride = override
          take(fits, line.pcs)
          continue
        }
        // nothing holds the whole line: take it from the fullest batch and note the shortfall
        const best = [...ordered].sort((a, b) => remaining(b) - remaining(a))[0] ?? cands[0] ?? null
        if (best) {
          line.lotId = best.id
          line.fefoOverride = false
          shortfalls.push({
            variantId: line.variantId,
            day: line.day,
            pcs: line.pcs - Math.max(0, remaining(best)),
            lotId: best.id,
          })
          take(best, line.pcs)
        } else {
          line.lotId = null
          shortfalls.push({ variantId: line.variantId, day: line.day, pcs: line.pcs, lotId: null })
        }
        continue
      }
      const e = step.event
      if (e.kind === 'soldout') {
        const lot = lotById.get(e.lotId)
        if (!lot) continue
        checkpointBalance.set(lot.id, remaining(lot))
        e.qtyPcs = Math.max(0, remaining(lot))
        take(lot, e.qtyPcs)
        continue
      }
      if (e.kind === 'expiry_sweep') continue
      // damage / van load: the newest in-date batch that can spare it, else the fullest
      const cands = candidates(e.variantId, e.day).filter((l) => remaining(l) > 0)
      const newestFirst = [...cands].sort(
        (a, b) => b.availableFrom.getTime() - a.availableFrom.getTime() || (a.id < b.id ? -1 : 1),
      )
      const lot =
        newestFirst.find((l) => remaining(l) >= e.qtyPcs) ??
        [...cands].sort((a, b) => remaining(b) - remaining(a))[0]
      if (!lot) {
        shortfalls.push({ variantId: e.variantId, day: e.day, pcs: e.qtyPcs, lotId: null })
        continue
      }
      e.lotId = lot.id
      if (remaining(lot) < e.qtyPcs)
        shortfalls.push({
          variantId: e.variantId,
          day: e.day,
          pcs: e.qtyPcs - remaining(lot),
          lotId: lot.id,
        })
      take(lot, e.qtyPcs)
    }

    // --- grow what ran short: the batch the pieces were taken from, else the most recent batch
    //     received before the sale and in date that day ---
    let changed = false
    for (const s of shortfalls) {
      const taken = s.lotId ? lotById.get(s.lotId) : undefined
      const target =
        taken ??
        (lotsByVariantId.get(s.variantId) ?? [])
          .filter(
            (l) =>
              l.kind !== 'count' &&
              !l.refused &&
              l.availableFrom.getTime() <= s.day.getTime() &&
              l.expiryDate.getTime() > s.day.getTime(),
          )
          .sort((a, b) => b.availableFrom.getTime() - a.availableFrom.getTime())[0]
      if (!target) {
        const all = lotsByVariantId.get(s.variantId) ?? []
        const first = all[0]
        throw new Error(
          `stock plan: nothing can supply ${first?.variantKey ?? s.variantId} on ${isoDate(s.day)} (${s.pcs} pcs short); batches: ${all
            .map((l) => `${l.kind}:${isoDate(l.availableFrom)}→${isoDate(l.expiryDate)}`)
            .join(', ')}`,
        )
      }
      const grow =
        target.kind === 'grn' ? Math.ceil(s.pcs / target.caseSize) * target.caseSize : s.pcs
      target.qtyPcs += grow
      changes.push(
        `short ${target.variantKey} ${isoDate(s.day)} +${grow} on ${target.kind}:${isoDate(target.availableFrom)}`,
      )
      changed = true
    }
    // --- and, once nothing is short, settle today's residual on the newest batch of each SKU; never
    //     below what was taken from it, so the settle cannot make a line short again ------------------
    for (const [variantId, target] of residualTarget) {
      if (shortfalls.length > 0) break
      const flow = (lotsByVariantId.get(variantId) ?? []).filter(
        (l) => l.kind !== 'count' && !l.refused,
      )
      if (flow.length === 0) continue
      const asOfAge = target.checkpointAge
      const asOf = daysAgo(asOfAge)
      let onHand: number
      let adjustable: PlannedLot | undefined
      if (asOfAge > 0) {
        // the sold-out SKUs: what the stock take found that evening
        const lot = flow[0]
        if (!lot) continue
        onHand = checkpointBalance.get(lot.id) ?? remaining(lot)
        adjustable = lot
      } else {
        onHand = flow.reduce(
          (s, l) => s + (l.expiryDate.getTime() > asOf.getTime() ? Math.max(0, remaining(l)) : 0),
          0,
        )
        adjustable = [...flow]
          .filter((l) => l.expiryDate.getTime() > asOf.getTime())
          .sort((a, b) => b.availableFrom.getTime() - a.availableFrom.getTime())[0]
      }
      if (!adjustable) continue
      const diff = target.pcs - onHand
      if (diff === 0) continue
      const floor = (used.get(adjustable.id) ?? 0) + adjustable.holdPcs
      if (adjustable.kind === 'grn') {
        // whole cases on a bill: settle to the case that keeps at least the target on the rack
        const cases = Math.ceil(diff / adjustable.caseSize)
        if (cases === 0) continue
        const next = Math.max(
          Math.ceil(floor / adjustable.caseSize) * adjustable.caseSize,
          adjustable.qtyPcs + cases * adjustable.caseSize,
        )
        if (next < adjustable.caseSize || next === adjustable.qtyPcs) continue
        adjustable.qtyPcs = next
      } else {
        const next = Math.max(floor, adjustable.qtyPcs + diff)
        if (next === adjustable.qtyPcs) continue
        adjustable.qtyPcs = next
      }
      changes.push(
        `residual ${adjustable.variantKey} ${diff} on ${adjustable.kind}:${isoDate(adjustable.availableFrom)} onHand=${onHand} target=${target.pcs}`,
      )
      changed = true
    }
    lastChanges = changes
    if (!changed) return
  }
  throw new Error(
    `stock plan: the replay did not converge in 16 iterations; last: ${lastChanges.slice(0, 12).join(' | ')}`,
  )
}

/** Today's stock per SKU as the plan leaves it (godown only), for the reorder and cover screens. */
export function plannedOnHandByVariant(plan: StockPlan): Map<string, number> {
  const consumed = consumedByLot(plan.demand, plan.events)
  const out = new Map<string, number>()
  for (const lot of plan.lots) {
    const swept =
      plan.events.find((e) => e.kind === 'expiry_sweep' && e.lotId === lot.id)?.qtyPcs ?? 0
    const left = lot.qtyPcs - (consumed.get(lot.id) ?? 0) - swept
    out.set(lot.variantId, (out.get(lot.variantId) ?? 0) + left)
  }
  return out
}
