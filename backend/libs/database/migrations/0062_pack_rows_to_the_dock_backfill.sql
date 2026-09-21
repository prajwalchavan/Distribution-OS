-- Hand-written, DATA, idempotent: no table, view, policy or grant changes here (QA DOS-195, ruling S4).
--
-- WHAT WAS WRONG. Until DOS-195 a pack posted the order's pieces as a `sale` the moment the carton
-- was taped, so between the pack bench and the shop's counter they stood in no location: a refused
-- bill's cartons were physically on a van and nowhere in the database, and the van check-in built to
-- count them back had nothing to count. Since DOS-195 a pack moves them rack → DOCK (the tenant's
-- `in_transit` location) as `transfer_out` + `transfer_in`, keyed `pack:<order>:<line>:<lot>` and
-- `…:in`; the load-out moves them dock → vehicle (`load:<sheetId>:<lotId>:pack:out|in`); the door
-- relieves the vehicle; the check-in stages an undelivered bill back on the dock.
--
-- A database seeded or operated under the old model carries pack OUT rows with no IN sibling, so every
-- order still `packed` or `dispatched` on it has pieces standing nowhere — and the new load-out, which
-- never clamps (ruling S2), would refuse every one of those bills at the dock. The founder's own
-- database cannot be re-seeded (the seed guard refuses it), so this back-fill writes the legs the new
-- code would have written, exactly as it writes them:
--
--   every pack OUT row (ref_type = pack, qty_delta < 0, at a warehouse-kind location) of an order in
--   `packed` or `dispatched` whose key has no `:in` sibling
--     → +qty at the tenant's dock, reason transfer_in, key `<packkey>:in`, ref_type pack, ref_id order
--       (a packed order stands on the dock; so does an undelivered bill on a settled trip, whose order is
--       `packed` again);
--   every DISPATCHED order among them that rode out on a confirmed load sheet whose trip is still out of
--   the godown (loading / active / closing)
--     → dock → that sheet's vehicle per (sheet, lot), keys `load:<sheetId>:<lotId>:pack:out|in`, sized so
--       the vehicle holds the whole of what the sheet's dispatched orders packed (a sheet the clamped code
--       partly loaded is topped up under `…:pack:0062:out|in`);
--   a delivered, partially delivered or closed order, or a cancelled bill → nothing: sold or credited
--   under the old model, its pieces are accounted for.
--
-- `stock_balances` moves the way `InventoryService.post` moves it: UPDATE first, INSERT the (lot,
-- location) row when there is none. A tenant that has pack rows to stage but no `in_transit` location
-- (created before the bootstrap wrote one) is given the one the bootstrap gives everybody, because the
-- new pack code refuses to run without it.
--
-- Guarded by NOT EXISTS on every key: a second run inserts nothing and moves nothing. The DO block at
-- the end fails the migration if any packed or dispatched order is still left with pieces in no
-- location, or if any location that forbids a negative balance holds one.

DO $$
DECLARE
  staged     bigint;
  loaded     bigint;
  unstaged   bigint;
  negatives  bigint;
BEGIN
  ---------------------------------------------------------------------------------------------------
  -- 0. Every tenant with pack rows to stage has a dock.
  ---------------------------------------------------------------------------------------------------
  INSERT INTO locations (id, tenant_id, kind, name, negative_allowed, active)
  SELECT gen_random_uuid()::text, t.id, 'in_transit', 'In transit', false, true
    FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM locations d WHERE d.tenant_id = t.id AND d.kind = 'in_transit')
     AND EXISTS (
       SELECT 1
         FROM stock_ledger p
         JOIN locations loc ON loc.id = p.location_id AND loc.kind = 'warehouse'
         JOIN sales_orders o ON o.id = p.ref_id AND o.tenant_id = p.tenant_id
        WHERE p.tenant_id = t.id AND p.ref_type = 'pack' AND p.qty_delta < 0
          AND o.state IN ('packed', 'dispatched')
          AND NOT EXISTS (SELECT 1 FROM stock_ledger s
                           WHERE s.tenant_id = p.tenant_id AND s.idempotency_key = p.idempotency_key || ':in'));

  ---------------------------------------------------------------------------------------------------
  -- 1. The pack OUT rows that have no IN leg: what left the rack and landed nowhere.
  ---------------------------------------------------------------------------------------------------
  CREATE TEMP TABLE backfill_pack ON COMMIT DROP AS
  SELECT p.tenant_id, p.occurred_at, p.lot_id, -p.qty_delta AS qty, p.ref_id AS order_id,
         p.actor_id, p.idempotency_key, o.state AS order_state, dock.id AS dock_id
    FROM stock_ledger p
    JOIN locations loc ON loc.id = p.location_id AND loc.kind = 'warehouse'
    JOIN sales_orders o ON o.id = p.ref_id AND o.tenant_id = p.tenant_id
    JOIN LATERAL (
      SELECT d.id FROM locations d
       WHERE d.tenant_id = p.tenant_id AND d.kind = 'in_transit' AND d.active
       ORDER BY d.id LIMIT 1) dock ON true
   WHERE p.ref_type = 'pack' AND p.qty_delta < 0
     AND o.state IN ('packed', 'dispatched')
     AND NOT EXISTS (SELECT 1 FROM stock_ledger s
                      WHERE s.tenant_id = p.tenant_id AND s.idempotency_key = p.idempotency_key || ':in');

  ---------------------------------------------------------------------------------------------------
  -- 2. Rack → dock: the IN leg, keyed as `InventoryService.postPick` keys it.
  ---------------------------------------------------------------------------------------------------
  CREATE TEMP TABLE backfill_written (tenant_id text, lot_id text, location_id text, qty_delta integer)
    ON COMMIT DROP;

  WITH ins AS (
    INSERT INTO stock_ledger
      (id, tenant_id, occurred_at, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id,
       idempotency_key, note)
    SELECT gen_random_uuid()::text, b.tenant_id, b.occurred_at, b.lot_id, b.dock_id, b.qty,
           'transfer_in', 'pack', b.order_id, b.actor_id, b.idempotency_key || ':in',
           'staged on the dock by migration 0062: packed before the dock existed'
      FROM backfill_pack b
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING tenant_id, lot_id, location_id, qty_delta)
  INSERT INTO backfill_written SELECT tenant_id, lot_id, location_id, qty_delta FROM ins;
  GET DIAGNOSTICS staged = ROW_COUNT;

  ---------------------------------------------------------------------------------------------------
  -- 3. Dock → vehicle for the dispatched orders riding a confirmed sheet whose trip is out of the
  --    godown, per (sheet, lot): the whole of what those orders packed, less whatever a sheet already
  --    carries under the service's own key.
  ---------------------------------------------------------------------------------------------------
  CREATE TEMP TABLE backfill_load ON COMMIT DROP AS
  WITH riding AS (
    SELECT DISTINCT b.tenant_id, b.order_id, b.dock_id, s.sheet_id, s.to_location_id, s.confirmed_at
      FROM backfill_pack b
      JOIN LATERAL (
        SELECT ls.id AS sheet_id, ls.to_location_id, ls.confirmed_at
          FROM load_sheets ls
          JOIN trips t ON t.id = ls.trip_id
         WHERE ls.tenant_id = b.tenant_id AND ls.status = 'confirmed'
           AND ls.order_ids ? b.order_id
           AND t.state IN ('loading', 'active', 'closing')
         ORDER BY ls.confirmed_at DESC NULLS LAST, ls.id DESC
         LIMIT 1) s ON true
     WHERE b.order_state = 'dispatched'),
  need AS (
    SELECT r.tenant_id, r.sheet_id, r.to_location_id, r.dock_id, r.confirmed_at, p.lot_id,
           sum(-p.qty_delta) AS qty, min(p.actor_id) AS actor_id
      FROM riding r
      JOIN stock_ledger p
        ON p.tenant_id = r.tenant_id AND p.ref_type = 'pack' AND p.ref_id = r.order_id AND p.qty_delta < 0
     GROUP BY 1, 2, 3, 4, 5, 6)
  SELECT n.*,
         coalesce((SELECT sum(l.qty_delta) FROM stock_ledger l
                    WHERE l.tenant_id = n.tenant_id
                      AND l.idempotency_key IN ('load:' || n.sheet_id || ':' || n.lot_id || ':pack:in',
                                                'load:' || n.sheet_id || ':' || n.lot_id || ':pack:0062:in')), 0)
           AS already
    FROM need n;

  WITH pairs AS (
    SELECT l.tenant_id, l.lot_id, l.sheet_id, l.actor_id, coalesce(l.confirmed_at, now()) AS at,
           (l.qty - l.already) AS qty,
           CASE WHEN EXISTS (SELECT 1 FROM stock_ledger e
                              WHERE e.tenant_id = l.tenant_id
                                AND e.idempotency_key = 'load:' || l.sheet_id || ':' || l.lot_id || ':pack:in')
                THEN 'load:' || l.sheet_id || ':' || l.lot_id || ':pack:0062'
                ELSE 'load:' || l.sheet_id || ':' || l.lot_id || ':pack' END AS stem,
           l.dock_id, l.to_location_id
      FROM backfill_load l
     WHERE l.qty > l.already),
  ins AS (
    INSERT INTO stock_ledger
      (id, tenant_id, occurred_at, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id,
       idempotency_key, note)
    SELECT gen_random_uuid()::text, p.tenant_id, p.at, p.lot_id, leg.location_id, leg.qty_delta, leg.reason,
           'load_sheet', p.sheet_id, p.actor_id, p.stem || leg.suffix,
           'loaded dock → vehicle by migration 0062: dispatched before the dock existed'
      FROM pairs p
      CROSS JOIN LATERAL (VALUES
        (p.dock_id, -p.qty, 'transfer_out'::stock_reason, ':out'),
        (p.to_location_id, p.qty, 'transfer_in'::stock_reason, ':in')) AS leg(location_id, qty_delta, reason, suffix)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING tenant_id, lot_id, location_id, qty_delta)
  INSERT INTO backfill_written SELECT tenant_id, lot_id, location_id, qty_delta FROM ins;
  GET DIAGNOSTICS loaded = ROW_COUNT;

  ---------------------------------------------------------------------------------------------------
  -- 4. Balances, the way the service moves them: UPDATE first, INSERT the pair that has no row.
  ---------------------------------------------------------------------------------------------------
  CREATE TEMP TABLE backfill_delta ON COMMIT DROP AS
  SELECT tenant_id, lot_id, location_id, sum(qty_delta) AS qty
    FROM backfill_written GROUP BY 1, 2, 3;

  UPDATE stock_balances b
     SET on_hand = b.on_hand + d.qty, version = b.version + 1, updated_at = now()
    FROM backfill_delta d
   WHERE b.tenant_id = d.tenant_id AND b.lot_id = d.lot_id AND b.location_id = d.location_id;

  INSERT INTO stock_balances (tenant_id, lot_id, location_id, on_hand, reserved, negative_allowed)
  SELECT d.tenant_id, d.lot_id, d.location_id, d.qty, 0, loc.negative_allowed
    FROM backfill_delta d
    JOIN locations loc ON loc.id = d.location_id
   WHERE NOT EXISTS (SELECT 1 FROM stock_balances b
                      WHERE b.tenant_id = d.tenant_id AND b.lot_id = d.lot_id AND b.location_id = d.location_id);

  RAISE NOTICE '0062: staged % pack legs on the dock and wrote % load legs dock → vehicle', staged, loaded;

  ---------------------------------------------------------------------------------------------------
  -- 5. The guarantee is armed: no packed or dispatched order is left with pieces in no location, and
  --    no location that forbids a negative balance holds one.
  ---------------------------------------------------------------------------------------------------
  SELECT count(*) INTO unstaged
    FROM stock_ledger p
    JOIN locations loc ON loc.id = p.location_id AND loc.kind = 'warehouse'
    JOIN sales_orders o ON o.id = p.ref_id AND o.tenant_id = p.tenant_id
   WHERE p.ref_type = 'pack' AND p.qty_delta < 0
     AND o.state IN ('packed', 'dispatched')
     AND NOT EXISTS (SELECT 1 FROM stock_ledger s
                      WHERE s.tenant_id = p.tenant_id AND s.idempotency_key = p.idempotency_key || ':in');
  IF unstaged > 0 THEN
    RAISE EXCEPTION '0062: % pack rows of packed/dispatched orders still have no IN leg onto the dock', unstaged
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT count(*) INTO negatives FROM stock_balances WHERE on_hand < 0 AND NOT negative_allowed;
  IF negatives > 0 THEN
    RAISE EXCEPTION '0062: % stock balances are negative where the location forbids it', negatives
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;
