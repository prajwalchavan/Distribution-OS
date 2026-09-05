-- Hand-written companion to 0029_incentives_expand.sql: the guarantees drizzle-kit cannot express.
--
-- Everything declarable in src/schema/incentives.ts is in the GENERATED 0029 and is deliberately NOT
-- repeated here (docs/plans/00-coordination.md §2 rule 3): `ALTER TYPE target_metric ADD VALUE 'visits'`
-- (the founder's slab dimensions name visits — beat calls made — and the enum had only `outlets`,
-- distinct shops billed; both stay, they are different numbers), `targets.name` and
-- `targets.created_by` (a target reads as a label and names who assigned it),
-- `targets_tenant_period_idx` on (tenant_id, period_from, period_to) — the only existing index leads
-- with `user_id`, so the owner's un-filtered target list and the team leaderboard, both tenant-wide,
-- would seq-scan — and the policy split coordination §2 row 0024 and §5.3 assign to this slice:
--
--   computed_payouts  `computed_payouts_back_office` (FOR ALL, BACK_OFFICE_ROLES)
--                     → `computed_payouts_read`  (SELECT: back office OR user_id = the actor)
--                     + `computed_payouts_write_{insert,update,delete}` (BACK_OFFICE_ROLES)
--
-- Under the old policy the salesperson or delivery member a statement is ABOUT could not read it at
-- all — which is the one screen the table exists for (docs/06 and docs/23 S9/D12: "target, achievement,
-- computed incentive" on the rep's own Performance tab). The split widens nothing: the own-row branch
-- is SELECT only, and money promised to staff is still written by the desk alone. Permissive policies
-- OR together, so a read policy never grants a write. Generating 0029 prompted on the four new
-- policies (create vs rename); the run was driven with expect, answering "create" each time, so the
-- old policy is DROPped and the four are CREATEd rather than one being silently renamed into another
-- shape. This pair landed as 0029/0030 (coordination §2 relative slot 0023/0024, shifted by the
-- platform-gaps, outbox-relay, integrations-wizard and claims-cancel slices).
--
-- What IS here, and why each piece is a grant, a trigger or an assertion rather than schema:
--   1. FORCE ROW LEVEL SECURITY and the runtime grants re-asserted for the three incentives tables
--      (coordination §8 item 5). 0003 forced all three; explicit and idempotent so they are still
--      correct on a database whose defaults were changed by hand — without FORCE, the owner connection
--      bypasses every policy 0029 installed.
--   2. `dos_incentives_member_guard()` — a target and a statement name a person of THIS
--      distributorship. `targets.user_id`, `targets.created_by`, `computed_payouts.user_id` and
--      `computed_payouts.approved_by` all point at the GLOBAL `users` table (a user is one identity
--      across every distributor, ADR 0006), so the foreign key says nothing about tenancy — and a
--      foreign-key check bypasses row security anyway. Without this, the hourly sweep (which runs
--      BYPASSRLS across tenants, incentives §7), a seed or the owner connection could file a target or
--      a payout under tenant A naming a person who works for tenant B, and tenant A's owner would then
--      read a stranger's number in their payout register. SECURITY DEFINER so the check sees the
--      membership whatever the caller's role may read, with an explicit tenant comparison so the wider
--      view never widens the rule (the twin of 0019 §2, 0022 §2, 0025 §3 and 0028 §2). Membership
--      EXISTENCE is the database's rule; "an ACTIVE salesperson or delivery member" stays the
--      application's 400 (incentives §2), because a rep who leaves must keep the statement they earned.
--   3. `dos_incentives_achievement_tenant_guard()` — an achievement row hangs off a target of its own
--      tenant. `achievements` is written only by the worker sweep, which iterates tenants under
--      `withSystem()`; a cursor bug there would otherwise file tenant B's achieved value under tenant A,
--      where tenant A's back office reads every row.
--   4. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6, 0017 §3, 0019 §3, 0022 §3, 0025 §4 and
--      0028 §3. The policy text of 0029 is generated from the schema; a later `db:generate` against a
--      drifted schema could quietly put a wide policy back — a role-scoped SELECT that lets EVERY rep
--      read EVERY other rep's target, achievement and payout (what a rep earns is the most personal
--      number in the product), or a write policy that lets a rep edit the money promised to them — and
--      no test that does not look for it would fail. So the migration refuses to finish unless:
--        (a) all three incentives tables FORCE row level security;
--        (b) each carries at least one policy, and every policy on them names `app.actor_role` — none
--            is the role-less any-member form of 0002;
--        (c) NO policy on any of the three names the `retailer` or the `warehouse` role: incentives is
--            the field force's own performance data, a shop is a customer and the godown does not run
--            a beat (incentives §1 — both roles get the same 403, and neither service mounts the
--            module);
--        (d) NO policy on any of the three names `salesperson` or `delivery` either, and each table
--            carries a policy naming `app.actor_id`: a field role reaches these tables ONLY through an
--            own-row predicate, never by virtue of being a rep. This is the database half of "a rep
--            sees its own progress and never another rep's";
--        (e) `computed_payouts` carries no FOR ALL policy any more (the split of coordination §2 row
--            0024 actually happened — a FOR ALL policy applies one predicate to reads AND writes, which
--            is exactly why the rep could not be let in before), and its SELECT policy names
--            `app.actor_id` while none of its INSERT/UPDATE/DELETE policies does: the rep reads, the
--            desk writes;
--        (f) every write policy on `achievements` admits `system` and nothing else — the cache is the
--            worker's alone, which is why `targets.refresh` enqueues a job instead of writing it from
--            an `app_rw` request (incentives §2, §4 rule 11);
--        (g) `targets_tenant_period_idx` exists and leads with `tenant_id` (coordination §8 item 6);
--        (h) `target_metric` carries both `visits` and `outlets`;
--        (i) `targets.name` and `targets.created_by` exist and are NULLABLE — migrations are
--            expand-only, so the targets already on disk must stay valid rows.
--        (j) both guards of §2 and §3 are armed.
--
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every
-- app_rw transaction. A connection with NO role set is the migrating/owner connection (seeds,
-- migrations, a DBA in psql): it bypasses RLS anyway; the guards of §2 and §3 bind it all the same.

-- 1. FORCE RLS and the runtime grants for the three incentives tables.
ALTER TABLE "targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "achievements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "computed_payouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "targets", "achievements", "computed_payouts" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "targets", "achievements", "computed_payouts" TO app_worker;--> statement-breakpoint

-- 2. A target and a statement name a person of this distributorship. TG_ARGV[0] is the row's second
--    person column (who assigned it / who approved it), read generically so one function serves both
--    tables; it is optional on both.
CREATE OR REPLACE FUNCTION dos_incentives_member_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  second_person text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION '%: user % is not a member of this distributorship', TG_TABLE_NAME, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_NARGS > 0 THEN
    second_person := to_jsonb(NEW) ->> TG_ARGV[0];
    IF second_person IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.tenant_id = NEW.tenant_id AND m.user_id = second_person
    ) THEN
      RAISE EXCEPTION '%.%: user % is not a member of this distributorship',
        TG_TABLE_NAME, TG_ARGV[0], second_person
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS targets_member_guard ON "targets";--> statement-breakpoint
CREATE TRIGGER targets_member_guard
  BEFORE INSERT OR UPDATE OF user_id, created_by, tenant_id ON "targets"
  FOR EACH ROW EXECUTE FUNCTION dos_incentives_member_guard('created_by');--> statement-breakpoint
DROP TRIGGER IF EXISTS computed_payouts_member_guard ON "computed_payouts";--> statement-breakpoint
CREATE TRIGGER computed_payouts_member_guard
  BEFORE INSERT OR UPDATE OF user_id, approved_by, tenant_id ON "computed_payouts"
  FOR EACH ROW EXECUTE FUNCTION dos_incentives_member_guard('approved_by');--> statement-breakpoint

-- 3. An achievement hangs off a target of its own tenant (the worker sweep crosses tenants).
CREATE OR REPLACE FUNCTION dos_incentives_achievement_tenant_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t_tenant text;
BEGIN
  SELECT tenant_id INTO t_tenant FROM targets WHERE id = NEW.target_id;
  IF t_tenant IS NULL THEN
    RAISE EXCEPTION 'achievements: target % does not exist', NEW.target_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF t_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'achievements: target % belongs to another tenant', NEW.target_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS achievements_tenant_guard ON "achievements";--> statement-breakpoint
CREATE TRIGGER achievements_tenant_guard
  BEFORE INSERT OR UPDATE OF target_id, tenant_id ON "achievements"
  FOR EACH ROW EXECUTE FUNCTION dos_incentives_achievement_tenant_guard();--> statement-breakpoint

-- 4. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted and typed ('salesperson'::text), so the patterns below match the deparsed
--    text of what 0029 installed — and would match a wide policy put there by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
  def text;
BEGIN
  -- (a) FORCE on all three
  FOREACH t IN ARRAY ARRAY['targets', 'achievements', 'computed_payouts']
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the policies of 0029 would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (b) every table has a policy and none of them is the role-less any-member form;
  -- (c) none names the retailer or the warehouse role;
  -- (d) none names a field role, and each table lets the field in only by owning the row
  FOREACH t IN ARRAY ARRAY['targets', 'achievements', 'computed_payouts']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table (0029 must install its policies)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%app.actor_role%';
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names no role: that is the any-member form of 0002, under which every member reads what every rep earns', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''(retailer|warehouse)'''
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''(retailer|warehouse)''');
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names the retailer or the warehouse role; incentives is the field force''s own performance data and neither role may reach it (incentives section 1)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''(salesperson|delivery)'''
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''(salesperson|delivery)''');
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that admits a field role by its role; a rep reaches this table only by owning the row, otherwise every rep reads every other rep''s numbers', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%app.actor_id%';
    IF n = 0 THEN
      RAISE EXCEPTION '% has no own-row policy; the rep whose numbers these are could not read them (docs/23 S9, D12)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (e) the split of coordination section 2 row 0024: reads let the rep in, writes are the desk's
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'computed_payouts' AND p.polcmd = '*';
  IF n > 0 THEN
    RAISE EXCEPTION 'computed_payouts still carries a FOR ALL policy; one predicate for reads and writes is what kept the rep out of their own statement (coordination section 2 row 0024)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'computed_payouts' AND p.polcmd = 'r'
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%app.actor_id%';
  IF n = 0 THEN
    RAISE EXCEPTION 'computed_payouts has no SELECT policy naming app.actor_id; the rep cannot read their own statement'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'computed_payouts' AND p.polcmd IN ('a', 'w', 'd')
      AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%app.actor_id%'
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%app.actor_id%');
  IF n > 0 THEN
    RAISE EXCEPTION 'computed_payouts has a write policy scoped to the actor''s own row; nobody edits the money promised to themselves'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (f) the achievement cache is the worker's alone
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'achievements' AND p.polcmd IN ('*', 'a', 'w', 'd')
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') NOT LIKE '%''system''%';
  IF n > 0 THEN
    RAISE EXCEPTION 'achievements has a write policy that does not require the system role; the cache is written by the worker sweep alone (incentives section 4 rule 11)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'achievements' AND p.polcmd IN ('*', 'a', 'w', 'd')
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') ~ '''(owner|manager|accountant)''';
  IF n > 0 THEN
    RAISE EXCEPTION 'achievements has a write policy that admits the desk; an app_rw request must enqueue the recompute job, never write the cache'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (g) the tenant-wide reads have an index that leads with the tenant
  SELECT indexdef INTO def FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'targets_tenant_period_idx';
  IF def IS NULL OR def NOT LIKE '%(tenant_id,%' THEN
    RAISE EXCEPTION 'index targets_tenant_period_idx is missing or does not lead with tenant_id' USING ERRCODE = 'undefined_object';
  END IF;

  -- (h) both dimensions of the founder's slab table exist
  FOREACH t IN ARRAY ARRAY['visits', 'outlets']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
      WHERE ty.typname = 'target_metric' AND e.enumlabel = t
    ) THEN
      RAISE EXCEPTION 'target_metric is missing the label % (0029)', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;

  -- (i) expand-only: the two new target columns are nullable, so every target already on disk is still a row
  FOREACH t IN ARRAY ARRAY['name', 'created_by']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'targets' AND column_name = t
        AND is_nullable = 'YES' AND data_type = 'text'
    ) THEN
      RAISE EXCEPTION 'targets.% must exist as nullable text (0029; migrations are expand-only)', t USING ERRCODE = 'undefined_column';
    END IF;
  END LOOP;

  -- (j) the guards are armed
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'targets' AND tg.tgname = 'targets_member_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'targets has no member guard; a target could name a person of another distributorship' USING ERRCODE = 'undefined_object';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'computed_payouts' AND tg.tgname = 'computed_payouts_member_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'computed_payouts has no member guard; a payout could name a person of another distributorship' USING ERRCODE = 'undefined_object';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'achievements' AND tg.tgname = 'achievements_tenant_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'achievements has no tenant guard; the cross-tenant sweep could file another tenant''s achievement here' USING ERRCODE = 'undefined_object';
  END IF;
END;
$$;
