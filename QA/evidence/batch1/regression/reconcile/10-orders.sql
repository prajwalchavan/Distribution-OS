\pset footer on
\echo '#### CHECK 10 - orders. Pricing (orders/pricing-lines.ts): line_total = taxable + tax; header subtotal = SUM(gross), discount = SUM(line discount), tax = SUM(line tax), total = round(subtotal - discount + tax) with round_off.'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
select now() as snapshot_at;

\echo '== 10a. header vs lines per tenant'
with ln as (
  select tenant_id, order_id, count(*) as n, sum(tax_paise)::bigint as tax, sum(discount_paise)::bigint as disc,
         sum(line_total_paise - tax_paise)::bigint as taxable, sum(line_total_paise)::bigint as line_total
    from sales_order_lines group by 1, 2
)
select t.slug, count(*) as orders,
       count(*) filter (where ln.n is null) as without_lines,
       count(*) filter (where ln.n is null and o.state <> 'draft') as non_draft_without_lines,
       count(*) filter (where o.tax_paise <> coalesce(ln.tax, 0)) as tax_ne_lines,
       count(*) filter (where o.discount_paise <> coalesce(ln.disc, 0)) as discount_ne_lines,
       count(*) filter (where o.subtotal_paise - o.discount_paise <> coalesce(ln.taxable, 0)) as taxable_ne_lines,
       count(*) filter (where o.total_paise <> o.subtotal_paise - o.discount_paise + o.tax_paise + o.round_off_paise) as total_ne_parts,
       count(*) filter (where abs(o.round_off_paise) > 50) as round_off_over_50,
       count(*) filter (where o.total_paise % 100 <> 0) as total_not_whole_rupee
  from sales_orders o
  left join ln on ln.tenant_id = o.tenant_id and ln.order_id = o.id
  join tenants t on t.id = o.tenant_id
 group by 1 order by 1;
\echo '== 10b. examples of header <> lines (up to 10)'
with ln as (
  select tenant_id, order_id, count(*) as n, sum(tax_paise)::bigint as tax, sum(discount_paise)::bigint as disc,
         sum(line_total_paise - tax_paise)::bigint as taxable
    from sales_order_lines group by 1, 2
)
select t.slug, o.order_no, o.state, o.created_at, o.subtotal_paise, o.discount_paise, o.tax_paise, o.round_off_paise, o.total_paise,
       ln.n as lines, ln.taxable as lines_taxable, ln.disc as lines_discount, ln.tax as lines_tax
  from sales_orders o
  left join ln on ln.tenant_id = o.tenant_id and ln.order_id = o.id
  join tenants t on t.id = o.tenant_id
 where o.tax_paise <> coalesce(ln.tax, 0) or o.discount_paise <> coalesce(ln.disc, 0)
    or o.subtotal_paise - o.discount_paise <> coalesce(ln.taxable, 0)
    or o.total_paise <> o.subtotal_paise - o.discount_paise + o.tax_paise + o.round_off_paise
    or abs(o.round_off_paise) > 50
 order by o.created_at desc limit 10;

\echo '== 10c. state reachable through order_state_transitions: chain starts at draft, each from_state = previous to_state, each edge exists in orderMachine, last to_state = sales_orders.state'
\echo '   ordering: occurred_at, then from_state enum order, then id'
with edges(from_state, to_state) as (
  values ('draft', 'submitted'), ('draft', 'cancelled'), ('submitted', 'confirmed'), ('submitted', 'cancelled'),
         ('confirmed', 'picking'), ('confirmed', 'cancelled'), ('picking', 'packed'), ('packed', 'dispatched'),
         ('dispatched', 'delivered'), ('dispatched', 'partially_delivered'), ('dispatched', 'packed'),
         ('delivered', 'closed'), ('partially_delivered', 'closed')
), tr as (
  select ost.id, ost.tenant_id, ost.order_id, ost.from_state::text as from_state, ost.to_state::text as to_state,
         lag(ost.to_state::text) over w as prev_to,
         row_number() over w as rn,
         row_number() over (partition by ost.order_id order by ost.occurred_at desc, ost.from_state desc nulls last, ost.id desc) as rn_desc
    from order_state_transitions ost
  window w as (partition by ost.order_id order by ost.occurred_at, ost.from_state nulls first, ost.id)
), per as (
  select o.tenant_id, o.id, o.order_no, o.state::text as state,
         count(tr.id) as transitions,
         count(*) filter (where tr.rn = 1 and tr.from_state is distinct from 'draft') as bad_start,
         count(*) filter (where tr.rn > 1 and tr.from_state is distinct from tr.prev_to) as broken_links,
         count(*) filter (where tr.id is not null and not exists (select 1 from edges e where e.from_state = tr.from_state and e.to_state = tr.to_state)) as illegal_edges,
         max(tr.to_state) filter (where tr.rn_desc = 1) as last_to
    from sales_orders o left join tr on tr.order_id = o.id and tr.tenant_id = o.tenant_id
   group by 1, 2, 3, 4
)
select t.slug, count(*) as orders,
       count(*) filter (where per.transitions = 0 and per.state <> 'draft') as non_draft_without_transitions,
       count(*) filter (where per.bad_start > 0) as chain_not_starting_at_draft,
       count(*) filter (where per.broken_links > 0) as chain_broken,
       count(*) filter (where per.illegal_edges > 0) as illegal_edge,
       count(*) filter (where per.transitions > 0 and per.last_to <> per.state) as last_transition_ne_state,
       (array_agg(coalesce(per.order_no, left(per.id, 8))) filter (where (per.transitions = 0 and per.state <> 'draft') or per.bad_start > 0
          or per.broken_links > 0 or per.illegal_edges > 0 or (per.transitions > 0 and per.last_to <> per.state)))[1:5] as examples
  from per join tenants t on t.id = per.tenant_id
 group by 1 order by 1;

\echo '== 10d. transitions whose tenant differs from the order, or that point at a missing order'
select count(*) as transitions,
       count(*) filter (where o.id is null) as without_order,
       count(*) filter (where o.id is not null and o.tenant_id <> ost.tenant_id) as other_tenant
  from order_state_transitions ost left join sales_orders o on o.id = ost.order_id;

\echo '== 10e. KNOWN DOS-115: the probe cancels SO-0889 and SO-0891 (tarsun) - state, cancel transition actor, reservations by state, holds still on the balance'
select o.order_no, o.state, o.cancelled_at, o.cancel_reason,
       (select string_agg(ost.event || ' by ' || left(ost.actor_id, 8) || ' at ' || to_char(ost.occurred_at at time zone 'Asia/Kolkata', 'HH24:MI:SS'), ', ' order by ost.occurred_at)
          from order_state_transitions ost where ost.order_id = o.id and ost.tenant_id = o.tenant_id) as transitions,
       (select count(*) from sales_order_lines l where l.order_id = o.id and l.tenant_id = o.tenant_id) as lines,
       (select count(*) filter (where r.state = 'pending') from sales_order_lines l join reservations r on r.order_line_id = l.id and r.tenant_id = l.tenant_id where l.order_id = o.id) as pending,
       (select count(*) filter (where r.state = 'voided') from sales_order_lines l join reservations r on r.order_line_id = l.id and r.tenant_id = l.tenant_id where l.order_id = o.id) as voided,
       (select count(*) filter (where r.state = 'posted') from sales_order_lines l join reservations r on r.order_line_id = l.id and r.tenant_id = l.tenant_id where l.order_id = o.id) as posted,
       (select coalesce(sum(r.qty), 0) from sales_order_lines l join reservations r on r.order_line_id = l.id and r.tenant_id = l.tenant_id where l.order_id = o.id and r.state = 'voided') as voided_pcs
  from sales_orders o join tenants t on t.id = o.tenant_id
 where t.slug = 'tarsun' and o.order_no in ('SO-0889', 'SO-0891', 'SO-0893')
 order by o.order_no;
COMMIT;
