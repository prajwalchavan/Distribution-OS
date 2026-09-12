\pset footer on
\echo '#### CHECK 04 - journals (ADR 0004). journal_lines.amount_paise is signed: debit +, credit -. An entry balances when SUM = 0.'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 04a. per tenant: entries, lines, unbalanced entries, headers with no lines (not DB-enforced by design, migration 0007 note 4)'
with e as (
  select je.tenant_id, je.id, coalesce(sum(jl.amount_paise), 0)::bigint as total, count(jl.id) as lines
    from journal_entries je left join journal_lines jl on jl.entry_id = je.id
   group by je.tenant_id, je.id
)
select t.slug, count(*) as entries, sum(e.lines) as lines,
       count(*) filter (where e.total <> 0) as unbalanced_entries,
       count(*) filter (where e.lines = 0) as entries_without_lines
  from e join tenants t on t.id = e.tenant_id group by 1 order by 1;
\echo '== 04b. examples of unbalanced entries or entries without lines (up to 10)'
with e as (
  select je.tenant_id, je.id, je.ref_type, je.ref_id, je.posted_at, coalesce(sum(jl.amount_paise), 0)::bigint as total, count(jl.id) as lines
    from journal_entries je left join journal_lines jl on jl.entry_id = je.id
   group by je.tenant_id, je.id, je.ref_type, je.ref_id, je.posted_at
)
select t.slug, e.id, e.ref_type, e.ref_id, e.posted_at, e.total, e.lines
  from e join tenants t on t.id = e.tenant_id where e.total <> 0 or e.lines = 0 order by e.posted_at desc limit 10;

\echo '== 04c. orphan and cross-tenant lines'
select count(*) as lines,
       count(*) filter (where je.id is null) as lines_without_entry,
       count(*) filter (where je.id is not null and je.tenant_id <> jl.tenant_id) as line_tenant_ne_entry_tenant,
       count(*) filter (where a.id is null) as lines_without_account,
       count(*) filter (where a.id is not null and a.tenant_id <> jl.tenant_id) as account_of_other_tenant
  from journal_lines jl
  left join journal_entries je on je.id = jl.entry_id
  left join accounts a on a.id = jl.account_id;

\echo '== 04d. duplicate idempotency keys; documents posted more than once under the same ref_type'
select count(*) as dup_idempotency_groups
  from (select 1 from journal_entries group by tenant_id, idempotency_key having count(*) > 1) d;
select t.slug, d.ref_type, count(*) as refs_with_more_than_one_entry
  from (select tenant_id, ref_type, ref_id from journal_entries group by 1, 2, 3 having count(*) > 1) d
  join tenants t on t.id = d.tenant_id group by 1, 2 order by 1, 2;

\echo '== 04e. trial balance per tenant (all lines must net to 0) and AR lines without a retailer party'
select t.slug, sum(jl.amount_paise)::bigint as trial_balance_paise,
       count(*) filter (where a.code = 'AR') as ar_lines,
       count(*) filter (where a.code = 'AR' and (jl.party_id is null or jl.party_type is distinct from 'retailer')) as ar_lines_without_retailer_party
  from journal_lines jl join accounts a on a.id = jl.account_id join tenants t on t.id = jl.tenant_id
 group by 1 order by 1;

\echo '== 04f. document tie-out: every money document has exactly one posting whose AR amount equals the document'
\echo '   invoice (not draft): ref invoice (source import: ref opening), AR = +total | cancelled invoice: ref invoice_cancel, AR = -total'
\echo '   credit note (issued/applied): AR = -total | receipt: ref receipt (reversal: receipt_reversal), AR = -(amount + cash discount) | write-off: AR = -amount'
with docs as (
  select i.tenant_id, 'invoice' as doc, i.id, i.invoice_no as doc_no,
         case when i.source = 'import' then 'opening' else 'invoice' end as ref_type, i.total_paise::bigint as expected_ar
    from invoices i where i.state <> 'draft'
  union all
  select i.tenant_id, 'invoice_cancel', i.id, i.invoice_no, 'invoice_cancel', -i.total_paise::bigint
    from invoices i where i.state = 'cancelled'
  union all
  select c.tenant_id, 'credit_note', c.id, c.credit_note_no, 'credit_note', -c.total_paise::bigint
    from credit_notes c where c.state in ('issued', 'applied')
  union all
  select r.tenant_id, case when r.reverses_receipt_id is null then 'receipt' else 'receipt_reversal' end, r.id, r.receipt_no,
         case when r.reverses_receipt_id is null then 'receipt' else 'receipt_reversal' end,
         -(r.amount_paise + r.cash_discount_paise)::bigint
    from receipts r
  union all
  select w.tenant_id, 'writeoff', w.id, null, 'writeoff', -w.amount_paise::bigint from write_offs w
), posted as (
  select je.tenant_id, je.ref_type, je.ref_id, count(distinct je.id) as entries,
         coalesce(sum(jl.amount_paise) filter (where a.code = 'AR'), 0)::bigint as ar
    from journal_entries je
    join journal_lines jl on jl.entry_id = je.id
    join accounts a on a.id = jl.account_id
   group by 1, 2, 3
)
select t.slug, d.doc, count(*) as documents,
       count(*) filter (where p.ref_id is null) as missing_entry,
       count(*) filter (where p.entries > 1) as more_than_one_entry,
       count(*) filter (where p.ref_id is not null and p.ar <> d.expected_ar) as ar_amount_ne_document,
       (array_agg(coalesce(d.doc_no, d.id)) filter (where p.ref_id is null or p.entries > 1 or p.ar <> d.expected_ar))[1:5] as examples
  from docs d
  left join posted p on p.tenant_id = d.tenant_id and p.ref_type = d.ref_type and p.ref_id = d.id
  join tenants t on t.id = d.tenant_id
 group by 1, 2 order by 1, 2;
COMMIT;
