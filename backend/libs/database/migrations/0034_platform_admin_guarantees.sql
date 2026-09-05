-- Hand-written companion to 0033_platform_admin_expand.sql: the guarantees drizzle-kit cannot express.
--
-- MODULE 13, the platform console (founder decision 2026-09-05, docs/22 §2 row 7 and §8): a seventh app
-- and service for onboarding a distributor, recording plan and subscription state, and granting our own
-- staff TIME-BOXED, OWNER-APPROVED, AUDITED access to a tenant. Revenue stays a subscription; there is
-- no fintech, and nothing in this pair charges anybody.
--
-- Everything declarable in src/schema/platform-admin.ts (and the two new columns on `tenants`) is in the
-- GENERATED 0033 and is deliberately NOT repeated here (docs/plans/00-coordination.md §2 rule 3): the
-- three new enums, the two appended `tenant_plan` values, the four tables, their foreign keys, the ten
-- indexes and every policy. This pair took 0033/0034, the next free numbers in meta/_journal.json at the
-- moment it was written (coordination §2 rule 2: the table of numbers is the plan, the journal is the
-- truth — an extra slice ran before this one, so the numbers in the brief no longer applied).
--
-- What IS here, and why each piece is a grant, a trigger or an assertion rather than schema:
--
--   1. FORCE ROW LEVEL SECURITY and the runtime grants for the four new tables (coordination §8 item 5).
--      ENABLE comes from `.enableRLS()` in 0033; without FORCE the owner connection — which runs
--      migrations, seeds and every psql session — bypasses every policy, and these four tables are the
--      ones that say who among OUR staff may look at a customer's business at all.
--
--   2. `dos_platform_admin_guard()` — who may hand out a console account. RLS can say "a platform admin
--      writes this table"; it cannot say "and only a SUPER one, and never their own row". Without the
--      second half, a `billing` or `support` admin could promote themselves to `super`, or clear their
--      own `disabled_at` after being removed. The seed's founding row is written by the migrating
--      connection, which has no `app.actor_role` and is therefore not bound by the super rule — that is
--      the deliberate bootstrap, and the only way the first administrator can exist.
--
--   3. `dos_subscription_guard()` — the arithmetic of a subscription row: seats and price are never
--      negative (money is integer paise, docs/22 §9), a trial says when it ends, a period ends after it
--      starts, and `updated_by` is one of ours. None of this is expressible as a policy.
--
--   4. `dos_support_grant_guard()` — THE FOUNDER'S SUPPORT RULE, in the database rather than in a
--      service that could be bypassed by the next endpoint someone writes:
--        (a) the requester is an active platform administrator;
--        (b) TIME-BOXED: the window ends after it starts and at most 30 days after it. A "time-boxed"
--            grant whose requester may set the expiry to 2099 is not time-boxed;
--        (c) OWNER-APPROVED: `approved_by` and `approved_at` are set together, `approved_by` holds an
--            ACTIVE OWNER membership of that very tenant, and never the requester themselves;
--        (d) a `platform_admin` actor may NEVER write the approval columns — not on insert, not on
--            update. Requesting and approving are two people in two different companies;
--        (e) an `owner` actor may touch ONLY the four decision columns (approve, revoke) and must do so
--            under their own id. RLS has no column granularity, so without this the same policy that
--            lets an owner approve would let them re-scope the grant to `read_write`, push the expiry
--            out, or rewrite the reason our person gave;
--        (f) an approval is revoked, never un-done, and a revoked grant is closed for good.
--
--   5. `dos_platform_audit_guard()` plus `dos_reject_mutation()` — the audited third. A row is filed
--      under a real administrator (the policy in 0033 already pins it to the ACTING one) and the table
--      is append-only for every role including the owner connection, exactly like the stock ledger, the
--      journal, `audit_log` and `auth_events`. `support_grants` and `platform_admins` refuse DELETE for
--      the same reason: a grant is revoked and kept, an administrator is disabled and kept, or the trail
--      loses the people it names.
--
--   6. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6, 0017 §3, 0019 §3, 0022 §3, 0025 §4,
--      0028 §3, 0030 §4 and 0032 §6. The policy text of 0033 is generated from the schema; a later
--      `db:generate` against a drifted schema could quietly put a wide policy back — one naming a tenant
--      role, or the any-member form of 0002, under which a distributor's manager reads what we charge
--      every other distributor — and no test that does not look for it would fail. The migration refuses
--      to finish unless every rule below holds, INCLUDING that `membership_role` never gains a
--      `platform_admin` value: a membership with that name would let a tenant's own onboarders write
--      themselves an actor role that reads every distributor in the database.
--
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every
-- app_rw transaction. A connection with NO role set is the migrating/owner connection (seeds,
-- migrations, a DBA in psql): it bypasses RLS anyway; the invariants of §2–§5 bind it all the same,
-- except the role-specific column rules, which are by definition about a named actor.

-- 1. FORCE RLS and the runtime grants for the four new tables.
ALTER TABLE "platform_admins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_audit" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_admins", "subscriptions", "support_grants", "platform_audit" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_admins", "subscriptions", "support_grants", "platform_audit" TO app_worker;--> statement-breakpoint

-- 2. A console account is created by an active SUPER administrator, and never by its own subject.
CREATE OR REPLACE FUNCTION dos_platform_admin_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_role text := (SELECT current_setting('app.actor_role', true));
  actor text := (SELECT current_setting('app.actor_id', true));
BEGIN
  IF actor_role = 'platform_admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM platform_admins pa
      WHERE pa.user_id = actor AND pa.role = 'super' AND pa.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'platform_admins: only an active super administrator opens or closes a console account'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.user_id = actor OR (TG_OP = 'UPDATE' AND OLD.user_id = actor) THEN
      RAISE EXCEPTION 'platform_admins: nobody edits their own console account (no self-promotion, no self-restore)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'platform_admins.created_by: a new administrator names the super administrator who added them'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'platform_admins.user_id: an account belongs to the person it was opened for; disable it and open another'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS platform_admins_guard ON "platform_admins";--> statement-breakpoint
CREATE TRIGGER platform_admins_guard
  BEFORE INSERT OR UPDATE ON "platform_admins"
  FOR EACH ROW EXECUTE FUNCTION dos_platform_admin_guard();--> statement-breakpoint
DROP TRIGGER IF EXISTS platform_admins_no_delete ON "platform_admins";--> statement-breakpoint
CREATE TRIGGER platform_admins_no_delete
  BEFORE DELETE ON "platform_admins"
  FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint

-- 3. A subscription row that cannot be nonsense.
CREATE OR REPLACE FUNCTION dos_subscription_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.seats < 0 THEN
    RAISE EXCEPTION 'subscriptions.seats: a seat count is never negative' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.price_paise_month < 0 THEN
    RAISE EXCEPTION 'subscriptions.price_paise_month: a price is never negative (integer paise)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'trial' AND NEW.trial_ends_at IS NULL THEN
    RAISE EXCEPTION 'subscriptions: a trial must say when it ends' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL AND NEW.period_end <= NEW.period_start THEN
    RAISE EXCEPTION 'subscriptions: the period ends after it starts' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.updated_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform_admins pa WHERE pa.user_id = NEW.updated_by
  ) THEN
    RAISE EXCEPTION 'subscriptions.updated_by: % is not a platform administrator', NEW.updated_by
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS subscriptions_guard ON "subscriptions";--> statement-breakpoint
CREATE TRIGGER subscriptions_guard
  BEFORE INSERT OR UPDATE ON "subscriptions"
  FOR EACH ROW EXECUTE FUNCTION dos_subscription_guard();--> statement-breakpoint

-- 4. Time-boxed, owner-approved, and never approved by the person asking.
CREATE OR REPLACE FUNCTION dos_support_grant_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_role text := (SELECT current_setting('app.actor_role', true));
  actor text := (SELECT current_setting('app.actor_id', true));
BEGIN
  -- (a) the requester is one of ours, and still working here
  IF NOT EXISTS (
    SELECT 1 FROM platform_admins pa
    WHERE pa.user_id = NEW.admin_user_id AND pa.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'support_grants.admin_user_id: % is not an active platform administrator', NEW.admin_user_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (b) time-boxed, in the database
  IF NEW.expires_at <= NEW.requested_at THEN
    RAISE EXCEPTION 'support_grants: the window ends after the request'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.expires_at > NEW.requested_at + interval '30 days' THEN
    RAISE EXCEPTION 'support_grants: support access is time-boxed to at most 30 days (docs/22 section 8, 2026-09-05)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (c) owner-approved: the pair is set together, by an active OWNER of that very distributorship,
  --     and never by the person who asked
  IF (NEW.approved_by IS NULL) <> (NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'support_grants: approved_by and approved_at are set together'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.approved_by IS NOT NULL THEN
    IF NEW.approved_by = NEW.admin_user_id THEN
      RAISE EXCEPTION 'support_grants: the requester never approves their own access'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.approved_by
        AND m.role = 'owner' AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'support_grants.approved_by: support access is approved by the distributorship own owner'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF (NEW.revoked_by IS NULL) <> (NEW.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'support_grants: revoked_by and revoked_at are set together'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- (f) an approval is revoked, never un-done; a revoked grant is closed for good
    IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'support_grants: an approval is revoked, never un-done'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND (
         NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR NEW.scope IS DISTINCT FROM OLD.scope
    ) THEN
      RAISE EXCEPTION 'support_grants: a revoked grant is closed; ask again'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (d) our side may ask and may revoke; it may never approve
  IF actor_role = 'platform_admin' THEN
    IF TG_OP = 'INSERT' AND (NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL) THEN
      RAISE EXCEPTION 'support_grants: a platform administrator files a request, never an approval'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND (
         NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    ) THEN
      RAISE EXCEPTION 'support_grants: only the distributorship own owner approves support access'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL AND (
         NEW.scope IS DISTINCT FROM OLD.scope
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.admin_user_id IS DISTINCT FROM OLD.admin_user_id
    ) THEN
      RAISE EXCEPTION 'support_grants: an approved grant keeps the scope and the window the owner approved'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
       AND NEW.revoked_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'support_grants.revoked_by: a platform administrator revokes as themselves'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (e) the owner answers the request: four columns, under their own name, and nothing else
  IF actor_role = 'owner' THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'support_grants: an owner answers a support request, never files one'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.admin_user_id IS DISTINCT FROM OLD.admin_user_id
       OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.scope IS DISTINCT FROM OLD.scope
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'support_grants: the owner approves or revokes; the request itself is not theirs to rewrite'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by AND NEW.approved_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'support_grants.approved_by: an owner approves as themselves'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_by IS DISTINCT FROM OLD.revoked_by AND NEW.revoked_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'support_grants.revoked_by: an owner revokes as themselves'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS support_grants_guard ON "support_grants";--> statement-breakpoint
CREATE TRIGGER support_grants_guard
  BEFORE INSERT OR UPDATE ON "support_grants"
  FOR EACH ROW EXECUTE FUNCTION dos_support_grant_guard();--> statement-breakpoint
DROP TRIGGER IF EXISTS support_grants_no_delete ON "support_grants";--> statement-breakpoint
CREATE TRIGGER support_grants_no_delete
  BEFORE DELETE ON "support_grants"
  FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint

-- 5. The trail is filed under a real administrator, and is append-only for every role.
--    dos_reject_mutation() is created by 0003; CREATE OR REPLACE keeps this migration self-contained.
CREATE OR REPLACE FUNCTION dos_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (ADR 0003/0004); write a compensating row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_platform_audit_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = NEW.admin_user_id) THEN
    RAISE EXCEPTION 'platform_audit.admin_user_id: % is not a platform administrator', NEW.admin_user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS platform_audit_guard ON "platform_audit";--> statement-breakpoint
CREATE TRIGGER platform_audit_guard
  BEFORE INSERT ON "platform_audit"
  FOR EACH ROW EXECUTE FUNCTION dos_platform_audit_guard();--> statement-breakpoint
DROP TRIGGER IF EXISTS platform_audit_append_only ON "platform_audit";--> statement-breakpoint
CREATE TRIGGER platform_audit_append_only
  BEFORE UPDATE OR DELETE ON "platform_audit"
  FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint

-- 6. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted and typed ('owner'::text), so the patterns below match the deparsed text of
--    what 0033 installed — and would match a wide policy put there by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
  def text;
BEGIN
  -- (a) FORCE on all four, each with at least one policy, no policy that names no role, no FOR ALL and
  --     no DELETE anywhere: nothing in the console is erased
  FOREACH t IN ARRAY ARRAY['platform_admins', 'subscriptions', 'support_grants', 'platform_audit']
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the policies of 0033 would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table (0033 must install its policies)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%app.actor_role%';
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names no role: the console tables are reached by role alone, and a tenant-scoped predicate on them would admit whoever happens to be signed in', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t AND p.polcmd IN ('*', 'd');
    IF n > 0 THEN
      RAISE EXCEPTION '% has a DELETE (or FOR ALL) policy; an administrator is disabled, a grant revoked, an audit row kept — nothing here is erased', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (b) no tenant role reads the console's own three tables: not the owner, not the money desk, nobody
  FOREACH t IN ARRAY ARRAY['platform_admins', 'subscriptions', 'platform_audit']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''(owner|manager|accountant|salesperson|warehouse|delivery|retailer|curator|support)'''
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''(owner|manager|accountant|salesperson|warehouse|delivery|retailer|curator|support)''');
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy naming a tenant role; who our staff are, what a distributor pays and what we did are ours, not a customer''s', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (c) support_grants carries EXACTLY the owner exception: the tenant's owner reads and answers its own
  --     grants, no other tenant role appears, and no owner may file one
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'support_grants'
      AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''(manager|accountant|salesperson|warehouse|delivery|retailer|curator|support)'''
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''(manager|accountant|salesperson|warehouse|delivery|retailer|curator|support)''');
  IF n > 0 THEN
    RAISE EXCEPTION 'support_grants has a policy naming a tenant role other than the owner; approving support access is the owner''s own decision'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'support_grants' AND p.polcmd = 'r'
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ '''owner'''
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%app.tenant_id%';
  IF n = 0 THEN
    RAISE EXCEPTION 'support_grants has no owner-scoped SELECT policy; a grant the owner cannot see is not owner-approved, it is a back door'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'support_grants' AND p.polcmd = 'a'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '''owner''';
  IF n > 0 THEN
    RAISE EXCEPTION 'support_grants has an INSERT policy naming the owner; we ask, the owner answers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (d) the trail has no UPDATE policy at all, and the append-only trigger behind it
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'platform_audit' AND p.polcmd IN ('*', 'w');
  IF n > 0 THEN
    RAISE EXCEPTION 'platform_audit has an UPDATE policy; the trail of what our own staff did is append-only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (e) platform_admin is an ACTOR role, never a membership; and the two plan names the console needs exist
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
    WHERE ty.typname = 'membership_role' AND e.enumlabel = 'platform_admin'
  ) THEN
    RAISE EXCEPTION 'membership_role gained a platform_admin value; a membership with that name would let a tenant''s own onboarders write themselves an actor role that reads every distributor in the database'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOREACH t IN ARRAY ARRAY['starter', 'standard', 'pro']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
      WHERE ty.typname = 'tenant_plan' AND e.enumlabel = t
    ) THEN
      RAISE EXCEPTION 'tenant_plan is missing the % value the console sells', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;

  -- (f) the console can reach the tenant list at all, and the onboarding columns are expand-only
  FOREACH t IN ARRAY ARRAY['tenants_platform_read', 'tenants_platform_insert', 'tenants_platform_update']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = 'tenants' AND p.polname = t
    ) THEN
      RAISE EXCEPTION 'tenants is missing policy %; the console could not list or onboard a distributor', t
        USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['onboarded_at', 'onboarded_by']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = t AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'tenants.% must exist and be nullable (the tenants that predate the console were onboarded by nobody)', t
        USING ERRCODE = 'undefined_column';
    END IF;
  END LOOP;

  -- (g) the indexes the console reads through, and the two uniqueness guarantees
  FOREACH t IN ARRAY ARRAY[
    'platform_admins_user_idx', 'platform_admins_active_idx', 'subscriptions_tenant_idx',
    'subscriptions_status_idx', 'support_grants_tenant_idx', 'support_grants_admin_idx',
    'support_grants_live_idx', 'platform_audit_admin_idx', 'platform_audit_tenant_idx',
    'platform_audit_action_idx'
  ]
  LOOP
    SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = t;
    IF def IS NULL THEN
      RAISE EXCEPTION 'index % is missing (0033)', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'platform_admins_user_idx';
  IF def NOT LIKE 'CREATE UNIQUE INDEX%' THEN
    RAISE EXCEPTION 'platform_admins_user_idx is not UNIQUE; one person would hold two console levels at once'
      USING ERRCODE = 'undefined_object';
  END IF;
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'subscriptions_tenant_idx';
  IF def NOT LIKE 'CREATE UNIQUE INDEX%' THEN
    RAISE EXCEPTION 'subscriptions_tenant_idx is not UNIQUE; a distributor would hold two subscription states at once'
      USING ERRCODE = 'undefined_object';
  END IF;

  -- (h) the guards are armed
  FOREACH t IN ARRAY ARRAY[
    'platform_admins_guard', 'platform_admins_no_delete', 'subscriptions_guard',
    'support_grants_guard', 'support_grants_no_delete', 'platform_audit_guard',
    'platform_audit_append_only'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg WHERE tg.tgname = t AND NOT tg.tgisinternal
    ) THEN
      RAISE EXCEPTION 'trigger % is missing; the console''s rules (super-only accounts, the 30-day window, owner approval, the append-only trail) would live only in a service', t
        USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
END;
$$;
