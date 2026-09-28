-- Hand-written companion to 0078_write_off_recovery_expand.sql. QA phase 7 (money), DOS-310 (P0) and DOS-311 (P0);
-- architect rulings of 2026-09-28 (docs/22 §8, "Architect rulings, money and credit" (1) and (2)).
--
-- No table, column, policy or grant changes here and no existing row is changed: two guarantees for NEW rows,
-- one read for the release check, the index both of them ride, and one new account per distributor (4).
--
-- 1. A PAYMENT REFERENCE IS USED ONCE (DOS-310). The same cheque number and the same UPI UTR were accepted again
--    as new money: UTR1790564510946 stood on three live receipts across two shops, CHQ088789 on two of one shop,
--    ₹805.00 booked twice. The service refuses it at every door (the desk, the crew online, the crew's offline
--    upload) with a sentence naming the earlier receipt; this trigger is the database's own word for rows that
--    get past the service:
--      * a UPI / bank-transfer reference (a UTR is unique per transfer) already on a LIVE receipt of the same
--        distributor, whatever the shop — `upi` and `bank_transfer` are one family;
--      * a cheque number already on a LIVE receipt of the SAME shop. The same number from ANOTHER shop is a
--        question for the desk (the service asks and the desk confirms), never a database refusal.
--    LIVE = `collected` or `deposited`, a positive amount, not a reversal mirror: a bounced or cancelled receipt
--    frees its reference. References are compared through `dos_normalise_reference()` — trimmed, every space
--    removed, upper case — the same comparison the service makes and `normaliseReference()` in @dos/domain states.
--    The same receipt written again (its own id, its idempotency key, or its paper-book number: a seed re-run with
--    ON CONFLICT DO NOTHING, an offline replay) is never its own duplicate.
--    The trigger takes the advisory lock the service takes (`receipt-ref:<tenant>:<normalised>`), so two desks
--    recording the same UTR at the same instant wait for each other and the second sees the first.
--    It fires on INSERT and on UPDATE OF reference, mode, retailer_id — never on a status change, so banking or
--    bouncing a receipt that ALREADY shares its reference with another (the live database holds imported history)
--    still works. Those old pairs are left alone and named by the release check below.
--
-- 2. THE RELEASE CHECK (`pnpm check:receipt-references`, `receiptReferenceDuplicates` in @dos/db). One SQL
--    definition, `dos_receipt_reference_duplicates()`, of every reference standing on more than one live receipt:
--    `transfer` (a UTR twice anywhere in the distributor) and `cheque_same_shop` fail the check; `cheque_shops`
--    (one number, several shops — each confirmed by the desk as a different cheque) is listed for information.
--
-- 3. A RECOVERY NEVER TAKES MORE THAN WAS WRITTEN OFF (DOS-311). Money that reaches a shop with written-off bills
--    now recovers the write-off first: a recovery row in `write_offs` (negative, `reverses_write_off_id` = the
--    write-off, `receipt_id` = the money) and, when that money is reversed, a re-instatement row (positive, the
--    same `reverses_write_off_id`). Per original write-off, amount + Σ its rows stays within 0 … amount, and a
--    row names an ORIGINAL of the same bill and shop, with a receipt of that shop. A DEFERRED constraint trigger
--    like the journal balance: checked at COMMIT, on every new recovery row.
--
-- 4. BAD DEBTS RECOVERED (DOS-311). The recovered amount is booked as income on a new account of the chart,
--    `BAD_DEBTS_RECOVERED` "Bad debts recovered" (tenant-bootstrap.ts adds it for a new distributor); every
--    existing distributor gets it here, beside its `AP` account like 0067's `INPUT_CESS`. Additive: one account
--    row per distributor that has a chart, nothing else written, and ON CONFLICT DO NOTHING makes it re-runnable.
--
-- SECURITY DEFINER with a pinned search_path (0007's lesson): under FORCE RLS a trigger running as the delivery
-- crew — whose money also recovers write-offs — could not see `write_offs` (back office) nor another shop's
-- receipt, and the check would pass by seeing nothing. Each function refuses to pass when it cannot see the row
-- that fired it.
INSERT INTO "accounts" ("id", "tenant_id", "code", "name", "kind")
SELECT gen_random_uuid()::text, a."tenant_id", 'BAD_DEBTS_RECOVERED', 'Bad debts recovered', 'income'
  FROM "accounts" a
 WHERE a."code" = 'AP'
ON CONFLICT ("tenant_id", "code") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_normalise_reference(p_reference text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'))
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS receipts_live_reference_idx
  ON receipts (tenant_id, dos_normalise_reference(reference))
  WHERE reference IS NOT NULL
    AND amount_paise > 0
    AND reverses_receipt_id IS NULL
    AND status IN ('collected', 'deposited')
    AND mode IN ('upi', 'bank_transfer', 'cheque');--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_receipt_reference_is_free() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ref text;
  earlier record;
BEGIN
  IF NEW.reference IS NULL
     OR NEW.amount_paise <= 0
     OR NEW.reverses_receipt_id IS NOT NULL
     OR NEW.status NOT IN ('collected', 'deposited')
     OR NEW.mode NOT IN ('upi', 'bank_transfer', 'cheque') THEN
    RETURN NEW;
  END IF;
  ref := dos_normalise_reference(NEW.reference);
  IF ref = '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('receipt-ref:' || NEW.tenant_id || ':' || ref));
  SELECT r.id, r.receipt_no, r.retailer_id, r.mode::text AS mode
    INTO earlier
    FROM receipts r
   WHERE r.tenant_id = NEW.tenant_id
     AND r.reference IS NOT NULL
     AND dos_normalise_reference(r.reference) = ref
     AND r.amount_paise > 0
     AND r.reverses_receipt_id IS NULL
     AND r.status IN ('collected', 'deposited')
     AND r.mode IN ('upi', 'bank_transfer', 'cheque')
     AND r.id <> NEW.id
     AND r.idempotency_key <> NEW.idempotency_key
     AND NOT (NEW.client_receipt_no IS NOT NULL
              AND r.client_receipt_no = NEW.client_receipt_no
              AND r.device_id IS NOT DISTINCT FROM NEW.device_id)
     AND (
       (NEW.mode IN ('upi', 'bank_transfer') AND r.mode IN ('upi', 'bank_transfer'))
       OR (NEW.mode = 'cheque' AND r.mode = 'cheque' AND r.retailer_id = NEW.retailer_id)
     )
   ORDER BY r.received_at, r.id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% reference % is already on receipt % (%); one payment is recorded once, and a bounced or cancelled receipt frees its reference (QA DOS-310)',
      NEW.mode, NEW.reference, coalesce(earlier.receipt_no, earlier.id), earlier.id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS receipts_reference_is_free ON receipts;--> statement-breakpoint
CREATE TRIGGER receipts_reference_is_free
  BEFORE INSERT OR UPDATE OF reference, mode, retailer_id ON receipts
  FOR EACH ROW EXECUTE FUNCTION dos_receipt_reference_is_free();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_receipt_reference_duplicates(p_tenant text DEFAULT NULL)
RETURNS TABLE (
  tenant_id text,
  kind text,
  reference text,
  receipt_ids text[],
  receipt_nos text[],
  retailer_ids text[],
  modes text[],
  amount_paise bigint,
  first_at timestamptz,
  last_at timestamptz
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH live AS (
    SELECT r.*, dos_normalise_reference(r.reference) AS ref
      FROM receipts r
     WHERE (p_tenant IS NULL OR r.tenant_id = p_tenant)
       AND r.reference IS NOT NULL
       AND r.amount_paise > 0
       AND r.reverses_receipt_id IS NULL
       AND r.status IN ('collected', 'deposited')
       AND r.mode IN ('upi', 'bank_transfer', 'cheque')),
  grouped AS (
    SELECT l.tenant_id, 'transfer'::text AS kind, l.ref, NULL::text AS shop, l.id, l.receipt_no,
           l.retailer_id, l.mode::text AS mode, l.amount_paise, l.received_at
      FROM live l WHERE l.mode IN ('upi', 'bank_transfer') AND l.ref <> ''
    UNION ALL
    SELECT l.tenant_id, 'cheque_same_shop', l.ref, l.retailer_id, l.id, l.receipt_no, l.retailer_id,
           l.mode::text, l.amount_paise, l.received_at
      FROM live l WHERE l.mode = 'cheque' AND l.ref <> ''
    UNION ALL
    SELECT l.tenant_id, 'cheque_shops', l.ref, NULL, l.id, l.receipt_no, l.retailer_id, l.mode::text,
           l.amount_paise, l.received_at
      FROM live l WHERE l.mode = 'cheque' AND l.ref <> '')
  SELECT g.tenant_id, g.kind, g.ref,
         array_agg(g.id ORDER BY g.received_at, g.id),
         array_agg(coalesce(g.receipt_no, g.id) ORDER BY g.received_at, g.id),
         array_agg(DISTINCT g.retailer_id),
         array_agg(DISTINCT g.mode),
         sum(g.amount_paise)::bigint,
         min(g.received_at),
         max(g.received_at)
    FROM grouped g
   GROUP BY g.tenant_id, g.kind, g.ref, g.shop
  HAVING count(*) > 1
     AND (g.kind <> 'cheque_shops' OR count(DISTINCT g.retailer_id) > 1)
   ORDER BY g.tenant_id, g.kind, g.ref
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_write_off_recovery_within_original() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  original record;
  money record;
  standing bigint;
  seen bigint;
BEGIN
  SELECT COUNT(*) INTO seen FROM write_offs WHERE tenant_id = NEW.tenant_id AND id = NEW.id;
  IF seen = 0 THEN
    RAISE EXCEPTION 'write-off row % is not visible to the recovery check; row level security is hiding it (this function must be SECURITY DEFINER and owned by a role that bypasses RLS)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT w.id, w.amount_paise, w.invoice_id, w.retailer_id, w.reverses_write_off_id
    INTO original
    FROM write_offs w
   WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.reverses_write_off_id;
  IF NOT FOUND OR original.reverses_write_off_id IS NOT NULL THEN
    RAISE EXCEPTION 'write-off row % names % as the write-off it recovers, which is not an original write-off of this distributor (QA DOS-311)',
      NEW.id, NEW.reverses_write_off_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF original.invoice_id <> NEW.invoice_id OR original.retailer_id <> NEW.retailer_id THEN
    RAISE EXCEPTION 'write-off row % recovers write-off % of another bill or shop (QA DOS-311)', NEW.id, original.id
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.retailer_id INTO money FROM receipts r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.receipt_id;
  IF NOT FOUND OR money.retailer_id <> NEW.retailer_id THEN
    RAISE EXCEPTION 'write-off row % names receipt %, which is not money of this shop (QA DOS-311)', NEW.id, NEW.receipt_id
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT original.amount_paise + COALESCE(SUM(w.amount_paise), 0)
    INTO standing
    FROM write_offs w
   WHERE w.tenant_id = NEW.tenant_id AND w.reverses_write_off_id = original.id;
  IF standing < 0 OR standing > original.amount_paise THEN
    RAISE EXCEPTION 'write-off % of % paise would stand at % paise after row %: a recovery takes back at most what was written off, and undoing it restores no more (QA DOS-311)',
      original.id, original.amount_paise, standing, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS write_offs_recovery_within_original ON write_offs;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER write_offs_recovery_within_original
  AFTER INSERT ON write_offs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.reverses_write_off_id IS NOT NULL)
  EXECUTE FUNCTION dos_write_off_recovery_within_original();--> statement-breakpoint
DO $$
DECLARE
  forced_receipts boolean;
  forced_write_offs boolean;
  deferred boolean;
BEGIN
  SELECT c.relforcerowsecurity INTO forced_receipts
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'receipts';
  SELECT c.relforcerowsecurity INTO forced_write_offs
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'write_offs';
  IF forced_receipts IS DISTINCT FROM true OR forced_write_offs IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0079: receipts and write_offs must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('receipts', 'write_offs') AND cmd = 'ALL'
       AND policyname NOT IN ('write_offs_back_office')
  ) THEN
    RAISE EXCEPTION '0079: receipts may not carry a FOR ALL policy';
  END IF;
  SELECT t.tginitdeferred INTO deferred
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'write_offs' AND t.tgname = 'write_offs_recovery_within_original';
  IF deferred IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0079: the write-off recovery check must be a deferred constraint trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'receipts' AND t.tgname = 'receipts_reference_is_free'
  ) THEN
    RAISE EXCEPTION '0079: receipts must carry the reference trigger';
  END IF;
END;
$$;
