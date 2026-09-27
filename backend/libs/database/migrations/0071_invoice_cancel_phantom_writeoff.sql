-- Hand-written: DATA repair + guarantee. No table, column, policy or grant on a table changes here. QA DOS-257
-- (business simulation, blind audit, P0).
--
-- A CANCELLED BILL MADE 12 PIECES OF TOOR OUT OF NOTHING, AND NOTHING EVER TOOK THEM OUT. INV/9034 (SO-0907,
-- Ekta) was packed (Godown −12 → dock +12), another load sheet then carried those 12 off the dock onto a van,
-- and at 08:16 the desk cancelled INV/9034. The cancel of that day found none of the bill's toor on the dock
-- and, instead of refusing, wrote `stock_ledger` +12 `adjustment` into the Godown under `ref_type =
-- 'invoice_cancel'`. DOS-251 fixed the code (a pack bill's cancel is always dock → rack; a dock that cannot
-- give the pieces back is a 409 `dock_short`), but the 12 it had already invented stayed in the books:
-- `sellable_stock`, bookable by any rep, ₹1,875.24 in the owner's stock at cost. The audit re-found them a
-- day later — no count, no write-off, no correcting row. A fix that stops new cases and leaves the old ones
-- for somebody to notice is half a fix; this migration finishes it, in every database it runs on.
--
-- 1. THE FOOTPRINT (`dos_invoice_cancel_footprints`). Cancelling a bill undoes what the bill did to stock and
--    nothing else, so per lot the bill's rows net to zero:
--      a pack bill   its ORDER's pack rows (`ref_type = 'pack'`, rack → dock since DOS-195: 0; a `sale` of
--                    −q under the old model) + the bill's own rows (`invoice`: none; `invoice_cancel`:
--                    dock → rack = 0, or the old model's `adjustment` +q) = 0 + 0, or −q + q;
--      any other     the bill's own `invoice` rows (a van sale's `sale` −q, the seed's old-model bills) + its
--                    `invoice_cancel` rows (+q) = 0.
--    A pack bill is accounted together with its order's pack rows because under the old model the pieces
--    left under the ORDER's ref: without them the old model's honest +q would read as invented stock. What
--    is left over (> 0) is stock a cancel invented; < 0, stock a cancel lost. Only (bill, lot)s that had a
--    cancel are looked at, per tenant through `stock_ledger_ref_idx`.
--
-- 2. THE WRITE-OFF (`dos_write_off_invoice_cancel_phantoms`, run once below). For every footprint > 0 that
--    a cancel's `adjustment` put somewhere, take the invented pieces off again, at that place:
--      want  = the footprint (never more than the cancel's own `adjustment` rows put there)
--              − what a hand write-off or count on that lot at that place has already taken off since
--                (`adjustment` / `damage` / `expiry_writeoff` / `cycle_count`, negative: the owner may have
--                done it on the Stock screen already, and it must not be taken twice);
--      write = min(want, on hand there now)  — pieces that have since moved on are not chased;
--    as ONE `adjustment` row, `ref_type = 'invoice_cancel_writeoff'`, `ref_id` = the bill, key
--    `invoice-cancel-writeoff:<bill>:<lot>:<location>`, a note that says what it is, and the balance moved
--    the way `InventoryService.post` moves it. The bill's footprint is then zero, so the release check
--    (`pnpm check:stock-cancels`, which reads the same function) passes, and a second run finds nothing.
--    On the simulation's database it writes Godown −12 toor B20260909 for INV/9034. On a fresh seed it
--    writes nothing: the seed's INV/9002, SAI/9002, KA/9002 are `sale` −72 + `adjustment` +72.
--
-- 3. THE GUARANTEE (`stock_ledger_invoice_cancel_leaves_nothing`). Per (bill, lot) the bill's own
--    `invoice`, `invoice_cancel` and `invoice_cancel_writeoff` rows sum to zero, checked at COMMIT: a DEFERRED
--    constraint trigger like the journal balance (0003/0007), because a cancel writes its dock leg and its
--    rack leg as two rows. SECURITY DEFINER with a pinned search_path (0007's lesson: under FORCE RLS a
--    trigger running as the caller may not see the rows it sums), and it refuses to pass when it cannot see
--    even the row that fired it. It is created AFTER the write-off so it never judges rows written before it.
CREATE OR REPLACE FUNCTION dos_invoice_cancel_footprints(p_tenant text DEFAULT NULL)
RETURNS TABLE (
  tenant_id text,
  order_id text,
  invoice_ids text[],
  lot_id text,
  footprint_pcs bigint,
  cancel_row_ids text[],
  adjust_invoice_id text,
  adjust_location_id text,
  adjust_actor_id text,
  first_adjust_at timestamptz,
  adjust_pcs bigint,
  taken_off_pcs bigint,
  taken_off_row_ids text[]
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH cancel_rows AS (
    SELECT s.*
      FROM tenants t
      JOIN LATERAL (
        SELECT l.* FROM stock_ledger l
         WHERE l.tenant_id = t.id AND l.ref_type = 'invoice_cancel' AND l.ref_id IS NOT NULL) s ON true
     WHERE p_tenant IS NULL OR t.id = p_tenant),
  bills AS (
    SELECT DISTINCT c.tenant_id, c.ref_id AS invoice_id, c.lot_id,
           CASE WHEN i.source = 'pack' AND i.order_id IS NOT NULL THEN i.order_id END AS order_id
      FROM cancel_rows c
      LEFT JOIN invoices i ON i.tenant_id = c.tenant_id AND i.id = c.ref_id),
  groups AS (
    SELECT b.tenant_id, b.order_id, b.lot_id, array_agg(b.invoice_id ORDER BY b.invoice_id) AS invoice_ids
      FROM bills b
     GROUP BY b.tenant_id, b.order_id, coalesce(b.order_id, b.invoice_id), b.lot_id),
  footprints AS (
    SELECT g.*,
           (SELECT coalesce(sum(s.qty_delta), 0) FROM stock_ledger s
             WHERE s.tenant_id = g.tenant_id AND s.lot_id = g.lot_id
               AND s.ref_type IN ('invoice', 'invoice_cancel', 'invoice_cancel_writeoff')
               AND s.ref_id = ANY (g.invoice_ids))
           + CASE WHEN g.order_id IS NULL THEN 0 ELSE
               (SELECT coalesce(sum(s.qty_delta), 0) FROM stock_ledger s
                 WHERE s.tenant_id = g.tenant_id AND s.lot_id = g.lot_id
                   AND s.ref_type = 'pack' AND s.ref_id = g.order_id) END AS footprint
      FROM groups g)
  SELECT f.tenant_id, f.order_id, f.invoice_ids, f.lot_id, f.footprint::bigint,
         (SELECT array_agg(c.id ORDER BY c.created_at, c.id) FROM cancel_rows c
           WHERE c.tenant_id = f.tenant_id AND c.lot_id = f.lot_id AND c.ref_id = ANY (f.invoice_ids)),
         a.ref_id, a.location_id, a.actor_id, a.created_at,
         (SELECT coalesce(sum(c.qty_delta), 0) FROM cancel_rows c
           WHERE c.tenant_id = f.tenant_id AND c.lot_id = f.lot_id AND c.ref_id = ANY (f.invoice_ids)
             AND c.location_id = a.location_id AND c.reason = 'adjustment' AND c.qty_delta > 0)::bigint,
         coalesce(m.pcs, 0)::bigint, coalesce(m.ids, ARRAY[]::text[])
    FROM footprints f
    LEFT JOIN LATERAL (
      SELECT c.ref_id, c.location_id, c.actor_id, c.created_at FROM cancel_rows c
       WHERE c.tenant_id = f.tenant_id AND c.lot_id = f.lot_id AND c.ref_id = ANY (f.invoice_ids)
         AND c.reason = 'adjustment' AND c.qty_delta > 0
       ORDER BY c.created_at, c.id LIMIT 1) a ON true
    LEFT JOIN LATERAL (
      SELECT -sum(h.qty_delta) AS pcs, array_agg(h.id ORDER BY h.created_at, h.id) AS ids
        FROM stock_ledger h
       WHERE h.tenant_id = f.tenant_id AND h.lot_id = f.lot_id AND h.location_id = a.location_id
         AND h.created_at > a.created_at AND h.qty_delta < 0
         AND h.reason IN ('adjustment', 'damage', 'expiry_writeoff', 'cycle_count')
         AND h.ref_type IS DISTINCT FROM 'invoice_cancel'
         AND h.ref_type IS DISTINCT FROM 'invoice_cancel_writeoff') m ON a.location_id IS NOT NULL
   WHERE f.footprint <> 0
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_invoice_cancel_footprints(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION dos_invoice_cancel_footprints(text) TO app_worker;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_write_off_invoice_cancel_phantoms(p_tenant text DEFAULT NULL)
RETURNS TABLE (
  tenant_id text,
  invoice_id text,
  invoice_no text,
  lot_id text,
  location_id text,
  footprint_pcs bigint,
  taken_off_pcs bigint,
  on_hand_pcs bigint,
  written_pcs bigint,
  ledger_row_id text
)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  f record;
  held bigint;
  want bigint;
  amt bigint;
  bill text;
  row_id text;
BEGIN
  FOR f IN
    SELECT * FROM dos_invoice_cancel_footprints(p_tenant) x
     WHERE x.footprint_pcs > 0 AND x.adjust_location_id IS NOT NULL
     ORDER BY x.tenant_id, x.first_adjust_at, x.lot_id
  LOOP
    SELECT b.on_hand INTO held FROM stock_balances b
     WHERE b.tenant_id = f.tenant_id AND b.lot_id = f.lot_id AND b.location_id = f.adjust_location_id
       FOR UPDATE;
    held := coalesce(held, 0);
    want := least(f.footprint_pcs, f.adjust_pcs) - f.taken_off_pcs;
    amt := greatest(0, least(want, held));
    SELECT i.invoice_no INTO bill FROM invoices i WHERE i.tenant_id = f.tenant_id AND i.id = f.adjust_invoice_id;
    bill := coalesce(bill, f.adjust_invoice_id);
    row_id := NULL;
    IF amt > 0 THEN
      INSERT INTO stock_ledger AS s
        (id, tenant_id, occurred_at, lot_id, location_id, qty_delta, reason, ref_type, ref_id, actor_id,
         idempotency_key, note)
      VALUES (gen_random_uuid()::text, f.tenant_id, now(), f.lot_id, f.adjust_location_id, -amt, 'adjustment',
              'invoice_cancel_writeoff', f.adjust_invoice_id, f.adjust_actor_id,
              'invoice-cancel-writeoff:' || f.adjust_invoice_id || ':' || f.lot_id || ':' || f.adjust_location_id,
              format('%s pc that cancelling %s put back here were never taken off the dock, so they never existed: taken off again (QA DOS-251, DOS-257)',
                     amt, bill))
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING s.id INTO row_id;
      IF row_id IS NULL THEN
        amt := 0;
      ELSE
        UPDATE stock_balances b
           SET on_hand = b.on_hand - amt, version = b.version + 1, updated_at = now()
         WHERE b.tenant_id = f.tenant_id AND b.lot_id = f.lot_id AND b.location_id = f.adjust_location_id;
      END IF;
    END IF;
    tenant_id := f.tenant_id;
    invoice_id := f.adjust_invoice_id;
    invoice_no := bill;
    lot_id := f.lot_id;
    location_id := f.adjust_location_id;
    footprint_pcs := f.footprint_pcs;
    taken_off_pcs := f.taken_off_pcs;
    on_hand_pcs := held;
    written_pcs := amt;
    ledger_row_id := row_id;
    RETURN NEXT;
  END LOOP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION dos_write_off_invoice_cancel_phantoms(text) FROM PUBLIC;--> statement-breakpoint
DO $$
DECLARE
  r record;
  n integer := 0;
  pcs bigint := 0;
BEGIN
  FOR r IN SELECT * FROM dos_write_off_invoice_cancel_phantoms() LOOP
    IF r.written_pcs > 0 THEN
      n := n + 1;
      pcs := pcs + r.written_pcs;
      RAISE NOTICE '0071: % wrote off % pc of lot % at location % (footprint %, taken off by hand before %)',
        r.invoice_no, r.written_pcs, r.lot_id, r.location_id, r.footprint_pcs, r.taken_off_pcs;
    END IF;
    IF r.footprint_pcs - r.taken_off_pcs - r.written_pcs > 0 THEN
      RAISE NOTICE '0071: % still leaves % pc of lot % that are no longer at location % (pnpm check:stock-cancels lists it)',
        r.invoice_no, r.footprint_pcs - r.taken_off_pcs - r.written_pcs, r.lot_id, r.location_id;
    END IF;
  END LOOP;
  RAISE NOTICE '0071: % invented footprint(s) written off, % pc', n, pcs;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_invoice_cancel_leaves_nothing() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  footprint bigint;
  seen bigint;
BEGIN
  SELECT COALESCE(SUM(qty_delta), 0), COUNT(*) FILTER (WHERE id = NEW.id)
    INTO footprint, seen
    FROM stock_ledger
   WHERE tenant_id = NEW.tenant_id
     AND lot_id = NEW.lot_id
     AND ref_type IN ('invoice', 'invoice_cancel', 'invoice_cancel_writeoff')
     AND ref_id = NEW.ref_id;
  IF seen = 0 THEN
    RAISE EXCEPTION 'stock ledger row % is not visible to the invoice-cancel check; row level security is hiding it (this function must be SECURITY DEFINER and owned by a role that bypasses RLS)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF footprint <> 0 THEN
    RAISE EXCEPTION 'cancelling invoice % would leave % pc of lot % % the bill itself moved: a cancel only takes back the bill''s own pieces, it never makes or loses stock (QA DOS-257)',
      NEW.ref_id, abs(footprint), NEW.lot_id,
      CASE WHEN footprint > 0 THEN 'in stock beyond what' ELSE 'missing against what' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS stock_ledger_invoice_cancel_leaves_nothing ON stock_ledger;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_ledger_invoice_cancel_leaves_nothing
  AFTER INSERT ON stock_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.ref_type = 'invoice_cancel')
  EXECUTE FUNCTION dos_invoice_cancel_leaves_nothing();--> statement-breakpoint
DO $$
DECLARE
  forced boolean;
  deferred boolean;
  left_here bigint;
BEGIN
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'stock_ledger';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0071: stock_ledger must keep FORCE ROW LEVEL SECURITY';
  END IF;
  SELECT t.tginitdeferred INTO deferred
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'stock_ledger' AND t.tgname = 'stock_ledger_invoice_cancel_leaves_nothing';
  IF deferred IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0071: the invoice-cancel check must be a deferred constraint trigger (a cancel writes its two legs as two rows)';
  END IF;
  -- The write-off is armed: no invented footprint is still standing where the cancel put it.
  SELECT count(*) INTO left_here
    FROM dos_invoice_cancel_footprints() f
    JOIN stock_balances b
      ON b.tenant_id = f.tenant_id AND b.lot_id = f.lot_id AND b.location_id = f.adjust_location_id
   WHERE f.footprint_pcs > 0
     AND least(f.footprint_pcs, f.adjust_pcs) - f.taken_off_pcs > 0
     AND b.on_hand > 0;
  IF left_here > 0 THEN
    RAISE EXCEPTION '0071: % invented footprint(s) still stand where their cancel put them', left_here
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;
