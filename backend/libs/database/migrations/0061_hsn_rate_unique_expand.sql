DROP INDEX "hsn_rates_code_from_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "hsn_rates_code_from_idx" ON "hsn_rates" USING btree ("hsn_code","effective_from");