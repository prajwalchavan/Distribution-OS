-- Hand-written companion to 0043_receipts_number_expand.sql (DOS-032 / DOS-059): a receipt number is unique
-- inside its series and financial year, keyed exactly as the counter that issues it
-- (`numbering_series(tenant, series, fy)`), the way `invoices_no_idx` and `credit_notes_no_idx` already defend
-- theirs. Not `(tenant, receipt_no)` alone: every FY's register starts again at 1, so the same number is legal
-- once per year.
--
-- HOW THIS FILE WAS MADE (the 0015 method), so the next `db:generate` emits nothing for receipts. `receipts.fy`
-- is `notNull()` in the schema, but a NOT NULL add fails on a populated table, so 0043 was generated with `fy`
-- nullable; the schema was then flipped to `notNull()` and given `receipts_no_idx`, and `db:generate` was run a
-- second time. It produced exactly the SET NOT NULL and CREATE UNIQUE INDEX statements below and
-- `meta/0044_snapshot.json`, which is kept as drizzle wrote it. This file replaces that generated SQL with the
-- check and the backfill IN FRONT of those two statements; nothing in `meta/` was edited by hand.
--
--   1. Refuse, loudly, a register that already repeats a number inside one tenant and IST financial year.
--      Nothing is renumbered here: an issued receipt is a shop's proof of payment, and changing one on a real
--      distributor's books is that owner's decision. The error names each tenant by slug with up to 20 of its
--      repeated numbers, and prints the repair SQL (keep the first receipt under each number, renumber the
--      later ones past the register, move every RCPT counter past it) for the operator to review and run; a
--      dev or QA database is rebuilt instead (QA/ENV.md §6a). Drizzle applies every pending migration in one
--      transaction, so a refusal leaves the database exactly as it was.
--   2. Backfill `fy` from `received_at` in IST: that is the instant `nextDocumentNumber` was handed, so it is
--      the FY key its counter used (`numberingYear()`). The touch trigger is held off around it: the key is
--      derived, not an edit, and moving every `updated_at` would push every receipt to every device again
--      (the manifest change already makes delivery and retailer devices re-snapshot once).
--   3. SET NOT NULL and 4. the unique index, as drizzle generated them.
--   5. A migrate-time assertion: receipts keeps FORCE ROW LEVEL SECURITY and carries no FOR ALL policy,
--      `fy` is NOT NULL, and `receipts_no_idx` exists, is unique, on (tenant_id, series_code, fy, receipt_no),
--      partial on receipt_no IS NOT NULL.
-- No table is added, so there is no new grant and no new FORCE line.

-- 1. A register that already repeats a number is refused, with the repair printed.
DO $$
DECLARE
  offenders text;
  repair CONSTANT text := $repair$
BEGIN;
-- (a) Keep the first receipt under each repeated number (earliest created_at, then id); renumber every later
--     one to the next free number of the same shape in that tenant and IST financial year.
WITH r AS (
  SELECT id, tenant_id, receipt_no, created_at,
         extract(year FROM (received_at AT TIME ZONE 'Asia/Kolkata') - interval '3 months')::int AS fy_start,
         regexp_replace(receipt_no, '[0-9]+$', '') AS stem
    FROM receipts
   WHERE receipt_no IS NOT NULL
), copies AS (
  SELECT id, tenant_id, fy_start, stem,
         row_number() OVER (PARTITION BY tenant_id, fy_start, receipt_no ORDER BY created_at, id) AS copy
    FROM r
), top AS (
  SELECT tenant_id, fy_start, stem,
         coalesce(max(substring(receipt_no FROM '([0-9]{1,18})$')::bigint), 0) AS hi
    FROM r
   GROUP BY tenant_id, fy_start, stem
), renumbered AS (
  SELECT c.id,
         c.stem || lpad(n::text, greatest(4, char_length(n::text)), '0') AS receipt_no
    FROM (
      SELECT c.id, c.stem,
             t.hi + row_number() OVER (PARTITION BY c.tenant_id, c.fy_start, c.stem ORDER BY c.id) AS n
        FROM copies c JOIN top t USING (tenant_id, fy_start, stem)
       WHERE c.copy > 1
    ) c
)
UPDATE receipts SET receipt_no = renumbered.receipt_no
  FROM renumbered
 WHERE receipts.id = renumbered.id;
-- (b) Move every RCPT counter past the highest number of its own shape on its financial year's register.
UPDATE numbering_series ns
   SET next_no = GREATEST(ns.next_no, 1 + coalesce((
         SELECT max(substring(x.receipt_no FROM char_length(ns.prefix) + 1)::bigint)
           FROM receipts x
          WHERE x.tenant_id = ns.tenant_id
            AND left(x.receipt_no, char_length(ns.prefix)) = ns.prefix
            AND substring(x.receipt_no FROM char_length(ns.prefix) + 1) ~ '^[0-9]{1,18}$'
            AND extract(year FROM (x.received_at AT TIME ZONE 'Asia/Kolkata') - interval '3 months')::int
                = left(ns.fy, 4)::int), 0))
 WHERE ns.series_code = 'RCPT';
-- (c) Review what moved, then COMMIT (or ROLLBACK), re-render and re-send the renumbered receipts to their
--     shops, and run `pnpm db:migrate` again.
$repair$;
BEGIN
  SELECT string_agg(per_tenant.line, E'\n' ORDER BY per_tenant.slug)
    INTO offenders
    FROM (
      SELECT t.slug,
             format(
               '  %s: %s%s',
               t.slug,
               string_agg(format('%s (%s, %s receipts)', d.receipt_no, d.fy, d.n), ', '
                          ORDER BY d.fy, d.receipt_no) FILTER (WHERE d.k <= 20),
               CASE WHEN count(*) > 20 THEN format(' and %s more', count(*) - 20) ELSE '' END
             ) AS line
        FROM (
          SELECT x.tenant_id, x.fy, x.receipt_no, count(*) AS n,
                 row_number() OVER (PARTITION BY x.tenant_id ORDER BY x.fy, x.receipt_no) AS k
            FROM (
              SELECT r.tenant_id, r.receipt_no,
                     y.s::text || '-' || lpad(((y.s + 1) % 100)::text, 2, '0') AS fy
                FROM receipts r
                CROSS JOIN LATERAL (
                  SELECT extract(year FROM (r.received_at AT TIME ZONE 'Asia/Kolkata') - interval '3 months')::int AS s
                ) y
               WHERE r.receipt_no IS NOT NULL
            ) x
           GROUP BY x.tenant_id, x.fy, x.receipt_no
          HAVING count(*) > 1
        ) d
        JOIN tenants t ON t.id = d.tenant_id
       GROUP BY t.slug
    ) per_tenant;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = concat_ws(
        E'\n',
        '0044: receipt numbers repeat inside one financial year, so receipts_no_idx cannot be built; nothing was changed.',
        offenders,
        'A dev or QA database: rebuild it (dropdb, createdb, pnpm db:migrate, pnpm db:seed; QA/ENV.md section 6a). '
        'A real distributor: renumbering an issued receipt is that owner''s decision. The repair below keeps the first '
        'receipt under each number, renumbers the later ones past the register and moves each RCPT counter past it; '
        'run it as the database owner and review it before COMMIT.',
        repair
      ),
      HINT = 'The repair SQL is printed at the end of the message.';
  END IF;
END;
$$;--> statement-breakpoint

-- 2. The key each number was drawn under: its IST financial year.
ALTER TABLE "receipts" DISABLE TRIGGER "receipts_touch_updated_at";--> statement-breakpoint
UPDATE "receipts" r
   SET "fy" = y.s::text || '-' || lpad(((y.s + 1) % 100)::text, 2, '0')
  FROM (
    SELECT id, extract(year FROM (received_at AT TIME ZONE 'Asia/Kolkata') - interval '3 months')::int AS s
      FROM "receipts"
     WHERE "fy" IS NULL
  ) y
 WHERE r.id = y.id;--> statement-breakpoint
ALTER TABLE "receipts" ENABLE TRIGGER "receipts_touch_updated_at";--> statement-breakpoint

-- 3 and 4, as drizzle generated them.
ALTER TABLE "receipts" ALTER COLUMN "fy" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_no_idx" ON "receipts" USING btree ("tenant_id","series_code","fy","receipt_no") WHERE receipt_no IS NOT NULL;--> statement-breakpoint

-- 5. The guarantee is armed, and nothing around it came loose.
DO $$
DECLARE
  forced boolean;
  is_unique boolean;
  def text;
BEGIN
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'receipts';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0044: receipts must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.receipts'::regclass AND p.polcmd = '*') THEN
    RAISE EXCEPTION '0044: receipts must not carry a FOR ALL policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'receipts' AND column_name = 'fy' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '0044: receipts.fy must be NOT NULL';
  END IF;
  SELECT i.indisunique, pg_get_indexdef(i.indexrelid) INTO is_unique, def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.receipts'::regclass AND c.relname = 'receipts_no_idx';
  IF is_unique IS DISTINCT FROM true
     OR def NOT LIKE '%(tenant_id, series_code, fy, receipt_no)%'
     OR def NOT LIKE '%WHERE (receipt_no IS NOT NULL)%' THEN
    RAISE EXCEPTION '0044: receipts_no_idx must be UNIQUE (tenant_id, series_code, fy, receipt_no) WHERE receipt_no IS NOT NULL; found %', coalesce(def, 'no such index')
      USING ERRCODE = 'undefined_object';
  END IF;
END;
$$;
