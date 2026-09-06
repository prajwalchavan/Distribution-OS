import { sql, type SQL } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { clampBps, toBps, variantLabelSql } from './ai.internals.js'
import type { ParsedFragment } from './tokenise.js'

/**
 * Phrase → SKU. The cascade the brief asks for, narrowest first:
 *
 *   1. THE SHOP'S OWN HABIT. What this shop has bought before (`retailer_purchase_history` and its
 *      own order lines) is searched first and scored higher, because "campa" from a shop that buys
 *      Campa 750 ml every week means that SKU and not the 2 L. This is the single biggest accuracy
 *      win available and it costs one indexed read.
 *   2. THE DISTRIBUTOR'S LISTING. `tenant_products` (with `local_alias`, the name the desk itself
 *      typed) joined to the curated catalog, matched with pg_trgm — `word_similarity` so a short
 *      phrase finds a long name ("campa" in "Campa Cola 750 ml"), `similarity` for the whole string.
 *   3. CURATED ALIASES. `product_aliases`, the names docint has learned off supplier bills.
 *
 * A SKU THE DISTRIBUTOR DOES NOT LIST IS NEVER PROPOSED. The catalog is global and curated (ADR
 * 0005), but an order line for a variant this distributor does not stock would fail at pricing
 * anyway; offering it would only teach the reviewer to distrust the list.
 *
 * Scores are BASIS POINTS, never floats (CLAUDE.md). The trigram score is combined with a token
 * COVERAGE bonus computed here — the share of the phrase's own words that appear in the label —
 * because "too yumm chilli" matching "Too Yumm Chilli Chataka 90g" should outrank a single-word
 * trigram accident. The arithmetic is plain and deterministic so a spec can assert on the ordering.
 */

export interface VariantCandidate {
  variantId: string
  /** What the reviewer reads: brand + product + variant, the way the catalog screen shows it. */
  label: string
  scoreBps: number
  /** Sell-side pack size (`case_size_override` else the variant default) — docs/17 B. */
  packSize: number | null
  /** Which stage produced it, kept for the eval and shown to nobody. */
  source: 'shop_history' | 'listing' | 'alias'
}

export interface MatchOptions {
  /** The shop, when it is known: its own habit is stage 1. */
  retailerId: string | null
  /** Candidates kept per line (the contract caps the wire at 5). */
  maxCandidates?: number
}

/** A line is `matched` at or above this; below `AMBIGUOUS_BPS` it is `unmatched`. */
export const MATCH_BPS = 6_500
export const AMBIGUOUS_BPS = 2_500
/** How far ahead of the runner-up a match must be to be taken without a second thought. */
export const CLEAR_MARGIN_BPS = 800
const MAX_CANDIDATES = 5
/** Rows the trigram search may consider per phrase — bounded work per request (docs/20 rule 1). */
const SEARCH_LIMIT = 20

interface ScoredRow {
  variantId: string
  label: string
  packSize: number | null
  trgm: number
  source: VariantCandidate['source']
}

/**
 * Candidates for every fragment of one message, in the fragments' own order. One round trip per
 * fragment (at most `AI_MAX_DRAFT_LINES` = 60), each bounded by `SEARCH_LIMIT`.
 */
export async function matchFragments(
  tx: Db,
  fragments: readonly ParsedFragment[],
  options: MatchOptions,
): Promise<VariantCandidate[][]> {
  const out: VariantCandidate[][] = []
  const history = options.retailerId ? await shopHistory(tx, options.retailerId) : new Map()
  for (const fragment of fragments) {
    out.push(
      await matchPhrase(tx, fragment.phrase, history, options.maxCandidates ?? MAX_CANDIDATES),
    )
  }
  return out
}

/** One phrase against the listing, scored and ranked. Exported so a spec can probe the matcher alone. */
export async function matchPhrase(
  tx: Db,
  phrase: string,
  history: ReadonlyMap<string, number>,
  maxCandidates = MAX_CANDIDATES,
): Promise<VariantCandidate[]> {
  const cleaned = phrase.trim()
  if (cleaned.length === 0) return []
  const rows = await searchListing(tx, cleaned)
  const words = cleaned.split(/\s+/).filter((w) => w.length > 1)
  const scored = rows.map((row) => {
    const label = row.label.toLowerCase()
    const covered = words.filter((word) => label.includes(word)).length
    const coverage = words.length === 0 ? 0 : covered / words.length
    // Trigram carries the shape of the phrase; coverage carries "did every word of it appear".
    // 60/40 keeps a full-coverage match ahead of a higher-trigram partial one without letting a
    // one-word phrase ("cola") sweep every cola in the list to the top on coverage alone.
    const base = row.trgm * 0.6 + coverage * 0.4
    // The shop's own habit: a variant it has bought before is worth up to 15 points more, scaled by
    // how often. It can lift a near-miss over the line; it can never create a match out of nothing.
    const seen = history.get(row.variantId) ?? 0
    const habit = seen > 0 ? Math.min(0.15, 0.05 + seen * 0.02) : 0
    return {
      variantId: row.variantId,
      label: row.label,
      packSize: row.packSize,
      scoreBps: clampBps(toBps(Math.min(1, base + (base > 0 ? habit : 0)))),
      source: seen > 0 ? ('shop_history' as const) : row.source,
    }
  })
  scored.sort((a, b) => b.scoreBps - a.scoreBps || (a.variantId < b.variantId ? -1 : 1))
  return scored.slice(0, maxCandidates)
}

/**
 * The tenant's own listing, searched with pg_trgm (installed by migration 0015). `word_similarity`
 * finds a short phrase inside a long name; `similarity` scores the whole string; the local alias the
 * desk typed and the curated aliases docint learned are both searchable, and the best of the four
 * wins. Only LISTED variants, only this tenant — RLS scopes `tenant_products`, and the join does the
 * rest.
 */
async function searchListing(tx: Db, phrase: string): Promise<ScoredRow[]> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    with listing as (
      select
        v.id                                                as variant_id,
        ${variantLabelSql}                                  as label,
        tp.local_alias                                      as local_alias,
        coalesce(tp.case_size_override, v.default_case_size) as pack_size
      from tenant_products tp
      join product_variants v on v.id = tp.variant_id
      join products p on p.id = v.product_id
      left join brands b on b.id = p.brand_id
      where tp.tenant_id = ${tenantId}
        and tp.listed = true
        and v.status in ('active', 'proposed')
    ),
    scored as (
      select
        l.variant_id,
        l.label,
        l.pack_size,
        greatest(
          similarity(lower(l.label), ${phrase}),
          word_similarity(${phrase}, lower(l.label)),
          case when l.local_alias is null then 0
               else greatest(similarity(lower(l.local_alias), ${phrase}),
                             word_similarity(${phrase}, lower(l.local_alias))) end,
          coalesce((
            select max(greatest(similarity(a.normalized, ${phrase}),
                                word_similarity(${phrase}, a.normalized)))
            from product_aliases a
            where a.variant_id = l.variant_id
          ), 0)
        ) as trgm,
        case when l.local_alias is not null
              and word_similarity(${phrase}, lower(l.local_alias)) >= 0.5 then 'alias'
             else 'listing' end as source
      from listing l
    )
    select variant_id, label, pack_size, trgm, source
    from scored
    where trgm >= 0.2
    order by trgm desc, variant_id asc
    limit ${SEARCH_LIMIT}
  `)
  return result.rows.map((row: Record<string, unknown>) => ({
    variantId: String(row.variant_id),
    label: String(row.label).replace(/\s+/g, ' ').trim(),
    packSize: row.pack_size === null ? null : Number(row.pack_size),
    trgm: Number(row.trgm),
    source: row.source === 'alias' ? 'alias' : 'listing',
  }))
}

/**
 * What this shop has bought, and how often: the imported purchase history plus its own order lines
 * over the last year. The map's value is a count, so a weekly SKU outranks a one-off.
 */
export async function shopHistory(tx: Db, retailerId: string): Promise<Map<string, number>> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select variant_id, sum(n)::int as n from (
      select h.variant_id, count(*)::int as n
        from retailer_purchase_history h
       where h.tenant_id = ${tenantId} and h.retailer_id = ${retailerId}
         and h.invoice_date > (current_date - interval '365 days')
       group by h.variant_id
      union all
      select l.variant_id, count(*)::int as n
        from sales_order_lines l
        join sales_orders o on o.id = l.order_id
       where o.tenant_id = ${tenantId} and o.retailer_id = ${retailerId}
         and o.state <> 'cancelled'
         and o.created_at > now() - interval '365 days'
       group by l.variant_id
    ) both_sources
    group by variant_id
    order by n desc, variant_id asc
    limit 400
  `)
  const out = new Map<string, number>()
  for (const row of result.rows) out.set(String(row.variant_id), Number(row.n))
  return out
}

/**
 * The shop's favourite SKUs as phrases a person would say — what the deterministic transcriber uses
 * to synthesise a demo voice note, and what the LLM prompt lists so the model matches to what this
 * distributor actually sells rather than to the whole of India's FMCG.
 */
export async function listingLabels(
  tx: Db,
  options: { retailerId: string | null; limit?: number },
): Promise<{ variantId: string; label: string; packSize: number | null }[]> {
  const { tenantId } = currentTenant()
  const limit = Math.min(options.limit ?? 60, 200)
  const preferred: SQL = options.retailerId
    ? sql`(select count(*) from sales_order_lines l join sales_orders o on o.id = l.order_id
             where o.tenant_id = ${tenantId} and o.retailer_id = ${options.retailerId}
               and l.variant_id = v.id and o.state <> 'cancelled')`
    : sql`0`
  const result = await tx.execute(sql`
    select
      v.id as variant_id,
      ${variantLabelSql} as label,
      coalesce(tp.case_size_override, v.default_case_size) as pack_size,
      ${preferred}::int as bought
    from tenant_products tp
    join product_variants v on v.id = tp.variant_id
    join products p on p.id = v.product_id
    left join brands b on b.id = p.brand_id
    where tp.tenant_id = ${tenantId} and tp.listed = true and v.status in ('active', 'proposed')
    order by bought desc, tp.sort_order asc, v.id asc
    limit ${limit}
  `)
  return result.rows.map((row) => ({
    variantId: String(row.variant_id),
    label: String(row.label).replace(/\s+/g, ' ').trim(),
    packSize: row.pack_size === null ? null : Number(row.pack_size),
  }))
}
