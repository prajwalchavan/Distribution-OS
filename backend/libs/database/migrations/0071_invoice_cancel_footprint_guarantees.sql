-- Hand-written guarantee, no table / column / policy / grant change. QA DOS-257 (business simulation audit).
--
-- A CANCELLED BILL MADE 12 PIECES OF TOOR OUT OF NOTHING. INV/9034 (SO-0907, Ekta) was packed (Godown −12 →
-- dock +12), another load sheet then carried those 12 off the dock onto a van, and at 08:16 the desk cancelled
-- INV/9034. The cancel of that day found none of the bill's toor on the dock and, instead of refusing, wrote
-- `stock_ledger` +12 `adjustment` into the Godown under `ref_type = 'invoice_cancel'`. Nothing took them out
-- again: for a week the 12 were `sellable_stock`, bookable by any rep and ₹1,875.24 in the owner's stock at
-- cost. DOS-251 fixed the code (a pack bill's cancel is always dock → rack, and a dock that cannot give the
-- pieces back is a 409 `dock_short`); nothing stopped another path, or a regression of that one, from doing
-- it again.
--
-- THE RULE: cancelling a bill undoes what the bill did to stock, and nothing else. Per (bill, lot), the rows
-- the bill wrote under its own ref (`ref_type = 'invoice'`: a van sale's `sale`, the seed's old-model bills)
-- plus every row its cancel wrote (`ref_type = 'invoice_cancel'`) sum to ZERO. A pack bill's pack rows are
-- `ref_type = 'pack'` and a rack → dock movement, and its cancel is a dock → rack movement: 0 + 0. A van sale:
-- −q + q. The seed's INV/9002, SAI/9002, KA/9002: `sale` −72 + `adjustment` +72 (checked on a fresh seed,
-- `seed-demo.test.ts`). The phantom: 0 + 12 — refused.
--
-- It is a DEFERRED constraint trigger, like the journal balance (0003/0007): a cancel writes its dock leg and
-- its rack leg as two rows, so the sum is taken at COMMIT, once per invoice_cancel row inserted. The function
-- is SECURITY DEFINER with a pinned search_path (0007's lesson: under FORCE RLS a trigger running as the
-- caller may not see the rows it sums), and it refuses to pass when it cannot see even the row that fired it.
-- The sum rides `stock_ledger_ref_idx (tenant_id, ref_type, ref_id)`.
--
-- Rows written before this migration are not re-checked (a constraint trigger fires on INSERT only). The
-- release check for them is `pnpm check:stock-cancels` (`invoiceCancelFootprints` in @dos/db), which lists
-- every cancelled bill whose rows do not net to zero and whether a write-off has taken the pieces off since.
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
     AND ref_type IN ('invoice', 'invoice_cancel')
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
END;
$$;
