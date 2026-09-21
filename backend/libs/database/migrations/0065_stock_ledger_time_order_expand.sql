DROP INDEX "stock_ledger_time_idx";--> statement-breakpoint
CREATE INDEX "stock_ledger_time_idx" ON "stock_ledger" USING btree ("tenant_id","occurred_at","id");