-- Hand-written companion to 0024_notifications_expand.sql: the guarantees drizzle-kit cannot express.
--
-- Everything declarable in src/schema/notifications.ts is in the GENERATED 0024 and is deliberately NOT
-- repeated here (docs/plans/00-coordination.md §2 rule 3): `messages.attempts` / `next_attempt_at`, the
-- `en-IN` locale default (English only, founder 2026-09-04), the `broadcasts` table with its three check
-- constraints and two indexes, `messages_dispatch_idx` (partial: the live set only) and
-- `messages_recipient_retailer_idx`, and the policy swaps on the four re-policied tables:
--   messages          `messages_tenant` (any member, FOR ALL) → `messages_read` (staff: the tenant;
--                     shop: rows addressed to its own shop through retailer_links.user_id) +
--                     `messages_write_*` (staff) + `messages_retailer_read_receipt` (UPDATE, the shop's
--                     own in_app / push row only — the row half of `messages.markRead`, docs/23 R12)
--   inbound_messages  `inbound_messages_tenant` → `inbound_messages_staff` (STAFF_ROLES)
--   whatsapp_windows  `whatsapp_windows_tenant` → `whatsapp_windows_staff` (STAFF_ROLES)
--   push_tokens       `push_tokens_tenant` → `push_tokens_read` (staff) + `push_tokens_own_*` (the
--                     device's own user, or the worker)
-- Generating 0024 needed no answers (nothing renamed); the run was wrapped in expect in case the policy
-- swaps prompted, and did not. This pair landed as 0024/0025 (coordination §2 relative slot 0019/0020,
-- shifted by the platform-gaps, outbox-relay and integrations-wizard slices).
--
-- What IS here, and why each piece is a grant, a trigger or an assertion rather than schema:
--   1. FORCE ROW LEVEL SECURITY + the runtime grants for `broadcasts` (coordination §8 item 5), and the
--      same re-asserted for the five notifications tables 0003 already covered (idempotent; explicit so
--      all six are correct on a database whose defaults were changed by hand — without FORCE the owner
--      connection would bypass every policy 0024 installed).
--   2. `dos_messages_guard()` — the COLUMN half of two rules RLS cannot state:
--        (a) a message row is immutable in spirit once created (notifications §4.17): `channel`, `to`,
--            `template_key`, `payload`, the recipient, the ref, the idempotency key and the tenant never
--            change after insert, for ANY actor including the worker and the owner connection — a wrong
--            number or a wrong template is a fresh message, never an edit of what was queued or sent;
--        (b) the shopkeeper's only write is the read receipt: under `messages_retailer_read_receipt` a
--            retailer-role actor may change `read_at` (and `updated_at`) and nothing else — never
--            `status`, never `cost_paise`, never `attempts`. Row-level policies admit rows, not columns,
--            hence a trigger (the twin of 0013's `dos_retailers_guard`).
--   3. `dos_broadcasts_beat_tenant_guard()` — a broadcast that names a beat names a beat of ITS OWN
--      tenant. RLS hides another tenant's beat from `app_rw`, but a foreign-key check bypasses row
--      security, so the FK alone would let the owner connection, a seed or the worker (BYPASSRLS) fan a
--      tenant A announcement out to tenant B's shops. SECURITY DEFINER so the check sees the beat whatever
--      the caller's role may read, with an explicit tenant comparison so the wider view never widens the
--      rule (the twin of 0019 §2 and 0022 §2).
--   4. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6, 0017 §3, 0019 §3 and 0022 §3. The policy
--      text of 0024 is generated from the schema; a later `db:generate` against a drifted schema could
--      quietly put the wide any-member `tenantPolicy` back on `messages` — under which a shopkeeper token
--      reads every other shop's bill, proof-of-delivery and dues-reminder history in the tenant (the leak
--      this slice exists to close, notifications §3.2; docs/22 §9 never-list 9) — and no test that does
--      not look for it would fail. So the migration refuses to finish unless:
--        (a) every one of the six notifications tables FORCEs row level security;
--        (b) every one of the five tenant tables carries at least one policy, and every policy on them
--            names `app.actor_role` — none is the role-less any-member form of 0002;
--        (c) `inbound_messages`, `whatsapp_windows`, `push_tokens` and `broadcasts` admit the retailer
--            role in NO policy, read or write (the only `'retailer'` a predicate may name is `<> 'retailer'`);
--        (d) `messages`' SELECT policy scopes through `retailer_links` (the shop sees its own shop's rows),
--            no INSERT or DELETE policy on it admits the retailer, and its retailer UPDATE policy is
--            confined to the `in_app` / `push` channels — WhatsApp and SMS read state comes only from the
--            provider (notifications §4.12);
--        (e) the four new indexes exist, each leading with `tenant_id` (coordination §8 item 6), and
--            `messages_dispatch_idx` is PARTIAL — a full index on a table that keeps every message ever
--            sent would grow with the history, not with the live set (docs/20 rule 3);
--        (f) `messages.attempts` is NOT NULL with default 0 and `next_attempt_at` is nullable (a fresh row
--            is due at once); the `broadcasts` arithmetic (counts within total, never negative, a shop
--            channel only) is a constraint, not service code;
--        (g) `messages.locale` defaults to `en-IN`;
--        (h) the two guard triggers of §2 and §3 are armed.
--
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every
-- app_rw transaction. A connection with NO role set is the migrating/owner connection (seeds, migrations,
-- a DBA in psql): it bypasses RLS anyway; the immutability rule 2(a) binds it all the same.

-- 1. FORCE RLS and the runtime grants for the six notifications tables (the new one first).
ALTER TABLE "broadcasts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_windows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "broadcasts", "messages", "templates", "inbound_messages", "whatsapp_windows", "push_tokens" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "broadcasts", "messages", "templates", "inbound_messages", "whatsapp_windows", "push_tokens" TO app_worker;--> statement-breakpoint

-- 2. A message is what it was when it was queued; the shop's only pen is the read receipt.
CREATE OR REPLACE FUNCTION dos_messages_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  role text := COALESCE(current_setting('app.actor_role', true), '');
BEGIN
  -- (a) immutable for everyone, the owner connection and the worker included
  IF ROW(NEW.id, NEW.tenant_id, NEW.channel, NEW."to", NEW.template_key, NEW.payload,
         NEW.recipient_user_id, NEW.recipient_retailer_id, NEW.ref_type, NEW.ref_id,
         NEW.idempotency_key, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.channel, OLD."to", OLD.template_key, OLD.payload,
         OLD.recipient_user_id, OLD.recipient_retailer_id, OLD.ref_type, OLD.ref_id,
         OLD.idempotency_key, OLD.created_at) THEN
    RAISE EXCEPTION 'message %: channel, recipient, template, payload and ref never change after insert; a correction is a fresh message', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- (b) the shop changes read_at and nothing else
  IF role = 'retailer' THEN
    IF ROW(NEW.locale, NEW.status, NEW.provider_message_id, NEW.cost_paise, NEW.error, NEW.attempts,
           NEW.next_attempt_at, NEW.scheduled_at, NEW.sent_at, NEW.delivered_at)
       IS DISTINCT FROM
       ROW(OLD.locale, OLD.status, OLD.provider_message_id, OLD.cost_paise, OLD.error, OLD.attempts,
           OLD.next_attempt_at, OLD.scheduled_at, OLD.sent_at, OLD.delivered_at) THEN
      RAISE EXCEPTION 'message %: a shop marks its own notice read (read_at) and touches nothing else', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS messages_guard ON "messages";--> statement-breakpoint
CREATE TRIGGER messages_guard BEFORE UPDATE ON "messages" FOR EACH ROW EXECUTE FUNCTION dos_messages_guard();--> statement-breakpoint

-- 3. A broadcast's beat is in the broadcast's tenant.
CREATE OR REPLACE FUNCTION dos_broadcasts_beat_tenant_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b_tenant text;
BEGIN
  IF NEW.beat_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id INTO b_tenant FROM beats WHERE id = NEW.beat_id;
  IF b_tenant IS NULL THEN
    RAISE EXCEPTION 'broadcast %: beat % does not exist', NEW.id, NEW.beat_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF b_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'broadcast %: beat % belongs to another tenant', NEW.id, NEW.beat_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS broadcasts_beat_tenant_guard ON "broadcasts";--> statement-breakpoint
CREATE TRIGGER broadcasts_beat_tenant_guard
  BEFORE INSERT OR UPDATE OF beat_id, tenant_id ON "broadcasts"
  FOR EACH ROW EXECUTE FUNCTION dos_broadcasts_beat_tenant_guard();--> statement-breakpoint

-- 4. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted and typed ('retailer'::text), so the patterns below match the deparsed text
--    of what 0024 installed — and would match a wide policy put there by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
  def text;
BEGIN
  -- (a) FORCE on all six
  FOREACH t IN ARRAY ARRAY[
    'messages', 'templates', 'inbound_messages', 'whatsapp_windows', 'push_tokens', 'broadcasts'
  ]
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the policies of 0024 would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (b) every tenant table has a policy, and none of its policies is the role-less any-member form
  FOREACH t IN ARRAY ARRAY['messages', 'inbound_messages', 'whatsapp_windows', 'push_tokens', 'broadcasts']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table (0024 must install its policies)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%app.actor_role%';
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names no role: that is the any-member FOR ALL policy of 0002, under which a shopkeeper token reads every shop''s message history (notifications section 3.2)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (c) the four staff-only tables admit the retailer in no policy: the only 'retailer' a predicate may
  --     name is the exclusion `<> 'retailer'`
  FOREACH t IN ARRAY ARRAY['inbound_messages', 'whatsapp_windows', 'push_tokens', 'broadcasts']
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND (   replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '<> ''retailer''::text', '') LIKE '%''retailer''%'
             OR replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), '<> ''retailer''::text', '') LIKE '%''retailer''%');
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that admits the retailer role; it is staff-only operational state (notifications section 3.3-3.5)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (d) messages: the shop reads its own shop's rows, inserts and deletes nothing, and updates only an
  --     in_app / push row
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'messages' AND p.polcmd = 'r'
      AND pg_get_expr(p.polqual, p.polrelid) LIKE '%retailer_links%'
      AND pg_get_expr(p.polqual, p.polrelid) LIKE '%recipient_retailer_id%';
  IF n = 0 THEN
    RAISE EXCEPTION 'messages has no SELECT policy scoped through retailer_links on recipient_retailer_id; a shopkeeper would read every shop''s notifications (notifications section 3.2)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'messages' AND p.polcmd IN ('a', 'd', '*')
      AND (   replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '<> ''retailer''::text', '') LIKE '%''retailer''%'
           OR replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), '<> ''retailer''::text', '') LIKE '%''retailer''%'
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') NOT LIKE '%app.actor_role%');
  IF n > 0 THEN
    RAISE EXCEPTION 'messages has an INSERT or DELETE policy that admits the retailer role; a shop never queues or removes a message (notifications section 4.10)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'messages' AND p.polcmd = 'w'
      AND replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), '<> ''retailer''::text', '') LIKE '%''retailer''%'
      AND NOT (   pg_get_expr(p.polqual, p.polrelid) LIKE '%''in_app''%'
               AND pg_get_expr(p.polqual, p.polrelid) LIKE '%''push''%'
               AND pg_get_expr(p.polqual, p.polrelid) LIKE '%retailer_links%'
               AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''in_app''%'
               AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%retailer_links%');
  IF n > 0 THEN
    RAISE EXCEPTION 'messages has a retailer UPDATE policy that is not confined to the shop''s own in_app / push rows; WhatsApp and SMS read state comes only from the provider (notifications section 4.12)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (e) the four query paths exist, lead with tenant_id, and the dispatch index is partial
  FOREACH t IN ARRAY ARRAY[
    'messages_dispatch_idx', 'messages_recipient_retailer_idx', 'broadcasts_created_idx', 'broadcasts_beat_idx'
  ]
  LOOP
    SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = t;
    IF def IS NULL OR def NOT LIKE '%(tenant_id,%' THEN
      RAISE EXCEPTION 'index % is missing or does not lead with tenant_id', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'messages_dispatch_idx';
  IF def NOT LIKE '% WHERE %' OR def NOT LIKE '%next_attempt_at%' THEN
    RAISE EXCEPTION 'messages_dispatch_idx must be a PARTIAL index on the live statuses ordered by next_attempt_at; a full index grows with the history, not the live set (docs/20 rule 3)'
      USING ERRCODE = 'undefined_object';
  END IF;

  -- (f) retry columns and the broadcast arithmetic
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'attempts'
      AND is_nullable = 'NO' AND column_default LIKE '0%'
  ) THEN
    RAISE EXCEPTION 'messages.attempts must be NOT NULL DEFAULT 0 (notifications section 4.5)' USING ERRCODE = 'not_null_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'next_attempt_at' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'messages.next_attempt_at must be nullable: a fresh row is due at once' USING ERRCODE = 'not_null_violation';
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'messages_attempts_nonnegative', 'broadcasts_channel_for_shops', 'broadcasts_counts_nonnegative', 'broadcasts_counts_within_total'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND con.conname = t AND con.contype = 'c'
    ) THEN
      RAISE EXCEPTION 'check constraint % is missing (0024)', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  SELECT pg_get_constraintdef(con.oid) INTO def
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname = 'broadcasts' AND con.conname = 'broadcasts_channel_for_shops';
  IF def LIKE '%''push''%' OR def LIKE '%''email''%' THEN
    RAISE EXCEPTION 'broadcasts_channel_for_shops admits push or email; a broadcast reaches shops on WhatsApp, SMS or the retailer inbox only (notifications section 2); found %', def
      USING ERRCODE = 'check_violation';
  END IF;

  -- (g) English only for now
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'locale' AND column_default LIKE '''en-IN''%'
  ) THEN
    RAISE EXCEPTION 'messages.locale must default to en-IN (English only, founder 2026-09-04; coordination ground truth)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (h) both guards are armed
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'messages' AND tg.tgname = 'messages_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'messages has no messages_guard trigger; a shop could rewrite a message it may only mark read'
      USING ERRCODE = 'undefined_object';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'broadcasts' AND tg.tgname = 'broadcasts_beat_tenant_guard' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'broadcasts has no beat tenant guard; a foreign-key check bypasses row security, so a broadcast could fan out to another tenant''s beat'
      USING ERRCODE = 'undefined_object';
  END IF;
END;
$$;
