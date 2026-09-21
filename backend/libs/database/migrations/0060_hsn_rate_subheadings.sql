-- Hand-written, and it must run BEFORE 0061 makes `hsn_rates_code_from_idx` unique (QA S-176).
--
-- WHAT WAS WRONG. `hsn_rates` is the only place a GST and cess rate comes from, and every caller asks
-- it the same question: the rows live on this date, newest `effective_from` first, take the first.
-- That is a total order only while one HSN has one row per date. The curated catalogue shipped FOUR
-- headings with two or three live rows each — 2202 carried "Aerated waters, containing added sugar"
-- (28% + 12% cess), "Packaged drinking water" (18%) and "Fruit pulp / fruit juice based drinks" (12%)
-- — so which rate a case of Campa bore was whatever the plan happened to return first, and it CHANGED
-- with the query: `hsn_code IN ('2202')` came back 12% with no cess, `IN ('2202','1905',…)` came back
-- 28% + 12%. An order of only aerated drinks was quoted a quarter under the bill it would get.
--
-- THE FIX AT THE CAUSE. Goods of one heading that bear different rates get their own SUB-HEADING, on
-- the rate row and on the variant, so one code names one rate; 0061 then makes that unique, and a
-- second live row is a database error instead of a silent hole in a bill. `product_variants` and
-- `hsn_rates` are the GLOBAL CURATED master (ADR 0005) — ours to correct — and the ids here are the
-- seed's own deterministic ones, so `pnpm db:seed` after this migration writes nothing new.
--
--   1. The three rates that were sharing a heading move to their sub-heading, keeping their id and
--      their `effective_from` (2017-07-01, the GST start date), so a bill re-printed from before this
--      migration resolves to the rate it was issued at. A fourth rate, milk-based beverages, is new.
--   2. The variants of those goods move with them, matched by the curated product name.
--   3. The two rows that are left over go: packaged drinking water belongs to heading 2201 (18%,
--      already there), and 1905 held two rows at the SAME 18%, so one was only ever redundant.
--   4. A migrate-time assertion: no HSN is left with two rates on one date, and no variant is left
--      pointing at a code with no rate at all.
-- No table is added, so there is no new grant and no new FORCE line.

-- 1. The rates that move, and the one that is new.
UPDATE "hsn_rates" SET "hsn_code" = '22029920'
 WHERE "hsn_code" = '2202' AND "description" = 'Fruit pulp / fruit juice based drinks';--> statement-breakpoint

UPDATE "hsn_rates" SET "hsn_code" = '04063000'
 WHERE "hsn_code" = '0406' AND "description" = 'Processed cheese';--> statement-breakpoint

UPDATE "hsn_rates" SET "hsn_code" = '21069099'
 WHERE "hsn_code" = '2106' AND "description" = 'Namkeen, pre-packed and labelled';--> statement-breakpoint

-- Milk-based beverages had no row of their own at all: they were riding the fruit-juice one. The id is
-- the seed's own for this row, so `pnpm db:seed` on a migrated database writes nothing new; the guard
-- on 2202 keeps this out of a database that carries no curated catalogue yet (the seed makes it there).
INSERT INTO "hsn_rates" ("id", "hsn_code", "description", "gst_bps", "cess_bps", "effective_from")
SELECT '16e17f27-f1be-70ca-b064-a150bf13e0e3', '22029930', 'Beverages containing milk', 1200, 0,
       '2017-07-01'::date
 WHERE EXISTS (SELECT 1 FROM "hsn_rates" x WHERE x."hsn_code" = '2202')
   AND NOT EXISTS (SELECT 1 FROM "hsn_rates" y WHERE y."hsn_code" = '22029930');--> statement-breakpoint

-- 2. The goods that were sharing a heading with a different rate. Matched on the curated product
--    name, which is the catalogue's own identity; the `hsn_code` guard makes a re-run a no-op.
UPDATE "product_variants" v SET "hsn_code" = m."code"
  FROM "products" p,
       (VALUES
         ('Independence Packaged Drinking Water', '2202', '2201'),
         ('Rajwadi Aamras Mango Drink',           '2202', '22029920'),
         ('Rajwadi Apple Nectar',                 '2202', '22029920'),
         ('Godavari Flavoured Milk Rose',         '2202', '22029930'),
         ('Godavari Flavoured Milk Kesar Badam',  '2202', '22029930'),
         ('Godavari Flavoured Milk Chocolate',    '2202', '22029930'),
         ('Godavari Cheese Slices',               '0406', '04063000'),
         ('Godavari Kesar Shrikhand',             '0406', '04063000'),
         ('Konkan Aloo Bhujia',                   '2106', '21069099'),
         ('Konkan Bhajani Chivda',                '2106', '21069099'),
         ('Konkan Farsan Mix',                    '2106', '21069099'),
         ('Konkan Kerala Banana Chips',           '2106', '21069099'),
         ('Konkan Masala Khakhra',                '2106', '21069099'),
         ('Konkan Ratlami Sev',                   '2106', '21069099'),
         ('Konkan Roasted Peanut Masala',         '2106', '21069099')
       ) AS m("product", "heading", "code")
 WHERE p."id" = v."product_id" AND p."name" = m."product" AND v."hsn_code" = m."heading";--> statement-breakpoint

-- 3. The two rows that made a heading ambiguous for nothing.
DELETE FROM "hsn_rates"
 WHERE ("hsn_code", "description") IN (
         ('2202', 'Packaged drinking water (Independence)'),
         ('1905', 'Biscuits, sweet'));--> statement-breakpoint

UPDATE "hsn_rates" SET "description" = 'Biscuits and extruded / expanded savoury snacks'
 WHERE "hsn_code" = '1905' AND "description" = 'Extruded / expanded savoury snacks';--> statement-breakpoint

UPDATE "hsn_rates" SET "description" = 'Waters, not sweetened: soda water and packaged drinking water'
 WHERE "hsn_code" = '2201' AND "description" = 'Soda water, waters not sweetened';--> statement-breakpoint

UPDATE "hsn_rates"
   SET "description" = 'Namkeen, bhujia, wafers, mixture (not pre-packed and labelled)'
 WHERE "hsn_code" = '2106' AND "description" = 'Namkeen, bhujia, wafers, mixture';--> statement-breakpoint

-- 4. One rate per heading, and every SKU still has one.
DO $$
DECLARE
  ambiguous text;
  orphaned text;
  forced boolean;
BEGIN
  SELECT string_agg(DISTINCT x."hsn_code", ', ') INTO ambiguous FROM (
    SELECT r."hsn_code" FROM "hsn_rates" r
     GROUP BY r."hsn_code", r."effective_from" HAVING count(*) > 1) x;
  IF ambiguous IS NOT NULL THEN
    RAISE EXCEPTION '0060: HSN % still has two rates on one date; 0061 cannot make the index unique', ambiguous;
  END IF;

  SELECT string_agg(DISTINCT v."hsn_code", ', ') INTO orphaned
    FROM "product_variants" v
   WHERE v."hsn_code" IN ('2202', '2201', '0406', '2106', '1905',
                          '22029920', '22029930', '04063000', '21069099')
     AND NOT EXISTS (SELECT 1 FROM "hsn_rates" r WHERE r."hsn_code" = v."hsn_code");
  IF orphaned IS NOT NULL THEN
    RAISE EXCEPTION '0060: HSN % is on a variant but has no rate at all', orphaned;
  END IF;

  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'hsn_rates';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0060: hsn_rates must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.hsn_rates'::regclass AND p.polcmd = '*') THEN
    RAISE EXCEPTION '0060: hsn_rates must not carry a FOR ALL policy';
  END IF;
END $$;
