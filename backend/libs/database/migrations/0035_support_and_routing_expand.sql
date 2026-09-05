ALTER TABLE "support_grants" ADD COLUMN "requested_hours" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_grants" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "support_grants" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
ALTER POLICY "route_plans_read" ON "route_plans" TO app_rw USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
            ))
      ));--> statement-breakpoint
ALTER POLICY "route_plans_insert" ON "route_plans" TO app_rw WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
            ))
      ));