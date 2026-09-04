-- Hand-written companion to 0002_domain_schema.sql (ADR 0002/0003/0004).
-- 1. FORCE ROW LEVEL SECURITY so even the table owner obeys policies.
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "achievements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ageing_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bargain_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "beat_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "beats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_discount_conditions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_statements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "computed_payouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "corrections_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_note_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_count_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_counts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_rep_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "directory_optins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engine_disagreements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "export_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extraction_checks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extractions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feature_flags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grn_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hsn_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_discrepancies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "load_sheets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "location_consents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lorry_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manufacturers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_state_transitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "otp_rate_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_summary" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pack_confirmations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pick_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "picklists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pjp" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pod_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_list_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_lists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_aliases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_external_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_packs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rep_auto_approve_bounds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rep_product_authorisations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retailer_behaviour" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retailer_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retailer_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retailer_price_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retailers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_order_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schemes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_match_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_balances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_lots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_aliases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_pack_configs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tally_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tally_sync_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_product_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_expenses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_points" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_settlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_stops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trips" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_positions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_windows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- 2. Ledgers are append-only: no UPDATE or DELETE ever, corrections are compensating rows (ADR 0003/0004).
CREATE OR REPLACE FUNCTION dos_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (ADR 0003/0004); write a compensating row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE ON "stock_ledger" FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON "journal_lines" FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint
CREATE TRIGGER order_state_transitions_append_only BEFORE UPDATE OR DELETE ON "order_state_transitions" FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint
-- 3. Every journal entry balances to the paisa, checked at COMMIT (deferred constraint trigger, ADR 0004).
CREATE OR REPLACE FUNCTION dos_journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint; entry text;
BEGIN
  entry := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(amount_paise), 0) INTO total FROM journal_lines WHERE entry_id = entry;
  IF total <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (sum = % paise)', entry, total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON "journal_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dos_journal_entry_balanced();--> statement-breakpoint
-- 4. An issued invoice is immutable except for the derived payment-state cache and document keys (§4.4).
CREATE OR REPLACE FUNCTION dos_invoice_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' THEN
    IF ROW(NEW.invoice_no, NEW.series_code, NEW.fy, NEW.invoice_date, NEW.order_id, NEW.retailer_id, NEW.buyer_gstin, NEW.buyer_name,
           NEW.place_of_supply_state, NEW.subtotal_paise, NEW.discount_paise, NEW.taxable_paise, NEW.cgst_paise, NEW.sgst_paise,
           NEW.igst_paise, NEW.cess_paise, NEW.round_off_paise, NEW.total_paise, NEW.issued_at)
       IS DISTINCT FROM
       ROW(OLD.invoice_no, OLD.series_code, OLD.fy, OLD.invoice_date, OLD.order_id, OLD.retailer_id, OLD.buyer_gstin, OLD.buyer_name,
           OLD.place_of_supply_state, OLD.subtotal_paise, OLD.discount_paise, OLD.taxable_paise, OLD.cgst_paise, OLD.sgst_paise,
           OLD.igst_paise, OLD.cess_paise, OLD.round_off_paise, OLD.total_paise, OLD.issued_at) THEN
      RAISE EXCEPTION 'invoice % is issued and immutable; raise a credit note', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER invoices_immutable BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION dos_invoice_immutable();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dos_invoice_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices i WHERE i.id = OLD.invoice_id AND i.state <> 'draft') THEN
    RAISE EXCEPTION 'invoice % is issued; its lines are immutable, raise a credit note', OLD.invoice_id USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER invoice_lines_immutable BEFORE UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION dos_invoice_lines_immutable();--> statement-breakpoint
-- 5. ATP view: the ONLY stock surface reps and retailers see (ADR 0003). RLS of the base tables still applies.
CREATE VIEW sellable_stock WITH (security_invoker = true) AS
  SELECT b.tenant_id, l.variant_id, b.location_id, l.id AS lot_id, l.batch_no, l.mrp_paise, l.expiry_date,
         b.on_hand, b.reserved, (b.on_hand - b.reserved) AS available
  FROM stock_balances b JOIN stock_lots l ON l.id = b.lot_id
  WHERE (b.on_hand - b.reserved) > 0;--> statement-breakpoint
GRANT SELECT ON sellable_stock TO app_rw;--> statement-breakpoint
-- 6. Let the migrating/owner role drop to app_rw inside withTenant() (SET LOCAL ROLE) so RLS applies even on owner connections.
GRANT app_rw TO CURRENT_USER;
