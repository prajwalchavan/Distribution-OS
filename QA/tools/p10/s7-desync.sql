-- S7 — three lifecycles that contradict each other (order / delivery / invoice), tenant tarsun. Each query lists the rows,
-- split into the fresh seed's (created before the first QA p10 scenario, 2026-09-28 08:07:59 IST) and this lane's.
\set T '''01a0999a-28c3-7341-93f5-e0e84b0189a1'''
\set cut '''2026-09-28 08:07:59+05:30'''
\echo '--- D1 bill paid / partially paid while its order is cancelled'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, i.invoice_no, i.state, o.order_no, o.state order_state
from invoices i join sales_orders o on o.id = i.order_id where i.tenant_id = :T and i.state in ('paid', 'partially_paid') and o.state = 'cancelled';
\echo '--- D2 bill cancelled while its order is not cancelled'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, i.invoice_no, o.order_no, o.state order_state
from invoices i join sales_orders o on o.id = i.order_id where i.tenant_id = :T and i.state = 'cancelled' and o.state <> 'cancelled';
\echo '--- D3 order delivered / partially delivered with no delivered or partial door for it'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, o.order_no, o.state,
  (select string_agg(coalesce(d.outcome::text, 'no outcome'), ',') from deliveries d where d.order_id = o.id) doors
from sales_orders o where o.tenant_id = :T and o.state in ('delivered', 'partially_delivered') and o.source <> 'van_sale'
  and not exists (select 1 from deliveries d where d.order_id = o.id and d.outcome in ('delivered', 'partial'));
\echo '--- D4 stop delivered / partial while an order on it is not delivered'
select case when s.created_at < :cut then 'seed' else 'qa' end origin, t.trip_no, s.sequence, s.state stop_state, o.order_no, o.state order_state, d.outcome
from trip_stops s join trips t on t.id = s.trip_id join deliveries d on d.stop_id = s.id join sales_orders o on o.id = d.order_id
where s.tenant_id = :T and s.state in ('delivered', 'partial') and d.outcome in ('delivered', 'partial') and o.state not in ('delivered', 'partially_delivered', 'closed');
\echo '--- D5 a bill still "out" (door with no outcome) on a trip that is settled, cancelled or closing'
select case when t.created_at < :cut then 'seed' else 'qa' end origin, t.trip_no, t.state trip_state, i.invoice_no, o.state order_state
from deliveries d join trips t on t.id = d.trip_id join invoices i on i.id = d.invoice_id left join sales_orders o on o.id = d.order_id
where d.tenant_id = :T and d.outcome is null and t.state in ('settled', 'settled_with_variance', 'cancelled', 'closing');
\echo '--- D6 order dispatched but on no active trip (no door for it on a trip that is loading or active)'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, o.order_no, o.state,
  (select string_agg(t.trip_no || ':' || t.state, ',') from deliveries d join trips t on t.id = d.trip_id where d.order_id = o.id) trips,
  (select string_agg(i.invoice_no || ':' || i.state, ',') from invoices i where i.order_id = o.id) bills
from sales_orders o where o.tenant_id = :T and o.state = 'dispatched'
  and not exists (select 1 from deliveries d join trips t on t.id = d.trip_id where d.order_id = o.id and t.state in ('loading', 'active'));
\echo '--- D7 order packed / dispatched / delivered with no live bill'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, o.order_no, o.state
from sales_orders o where o.tenant_id = :T and o.state in ('packed', 'dispatched', 'delivered', 'partially_delivered') and o.source <> 'van_sale'
  and not exists (select 1 from invoices i where i.order_id = o.id and i.state <> 'cancelled');
\echo '--- D8 bill flagged undelivered while its order is delivered'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, i.invoice_no, o.order_no, o.state
from invoices i join sales_orders o on o.id = i.order_id where i.tenant_id = :T and i.undelivered_at is not null and o.state in ('delivered', 'partially_delivered');
\echo '--- D9 order packed (came back) but its bill still sits on the dock with no hold and nothing on the dock for it'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, i.invoice_no, o.order_no, i.undelivered_at is not null undelivered,
  (select coalesce(sum(r.qty), 0) from reservations r join sales_order_lines ol on ol.id = r.order_line_id join locations loc on loc.id = r.location_id where ol.order_id = o.id and r.state = 'pending' and loc.kind = 'in_transit') dock_held
from sales_orders o join invoices i on i.order_id = o.id and i.state not in ('cancelled')
where o.tenant_id = :T and o.state = 'packed'
  and (select coalesce(sum(r.qty), 0) from reservations r join sales_order_lines ol on ol.id = r.order_line_id join locations loc on loc.id = r.location_id where ol.order_id = o.id and r.state = 'pending' and loc.kind = 'in_transit')
      < (select coalesce(sum(il.qty_pcs + il.free_qty_pcs), 0) from invoice_lines il where il.invoice_id = i.id);
\echo '--- D10 order state vs its own transition log (last to_state differs from the column)'
select case when o.created_at < :cut then 'seed' else 'qa' end origin, count(*) n
from sales_orders o join lateral (select t.to_state from order_state_transitions t where t.order_id = o.id order by t.occurred_at desc, t.id desc limit 1) last on true
where o.tenant_id = :T and last.to_state::text <> o.state::text group by 1;
