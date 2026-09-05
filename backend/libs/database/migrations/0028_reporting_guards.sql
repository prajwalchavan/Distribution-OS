-- Hand-written companion to 0027_reporting_expand.sql: the guarantees drizzle-kit cannot express.
--
-- Everything declarable in src/schema/reporting.ts is in the GENERATED 0027 and is deliberately NOT
-- repeated here (docs/plans/00-coordination.md §2 rule 3): the two new rollup tables the owner's graphs
-- need beyond the four that existed —
--   daily_retailer_stats   one shop's day (orders, invoiced, collected, lines), sparse rows, PK
--                          (tenant_id, retailer_id, day) + `daily_retailer_stats_day_idx` — the shop's
--                          12-week sparkline and "top shops this month" (docs/23 §1.2)
--   daily_owner_stats      the COST-BEARING half of the day (net sales, COGS, gross margin, stock at cost,
--                          near-expiry value, scheme spend by funding source, margin by brand), PK
--                          (tenant_id, day), back office only — the margin trend, "stock value and turns"
--                          and the scheme-spend split at month grain, which the 92-day live registers
--                          cannot draw over a year
-- the nine new `daily_tenant_stats` columns (`overdue_paise`, `partial_stops`, `on_time_stops`,
-- `pod_stops`, `ordered_pcs`, `picked_pcs`, `by_category`, `by_beat`, `by_payment_mode` — the outstanding
-- trend with its overdue line, fill rate / on-time / POD coverage as day series, and the beat, category
-- and payment-mode group-bys), `daily_rep_stats_day_idx` on (tenant_id, day) (coordination §2 row
-- "0021 reporting": the PK leads with user_id, wrong-leading for "every rep on day X"), the four CHECK
-- constraints, and the two policy swaps coordination §5.3 assigns to this slice:
--   daily_tenant_stats   `daily_tenant_stats_tenant` (any member, FOR ALL) → `daily_tenant_stats_staff`
--                        (STAFF_ROLES)
--   retailer_behaviour   `retailer_behaviour_tenant` (any member, FOR ALL) → `retailer_behaviour_staff`
--                        (STAFF_ROLES)
-- Under the old policies a retailer-role session could SELECT every row of both tables: the distributor's
-- whole day's revenue, and every OTHER shop's basket, lapsed-risk score and payment habit
-- (docs/plans/reporting.md §3 item 1; docs/22 §9 never-list 9). Generating 0027 needed no answers
-- (nothing renamed); the run was wrapped in expect in case the policy swaps prompted, and did not. This
-- pair landed as 0027/0028 (coordination §2 relative slot 0021/0022, shifted by the platform-gaps,
-- outbox-relay, integrations-wizard and claims-cancel slices).
--
-- What IS here, and why each piece is a grant, a trigger or an assertion rather than schema:
--   1. FORCE ROW LEVEL SECURITY + the runtime grants for `daily_retailer_stats` and `daily_owner_stats`
--      (coordination §8 item 5), and the same re-asserted for the four reporting tables 0003 already
--      covered (idempotent; explicit so all six are correct on a database whose defaults were changed by
--      hand — without FORCE the owner connection would bypass every policy 0027 installed).
--   2. `dos_reporting_retailer_tenant_guard()` — a day row or a behaviour row that names a shop names a
--      shop of ITS OWN tenant. RLS hides another tenant's shop from `app_rw`, but a foreign-key check
--      bypasses row security, so the FK alone would let the worker's rollup (which runs BYPASSRLS across
--      tenants, docs/plans/reporting.md §7), a seed or the owner connection file tenant B's shop under
--      tenant A's stats — and tenant A's staff would then read it. SECURITY DEFINER so the check sees the
--      shop whatever the caller's role may read, with an explicit tenant comparison so the wider view
--      never widens the rule (the twin of 0019 §2, 0022 §2 and 0025 §3). Armed on both tables that
--      carry a `retailer_id`: `daily_retailer_stats` (new) and `retailer_behaviour` (0002, unguarded
--      until now).
--   3. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6, 0017 §3, 0019 §3, 0022 §3 and 0025 §4. The
--      policy text of 0027 is generated from the schema; a later `db:generate` against a drifted schema
--      could quietly put the wide any-member `tenantPolicy` back on `daily_tenant_stats` (a shopkeeper
--      token reads the tenant's revenue) or a staff policy on `daily_owner_stats` (a salesperson reads
--      PURCHASE COST and margin — never-list 1, the Vyapar leak) — and no test that does not look for it
--      would fail. So the migration refuses to finish unless:
--        (a) every one of the six reporting tables FORCEs row level security;
--        (b) every one carries at least one policy, and every policy on them names `app.actor_role` —
--            none is the role-less any-member form of 0002;
--        (c) NO policy on any of the six admits the retailer role (the only `'retailer'` a predicate may
--            name is the exclusion `<> 'retailer'`): a shop never sees a report (reporting §4 rule 14;
--            retailer-service does not mount the module, and this is the database half of that);
--        (d) `daily_owner_stats` and `owner_summary` — the two rows that carry cost and margin — admit
--            NONE of salesperson, delivery, warehouse in any policy (docs/22 §9 never-list 1, the same
--            rule `tenant_product_costs` lives under);
--        (e) `daily_rep_stats_day_idx`, `daily_retailer_stats_day_idx` and `retailer_behaviour_lapsed_idx`
--            exist and lead with `tenant_id` (coordination §8 item 6);
--        (f) the six new counters on `daily_tenant_stats` are NOT NULL DEFAULT 0 (a day with nothing to
--            report is a row of zeros, never a NULL a chart has to special-case) and the three new mixes
--            are nullable jsonb (a mix the rollup has not computed is absent, not `{}`);
--        (g) the four CHECK constraints exist — counts never negative, and on `daily_owner_stats`
--            `gross_margin_paise = net_sales_paise - cogs_paise` so margin and its two halves can never
--            drift apart between two rollup writers;
--        (h) the guard of §2 is armed on both tables.
--
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every
-- app_rw transaction. A connection with NO role set is the migrating/owner connection (seeds, migrations,
-- a DBA in psql): it bypasses RLS anyway; the tenant guard of §2 binds it all the same.

-- 1. FORCE RLS and the runtime grants for the six reporting tables (the two new ones first).
ALTER TABLE "daily_retailer_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_owner_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_rep_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retailer_behaviour" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_summary" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_retailer_stats", "daily_owner_stats", "daily_tenant_stats", "daily_rep_stats", "retailer_behaviour", "owner_summary" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_retailer_stats", "daily_owner_stats", "daily_tenant_stats", "daily_rep_stats", "retailer_behaviour", "owner_summary" TO app_worker;--> statement-breakpoint

-- 2. A shop's day row and its behaviour row name a shop of the row's own tenant.
CREATE OR REPLACE FUNCTION dos_reporting_retailer_tenant_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r_tenant text;
BEGIN
  SELECT tenant_id INTO r_tenant FROM retailers WHERE id = NEW.retailer_id;
  IF r_tenant IS NULL THEN
    RAISE EXCEPTION '%: retailer % does not exist', TG_TABLE_NAME, NEW.retailer_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF r_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION '%: retailer % belongs to another tenant', TG_TABLE_NAME, NEW.retailer_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS daily_retailer_stats_tenant_guard ON "daily_retailer_stats";--> statement-breakpoint
CREATE TRIGGER daily_retailer_stats_tenant_guard
  BEFORE INSERT OR UPDATE OF retailer_id, tenant_id ON "daily_retailer_stats"
  FOR EACH ROW EXECUTE FUNCTION dos_reporting_retailer_tenant_guard();--> statement-breakpoint
DROP TRIGGER IF EXISTS retailer_behaviour_tenant_guard ON "retailer_behaviour";--> statement-breakpoint
CREATE TRIGGER retailer_behaviour_tenant_guard
  BEFORE INSERT OR UPDATE OF retailer_id, tenant_id ON "retailer_behaviour"
  FOR EACH ROW EXECUTE FUNCTION dos_reporting_retailer_tenant_guard();--> statement-breakpoint

-- 3. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted and typed ('retailer'::text), so the patterns below match the deparsed text
--    of what 0027 installed — and would match a wide policy put there by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
  def text;
BEGIN
  -- (a) FORCE on all six
  FOREACH t IN ARRAY ARRAY[
    'daily_tenant_stats', 'daily_rep_stats', 'daily_retailer_stats', 'daily_owner_stats', 'retailer_behaviour', 'owner_summary'
  ]
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the policies of 0027 would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (b) every table has a policy, and none of its policies is the role-less any-member form;
  -- (c) none admits the retailer role
  FOREACH t IN ARRAY ARRAY[
    'daily_tenant_stats', 'daily_rep_stats', 'daily_retailer_stats', 'daily_owner_stats', 'retailer_behaviour', 'owner_summary'
  ]
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table (0027 must install its policies)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%app.actor_role%';
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names no role: that is the any-member FOR ALL policy of 0002, under which a shopkeeper token reads the distributor''s day and every other shop''s habits (reporting section 3 item 1)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND (   replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '<> ''retailer''::text', '') LIKE '%''retailer''%'
             OR replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), '<> ''retailer''::text', '') LIKE '%''retailer''%');
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that admits the retailer role; a shop never sees a report (reporting section 4 rule 14)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (d) the two cost-bearing rows admit no field role at all
  FOREACH t IN ARRAY ARRAY['daily_owner_stats', 'owner_summary']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''salesperson''%'
             OR COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''delivery''%'
             OR COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''warehouse''%'
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''salesperson''%'
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''delivery''%'
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''warehouse''%');
    IF n > 0 THEN
      RAISE EXCEPTION '% carries purchase cost and margin and has a policy that admits a field role (docs/22 section 9 never-list 1)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (e) the three query paths exist and lead with tenant_id
  FOREACH t IN ARRAY ARRAY['daily_rep_stats_day_idx', 'daily_retailer_stats_day_idx', 'retailer_behaviour_lapsed_idx']
  LOOP
    SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = t;
    IF def IS NULL OR def NOT LIKE '%(tenant_id,%' THEN
      RAISE EXCEPTION 'index % is missing or does not lead with tenant_id', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;

  -- (f) a day with nothing to report is a row of zeros; a mix not yet computed is absent
  FOREACH t IN ARRAY ARRAY['overdue_paise', 'partial_stops', 'on_time_stops', 'pod_stops', 'ordered_pcs', 'picked_pcs']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'daily_tenant_stats' AND column_name = t
        AND is_nullable = 'NO' AND column_default LIKE '0%'
    ) THEN
      RAISE EXCEPTION 'daily_tenant_stats.% must be NOT NULL DEFAULT 0 (0027)', t USING ERRCODE = 'not_null_violation';
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['by_brand', 'by_category', 'by_beat', 'by_payment_mode']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'daily_tenant_stats' AND column_name = t
        AND is_nullable = 'YES' AND data_type = 'jsonb'
    ) THEN
      RAISE EXCEPTION 'daily_tenant_stats.% must be nullable jsonb (0027)', t USING ERRCODE = 'undefined_column';
    END IF;
  END LOOP;

  -- (g) the arithmetic is a constraint, not service code
  FOREACH t IN ARRAY ARRAY[
    'daily_tenant_stats_counts_nonnegative', 'daily_retailer_stats_counts_nonnegative',
    'daily_owner_stats_margin_identity', 'daily_owner_stats_values_nonnegative'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND con.conname = t AND con.contype = 'c'
    ) THEN
      RAISE EXCEPTION 'check constraint % is missing (0027)', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  SELECT pg_get_constraintdef(con.oid) INTO def
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname = 'daily_owner_stats' AND con.conname = 'daily_owner_stats_margin_identity';
  IF def NOT LIKE '%gross_margin_paise%' OR def NOT LIKE '%net_sales_paise%' OR def NOT LIKE '%cogs_paise%' THEN
    RAISE EXCEPTION 'daily_owner_stats_margin_identity must tie gross_margin_paise to net_sales_paise - cogs_paise; found %', def
      USING ERRCODE = 'check_violation';
  END IF;

  -- (h) the guard is armed on both tables that name a shop
  FOREACH t IN ARRAY ARRAY['daily_retailer_stats', 'retailer_behaviour']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t AND tg.tgname = t || '_tenant_guard' AND NOT tg.tgisinternal
    ) THEN
      RAISE EXCEPTION '% has no tenant guard; a foreign-key check bypasses row security, so a cross-tenant rollup could file another tenant''s shop here', t
        USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
END;
$$;
