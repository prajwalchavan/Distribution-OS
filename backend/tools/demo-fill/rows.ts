import { DEMO_ID_LIKE } from './ids.js'

/**
 * THE MARKER CHECK's SQL (`check:demo-rows`), kept apart from the script so a spec runs the same queries.
 * Every query is a read, parameterised by `$1` = the tenant id and `$2` = the tool's id pattern
 * (`DEMO_ID_LIKE`), and returns counts or ids — never a name, a phone, a GSTIN or an address.
 *
 * Three parts:
 *  - KINDS: the rows the tool made, by kind, found by the tag in their id (brief rule 2), and the rows the
 *    API made FROM them (a bill from a pack, a credit note from a door that sent goods back, a journal
 *    entry), found through the tool's row they hang off;
 *  - RULE 3: no money of the tool — a receipt it recorded, a credit note on its bill or of its own — is put
 *    against a bill it did not make, and the opening bills carry nothing of the tool; RULE 3b (architect,
 *    2026-09-29), the other way round too, because the product applies money on account by itself (DOS-312): no
 *    receipt or credit note the tool did not make is on a bill it made, and no money of the tool sits on account
 *    with a shop that owes on a real bill;
 *  - RULE 7: the books are right — stock ledger = balances, every journal entry balances, and each shop's
 *    dues are its bills less its receipts, credit notes and write-offs, to the paisa, and agree with the
 *    ledger's receivables account.
 */

export { DEMO_ID_LIKE }

export interface KindQuery {
  kind: string
  /** The step names of the tool's summary that each make one row of this kind (`--expect`). */
  steps: readonly string[]
  sql: string
}

const tagged = (table: string): string =>
  `select count(*)::int as n from ${table} where tenant_id = $1 and id like $2`

/** Rows the tool names itself: one per write step. `--expect` compares these with the runs' reports. */
export const TOOL_KINDS: readonly KindQuery[] = [
  { kind: 'orders', steps: ['order taken'], sql: tagged('sales_orders') },
  { kind: 'trips', steps: ['trip planned'], sql: tagged('trips') },
  {
    kind: 'receipts',
    steps: [
      'paid cash',
      'paid upi',
      'paid cheque',
      'cheque at the counter',
      'payment to match',
      'old bills paid by transfer',
    ],
    sql: tagged('receipts'),
  },
  { kind: 'waves', steps: ['wave'], sql: tagged('picklists') },
  { kind: 'packs', steps: ['packed and billed'], sql: tagged('pack_confirmations') },
  { kind: 'load sheets', steps: ['load sheet', 'van to load'], sql: tagged('load_sheets') },
  { kind: 'challans', steps: ['van loaded'], sql: tagged('delivery_challans') },
  {
    kind: 'supplier bills',
    steps: ['supplier bill in review', 'supplier bill for the gate'],
    sql: tagged('supplier_invoices'),
  },
  { kind: 'goods receipts', steps: ['goods at the gate'], sql: tagged('grns') },
  { kind: 'shop visits', steps: ['shop visited'], sql: tagged('visits') },
  { kind: 'rate requests', steps: ['rate asked'], sql: tagged('bargain_requests') },
  { kind: 'returns raised', steps: ['return to approve'], sql: tagged('credit_notes') },
  { kind: 'offers', steps: ['offer'], sql: tagged('schemes') },
  { kind: 'vans', steps: ['van'], sql: tagged('vehicles') },
  { kind: 'beat assignments', steps: ['beat assignment'], sql: tagged('beat_assignments') },
  { kind: 'gps consents', steps: ['gps consent'], sql: tagged('location_consents') },
  { kind: 'tester logins', steps: ['tester login'], sql: tagged('memberships') },
  { kind: 'settlements', steps: ['trip settled'], sql: tagged('trip_settlements') },
]

/** The tool's orders, bills, receipts and credit notes, as SQL sets over `$1`/`$2`. */
const TOOL_ORDERS = `select id from sales_orders where tenant_id = $1 and id like $2`
const TOOL_BILLS = `select id from invoices where tenant_id = $1 and order_id like $2`
const TOOL_RECEIPTS = `select id from receipts where tenant_id = $1 and id like $2`
const TOOL_NOTES = `select id from credit_notes where tenant_id = $1 and (id like $2 or invoice_id in (${TOOL_BILLS}))`

/**
 * Rows the API made from the tool's rows (they carry the API's ids), and the real rows the tool's work
 * touches (a real supplier's pack setting, the real shops its offer is for, the shops a tester put on a
 * limit): reported, not compared. QA DOS-402 lists why no row of these can carry the tool's mark.
 */
export const DERIVED_KINDS: readonly { kind: string; sql: string }[] = [
  {
    kind: 'order lines',
    sql: `select count(*)::int as n from sales_order_lines where tenant_id = $1 and order_id in (${TOOL_ORDERS})`,
  },
  {
    kind: 'bills (issued at pack)',
    sql: `select count(*)::int as n from invoices where tenant_id = $1 and order_id like $2 and state <> 'cancelled'`,
  },
  {
    kind: 'doors (trip stops)',
    sql: `select count(*)::int as n from trip_stops where tenant_id = $1 and trip_id like $2`,
  },
  {
    kind: 'deliveries recorded',
    sql: `select count(*)::int as n from deliveries where tenant_id = $1 and trip_id like $2 and outcome is not null`,
  },
  {
    kind: 'credit notes (all, on tool bills)',
    sql: `select count(*)::int as n from credit_notes where tenant_id = $1 and invoice_id in (${TOOL_BILLS})`,
  },
  {
    kind: 'allocations of tool money',
    sql: `select count(*)::int as n from allocations where tenant_id = $1 and (receipt_id in (${TOOL_RECEIPTS}) or credit_note_id in (${TOOL_NOTES}))`,
  },
  {
    kind: 'approvals on tool orders',
    sql: `select count(*)::int as n from approvals where tenant_id = $1 and order_id in (${TOOL_ORDERS})`,
  },
  {
    kind: 'journal entries of tool rows',
    sql: `select count(*)::int as n from journal_entries where tenant_id = $1 and (ref_id like $2 or ref_id in (${TOOL_BILLS}) or ref_id in (${TOOL_NOTES}))`,
  },
  {
    kind: "lots received on the tool's goods receipts",
    sql: `select count(distinct lot_id)::int as n from grn_lines where tenant_id = $1 and grn_id like $2 and lot_id is not null`,
  },
  {
    kind: "purchase costs of the tool's lots",
    sql: `select count(*)::int as n from tenant_product_costs where tenant_id = $1 and updated_from_grn_id like $2`,
  },
  {
    // One row per supplier and item, kept (and overwritten) by the desk's "match this line": a real
    // supplier's pack setting the tool's bill taught or changed (DOS-402).
    kind: "supplier pack settings the tool's bills taught",
    sql: `select count(*)::int as n from supplier_pack_configs p
            where p.tenant_id = $1
              and exists (select 1 from supplier_invoice_lines l
                            join supplier_invoices s on s.id = l.supplier_invoice_id and s.tenant_id = l.tenant_id
                           where s.tenant_id = $1 and s.id like $2 and s.supplier_id = p.supplier_id
                             and l.variant_id = p.variant_id and l.supplier_code is not distinct from p.supplier_code)`,
  },
  {
    kind: "real shops the tool's offer is for",
    sql: `select count(distinct r.id)::int as n
            from schemes s cross join lateral jsonb_array_elements_text(coalesce(s.applicability->'retailerIds', '[]'::jsonb)) as r(id)
           where s.tenant_id = $1 and s.id like $2`,
  },
  {
    kind: 'shops whose credit terms a tester login set',
    sql: `select count(distinct entity_id)::int as n from audit_log a
            where a.tenant_id = $1 and a.action = 'retailer.set_credit'
              and a.actor_id in (select user_id from memberships where tenant_id = $1 and id like $2)`,
  },
]

export interface Violation {
  rule: string
  /** What is true when the query answers nothing. */
  holds: string
  /** What an id in the answer is. */
  what: string
  /** Up to five ids that show it (never names). */
  sql: string
}

/** Each query answers the offending ids; an empty answer is a pass. */
export const VIOLATIONS: readonly Violation[] = [
  {
    rule: '3',
    holds:
      "the tool's money (its receipts, the credit notes on its bills) is only against its own bills",
    what: "an allocation of the tool's money to a bill the tool did not make",
    sql: `select a.id from allocations a
           where a.tenant_id = $1
             and (a.receipt_id in (${TOOL_RECEIPTS}) or a.credit_note_id in (${TOOL_NOTES}))
             and a.invoice_id not in (${TOOL_BILLS})
           order by a.id limit 5`,
  },
  {
    rule: '3',
    holds: 'every credit note the tool raised is on a bill the tool made',
    what: 'a credit note the tool raised on a bill it did not make',
    sql: `select c.id from credit_notes c
           where c.tenant_id = $1 and c.id like $2 and c.invoice_id not in (${TOOL_BILLS})
           order by c.id limit 5`,
  },
  {
    // The product applies money on account to a shop's oldest open bills by itself (DOS-312), at a new bill, at a
    // receipt's remainder and at a credit note's: the tool never bills a shop holding money it did not put there.
    rule: '3b',
    holds:
      'no real money (a receipt or credit note the tool did not make) is on a bill the tool made',
    what: 'an allocation of money the tool did not make to a bill the tool made',
    sql: `select a.id from allocations a
           where a.tenant_id = $1
             and a.invoice_id in (${TOOL_BILLS})
             and ((a.receipt_id is not null and a.receipt_id not in (${TOOL_RECEIPTS}))
                  or (a.credit_note_id is not null and a.credit_note_id not in (${TOOL_NOTES})))
           order by a.id limit 5`,
  },
  {
    // ... and never leaves its own money on account where the product could apply it to a real bill: a shop with
    // an open bill the tool did not make, or a bill written off (money recovers that first, DOS-311).
    rule: '3b',
    holds:
      'no money of the tool sits on account with a shop that has an open or written-off bill the tool did not make',
    what: 'a receipt or credit note of the tool with money on account at a shop owing on a real bill',
    sql: `with free as (
              select r.retailer_id, r.id from receipts r
               where r.tenant_id = $1 and r.id like $2 and r.status in ('collected', 'deposited')
                 and r.amount_paise > 0 and r.reverses_receipt_id is null
                 and r.amount_paise + r.cash_discount_paise >
                     coalesce((select sum(a.amount_paise) from allocations a
                                where a.tenant_id = r.tenant_id and a.receipt_id = r.id), 0)
              union all
              select c.retailer_id, c.id from credit_notes c
               where c.tenant_id = $1 and c.id in (${TOOL_NOTES}) and c.state in ('issued', 'applied')
                 and c.total_paise >
                     coalesce((select sum(a.amount_paise) from allocations a
                                where a.tenant_id = c.tenant_id and a.credit_note_id = c.id), 0))
          select f.id from free f
           where exists (
             select 1 from invoices i
              where i.tenant_id = $1 and i.retailer_id = f.retailer_id
                and (i.order_id is null or i.order_id not like $2)
                and (i.state = 'written_off'
                     or (i.state in ('issued', 'partially_paid')
                         and i.total_paise > coalesce((select sum(a.amount_paise) from allocations a
                                                        where a.tenant_id = i.tenant_id and a.invoice_id = i.id), 0))))
           order by 1 limit 5`,
  },
  {
    rule: '3',
    holds: 'no opening bill carries money of the tool',
    what: 'an opening bill with money of the tool on it',
    sql: `select distinct i.id from invoices i join allocations a on a.invoice_id = i.id and a.tenant_id = i.tenant_id
           where i.tenant_id = $1 and i.order_id is null
             and (a.receipt_id in (${TOOL_RECEIPTS}) or a.credit_note_id in (${TOOL_NOTES}))
           order by i.id limit 5`,
  },
  {
    rule: '7',
    holds: 'every stock balance is the sum of its ledger rows',
    what: 'a stock balance that is not the sum of its ledger rows (lot@location)',
    sql: `with l as (select lot_id, location_id, sum(qty_delta)::bigint as q from stock_ledger where tenant_id = $1 group by 1, 2),
               b as (select lot_id, location_id, on_hand::bigint as q from stock_balances where tenant_id = $1)
          select coalesce(l.lot_id, b.lot_id) || '@' || coalesce(l.location_id, b.location_id) as id
            from l full join b on b.lot_id = l.lot_id and b.location_id = l.location_id
           where coalesce(l.q, 0) <> coalesce(b.q, 0)
           order by 1 limit 5`,
  },
  {
    rule: '7',
    holds: 'every journal entry balances',
    what: 'a journal entry whose lines do not sum to zero',
    sql: `select entry_id as id from journal_lines where tenant_id = $1
           group by entry_id having sum(amount_paise) <> 0 order by 1 limit 5`,
  },
  {
    rule: '7',
    holds:
      "every shop's dues are its bills less its receipts, credit notes and write-offs, to the paisa",
    what: 'a shop whose dues are not its bills less its receipts, credit notes and write-offs',
    sql: `with bills as (
              select retailer_id, sum(total_paise)::bigint as p from invoices
               where tenant_id = $1 and state in ('issued', 'partially_paid', 'paid', 'written_off') group by 1),
            paid as (
              select retailer_id, sum(amount_paise + cash_discount_paise)::bigint as p from receipts
               where tenant_id = $1 group by 1),
            notes as (
              select retailer_id, sum(total_paise)::bigint as p from credit_notes
               where tenant_id = $1 and state in ('issued', 'applied') group by 1),
            written as (
              select i.retailer_id, sum(a.amount_paise)::bigint as p from allocations a
                join invoices i on i.id = a.invoice_id and i.tenant_id = a.tenant_id
               where a.tenant_id = $1 and a.write_off_id is not null group by 1),
            shops as (
              select retailer_id from bills union select retailer_id from paid union select retailer_id from notes
              union select retailer_id from retailer_outstanding_summary where tenant_id = $1),
            dues as (
              select retailer_id, (outstanding_paise + undelivered_paise - unallocated_credit_paise)::bigint as p
                from retailer_outstanding_summary where tenant_id = $1)
          select s.retailer_id as id from shops s
            left join bills b using (retailer_id) left join paid r using (retailer_id)
            left join notes n using (retailer_id) left join written w using (retailer_id)
            left join dues d using (retailer_id)
           where coalesce(d.p, 0) <> coalesce(b.p, 0) - coalesce(r.p, 0) - coalesce(n.p, 0) - coalesce(w.p, 0)
           order by 1 limit 5`,
  },
  {
    rule: '7',
    holds: "the shops' dues add up to the ledger's receivables account",
    what: "the shops' dues do not add up to the ledger's receivables account",
    sql: `select 'receivables' as id
            where (select coalesce(sum(jl.amount_paise), 0) from journal_lines jl join accounts a on a.id = jl.account_id
                    where jl.tenant_id = $1 and a.code = 'AR')
               <> (select coalesce(sum(outstanding_paise + undelivered_paise - unallocated_credit_paise), 0)
                     from retailer_outstanding_summary where tenant_id = $1)`,
  },
]

/** What the opening bills look like: count and open value (to compare before and after a run). */
export const OPENING_BILLS_SQL = `
  select count(*)::int as bills,
         coalesce(sum(i.total_paise - coalesce(a.p, 0)), 0)::bigint as open_paise
    from invoices i
    left join lateral (select sum(amount_paise) as p from allocations x
                        where x.tenant_id = i.tenant_id and x.invoice_id = i.id) a on true
   where i.tenant_id = $1 and i.order_id is null and i.state <> 'cancelled'`

/**
 * Sum what the runs' reports (`fill:demo --report`) say they made, per kind of `TOOL_KINDS`. A report's
 * `made` is keyed `<section>:<step>`; a step that makes no row of its own (a door delivered, a wave
 * picked, money matched) is not counted.
 */
export function expectedFromReports(
  reports: readonly { made?: Record<string, number> }[],
): Map<string, number> {
  const kindOfStep = new Map<string, string>()
  for (const k of TOOL_KINDS) for (const step of k.steps) kindOfStep.set(step, k.kind)
  const out = new Map<string, number>(TOOL_KINDS.map((k) => [k.kind, 0]))
  for (const r of reports)
    for (const [key, n] of Object.entries(r.made ?? {})) {
      const step = key.slice(key.indexOf(':') + 1)
      const kind = kindOfStep.get(step)
      if (kind) out.set(kind, (out.get(kind) ?? 0) + n)
    }
  return out
}
