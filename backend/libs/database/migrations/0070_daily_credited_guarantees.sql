-- Hand-written companion to 0069_daily_credited_expand.sql. QA DOS-254 (business simulation, day 7).
--
-- THE OWNER'S SALES AND MARGIN COUNTED BILLS HE HAD CREDITED. The desk credited two whole bills (CN/9006
-- ₹11,276.00, CN/9007 ₹4,562.00) and the owner's home still read the same "Invoiced today", "Sales this month"
-- and gross margin: the rollup summed invoices and never subtracted a credit note, and its cost of goods kept
-- the cost of pieces a note had put back on the rack. The books were right; only the owner's figures were gross.
--
-- 0069 adds `daily_tenant_stats.credited_paise` — the day's credit notes with GST, by note date — NULLABLE and
-- with no default ON PURPOSE: NULL marks a day rolled up before credit notes were counted. The rollup now
-- writes it on every run (0 when there were none), and the worker's rollup job re-rolls, once, each day of the
-- current month still carrying NULL before it rolls today (`rollupStaleCreditDays`), so the month-to-date
-- figures are net from the first tick after deploy without a SQL copy of the rollup's cost rules here. A past
-- day re-rolled keeps its stored closing dues and its stored stock at cost (rollup.ts property 4).
--
-- 0069 also indexes `credit_notes (tenant_id, note_date)`: the rollup reads a day's and a month's notes across
-- every shop every 15 minutes, and the only date index was per shop.
--
-- Nothing is backfilled in SQL, no table is added (no grant, no FORCE line) and no policy changes (the table's
-- one staff-role policy, 0028, is untouched). The assertion: the table keeps FORCE RLS, and the new column
-- stays nullable (the NULL is the re-roll marker).
DO $$
DECLARE
  forced boolean;
BEGIN
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'daily_tenant_stats';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0070: daily_tenant_stats must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'daily_tenant_stats'
       AND column_name = 'credited_paise' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '0070: daily_tenant_stats.credited_paise must stay nullable; NULL marks a day to re-roll';
  END IF;
END;
$$;
