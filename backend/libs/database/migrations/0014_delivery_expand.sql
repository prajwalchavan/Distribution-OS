ALTER TYPE "public"."approval_kind" ADD VALUE 'trip_settlement';--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "retailer_id" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "trip_points" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_stop_invoice_idx" ON "deliveries" USING btree ("tenant_id","stop_id","invoice_id");--> statement-breakpoint
CREATE INDEX "deliveries_retailer_idx" ON "deliveries" USING btree ("tenant_id","retailer_id","delivered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_points_dedupe_idx" ON "trip_points" USING btree ("tenant_id","trip_id","device_id","recorded_at");--> statement-breakpoint
DROP POLICY "collections_tenant" ON "collections" CASCADE;--> statement-breakpoint
DROP POLICY "deliveries_tenant" ON "deliveries" CASCADE;--> statement-breakpoint
DROP POLICY "delivery_lines_tenant" ON "delivery_lines" CASCADE;--> statement-breakpoint
DROP POLICY "pod_evidence_tenant" ON "pod_evidence" CASCADE;--> statement-breakpoint
DROP POLICY "trip_expenses_tenant" ON "trip_expenses" CASCADE;--> statement-breakpoint
DROP POLICY "trip_settlements_tenant" ON "trip_settlements" CASCADE;--> statement-breakpoint
DROP POLICY "trip_stops_write_delete" ON "trip_stops" CASCADE;--> statement-breakpoint
DROP POLICY "trips_tenant" ON "trips" CASCADE;--> statement-breakpoint
DROP POLICY "vehicle_positions_tenant" ON "vehicle_positions" CASCADE;--> statement-breakpoint
DROP POLICY "vehicles_tenant" ON "vehicles" CASCADE;--> statement-breakpoint
CREATE POLICY "collections_read" ON "collections" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = collections.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "collections_write_insert" ON "collections" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = collections.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "collections_write_update" ON "collections" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = collections.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = collections.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "collections_delete" ON "collections" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "deliveries_read" ON "deliveries" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = deliveries.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )) OR ((SELECT current_setting('app.actor_role', true)) = 'retailer' AND deliveries.retailer_id IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = (SELECT current_setting('app.actor_id', true))
          AND l.status = 'active'
      ))));--> statement-breakpoint
CREATE POLICY "deliveries_write_insert" ON "deliveries" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = deliveries.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "deliveries_write_update" ON "deliveries" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = deliveries.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = deliveries.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "deliveries_delete" ON "deliveries" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "delivery_lines_read" ON "delivery_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) IN ('delivery', 'retailer') AND EXISTS (SELECT 1 FROM deliveries d WHERE d.id = delivery_lines.delivery_id))));--> statement-breakpoint
CREATE POLICY "delivery_lines_write_insert" ON "delivery_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM deliveries d JOIN trips t ON t.id = d.trip_id
        WHERE d.id = delivery_lines.delivery_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "delivery_lines_write_update" ON "delivery_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM deliveries d JOIN trips t ON t.id = d.trip_id
        WHERE d.id = delivery_lines.delivery_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM deliveries d JOIN trips t ON t.id = d.trip_id
        WHERE d.id = delivery_lines.delivery_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "delivery_lines_delete" ON "delivery_lines" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "pod_evidence_read" ON "pod_evidence" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) IN ('delivery', 'retailer') AND EXISTS (SELECT 1 FROM deliveries d WHERE d.id = pod_evidence.delivery_id))));--> statement-breakpoint
CREATE POLICY "pod_evidence_write_insert" ON "pod_evidence" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM deliveries d JOIN trips t ON t.id = d.trip_id
        WHERE d.id = pod_evidence.delivery_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "pod_evidence_write_update" ON "pod_evidence" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM deliveries d JOIN trips t ON t.id = d.trip_id
        WHERE d.id = pod_evidence.delivery_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM deliveries d JOIN trips t ON t.id = d.trip_id
        WHERE d.id = pod_evidence.delivery_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "trip_expenses_read" ON "trip_expenses" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_expenses.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "trip_expenses_write_insert" ON "trip_expenses" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_expenses.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "trip_expenses_write_update" ON "trip_expenses" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_expenses.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_expenses.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "trip_expenses_delete" ON "trip_expenses" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "trip_settlements_read" ON "trip_settlements" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_settlements.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
CREATE POLICY "trip_settlements_write_insert" ON "trip_settlements" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')));--> statement-breakpoint
CREATE POLICY "trip_settlements_write_update" ON "trip_settlements" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')));--> statement-breakpoint
CREATE POLICY "trip_settlements_delete" ON "trip_settlements" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "trip_stops_delete" ON "trip_stops" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "trips_read" ON "trips" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND (driver_id = (SELECT current_setting('app.actor_id', true)) OR helper_id = (SELECT current_setting('app.actor_id', true))))));--> statement-breakpoint
CREATE POLICY "trips_insert" ON "trips" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND (driver_id = (SELECT current_setting('app.actor_id', true)) OR helper_id = (SELECT current_setting('app.actor_id', true))))));--> statement-breakpoint
CREATE POLICY "trips_update" ON "trips" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND (driver_id = (SELECT current_setting('app.actor_id', true)) OR helper_id = (SELECT current_setting('app.actor_id', true)))))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND (driver_id = (SELECT current_setting('app.actor_id', true)) OR helper_id = (SELECT current_setting('app.actor_id', true))))));--> statement-breakpoint
CREATE POLICY "trips_delete" ON "trips" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "vehicle_positions_read" ON "vehicle_positions" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.vehicle_id = vehicle_positions.vehicle_id
          AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
          AND t.state IN ('loading', 'active', 'closing')
      ))));--> statement-breakpoint
CREATE POLICY "vehicle_positions_write_insert" ON "vehicle_positions" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.vehicle_id = vehicle_positions.vehicle_id
          AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
          AND t.state IN ('loading', 'active', 'closing')
      ))));--> statement-breakpoint
CREATE POLICY "vehicle_positions_write_update" ON "vehicle_positions" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.vehicle_id = vehicle_positions.vehicle_id
          AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
          AND t.state IN ('loading', 'active', 'closing')
      )))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.vehicle_id = vehicle_positions.vehicle_id
          AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
          AND t.state IN ('loading', 'active', 'closing')
      ))));--> statement-breakpoint
CREATE POLICY "vehicle_positions_delete" ON "vehicle_positions" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "vehicles_read" ON "vehicles" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system', 'delivery'));--> statement-breakpoint
CREATE POLICY "vehicles_write_insert" ON "vehicles" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "vehicles_write_update" ON "vehicles" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "vehicles_write_delete" ON "vehicles" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
ALTER POLICY "trip_points_read" ON "trip_points" TO app_rw USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')));--> statement-breakpoint
ALTER POLICY "trip_points_insert" ON "trip_points" TO app_rw WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND user_id = (SELECT current_setting('app.actor_id', true)) AND ((SELECT current_setting('app.actor_role', true)) = 'system' OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_points.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
ALTER POLICY "trip_stops_read" ON "trip_stops" TO app_rw USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) NOT IN ('delivery', 'retailer') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_stops.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )) OR ((SELECT current_setting('app.actor_role', true)) = 'retailer' AND trip_stops.retailer_id IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = (SELECT current_setting('app.actor_id', true))
          AND l.status = 'active'
      ))));--> statement-breakpoint
ALTER POLICY "trip_stops_write_insert" ON "trip_stops" TO app_rw WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_stops.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));--> statement-breakpoint
ALTER POLICY "trip_stops_write_update" ON "trip_stops" TO app_rw USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_stops.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      )))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system') OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
        SELECT 1 FROM trips t
        WHERE t.id = trip_stops.trip_id AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
      ))));