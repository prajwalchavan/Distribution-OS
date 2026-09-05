-- Hand-written companion to 0006_receivables_expand.sql: the guarantees drizzle-kit cannot express.
-- Everything declarable in src/schema/receivables.ts (columns, indexes, check swaps, policy replacement)
-- is in the GENERATED 0006 and is deliberately NOT repeated here (docs/plans/00-coordination.md §2 rule 3).
--
-- 1. FORCE ROW LEVEL SECURITY on the two new tenant tables, so even the owner connection obeys the policies
--    that 0006 created (ADR 0002; the docs/17 §49-52 test enumerates every tenant_id table).
ALTER TABLE "write_offs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retailer_outstanding_summary" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- 2. Grants for the runtime roles, mirroring 0001 (app_rw) and 0003 (app_worker). RLS, not GRANT, is what
--    separates the roles; these are idempotent and keep the two tables correct on a database whose default
--    privileges were changed by hand.
GRANT SELECT, INSERT, UPDATE, DELETE ON "write_offs" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "retailer_outstanding_summary" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "write_offs" TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "retailer_outstanding_summary" TO app_worker;--> statement-breakpoint
-- 3. THE REASON THIS MIGRATION EXISTS (docs/plans/00-coordination.md §5.2).
--
--    0003 created dos_journal_entry_balanced() WITHOUT `SECURITY DEFINER`, and journal_lines carries FORCE
--    ROW LEVEL SECURITY. The deferred trigger's own `SELECT SUM(amount_paise) ... WHERE entry_id = ...`
--    therefore runs under the CALLER's policies. That was harmless while journal_lines_tenant let every
--    member of the tenant read the book. 0006 narrows SELECT to the back office (the ADR 0002 cost
--    guarantee: PURCHASES, STOCK and every GRN posting live in these two tables) while keeping INSERT open
--    to the roles that take money in the field. From that moment on, a `delivery` actor posting a doorstep
--    receipt inserts lines the trigger cannot see: the sum reads 0, zero means "balanced", and AN UNBALANCED
--    MONEY ENTRY COMMITS SILENTLY — for exactly the role that handles cash. The existing rls.test case runs
--    as a back-office role and would have kept passing while the guarantee was gone.
--
--    Two changes, both required:
--    (a) SECURITY DEFINER, so the sum is taken as the function's owner (the migrating role, which carries
--        BYPASSRLS) rather than as the field actor. `SET search_path = public, pg_temp` pins the schema
--        search and puts pg_temp LAST, so a temporary table named journal_lines cannot shadow the real one
--        (Postgres searches pg_temp first unless it is named explicitly).
--    (b) A visibility self-check. The trigger is AFTER INSERT FOR EACH ROW, so the row that fired it always
--        exists; if the function can see NO line for the entry, row level security is hiding them and the
--        balance test is unsound. Raising there turns a silent, invisible failure into a loud one in any
--        deployment whose migrating role does not bypass RLS, instead of quietly accepting bad money.
--
--    Same audit applies to dos_invoice_lines_immutable() (it reads `invoices`): it is safe today because
--    every role that can UPDATE invoice_lines can also SELECT invoices (invoices_read is tenant-wide for
--    staff, and staffWritePolicy gates the write). Re-check it if invoices' read policy is ever narrowed.
CREATE OR REPLACE FUNCTION dos_journal_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE total bigint; line_count bigint; entry text;
BEGIN
  entry := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(amount_paise), 0), COUNT(*) INTO total, line_count
    FROM journal_lines WHERE entry_id = entry;
  IF line_count = 0 THEN
    RAISE EXCEPTION 'journal entry % has no visible lines; the balance check cannot run (row level security is hiding them from the trigger, so this function must be SECURITY DEFINER and owned by a role that bypasses RLS)', entry
      USING ERRCODE = 'check_violation';
  END IF;
  IF total <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (sum = % paise)', entry, total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
-- 4. NOT ENFORCED AT THE DATABASE, deliberately: an entry with NO lines at all never fires the trigger
--    above (that is a row trigger on journal_lines), so a header with no money under it can commit. The
--    obvious closure is a second deferred CONSTRAINT TRIGGER on journal_entries asserting the entry has at
--    least one line. It was written, applied and then withdrawn, because it forbids something the codebase
--    legitimately does today: the demo seed inserts every journal_entries row in one statement and every
--    journal_lines row in the next, i.e. in two separate implicit transactions, so the headers commit alone
--    and the trigger rejects a seed of a FRESH database. Enforcing it means first making every writer post
--    an entry and its lines atomically (`insertMany(journalEntries)` + `insertMany(journalLines)` wrapped in
--    one `db.transaction` in seed-demo/sales.ts and seed-demo/delivery.ts). Until then the guarantee lives
--    in ReceivablesService.postEntry(), which builds the lines before it writes the header. A headerless
--    entry is also harmless to every balance: nothing sums journal_entries, only journal_lines.
