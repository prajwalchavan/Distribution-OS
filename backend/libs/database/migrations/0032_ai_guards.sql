-- Hand-written companion to 0031_ai_expand.sql: the guarantees drizzle-kit cannot express.
--
-- The `ai` module is the founder's decision of 2026-09-05 (docs/22 §8): every AI feature ships in v1 —
-- a shop's WhatsApp sentence or a rep's spoken one becomes a DRAFT order a human always confirms
-- (`ai_order_drafts`), the ledger becomes a reorder suggestion for purchase planning (`ai_forecasts`),
-- and a trip's stops get a proposed sequence the driver may override (`route_plans`).
--
-- Everything declarable in src/schema/ai.ts is in the GENERATED 0031 and is deliberately NOT repeated
-- here (docs/plans/00-coordination.md §2 rule 3): the three enums (`ai_draft_source`,
-- `ai_draft_status`, `route_plan_method`), the three tables, their foreign keys, the seven indexes and
-- every policy. This pair took 0031/0032, the next free numbers in meta/_journal.json at the moment it
-- was written (coordination §2 rule 2: the table of numbers is the plan, the journal is the truth).
--
-- What IS here, and why each piece is a grant, a trigger or an assertion rather than schema:
--
--   1. FORCE ROW LEVEL SECURITY and the runtime grants for the three new tables (coordination §8 item
--      5). ENABLE comes from `.enableRLS()` in 0031; without FORCE the owner connection — which runs
--      migrations, seeds and every `psql` session — bypasses every policy 0031 installed, and the
--      module's whole point is who may see a draft, a forecast and a route.
--
--   2. `dos_ai_draft_tenant_guard()` — a draft names a shop, an inbound message, an order and up to two
--      people. `users` is GLOBAL (one identity across every distributor, ADR 0006) so its foreign key
--      says nothing about tenancy, and a foreign-key check bypasses row security entirely, so the FKs
--      on `retailers`, `inbound_messages` and `sales_orders` do not prove same-tenant either. Without
--      this guard the worker (which parses inbound messages under `withSystem()`, BYPASSRLS, across
--      tenants) could file tenant B's shop and tenant B's message on a draft owned by tenant A, and
--      tenant A's desk would then read a stranger's order text — the never-list 9 failure in its
--      newest form. SECURITY DEFINER so the check sees rows whatever the caller's role may read, with
--      an explicit tenant comparison so the wider view never widens the rule (the twin of 0019 §2,
--      0022 §2, 0025 §3, 0028 §2 and 0030 §2).
--
--   3. `dos_ai_draft_review_guard()` — THE HUMAN-IN-THE-LOOP RULE, in the database. docs/22 §9
--      never-list 6 says document intake never commits on its own; the founder's AI decision repeats it
--      for order capture ("always human-confirmed"). So: a draft may not reach `confirmed` without a
--      reviewer, the moment they reviewed and the order they created; it may not reach `rejected`
--      without a reviewer and a reason; and an actor whose role is `system` may not confirm at all.
--      A model that decides it is sure enough is exactly what this refuses.
--
--   4. `dos_ai_forecast_tenant_guard()` — a forecast is per location; `product_variants` is global
--      curated data, but `locations` is a tenant table whose FK proves nothing about tenancy. The
--      forecast sweep runs cross-tenant like every other rollup, and a cursor bug there would file
--      tenant B's godown under tenant A, where tenant A's owner and warehouse read every row.
--
--   5. `dos_route_plan_guard()` — two rules RLS has no way to write:
--        (a) the trip belongs to this tenant and `applied_by` is a member of it (same reasoning as §2);
--        (b) THE CREW MAY ONLY APPLY. `route_plans_update` (0031) lets a delivery actor update the
--            plans of trips it is on, because that is the only way "apply" can be a write at all — but
--            RLS has no column granularity, so the same policy would let the crew rewrite the proposed
--            sequence, the distance and the method and pass it off as the plan the desk computed. The
--            guard holds a `delivery` actor to `applied_at`, `applied_by`, `overridden` and
--            `updated_at`, and refuses an `applied_by` that is not the actor themselves. Overriding the
--            route is a driver's right (founder, 2026-09-05); rewriting history is not.
--
--   6. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6, 0017 §3, 0019 §3, 0022 §3, 0025 §4,
--      0028 §3 and 0030 §4. The policy text of 0031 is generated from the schema; a later
--      `db:generate` against a drifted schema could quietly put a wide policy back — the role-less
--      any-member form of 0002, under which a shopkeeper token reads every other shop's draft and the
--      whole van's route — and no test that does not look for it would fail. So the migration refuses
--      to finish unless every rule below holds. See the DO block for the list.
--
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every
-- app_rw transaction. A connection with NO role set is the migrating/owner connection (seeds,
-- migrations, a DBA in psql): it bypasses RLS anyway; the guards of §2–§5 bind it all the same, except
-- the crew's column rule in §5(b), which is by definition about a `delivery` actor.

-- 1. FORCE RLS and the runtime grants for the three new tables.
ALTER TABLE "ai_order_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_forecasts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "route_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_order_drafts", "ai_forecasts", "route_plans" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_order_drafts", "ai_forecasts", "route_plans" TO app_worker;--> statement-breakpoint

-- 2. Every id on a draft belongs to the draft's own distributorship.
CREATE OR REPLACE FUNCTION dos_ai_draft_tenant_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  other text;
BEGIN
  IF NEW.retailer_id IS NOT NULL THEN
    SELECT tenant_id INTO other FROM retailers WHERE id = NEW.retailer_id;
    IF other IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'ai_order_drafts.retailer_id: shop % belongs to another distributorship', NEW.retailer_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.inbound_message_id IS NOT NULL THEN
    SELECT tenant_id INTO other FROM inbound_messages WHERE id = NEW.inbound_message_id;
    IF other IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'ai_order_drafts.inbound_message_id: message % belongs to another distributorship', NEW.inbound_message_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.created_order_id IS NOT NULL THEN
    SELECT tenant_id INTO other FROM sales_orders WHERE id = NEW.created_order_id;
    IF other IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'ai_order_drafts.created_order_id: order % belongs to another distributorship', NEW.created_order_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'ai_order_drafts.created_by: user % is not a member of this distributorship', NEW.created_by
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewed_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.reviewed_by
  ) THEN
    RAISE EXCEPTION 'ai_order_drafts.reviewed_by: user % is not a member of this distributorship', NEW.reviewed_by
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS ai_order_drafts_tenant_guard ON "ai_order_drafts";--> statement-breakpoint
CREATE TRIGGER ai_order_drafts_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, retailer_id, inbound_message_id, created_order_id, created_by, reviewed_by
  ON "ai_order_drafts"
  FOR EACH ROW EXECUTE FUNCTION dos_ai_draft_tenant_guard();--> statement-breakpoint

-- 3. Nothing the parser produced becomes an order without a person on it.
CREATE OR REPLACE FUNCTION dos_ai_draft_review_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    -- Only the TRANSITION into `confirmed` is forbidden to the parser. A worker job that later touches
    -- an already-confirmed draft (a PDF key, a sweep, a backfill) is not confirming anything, and
    -- refusing it here would make the rule a trap instead of a guarantee.
    IF (SELECT current_setting('app.actor_role', true)) = 'system'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
      RAISE EXCEPTION 'ai_order_drafts: the parser never confirms its own draft; a person does (docs/22 section 9)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'ai_order_drafts: a confirmed draft must name who reviewed it and when'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_order_id IS NULL THEN
      RAISE EXCEPTION 'ai_order_drafts: a confirmed draft must point at the order it created'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'rejected' THEN
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'ai_order_drafts: a rejected draft must name who rejected it and when'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reject_reason IS NULL OR btrim(NEW.reject_reason) = '' THEN
      RAISE EXCEPTION 'ai_order_drafts: a rejected draft must carry the reason'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS ai_order_drafts_review_guard ON "ai_order_drafts";--> statement-breakpoint
CREATE TRIGGER ai_order_drafts_review_guard
  BEFORE INSERT OR UPDATE ON "ai_order_drafts"
  FOR EACH ROW EXECUTE FUNCTION dos_ai_draft_review_guard();--> statement-breakpoint

-- 4. A forecast is filed against a location of its own distributorship.
CREATE OR REPLACE FUNCTION dos_ai_forecast_tenant_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  other text;
BEGIN
  SELECT tenant_id INTO other FROM locations WHERE id = NEW.location_id;
  IF other IS NULL THEN
    RAISE EXCEPTION 'ai_forecasts: location % does not exist', NEW.location_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF other <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ai_forecasts: location % belongs to another distributorship', NEW.location_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.horizon_days <= 0 THEN
    RAISE EXCEPTION 'ai_forecasts: horizon_days must be positive' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS ai_forecasts_tenant_guard ON "ai_forecasts";--> statement-breakpoint
CREATE TRIGGER ai_forecasts_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, location_id, horizon_days ON "ai_forecasts"
  FOR EACH ROW EXECUTE FUNCTION dos_ai_forecast_tenant_guard();--> statement-breakpoint

-- 5. A plan belongs to a trip of its own tenant, and the crew may only apply it.
CREATE OR REPLACE FUNCTION dos_route_plan_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  other text;
BEGIN
  SELECT tenant_id INTO other FROM trips WHERE id = NEW.trip_id;
  IF other IS NULL THEN
    RAISE EXCEPTION 'route_plans: trip % does not exist', NEW.trip_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF other <> NEW.tenant_id THEN
    RAISE EXCEPTION 'route_plans: trip % belongs to another distributorship', NEW.trip_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.applied_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.applied_by
  ) THEN
    RAISE EXCEPTION 'route_plans.applied_by: user % is not a member of this distributorship', NEW.applied_by
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (SELECT current_setting('app.actor_role', true)) = 'delivery' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.sequence IS DISTINCT FROM OLD.sequence
       OR NEW.total_distance_m IS DISTINCT FROM OLD.total_distance_m
       OR NEW.total_duration_s IS DISTINCT FROM OLD.total_duration_s
       OR NEW.computed_at IS DISTINCT FROM OLD.computed_at
    THEN
      RAISE EXCEPTION 'route_plans: the crew may apply or override a plan, never rewrite the one the desk computed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.applied_by IS DISTINCT FROM OLD.applied_by
       AND NEW.applied_by IS DISTINCT FROM (SELECT current_setting('app.actor_id', true))
    THEN
      RAISE EXCEPTION 'route_plans.applied_by: a crew member applies a plan as themselves'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS route_plans_guard ON "route_plans";--> statement-breakpoint
CREATE TRIGGER route_plans_guard
  BEFORE INSERT OR UPDATE ON "route_plans"
  FOR EACH ROW EXECUTE FUNCTION dos_route_plan_guard();--> statement-breakpoint

-- 6. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted and typed ('salesperson'::text), so the patterns below match the deparsed
--    text of what 0031 installed — and would match a wide policy put there by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
  def text;
BEGIN
  -- (a) FORCE on all three, each with at least one policy, and no policy that names no role
  FOREACH t IN ARRAY ARRAY['ai_order_drafts', 'ai_forecasts', 'route_plans']
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the policies of 0031 would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table (0031 must install its policies)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%app.actor_role%';
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names no role: that is the any-member form of 0002, under which a shopkeeper token reads every draft, every forecast and every route of the distributorship', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (b) a draft is order capture: the godown and the crew take no orders and appear in no policy here
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_order_drafts'
      AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''(warehouse|delivery)'''
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''(warehouse|delivery)''');
  IF n > 0 THEN
    RAISE EXCEPTION 'ai_order_drafts has a policy naming the warehouse or the delivery role; neither takes an order, and a draft carries a shop''s words'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- ...and the rep and the shop reach it ONLY by owning the row (its own capture, its own beat, its own shop)
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_order_drafts' AND p.polcmd = 'r'
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%app.actor_id%';
  IF n = 0 THEN
    RAISE EXCEPTION 'ai_order_drafts has no own-row SELECT policy; a rep would read every beat''s drafts and a shop every other shop''s'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- ...and a draft is rejected, never erased: no DELETE policy at all (the retention sweep is app_worker)
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_order_drafts' AND p.polcmd IN ('*', 'd');
  IF n > 0 THEN
    RAISE EXCEPTION 'ai_order_drafts has a DELETE (or FOR ALL) policy; a draft is rejected with a reason, never deleted — the 180-day sweep runs as app_worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c) a forecast is purchase planning: the desk and the godown read it, nobody in the field, and no
  --     shop ever learns what its distributor is about to buy; only the worker writes it
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_forecasts'
      AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''(salesperson|delivery|retailer)'''
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''(salesperson|delivery|retailer)''');
  IF n > 0 THEN
    RAISE EXCEPTION 'ai_forecasts has a policy naming a field or shop role; a demand forecast is the distributor''s buying plan'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_forecasts'
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%app.actor_id%';
  IF n > 0 THEN
    RAISE EXCEPTION 'ai_forecasts has an own-row policy; a forecast belongs to nobody in particular and is reached by role alone'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_forecasts' AND p.polcmd IN ('*', 'a', 'w', 'd')
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') !~ '''system''';
  IF n > 0 THEN
    RAISE EXCEPTION 'ai_forecasts has a write policy that does not require the system role; the cache is the worker sweep''s alone, and an app_rw request enqueues a job instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_forecasts' AND p.polcmd IN ('*', 'a', 'w', 'd')
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') ~ '''(owner|manager|accountant|warehouse)''';
  IF n > 0 THEN
    RAISE EXCEPTION 'ai_forecasts has a write policy that admits the desk or the godown; nobody edits a computed forecast by hand'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (d) a route plan lists the other shops on the same van: no rep, no shop, and the crew only by trip
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'route_plans'
      AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''(salesperson|retailer|warehouse)'''
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''(salesperson|retailer|warehouse)''');
  IF n > 0 THEN
    RAISE EXCEPTION 'route_plans has a policy naming a rep, a shop or the godown; a route names every shop on the van and the hour it is carrying their goods'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'route_plans' AND p.polcmd = 'r'
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%app.actor_id%';
  IF n = 0 THEN
    RAISE EXCEPTION 'route_plans has no crew-scoped SELECT policy; a delivery actor would read every van''s route or none'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'route_plans' AND p.polcmd IN ('*', 'a')
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%app.actor_id%';
  IF n > 0 THEN
    RAISE EXCEPTION 'route_plans has an INSERT (or FOR ALL) policy scoped to the actor; the desk computes a plan, the crew only applies one'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'route_plans' AND p.polcmd IN ('*', 'd');
  IF n > 0 THEN
    RAISE EXCEPTION 'route_plans has a DELETE (or FOR ALL) policy; a plan is superseded, never erased'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (e) the indexes the module reads through exist and lead with the tenant (coordination §8 item 6)
  FOREACH t IN ARRAY ARRAY[
    'ai_order_drafts_idempotency_idx', 'ai_order_drafts_status_idx', 'ai_order_drafts_inbound_idx',
    'ai_forecasts_key_idx', 'ai_forecasts_cover_idx', 'route_plans_trip_idx', 'route_plans_applied_idx'
  ]
  LOOP
    SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = t;
    IF def IS NULL THEN
      RAISE EXCEPTION 'index % is missing (0031)', t USING ERRCODE = 'undefined_object';
    END IF;
    IF def NOT LIKE '%(tenant_id,%' THEN
      RAISE EXCEPTION 'index % does not lead with tenant_id', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  -- the two uniqueness guarantees a retry depends on
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ai_order_drafts_idempotency_idx';
  IF def NOT LIKE 'CREATE UNIQUE INDEX%' THEN
    RAISE EXCEPTION 'ai_order_drafts_idempotency_idx is not UNIQUE; an offline replay would file the same capture twice'
      USING ERRCODE = 'undefined_object';
  END IF;
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'route_plans_applied_idx';
  IF def NOT LIKE 'CREATE UNIQUE INDEX%' OR def NOT LIKE '%applied_at IS NOT NULL%' THEN
    RAISE EXCEPTION 'route_plans_applied_idx must be a partial UNIQUE index on the applied plans; a trip runs one route'
      USING ERRCODE = 'undefined_object';
  END IF;

  -- (f) expand-only, and the columns the human-in-the-loop rule stands on exist and stay nullable
  FOREACH t IN ARRAY ARRAY['reviewed_by', 'reviewed_at', 'reject_reason', 'created_order_id']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_order_drafts' AND column_name = t AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'ai_order_drafts.% must exist and be nullable (a draft starts with none of them)', t
        USING ERRCODE = 'undefined_column';
    END IF;
  END LOOP;

  -- (g) the guards are armed
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_order_drafts' AND tg.tgname = 'ai_order_drafts_tenant_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ai_order_drafts has no tenant guard; the cross-tenant parser could file another distributorship''s shop here'
      USING ERRCODE = 'undefined_object';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_order_drafts' AND tg.tgname = 'ai_order_drafts_review_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ai_order_drafts has no review guard; a parsed draft could confirm itself into an order (docs/22 section 9)'
      USING ERRCODE = 'undefined_object';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ai_forecasts' AND tg.tgname = 'ai_forecasts_tenant_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ai_forecasts has no tenant guard; the cross-tenant sweep could file another distributorship''s godown here'
      USING ERRCODE = 'undefined_object';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'route_plans' AND tg.tgname = 'route_plans_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'route_plans has no guard; the crew could rewrite the plan the desk computed and pass it off as the route'
      USING ERRCODE = 'undefined_object';
  END IF;
END;
$$;
