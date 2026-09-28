-- Hand-written guarantees + a data correction that invents nothing. QA phases 10 + 9 (`QA/findings/17-inventory-states.md`)
-- and the architect's stock rulings of 2026-09-28 (docs/22 §8): DOS-350 (P0), DOS-352, DOS-357, DOS-261 / DOS-351 (the
-- availability half). Its drizzle sibling 0074 made lot identity (variant, batch, MRP, EXPIRY) — DOS-356 — and gave
-- `grn_lines` the pieces that went to the bin as expired on arrival. Every statement below can run twice.
--
-- 1. THE DAMAGED / EXPIRY BIN NEVER GOES BELOW ZERO (ruling 1, DOS-350). `bootstrapTenant` created the bin with
--    `negative_allowed = true` ("for a claim cycle"), and `InventoryService.applyBalance` copies that flag onto every
--    balance row it creates there, so the CHECK `on_hand >= 0 OR negative_allowed` never held at the bin. A godown
--    login moved 70 pieces out of a bin that held 20: the godown gained 50 pieces that never existed — sellable, in
--    every rep's availability — and the bin sat at −50. `dos_clear_negative_flags()` (run once below, and again by
--    anyone who wants to) sets every bin's flag to false and clears the flag on every balance row whose place does
--    not allow it and whose `on_hand` is zero or more. A balance ALREADY below zero keeps its flag — clearing it would
--    fail the CHECK and fail the migration — and nothing is written to the ledger for it: those pieces were never
--    there, and only a count can say what is. `pnpm check:stock-negative` (`dos_stock_below_zero()` below) names
--    every such balance with its item, batch and place, and exits 1 while there is one.
--
--    The guarantees that keep it so:
--      `locations_bin_never_negative`  a damaged location cannot carry the flag at all;
--      `stock_balances_never_below_zero`  a balance row cannot claim the flag its place does not give: a new row
--         loses it, a row back at zero or more loses it for good, and a row that was below zero before this
--         migration may only climb back towards zero — a movement that takes it further down is refused with the
--         same constraint name the CHECK uses (`stock_balances_on_hand_nonneg`), so the API's sentence is the one
--         the godown already reads. It fires only when the new row claims the flag (`WHEN (NEW.negative_allowed)`),
--         so the ordinary balance update pays nothing. SECURITY DEFINER with a pinned search_path: it reads the
--         place under FORCE RLS (0007's lesson).
--      `locations_bin_kind_fixed`  NOTHING LEAVES THE BIN FOR SALE BY A NEW KIND (ruling 2, DOS-352; the blind
--         check's V9). `sellable_stock` decides what may be sold by the place's kind, and one re-save of the bin as
--         a godown put 161 damaged pieces into every rep's availability. An UPDATE that changes a location's kind
--         to or from `damaged` is refused; a new bin, a renamed bin and any other kind change still go (the API
--         also keeps the kind of a place that holds stock). Fires only when the kind really changes.
--      THE GODOWN, THE DOCK AND THE BIN ARE FIXED PLACES (architect ruling 5 on vans and trips, 2026-09-28; the
--         second blind check). The godown login switched the bin off (`active = false`): a damage write-off at the
--         godown then reached no bin and every goods receipt failed. The same trigger now also refuses, for every
--         writer, switching off or re-kinding the place every service uses as the godown, the dock or the bin —
--         the first ACTIVE `warehouse`, `in_transit` or `damaged` place of the distributor by id, which is the one
--         `bootstrapTenant` made (constraint name `locations_fixed_place`). A second godown, a claim shelf or a van
--         the owner added is not fixed (the API switches it off only when it holds nothing). It fires only when
--         the kind changes or a place is switched off. `dos_restore_fixed_places()` (run once below, re-runnable)
--         switches back on the first place of a kind for a distributor that has places of that kind but none on —
--         the state the blind check left behind; a distributor that has one on is not touched, no ledger row is
--         written, and nothing is created.
--      NO PLACE TAKES A FIXED PLACE'S SEAT (the third blind check's blocker). Because the fixed place IS "the first
--         active of its kind by id", a place CREATED with a client-chosen id older than the dock's became the dock
--         every service reads: the bills already packed onto the real dock could then not be loaded, cancelled or
--         moved, and the rule above made the intruder permanent. The same function now also refuses (constraint
--         name `locations_fixed_place_first`) a place that would become active of a fixed kind — inserted (trigger
--         `locations_fixed_place_first`, BEFORE INSERT), switched on, given that kind, a new id or a new tenant —
--         while the distributor already has an active place of that kind whose id sorts AFTER it. A place added
--         later (a newer UUIDv7) never sorts first, so only a crafted id, or one minted on a device whose date is
--         years behind, is refused. An INSERT whose id is already taken is left to the UPDATE its ON CONFLICT runs
--         (the API's upsert of the fixed place itself still renames it) or to the primary key.
--      NO LOGIN DELETES A PLACE. No product door deletes a location, and a fixed place that never held a piece had
--         no foreign key to keep it; DELETE on `locations` is revoked from app_rw and app_worker.
--
-- 2. EXPIRED GOODS ARE NEVER SOLD (ruling 3, DOS-261, the availability half of DOS-351). `sellable_stock` now leaves
--    out every lot whose expiry date is before today's IST business date. Every availability read goes through it —
--    the rep's and the shop's stock hint (`stock.availability`), the desk's lot list (`stock.sellable`), the hold at
--    order confirm and at the wave (`reserve` / `availablePcs`), the van sale's hold and the wave's suggestions — so
--    an expired batch is neither offered nor held. Today is `(now() AT TIME ZONE 'Asia/Kolkata')::date`: explicit IST,
--    never `current_date`, which follows the session's time zone. SHORT-dated batches are untouched (they only warn,
--    ruling of 13 Sep), and nothing is hidden from the books: `stock_balances` and `stock.balances` still carry every
--    expired piece, which the owner's and the godown's stock screens show as "Expired" so it can be written off.
--    A hold taken on a batch before it expired is NOT touched here: it stays pending and counted in `reserved`, no
--    other order is promised those pieces, the pick and the pack refuse the batch, and `reservations.release` gives it
--    back for the next wave to hold in-date stock (`InventoryService.reserve`).
--
-- 3. RECEIPTS MERGED ACROSS EXPIRIES BEFORE 0074 (DOS-356) are not split: which of a merged lot's pieces are the early
--    ones cannot be known from the books, and a split would invent it. `dos_receipts_merged_across_expiry()` lists
--    every posted receipt line whose printed expiry is not its lot's, for the owner to count; the release check prints
--    them.
CREATE OR REPLACE FUNCTION dos_clear_negative_flags(p_tenant text DEFAULT NULL)
RETURNS TABLE (bins_cleared bigint, balances_cleared bigint, balances_kept_below_zero bigint)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  bins bigint;
  cleared bigint;
  kept bigint;
BEGIN
  UPDATE locations l
     SET negative_allowed = false
   WHERE l.kind = 'damaged' AND l.negative_allowed
     AND (p_tenant IS NULL OR l.tenant_id = p_tenant);
  GET DIAGNOSTICS bins = ROW_COUNT;
  UPDATE stock_balances b
     SET negative_allowed = false
    FROM locations l
   WHERE l.id = b.location_id AND l.tenant_id = b.tenant_id
     AND NOT l.negative_allowed AND b.negative_allowed AND b.on_hand >= 0
     AND (p_tenant IS NULL OR b.tenant_id = p_tenant);
  GET DIAGNOSTICS cleared = ROW_COUNT;
  SELECT count(*) INTO kept
    FROM stock_balances b
    JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
   WHERE NOT l.negative_allowed AND b.negative_allowed
     AND (p_tenant IS NULL OR b.tenant_id = p_tenant);
  RETURN QUERY SELECT bins, cleared, kept;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_clear_negative_flags(text) FROM PUBLIC;--> statement-breakpoint
SELECT * FROM dos_clear_negative_flags();--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT IF EXISTS "locations_bin_never_negative";--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_bin_never_negative"
  CHECK (kind <> 'damaged' OR NOT negative_allowed);--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_location_bin_kind_fixed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  takes_seat boolean := false;
  was_id text := NULL;
  seat_id text;
  seat_name text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.kind IS DISTINCT FROM NEW.kind AND (OLD.kind = 'damaged' OR NEW.kind = 'damaged') THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        CONSTRAINT = 'locations_bin_kind_fixed',
        TABLE = 'locations',
        MESSAGE = format(
          'location %s is %s and cannot become %s: the damaged / expiry bin stays the bin and no other place becomes one (QA DOS-352)',
          OLD.id, OLD.kind, NEW.kind);
    END IF;
    -- The fixed place of its kind is the first ACTIVE one by id (what every service reads). VOLATILE on purpose:
    -- inside one UPDATE of several rows the check sees the rows the statement already changed.
    IF OLD.active
       AND OLD.kind IN ('warehouse', 'damaged', 'in_transit')
       AND (NOT NEW.active OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.id IS DISTINCT FROM OLD.id
            OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)
       AND NOT EXISTS (
         SELECT 1 FROM locations o
          WHERE o.tenant_id = OLD.tenant_id AND o.kind = OLD.kind AND o.active AND o.id < OLD.id
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        CONSTRAINT = 'locations_fixed_place',
        TABLE = 'locations',
        MESSAGE = format(
          'location %s is the distributor''s %s: the godown, the dock and the damaged / expiry bin are fixed places that stay switched on and keep their kind (architect ruling 5 on vans and trips)',
          OLD.id, OLD.kind);
    END IF;
    was_id := OLD.id;
    takes_seat := NEW.active AND NEW.kind IN ('warehouse', 'damaged', 'in_transit')
      AND (NOT OLD.active OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id);
  ELSE
    -- INSERT. A row that already has this id is not a new place: an ON CONFLICT DO UPDATE is judged as the
    -- UPDATE it becomes (the API's upsert of the fixed place itself renames it), a plain INSERT fails on the key.
    takes_seat := NEW.active AND NEW.kind IN ('warehouse', 'damaged', 'in_transit')
      AND NOT EXISTS (SELECT 1 FROM locations x WHERE x.id = NEW.id);
  END IF;
  IF takes_seat THEN
    -- the distributor's fixed place of that kind as it stands, this row left out; the new row may not sort first
    SELECT o.id, o.name INTO seat_id, seat_name
      FROM locations o
     WHERE o.tenant_id = NEW.tenant_id AND o.kind = NEW.kind AND o.active
       AND o.id <> NEW.id AND (was_id IS NULL OR o.id <> was_id)
     ORDER BY o.id
     LIMIT 1;
    IF seat_id IS NOT NULL AND NEW.id < seat_id THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        CONSTRAINT = 'locations_fixed_place_first',
        TABLE = 'locations',
        MESSAGE = format(
          'location %s (%s) would take the place of %s (%s), the distributor''s %s: its id sorts before it, and the godown, the dock and the damaged / expiry bin are fixed places (architect ruling 5 on vans and trips, third blind check)',
          NEW.id, NEW.name, seat_id, seat_name, NEW.kind);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS locations_bin_kind_fixed ON locations;--> statement-breakpoint
CREATE TRIGGER locations_bin_kind_fixed
  BEFORE UPDATE OF id, tenant_id, kind, active ON locations
  FOR EACH ROW WHEN (
    OLD.kind IS DISTINCT FROM NEW.kind OR OLD.active IS DISTINCT FROM NEW.active
    OR OLD.id IS DISTINCT FROM NEW.id OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION dos_location_bin_kind_fixed();--> statement-breakpoint
DROP TRIGGER IF EXISTS locations_fixed_place_first ON locations;--> statement-breakpoint
CREATE TRIGGER locations_fixed_place_first
  BEFORE INSERT ON locations
  FOR EACH ROW WHEN (NEW.active AND NEW.kind IN ('warehouse', 'damaged', 'in_transit'))
  EXECUTE FUNCTION dos_location_bin_kind_fixed();--> statement-breakpoint
REVOKE DELETE ON locations FROM app_rw, app_worker;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_restore_fixed_places(p_tenant text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  restored bigint;
BEGIN
  UPDATE locations l
     SET active = true, updated_at = now()
   WHERE l.id IN (
     SELECT DISTINCT ON (f.tenant_id, f.kind) f.id
       FROM locations f
      WHERE f.kind IN ('warehouse', 'damaged', 'in_transit')
        AND (p_tenant IS NULL OR f.tenant_id = p_tenant)
        AND NOT EXISTS (
          SELECT 1 FROM locations a WHERE a.tenant_id = f.tenant_id AND a.kind = f.kind AND a.active
        )
      ORDER BY f.tenant_id, f.kind, f.id);
  GET DIAGNOSTICS restored = ROW_COUNT;
  RETURN restored;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_restore_fixed_places(text) FROM PUBLIC;--> statement-breakpoint
SELECT dos_restore_fixed_places();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_stock_balance_never_below_zero() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  place_allows boolean;
BEGIN
  SELECT l.negative_allowed INTO place_allows
    FROM locations l
   WHERE l.id = NEW.location_id AND l.tenant_id = NEW.tenant_id;
  IF place_allows IS TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.on_hand >= 0 THEN
    -- back at zero or more (or never below it): the flag its place does not give is gone for good
    NEW.negative_allowed := false;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.negative_allowed AND NEW.on_hand >= OLD.on_hand THEN
    -- below zero before 0075 (a count will correct it): it may climb back towards zero, never go further down
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = 'check_violation',
    CONSTRAINT = 'stock_balances_on_hand_nonneg',
    TABLE = 'stock_balances',
    MESSAGE = format(
      'lot %s at location %s would stand at %s pc: no place goes below zero, the damaged / expiry bin included (QA DOS-350)',
      NEW.lot_id, NEW.location_id, NEW.on_hand);
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS stock_balances_never_below_zero ON stock_balances;--> statement-breakpoint
CREATE TRIGGER stock_balances_never_below_zero
  BEFORE INSERT OR UPDATE ON stock_balances
  FOR EACH ROW WHEN (NEW.negative_allowed)
  EXECUTE FUNCTION dos_stock_balance_never_below_zero();--> statement-breakpoint
CREATE OR REPLACE VIEW sellable_stock WITH (security_invoker = true) AS
  SELECT b.tenant_id, l.variant_id, b.location_id, l.id AS lot_id, l.batch_no, l.mrp_paise, l.expiry_date,
         b.on_hand, b.reserved, (b.on_hand - b.reserved) AS available
  FROM stock_balances b
  JOIN stock_lots l ON l.id = b.lot_id
  JOIN locations loc ON loc.id = b.location_id AND loc.tenant_id = b.tenant_id
  WHERE (b.on_hand - b.reserved) > 0
    AND loc.kind IN ('warehouse', 'vehicle')
    AND (l.expiry_date IS NULL OR l.expiry_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date);--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_stock_below_zero(p_tenant text DEFAULT NULL)
RETURNS TABLE (
  tenant_id text,
  lot_id text,
  location_id text,
  on_hand bigint,
  reserved bigint,
  balance_flag boolean,
  location_allows boolean
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT b.tenant_id, b.lot_id, b.location_id, b.on_hand::bigint, b.reserved::bigint, b.negative_allowed,
         l.negative_allowed
    FROM stock_balances b
    JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
   WHERE b.on_hand < 0
     AND (p_tenant IS NULL OR b.tenant_id = p_tenant)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_stock_below_zero(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dos_stock_below_zero(text) TO app_worker;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_receipts_merged_across_expiry(p_tenant text DEFAULT NULL)
RETURNS TABLE (
  tenant_id text,
  lot_id text,
  lot_expiry date,
  grn_id text,
  grn_line_id text,
  line_expiry date,
  received_pcs bigint
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT gl.tenant_id, gl.lot_id, sl.expiry_date, gl.grn_id, gl.id, gl.expiry_date,
         (coalesce(gl.counted_qty_pcs, 0) + gl.damaged_qty_pcs)::bigint
    FROM grn_lines gl
    JOIN grns g ON g.id = gl.grn_id AND g.tenant_id = gl.tenant_id AND g.status = 'posted'
    JOIN stock_lots sl ON sl.id = gl.lot_id AND sl.tenant_id = gl.tenant_id
   WHERE gl.expiry_date IS NOT NULL
     AND gl.expiry_date IS DISTINCT FROM sl.expiry_date
     AND (p_tenant IS NULL OR gl.tenant_id = p_tenant)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_receipts_merged_across_expiry(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dos_receipts_merged_across_expiry(text) TO app_worker;--> statement-breakpoint
-- Armed, and read back off the catalogue rather than trusted.
DO $$
DECLARE
  t text;
  forced boolean;
  def text;
  invoker text;
  flagged bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['locations', 'stock_balances', 'stock_lots', 'grn_lines'] LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '0075: % must keep FORCE ROW LEVEL SECURITY', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = ('public.' || t)::regclass AND p.polcmd = '*') THEN
      RAISE EXCEPTION '0075: % must not carry a FOR ALL policy', t;
    END IF;
  END LOOP;
  SELECT count(*) INTO flagged FROM locations WHERE kind = 'damaged' AND negative_allowed;
  IF flagged > 0 THEN
    RAISE EXCEPTION '0075: % damaged / expiry bins still allow a balance below zero', flagged;
  END IF;
  SELECT count(*) INTO flagged
    FROM stock_balances b JOIN locations l ON l.id = b.location_id
   WHERE b.negative_allowed AND NOT l.negative_allowed AND b.on_hand >= 0;
  IF flagged > 0 THEN
    RAISE EXCEPTION '0075: % balances at zero or more still carry a below-zero flag their place does not give', flagged;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE c.relname = 'stock_balances' AND tg.tgname = 'stock_balances_never_below_zero' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION '0075: the below-zero guard on stock_balances is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE c.relname = 'locations' AND tg.tgname = 'locations_bin_kind_fixed' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION '0075: the guard that keeps the damaged / expiry bin a bin is missing';
  END IF;
  SELECT pg_get_triggerdef(tg.oid) INTO def
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE c.relname = 'locations' AND tg.tgname = 'locations_bin_kind_fixed' AND NOT tg.tgisinternal;
  IF position('active' IN def) = 0 THEN
    RAISE EXCEPTION '0075: the fixed-place guard must fire when a place is switched off; found %', def;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE c.relname = 'locations' AND tg.tgname = 'locations_fixed_place_first' AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION '0075: the guard that keeps a new place out of the godown''s, the dock''s and the bin''s seat is missing';
  END IF;
  IF has_table_privilege('app_rw', 'public.locations', 'DELETE')
     OR has_table_privilege('app_worker', 'public.locations', 'DELETE') THEN
    RAISE EXCEPTION '0075: app_rw and app_worker must not delete a location';
  END IF;
  SELECT count(*) INTO flagged
    FROM (SELECT tenant_id, kind FROM locations
           WHERE kind IN ('warehouse', 'damaged', 'in_transit')
           GROUP BY tenant_id, kind
          HAVING NOT bool_or(active)) off;
  IF flagged > 0 THEN
    RAISE EXCEPTION '0075: % distributors still have their godown, dock or bin switched off', flagged;
  END IF;
  SELECT pg_get_viewdef('sellable_stock'::regclass, true) INTO def;
  IF position('kind' IN def) = 0 OR position('warehouse' IN def) = 0 THEN
    RAISE EXCEPTION '0075: sellable_stock must filter on the location kind; found %', def;
  END IF;
  IF position('expiry_date' IN def) = 0 OR position('Asia/Kolkata' IN def) = 0 THEN
    RAISE EXCEPTION '0075: sellable_stock must leave out batches past their expiry (IST); found %', def;
  END IF;
  SELECT coalesce((
    SELECT option FROM unnest(c.reloptions) AS option WHERE option LIKE 'security_invoker=%'
  ), 'security_invoker=false')
    INTO invoker
    FROM pg_class c WHERE c.oid = 'sellable_stock'::regclass;
  IF invoker <> 'security_invoker=true' THEN
    RAISE EXCEPTION '0075: sellable_stock must stay security_invoker; found %', invoker;
  END IF;
END;
$$;
