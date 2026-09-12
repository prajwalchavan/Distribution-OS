-- Realistic demo seed: the invariants of REALISTIC-SEED-SPEC.md §5, run against a seeded database.
--
--   QA/tools/seed/verify-seed.sh            (DATABASE_URL from the environment, else the local dos)
--
-- Every check lands in a temp table as (check_name, tenant, expected, actual, ok); the per-tenant
-- checks run once for EVERY distributor in the database, the pilot-only ones name `tarsun`. The
-- script prints the table and then fails loudly if any `ok` is false. "Today" is the live day the
-- database was seeded on (`tenant_settings` `demo.anchor_date`), never the wall clock, so the
-- checks stay green on the day after the seed. I-48 is reported as a warning (never a failure) on
-- a database that has seen `pnpm smoke`. I-49 / I-50 (idempotency, runtime) are the shell wrapper's.
-- I-51 to I-62 are the realism and correctness items of the 2026-09-08 review (strike rate, schemes that
-- fire, an ageing book, own PANs, header = lines + round-off, rule sums, receipt modes, live-day stamps,
-- names, the Monday trip, the anchor). I-63 to I-82 are the second round (2026-09-12): DSO, the shape of
-- the ageing book, every distributor's own old book, field activity at beat scale, margins by category
-- and by month, the PAN column, expiry on the bill, beats that are places, a claims book, the
-- out-of-state party, names that match their shops, scheme spend, over-limit accounts and slow SKUs,
-- a live day that bills, tomorrow's trip on a working day, money never before its bill, and the
-- read-models tied to the ledgers.
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off

create temp table checks (
  check_name text,
  tenant text,
  expected text,
  actual text,
  ok boolean
);
create temp table anchor as
select t.id as tenant_id, t.slug,
       coalesce((select (s.value #>> '{}')::date from tenant_settings s
                  where s.tenant_id = t.id and s.key = 'demo.anchor_date'), current_date) as today
  from tenants t
 where t.slug in ('tarsun', 'sai-distributors', 'kalyan-agencies');

-- =========================================================================================== catalogue
insert into checks select 'I-1 sku count', 'global', '>= 150', count(*)::text, count(*) >= 150 from product_variants;
insert into checks select 'I-2 gst slabs', 'global', '4 slabs, cess >= 1',
       count(distinct gst_bps) filter (where gst_bps in (0, 500, 1200, 1800))::text || ' slabs, cess ' || count(*) filter (where cess_bps > 0),
       count(distinct gst_bps) filter (where gst_bps in (0, 500, 1200, 1800)) = 4 and count(*) filter (where cess_bps > 0) >= 1
  from hsn_rates;
insert into checks select 'I-3 lifecycle', 'global', 'discontinued >= 3, proposed >= 2, proposer set',
       format('%s / %s / %s unset',
              (select count(*) from product_variants where status = 'discontinued'),
              (select count(*) from product_variants where status = 'proposed'),
              (select count(*) from products where status = 'proposed' and proposed_by_tenant_id is null)),
       (select count(*) from product_variants where status = 'discontinued') >= 3
       and (select count(*) from product_variants where status = 'proposed') >= 2
       and (select count(*) from products where status = 'proposed' and proposed_by_tenant_id is null) = 0;
insert into checks select 'I-4 packs complete', 'global', '0', count(*)::text, count(*) = 0
  from product_variants v
 where not exists (select 1 from product_packs p where p.variant_id = v.id and p.level = 'piece')
    or not exists (select 1 from product_packs p where p.variant_id = v.id and p.level = 'case')
    or exists (select 1 from product_packs p where p.variant_id = v.id and p.level = 'case' and p.qty_in_parent <> v.default_case_size);
insert into checks select 'I-5 categories', 'global', '>= 7 categories, >= 8 variants in each named one',
       (select count(distinct category) from products)::text || ' categories; min ' || min(n),
       (select count(distinct category) from products) >= 7 and min(n) >= 8
  from (select c.name, (select count(*) from product_variants v join products p on p.id = v.product_id
                         where p.category = c.name or (c.name = 'Snacks%' and p.category like 'Snacks%')) n
          from (values ('Beverages'), ('Biscuits'), ('Dairy'), ('Household'), ('Packaged Food'), ('Personal Care'), ('Snacks%')) c(name)) x;
insert into checks select 'I-6 no orphan hsn', 'global', '0', count(*)::text, count(*) = 0
  from product_variants v where not exists (select 1 from hsn_rates r where r.hsn_code = v.hsn_code);

-- ============================================================================================= pricing
insert into checks select 'I-7 price coverage', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from tenant_products tp
      join price_lists pl on pl.tenant_id = tp.tenant_id and pl.is_default
     where tp.tenant_id = a.tenant_id and tp.listed
       and not exists (select 1 from price_list_items i
                        where i.tenant_id = tp.tenant_id and i.price_list_id = pl.id and i.variant_id = tp.variant_id)) x;
insert into checks select 'I-8 tier monotonicity', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from (
      select i.variant_id,
             max(i.rate_paise) filter (where pl.tier = 'A') a_rate,
             max(i.rate_paise) filter (where pl.tier = 'B') b_rate,
             max(i.rate_paise) filter (where pl.tier = 'C') c_rate,
             max(i.rate_paise) filter (where pl.is_default) d_rate
        from price_list_items i join price_lists pl on pl.id = i.price_list_id
       where i.tenant_id = a.tenant_id group by i.variant_id) r
     where coalesce(r.a_rate, 0) > coalesce(r.b_rate, r.a_rate, 0)
        or coalesce(r.b_rate, 0) > coalesce(r.c_rate, r.b_rate, 0)
        or coalesce(r.c_rate, 0) > coalesce(r.d_rate, r.c_rate, 0)) x;
insert into checks select 'I-9 scheme variety', 'tarsun', 'expired>=2 final>=1 slabs>=2 free>=2 cd>=2 order>=2 inactive>=1 boundary=1',
       format('%s %s %s %s %s %s %s %s', expired, fin, slabs, freeq, cd, ord, inactive, boundary),
       expired >= 2 and fin >= 1 and slabs >= 2 and freeq >= 2 and cd >= 2 and ord >= 2 and inactive >= 1 and boundary >= 1
  from (select count(*) filter (where s.valid_to < a.today) expired,
               count(*) filter (where s.final) fin,
               count(*) filter (where s.slabs is not null) slabs,
               count(*) filter (where s.reward_kind = 'free_qty') freeq,
               count(*) filter (where s.reward_kind = 'cash_discount_pct') cd,
               count(*) filter (where s.reward_kind = 'order_pct') ord,
               count(*) filter (where not s.active) inactive,
               count(*) filter (where s.valid_to = a.today + 2) boundary
          from schemes s join anchor a on a.tenant_id = s.tenant_id where a.slug = 'tarsun') x;
insert into checks select 'I-10 overrides', a.slug, 'final >= 1, unlisted 0',
       format('final %s, unlisted %s', x.fin, x.unlisted), x.fin >= 1 and x.unlisted = 0
  from anchor a cross join lateral (
    select count(*) filter (where o.final) fin,
           count(*) filter (where not exists (select 1 from tenant_products tp where tp.tenant_id = o.tenant_id and tp.variant_id = o.variant_id and tp.listed)) unlisted
      from retailer_price_overrides o where o.tenant_id = a.tenant_id) x;
insert into checks select 'I-11 bargains', 'tarsun', '5 statuses, approved rated, rejected decided',
       format('%s statuses, %s unrated, %s undecided', statuses, unrated, undecided),
       statuses = 5 and unrated = 0 and undecided = 0
  from (select count(distinct b.status) statuses,
               count(*) filter (where b.status in ('approved', 'auto_approved') and b.approved_rate_paise is null) unrated,
               count(*) filter (where b.status = 'rejected' and b.decided_by is null) undecided
          from bargain_requests b join anchor a on a.tenant_id = b.tenant_id where a.slug = 'tarsun') x;
insert into checks select 'I-12 scheme brands listed', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from schemes s
     where s.tenant_id = a.tenant_id and s.brand_id is not null
       and not exists (select 1 from tenant_brands tb where tb.tenant_id = s.tenant_id and tb.brand_id = s.brand_id)) x;
insert into checks select 'I-13 cash discount statuses', a.slug, 'open, lapsed, realised >= 1 each; realised named',
       format('%s / %s / %s, %s unnamed', o, l, r, unnamed), o >= 1 and l >= 1 and r >= 1 and unnamed = 0
  from anchor a cross join lateral (
    select count(*) filter (where status = 'open') o, count(*) filter (where status = 'lapsed') l,
           count(*) filter (where status = 'realised') r,
           count(*) filter (where status = 'realised' and realised_receipt_id is null) unnamed
      from cash_discount_conditions c where c.tenant_id = a.tenant_id) x;
insert into checks select 'I-14 exclusive scheme alone', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from invoice_lines l
     where l.tenant_id = a.tenant_id
       and exists (select 1 from schemes s where s.tenant_id = a.tenant_id and s.final
                    and l.applied_rules @> jsonb_build_array(jsonb_build_object('ruleId', s.id)))
       and jsonb_array_length(l.applied_rules) > 1) x;

-- =========================================================================================== retailers
insert into checks select 'I-15 archetype coverage', 'tarsun', 'inactive, blocked link, stop, PRE, ON, tier A >= 2',
       format('%s %s %s %s %s %s', inactive, blocked, stop, pre, ondel, tier_a),
       inactive >= 1 and blocked >= 1 and stop >= 1 and pre >= 1 and ondel >= 1 and tier_a >= 2
  from (select count(*) filter (where not r.active) inactive,
               (select count(*) from retailer_links rl where rl.tenant_id = a.tenant_id and rl.status = 'blocked') blocked,
               count(*) filter (where r.credit_mode = 'stop') stop,
               count(*) filter (where r.payment_terms = 'PRE') pre,
               count(*) filter (where r.payment_terms = 'ON') ondel,
               count(*) filter (where r.tier = 'A') tier_a
          from retailers r join anchor a on a.tenant_id = r.tenant_id where a.slug = 'tarsun' group by a.tenant_id) x;
insert into checks select 'I-16 new shops are new', a.slug, 'new shops with history: 0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    -- a brand-new shop: on the books with a limit of ten thousand and strict terms, never traded
    select count(*) n from retailers r
     where r.tenant_id = a.tenant_id and r.credit_limit_paise = 1000000 and r.credit_mode = 'strict' and r.active
       and (exists (select 1 from sales_orders o where o.retailer_id = r.id)
            or exists (select 1 from invoices i where i.retailer_id = r.id)
            or exists (select 1 from receipts x where x.retailer_id = r.id)
            or exists (select 1 from visits v where v.retailer_id = r.id))) x;
-- the near-limit archetype is there (>= 1: a book of this size has a couple more near the line), and no
-- account on strict or stop terms is past its limit
insert into checks select 'I-17 near the limit', a.slug, '>= 1 at 85-99 %, 0 over unless indicate',
       format('%s near, %s over', near, over_limit), near >= 1 and over_limit = 0
  from anchor a cross join lateral (
    select count(*) filter (where s.outstanding_paise between 0.85 * r.credit_limit_paise and 0.99 * r.credit_limit_paise) near,
           count(*) filter (where s.outstanding_paise > r.credit_limit_paise and r.credit_mode <> 'indicate') over_limit
      from retailer_outstanding_summary s join retailers r on r.id = s.retailer_id
     where s.tenant_id = a.tenant_id and r.credit_limit_paise > 0) x;
insert into checks select 'I-18 ageing buckets populated', a.slug, 'every bucket > 0, >= 2 shops in the last three',
       format('%s %s %s %s %s %s; shops %s %s %s', b1, b2, b3, b4, b5, b6, n4, n5, n6),
       b1 > 0 and b2 > 0 and b3 > 0 and b4 > 0 and b5 > 0 and b6 > 0 and n4 >= 2 and n5 >= 2 and n6 >= 2
  from anchor a cross join lateral (
    select sum(bucket_0_7_paise) b1, sum(bucket_8_15_paise) b2, sum(bucket_16_30_paise) b3,
           sum(bucket_31_60_paise) b4, sum(bucket_61_90_paise) b5, sum(bucket_90_plus_paise) b6,
           count(distinct retailer_id) filter (where bucket_31_60_paise > 0) n4,
           count(distinct retailer_id) filter (where bucket_61_90_paise > 0) n5,
           count(distinct retailer_id) filter (where bucket_90_plus_paise > 0) n6
      from ageing_snapshots s
     where s.tenant_id = a.tenant_id and s.as_of = (select max(as_of) from ageing_snapshots x where x.tenant_id = a.tenant_id)) x;
insert into checks select 'I-19 legacy roll-up', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from ageing_snapshots s where s.tenant_id = a.tenant_id
       and s.bucket_60_plus_paise <> s.bucket_61_90_paise + s.bucket_90_plus_paise) x;
insert into checks select 'I-20 shared shops', 'global', '>= 1 on three, >= 10 on two or more, 0 duplicate phones',
       format('%s on three, %s on two+, %s dup phones', three, two, dups), three >= 1 and two >= 10 and dups = 0
  from (select count(*) filter (where n = 3) three, count(*) filter (where n >= 2) two,
               (select count(*) from (select phone from retailer_identities group by phone having count(*) > 1) d) dups
          from (select ri.id, count(distinct rl.tenant_id) n from retailer_identities ri
                  join retailer_links rl on rl.identity_id = ri.id group by ri.id) s) x;
insert into checks select 'I-21 beats and pjp', a.slug, '0 shops without beat/pjp, 0 beats without assignment',
       format('%s shops, %s beats', shops, beats), shops = 0 and beats = 0
  from anchor a cross join lateral (
    -- the one out-of-state wholesaler (the IGST bill's buyer) is not on a beat, by design
    select (select count(*) from retailers r join tenants t on t.id = r.tenant_id
             where r.tenant_id = a.tenant_id and r.state_code = t.state_code
             and (r.beat_id is null or (select count(*) from pjp p where p.retailer_id = r.id) <> 1)) shops,
           (select count(*) from beats b where b.tenant_id = a.tenant_id
             and not exists (select 1 from beat_assignments ba where ba.beat_id = b.id)) beats) x;

-- =============================================================================================== staff
insert into checks select 'I-22 sign-ins intact', 'global', '8 of 8', count(*)::text || ' of 8', count(*) = 8
  from users u
 where u.username in ('sunil.tarsun', 'vikas.kadam', 'meena.joshi', 'rahul.deshmukh', 'dinesh.patil', 'ganesh.more', 'ramesh.gupta', 'dos.admin')
   and u.password_hash is not null and not u.must_change_password and u.status = 'active'
   and (u.username = 'dos.admin' or exists (select 1 from memberships m where m.user_id = u.id and m.status = 'active'));
insert into checks select 'I-23 role coverage', a.slug,
       case when a.slug = 'tarsun' then '>= 2 per role' else '>= 1 per role' end,
       format('o%s m%s a%s s%s w%s d%s', o, m, ac, s, w, d),
       least(o, m, ac, s, w, d) >= case when a.slug = 'tarsun' then 2 else 1 end
  from anchor a cross join lateral (
    select count(*) filter (where role = 'owner') o, count(*) filter (where role = 'manager') m,
           count(*) filter (where role = 'accountant') ac, count(*) filter (where role = 'salesperson') s,
           count(*) filter (where role = 'warehouse') w, count(*) filter (where role = 'delivery') d
      from memberships x where x.tenant_id = a.tenant_id) x;
insert into checks select 'I-24 credentials', 'global', '0', count(*)::text, count(*) = 0
  from users where username is null or password_hash is null;

-- =============================================================================================== stock
insert into checks select 'I-25 ledger = balances', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from (
      select l.lot_id, l.location_id, sum(l.qty_delta) ledger from stock_ledger l where l.tenant_id = a.tenant_id group by 1, 2) x
      full join (select * from stock_balances sb where sb.tenant_id = a.tenant_id) b
        on b.lot_id = x.lot_id and b.location_id = x.location_id
     where coalesce(x.ledger, 0) <> coalesce(b.on_hand, 0)) x;
insert into checks select 'I-26 non-negative', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from stock_balances b where b.tenant_id = a.tenant_id
       and ((b.on_hand < 0 and not b.negative_allowed) or b.reserved < 0)) x;
insert into checks select 'I-26b running balance never negative', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from (
      select sum(l.qty_delta) over (partition by l.lot_id, l.location_id order by l.occurred_at, l.id) run, l.location_id
        from stock_ledger l where l.tenant_id = a.tenant_id) r
      join locations loc on loc.id = r.location_id
     where r.run < 0 and loc.kind <> 'damaged') x;
insert into checks select 'I-27 ledger keys unique', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) - count(distinct idempotency_key) n from stock_ledger l where l.tenant_id = a.tenant_id) x;
insert into checks select 'I-28 expiry spread', a.slug, 'expired >= 3, near >= 8, fresh >= 50',
       format('%s / %s / %s', e, n, f), e >= 3 and n >= 8 and f >= 50
  from anchor a cross join lateral (
    select count(*) filter (where l.expiry_date < a.today) e,
           count(*) filter (where l.expiry_date between a.today and a.today + 30) n,
           count(*) filter (where l.expiry_date > a.today + 60) f
      from stock_lots l where l.tenant_id = a.tenant_id) x;
insert into checks select 'I-29 stock states', a.slug, 'zero >= 6, low >= 10, float >= 1, damaged lots >= 5',
       format('%s / %s / %s / %s', z, lo, fl, dmg), z >= 6 and lo >= 10 and fl >= 1 and dmg >= 5
  from anchor a cross join lateral (
    select count(*) filter (where g.on_hand = 0) z,
           count(*) filter (where g.on_hand > 0 and g.on_hand < v.default_case_size) lo,
           count(*) filter (where g.on_hand > 100 * v.default_case_size) fl,
           (select count(*) from stock_balances sb join locations loc on loc.id = sb.location_id
             where sb.tenant_id = a.tenant_id and loc.kind = 'damaged' and sb.on_hand > 0) dmg
      from (select l.variant_id, sum(sb.on_hand) on_hand
              from stock_balances sb join stock_lots l on l.id = sb.lot_id join locations loc on loc.id = sb.location_id
             where sb.tenant_id = a.tenant_id and loc.kind = 'warehouse' group by 1) g
      join product_variants v on v.id = g.variant_id) x;
insert into checks select 'I-30 grn = ledger', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from grn_lines gl
     where gl.tenant_id = a.tenant_id and gl.counted_qty_pcs > 0
       and not exists (select 1 from stock_ledger l where l.tenant_id = gl.tenant_id and l.reason = 'grn'
                        and l.lot_id = gl.lot_id and l.qty_delta = gl.counted_qty_pcs)) x;
insert into checks select 'I-31 lot uniqueness', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from (select variant_id, batch_no, mrp_paise from stock_lots l
                             where l.tenant_id = a.tenant_id group by 1, 2, 3 having count(*) > 1) d) x;

-- ============================================================================== orders, money, delivery
insert into checks select 'I-32 order states', a.slug, 'all nine >= 1, closed = 0',
       format('%s states, closed %s', states, closed), states = 9 and closed = 0
  from anchor a cross join lateral (
    select count(distinct o.state) filter (where o.state in ('draft', 'submitted', 'confirmed', 'picking', 'packed', 'dispatched', 'delivered', 'partially_delivered', 'cancelled')) states,
           count(*) filter (where o.state = 'closed') closed
      from sales_orders o where o.tenant_id = a.tenant_id) x;
insert into checks select 'I-33 invoice at pack or later', a.slug, '0 early bills, exactly 1 cancelled bill with a reason',
       format('%s early, %s cancelled', early, cancelled), early = 0 and cancelled = 1
  from anchor a cross join lateral (
    select count(*) filter (where o.state in ('draft', 'submitted', 'confirmed', 'picking', 'cancelled') and i.state <> 'cancelled') early,
           (select count(*) from invoices c where c.tenant_id = a.tenant_id and c.state = 'cancelled' and c.cancel_reason is not null) cancelled
      from invoices i join sales_orders o on o.id = i.order_id where i.tenant_id = a.tenant_id) x;
insert into checks select 'I-34 approvals matrix', 'tarsun', '10 pairs present, non-pending decided',
       format('%s pairs, %s undecided', pairs, undecided), pairs = 10 and undecided = 0
  from (select count(*) filter (where (kind, status) in (('credit_limit', 'pending'), ('credit_limit', 'approved'), ('credit_limit', 'rejected'),
                                                          ('bargain', 'pending'), ('bargain', 'approved'), ('bargain', 'rejected'), ('bargain', 'expired'),
                                                          ('below_floor', 'pending'), ('below_floor', 'approved'), ('below_floor', 'rejected'))) pairs,
               (select count(*) from approvals p join anchor a on a.tenant_id = p.tenant_id
                 where a.slug = 'tarsun' and p.status <> 'pending' and (p.decided_by is null or p.decided_at is null)) undecided
          from (select distinct kind::text, status::text from approvals p join anchor a on a.tenant_id = p.tenant_id where a.slug = 'tarsun') d) x;
insert into checks select 'I-35 rejection cancels', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from approvals p join sales_orders o on o.id = p.entity_id
     where p.tenant_id = a.tenant_id and p.status = 'rejected' and p.kind in ('credit_limit', 'bargain', 'below_floor')
       and (o.state <> 'cancelled' or o.cancel_reason is null)) x;
insert into checks select 'I-36 journals balance', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from (select entry_id from journal_lines jl where jl.tenant_id = a.tenant_id
                             group by entry_id having sum(amount_paise) <> 0) u) x;
insert into checks select 'I-37 books tie', a.slug, 'AR = outstanding - unallocated', format('%s = %s', ar, net), ar = net
  from anchor a cross join lateral (
    select (select coalesce(sum(jl.amount_paise), 0) from journal_lines jl join accounts ac on ac.id = jl.account_id
             where jl.tenant_id = a.tenant_id and ac.code = 'AR') ar,
           (select coalesce(sum(outstanding_paise - unallocated_credit_paise), 0) from retailer_outstanding_summary s
             where s.tenant_id = a.tenant_id) net) x;
insert into checks select 'I-38 allocations within bill', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from invoices i
     where i.tenant_id = a.tenant_id
       and (select coalesce(sum(al.amount_paise), 0) from allocations al where al.invoice_id = i.id) > i.total_paise) x;
insert into checks select 'I-39 receipt variety', a.slug, 'cash/upi/bank/cheque, collected+deposited+bounced (pilot), under-allocated >= 1, zero-allocated >= 1',
       format('%s modes, %s statuses, %s under, %s zero', modes, statuses, under, zero),
       modes >= 4 and statuses >= (case when a.slug = 'tarsun' then 3 else 1 end) and under >= 1 and zero >= 1
  from anchor a cross join lateral (
    select count(distinct r.mode) filter (where r.mode in ('cash', 'upi', 'bank_transfer', 'cheque')) modes,
           count(distinct r.status) filter (where r.status in ('collected', 'deposited', 'bounced')) statuses,
           count(*) filter (where r.amount_paise > 0 and al.allocated < r.amount_paise) under,
           count(*) filter (where r.amount_paise > 0 and al.allocated = 0) zero
      from receipts r
      left join lateral (select coalesce(sum(x.amount_paise), 0) allocated from allocations x where x.receipt_id = r.id) al on true
     where r.tenant_id = a.tenant_id) x;
insert into checks select 'I-40 credit notes', a.slug, 'short/return/rate >= 1 each, 0 over bill, 0 orphan',
       format('%s/%s/%s, %s over, %s orphan', short, ret, rate, over_bill, orphan), short >= 1 and ret >= 1 and rate >= 1 and over_bill = 0 and orphan = 0
  from anchor a cross join lateral (
    select count(*) filter (where c.reason = 'short_delivery') short,
           count(*) filter (where c.reason in ('return_damaged', 'return_saleable')) ret,
           count(*) filter (where c.reason = 'rate_difference') rate,
           count(*) filter (where i.id is not null and c.total_paise > i.total_paise) over_bill,
           count(*) filter (where i.id is null) orphan
      from credit_notes c left join invoices i on i.id = c.invoice_id where c.tenant_id = a.tenant_id) x;
insert into checks select 'I-41 trips', a.slug, 'active, planned, variance >= 1; variance approved; failed + partial stops with reasons',
       format('%s/%s/%s, %s unapproved, %s failed, %s partial, %s unexplained', act, pl, var, unapproved, failed, partial, unexplained),
       act >= 1 and pl >= 1 and var >= 1 and unapproved = 0 and failed >= 1 and partial >= 1 and unexplained = 0
  from anchor a cross join lateral (
    select count(*) filter (where t.state = 'active') act, count(*) filter (where t.state = 'planned') pl,
           count(*) filter (where t.state = 'settled_with_variance') var,
           count(*) filter (where t.state = 'settled_with_variance' and not exists (
             select 1 from approvals p where p.tenant_id = t.tenant_id and p.kind = 'trip_settlement' and p.status = 'approved' and p.entity_id = t.id)) unapproved,
           (select count(*) from trip_stops s where s.tenant_id = a.tenant_id and s.state = 'failed') failed,
           (select count(*) from trip_stops s where s.tenant_id = a.tenant_id and s.state = 'partial') partial,
           (select count(*) from trip_stops s where s.tenant_id = a.tenant_id and s.state in ('failed', 'partial') and s.failure_reason is null) unexplained
      from trips t where t.tenant_id = a.tenant_id) x;
insert into checks select 'I-42 delivery = order', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    -- a stop names its order through the delivery row written at the door
    select (select count(*) from sales_orders o where o.tenant_id = a.tenant_id and o.state = 'partially_delivered'
             and not exists (select 1 from deliveries d join trip_stops s on s.id = d.stop_id where d.order_id = o.id and s.state = 'partial'))
         + (select count(*) from trip_stops s join deliveries d on d.stop_id = s.id join sales_orders o on o.id = d.order_id
             where s.tenant_id = a.tenant_id and s.state = 'partial' and o.state <> 'partially_delivered') n) x;

-- ==================================================================================== history, live day
insert into checks select 'I-43 history span', a.slug,
       case a.slug when 'tarsun' then '>= 85 days' when 'sai-distributors' then '>= 55 days' else '>= 40 days' end || ', every one of 12 weeks billed',
       format('%s days, %s weeks', span, weeks),
       span >= (case a.slug when 'tarsun' then 85 when 'sai-distributors' then 55 else 40 end)
       and weeks >= least(12, ceil(span / 7.0))
  from anchor a cross join lateral (
    select (select max((coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date) - min((coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date)
              from sales_orders o where o.tenant_id = a.tenant_id) span,
           (select count(distinct date_trunc('week', i.invoice_date)) from invoices i
             where i.tenant_id = a.tenant_id and i.invoice_date > a.today - 84 and i.source = 'pack') weeks) x;
insert into checks select 'I-44 period comparison', a.slug, 'both > 0, differ by < 60 %',
       format('%s vs %s (%s %%)', recent, prior, round(100.0 * (recent - prior) / nullif(prior, 0))),
       recent > 0 and prior > 0 and abs(recent - prior) < 0.6 * prior
  from anchor a cross join lateral (
    select coalesce(sum(i.total_paise) filter (where i.invoice_date between a.today - 29 and a.today), 0) recent,
           coalesce(sum(i.total_paise) filter (where i.invoice_date between a.today - 59 and a.today - 30), 0) prior
      from invoices i where i.tenant_id = a.tenant_id and i.state <> 'cancelled' and i.source in ('pack', 'van_sale')) x
 where a.slug <> 'kalyan-agencies';   -- 45 days of history: the prior window is half empty by design
insert into checks select 'I-45 monthly margin positive', a.slug, '> 0', x.margin::text, x.margin > 0
  from anchor a cross join lateral (
    select coalesce(sum(il.taxable_paise - (il.qty_pcs + il.free_qty_pcs) * c.landed_cost_paise), 0) margin
      from invoice_lines il join invoices i on i.id = il.invoice_id
      join tenant_product_costs c on c.tenant_id = il.tenant_id and c.variant_id = il.variant_id
     where il.tenant_id = a.tenant_id and i.state <> 'cancelled'
       and date_trunc('month', i.invoice_date) = date_trunc('month', a.today)) x;
insert into checks select 'I-46 daily stats', a.slug, '0 missing days, 0 count mismatches',
       format('%s missing, %s mismatched', missing, mismatched), missing = 0 and mismatched = 0
  from anchor a cross join lateral (
    select count(*) filter (where s.day is null) missing,
           count(*) filter (where s.day is not null and s.orders_count <> d.n) mismatched
      from (select (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date as day, count(*) n
              from sales_orders o where o.tenant_id = a.tenant_id and o.state <> 'draft'
               and (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date > a.today - 21
             group by 1) d
      left join daily_tenant_stats s on s.tenant_id = a.tenant_id and s.day = d.day) x;
insert into checks select 'I-47 the live day', a.slug, 'pending >= 3 in >= 2 kinds, picking >= 1, active trip, draft >= 1, requested bargains >= 2',
       format('%s pending in %s kinds, %s picking, %s active, %s drafts, %s requested', pending, kinds, picking, active, drafts, requested),
       pending >= 3 and kinds >= 2 and picking >= 1 and active >= 1 and drafts >= 1 and requested >= 2
  from anchor a cross join lateral (
    select (select count(*) from approvals p where p.tenant_id = a.tenant_id and p.status = 'pending') pending,
           (select count(distinct p.kind) from approvals p where p.tenant_id = a.tenant_id and p.status = 'pending') kinds,
           (select count(*) from sales_orders o where o.tenant_id = a.tenant_id and o.state = 'picking'
             and exists (select 1 from picklists p where p.tenant_id = o.tenant_id and p.status = 'picking' and p.order_ids ? o.id::text)) picking,
           (select count(*) from trips t where t.tenant_id = a.tenant_id and t.state = 'active') active,
           (select count(*) from sales_orders o where o.tenant_id = a.tenant_id and o.state = 'draft') drafts,
           (select count(*) from bargain_requests b where b.tenant_id = a.tenant_id and b.status = 'requested') requested) x;
-- I-48 is a warning on the founder's database (a smoke run leaves probes behind until the database is recreated)
insert into checks select 'I-48 smoke leftovers (warning only)', a.slug, '0', x.n::text, true
  from anchor a cross join lateral (
    select (select count(*) from retailers r where r.tenant_id = a.tenant_id and (r.name ilike '%smoke%' or r.code ilike '%smoke%' or r.name ilike '%probe%'))
         + (select count(*) from locations l where l.tenant_id = a.tenant_id and l.name like 'Smoke Probe%')
         + (select count(*) from sales_orders o where o.tenant_id = a.tenant_id and o.cancel_reason ilike '%smoke%') n) x;

-- ================================================================ realism and correctness (2026-09-08 review)
-- I-51: a Kalyan rep converts roughly half to two thirds of the doors that were open. Productive = the
-- shop was open (ordered, no order, payment only); a shutter down or a wrong address is not a miss.
insert into checks select 'I-51 strike rate', a.slug, '45-70 % of productive visits ordered',
       format('%s %% (%s of %s)', x.pct, x.ordered, x.productive), x.pct between 45 and 70
  from anchor a cross join lateral (
    select count(*) filter (where v.outcome = 'ordered') ordered,
           count(*) filter (where v.outcome in ('ordered', 'no_order', 'payment_only')) productive,
           round(100.0 * count(*) filter (where v.outcome = 'ordered')
                 / nullif(count(*) filter (where v.outcome in ('ordered', 'no_order', 'payment_only')), 0), 1) pct
      from visits v where v.tenant_id = a.tenant_id) x;
-- I-52: schemes fire on the baskets the book actually has. A line is "touched" when a scheme gave goods
-- or money off on the line itself (free goods, a line %, a flat amount) — order-level percentages are not
-- counted, cash discounts are reported not deducted. The pilot carries every brand, so its share is the
-- reviewer's 20-35 %; the smaller distributors carry mostly the scheme brands and run higher.
insert into checks select 'I-52 scheme-touched lines', a.slug,
       case when a.slug = 'tarsun' then '20-35 % of invoice lines, free goods >= 100' else '15-50 % of invoice lines' end,
       format('%s %% (%s of %s), %s with free goods', x.pct, x.touched, x.lines, x.free),
       x.pct between (case when a.slug = 'tarsun' then 20 else 15 end) and (case when a.slug = 'tarsun' then 35 else 50 end)
       and (a.slug <> 'tarsun' or x.free >= 100)
  from anchor a cross join lateral (
    select count(*) lines,
           count(*) filter (where exists (select 1 from jsonb_array_elements(l.applied_rules) r
                                           where r->>'kind' = 'scheme' and r->>'rewardKind' in ('free_qty', 'line_pct', 'net_scheme_amount'))) touched,
           count(*) filter (where l.free_qty_pcs > 0) free,
           round(100.0 * count(*) filter (where exists (select 1 from jsonb_array_elements(l.applied_rules) r
                                           where r->>'kind' = 'scheme' and r->>'rewardKind' in ('free_qty', 'line_pct', 'net_scheme_amount'))) / count(*), 1) pct
      from invoice_lines l join invoices i on i.id = l.invoice_id
     where l.tenant_id = a.tenant_id and i.source = 'pack') x;
-- I-53: the book ages (spec §2.10): a dozen shops 8-15 days overdue, eight 16-30, not a spike at 0-7 with
-- everything paid inside a week. DSO here is outstanding over the last ninety days' daily billing.
insert into checks select 'I-53 ageing shape', 'tarsun', 'shops: 0-7 >= 15, 8-15 >= 8, 16-30 >= 6; DSO 25-45 days',
       format('%s / %s / %s shops; DSO %s days', n1, n2, n3, dso), n1 >= 15 and n2 >= 8 and n3 >= 6 and dso between 25 and 45
  from anchor a cross join lateral (
    select count(distinct s.retailer_id) filter (where s.bucket_0_7_paise > 0) n1,
           count(distinct s.retailer_id) filter (where s.bucket_8_15_paise > 0) n2,
           count(distinct s.retailer_id) filter (where s.bucket_16_30_paise > 0) n3
      from ageing_snapshots s
     where s.tenant_id = a.tenant_id and s.as_of = (select max(as_of) from ageing_snapshots x where x.tenant_id = a.tenant_id)) b
  cross join lateral (
    select round((select sum(o.outstanding_paise) from retailer_outstanding_summary o where o.tenant_id = a.tenant_id)
                 / nullif((select sum(i.total_paise) from invoices i where i.tenant_id = a.tenant_id
                             and i.state <> 'cancelled' and i.invoice_date > a.today - 90) / 90.0, 0), 1) dso) d
 where a.slug = 'tarsun';
-- I-54: every registered shop is its own taxpayer: a proprietor PAN of its own inside a GSTIN whose
-- mod-36 check digit is right and whose state is the shop's — never one stem with a counter.
create function pg_temp.gstin_ok(g text) returns boolean language plpgsql immutable as $fn$
declare alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        total int := 0; v int; product int; i int;
begin
  if g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  for i in 1..14 loop
    v := position(substr(g, i, 1) in alphabet) - 1;
    product := v * (case when (i - 1) % 2 = 0 then 1 else 2 end);
    total := total + product / 36 + product % 36;
  end loop;
  return substr(alphabet, ((36 - total % 36) % 36) + 1, 1) = substr(g, 15, 1);
end $fn$;
insert into checks select 'I-54 own PAN per shop', a.slug, 'distinct PANs = registered shops, all proprietor-shaped, checksum ok, state = shop state',
       format('%s shops, %s PANs, %s ill-shaped, %s bad checksum, %s out of state', regd, pans, shaped, bad, outside),
       regd > 0 and pans = regd and shaped = 0 and bad = 0 and outside = 0
  from anchor a cross join lateral (
    select count(*) regd, count(distinct substr(r.gstin, 3, 10)) pans,
           count(*) filter (where substr(r.gstin, 3, 10) !~ '^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$') shaped,
           count(*) filter (where not pg_temp.gstin_ok(r.gstin)) bad,
           count(*) filter (where left(r.gstin, 2) <> r.state_code) outside
      from retailers r where r.tenant_id = a.tenant_id and r.gstin is not null) x;
-- I-55: a document's header is its lines plus an explicit round-off, on credit notes and invoices alike.
insert into checks select 'I-55 header = lines + round-off', a.slug, '0 credit notes, 0 invoices off', format('%s notes, %s bills', cn, inv), cn = 0 and inv = 0
  from anchor a cross join lateral (
    select (select count(*) from credit_notes c where c.tenant_id = a.tenant_id
             and c.total_paise <> coalesce(c.round_off_paise, 0) + (select coalesce(sum(l.line_total_paise), 0) from credit_note_lines l where l.credit_note_id = c.id)) cn,
           (select count(*) from invoices i where i.tenant_id = a.tenant_id and i.source in ('pack', 'van_sale')
             and i.total_paise <> coalesce(i.round_off_paise, 0) + (select coalesce(sum(l.line_total_paise), 0) from invoice_lines l where l.invoice_id = i.id)) inv) x;
-- I-56: the rule breakdown a bill prints sums to the line's discount, short-picked lines included.
insert into checks select 'I-56 applied rules sum to the discount', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from invoice_lines l
     where l.tenant_id = a.tenant_id
       and l.discount_paise <> coalesce((select sum((r->>'amountPaise')::bigint) from jsonb_array_elements(l.applied_rules) r
                                          where r->>'kind' = 'scheme' and r->>'rewardKind' in ('line_pct', 'net_scheme_amount', 'order_pct')), 0)) x;
-- I-57: the two receipt modes that are not money (spec §2.9), two of each, each closing a real bill.
insert into checks select 'I-57 adjustment and credit-note receipts', a.slug, 'adjustment >= 2, credit_note >= 2, all allocated',
       format('%s / %s, %s unallocated', adj, cn, loose), adj >= 2 and cn >= 2 and loose = 0
  from anchor a cross join lateral (
    select count(*) filter (where r.mode = 'adjustment') adj, count(*) filter (where r.mode = 'credit_note') cn,
           count(*) filter (where r.mode in ('adjustment', 'credit_note') and not exists (select 1 from allocations al where al.receipt_id = r.id)) loose
      from receipts r where r.tenant_id = a.tenant_id and r.amount_paise > 0) x;
-- I-58: nothing that has happened is stamped in the future. Only meaningful on the day the database was
-- seeded (the live day is the wall clock's); a pinned anchor on another date passes trivially.
insert into checks select 'I-58 no future stamps on the live day', a.slug,
       case when a.today = (now() at time zone 'Asia/Kolkata')::date then '0' else 'n/a (anchor is not today)' end,
       case when a.today = (now() at time zone 'Asia/Kolkata')::date then x.n::text else 'skipped' end,
       a.today <> (now() at time zone 'Asia/Kolkata')::date or x.n = 0
  from anchor a cross join lateral (
    select (select count(*) from receipts r where r.tenant_id = a.tenant_id and r.received_at > now())
         + (select count(*) from allocations x where x.tenant_id = a.tenant_id and x.allocated_at > now())
         + (select count(*) from journal_entries j where j.tenant_id = a.tenant_id and j.posted_at > now())
         + (select count(*) from stock_ledger l where l.tenant_id = a.tenant_id and l.occurred_at > now())
         + (select count(*) from invoices i where i.tenant_id = a.tenant_id and i.issued_at > now())
         + (select count(*) from sales_orders o where o.tenant_id = a.tenant_id and (o.created_at > now() or o.submitted_at > now() or o.confirmed_at > now()))
         + (select count(*) from order_state_transitions t where t.tenant_id = a.tenant_id and t.occurred_at > now())
         + (select count(*) from visits v where v.tenant_id = a.tenant_id and v.started_at > now())
         + (select count(*) from trip_stops s where s.tenant_id = a.tenant_id and (s.completed_at > now() or s.arrived_at > now()))
         + (select count(*) from deliveries d where d.tenant_id = a.tenant_id and d.delivered_at > now())
         + (select count(*) from trip_points p where p.tenant_id = a.tenant_id and p.recorded_at > now())
         + (select count(*) from credit_notes c where c.tenant_id = a.tenant_id and c.issued_at > now())
         + (select count(*) from messages m where m.tenant_id = a.tenant_id and (m.sent_at > now() or m.delivered_at > now() or m.read_at > now() or m.created_at > now()))
         + (select count(*) from retailer_behaviour b where b.tenant_id = a.tenant_id and (b.last_order_at > now() or b.last_visit_at > now() or b.last_payment_at > now()))
         + (select count(*) from route_plans p where p.tenant_id = a.tenant_id and (p.computed_at > now() or p.created_at > now()))
         + (select count(*) from visits v where v.tenant_id = a.tenant_id and v.ended_at > now())
         + (select count(*) from approvals p where p.tenant_id = a.tenant_id and (p.created_at > now() or p.decided_at > now()))
         + (select count(*) from bargain_requests b where b.tenant_id = a.tenant_id and (b.created_at > now() or b.decided_at > now()))
         + (select count(*) from claims c where c.tenant_id = a.tenant_id and (c.submitted_at > now() or c.settled_at > now() or c.acknowledged_at > now()))
         + (select count(*) from load_sheets l where l.tenant_id = a.tenant_id and (l.approved_at > now() or l.confirmed_at > now()))
         + (select count(*) from owner_summary o where o.tenant_id = a.tenant_id and o.as_of > now()) n) x;
-- I-59: the desk posts during the day: no journal entry before 07:00 IST (a bare date used to land at 05:30).
insert into checks select 'I-59 journals posted in business hours', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from journal_entries j where j.tenant_id = a.tenant_id
       and (j.posted_at at time zone 'Asia/Kolkata')::time < time '07:00') x;
-- I-60: a shop's name matches its kind: the tier-A accounts read like supermarkets and wholesalers, and no
-- kirana-tier shop calls itself a supermarket.
insert into checks select 'I-60 names match archetypes', a.slug, '0 tier-A shops without a supermarket name, 0 kirana-tier shops with one',
       format('%s big without, %s small with', big, small), big = 0 and small = 0
  from anchor a cross join lateral (
    select count(*) filter (where r.tier = 'A' and r.name !~* '(super|bazar|bazaar|wholesale|mart|hyper)') big,
           count(*) filter (where r.tier in ('C', 'D') and r.name ~* '(super|wholesale|hyper)') small
      from retailers r where r.tenant_id = a.tenant_id) x;
-- I-61: every order out for delivery is on a vehicle: a `dispatched` order has a stop (its delivery row
-- names the stop) — on a Monday too, when "yesterday's" loads are Saturday's.
insert into checks select 'I-61 dispatched orders ride a trip', a.slug, '0', x.n::text, x.n = 0
  from anchor a cross join lateral (
    select count(*) n from sales_orders o
     where o.tenant_id = a.tenant_id and o.state = 'dispatched'
       and not exists (select 1 from deliveries d join trip_stops s on s.id = d.stop_id where d.order_id = o.id)) x;
-- I-62: the seed finished: the live day is committed and no run is marked as still in progress.
insert into checks select 'I-62 anchor committed', a.slug, 'anchor set, no seed in progress',
       format('anchor %s, in progress %s', coalesce(anchor, 'missing'), started), anchor is not null and started = 0
  from anchor a cross join lateral (
    select (select s.value #>> '{}' from tenant_settings s where s.tenant_id = a.tenant_id and s.key = 'demo.anchor_date') anchor,
           (select count(*) from tenant_settings s where s.tenant_id = a.tenant_id and s.key = 'demo.seed_in_progress') started) x;


-- ================================================================ second round (2026-09-12 review)
-- I-63: the ageing book has a shape: the 16-30 bucket holds more money and more shops than 31-60, which
-- holds more than 61-90 — an old tail, not a hollow middle.
insert into checks select 'I-63 ageing monotonic past 16-30', 'tarsun', '16-30 >= 31-60 >= 61-90 in money and shops',
       format('%s / %s / %s; shops %s / %s / %s', b3, b4, b5, n3, n4, n5),
       b3 >= b4 and b4 >= b5 and n3 >= n4 and n4 >= n5
  from anchor a cross join lateral (
    select sum(bucket_16_30_paise) b3, sum(bucket_31_60_paise) b4, sum(bucket_61_90_paise) b5,
           count(distinct retailer_id) filter (where bucket_16_30_paise > 0) n3,
           count(distinct retailer_id) filter (where bucket_31_60_paise > 0) n4,
           count(distinct retailer_id) filter (where bucket_61_90_paise > 0) n5
      from ageing_snapshots s
     where s.tenant_id = a.tenant_id and s.as_of = (select max(as_of) from ageing_snapshots x where x.tenant_id = a.tenant_id)) x
 where a.slug = 'tarsun';
-- I-64: each distributor's old book is its own — no opening bill carries the same amount in two tenants —
-- and every shop that owes an old due has traded and been called on (a closed shop keeps its residue
-- without visits; it is shut).
insert into checks select 'I-64 opening bills are each tenant''s own', 'global', '0 amounts shared, 0 hosts without history',
       format('%s shared, %s without history', shared, orphans), shared = 0 and orphans = 0
  from (select (select count(*) from (select i.invoice_no, i.total_paise from invoices i
                                       where i.series_code = 'OPEN' group by 1, 2 having count(*) > 1) d) shared,
               (select count(*) from invoices i join retailers r on r.id = i.retailer_id
                 where i.series_code = 'OPEN' and r.active
                   and (not exists (select 1 from sales_orders o where o.retailer_id = r.id)
                        or not exists (select 1 from visits v where v.retailer_id = r.id))) orphans) x;
-- I-65: field activity at the beat plan's scale: the pilot's reps log a dozen or more calls a working
-- day, a shop is called on at least half of its beat's scheduled days, and a tempo does eight drops a
-- round or more on average.
insert into checks select 'I-65 field activity', a.slug,
       case when a.slug = 'tarsun' then '>= 12 calls/day, >= 50 % of scheduled days, >= 8 stops/trip' else '>= 4 calls/day, >= 50 % of scheduled days' end,
       format('%s calls/day, %s %% of scheduled days, %s stops/trip', per_day, coverage, stops),
       per_day >= (case when a.slug = 'tarsun' then 12 else 4 end) and coverage >= 50 and (a.slug <> 'tarsun' or stops >= 8)
  from anchor a cross join lateral (
    select round(count(*)::numeric / nullif((select count(distinct (v2.started_at at time zone 'Asia/Kolkata')::date) from visits v2 where v2.tenant_id = a.tenant_id), 0), 1) per_day
      from visits v where v.tenant_id = a.tenant_id) c
  cross join lateral (
    -- scheduled days: the beat's visit days over the shop's own trading window (first to last visit)
    select round(100.0 * avg(sh.visits::numeric / nullif(sh.scheduled, 0)), 0) coverage
      from (select r.id,
                   (select count(*) from visits v where v.retailer_id = r.id) visits,
                   (select count(*) from generate_series(
                      (select min((v.started_at at time zone 'Asia/Kolkata')::date) from visits v where v.retailer_id = r.id),
                      (select max((v.started_at at time zone 'Asia/Kolkata')::date) from visits v where v.retailer_id = r.id), '1 day') d
                     where exists (select 1 from jsonb_array_elements_text(b.visit_days) vd where vd::int = extract(dow from d)::int)) scheduled
              from retailers r join beats b on b.id = r.beat_id
             where r.tenant_id = a.tenant_id and r.active and r.credit_mode <> 'stop'
               and exists (select 1 from visits v where v.retailer_id = r.id)) sh) v
  cross join lateral (
    select round(avg(t.planned_stops), 1) stops from trips t where t.tenant_id = a.tenant_id and t.state in ('settled', 'settled_with_variance')) s;
-- I-66: the retailer's margin (MRP against the price the shop pays, GST included) is the category's:
-- staples thin, biscuits and dairy in the middle, cold drinks and toiletries fat.
insert into checks select 'I-66 retailer margin by category', 'tarsun', 'staples 4-9, biscuits 8-14, dairy 6-12, beverages 15-25, personal care 13-22, household 12-20, snacks 10-18',
       string_agg(category || ' ' || pct, ', ' order by category),
       bool_and(pct between lo and hi)
  from (select p.category,
               round(avg(100.0 * (v.mrp_paise - i.rate_paise * (1 + (g.gst + g.cess) / 10000.0)) / v.mrp_paise), 1) pct,
               case p.category when 'Packaged Food' then 4 when 'Biscuits' then 8 when 'Dairy' then 6 when 'Beverages' then 15
                               when 'Personal Care' then 13 when 'Household' then 12 else 10 end lo,
               case p.category when 'Packaged Food' then 9 when 'Biscuits' then 14 when 'Dairy' then 12 when 'Beverages' then 25
                               when 'Personal Care' then 22 when 'Household' then 20 else 18 end hi
          from price_list_items i
          join price_lists pl on pl.id = i.price_list_id and pl.is_default
          join product_variants v on v.id = i.variant_id
          join products p on p.id = v.product_id
          join (select variant_id, max(gst_bps) gst, max(cess_bps) cess from invoice_lines group by 1) g on g.variant_id = v.id
          join anchor a on a.tenant_id = i.tenant_id
         where a.slug = 'tarsun'
         group by p.category) x;
-- I-67: the distributor's gross margin (ex-tax sales against landed cost) is positive every day, sits at
-- 3-12 % in every month with real trade, and does not fall month after month.
insert into checks select 'I-67 gross margin by month', a.slug, '3-12 % each full month, 0 negative days, full months within 2.5 points of each other',
       format('%s; %s negative days', months, neg), ok_band and neg = 0 and steady
  from anchor a cross join lateral (
    with m as (
      select to_char(i.invoice_date, 'YYYY-MM') mo,
             round(100.0 * sum(il.taxable_paise - (il.qty_pcs + il.free_qty_pcs) * c.landed_cost_paise) / nullif(sum(il.taxable_paise), 0), 2) pct,
             count(distinct i.invoice_date) days
        from invoice_lines il join invoices i on i.id = il.invoice_id
        join tenant_product_costs c on c.tenant_id = il.tenant_id and c.variant_id = il.variant_id
       where il.tenant_id = a.tenant_id and i.state <> 'cancelled'
       group by 1)
    select string_agg(mo || ' ' || pct || '%', ', ' order by mo) months,
           bool_and(pct between 3 and 12) filter (where days >= 15) ok_band,
           coalesce(max(pct) filter (where days >= 15) - min(pct) filter (where days >= 15) <= 2.5, true) steady
      from m) x
  cross join lateral (
    select count(*) neg from (
      select i.invoice_date, sum(il.taxable_paise - (il.qty_pcs + il.free_qty_pcs) * c.landed_cost_paise) gm
        from invoice_lines il join invoices i on i.id = il.invoice_id
        join tenant_product_costs c on c.tenant_id = il.tenant_id and c.variant_id = il.variant_id
       where il.tenant_id = a.tenant_id and i.state <> 'cancelled' group by 1) d where gm < 0) n;
-- I-68: the PAN column is filled for every registered shop with the PAN inside its GSTIN, and empty for
-- the unregistered ones.
insert into checks select 'I-68 own PAN column', a.slug, '0 registered without, 0 mismatched, 0 unregistered with',
       format('%s / %s / %s', missing, mismatched, spurious), missing = 0 and mismatched = 0 and spurious = 0
  from anchor a cross join lateral (
    select count(*) filter (where r.gstin is not null and r.pan is null) missing,
           count(*) filter (where r.gstin is not null and r.pan <> substr(r.gstin, 3, 10)) mismatched,
           count(*) filter (where r.gstin is null and r.pan is not null) spurious
      from retailers r where r.tenant_id = a.tenant_id) x;
-- I-69: a food bill prints batch AND expiry: every line picked from a batch carries the batch's expiry.
insert into checks select 'I-69 expiry on the bill', a.slug, '0 batch lines without expiry, 0 wrong',
       format('%s missing, %s wrong', missing, wrong), missing = 0 and wrong = 0
  from anchor a cross join lateral (
    select count(*) filter (where l.lot_id is not null and l.expiry_date is null) missing,
           count(*) filter (where l.lot_id is not null and l.expiry_date <> s.expiry_date) wrong
      from invoice_lines l left join stock_lots s on s.id = l.lot_id
     where l.tenant_id = a.tenant_id) x;
-- I-70: beats are places: every two beats' centres are at least 700 m apart and no beat spreads more
-- than 1.6 km either way.
insert into checks select 'I-70 beats are places', a.slug, 'min centre distance >= 700 m, max spread <= 1600 m',
       format('%s m apart, %s m spread', apart, spread), apart >= 700 and spread <= 1600
  from anchor a cross join lateral (
    with c as (select b.id, avg(r.lat) lat, avg(r.lng) lng,
                      (max(r.lat) - min(r.lat)) * 111000 ns, (max(r.lng) - min(r.lng)) * 105000 ew
                 from retailers r join beats b on b.id = r.beat_id
                where r.tenant_id = a.tenant_id group by b.id)
    select round(min(sqrt(((x.lat - y.lat) * 111000) ^ 2 + ((x.lng - y.lng) * 105000) ^ 2))) apart,
           (select round(max(greatest(ns, ew))) from c) spread
      from c x join c y on x.id < y.id) x;
-- I-71: a claims book: every distributor claims from its brands, in at least four statuses, and the
-- pilot's claims run at one to three per cent of its quarter's purchases.
insert into checks select 'I-71 claims book', a.slug,
       case when a.slug = 'tarsun' then '>= 10 claims, >= 4 statuses, 1-3 % of purchases' else '>= 3 claims, >= 3 statuses' end,
       format('%s claims, %s statuses, %s %% of purchases', n, statuses, pct),
       n >= (case when a.slug = 'tarsun' then 10 else 3 end) and statuses >= (case when a.slug = 'tarsun' then 4 else 3 end)
       and (a.slug <> 'tarsun' or pct between 1 and 3)
  from anchor a cross join lateral (
    select count(*) n, count(distinct c.status) statuses,
           round(100.0 * sum(c.claimed_paise) / nullif((select sum(total_paise) from supplier_invoices si where si.tenant_id = a.tenant_id), 0), 2) pct
      from claims c where c.tenant_id = a.tenant_id) x;
-- I-72: the out-of-state party is a wholesale account with terms that agree with each other, more than one
-- bill behind orders, and an IGST figure of its own in every tenant.
insert into checks select 'I-72 inter-state party', a.slug, '1 party, limit > 0, indicate, >= 2 bills with orders, IGST distinct across tenants',
       format('%s party, limit %s, %s, %s bills, %s orphan bills, %s shared IGST', parties, lim, mode, bills, orphans, shared),
       parties = 1 and lim > 0 and mode = 'indicate' and bills >= 2 and orphans = 0 and shared = 0
  from anchor a cross join lateral (
    select count(*) parties, max(r.credit_limit_paise) lim, max(r.credit_mode::text) mode,
           (select count(*) from invoices i where i.tenant_id = a.tenant_id and i.is_inter_state) bills,
           (select count(*) from invoices i where i.tenant_id = a.tenant_id and i.is_inter_state and i.order_id is null) orphans,
           (select count(*) from invoices i where i.tenant_id = a.tenant_id and i.is_inter_state
             and exists (select 1 from invoices j where j.tenant_id <> a.tenant_id and j.is_inter_state and j.igst_paise = i.igst_paise)) shared
      from retailers r join tenants t on t.id = r.tenant_id
     where r.tenant_id = a.tenant_id and r.state_code <> t.state_code) x;
-- I-73: a shop's name and its keeper's name belong to the same family: a devotional-named kirana is not
-- run by a Muslim family's name, a shop named for a surname is run by that surname, and a shop named for
-- a locality sits on that locality's beat.
insert into checks select 'I-73 names belong together', a.slug, '0 devotional/muslim mismatches, 0 surname mismatches, 0 shops off their named beat',
       format('%s / %s / %s', devotional, surname, off_beat), devotional = 0 and surname = 0 and off_beat = 0
  from anchor a cross join lateral (
    select count(*) filter (where lower(r.name) ~ '(^|\s)(shree|shri|om|sai|jai|ganesh|ganpati|krishna|balaji|mahalaxmi|laxmi|ambika|ekvira|vitthal|hariom|gurukrupa|shivshakti|bhavani|datta|swami|sant|tirupati|vighnaharta|mauli|morya|renuka|hanuman|dnyaneshwar|jhulelal|guru|trimurti|rameshwar|shantai|ashirwad|mangal|sadguru|vaishnavi|prabhu)(\s|$)'
                              and split_part(r.owner_name, ' ', 2) in ('Khan', 'Ansari', 'Sayyed', 'Shaikh', 'Qureshi', 'Momin')) devotional,
           count(*) filter (where split_part(r.name, ' ', 1) in ('Patil', 'More', 'Joshi', 'Kadam', 'Pawar', 'Bhosale', 'Chavan', 'Deshmukh', 'Gavhane', 'Karve', 'Sharma', 'Yadav', 'Mishra', 'Gupta', 'Singh', 'Iyer', 'Reddy', 'Ansari', 'Khan', 'Jain', 'Patel', 'Shah')
                              and split_part(r.owner_name, ' ', 2) <> split_part(r.name, ' ', 1)) surname,
           count(*) filter (where exists (select 1 from beats b where b.tenant_id = r.tenant_id and r.name ilike '%' || split_part(b.name, ' ', 1) || '%' and b.id <> r.beat_id
                                            and not exists (select 1 from beats b2 where b2.id = r.beat_id and r.name ilike '%' || split_part(b2.name, ' ', 1) || '%'))) off_beat
      from retailers r where r.tenant_id = a.tenant_id and r.beat_id is not null) x;
-- I-74: scheme spend reads like an FMCG book: discounts plus free goods at rate run at two to six per cent
-- of gross in every tenant, and the order-value scheme fires on a minority of bills.
insert into checks select 'I-74 scheme spend', a.slug, '2-6 % of gross, order scheme on < 40 % of bills',
       format('%s %% of gross, order scheme on %s %% of bills', spend, order_pct), spend between 2 and 6 and order_pct < 40
  from anchor a cross join lateral (
    select round(100.0 * sum(il.discount_paise + il.free_qty_pcs * il.rate_paise) / sum(il.rate_paise * il.qty_pcs), 2) spend
      from invoice_lines il join invoices i on i.id = il.invoice_id
     where il.tenant_id = a.tenant_id and i.state <> 'cancelled' and i.source = 'pack') x
  cross join lateral (
    select round(100.0 * count(distinct i.id) filter (where exists (
             select 1 from invoice_lines l, jsonb_array_elements(l.applied_rules) r
              where l.invoice_id = i.id and r ->> 'rewardKind' = 'order_pct'
                and r ->> 'ruleId' in (select s.id from schemes s where s.tenant_id = a.tenant_id and s.brand_id is null))) / count(distinct i.id), 1) order_pct
      from invoices i where i.tenant_id = a.tenant_id and i.source = 'pack' and i.state <> 'cancelled') y;
-- I-75: the book is not too well behaved: at least one account past its limit (on indicate terms), and a
-- fifth of the listed SKUs barely moving.
insert into checks select 'I-75 over-limit accounts and slow SKUs', a.slug,
       case when a.slug = 'tarsun' then '>= 1 over its limit, >= 15 % of listed SKUs with <= 2 bill lines' else '>= 10 % slow SKUs' end,
       format('%s over, %s %% slow', over_limit, slow_pct),
       (a.slug <> 'tarsun' or over_limit >= 1) and slow_pct >= (case when a.slug = 'tarsun' then 15 else 10 end)
  from anchor a cross join lateral (
    select count(*) filter (where s.outstanding_paise > r.credit_limit_paise and r.credit_limit_paise > 0) over_limit
      from retailer_outstanding_summary s join retailers r on r.id = s.retailer_id where s.tenant_id = a.tenant_id) x
  cross join lateral (
    select round(100.0 * count(*) filter (where (select count(*) from invoice_lines l join invoices i on i.id = l.invoice_id
                                                   where l.tenant_id = tp.tenant_id and l.variant_id = tp.variant_id and i.state <> 'cancelled') <= 2) / count(*), 1) slow_pct
      from tenant_products tp where tp.tenant_id = a.tenant_id and tp.listed) y;
-- I-76: the live day bills: the pilot has packed (and so invoiced) a real morning's worth by the time
-- the owner opens the app.
insert into checks select 'I-76 the live day bills', a.slug,
       case when a.slug = 'tarsun' then '>= ₹20,000 billed today, >= 3 packed' else '> 0 billed today, >= 1 packed' end,
       format('₹%s billed, %s packed', round(billed / 100.0), packed),
       billed >= (case when a.slug = 'tarsun' then 2000000 else 1 end) and packed >= (case when a.slug = 'tarsun' then 3 else 1 end)
  from anchor a cross join lateral (
    select coalesce((select sum(i.total_paise) from invoices i where i.tenant_id = a.tenant_id and i.invoice_date = a.today and i.state <> 'cancelled'), 0) billed,
           (select count(*) from sales_orders o where o.tenant_id = a.tenant_id and o.state = 'packed'
             and (coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date = a.today) packed) x;
-- I-77: tomorrow's planned trip is dated on the next WORKING day, never the depot's weekly off.
insert into checks select 'I-77 planned trip on a working day', a.slug, 'trip after the live day, not a Sunday',
       format('%s (dow %s)', trip_date, dow), trip_date > a.today and dow <> 0
  from anchor a cross join lateral (
    select t.trip_date, extract(dow from t.trip_date)::int dow from trips t
     where t.tenant_id = a.tenant_id and t.state = 'planned' order by t.trip_date limit 1) x;
-- I-78: money never lands before its bill: no allocation and no allocated receipt is stamped before the
-- invoice it settles was issued.
insert into checks select 'I-78 money after the bill', a.slug, '0 allocations before issue, 0 receipts before issue',
       format('%s / %s', early_alloc, early_receipt), early_alloc = 0 and early_receipt = 0
  from anchor a cross join lateral (
    select (select count(*) from allocations al join invoices i on i.id = al.invoice_id
             where al.tenant_id = a.tenant_id and al.allocated_at < i.issued_at) early_alloc,
           (select count(*) from allocations al join invoices i on i.id = al.invoice_id join receipts r on r.id = al.receipt_id
             where al.tenant_id = a.tenant_id and r.amount_paise > 0 and r.received_at < i.issued_at) early_receipt) x;
-- I-79: the owner's home tile is the rollups' own sum: month-to-date margin from the daily rows, the stock
-- at cost from the balances, today's collections from the receipts, the dues from the shop rollup.
insert into checks select 'I-79 owner summary ties', a.slug, 'margin, stock, collections and dues all tie',
       format('margin %s, stock %s vs %s, collected %s vs %s, dues %s', mtd_ties, stock, stock_actual, collected, collected_actual, dues_ties),
       mtd_ties and stock = stock_actual and collected = collected_actual and dues_ties
  from anchor a cross join lateral (
    select o.mtd_gross_margin_paise = (select coalesce(sum(gross_margin_paise), 0) from daily_owner_stats d
                                         where d.tenant_id = a.tenant_id and d.day between date_trunc('month', a.today)::date and a.today) mtd_ties,
           o.stock_value_paise stock,
           (select coalesce(sum(b.on_hand * (case when c.landed_cost_paise > 0 then c.landed_cost_paise else c.purchase_rate_paise end)), 0)
              from stock_balances b join stock_lots l on l.id = b.lot_id
              join tenant_product_costs c on c.tenant_id = b.tenant_id and c.variant_id = l.variant_id
             where b.tenant_id = a.tenant_id and b.on_hand > 0) stock_actual,
           o.today_collected_paise collected,
           (select coalesce(sum(r.amount_paise), 0) from receipts r where r.tenant_id = a.tenant_id
             and r.status in ('collected', 'deposited') and (r.received_at at time zone 'Asia/Kolkata')::date = a.today) collected_actual,
           o.total_outstanding_paise = (select coalesce(sum(outstanding_paise), 0) from retailer_outstanding_summary s where s.tenant_id = a.tenant_id) dues_ties
      from owner_summary o where o.tenant_id = a.tenant_id) x;
-- I-80: the day book ties: in the live window every day's collections equal the receipts register and
-- every day's billing equals the invoice register; the day's stock at cost is the ledger's.
insert into checks select 'I-80 daily stats tie to the registers', a.slug, '0 days off on collections, 0 on billing, today''s stock ties',
       format('%s / %s days off, stock %s', collected_off, invoiced_off, case when stock_ties then 'ties' else 'off' end),
       collected_off = 0 and invoiced_off = 0 and stock_ties
  from anchor a cross join lateral (
    select count(*) filter (where d.collected_paise <> coalesce((select sum(amount_paise) from receipts r where r.tenant_id = d.tenant_id
                                                              and r.status in ('collected', 'deposited') and (r.received_at at time zone 'Asia/Kolkata')::date = d.day), 0)) collected_off,
           count(*) filter (where d.invoiced_paise <> coalesce((select sum(total_paise) from invoices i where i.tenant_id = d.tenant_id
                                                             and i.invoice_date = d.day and i.state not in ('draft', 'cancelled')), 0)) invoiced_off
      from daily_tenant_stats d
     where d.tenant_id = a.tenant_id
       -- the live window: the pilot's ninety days, the smaller distributors' sixty and forty-five
       and d.day > a.today - (case a.slug when 'tarsun' then 90 when 'sai-distributors' then 60 else 45 end)) x
  cross join lateral (
    select (select stock_value_paise from daily_owner_stats d where d.tenant_id = a.tenant_id and d.day = a.today)
         = (select coalesce(sum(b.on_hand * (case when c.landed_cost_paise > 0 then c.landed_cost_paise else c.purchase_rate_paise end)), 0)
              from stock_balances b join stock_lots l on l.id = b.lot_id
              join tenant_product_costs c on c.tenant_id = b.tenant_id and c.variant_id = l.variant_id
             where b.tenant_id = a.tenant_id and b.on_hand > 0) stock_ties) y;
-- I-81: the manufacturer's rep is a brand rep, not a hundred-per-cent closer: every pilot rep's strike
-- sits under 85 %.
insert into checks select 'I-81 no rep at a perfect strike', 'tarsun', 'every rep < 85 %', string_agg(username || ' ' || pct, ', ' order by username), bool_and(pct < 85)
  from (select u.username,
               round(100.0 * count(*) filter (where v.outcome = 'ordered')
                     / nullif(count(*) filter (where v.outcome in ('ordered', 'no_order', 'payment_only')), 0), 1) pct
          from visits v join users u on u.id = v.user_id join anchor a on a.tenant_id = v.tenant_id
         where a.slug = 'tarsun' group by u.username) x;
-- I-82: scheme spend on the owner's tile is the rule breakdown the bills carry: the day's company- and
-- distributor-funded spend equals the applied rules' amounts by the scheme's funding source.
insert into checks select 'I-82 scheme spend from the bills', a.slug, '0 days off', off::text, off = 0
  from anchor a cross join lateral (
    select count(*) off from daily_owner_stats d
     where d.tenant_id = a.tenant_id
       and d.day > a.today - (case a.slug when 'tarsun' then 90 when 'sai-distributors' then 60 else 45 end)
       and (d.scheme_spend_company_paise, d.scheme_spend_distributor_paise) is distinct from (
         select (coalesce(sum(case when coalesce(s.funding_source::text, 'company') = 'company' then (rule ->> 'amountPaise')::bigint end), 0)::bigint,
                 coalesce(sum(case when s.funding_source::text = 'distributor' then (rule ->> 'amountPaise')::bigint end), 0)::bigint)
           from invoice_lines l join invoices i on i.id = l.invoice_id
           cross join lateral jsonb_array_elements(l.applied_rules) rule
           left join schemes s on s.id = rule ->> 'ruleId' and s.tenant_id = l.tenant_id
          where l.tenant_id = d.tenant_id and i.invoice_date = d.day and i.state not in ('draft', 'cancelled')
            and rule ->> 'ruleId' is not null)) x;

-- ============================================================================================ the report
select check_name, tenant, expected, actual, ok from checks order by ok, check_name, tenant;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from checks;
do $$
declare failed int;
begin
  select count(*) into failed from checks where not ok;
  if failed > 0 then raise exception 'verify-seed: % check(s) failed', failed; end if;
end $$;
