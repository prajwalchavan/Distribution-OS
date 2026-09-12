\pset footer on
\echo '#### CHECK 05 - invoices. Line (billing/invoices.service.ts): gross = rate_paise x qty_pcs; taxable = gross - discount; line_total = taxable + cgst + sgst + igst + cess.'
\echo '#### Header: subtotal = SUM(gross); discount, taxable, cgst, sgst, igst, cess = SUM(lines); total = taxable + taxes + round_off (one rounding per bill). source import = opening balance, no lines.'
\echo '#### Payment state (receivables/allocation.ts): allocated <= 0 -> issued; 0 < allocated < total -> partially_paid; allocated >= total -> paid; written_off via its own event.'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 05a. header vs lines per tenant and source (non-draft, source <> import)'
with ln as (
  select tenant_id, invoice_id, count(*) as n,
         sum(qty_pcs::bigint * rate_paise)::bigint as gross, sum(discount_paise)::bigint as disc, sum(taxable_paise)::bigint as taxable,
         sum(cgst_paise)::bigint as cgst, sum(sgst_paise)::bigint as sgst, sum(igst_paise)::bigint as igst, sum(cess_paise)::bigint as cess,
         count(*) filter (where taxable_paise <> qty_pcs::bigint * rate_paise - discount_paise) as lines_taxable_ne_rate_qty_disc,
         count(*) filter (where line_total_paise <> taxable_paise + cgst_paise + sgst_paise + igst_paise + cess_paise) as lines_total_ne_parts
    from invoice_lines group by 1, 2
)
select t.slug, i.source, count(*) as invoices,
       count(*) filter (where ln.n is null) as without_lines,
       count(*) filter (where i.subtotal_paise <> coalesce(ln.gross, 0)) as subtotal_ne_sum_rate_x_qty,
       count(*) filter (where i.discount_paise <> coalesce(ln.disc, 0)) as discount_ne_lines,
       count(*) filter (where i.taxable_paise <> coalesce(ln.taxable, 0)) as taxable_ne_lines,
       count(*) filter (where i.cgst_paise <> coalesce(ln.cgst, 0) or i.sgst_paise <> coalesce(ln.sgst, 0)
                          or i.igst_paise <> coalesce(ln.igst, 0) or i.cess_paise <> coalesce(ln.cess, 0)) as gst_ne_lines,
       count(*) filter (where i.total_paise <> i.taxable_paise + i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise + i.round_off_paise) as total_ne_parts,
       count(*) filter (where abs(i.round_off_paise) > 50) as round_off_over_50,
       count(*) filter (where i.total_paise % 100 <> 0) as total_not_whole_rupee,
       count(*) filter (where i.subtotal_paise - i.discount_paise <> i.taxable_paise) as subtotal_minus_discount_ne_taxable,
       coalesce(sum(ln.lines_taxable_ne_rate_qty_disc), 0) as lines_taxable_ne_rate_qty_disc,
       coalesce(sum(ln.lines_total_ne_parts), 0) as lines_total_ne_parts,
       count(*) filter (where i.is_inter_state and (i.cgst_paise <> 0 or i.sgst_paise <> 0)) as inter_state_with_cgst_sgst,
       count(*) filter (where not i.is_inter_state and i.igst_paise <> 0) as intra_state_with_igst
  from invoices i
  left join ln on ln.tenant_id = i.tenant_id and ln.invoice_id = i.id
  join tenants t on t.id = i.tenant_id
 where i.state <> 'draft' and i.source <> 'import'
 group by 1, 2 order by 1, 2;

\echo '== 05a2. opening-balance bills (source import): no lines expected; total = subtotal - discount + taxes + round_off'
select t.slug, count(*) as invoices,
       count(*) filter (where exists (select 1 from invoice_lines il where il.invoice_id = i.id)) as with_lines,
       count(*) filter (where i.total_paise <> i.subtotal_paise - i.discount_paise + i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise + i.round_off_paise) as total_ne_parts,
       count(*) filter (where i.total_paise <= 0) as non_positive_total
  from invoices i join tenants t on t.id = i.tenant_id
 where i.source = 'import' group by 1 order by 1;

\echo '== 05b. examples of header <> lines (up to 10, newest first)'
with ln as (
  select tenant_id, invoice_id, count(*) as n,
         sum(qty_pcs::bigint * rate_paise)::bigint as gross, sum(discount_paise)::bigint as disc, sum(taxable_paise)::bigint as taxable,
         sum(cgst_paise + sgst_paise + igst_paise + cess_paise)::bigint as taxes
    from invoice_lines group by 1, 2
)
select t.slug, i.invoice_no, i.source, i.state, i.created_at, i.subtotal_paise, ln.gross as lines_gross, i.discount_paise, ln.disc as lines_disc,
       i.taxable_paise, ln.taxable as lines_taxable, i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise as header_taxes, ln.taxes as lines_taxes,
       i.round_off_paise, i.total_paise
  from invoices i
  left join ln on ln.tenant_id = i.tenant_id and ln.invoice_id = i.id
  join tenants t on t.id = i.tenant_id
 where i.state <> 'draft' and i.source <> 'import'
   and (ln.n is null or i.subtotal_paise <> ln.gross or i.discount_paise <> ln.disc or i.taxable_paise <> ln.taxable
        or i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise <> ln.taxes
        or i.total_paise <> i.taxable_paise + i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise + i.round_off_paise
        or abs(i.round_off_paise) > 50)
 order by i.created_at desc limit 10;

\echo '== 05c. payment state vs allocations (receipts + credit notes + write-offs), per tenant and state'
with al as (
  select tenant_id, invoice_id, count(*) as n, sum(amount_paise)::bigint as allocated,
         coalesce(sum(amount_paise) filter (where write_off_id is not null), 0)::bigint as by_write_off
    from allocations group by 1, 2
)
select t.slug, i.state, count(*) as invoices, sum(i.total_paise)::bigint as total, sum(coalesce(al.allocated, 0))::bigint as allocated,
       count(*) filter (where i.state = 'issued' and coalesce(al.allocated, 0) > 0) as issued_with_money_applied,
       count(*) filter (where i.state = 'partially_paid' and not (coalesce(al.allocated, 0) > 0 and coalesce(al.allocated, 0) < i.total_paise)) as partially_paid_inconsistent,
       count(*) filter (where i.state = 'paid' and coalesce(al.allocated, 0) < i.total_paise) as paid_but_short,
       count(*) filter (where i.state = 'written_off' and coalesce(al.allocated, 0) <> i.total_paise) as written_off_not_closed,
       count(*) filter (where i.state = 'written_off' and coalesce(al.by_write_off, 0) = 0) as written_off_without_write_off,
       count(*) filter (where coalesce(al.allocated, 0) > i.total_paise) as over_allocated,
       count(*) filter (where coalesce(al.allocated, 0) < 0) as net_negative_allocation,
       count(*) filter (where i.state = 'cancelled' and coalesce(al.n, 0) > 0) as cancelled_with_allocations,
       count(*) filter (where i.state = 'cancelled' and i.invoice_no is null) as cancelled_without_number,
       count(*) filter (where i.invoice_no is null) as without_number
  from invoices i
  left join al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
  join tenants t on t.id = i.tenant_id
 group by 1, 2 order by 1, 2;

\echo '== 05d. examples of payment-state breaks (up to 10)'
with al as (
  select tenant_id, invoice_id, count(*) as n, sum(amount_paise)::bigint as allocated from allocations group by 1, 2
)
select t.slug, i.invoice_no, i.state, i.total_paise, coalesce(al.allocated, 0) as allocated, coalesce(al.n, 0) as allocation_rows, i.updated_at
  from invoices i
  left join al on al.tenant_id = i.tenant_id and al.invoice_id = i.id
  join tenants t on t.id = i.tenant_id
 where (i.state = 'issued' and coalesce(al.allocated, 0) > 0)
    or (i.state = 'partially_paid' and not (coalesce(al.allocated, 0) > 0 and coalesce(al.allocated, 0) < i.total_paise))
    or (i.state = 'paid' and coalesce(al.allocated, 0) < i.total_paise)
    or (i.state = 'written_off' and coalesce(al.allocated, 0) <> i.total_paise)
    or coalesce(al.allocated, 0) > i.total_paise or coalesce(al.allocated, 0) < 0
    or (i.state = 'cancelled' and coalesce(al.n, 0) > 0)
 order by i.updated_at desc limit 10;

\echo '== 05e. cancelled bills: keep their number, carry no allocations, restock reversal and journal reversal present'
select t.slug, i.invoice_no, i.state, i.cancelled_at, i.cancel_reason,
       (select count(*) from allocations a where a.tenant_id = i.tenant_id and a.invoice_id = i.id) as allocations,
       (select count(*) from journal_entries je where je.tenant_id = i.tenant_id and je.ref_type = 'invoice_cancel' and je.ref_id = i.id) as cancel_entries,
       (select coalesce(sum(qty_delta), 0) from stock_ledger sl where sl.tenant_id = i.tenant_id and sl.ref_type = 'invoice_cancel' and sl.ref_id = i.id) as restocked_pcs,
       (select coalesce(sum(qty_pcs + free_qty_pcs), 0) from invoice_lines il where il.tenant_id = i.tenant_id and il.invoice_id = i.id and il.lot_id is not null) as billed_pcs_with_lot
  from invoices i join tenants t on t.id = i.tenant_id
 where i.state = 'cancelled' order by 1;

\echo '== 05f. duplicate invoice numbers per (tenant, series, fy)'
select count(*) as duplicate_number_groups
  from (select 1 from invoices where invoice_no is not null group by tenant_id, series_code, fy, invoice_no having count(*) > 1) d;
COMMIT;
