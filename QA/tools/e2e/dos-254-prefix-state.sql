-- Put dos_test_day7fix's Tarsun September back into the state the PRE-FIX rollup left it in (DOS-254):
-- daily_owner_stats gross of credit notes, daily_tenant_stats.credited_paise NULL (a row rolled before 0069),
-- owner_summary "Sales this month" gross. Test database only.
\set t '01a0999a-28c3-7341-93f5-e0e84b0189a1'
begin;
with lot_cost as (
  select distinct on (lot_id) lot_id,
         case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end as unit_cost
    from tenant_product_costs where tenant_id = :'t' and lot_id is not null
   order by lot_id, effective_from desc
), cost as (
  select distinct on (variant_id) variant_id,
         case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end as unit_cost
    from tenant_product_costs where tenant_id = :'t'
   order by variant_id, (lot_id is null) desc, effective_from desc
), back as (
  select cn.note_date as day,
         sum(cl.taxable_paise)::bigint as taxable,
         sum(case when cn.reason in ('short_delivery','return_saleable','return_damaged','cancellation') and cl.saleable
                  then cl.qty_pcs * coalesce(lc.unit_cost, c.unit_cost, 0) else 0 end)::bigint as restocked
    from credit_note_lines cl
    join credit_notes cn on cn.id = cl.credit_note_id and cn.tenant_id = cl.tenant_id
    join invoice_lines il on il.id = cl.invoice_line_id and il.tenant_id = cl.tenant_id
    left join lot_cost lc on lc.lot_id = il.lot_id
    left join cost c on c.variant_id = il.variant_id
   where cl.tenant_id = :'t' and cn.state in ('issued','applied') and cn.note_date between '2026-09-01' and '2026-09-26'
   group by 1
)
update daily_owner_stats o
   set net_sales_paise = o.net_sales_paise + b.taxable,
       cogs_paise = o.cogs_paise + b.restocked,
       gross_margin_paise = (o.net_sales_paise + b.taxable) - (o.cogs_paise + b.restocked)
  from back b
 where o.tenant_id = :'t' and o.day = b.day;
update daily_tenant_stats set credited_paise = null
 where tenant_id = :'t' and day between '2026-09-01' and '2026-09-26';
update owner_summary
   set mtd_sales_paise = (select sum(invoiced_paise) from daily_tenant_stats where tenant_id = :'t' and day between '2026-09-01' and '2026-09-27'),
       mtd_gross_margin_paise = (select sum(gross_margin_paise) from daily_owner_stats where tenant_id = :'t' and day between '2026-09-01' and '2026-09-27'),
       detail = detail - 'todayCreditedPaise' - 'mtdCreditedPaise'
 where tenant_id = :'t';
commit;
select 'pre-fix state' as what,
       (select mtd_sales_paise from owner_summary where tenant_id = :'t') as mtd_sales_gross,
       (select mtd_gross_margin_paise from owner_summary where tenant_id = :'t') as mtd_margin_gross,
       (select count(*) from daily_tenant_stats where tenant_id = :'t' and day between '2026-09-01' and '2026-09-26' and credited_paise is null) as days_marked_prefix,
       (select sum(total_paise) from credit_notes where tenant_id = :'t' and state in ('issued','applied') and note_date between '2026-09-01' and '2026-09-27') as sep_credited;
