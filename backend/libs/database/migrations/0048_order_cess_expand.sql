ALTER TABLE "sales_order_lines" ADD COLUMN "cess_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "cess_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "cess_paise" bigint DEFAULT 0 NOT NULL;