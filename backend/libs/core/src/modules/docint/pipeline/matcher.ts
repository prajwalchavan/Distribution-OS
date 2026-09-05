import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SkuMatchReason } from '@dos/contracts'
import {
  productAliases,
  productExternalCodes,
  productVariants,
  skuMatchCandidates,
  supplierPackConfigs,
  type Db,
} from '@dos/db'
import { parseCaseSizeFromName, uuidv7 } from '@dos/domain'

/**
 * The SKU cascade (docs/05 step 8, brief §4.3): for every printed line, in order —
 *
 *   1. `supplier_alias`  — this tenant has resolved this supplier's code or description before
 *                          (`supplier_pack_configs`): exact on the normalised description or the code
 *   2. `external_code`   — the printed supplier code is a curated `product_external_codes` row
 *   3. `ean`             — a 13-digit EAN printed in the description or the code
 *   4. `trgm`            — an exact normalised `product_aliases` hit (similarity 1) or pg_trgm
 *                          similarity over variant names and aliases
 *   5. `hsn_brand_mrp`   — same HSN and MRP within 5 %, when nothing above scored
 *
 * Every candidate carries its fusion features (which stage, the similarity, the HSN prefix match,
 * the MRP delta) for the week-10 eval. Bands: a top candidate at ≥ 0.90 that is clearly ahead of
 * the runner-up is chosen automatically (green); candidates but no chosen one is amber; no candidate
 * at all is red — the "create the product, then rerun" case. The reviewer's accept/choose writes are
 * in `matches.service.ts`; this file never marks a candidate `chosen` when a human already did.
 */

export interface MatchLineInput {
  lineNo: number
  description: string
  supplierCode: string | null
  hsnCode: string | null
  mrpPaise: number | null
  /** The pack size parsed from the printed description, when any. */
  caseSize: number | null
  qtyPcs: number | null
  printedQty: number | null
}

export interface CandidateDraft {
  variantId: string
  score: number
  reason: SkuMatchReason
  features: Record<string, unknown>
}

export type Band = 'green' | 'amber' | 'red'

export interface MatchLineResult {
  lineNo: number
  band: Band
  candidates: CandidateDraft[]
  /** The buy-side pack the cascade would use for the chosen variant (docs/17 B) and where the three sources disagree. */
  pack: {
    parsed: number | null
    config: number | null
    variantDefault: number | null
    disagreement: boolean
  }
}

export const GREEN_THRESHOLD = 0.9
export const AMBER_THRESHOLD = 0.45
/** How far ahead of the runner-up a green must be to be chosen on its own. */
const CLEAR_MARGIN = 0.08
const MAX_CANDIDATES = 5

/** Lower-case, collapse whitespace: what `product_aliases.normalized` and this module store. */
export function normalizeDescription(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Letters and digits only: the tolerant form (`GURU KRIPA AGENCIES` → `gurukripaagencies`). */
export function normalizeTight(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const EAN = /(?<!\d)(\d{13})(?!\d)/

interface VariantRow {
  id: string
  name: string
  hsnCode: string
  mrpPaise: number | null
  defaultCaseSize: number
  ean: string | null
}

async function variantsByIds(tx: Db, ids: string[]): Promise<Map<string, VariantRow>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({
      id: productVariants.id,
      name: productVariants.name,
      hsnCode: productVariants.hsnCode,
      mrpPaise: productVariants.mrpPaise,
      defaultCaseSize: productVariants.defaultCaseSize,
      ean: productVariants.ean,
    })
    .from(productVariants)
    .where(
      and(
        inArray(productVariants.id, [...new Set(ids)]),
        inArray(productVariants.status, ['active', 'proposed']),
      ),
    )
  return new Map(rows.map((r) => [r.id, r]))
}

/** Bonus features shared by every stage: HSN agreement and MRP proximity, both cheap and telling. */
function bonuses(
  line: MatchLineInput,
  variant: VariantRow,
): { hsnMatch: boolean; mrpDelta: number | null; bonus: number } {
  const hsnMatch =
    !!line.hsnCode &&
    (variant.hsnCode.startsWith(line.hsnCode.slice(0, 4)) ||
      line.hsnCode.startsWith(variant.hsnCode.slice(0, 4)))
  const mrpDelta =
    line.mrpPaise !== null && variant.mrpPaise !== null && variant.mrpPaise > 0
      ? Math.abs(line.mrpPaise - variant.mrpPaise) / variant.mrpPaise
      : null
  let bonus = 0
  if (hsnMatch) bonus += 0.03
  if (mrpDelta !== null && mrpDelta <= 0.05) bonus += 0.04
  if (line.hsnCode && !hsnMatch) bonus -= 0.05
  return { hsnMatch, mrpDelta, bonus }
}

const clamp = (n: number): number => Math.round(Math.min(0.99, Math.max(0, n)) * 1000) / 1000

/**
 * Run the cascade for the given lines of one supplier. Pure read; nothing is written here.
 */
export async function matchLines(
  tx: Db,
  input: { tenantId: string; supplierId: string | null; lines: MatchLineInput[] },
): Promise<MatchLineResult[]> {
  const packs = input.supplierId
    ? await tx
        .select({
          variantId: supplierPackConfigs.variantId,
          pcsPerCase: supplierPackConfigs.pcsPerCase,
          supplierCode: supplierPackConfigs.supplierCode,
          supplierDescription: supplierPackConfigs.supplierDescription,
        })
        .from(supplierPackConfigs)
        .where(
          and(
            eq(supplierPackConfigs.tenantId, input.tenantId),
            eq(supplierPackConfigs.supplierId, input.supplierId),
          ),
        )
    : []
  const packByVariant = new Map(packs.map((p) => [p.variantId, p]))
  const packByDescription = new Map<string, (typeof packs)[number]>()
  const packByCode = new Map<string, (typeof packs)[number]>()
  for (const p of packs) {
    if (p.supplierDescription) packByDescription.set(normalizeTight(p.supplierDescription), p)
    if (p.supplierCode) packByCode.set(p.supplierCode.trim().toUpperCase(), p)
  }

  const results: MatchLineResult[] = []
  for (const line of input.lines) {
    const drafts = new Map<string, CandidateDraft>()
    const add = (
      variantId: string,
      score: number,
      reason: SkuMatchReason,
      features: Record<string, unknown>,
    ): void => {
      const existing = drafts.get(variantId)
      if (!existing || existing.score < score)
        drafts.set(variantId, {
          variantId,
          score,
          reason,
          features: { ...existing?.features, ...features },
        })
    }
    const tight = normalizeTight(line.description)
    const loose = normalizeDescription(line.description)
    const code = line.supplierCode?.trim().toUpperCase() ?? null

    // 1. what this supplier printed before, as this tenant remembers it
    const packHit = (code ? packByCode.get(code) : undefined) ?? packByDescription.get(tight)
    if (packHit)
      add(packHit.variantId, 0.98, 'supplier_alias', {
        supplierAlias: true,
        byCode: !!code && packByCode.has(code),
      })

    // 2. the curated external code
    if (code) {
      const codes = await tx
        .select({ variantId: productExternalCodes.variantId, system: productExternalCodes.system })
        .from(productExternalCodes)
        .where(eq(productExternalCodes.code, code))
        .limit(5)
      for (const c of codes)
        add(c.variantId, 0.97, 'external_code', { externalCode: code, system: c.system })
    }

    // 3. a printed EAN
    const ean = EAN.exec(`${line.description} ${line.supplierCode ?? ''}`)?.[1]
    if (ean) {
      const rows = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.ean, ean))
        .limit(1)
      for (const r of rows) add(r.id, 0.96, 'ean', { ean })
    }

    // 4. exact alias, then trigram similarity over aliases and names (pg_trgm, migration 0017)
    const aliasHits = await tx
      .select({ variantId: productAliases.variantId, hits: productAliases.hits })
      .from(productAliases)
      .where(eq(productAliases.normalized, loose))
      .limit(3)
    for (const a of aliasHits)
      add(a.variantId, 0.95, 'trgm', { aliasExact: true, aliasHits: a.hits })
    if (drafts.size === 0 || [...drafts.values()].every((d) => d.score < GREEN_THRESHOLD)) {
      const fuzzy = await tx.execute<{ variant_id: string; sim: number; via: string }>(sql`
        select variant_id, max(sim)::float8 as sim, min(via) as via from (
          select v.id as variant_id, similarity(v.name, ${line.description}) as sim, 'variant' as via
            from product_variants v where v.status in ('active', 'proposed') and v.name % ${line.description}
          union all
          select a.variant_id, similarity(a.normalized, ${loose}) as sim, 'alias' as via
            from product_aliases a where a.normalized % ${loose}
          union all
          select v.id, similarity(p.name || ' ' || v.name, ${line.description}) as sim, 'product' as via
            from product_variants v join products p on p.id = v.product_id
            where v.status in ('active', 'proposed') and (p.name || ' ' || v.name) % ${line.description}
        ) s group by variant_id order by sim desc limit ${MAX_CANDIDATES * 2}`)
      for (const row of fuzzy.rows) {
        const sim = Number(row.sim)
        // similarity 1.0 → 0.95, 0.3 → 0.45: a fuzzy hit alone never reaches green
        add(row.variant_id, 0.24 + sim * 0.71, 'trgm', {
          similarity: Math.round(sim * 1000) / 1000,
          via: row.via,
        })
      }
    }

    // 5. same HSN and MRP, only when nothing better turned up
    if (drafts.size === 0 && line.hsnCode && line.mrpPaise) {
      const rows = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.hsnCode, line.hsnCode),
            eq(productVariants.mrpPaise, line.mrpPaise),
            inArray(productVariants.status, ['active', 'proposed']),
          ),
        )
        .limit(MAX_CANDIDATES)
      for (const r of rows) add(r.id, 0.55, 'hsn_brand_mrp', { hsnMrp: true })
    }

    // fuse: bonuses from HSN and MRP agreement, then rank
    const variants = await variantsByIds(tx, [...drafts.keys()])
    const candidates: CandidateDraft[] = []
    for (const draft of drafts.values()) {
      const variant = variants.get(draft.variantId)
      if (!variant) continue
      const b = bonuses(line, variant)
      const score = clamp(draft.score + b.bonus)
      if (score < AMBER_THRESHOLD) continue
      candidates.push({
        ...draft,
        score,
        features: {
          ...draft.features,
          hsnMatch: b.hsnMatch,
          mrpDelta: b.mrpDelta === null ? null : Math.round(b.mrpDelta * 1000) / 1000,
        },
      })
    }
    candidates.sort((a, b) => b.score - a.score || a.variantId.localeCompare(b.variantId))
    const top = candidates.slice(0, MAX_CANDIDATES)
    const first = top[0]
    const second = top[1]
    const green =
      !!first &&
      first.score >= GREEN_THRESHOLD &&
      (!second || first.score - second.score >= CLEAR_MARGIN || second.score < GREEN_THRESHOLD)
    const chosenVariant = green && first ? variants.get(first.variantId) : undefined
    const parsed = line.caseSize ?? parseCaseSizeFromName(line.description)
    const configPack = chosenVariant
      ? (packByVariant.get(chosenVariant.id)?.pcsPerCase ?? null)
      : null
    const variantDefault = chosenVariant?.defaultCaseSize ?? null
    const sources = [parsed, configPack, variantDefault].filter((n): n is number => n !== null)
    results.push({
      lineNo: line.lineNo,
      band: green ? 'green' : top.length > 0 ? 'amber' : 'red',
      candidates: top,
      pack: { parsed, config: configPack, variantDefault, disagreement: new Set(sources).size > 1 },
    })
  }
  return results
}

/**
 * Persist the cascade's answer for an extraction: upsert through `sku_match_candidates_unique_idx`
 * (never a duplicate row), mark the green line's top candidate chosen, and NEVER touch a line that
 * already has a chosen candidate (a human's pick, or an earlier run's). Returns the bands per line.
 */
export async function writeCandidates(
  tx: Db,
  input: { tenantId: string; extractionId: string; results: MatchLineResult[] },
): Promise<Map<number, Band>> {
  const chosenLines = new Set(
    (
      await tx
        .select({ lineNo: skuMatchCandidates.lineNo })
        .from(skuMatchCandidates)
        .where(
          and(
            eq(skuMatchCandidates.extractionId, input.extractionId),
            eq(skuMatchCandidates.chosen, true),
          ),
        )
    ).map((r) => r.lineNo),
  )
  const bands = new Map<number, Band>()
  for (const line of input.results) {
    if (chosenLines.has(line.lineNo)) {
      bands.set(line.lineNo, 'green')
      continue
    }
    bands.set(line.lineNo, line.band)
    for (const [index, c] of line.candidates.entries()) {
      const chosen = line.band === 'green' && index === 0
      await tx
        .insert(skuMatchCandidates)
        .values({
          id: uuidv7(),
          tenantId: input.tenantId,
          extractionId: input.extractionId,
          lineNo: line.lineNo,
          variantId: c.variantId,
          score: c.score,
          reason: c.reason,
          chosen,
          matchedBy: 'auto',
          features: { ...c.features, pack: line.pack },
        })
        .onConflictDoUpdate({
          target: [
            skuMatchCandidates.tenantId,
            skuMatchCandidates.extractionId,
            skuMatchCandidates.lineNo,
            skuMatchCandidates.variantId,
          ],
          set: {
            score: c.score,
            reason: c.reason,
            chosen,
            matchedBy: 'auto',
            features: { ...c.features, pack: line.pack },
          },
        })
    }
  }
  return bands
}
