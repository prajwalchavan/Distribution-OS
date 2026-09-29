/**
 * WHAT A SCHEME GAVE ON A BILL, COUNTED ONCE PER ORDER LINE (QA DOS-330; docs/22 §8, 2026-09-28, prices and
 * tax ruling 1).
 *
 * The godown picks an order line from as many batches as FEFO asks, and the bill writes one line per batch. Until
 * 2026-09-29 each of those batch lines carried a WHOLE copy of the order line's `applied_rules`, so every reader
 * that summed `amountPaise` or `freeQty` over the lines multiplied a scheme by the number of batches: a brand claim
 * of ₹1,341.90 for ₹268.38 given, the owner's scheme spend ₹3,640.06 against ₹959.44. An issued bill is immutable,
 * so those bills stay as they are and THIS is how every reader reads them:
 *
 *   a bill line written since (its entries carry `batchShare: true`) holds its own share of the rule, and the
 *   shares of one order line add up to the rule once (`billOrderLine` in @dos/domain) — read as written;
 *
 *   a bill line written before (no `batchShare`) holds a copy: the copies of one rule on the batch lines of one
 *   order line are ONE value, spread back over those batch lines by largest remainder — money on their paid
 *   pieces, the item's own free pieces on their free pieces — so a per-line reader (the claim builder) still
 *   gets one line per batch and an aggregate (the scheme-spend register, the owner's daily figures) gets the
 *   rule once. A bill line with no order line (an imported bill) is its own group.
 *
 * The definition is SQL, in ONE place, so the claim builder, the scheme-spend register, the owner's daily
 * rollup, the demo seed's own claims and rollup, and the release check (`pnpm check:scheme-amounts`) cannot
 * disagree about what a scheme gave. A caller hands the invoice lines it reads (any filter by tenant, date,
 * state, shop, brand or item keeps an order line's batch lines together) and selects from `rg_given`.
 */
import { sql, type SQL } from 'drizzle-orm'
import { withSystem, type Db } from './client.js'

/**
 * The CTEs `rg_lines … rg_given` for `WITH ${invoiceRulesGiven(lines)} SELECT … FROM rg_given`.
 *
 * `lines` selects one row per invoice line with at least the columns `invoice_id, line_id, line_no,
 * order_line_id, variant_id, qty_pcs, free_qty_pcs, applied_rules`, and any other column of the line the caller
 * wants back (invoice number, date, shop, rate …), none of them named like a column below. `rg_given` has one row
 * per (invoice line, rule entry) carrying EVERY column of `lines` and `ord, rule, rule_id, kind, reward_kind,
 * is_reward, free_variant_id, has_amount, has_free, is_share, amount` (the entry's amount as written; `free_stored`
 * its free pieces as written), `amount_paise, free_qty` (the line's share, counted once per order line) and
 * `given_rule` (the entry as jsonb with those two figures in it).
 *
 * SPEED (blind check 2 of the prices lane). Every bill line is read ONCE: the lines are unfolded into their rule
 * entries, the copies of one rule on one order line are weighed and spread with window functions over that
 * stream, and nothing is joined back — the line's own columns travel with its entries, so a caller never joins
 * `rg_given` to `rg_lines` (the join the planner of a database never analysed turned into a nested loop that ran
 * the whole window pipeline once per bill line: 3 936 lines took 75 s where one pass takes milliseconds).
 * `rg_given` is MATERIALIZED, so even a join of it to a table (`schemes`) can never run the pipeline twice.
 */
export function invoiceRulesGiven(lines: SQL): SQL {
  return sql`rg_lines AS (${lines}),
  rg_entries AS (
    SELECT x.*,
           coalesce(x.order_line_id, x.line_id) AS grp,
           e.ord, e.rule,
           e.rule ->> 'ruleId' AS rule_id,
           coalesce(e.rule ->> 'kind', 'scheme') AS kind,
           e.rule ->> 'rewardKind' AS reward_kind,
           coalesce((e.rule ->> 'reward')::boolean, false) AS is_reward,
           coalesce(e.rule ->> 'freeVariantId', x.variant_id) AS free_variant_id,
           (e.rule -> 'amountPaise') IS NOT NULL AS has_amount,
           (e.rule -> 'freeQty') IS NOT NULL AS has_free,
           coalesce((e.rule ->> 'amountPaise')::bigint, 0) AS amount,
           coalesce((e.rule ->> 'freeQty')::bigint, 0) AS free_stored,
           coalesce((e.rule ->> 'batchShare')::boolean, false) AS is_share,
           x.qty_pcs::bigint AS w_amount,
           (CASE WHEN coalesce(e.rule ->> 'freeVariantId', x.variant_id) = x.variant_id
                 THEN x.free_qty_pcs ELSE x.qty_pcs END)::bigint AS w_free
      FROM rg_lines x
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(x.applied_rules, '[]'::jsonb))
           WITH ORDINALITY AS e(rule, ord)
     WHERE e.rule ->> 'ruleId' IS NOT NULL
  ),
  -- One rule entry on the batch lines of one order line is one group. A written share (is_share) is read as it
  -- is; a whole copy (written before 2026-09-29) is weighed against its group: the group's paid and free pieces.
  rg_weighed AS (
    SELECT r.*,
           (sum(r.w_amount) OVER g)::bigint AS wa_total,
           (sum(r.w_free) OVER g)::bigint AS wf_total,
           min(r.line_no) OVER g AS first_line
      FROM rg_entries r
    WINDOW g AS (PARTITION BY r.invoice_id, r.grp, r.ord, r.rule_id, r.is_share)
  ),
  rg_split AS (
    SELECT o.*,
           (abs(o.amount) * o.wa) / o.wat AS a_floor, (abs(o.amount) * o.wa) % o.wat AS a_rem,
           (abs(o.free_stored) * o.wf) / o.wft AS f_floor, (abs(o.free_stored) * o.wf) % o.wft AS f_rem
      FROM (
        SELECT r.*,
               (CASE WHEN r.wa_total > 0 THEN r.w_amount WHEN r.line_no = r.first_line THEN 1 ELSE 0 END)::bigint AS wa,
               greatest(r.wa_total, 1)::bigint AS wat,
               (CASE WHEN r.wf_total > 0 THEN r.w_free WHEN r.line_no = r.first_line THEN 1 ELSE 0 END)::bigint AS wf,
               greatest(r.wf_total, 1)::bigint AS wft
          FROM rg_weighed r
      ) o
  ),
  -- A copy's value is spread back over its batch lines by largest remainder (the remainders go to the largest
  -- fractions, ties to the lower line number).
  rg_counted AS (
    SELECT s.*,
           (CASE WHEN s.is_share THEN s.amount ELSE sign(s.amount) * (s.a_floor + CASE
              WHEN row_number() OVER (PARTITION BY s.invoice_id, s.grp, s.ord, s.rule_id, s.is_share
                                      ORDER BY s.a_rem DESC, s.line_no)
                   <= abs(s.amount) - sum(s.a_floor) OVER (PARTITION BY s.invoice_id, s.grp, s.ord, s.rule_id, s.is_share)
              THEN 1 ELSE 0 END) END)::bigint AS amount_paise,
           (CASE WHEN s.is_share THEN s.free_stored ELSE sign(s.free_stored) * (s.f_floor + CASE
              WHEN row_number() OVER (PARTITION BY s.invoice_id, s.grp, s.ord, s.rule_id, s.is_share
                                      ORDER BY s.f_rem DESC, s.line_no)
                   <= abs(s.free_stored) - sum(s.f_floor) OVER (PARTITION BY s.invoice_id, s.grp, s.ord, s.rule_id, s.is_share)
              THEN 1 ELSE 0 END) END)::bigint AS free_qty
      FROM rg_split s
  ),
  rg_given AS MATERIALIZED (
    SELECT c.*,
           (c.rule - 'amountPaise' - 'freeQty' - 'batchShare')
             || CASE WHEN c.has_amount THEN jsonb_build_object('amountPaise', c.amount_paise) ELSE '{}'::jsonb END
             || CASE WHEN c.has_free THEN jsonb_build_object('freeQty', c.free_qty) ELSE '{}'::jsonb END
             AS given_rule
      FROM rg_counted c
  )`
}

/**
 * The scheme money an invoice line's discount is made of: a scheme's own amount, not a gift's value, not a
 * cash-discount offer (reported, never deducted) and not a reward line's pointer. Over one bill these add up to
 * the bill's `discount_paise`.
 */
export const DISCOUNT_MONEY = sql`kind = 'scheme' AND NOT is_reward AND has_amount
      AND coalesce(reward_kind, '') NOT IN ('free_qty', 'cash_discount_pct')`

/** One bill whose scheme amounts and discount do not agree, and why. */
export interface SchemeAmountFault {
  tenantId: string
  tenantSlug: string
  invoiceId: string
  invoiceNo: string | null
  invoiceDate: string
  /** Σ `discount_paise` of the bill's lines. */
  discountPaise: number
  /** Σ of the scheme amounts as stored on the lines (whole copies counted as many times as they were written). */
  storedPaise: number
  /** Σ of the scheme amounts as every reader counts them: once per order line. */
  readPaise: number
  /**
   * `copies` — written before 2026-09-29 with the rule copied whole onto each batch line; the readers count it
   * once and get the discount: information only, the bill stays as issued.
   * `old_differs` — written before, and even counted once its rules are not its discount (a short pack of that
   * time billed less than the order line's rule): information, the readers count the order line's rule.
   * `differs` — written since, and its shares do not add up to its discount: a fault, the check fails.
   */
  status: 'copies' | 'old_differs' | 'differs'
}

interface FaultRow {
  tenant_id: string
  tenant_slug: string
  invoice_id: string
  invoice_no: string | null
  invoice_date: string
  discount_paise: string | number
  stored_paise: string | number
  read_paise: string | number
  shared: boolean
}

/**
 * Every live bill (issued, not cancelled) whose scheme amounts do not equal its discount, across all tenants or
 * one, read as the system role like every release check.
 */
export async function schemeAmountFaults(db: Db, tenantId?: string): Promise<SchemeAmountFault[]> {
  const tenant = tenantId ?? null
  const rows = await withSystem(db, async (tx) => {
    // One pass: every line of a live bill of ours gives its discount, every rule entry on it what was written and
    // what is read, and ONE grouping per bill adds them up — no aggregate joined back to the lines.
    const res = await tx.execute(sql`
      WITH ${invoiceRulesGiven(sql`
        SELECT l.invoice_id, l.id AS line_id, l.line_no, l.order_line_id, l.variant_id,
               l.qty_pcs, l.free_qty_pcs, l.applied_rules, l.discount_paise,
               i.tenant_id, t.slug AS tenant_slug, i.invoice_no, i.invoice_date
          FROM invoice_lines l
          JOIN invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
          JOIN tenants t ON t.id = i.tenant_id
         WHERE i.state NOT IN ('draft', 'cancelled')
           -- a bill of ours: an imported or brand-DMS bill carries the brand's discount and no rules of ours
           AND i.source IN ('pack', 'van_sale')
           AND (${tenant}::text IS NULL OR l.tenant_id = ${tenant})`)},
      per_bill AS (
        SELECT u.tenant_id, u.tenant_slug, u.invoice_id, u.invoice_no, u.invoice_date,
               sum(u.discount_paise) AS discount_paise, sum(u.stored_paise) AS stored_paise,
               sum(u.read_paise) AS read_paise, bool_or(u.shared) AS shared
          FROM (
            SELECT tenant_id, tenant_slug, invoice_id, invoice_no, invoice_date, discount_paise,
                   0::bigint AS stored_paise, 0::bigint AS read_paise, NULL::boolean AS shared
              FROM rg_lines
            UNION ALL
            SELECT tenant_id, tenant_slug, invoice_id, invoice_no, invoice_date, 0,
                   amount, amount_paise, is_share
              FROM rg_given WHERE ${DISCOUNT_MONEY}
          ) u
         GROUP BY u.tenant_id, u.tenant_slug, u.invoice_id, u.invoice_no, u.invoice_date
      )
      SELECT tenant_id, tenant_slug, invoice_id, invoice_no,
             to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date,
             discount_paise, stored_paise, read_paise, coalesce(shared, false) AS shared
        FROM per_bill
       WHERE stored_paise <> discount_paise OR read_paise <> discount_paise
       ORDER BY tenant_slug, per_bill.invoice_date, invoice_no`)
    return res.rows as unknown as FaultRow[]
  })
  return rows.map((r) => {
    const discountPaise = Number(r.discount_paise)
    const readPaise = Number(r.read_paise)
    const status: SchemeAmountFault['status'] = r.shared
      ? 'differs'
      : readPaise === discountPaise
        ? 'copies'
        : 'old_differs'
    return {
      tenantId: r.tenant_id,
      tenantSlug: r.tenant_slug,
      invoiceId: r.invoice_id,
      invoiceNo: r.invoice_no,
      invoiceDate: r.invoice_date,
      discountPaise,
      storedPaise: Number(r.stored_paise),
      readPaise,
      status,
    }
  })
}
