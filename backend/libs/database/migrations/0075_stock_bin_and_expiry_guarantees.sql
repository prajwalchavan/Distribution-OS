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
BEGIN
  IF OLD.kind = 'damaged' OR NEW.kind = 'damaged' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      CONSTRAINT = 'locations_bin_kind_fixed',
      TABLE = 'locations',
      MESSAGE = format(
        'location %s is %s and cannot become %s: the damaged / expiry bin stays the bin and no other place becomes one (QA DOS-352)',
        OLD.id, OLD.kind, NEW.kind);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS locations_bin_kind_fixed ON locations;--> statement-breakpoint
CREATE TRIGGER locations_bin_kind_fixed
  BEFORE UPDATE OF kind ON locations
  FOR EACH ROW WHEN (OLD.kind IS DISTINCT FROM NEW.kind)
  EXECUTE FUNCTION dos_location_bin_kind_fixed();--> statement-breakpoint
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
