-- Hand-written companion to 0066_grn_lines_batch_expand.sql. Two findings from the business simulation
-- (day 1b), both on the stock-in path of docs/22 §5.
--
-- QA DOS-220 — THE GATE COULD NOT TELL THREE BATCHES APART. A bill with three batches of one item opened a
-- receipt whose three lines all read "Balaji Masala Masti Wafers 45 g": `supplier_invoice_lines` carries the
-- batch and the expiry but is BACK_OFFICE RLS (it carries the rate), so the godown's own token could not read
-- them, and a wrong guess posted a 24-day batch's pieces onto a 147-day lot. 0066 adds `batch_no` and
-- `expiry_date` to `grn_lines` (every staff role reads them through `grn_lines_read`); `grns.open` fills them
-- from the supplier line. They are identity printed on the carton — never a rate and never the billed
-- quantity, so the count stays blind.
--
-- QA DOS-221 — A RECEIVED SUPPLIER BILL WROTE NO JOURNAL. docs/22 §5 ends "commit once: supplier invoice,
-- lots, stock ledger GRN rows, purchase cost, AP journal", and nothing posted the last one: Sundry Creditors
-- never showed what the distributor owes, and input GST was missing from the books. `grns.post` now posts
-- DR Purchases + DR input tax (+/- round off) / CR AP per bill through `ReceivablesService`, keyed
-- `journal:supplier_invoice:<id>`. Cess on a bill needs an account the chart never had.
--
--   1. Backfill batch and expiry onto every receipt line opened before 0066, from its own supplier line.
--      Guarded by `batch_no IS NULL AND expiry_date IS NULL`, so a re-run writes nothing.
--   2. `INPUT_CESS` joins the chart of every distributor that has one (`bootstrapTenant` adds it for new
--      ones). ON CONFLICT on (tenant_id, code) DO NOTHING.
--   3. Post the missing purchase entry for every bill already `received` — the same lines, key and date the
--      service writes, so the service's own idempotency check sees them and never posts a second. Lines of
--      one entry go in ONE statement: the deferred balance trigger (0003/0007) checks each entry at commit.
--   4. A migrate-time assertion: both touched tables keep FORCE RLS and carry no FOR ALL policy, the new
--      columns are nullable, every received bill of a tenant with a chart has exactly one purchase entry,
--      and every such entry balances.
-- No table is added, so there is no new grant and no new FORCE line.

-- 1. Batch and expiry onto the lines of receipts opened before 0066.
UPDATE "grn_lines" gl
   SET "batch_no" = sil."batch_no",
       "expiry_date" = sil."expiry_date"
  FROM "supplier_invoice_lines" sil
 WHERE sil."id" = gl."supplier_invoice_line_id"
   AND gl."batch_no" IS NULL
   AND gl."expiry_date" IS NULL
   AND (sil."batch_no" IS NOT NULL OR sil."expiry_date" IS NOT NULL);--> statement-breakpoint

-- 2. Input cess, for every distributor whose chart already exists.
INSERT INTO "accounts" ("id", "tenant_id", "code", "name", "kind")
SELECT gen_random_uuid()::text, a."tenant_id", 'INPUT_CESS', 'Input cess', 'asset'
  FROM "accounts" a
 WHERE a."code" = 'AP'
ON CONFLICT ("tenant_id", "code") DO NOTHING;--> statement-breakpoint

-- 3. The purchase entries the received bills never got.
CREATE TEMPORARY TABLE "dos221_bills" AS
SELECT gen_random_uuid()::text AS "entry_id",
       si."id", si."tenant_id", si."supplier_id", si."invoice_no", si."invoice_date",
       si."cgst_paise", si."sgst_paise", si."igst_paise", si."cess_paise", si."round_off_paise",
       si."total_paise",
       (SELECT g."posted_by" FROM "grns" g
         WHERE g."supplier_invoice_id" = si."id" AND g."status" = 'posted'
         ORDER BY g."posted_at" NULLS LAST LIMIT 1) AS "posted_by"
  FROM "supplier_invoices" si
 WHERE si."status" = 'received'
   AND EXISTS (SELECT 1 FROM "accounts" a WHERE a."tenant_id" = si."tenant_id" AND a."code" = 'AP')
   AND NOT EXISTS (
     SELECT 1 FROM "journal_entries" je
      WHERE je."tenant_id" = si."tenant_id"
        AND je."idempotency_key" = 'journal:supplier_invoice:' || si."id"
   );--> statement-breakpoint

INSERT INTO "journal_entries"
  ("id", "tenant_id", "entry_date", "ref_type", "ref_id", "narration", "idempotency_key", "posted_by")
SELECT b."entry_id", b."tenant_id", b."invoice_date", 'supplier_invoice', b."id",
       'purchase ' || b."invoice_no" || ' (posted by migration 0067, QA DOS-221)',
       'journal:supplier_invoice:' || b."id", b."posted_by"
  FROM "dos221_bills" b;--> statement-breakpoint

INSERT INTO "journal_lines"
  ("id", "tenant_id", "entry_id", "account_id", "amount_paise", "party_type", "party_id", "memo")
SELECT gen_random_uuid()::text, b."tenant_id", b."entry_id", a."id", v."amount", v."party_type",
       v."party_id", v."memo"
  FROM "dos221_bills" b
 CROSS JOIN LATERAL (VALUES
   ('PURCHASES',
    b."total_paise" - b."cgst_paise" - b."sgst_paise" - b."igst_paise" - b."cess_paise" - b."round_off_paise",
    NULL::text, NULL::text, b."invoice_no"),
   ('INPUT_CGST', b."cgst_paise", NULL, NULL, NULL),
   ('INPUT_SGST', b."sgst_paise", NULL, NULL, NULL),
   ('INPUT_IGST', b."igst_paise", NULL, NULL, NULL),
   ('INPUT_CESS', b."cess_paise", NULL, NULL, NULL),
   ('ROUND_OFF', b."round_off_paise", NULL, NULL, NULL),
   ('AP', 0 - b."total_paise", 'supplier', b."supplier_id", b."invoice_no")
 ) AS v("code", "amount", "party_type", "party_id", "memo")
  JOIN "accounts" a ON a."tenant_id" = b."tenant_id" AND a."code" = v."code"
 WHERE v."amount" <> 0;--> statement-breakpoint

DROP TABLE "dos221_bills";--> statement-breakpoint

-- 4. The guarantees are armed, and nothing around them came loose.
DO $$
DECLARE
  t text;
  forced boolean;
  nullable text;
  missing bigint;
  unbalanced bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['grn_lines', 'accounts', 'journal_entries', 'journal_lines'] LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '0067: % must keep FORCE ROW LEVEL SECURITY', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = ('public.' || t)::regclass AND p.polcmd = '*') THEN
      RAISE EXCEPTION '0067: % must not carry a FOR ALL policy', t;
    END IF;
  END LOOP;
  FOR nullable IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'grn_lines'
       AND column_name IN ('batch_no', 'expiry_date') AND is_nullable = 'NO'
  LOOP
    RAISE EXCEPTION '0067: grn_lines.% must stay nullable; a bill may print no batch', nullable;
  END LOOP;
  SELECT count(*) INTO missing
    FROM "supplier_invoices" si
   WHERE si."status" = 'received'
     AND EXISTS (SELECT 1 FROM "accounts" a WHERE a."tenant_id" = si."tenant_id" AND a."code" = 'AP')
     AND NOT EXISTS (
       SELECT 1 FROM "journal_entries" je
        WHERE je."tenant_id" = si."tenant_id"
          AND je."idempotency_key" = 'journal:supplier_invoice:' || si."id");
  IF missing > 0 THEN
    RAISE EXCEPTION '0067: % received supplier bills still have no purchase journal', missing;
  END IF;
  SELECT count(*) INTO unbalanced FROM (
    SELECT je."id"
      FROM "journal_entries" je
      JOIN "journal_lines" jl ON jl."entry_id" = je."id"
     WHERE je."ref_type" = 'supplier_invoice'
     GROUP BY je."id"
    HAVING sum(jl."amount_paise") <> 0
  ) x;
  IF unbalanced > 0 THEN
    RAISE EXCEPTION '0067: % purchase entries do not balance', unbalanced;
  END IF;
END;
$$;
