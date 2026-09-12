\pset footer on
\echo '#### FOLLOW-UP to 06d: every numbering series in the pilot tenants - documents already numbered at or past the counter (below the 9000 fixture range).'
\echo '#### The next issues from such a series collide: receipts get a duplicate number (no unique index, DOS-032/059); invoices, credit notes and challans hit their unique index and the issuing transaction fails.'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;
with docs as (
  select tenant_id, series_code, fy, substring(invoice_no from '([0-9]+)$')::int as n, invoice_no as doc_no from invoices where invoice_no ~ '[0-9]+$'
  union all select tenant_id, series_code, fy, substring(credit_note_no from '([0-9]+)$')::int, credit_note_no from credit_notes where credit_note_no ~ '[0-9]+$'
  union all select tenant_id, series_code, fy, substring(challan_no from '([0-9]+)$')::int, challan_no from delivery_challans where challan_no ~ '[0-9]+$'
  union all select tenant_id, 'RCPT', null, substring(receipt_no from '([0-9]+)$')::int, receipt_no from receipts where receipt_no ~ '^RCPT-[0-9]+$'
  union all select tenant_id, 'SO', null, substring(order_no from '([0-9]+)$')::int, order_no from sales_orders where order_no ~ '^SO-[0-9]+$'
)
select t.slug, ns.series_code, ns.fy, ns.next_no,
       count(d.doc_no) as numbered_at_or_past_counter,
       (array_agg(d.doc_no order by d.n) filter (where d.doc_no is not null))[1:6] as numbers
  from numbering_series ns
  join tenants t on t.id = ns.tenant_id
  left join docs d on d.tenant_id = ns.tenant_id and d.series_code = ns.series_code and (d.fy is null or d.fy = ns.fy)
       and d.n >= ns.next_no and d.n < 9000
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies')
 group by 1, 2, 3, 4 order by 1, 2, 3;
COMMIT;
