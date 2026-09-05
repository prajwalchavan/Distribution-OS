-- Hand-written companion to 0014_delivery_expand.sql: the guarantees drizzle-kit cannot express.
-- Everything declarable in src/schema/*.ts — the `trip_settlement` approval kind, the five new columns,
-- the three indexes and the 41 policies (38 created, 3 altered in place) that replace the wide `*_tenant`
-- FOR ALL policies on the eleven delivery tables — is in the GENERATED 0014 and is deliberately NOT
-- repeated here
-- (docs/plans/00-coordination.md §2 rule 3). Generating 0014 needs a TTY (drizzle-kit asks "created or
-- renamed?" once per new policy on a table that also loses one; every answer is "created"); drive it with
-- expect when there is no terminal.
--
-- HOW THIS FILE WAS MADE, so the next `db:generate` emits nothing for delivery. The two backfilled columns
-- are declared `notNull()` in the schema, but a `NOT NULL` add fails on the founder's populated tables, so
-- 0014 was generated with them nullable, the schema was then flipped to `notNull()`, and `db:generate` was
-- run a second time: it produced exactly the two `SET NOT NULL` statements below and the
-- `meta/0015_snapshot.json` that records the post-backfill state. This file replaces that second generated
-- SQL with the backfill IN FRONT of those two statements, and keeps drizzle's own snapshot; nothing in
-- `meta/` was edited by hand.
--
-- What is here, and why each piece is a backfill, a trigger or an assertion rather than schema:
--   1. Backfill `deliveries.retailer_id` from the stop and `trip_points.device_id` to '' (an unknown phone),
--      then the two `SET NOT NULL` statements drizzle generated.
--   2. `dos_deliveries_retailer_guard()` — the denormalised `retailer_id` is the column the SHOP's read
--      policy keys on (never-list 9: a retailer sees only rows linked to its own shop), so it must always
--      equal the stop's shop, and the delivery must sit on the stop's trip. A column-vs-other-table rule
--      cannot be a CHECK or a policy, hence a trigger.
--   3. `dos_trip_settlement_guard()` — "a red settlement cannot close the trip without the owner"
--      (docs/plans/delivery.md §4 rule 16): cash outside the tenant's tolerance, or ANY van stock that does
--      not tally, is `has_variance = true`, and such a row carries the OWNER's approval, signed by the
--      owner's own actor id. The cash arithmetic (`variance = handed over − expected`) is checked too.
--   4. Migration 0014 also gave `trip_settlements` the approval columns; every settlement already closed
--      with a variance is stamped with the person who settled it (that WAS the acceptance at the time).
--   5. FORCE ROW LEVEL SECURITY + grants re-asserted for the eleven tables (all no-ops on this database,
--      all idempotent, all the difference between a guarantee and a wish on a database where FORCE was
--      turned off by hand).
--   6. A migrate-time assertion, the twin of 0011 §2 and 0013 §6: none of the eleven tables carries a
--      FOR ALL policy, each has a SELECT and an INSERT policy, and NO policy predicate on any of them
--      names the salesperson — the executable form of "nothing in the delivery module is visible to a rep
--      beyond the stop status of its shops" (`trip_stops_read` says `NOT IN ('delivery', 'retailer')` for
--      the roles that see every stop, then scopes the crew to its own trips and the shop to its own
--      stops; it names no rep).
--
-- Because drizzle runs every pending migration inside ONE transaction, this file must not USE the enum
-- value 0014 adds (`'trip_settlement'::approval_kind`): Postgres refuses a new enum value inside the
-- transaction that added it. It does not; the first user is the seed (a separate transaction).
--
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every
-- app_rw transaction. A connection with NO role set is the migrating/owner connection (seeds, migrations,
-- a DBA in psql) — it bypasses RLS anyway, so the role-based checks below treat '' like `system`; the
-- structural checks (a red settlement without an approval, a delivery on the wrong shop) apply to everyone
-- including that connection.

-- 1. Backfill, then NOT NULL. Every delivery already sits on a stop (`stop_id` is NOT NULL with a FK), so
--    the stop's shop is the delivery's shop. Points recorded before phones were told apart carry '' as
--    their device: they stay distinct under `trip_points_dedupe_idx` because no two of them share a
--    `recorded_at` within a trip (verified on the founder's database before this migration was written;
--    on any other database a clash here aborts the migration loudly rather than dropping a point).
UPDATE "deliveries" d SET retailer_id = s.retailer_id
  FROM "trip_stops" s
  WHERE s.id = d.stop_id AND d.retailer_id IS NULL;--> statement-breakpoint
UPDATE "trip_points" SET device_id = '' WHERE device_id IS NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "retailer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_points" ALTER COLUMN "device_id" SET NOT NULL;--> statement-breakpoint

-- 2. A delivery is always about the stop's shop, on the stop's trip. Fills `retailer_id` when the writer
--    left it out (a BEFORE trigger runs before the NOT NULL check) and refuses a value that disagrees.
--    Runs with the caller's rights on purpose: every role that may INSERT a delivery (owner, manager,
--    system, the crew of the trip) reads `trip_stops`, and an invisible stop raises "not found" — loud,
--    never a silent pass.
CREATE OR REPLACE FUNCTION dos_deliveries_retailer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stop_shop text;
  stop_trip text;
BEGIN
  SELECT s.retailer_id, s.trip_id INTO stop_shop, stop_trip
    FROM trip_stops s
    WHERE s.id = NEW.stop_id AND s.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery %: stop % is not a stop of this tenant (or not visible to this actor)', NEW.id, NEW.stop_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.retailer_id IS NULL THEN
    NEW.retailer_id := stop_shop;
  ELSIF NEW.retailer_id <> stop_shop THEN
    RAISE EXCEPTION 'delivery %: retailer_id % is not the shop of stop % (%); a delivery is always about the stop''s shop', NEW.id, NEW.retailer_id, NEW.stop_id, stop_shop
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.trip_id <> stop_trip THEN
    RAISE EXCEPTION 'delivery %: stop % belongs to trip %, not trip %', NEW.id, NEW.stop_id, stop_trip, NEW.trip_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS deliveries_retailer_guard ON "deliveries";--> statement-breakpoint
CREATE TRIGGER deliveries_retailer_guard BEFORE INSERT OR UPDATE ON "deliveries" FOR EACH ROW EXECUTE FUNCTION dos_deliveries_retailer_guard();--> statement-breakpoint

-- 3. The settlement rules the database keeps regardless of which service, worker or seed writes the row:
--      (a) `cash_variance_paise` is `handed_over_cash_paise − expected_cash_paise`, to the paisa;
--      (b) ANY lot whose counted pieces differ from the expected pieces makes the settlement red
--          (`has_variance`), whatever the rupee value (coordination §7 q14, delivery §8 item 4), and so
--          does cash outside the tenant's `delivery.settlement_tolerance_paise` (the bootstrap default,
--          ₹100, applies when the row is absent or unreadable);
--      (c) a red settlement carries the owner's approval: an owner writing one IS the approval — both
--          columns are filled from the actor, so `delivery.trips.settle` with `acceptVariance` stays one
--          step — while a manager, an accountant, the worker or a seed writing a red row without an
--          approval is refused (`settlement_needs_owner`);
--      (d) only an owner (or the system / the migrating connection) writes the approval columns, an owner
--          signs with its own actor id, and the two columns travel together.
CREATE OR REPLACE FUNCTION dos_trip_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  role text := COALESCE(current_setting('app.actor_role', true), '');
  actor text := COALESCE(current_setting('app.actor_id', true), '');
  tolerance bigint;
  stock_off boolean;
  approval_changed boolean;
BEGIN
  IF NEW.cash_variance_paise <> NEW.handed_over_cash_paise - NEW.expected_cash_paise THEN
    RAISE EXCEPTION 'trip settlement %: cash_variance_paise (%) must equal handed_over_cash_paise (%) minus expected_cash_paise (%)', NEW.id, NEW.cash_variance_paise, NEW.handed_over_cash_paise, NEW.expected_cash_paise
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT (value #>> '{}')::bigint INTO tolerance
    FROM tenant_settings
    WHERE tenant_id = NEW.tenant_id AND key = 'delivery.settlement_tolerance_paise'
      AND jsonb_typeof(value) = 'number';
  tolerance := COALESCE(tolerance, 10000);
  SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.stock_variance, '[]'::jsonb)) e
      WHERE COALESCE((e ->> 'expectedPcs')::bigint, 0) <> COALESCE((e ->> 'countedPcs')::bigint, 0)
    ) INTO stock_off;
  IF NOT NEW.has_variance AND (stock_off OR abs(NEW.cash_variance_paise) > tolerance) THEN
    RAISE EXCEPTION 'trip settlement %: cash variance % paise (tolerance %) or a van stock miscount makes it a variance settlement; has_variance must be true and the owner must accept it', NEW.id, NEW.cash_variance_paise, tolerance
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    approval_changed := NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL;
  ELSE
    approval_changed := NEW.approved_by IS DISTINCT FROM OLD.approved_by
                     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at;
  END IF;
  IF approval_changed THEN
    IF role NOT IN ('', 'system', 'owner') THEN
      RAISE EXCEPTION 'trip settlement %: only the owner accepts a variance; a % actor may not write the approval', NEW.id, role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF role = 'owner' AND NEW.approved_by IS NOT NULL AND NEW.approved_by <> actor THEN
      RAISE EXCEPTION 'trip settlement %: an approval is signed by the owner who gives it (approved_by % is not the actor %)', NEW.id, NEW.approved_by, actor
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.has_variance AND NEW.approved_by IS NULL THEN
    IF role = 'owner' THEN
      NEW.approved_by := actor;
      NEW.approved_at := now();
    ELSE
      RAISE EXCEPTION 'settlement_needs_owner: trip settlement % has a variance and no owner approval (approved_by / approved_at); a % actor cannot close it', NEW.id, COALESCE(NULLIF(role, ''), 'system')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF (NEW.approved_by IS NULL) <> (NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'trip settlement %: approved_by and approved_at are set together', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- 4. Backfill BEFORE the trigger exists: the settlements already closed with a variance were accepted by
--    whoever settled them, under the rules of that day. Expand-only: fills two new columns, moves nothing.
UPDATE "trip_settlements" SET approved_by = settled_by, approved_at = settled_at
  WHERE has_variance AND approved_by IS NULL AND settled_by IS NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS trip_settlements_guard ON "trip_settlements";--> statement-breakpoint
CREATE TRIGGER trip_settlements_guard BEFORE INSERT OR UPDATE ON "trip_settlements" FOR EACH ROW EXECUTE FUNCTION dos_trip_settlement_guard();--> statement-breakpoint

-- 5. FORCE RLS and the runtime grants, re-asserted for every delivery table (0003 already did both;
--    0001/0003's ALTER DEFAULT PRIVILEGES grant; explicit and idempotent so the eleven tables are correct
--    on a database whose defaults were changed by hand).
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trips" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_stops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pod_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_expenses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_settlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_points" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_positions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicles", "trips", "trip_stops", "deliveries", "delivery_lines", "pod_evidence", "collections", "trip_expenses", "trip_settlements", "trip_points", "vehicle_positions" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicles", "trips", "trip_stops", "deliveries", "delivery_lines", "pod_evidence", "collections", "trip_expenses", "trip_settlements", "trip_points", "vehicle_positions" TO app_worker;--> statement-breakpoint

-- 6. THE ASSERTION. 0014's policy work is generated from the schema; a later `db:generate` against a
--    drifted schema could quietly put a wide FOR ALL policy back, or widen an IN-list to the rep, and no
--    test that does not look for it would fail. So the migration refuses to finish while any of the
--    eleven tables (a) does not FORCE row level security, (b) carries a FOR ALL policy, (c) lacks a
--    SELECT or an INSERT policy, or (d) has any policy predicate that names the salesperson role.
DO $$
DECLARE t text; wide int; sel int; ins int; forced boolean; rep int;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicles', 'trips', 'trip_stops', 'deliveries', 'delivery_lines', 'pod_evidence',
    'collections', 'trip_expenses', 'trip_settlements', 'trip_points', 'vehicle_positions'
  ]
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the delivery policies would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) FILTER (WHERE p.polcmd = '*'),
           count(*) FILTER (WHERE p.polcmd = 'r'),
           count(*) FILTER (WHERE p.polcmd = 'a'),
           count(*) FILTER (WHERE pg_get_expr(p.polqual, p.polrelid) LIKE '%''salesperson''%'
                               OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%''salesperson''%')
      INTO wide, sel, ins, rep
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t;
    IF wide > 0 THEN
      RAISE EXCEPTION '% still carries a FOR ALL policy; a shopkeeper or a rep could read the trip, its cash or its proof (coordination section 5.3)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF sel = 0 OR ins = 0 THEN
      RAISE EXCEPTION '% needs both a SELECT and an INSERT policy after 0014 (found % select, % insert)', t, sel, ins
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF rep > 0 THEN
      RAISE EXCEPTION '% has a policy that names the salesperson; a rep sees nothing of the delivery module beyond the stop status of its shops (docs/17 D4)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
END;
$$;
