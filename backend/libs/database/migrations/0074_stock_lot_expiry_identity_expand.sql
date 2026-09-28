ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_identity_key" UNIQUE NULLS NOT DISTINCT("tenant_id","variant_id","batch_no","mrp_paise","expiry_date");--> statement-breakpoint
DROP INDEX "stock_lots_identity_idx";--> statement-breakpoint
ALTER TABLE "grn_lines" ADD COLUMN "expired_qty_pcs" integer DEFAULT 0 NOT NULL;
