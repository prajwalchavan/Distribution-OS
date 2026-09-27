-- Hand-written, DATA, idempotent: no table, view, policy or grant changes here (QA DOS-247).
--
-- WHAT WAS WRONG. The dock (the tenant's `in_transit` location, QA DOS-195) was one pool per batch. A load
-- sheet checked "are there N pieces of this lot on the dock", not "are THIS bill's pieces there", so on the
-- business simulation's day 6 a bill that had come back the day before (its own pieces counted onto the rack
-- and sold) loaded the toor packed an hour earlier for three of today's shops, and the next three sheets were
-- refused for a shortfall no screen could name.
--
-- Since DOS-247 every writer that puts a bill's pieces on the dock HOLDS them for that bill: a `reservations`
-- row at the dock, keyed by the order line, with the dock balance's `reserved` raised by as much (the pack,
-- the van check-in, the settlement's count, the desk's "It came back", the sheet's "Bring them from the
-- godown"), and every reader that takes them off (the load-out, a cancel, a credit note before dispatch) takes
-- that bill's holds first and otherwise only what the dock holds for NOBODY. `sellable_stock` leaves the dock
-- out (0063), so a hold there never touches what a rep may sell.
--
-- THIS BACK-FILL gives the bills already standing on a dock the holds the new pack would have written, so a
-- stale bill cannot take them either:
--
--   every pack IN row onto a dock (ref_type pack, qty_delta > 0, at an `in_transit` location) of an order
--   still `packed` that has never been on a CONFIRMED load sheet — its pieces are where the pack put them —
--   and whose order line holds nothing on that dock yet
--     → a pending hold for that order line and lot, the order line read off the pack's own key
--       (`pack:<orderId>:<orderLineId>:<lotId>:in`) and checked against `sales_order_lines`;
--   capped, oldest pack first, by what that dock balance holds for nobody (`on_hand − reserved`), so no hold
--   ever claims a piece that is not standing there.
--
-- A bill that has been loaded before and came back gets no hold here: whether its pieces are on the dock
-- depends on a check-in this migration cannot see, so it keeps the old behaviour — covered by the dock's
-- unheld pieces, never by another bill's holds. Guarded by NOT EXISTS on a pending dock hold per order line: a
-- second run writes nothing. The DO block fails the migration if any dock balance ends up holding more than
-- stands on it.

DO $$
DECLARE
  held  bigint;
  over  bigint;
BEGIN
  CREATE TEMP TABLE backfill_hold ON COMMIT DROP AS
  WITH packs AS (
    SELECT p.tenant_id, p.location_id AS dock_id, p.lot_id, p.qty_delta AS qty, p.occurred_at,
           p.id AS ledger_id, sol.id AS order_line_id
      FROM stock_ledger p
      JOIN locations d ON d.id = p.location_id AND d.kind = 'in_transit'
      JOIN sales_orders o ON o.id = p.ref_id AND o.tenant_id = p.tenant_id AND o.state = 'packed'
      JOIN sales_order_lines sol
        ON sol.id = split_part(p.idempotency_key, ':', 3) AND sol.order_id = o.id
     WHERE p.ref_type = 'pack' AND p.qty_delta > 0
       AND NOT EXISTS (SELECT 1 FROM load_sheets ls
                        WHERE ls.tenant_id = p.tenant_id AND ls.status = 'confirmed'
                          AND ls.order_ids ? o.id)
       AND NOT EXISTS (SELECT 1 FROM reservations r
                        WHERE r.tenant_id = p.tenant_id AND r.location_id = p.location_id
                          AND r.state = 'pending' AND r.order_line_id = sol.id)),
  ranked AS (
    SELECT pk.*,
           sum(pk.qty) OVER (PARTITION BY pk.tenant_id, pk.dock_id, pk.lot_id
                             ORDER BY pk.occurred_at, pk.ledger_id) AS running
      FROM packs pk)
  SELECT r.tenant_id, r.dock_id, r.lot_id, r.order_line_id, l.variant_id,
         greatest(0, least(r.qty, coalesce(b.on_hand - b.reserved, 0) - (r.running - r.qty)))::integer
           AS qty
    FROM ranked r
    JOIN stock_lots l ON l.id = r.lot_id
    LEFT JOIN stock_balances b
      ON b.tenant_id = r.tenant_id AND b.lot_id = r.lot_id AND b.location_id = r.dock_id;

  DELETE FROM backfill_hold WHERE qty <= 0;

  INSERT INTO reservations (id, tenant_id, order_line_id, variant_id, lot_id, location_id, qty, state)
  SELECT gen_random_uuid()::text, h.tenant_id, h.order_line_id, h.variant_id, h.lot_id, h.dock_id, h.qty,
         'pending'
    FROM backfill_hold h;
  GET DIAGNOSTICS held = ROW_COUNT;

  UPDATE stock_balances b
     SET reserved = b.reserved + h.qty, version = b.version + 1, updated_at = now()
    FROM (SELECT tenant_id, dock_id, lot_id, sum(qty) AS qty
            FROM backfill_hold GROUP BY 1, 2, 3) h
   WHERE b.tenant_id = h.tenant_id AND b.lot_id = h.lot_id AND b.location_id = h.dock_id;

  RAISE NOTICE '0068: % packed bill lines now hold their pieces on the dock', held;

  SELECT count(*) INTO over
    FROM stock_balances b
    JOIN locations d ON d.id = b.location_id AND d.kind = 'in_transit'
   WHERE b.reserved > b.on_hand;
  IF over > 0 THEN
    RAISE EXCEPTION '0068: % dock balances would hold more pieces than stand on them', over
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;
