-- 0037 — the name on the owner's support card, and nothing else.
--
-- `tenancy.support.list` has to tell the owner WHO at Distribution OS is asking to read their books:
-- a request signed "support" is not the founder's "owner-approved" rule, it is a form letter. But a
-- platform administrator holds NO MEMBERSHIP of the distributor, and `users_visible` (migration 0002)
-- is "yourself, or somebody in your tenant" — so the one row the owner most needs to see is the one
-- row RLS hides from them.
--
-- The three ways out, and why this is the one taken:
--   * widening `users_visible` so an owner may read a platform admin would open the whole users table
--     to a predicate about support, for a name on a card;
--   * escalating the service's transaction to `system` does not even work — `users_visible` keys on
--     membership, not on actor role — and escalating to a BYPASSRLS connection would take a second
--     connection out of the pool inside an open transaction;
--   * a SECURITY DEFINER function that returns ONE COLUMN, for ids that are ACTIVE OR PAST PLATFORM
--     ADMINISTRATORS ONLY. It cannot be pointed at a shopkeeper, a rep or another distributor's owner:
--     the join to `platform_admins` is the whole guarantee, and it is inside the function where no
--     caller can drop it.
--
-- Expand-only: one new function, no data moved, nothing narrowed.

CREATE OR REPLACE FUNCTION dos_support_requester_names(ids text[])
  RETURNS TABLE (user_id text, display_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name
    FROM users u
    JOIN platform_admins pa ON pa.user_id = u.id
   WHERE u.id = ANY(ids);
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_support_requester_names(text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dos_support_requester_names(text[]) TO app_rw;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dos_support_requester_names(text[]) TO app_worker;--> statement-breakpoint

-- The assertion: the function exists, is SECURITY DEFINER with a pinned search_path, and still joins
-- `platform_admins`. A later edit that drops that join would turn a name lookup into a directory of
-- every user in the database, readable by any tenant role, and nothing else would fail.
DO $$
DECLARE
  fn oid;
  body text;
  cfg text[];
BEGIN
  SELECT p.oid INTO fn FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'dos_support_requester_names';
  IF fn IS NULL THEN
    RAISE EXCEPTION '0037: dos_support_requester_names() is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn) THEN
    RAISE EXCEPTION '0037: dos_support_requester_names() must be SECURITY DEFINER';
  END IF;
  SELECT proconfig INTO cfg FROM pg_proc WHERE oid = fn;
  IF cfg IS NULL OR NOT (cfg::text LIKE '%search_path%') THEN
    RAISE EXCEPTION '0037: dos_support_requester_names() must pin its search_path';
  END IF;
  SELECT prosrc INTO body FROM pg_proc WHERE oid = fn;
  IF body NOT LIKE '%platform_admins%' THEN
    RAISE EXCEPTION '0037: dos_support_requester_names() must return names of platform administrators only';
  END IF;
END $$;
