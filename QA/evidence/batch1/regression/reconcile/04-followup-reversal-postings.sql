\pset footer on
\echo '#### FOLLOW-UP to 04f: receipt reversals with no receipt_reversal entry - where were they posted, and by whom (seed or product)?'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;
select t.slug, rv.receipt_no, rv.amount_paise, rv.cash_discount_paise, rv.created_at, o.receipt_no as original_no, o.status as original_status,
       (select string_agg(je.ref_type || ' AR=' || coalesce((select sum(jl.amount_paise) from journal_lines jl join accounts a on a.id = jl.account_id where jl.entry_id = je.id and a.code = 'AR'), 0), ', ')
          from journal_entries je where je.tenant_id = rv.tenant_id and je.ref_id = rv.id) as entries_on_reversal_id,
       (select string_agg(je.ref_type || ' AR=' || coalesce((select sum(jl.amount_paise) from journal_lines jl join accounts a on a.id = jl.account_id where jl.entry_id = je.id and a.code = 'AR'), 0)
                          || case when je.reversed_by_entry_id is not null then ' (marked reversed)' else '' end, ', ')
          from journal_entries je where je.tenant_id = o.tenant_id and je.ref_id = o.id) as entries_on_original_id
  from receipts rv join receipts o on o.id = rv.reverses_receipt_id join tenants t on t.id = rv.tenant_id
 order by 1, rv.created_at;
select count(*) as reversals, count(*) filter (where created_at >= timestamptz '2026-09-12 12:52:00+05:30') as created_after_seed
  from receipts where reverses_receipt_id is not null;
\echo '== f04b. claims posted more than once (04d): ref types and AR effect'
select t.slug, je.ref_id, count(*) as entries, string_agg(je.narration, ' | ') as narrations,
       sum((select coalesce(sum(jl.amount_paise), 0) from journal_lines jl join accounts a on a.id = jl.account_id where jl.entry_id = je.id and a.code = 'AR')) as ar_effect
  from journal_entries je join tenants t on t.id = je.tenant_id
 where je.ref_type = 'claim' and (je.tenant_id, je.ref_id) in (select tenant_id, ref_id from journal_entries where ref_type = 'claim' group by 1, 2 having count(*) > 1)
 group by 1, 2 order by 1;
COMMIT;
