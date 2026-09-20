-- Hand-written companion to 0048_inbound_reports_expand.sql (DOS-103): a shop can report a problem or ask for a
-- return from the app, and it lands in the office's inbound queue with the bill or delivery it is about.
--
-- WHAT 0048 DID. `inbound_messages` gains `kind`, `ref_type`, `ref_id` and `created_by`, all nullable (a text the
-- WhatsApp webhook captured carries none of them), and its staff-only FOR ALL policy is replaced by four: a read
-- scoped through `retailer_links.user_id` so a shop reads only the rows attributed to its OWN shop, the usual
-- staff insert/update/delete, and ONE narrow shop insert — channel `in_app`, its own linked shop, signed with its
-- own actor id. Triage stays the desk's: there is no shop UPDATE and no shop DELETE, so `handled` can only ever be
-- flipped by staff. The read is scoped through the denormalised link, never a join to `retailer_identities`, which
-- Postgres reports as infinite recursion (42P17).
--
-- WHAT THIS FILE ADDS. The two shape rules a policy cannot express, and the migrate-time assertion that the
-- guarantee is armed:
--   * `kind` is one of the three a shop may file, or absent;
--   * `ref_type` and `ref_id` arrive together or not at all, and `ref_type` names one of the three things a shop
--     can point at.
-- Both are CHECKs rather than enums: a captured WhatsApp text has neither, and an enum would need a migration to
-- add a fourth kind later.
--
-- The DO block then insists that `inbound_messages` keeps FORCE ROW LEVEL SECURITY, carries no FOR ALL policy, and
-- that the shop's insert policy is what it is meant to be: an INSERT policy whose WITH CHECK pins the channel to
-- `in_app` and the row to the caller's own id. Without the last two clauses a regression that widened the shop
-- insert to any channel, or dropped the `created_by` check, would pass unnoticed.

ALTER TABLE "inbound_messages"
  ADD CONSTRAINT "inbound_messages_kind_check"
  CHECK ("kind" IS NULL OR "kind" IN ('return_request', 'complaint', 'question'));--> statement-breakpoint

ALTER TABLE "inbound_messages"
  ADD CONSTRAINT "inbound_messages_ref_check"
  CHECK (
    ("ref_type" IS NULL) = ("ref_id" IS NULL)
    AND ("ref_type" IS NULL OR "ref_type" IN ('invoice', 'delivery', 'order'))
  );--> statement-breakpoint

DO $$
DECLARE
  forced boolean;
  cmd text;
  check_expr text;
BEGIN
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'inbound_messages';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0049: inbound_messages must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.inbound_messages'::regclass AND p.polcmd = '*'
  ) THEN
    RAISE EXCEPTION '0049: inbound_messages must not carry a FOR ALL policy';
  END IF;

  SELECT p.cmd, p.with_check INTO cmd, check_expr
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename = 'inbound_messages'
     AND p.policyname = 'inbound_messages_shop_insert';
  IF cmd IS DISTINCT FROM 'INSERT' OR check_expr IS NULL THEN
    RAISE EXCEPTION '0049: inbound_messages_shop_insert must exist as an INSERT policy with a WITH CHECK; found %',
      coalesce(cmd, 'no such policy') USING ERRCODE = 'undefined_object';
  END IF;
  IF position('in_app' IN check_expr) = 0 THEN
    RAISE EXCEPTION '0049: a shop may insert an in_app report only, never a whatsapp or sms row; found %', check_expr
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF position('created_by' IN check_expr) = 0 OR position('retailer_links' IN check_expr) = 0 THEN
    RAISE EXCEPTION '0049: a shop report must be signed with the caller''s own id and name its own linked shop; found %',
      check_expr USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'inbound_messages'
       AND p.cmd IN ('UPDATE', 'DELETE')
       AND position('retailer' IN coalesce(p.qual, '')) > 0
       AND position('<> ''retailer''' IN coalesce(p.qual, '')) = 0
  ) THEN
    RAISE EXCEPTION '0049: triage stays the desk''s — no shop UPDATE or DELETE policy on inbound_messages'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;
