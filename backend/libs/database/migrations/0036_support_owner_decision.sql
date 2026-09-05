-- 0036 — GUARANTEES for 0035, and the one rule 0034 could not carry because the columns did not exist yet.
--
-- Written by the verification gate after module 12 `ai` (2026-09-06). Two unrelated halves, in one file
-- because they are one migration step:
--
--   1. `dos_support_grant_guard()` is REPLACED so that the owner's half of the support flow — the three
--      procedures `tenancy.support.list / approve / revoke`, which 0033/0034 declared in the contract and
--      the permission matrix but which nothing implemented — can actually be served:
--        (a) `requested_hours` (0035) is bounded 1–72 at the request and is IMMUTABLE afterwards. It is
--            what our side ASKED for; the owner's screen shows it beside what was granted.
--        (b) THE OWNER MAY SHORTEN THE WINDOW, and only in the statement that approves it. 0034 froze
--            `expires_at` against every owner write, which is right against a LATER move and wrong at the
--            moment of approval: the contract's `tenancy.support.approve.hours` exists precisely so an
--            owner can say "two hours, not four". Lengthening, and moving the window after the fact, stay
--            refused — that is the founder's "time-boxed" rule and it is unchanged.
--        (c) `decision_note` (0035) is the OWNER's word about their own decision: a `platform_admin`
--            actor may never write it, on insert or on update. `revoke_reason` is deliberately writable
--            by both sides, because both sides may revoke.
--
--   2. THE ASSERTION for 0035's two policy changes on `route_plans`, the twin of 0032 §6. `ai.routing.get`
--      is granted to `warehouse` by the permission matrix (the van is loaded in the order it is emptied)
--      and `ai.routing.plan` to `delivery` (a driver asks the solver for a better round). Until 0035 the
--      policies stopped short of both: the godown read every plan as `item: null` for ever, and the service
--      had to write the crew's plan as `system` — a wider escalation than the thing it was allowing. If a
--      later `db:generate` against a drifted schema narrows either policy back, this block fails the
--      migration instead of letting the console go quiet again.
--
-- Expand-only: no column is dropped, no type narrowed. A trigger function and two policies are replaced,
-- which moves no data.

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
  IF NEW.requested_hours < 1 OR NEW.requested_hours > 72 THEN
    RAISE EXCEPTION 'support_grants.requested_hours: a support window is asked for in 1 to 72 hours'
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
    -- what was ASKED FOR is history the moment it is asked: nobody rewrites it afterwards, or the
    -- owner's screen could be shown a smaller ask than the one it actually answered.
    IF NEW.requested_hours IS DISTINCT FROM OLD.requested_hours THEN
      RAISE EXCEPTION 'support_grants.requested_hours: the ask is not rewritten after it is made'
        USING ERRCODE = 'check_violation';
    END IF;
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
    IF TG_OP = 'UPDATE' AND NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN
      RAISE EXCEPTION 'support_grants.decision_note: the decision note is the owner own words'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.decision_note IS NOT NULL THEN
      RAISE EXCEPTION 'support_grants.decision_note: a request carries no decision'
        USING ERRCODE = 'insufficient_privilege';
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
       OR NEW.scope IS DISTINCT FROM OLD.scope
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'support_grants: the owner approves or revokes; the request itself is not theirs to rewrite'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- The owner may SHORTEN the window, and only in the very statement that opens it. `tenancy.support
    -- .approve` takes an optional `hours` for exactly this: "four hours is more than you need, take
    -- two". Widening it, or moving it after the fact, is the thing 0034 was written to stop — an
    -- approval the owner gave for two hours must not become a week without them saying so again.
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      IF NOT (OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL) THEN
        RAISE EXCEPTION 'support_grants: the window is set when the owner approves, and never moved afterwards'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.expires_at > OLD.expires_at THEN
        RAISE EXCEPTION 'support_grants: an owner may shorten the window that was asked for, never lengthen it'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.expires_at <= NEW.approved_at THEN
        RAISE EXCEPTION 'support_grants: a window that has already closed is a refusal, not an approval'
          USING ERRCODE = 'check_violation';
      END IF;
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

-- The trigger itself is unchanged (0034 created it); replacing the function is enough. Re-asserted here
-- so a fresh database that somehow lost it is repaired rather than silently unguarded.
DROP TRIGGER IF EXISTS support_grants_guard ON "support_grants";--> statement-breakpoint
CREATE TRIGGER support_grants_guard
  BEFORE INSERT OR UPDATE ON "support_grants"
  FOR EACH ROW EXECUTE FUNCTION dos_support_grant_guard();--> statement-breakpoint

-- 2. THE ASSERTION. Predicates are read back through pg_get_expr, which keeps string literals
--    single-quoted and typed ('warehouse'::text), so the patterns below match the deparsed text.
DO $$
DECLARE
  def text;
  forced boolean;
BEGIN
  -- (a) support_grants keeps FORCE RLS, its guard and its append-only delete refusal
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'support_grants';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0036: support_grants must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'support_grants'::regclass AND tgname = 'support_grants_guard'
  ) THEN
    RAISE EXCEPTION '0036: support_grants lost its guard trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'support_grants'::regclass AND tgname = 'support_grants_no_delete'
  ) THEN
    RAISE EXCEPTION '0036: a support grant is revoked and kept, never deleted';
  END IF;

  -- (b) requested_hours is on the table and NOT NULL: the owner screen always has an ask to show
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_grants'
      AND column_name = 'requested_hours' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '0036: support_grants.requested_hours must exist and be NOT NULL';
  END IF;

  -- (c) the godown reads a route plan, and the crew of a trip may have one computed for it
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO def
    FROM pg_policy p WHERE p.polrelid = 'route_plans'::regclass AND p.polname = 'route_plans_read';
  IF def IS NULL OR def NOT LIKE '%''warehouse''%' THEN
    RAISE EXCEPTION '0036: route_plans_read must admit the warehouse role (ai.routing.get is granted to it)';
  END IF;
  IF def NOT LIKE '%driver_id%' THEN
    RAISE EXCEPTION '0036: route_plans_read must keep the crew-of-this-trip branch';
  END IF;

  SELECT pg_get_expr(p.polwithcheck, p.polrelid) INTO def
    FROM pg_policy p WHERE p.polrelid = 'route_plans'::regclass AND p.polname = 'route_plans_insert';
  IF def IS NULL OR def NOT LIKE '%''delivery''%' OR def NOT LIKE '%driver_id%' THEN
    RAISE EXCEPTION '0036: route_plans_insert must admit the crew of that very trip (ai.routing.plan is granted to delivery)';
  END IF;
  IF def NOT LIKE '%tenant_id%' THEN
    RAISE EXCEPTION '0036: route_plans_insert must stay tenant-scoped';
  END IF;

  -- (d) nothing on route_plans became a FOR ALL policy, and nothing may be deleted
  IF EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = 'route_plans'::regclass AND p.polcmd = '*'
  ) THEN
    RAISE EXCEPTION '0036: route_plans must not carry a FOR ALL policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = 'route_plans'::regclass AND p.polcmd = 'd'
  ) THEN
    RAISE EXCEPTION '0036: a route plan is superseded, never deleted';
  END IF;
END $$;
