ALTER TABLE "grns" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "grns" ADD COLUMN "supplier_invoice_no" text;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;