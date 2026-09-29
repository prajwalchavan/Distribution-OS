-- Generated (drizzle-kit): expand-only. Prices lane, blind check 1.
-- (1) M1, QA DOS-330 / ruling 1 of docs/22 §8 2026-09-28: a scheme is counted once per ORDER line. A day of
--     daily_owner_stats rolled before that rule may carry a scheme once per batch line of a bill split over batches,
--     and nothing rolls a past day again. The new column has no default on purpose: every existing row is NULL = "not
--     yet recounted"; the worker's tenant rollup recounts such a day's two scheme-spend figures from its own bills
--     once and sets it (the DOS-254 pattern of 0069). Nothing is backfilled and nothing else of a day changes.
-- (2) Minor, QA DOS-336 / ruling 5: only the rep, the shopkeeper, the manager and the owner ask for a rate. The
--     insert policy of bargain_requests admitted every staff role; it now admits the salesperson where it admitted
--     "any staff but the shop and the desk", so the accountant, the godown and the crew are refused by the table as
--     they already are by the permission matrix. It guards NEW rows only: requests already filed stay as they are.
-- Grants are table-level and both tables already carry FORCE RLS: no hand-written sibling is needed.
ALTER TABLE "daily_owner_stats" ADD COLUMN "scheme_spend_counted_once" boolean;--> statement-breakpoint
ALTER POLICY "bargain_requests_insert" ON "bargain_requests" TO app_rw WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson'
            AND status IN ('requested', 'auto_approved')
            AND requested_by = (SELECT current_setting('app.actor_id', true)))
        OR ((SELECT current_setting('app.actor_role', true)) = 'retailer'
            AND status = 'requested'
            AND requested_by = (SELECT current_setting('app.actor_id', true))
            AND retailer_id IN (
              SELECT l.retailer_id FROM retailer_links l
              WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
                AND l.user_id = (SELECT current_setting('app.actor_id', true))
                AND l.status = 'active'
            ))
      ));
