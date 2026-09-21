-- Hand-written, no drizzle sibling: nothing about a TABLE changes here, only the view that carries the
-- name `sellable_stock` (QA DOS-204).
--
-- WHAT WAS WRONG. The view (0003) was `on_hand - reserved > 0` over EVERY location, so the damaged /
-- expiry bin was in it — measured on the pilot tenant as 85 rows and 1 241 pieces, `available` and all —
-- along with goods in transit and anything standing on a customer's own floor. Six call sites each
-- remembered a location filter of their own and the seventh that forgot would have sold expired and
-- broken stock, with the object's name saying it was safe to. A name that has to be defended by every
-- caller is not a guarantee.
--
-- WHAT THIS DOES. The predicate moves into the object: a row is in `sellable_stock` only when its
-- location is a godown (`warehouse`) or a vehicle. `vehicle` stays in because the crew's van sale reads
-- its own van through this view (docs/22 §4, D7); `stock.sellable` still narrows to a NAMED vehicle, so
-- one crew's van is never promised to someone else's order. `damaged`, `in_transit` and `customer` are
-- never sellable, not even when a caller names them — which is the point: a mistyped location id now
-- returns nothing instead of the bin.
--
-- Nothing is hidden from the books: `stock_balances` and `stock_ledger` still hold every piece wherever
-- it stands, and `stock.balances` still shows it.
--
-- security_invoker STAYS TRUE. It is what makes a shop's ATP hint read `stock_balances`, `stock_lots` and
-- now `locations` as the retailer role, under those tables' own RLS, rather than as the view's owner.
-- Postgres 15+ (docs/16). `locations` is `tenantReadPolicy`, so every member may read it and the join
-- adds no new visibility.
--
-- CREATE OR REPLACE keeps the column list, its order and the GRANT, so no dependent object is dropped.

CREATE OR REPLACE VIEW sellable_stock WITH (security_invoker = true) AS
  SELECT b.tenant_id, l.variant_id, b.location_id, l.id AS lot_id, l.batch_no, l.mrp_paise, l.expiry_date,
         b.on_hand, b.reserved, (b.on_hand - b.reserved) AS available
  FROM stock_balances b
  JOIN stock_lots l ON l.id = b.lot_id
  JOIN locations loc ON loc.id = b.location_id AND loc.tenant_id = b.tenant_id
  WHERE (b.on_hand - b.reserved) > 0
    AND loc.kind IN ('warehouse', 'vehicle');--> statement-breakpoint

-- The guarantee is armed: the view still runs as its invoker, and it still refuses the three unsellable
-- kinds. Both are read off the catalogue rather than trusted, so a later edit that drops either fails the
-- migration instead of quietly re-opening the bin.
DO $$
DECLARE
  def text;
  invoker text;
BEGIN
  SELECT pg_get_viewdef('sellable_stock'::regclass, true) INTO def;
  IF def IS NULL THEN
    RAISE EXCEPTION '0059: sellable_stock is missing' USING ERRCODE = 'undefined_table';
  END IF;
  IF position('kind' IN def) = 0 OR position('warehouse' IN def) = 0 THEN
    RAISE EXCEPTION '0059: sellable_stock must filter on the location kind; found %', def
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce((
    SELECT option FROM unnest(c.reloptions) AS option WHERE option LIKE 'security_invoker=%'
  ), 'security_invoker=false')
    INTO invoker
    FROM pg_class c WHERE c.oid = 'sellable_stock'::regclass;
  IF invoker <> 'security_invoker=true' THEN
    RAISE EXCEPTION '0059: sellable_stock must stay security_invoker so RLS is the reader''s, not the owner''s; found %',
      invoker USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;
