-- Hand-written companion to 0045_receipts_insert_roles_expand.sql (DOS-166): a salesperson never records a receipt,
-- and neither does the godown, whatever application path reaches the table.
--
-- WHY THE DATABASE. Never-list #2 ("a salesperson never collects money", docs/17 §D4) was an application rule
-- only, while never-list #1 (purchase cost) is a database guarantee. The offline upload proved an application
-- path can skip the permission matrix: a salesperson's phone wrote RCPT-0708 through `POST /sync/upload` while
-- `POST /receipts` answered 403 (QA/evidence/batch2/sync-role-probe). The upload now checks the matrix, and this
-- pair of migrations makes the rule true underneath it as well.
--
-- WHAT CHANGED, AND WHERE. Policies are expressible in Drizzle, so the change itself lives in the GENERATED file:
-- `staffWritePolicy('receipts_write', { insert: MONEY_COLLECTOR_ROLES })` in `schema/receivables.ts` narrows
-- `receipts_write_insert` from "any non-retailer member" to owner, manager, accountant, delivery and the worker
-- (`system`), and 0045 is drizzle's `ALTER POLICY` for it (same name, so no rename). Nothing else moves:
--   * `receipts_read` is untouched — every staff role still reads the register, and the receipt-number
--     self-heal reads the highest number under the actor's own read policy;
--   * `receipts_write_update` and `receipts_write_delete` stay staff-wide — deposit, bounce and reversal are the
--     money desk's (the application enforces MONEY_DESK), the worker writes `pdf_object_key` as `system`, and
--     nothing deletes a receipt.
-- Every INSERT path was checked against the new list: `receivables.receipts.create` (MONEY_COLLECTORS), the crew's
-- doorstep collection (MONEY_COLLECTORS), the `receipts` sync handler (now crew and desk only), and the seed, which
-- runs as `dos` (BYPASSRLS). `payments.initiate` creates no receipt.
--
-- This file adds no table, grant or trigger. It is the migrate-time assertion that the guarantee is armed and that
-- nothing around it came loose: `receipts` keeps FORCE ROW LEVEL SECURITY and carries no FOR ALL policy, and
-- `receipts_write_insert` exists, is an INSERT policy, and its WITH CHECK is an allow-list (it names `delivery`
-- and carries no `<>`) that names neither `salesperson` nor `warehouse`. The allow-list half matters: the old
-- predicate (`<> 'retailer'`) named neither role either, so without it a regression to the old policy would pass.

DO $$
DECLARE
  forced boolean;
  cmd text;
  check_expr text;
BEGIN
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'receipts';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0046: receipts must keep FORCE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.receipts'::regclass AND p.polcmd = '*') THEN
    RAISE EXCEPTION '0046: receipts must not carry a FOR ALL policy';
  END IF;

  SELECT p.cmd, p.with_check INTO cmd, check_expr
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'receipts' AND p.policyname = 'receipts_write_insert';
  IF cmd IS DISTINCT FROM 'INSERT' OR check_expr IS NULL THEN
    RAISE EXCEPTION '0046: receipts_write_insert must exist as an INSERT policy with a WITH CHECK; found %', coalesce(cmd, 'no such policy')
      USING ERRCODE = 'undefined_object';
  END IF;
  IF position('salesperson' IN check_expr) > 0 OR position('warehouse' IN check_expr) > 0 THEN
    RAISE EXCEPTION '0046: receipts_write_insert must not admit a salesperson or the warehouse (never-list 2); found %', check_expr
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF position('''delivery''' IN check_expr) = 0 OR position('<>' IN check_expr) > 0 THEN
    RAISE EXCEPTION '0046: receipts_write_insert must be an allow-list of the money collectors, not a deny-list; found %', check_expr
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;
