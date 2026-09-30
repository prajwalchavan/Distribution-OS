-- Hand-written companion to 0084_shopkeeper_sign_up_expand.sql: the shopkeeper's own account (founder, 2026-09-29,
-- docs/22 §8 "The shopkeeper is independent"). A shopkeeper signs up alone, with a password nobody else ever knows;
-- the account belongs to no distributor; the shopkeeper asks to be joined to a distributor's shop (by the shop code
-- printed on the bill, or by picking the distributor and naming the shop), and only that distributor's owner or
-- manager, after seeing who asks, joins them. Until a message channel can prove who holds a phone (OTP), that
-- approval is the proof, so nothing of a distributor is readable by the account before it.
--
-- HOW THIS FILE WAS MADE (the 0015 / 0044 method), so the next `db:generate` emits nothing. `retailers.shop_code` is
-- `notNull().default(dos_new_shop_code())` in the schema, but neither can be added before the function exists and
-- every existing shop has a code, so 0084 was generated with the column nullable; the schema was then flipped and
-- `db:generate` run a second time. It produced exactly the SET DEFAULT and SET NOT NULL statements of §3 and
-- `meta/0085_snapshot.json`, which is kept as drizzle wrote it. This file replaces that generated SQL with the
-- function and the backfill in front of those two statements; nothing in `meta/` was edited by hand.
--
--   1. FORCE ROW LEVEL SECURITY and the runtime grants for `shop_join_requests` (its policies are in 0084). A
--      request is decided or withdrawn and kept, never erased: DELETE is refused for every role.
--   2. `dos_new_shop_code()`: eight characters from 23456789ABCDEFGHJKMNPQRSTUVWXYZ (no 0/O, 1/I/L: a person reads
--      it off a bill and says it on the phone), written `XXXX-XXXX`, from `gen_random_uuid()`'s random bytes, and
--      free ACROSS THE PLATFORM — the code alone must find the distributor as well as the shop. SECURITY DEFINER
--      with a pinned search_path (0007's lesson): under FORCE RLS a distributor's own insert could not see another
--      distributor's codes, and the check would pass a code that is already taken.
--   3. Every existing shop gets a code, with the sync touch trigger held off around it (the 0044 method): a code is
--      a new column made by the database, not an edit, and moving every `updated_at` would push every shop to
--      every field device again. Then the default and NOT NULL, as drizzle generated them.
--   4. `dos_retailers_guard()` (0013) learns the code: nobody with an actor role changes a shop's code — not the
--      shop (which could otherwise hand its code to a stranger's guess), not the desk, not the worker. Only the
--      owner connection (a person in psql) may re-issue one. Everything else of the guard is 0013's, unchanged.
--   5. `dos_shop_join_guard()`: what RLS cannot say about a request.
--        - filed by the shopkeeper role: the name and phone on it are the account's own (the desk decides on who
--          asks, so an account may not ask in somebody else's name);
--        - by code: the shop is named from the start and is a shop OF THAT distributor; by name: no shop until
--          the desk picks one at approval, and it must be a shop of that distributor;
--        - who asked, which distributor, how, the typed name and the person never change after filing;
--        - a request that is approved, refused or withdrawn is final;
--        - the shopkeeper may only withdraw its own waiting request, touching nothing else;
--        - approved names a shop, the deciding person and the moment; refused says why in a line, who and when.
--   6. THE ASSERTION, the twin of 0034 §6 and 0079's: the migration refuses to finish unless every rule holds.
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every app_rw
-- transaction; a connection with no role set is the migrating/owner connection.

-- 1. FORCE RLS, grants, no DELETE.
ALTER TABLE "shop_join_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "shop_join_requests" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "shop_join_requests" TO app_worker;--> statement-breakpoint
DROP TRIGGER IF EXISTS shop_join_requests_never_deleted ON "shop_join_requests";--> statement-breakpoint
CREATE TRIGGER shop_join_requests_never_deleted BEFORE DELETE ON "shop_join_requests" FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint

-- 2. The shop code.
CREATE OR REPLACE FUNCTION dos_new_shop_code() RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea;
  picks int[] := ARRAY[0, 1, 2, 3, 4, 5, 10, 11];
  candidate text;
  i int;
BEGIN
  FOR attempt IN 1..20 LOOP
    -- Version 4 UUID: every byte but the version nibble (6) and the variant bits (8) is random; the eight used
    -- here are among the fully random ones.
    bytes := uuid_send(gen_random_uuid());
    candidate := '';
    FOR i IN 1..8 LOOP
      candidate := candidate || substr(alphabet, 1 + (get_byte(bytes, picks[i]) % 31), 1);
      IF i = 4 THEN
        candidate := candidate || '-';
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM retailers WHERE shop_code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'could not find a free shop code in 20 draws' USING ERRCODE = 'unique_violation';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_new_shop_code() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dos_new_shop_code() TO app_rw, app_worker;--> statement-breakpoint

-- 3. Every existing shop gets its code; then the default and NOT NULL, as drizzle generated them.
ALTER TABLE "retailers" DISABLE TRIGGER retailers_touch_updated_at;--> statement-breakpoint
UPDATE "retailers" SET "shop_code" = dos_new_shop_code() WHERE "shop_code" IS NULL;--> statement-breakpoint
ALTER TABLE "retailers" ENABLE TRIGGER retailers_touch_updated_at;--> statement-breakpoint
ALTER TABLE "retailers" ALTER COLUMN "shop_code" SET DEFAULT dos_new_shop_code();--> statement-breakpoint
ALTER TABLE "retailers" ALTER COLUMN "shop_code" SET NOT NULL;--> statement-breakpoint

-- 4. 0013's guard, with the shop code added to what no actor changes.
CREATE OR REPLACE FUNCTION dos_retailers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  role text := COALESCE(current_setting('app.actor_role', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND role <> '' AND NEW.shop_code IS DISTINCT FROM OLD.shop_code THEN
    RAISE EXCEPTION 'retailer %: a shop code is made once and never changed by the app', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF role = 'retailer' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'a shop does not create its own retailer record; the distributor onboards it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF ROW(NEW.id, NEW.tenant_id, NEW.identity_id, NEW.code, NEW.phone, NEW.beat_id, NEW.tier,
           NEW.credit_limit_paise, NEW.credit_limit_bills, NEW.credit_days, NEW.credit_mode, NEW.payment_terms,
           NEW.cash_discount_bps, NEW.cash_discount_days, NEW.tally_ledger_name, NEW.external_ids,
           NEW.onboarded_by, NEW.merged_into, NEW.active)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.tenant_id, OLD.identity_id, OLD.code, OLD.phone, OLD.beat_id, OLD.tier,
           OLD.credit_limit_paise, OLD.credit_limit_bills, OLD.credit_days, OLD.credit_mode, OLD.payment_terms,
           OLD.cash_discount_bps, OLD.cash_discount_days, OLD.tally_ledger_name, OLD.external_ids,
           OLD.onboarded_by, OLD.merged_into, OLD.active) THEN
      RAISE EXCEPTION 'retailer %: a shop edits its own name, owner, alternate phone, address and GSTIN — never its code, tier, beat, credit terms, phone or links', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF role NOT IN ('', 'system', 'owner', 'manager') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.tier <> 'C' OR NEW.credit_limit_paise <> 0 OR NEW.credit_limit_bills <> 0 OR NEW.credit_days <> 0 OR NEW.credit_mode <> 'indicate' THEN
        RAISE EXCEPTION 'retailer %: a % actor onboards a shop with the default tier and no credit; the owner or manager sets credit terms (setCredit)', NEW.id, role
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF ROW(NEW.tier, NEW.credit_limit_paise, NEW.credit_limit_bills, NEW.credit_days, NEW.credit_mode)
          IS DISTINCT FROM
          ROW(OLD.tier, OLD.credit_limit_paise, OLD.credit_limit_bills, OLD.credit_days, OLD.credit_mode) THEN
      RAISE EXCEPTION 'retailer %: tier and credit terms are set by the owner or the manager (setCredit); a % actor may not', OLD.id, role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- 5. What RLS cannot say about a join request.
CREATE OR REPLACE FUNCTION dos_shop_join_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  role text := COALESCE(current_setting('app.actor_role', true), '');
  person record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'waiting' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.reason IS NOT NULL THEN
      RAISE EXCEPTION 'join request %: a request is filed waiting, undecided', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    IF role = 'retailer' THEN
      SELECT u.name, u.phone INTO person FROM users u WHERE u.id = NEW.user_id;
      IF NOT FOUND OR person.phone IS DISTINCT FROM NEW.person_phone OR person.name IS DISTINCT FROM NEW.person_name THEN
        RAISE EXCEPTION 'join request %: an account asks in its own name and number', NEW.id USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.via = 'code' THEN
      IF NEW.retailer_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM retailers r WHERE r.id = NEW.retailer_id AND r.tenant_id = NEW.tenant_id
      ) THEN
        RAISE EXCEPTION 'join request %: a request by code names a shop of the distributor asked', NEW.id USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.retailer_id IS NOT NULL THEN
      RAISE EXCEPTION 'join request %: a request by name names no shop until the desk picks one', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.state <> 'waiting' THEN
    RAISE EXCEPTION 'join request % is % and stays so', OLD.id, OLD.state USING ERRCODE = 'check_violation';
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.user_id, NEW.via, NEW.shop_name, NEW.person_name, NEW.person_phone, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.user_id, OLD.via, OLD.shop_name, OLD.person_name, OLD.person_phone, OLD.created_at) THEN
    RAISE EXCEPTION 'join request %: who asked, whom, how and in what words never change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.retailer_id IS DISTINCT FROM OLD.retailer_id THEN
    IF OLD.retailer_id IS NOT NULL OR NEW.retailer_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM retailers r WHERE r.id = NEW.retailer_id AND r.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'join request %: the desk picks a shop of its own, once, for a request by name', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF role = 'retailer' THEN
    IF NEW.state <> 'withdrawn' OR NEW.retailer_id IS DISTINCT FROM OLD.retailer_id OR NEW.reason IS NOT NULL
       OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'join request %: the shopkeeper may only withdraw its own waiting request', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state = 'approved' AND (NEW.retailer_id IS NULL OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL) THEN
    RAISE EXCEPTION 'join request %: an approval names the shop, who approved and when', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'refused' AND (NEW.reason IS NULL OR btrim(NEW.reason) = '' OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL) THEN
    RAISE EXCEPTION 'join request %: a refusal says why, who refused and when', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'withdrawn' AND role NOT IN ('', 'system') THEN
    RAISE EXCEPTION 'join request %: only the shopkeeper withdraws its request', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS shop_join_requests_guard ON "shop_join_requests";--> statement-breakpoint
CREATE TRIGGER shop_join_requests_guard BEFORE INSERT OR UPDATE ON "shop_join_requests" FOR EACH ROW EXECUTE FUNCTION dos_shop_join_guard();--> statement-breakpoint

-- 6. THE ASSERTION.
DO $$
DECLARE
  forced_requests boolean;
  forced_retailers boolean;
  nullable text;
  default_expr text;
BEGIN
  SELECT c.relforcerowsecurity INTO forced_requests
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'shop_join_requests';
  SELECT c.relforcerowsecurity INTO forced_retailers
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'retailers';
  IF forced_requests IS DISTINCT FROM true OR forced_retailers IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0085: shop_join_requests and retailers must carry FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'shop_join_requests' AND cmd IN ('ALL', 'DELETE')
  ) THEN
    RAISE EXCEPTION '0085: shop_join_requests may carry no FOR ALL and no DELETE policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'shop_join_requests'
       AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(salesperson|accountant|delivery|warehouse)'
  ) THEN
    RAISE EXCEPTION '0085: no policy of shop_join_requests may name a role but the owner, the manager, the shopkeeper and the system';
  END IF;
  SELECT is_nullable, column_default INTO nullable, default_expr
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'retailers' AND column_name = 'shop_code';
  IF nullable IS DISTINCT FROM 'NO' OR default_expr IS NULL OR default_expr NOT LIKE 'dos_new_shop_code()%' THEN
    RAISE EXCEPTION '0085: retailers.shop_code must be NOT NULL with the default dos_new_shop_code()';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'retailers'
       AND indexname = 'retailers_shop_code_idx' AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION '0085: retailers_shop_code_idx must be unique across the platform';
  END IF;
  IF EXISTS (SELECT 1 FROM retailers WHERE shop_code !~ '^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$') THEN
    RAISE EXCEPTION '0085: every shop code is XXXX-XXXX from the reading alphabet';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'shop_join_requests' AND t.tgname = 'shop_join_requests_guard'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'shop_join_requests' AND t.tgname = 'shop_join_requests_never_deleted'
  ) THEN
    RAISE EXCEPTION '0085: shop_join_requests must carry its guard and its no-delete trigger';
  END IF;
END;
$$;
