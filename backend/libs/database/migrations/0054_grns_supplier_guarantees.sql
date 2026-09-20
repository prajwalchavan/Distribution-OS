-- Hand-written companion to 0053_grns_supplier_expand.sql (QA DOS-050): the gate's receipt row names the
-- lorry it is counting.
--
-- WHY THE COLUMNS EXIST AT ALL. `supplier_invoices` is BACK_OFFICE RLS (a bill carries rates), so a warehouse
-- token joining it reads nothing — the receipt row on the godown's home screen could name neither the supplier
-- nor the bill number, and a gate hand had no way to tell which of two lorries the count belonged to. The two
-- columns are denormalised onto `grns`, which every staff role reads (`grns_read`), and they carry IDENTITY
-- ONLY: a name and a document number, never a rate, a taxable value or a total. `grns.open` fills them from
-- the invoice the desk already has in hand.
--
--   1. Backfill every receipt booked before this migration from its own invoice. One UPDATE ... FROM, guarded
--      by `supplier_id IS NULL` so a re-run writes nothing; `grns` carries no trigger, so no `updated_at`
--      moves and no device re-snapshots.
--   2. A migrate-time assertion: `grns` keeps FORCE ROW LEVEL SECURITY and carries no `FOR ALL` policy, both
--      columns exist and are nullable (the expand step must stay safe on a live database), and no row is left
--      with a NULL `supplier_id` while its invoice names one.
-- No table is added, so there is no new grant and no new FORCE line.

-- 1. Fill the two columns from the bill each receipt was opened against.
UPDATE "grns" g
   SET "supplier_id" = si."supplier_id",
       "supplier_invoice_no" = si."invoice_no"
  FROM "supplier_invoices" si
 WHERE si."id" = g."supplier_invoice_id"
   AND g."supplier_id" IS NULL;--> statement-breakpoint

-- 2. The guarantee is armed, and nothing around it came loose.
DO $$
DECLARE
  forced boolean;
  nullable text;
  stragglers bigint;
BEGIN
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'grns';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0054: grns must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.grns'::regclass AND p.polcmd = '*') THEN
    RAISE EXCEPTION '0054: grns must not carry a FOR ALL policy';
  END IF;
  FOR nullable IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'grns'
       AND column_name IN ('supplier_id', 'supplier_invoice_no')
       AND is_nullable = 'NO'
  LOOP
    RAISE EXCEPTION '0054: grns.% must stay nullable; a receipt booked before this migration names no supplier', nullable;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'grns'
         AND column_name IN ('supplier_id', 'supplier_invoice_no')) <> 2 THEN
    RAISE EXCEPTION '0054: grns must carry both supplier_id and supplier_invoice_no';
  END IF;
  SELECT count(*) INTO stragglers
    FROM "grns" g JOIN "supplier_invoices" si ON si."id" = g."supplier_invoice_id"
   WHERE g."supplier_id" IS NULL AND si."supplier_id" IS NOT NULL;
  IF stragglers > 0 THEN
    RAISE EXCEPTION '0054: % goods receipts still name no supplier after the backfill', stragglers;
  END IF;
END;
$$;
