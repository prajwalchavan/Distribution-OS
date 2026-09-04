CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."net_unit" AS ENUM('g', 'kg', 'ml', 'l', 'pcs');--> statement-breakpoint
CREATE TYPE "public"."pack_level" AS ENUM('piece', 'inner', 'case');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'proposed', 'merged_into', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('open', 'accepted', 'merged', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."margin_basis" AS ENUM('ptd', 'mrp', 'net');--> statement-breakpoint
CREATE TYPE "public"."credit_mode" AS ENUM('indicate', 'strict', 'stop');--> statement-breakpoint
CREATE TYPE "public"."gst_reg_type" AS ENUM('unregistered', 'regular', 'composition');--> statement-breakpoint
CREATE TYPE "public"."payment_terms" AS ENUM('PRE', 'ON', 'POST_FULFILLMENT');--> statement-breakpoint
CREATE TYPE "public"."retailer_link_source" AS ENUM('rep_onboarding', 'directory_optin', 'import');--> statement-breakpoint
CREATE TYPE "public"."retailer_link_status" AS ENUM('pending', 'active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."retailer_tier" AS ENUM('A', 'B', 'C', 'D');--> statement-breakpoint
CREATE TYPE "public"."visit_outcome" AS ENUM('ordered', 'no_order', 'closed', 'not_found', 'payment_only');--> statement-breakpoint
CREATE TYPE "public"."bargain_status" AS ENUM('requested', 'auto_approved', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."funding_source" AS ENUM('company', 'distributor');--> statement-breakpoint
CREATE TYPE "public"."pricing_date_mode" AS ENUM('order', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."scheme_reward_kind" AS ENUM('free_qty', 'line_pct', 'order_pct', 'cash_discount_pct', 'net_scheme_amount');--> statement-breakpoint
CREATE TYPE "public"."scheme_trigger_kind" AS ENUM('qty', 'value', 'mix');--> statement-breakpoint
CREATE TYPE "public"."cycle_count_status" AS ENUM('open', 'counted', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('warehouse', 'vehicle', 'damaged', 'in_transit', 'customer');--> statement-breakpoint
CREATE TYPE "public"."reservation_state" AS ENUM('pending', 'posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."stock_reason" AS ENUM('opening', 'grn', 'sale', 'sale_return_saleable', 'sale_return_damaged', 'damage', 'expiry_writeoff', 'transfer_out', 'transfer_in', 'van_load', 'van_unload', 'adjustment', 'cycle_count');--> statement-breakpoint
CREATE TYPE "public"."approval_kind" AS ENUM('credit_limit', 'bargain', 'below_floor', 'return', 'scheme_override', 'manual_price');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('salesperson', 'retailer_app', 'van_sale', 'phone', 'whatsapp', 'brand_dms_import', 'import');--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('draft', 'submitted', 'confirmed', 'picking', 'packed', 'dispatched', 'delivered', 'partially_delivered', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."discrepancy_kind" AS ENUM('short', 'excess', 'damaged', 'wrong_item', 'price_mismatch', 'expiry_near');--> statement-breakpoint
CREATE TYPE "public"."discrepancy_status" AS ENUM('open', 'claimed', 'credited', 'accepted', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."grn_status" AS ENUM('counting', 'reconciled', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'sent', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_source" AS ENUM('docint', 'irn_pull', 'brand_dms_import', 'manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_status" AS ENUM('extracted', 'in_review', 'approved', 'received', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."picklist_status" AS ENUM('open', 'picking', 'picked', 'packed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."credit_note_reason" AS ENUM('short_delivery', 'return_saleable', 'return_damaged', 'rate_difference', 'scheme_settlement', 'cancellation', 'other');--> statement-breakpoint
CREATE TYPE "public"."credit_note_state" AS ENUM('draft', 'issued', 'applied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_source" AS ENUM('pack', 'van_sale', 'brand_dms_import', 'import');--> statement-breakpoint
CREATE TYPE "public"."invoice_state" AS ENUM('draft', 'issued', 'partially_paid', 'paid', 'written_off', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."supply_type" AS ENUM('B2B', 'B2C');--> statement-breakpoint
CREATE TYPE "public"."account_kind" AS ENUM('asset', 'liability', 'income', 'expense', 'equity');--> statement-breakpoint
CREATE TYPE "public"."cash_discount_condition_status" AS ENUM('open', 'realised', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."receipt_mode" AS ENUM('cash', 'upi', 'bank_transfer', 'cheque', 'credit_note', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('collected', 'deposited', 'bounced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."delivery_outcome" AS ENUM('delivered', 'partial', 'returned', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pod_kind" AS ENUM('photo', 'signature', 'otp', 'geo');--> statement-breakpoint
CREATE TYPE "public"."stop_failure_reason" AS ENUM('shop_closed', 'refused', 'no_cash', 'wrong_address', 'damaged_goods', 'other');--> statement-breakpoint
CREATE TYPE "public"."stop_state" AS ENUM('pending', 'started', 'arrived', 'delivered', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."trip_state" AS ENUM('planned', 'loading', 'active', 'closing', 'settled', 'settled_with_variance', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('supplier_invoice', 'lorry_receipt', 'brand_dms_invoice', 'claim_sheet', 'pod', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'verifying', 'extracting', 'extracted', 'needs_review', 'reviewed', 'committed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."extraction_engine" AS ENUM('irn_pull', 'qr', 'llm_vision', 'llm_vision_secondary', 'template', 'manual');--> statement-breakpoint
CREATE TYPE "public"."review_session_status" AS ENUM('open', 'submitted', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."claim_kind" AS ENUM('scheme', 'damage', 'expiry', 'shortage', 'rate_difference', 'other');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('draft', 'submitted', 'acknowledged', 'settled', 'partially_settled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('whatsapp', 'sms', 'push', 'email', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('staged', 'matched', 'needs_review', 'committed', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."target_metric" AS ENUM('value', 'pieces', 'lines', 'outlets', 'collections');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"device_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"tenant_id" text NOT NULL,
	"flag" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_tenant_id_flag_pk" PRIMARY KEY("tenant_id","flag")
);
--> statement-breakpoint
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" "device_platform" NOT NULL,
	"model" text,
	"os_version" text,
	"app_version" text,
	"sync_client_id" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "location_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"locale" text NOT NULL,
	"granted" boolean NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"evidence" jsonb
);
--> statement-breakpoint
ALTER TABLE "location_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "otp_rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	CONSTRAINT "otp_rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "otp_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"manufacturer_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hsn_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"hsn_code" text NOT NULL,
	"description" text,
	"gst_bps" integer NOT NULL,
	"cess_bps" integer DEFAULT 0 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hsn_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "manufacturers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" text,
	"fssai_license" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manufacturers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"source" text DEFAULT 'docint' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_external_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"system" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_external_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"level" "pack_level" NOT NULL,
	"qty_in_parent" integer NOT NULL,
	"barcode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_packs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"proposed_by" text NOT NULL,
	"kind" text NOT NULL,
	"product_id" text,
	"variant_id" text,
	"payload" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"net_qty" integer NOT NULL,
	"net_unit" "net_unit" NOT NULL,
	"promo_extra" integer,
	"default_case_size" integer NOT NULL,
	"hsn_code" text NOT NULL,
	"ean" text,
	"mrp_paise" bigint,
	"shelf_life_days" integer,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"merged_into" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"manufacturer_id" text NOT NULL,
	"brand_id" text,
	"name" text NOT NULL,
	"name_hi" text,
	"category" text,
	"ondc_category" text,
	"fssai_relevant" boolean DEFAULT true NOT NULL,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"merged_into" text,
	"proposed_by_tenant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rep_product_authorisations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"employed_by" text DEFAULT 'distributor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rep_product_authorisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "return_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"saleable_return_days" integer DEFAULT 0 NOT NULL,
	"damage_claimable" boolean DEFAULT false NOT NULL,
	"expiry_claimable" boolean DEFAULT false NOT NULL,
	"claim_window_days" integer,
	"claim_sheet_format" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "return_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_pack_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"pcs_per_case" integer NOT NULL,
	"supplier_code" text,
	"supplier_description" text,
	"margin_basis" "margin_basis" DEFAULT 'ptd' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_pack_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"state_code" text,
	"manufacturer_id" text,
	"phone" text,
	"email" text,
	"address" jsonb,
	"e_invoicing" boolean DEFAULT false NOT NULL,
	"payment_terms_days" integer,
	"tally_ledger_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_product_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"lot_id" text,
	"supplier_id" text,
	"purchase_rate_paise" bigint NOT NULL,
	"landed_cost_paise" bigint NOT NULL,
	"ptd_paise" bigint,
	"scheme_margin_bps" integer,
	"updated_from_grn_id" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_product_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"listed" boolean DEFAULT true NOT NULL,
	"local_alias" text,
	"case_size_override" integer,
	"min_order_qty" integer DEFAULT 1 NOT NULL,
	"order_increment" integer DEFAULT 1 NOT NULL,
	"max_per_order" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beat_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"beat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beat_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beats" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"area" text,
	"visit_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "directory_optins" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"tenant_id" text,
	"lat" double precision,
	"lng" double precision,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_optins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pjp" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"beat_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pjp" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retailer_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"user_id" text,
	"shop_name" text NOT NULL,
	"gstin" text,
	"fssai_license" text,
	"consent_version" text,
	"consented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retailer_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retailer_links" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"user_id" text,
	"linked_by" "retailer_link_source" NOT NULL,
	"status" "retailer_link_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retailer_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retailers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"identity_id" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"owner_name" text,
	"phone" text NOT NULL,
	"alt_phone" text,
	"address" jsonb,
	"lat" double precision,
	"lng" double precision,
	"beat_id" text,
	"tier" "retailer_tier" DEFAULT 'C' NOT NULL,
	"gst_reg_type" "gst_reg_type" DEFAULT 'unregistered' NOT NULL,
	"gstin" text,
	"state_code" text NOT NULL,
	"credit_limit_paise" bigint DEFAULT 0 NOT NULL,
	"credit_limit_bills" integer DEFAULT 0 NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"credit_mode" "credit_mode" DEFAULT 'indicate' NOT NULL,
	"payment_terms" "payment_terms" DEFAULT 'POST_FULFILLMENT' NOT NULL,
	"cash_discount_bps" integer DEFAULT 0 NOT NULL,
	"cash_discount_days" integer DEFAULT 0 NOT NULL,
	"tally_ledger_name" text,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarded_by" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retailers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visits" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"user_id" text NOT NULL,
	"beat_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" "visit_outcome",
	"reason" text,
	"lat" double precision,
	"lng" double precision,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bargain_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"order_id" text,
	"requested_by" text NOT NULL,
	"list_rate_paise" bigint NOT NULL,
	"asked_rate_paise" bigint NOT NULL,
	"approved_rate_paise" bigint,
	"status" "bargain_status" DEFAULT 'requested' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bargain_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"price_list_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"rate_paise" bigint NOT NULL,
	"inclusive_of_gst" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_list_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"tier" "retailer_tier",
	"is_default" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rep_auto_approve_bounds" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" text,
	"max_discount_bps" integer DEFAULT 0 NOT NULL,
	"max_order_discount_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rep_auto_approve_bounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retailer_price_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"rate_paise" bigint NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"approved_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retailer_price_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "schemes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"brand_id" text,
	"scope" jsonb NOT NULL,
	"trigger_kind" "scheme_trigger_kind" NOT NULL,
	"trigger_min" integer NOT NULL,
	"trigger_unit" text NOT NULL,
	"slabs" jsonb,
	"reward_kind" "scheme_reward_kind" NOT NULL,
	"reward_value" integer NOT NULL,
	"free_variant_id" text,
	"applicability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"stackable" boolean DEFAULT true NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"funding_source" "funding_source" DEFAULT 'company' NOT NULL,
	"claimable" boolean DEFAULT false NOT NULL,
	"claim_window_days" integer,
	"gst_on_free_goods" boolean DEFAULT false NOT NULL,
	"pricing_date_mode" "pricing_date_mode" DEFAULT 'order' NOT NULL,
	"source_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schemes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_count_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"cycle_count_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"expected_qty" integer NOT NULL,
	"counted_qty" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_count_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cycle_counts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"status" "cycle_count_status" DEFAULT 'open' NOT NULL,
	"counted_by" text,
	"counted_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "location_kind" NOT NULL,
	"name" text NOT NULL,
	"vehicle_id" text,
	"negative_allowed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"lot_id" text,
	"location_id" text NOT NULL,
	"qty" integer NOT NULL,
	"state" "reservation_state" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"tenant_id" text NOT NULL,
	"lot_id" text NOT NULL,
	"location_id" text NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"negative_allowed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_tenant_id_lot_id_location_id_pk" PRIMARY KEY("tenant_id","lot_id","location_id"),
	CONSTRAINT "stock_balances_on_hand_nonneg" CHECK (on_hand >= 0 OR negative_allowed),
	CONSTRAINT "stock_balances_reserved_nonneg" CHECK (reserved >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lot_id" text NOT NULL,
	"location_id" text NOT NULL,
	"qty_delta" integer NOT NULL,
	"reason" "stock_reason" NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"actor_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_ledger_qty_nonzero" CHECK (qty_delta <> 0)
);
--> statement-breakpoint
ALTER TABLE "stock_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"batch_no" text DEFAULT '' NOT NULL,
	"mrp_paise" bigint NOT NULL,
	"mfg_date" date,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"order_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_state_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"from_state" "order_state",
	"to_state" "order_state" NOT NULL,
	"event" text NOT NULL,
	"actor_id" text NOT NULL,
	"device_id" text,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_state_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" text NOT NULL,
	"ordered_qty" integer NOT NULL,
	"ordered_unit" text DEFAULT 'pcs' NOT NULL,
	"qty_pcs" integer NOT NULL,
	"free_qty_pcs" integer DEFAULT 0 NOT NULL,
	"picked_qty_pcs" integer DEFAULT 0 NOT NULL,
	"delivered_qty_pcs" integer DEFAULT 0 NOT NULL,
	"list_rate_paise" bigint NOT NULL,
	"rate_paise" bigint NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"gst_bps" integer NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint DEFAULT 0 NOT NULL,
	"applied_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_no" text,
	"retailer_id" text NOT NULL,
	"state" "order_state" DEFAULT 'draft' NOT NULL,
	"source" "order_source" NOT NULL,
	"created_by" text NOT NULL,
	"salesperson_id" text,
	"pricing_date_mode" "pricing_date_mode" DEFAULT 'order' NOT NULL,
	"payment_terms" "payment_terms" NOT NULL,
	"fulfil_from_location_id" text,
	"external_ref" text,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"approval_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_delivery_date" text,
	"note" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grn_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"grn_id" text NOT NULL,
	"supplier_invoice_line_id" text,
	"variant_id" text NOT NULL,
	"lot_id" text,
	"expected_qty_pcs" integer NOT NULL,
	"counted_qty_pcs" integer,
	"damaged_qty_pcs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grn_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"grn_no" text,
	"supplier_invoice_id" text NOT NULL,
	"location_id" text NOT NULL,
	"status" "grn_status" DEFAULT 'counting' NOT NULL,
	"counted_by" text,
	"counted_at" timestamp with time zone,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbound_discrepancies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"grn_id" text NOT NULL,
	"grn_line_id" text,
	"kind" "discrepancy_kind" NOT NULL,
	"qty_pcs" integer DEFAULT 0 NOT NULL,
	"amount_paise" bigint,
	"status" "discrepancy_status" DEFAULT 'open' NOT NULL,
	"evidence_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_discrepancies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lorry_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supplier_invoice_id" text,
	"lr_no" text NOT NULL,
	"lr_date" date,
	"transporter_name" text,
	"transporter_gstin" text,
	"vehicle_no" text,
	"packages" integer,
	"freight_paise" bigint,
	"document_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lorry_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"po_no" text,
	"supplier_id" text NOT NULL,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"expected_on" date,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_paise" bigint,
	"created_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supplier_invoice_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"supplier_code" text,
	"variant_id" text,
	"hsn_code" text,
	"batch_no" text,
	"mfg_date" date,
	"expiry_date" date,
	"mrp_paise" bigint,
	"printed_qty" integer NOT NULL,
	"printed_unit" text DEFAULT 'pcs' NOT NULL,
	"qty_pcs" integer NOT NULL,
	"free_qty_pcs" integer DEFAULT 0 NOT NULL,
	"rate_paise" bigint NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"gst_bps" integer DEFAULT 0 NOT NULL,
	"cess_bps" integer DEFAULT 0 NOT NULL,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"purchase_order_id" text,
	"document_id" text,
	"source" "supplier_invoice_source" NOT NULL,
	"status" "supplier_invoice_status" DEFAULT 'extracted' NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date NOT NULL,
	"irn" text,
	"ack_no" text,
	"ack_date" timestamp with time zone,
	"e_invoice_verified" jsonb,
	"eway_bill_no" text,
	"supplier_gstin" text,
	"place_of_supply_state" text,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"cess_paise" bigint DEFAULT 0 NOT NULL,
	"freight_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"due_date" date,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "load_sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"from_location_id" text NOT NULL,
	"to_location_id" text NOT NULL,
	"order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"van_stock" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "load_sheets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pack_confirmations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"packages" integer DEFAULT 1 NOT NULL,
	"weight_grams" integer,
	"invoice_id" text,
	"packed_by" text,
	"packed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pack_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pick_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"picklist_id" text NOT NULL,
	"order_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"lot_id" text,
	"requested_qty_pcs" integer NOT NULL,
	"picked_qty_pcs" integer DEFAULT 0 NOT NULL,
	"short_reason" text,
	"picked_by" text,
	"picked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pick_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "picklists" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"picklist_no" text,
	"location_id" text NOT NULL,
	"status" "picklist_status" DEFAULT 'open' NOT NULL,
	"order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_to" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "picklists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"credit_note_id" text NOT NULL,
	"invoice_line_id" text NOT NULL,
	"qty_pcs" integer NOT NULL,
	"saleable" boolean DEFAULT true NOT NULL,
	"rate_paise" bigint NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"gst_bps" integer NOT NULL,
	"tax_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_note_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"credit_note_no" text,
	"series_code" text DEFAULT 'CN' NOT NULL,
	"fy" text NOT NULL,
	"note_date" date NOT NULL,
	"invoice_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"reason" "credit_note_reason" NOT NULL,
	"state" "credit_note_state" DEFAULT 'draft' NOT NULL,
	"delivery_id" text,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"cess_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"irn" text,
	"issued_by" text,
	"issued_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"order_line_id" text,
	"variant_id" text NOT NULL,
	"lot_id" text,
	"description" text NOT NULL,
	"hsn_code" text NOT NULL,
	"batch_no" text,
	"expiry_date" date,
	"mrp_paise" bigint,
	"qty_pcs" integer NOT NULL,
	"free_qty_pcs" integer DEFAULT 0 NOT NULL,
	"case_size" integer,
	"rate_paise" bigint NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"gst_bps" integer NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"cess_bps" integer DEFAULT 0 NOT NULL,
	"cess_paise" bigint DEFAULT 0 NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"applied_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_no" text,
	"series_code" text DEFAULT 'INV' NOT NULL,
	"fy" text NOT NULL,
	"invoice_date" date NOT NULL,
	"order_id" text,
	"retailer_id" text NOT NULL,
	"source" "invoice_source" DEFAULT 'pack' NOT NULL,
	"external_invoice_no" text,
	"state" "invoice_state" DEFAULT 'draft' NOT NULL,
	"supply_type" "supply_type" DEFAULT 'B2C' NOT NULL,
	"seller_gstin" text,
	"buyer_gstin" text,
	"buyer_name" text NOT NULL,
	"buyer_address" jsonb,
	"place_of_supply_state" text NOT NULL,
	"buyer_fssai" text,
	"seller_fssai" text,
	"is_inter_state" boolean DEFAULT false NOT NULL,
	"subtotal_paise" bigint DEFAULT 0 NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"cess_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"cash_discount_bps" integer DEFAULT 0 NOT NULL,
	"cash_discount_until" date,
	"due_date" date,
	"irn" text,
	"ack_no" text,
	"ack_date" timestamp with time zone,
	"signed_qr" text,
	"eway_bill_no" text,
	"eway_bill_valid_until" timestamp with time zone,
	"transport_mode" text,
	"vehicle_no" text,
	"upi_qr_payload" text,
	"pdf_object_key" text,
	"issued_by" text,
	"issued_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"party_type" text,
	"party_id" text,
	"tally_ledger_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ageing_snapshots" (
	"tenant_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"as_of" date NOT NULL,
	"outstanding_paise" bigint NOT NULL,
	"bucket_0_7_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_8_15_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_16_30_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_31_60_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_60_plus_paise" bigint DEFAULT 0 NOT NULL,
	"open_bills" integer DEFAULT 0 NOT NULL,
	"oldest_due_date" date,
	"breakdown" jsonb,
	CONSTRAINT "ageing_snapshots_tenant_id_retailer_id_as_of_pk" PRIMARY KEY("tenant_id","retailer_id","as_of")
);
--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"receipt_id" text,
	"credit_note_id" text,
	"amount_paise" bigint NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"allocated_by" text,
	CONSTRAINT "allocations_one_source" CHECK ((receipt_id IS NOT NULL) <> (credit_note_id IS NOT NULL)),
	CONSTRAINT "allocations_amount_positive" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_discount_conditions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"discount_bps" integer NOT NULL,
	"pay_by" date NOT NULL,
	"status" "cash_discount_condition_status" DEFAULT 'open' NOT NULL,
	"realised_receipt_id" text,
	"realised_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_discount_conditions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"narration" text,
	"idempotency_key" text NOT NULL,
	"posted_by" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_entry_id" text
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"party_type" text,
	"party_id" text,
	"memo" text,
	CONSTRAINT "journal_lines_nonzero" CHECK (amount_paise <> 0)
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"receipt_no" text,
	"retailer_id" text NOT NULL,
	"mode" "receipt_mode" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"received_by" text NOT NULL,
	"trip_id" text,
	"reference" text,
	"upi_vpa" text,
	"cheque_date" date,
	"bank_name" text,
	"status" "receipt_status" DEFAULT 'collected' NOT NULL,
	"cash_discount_paise" bigint DEFAULT 0 NOT NULL,
	"proof_object_key" text,
	"note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_amount_positive" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"stop_id" text,
	"retailer_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"mode" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"collected_by" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"stop_id" text NOT NULL,
	"order_id" text,
	"invoice_id" text NOT NULL,
	"outcome" "delivery_outcome",
	"delivered_by" text,
	"delivered_at" timestamp with time zone,
	"receiver_name" text,
	"note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"invoice_line_id" text NOT NULL,
	"delivered_qty_pcs" integer NOT NULL,
	"returned_qty_pcs" integer DEFAULT 0 NOT NULL,
	"returned_saleable" boolean DEFAULT true NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pod_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"kind" "pod_kind" NOT NULL,
	"object_key" text,
	"payload" jsonb,
	"lat" double precision,
	"lng" double precision,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pod_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"proof_object_key" text,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_points" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" real,
	"speed_mps" real,
	"heading" real,
	"battery" integer
);
--> statement-breakpoint
ALTER TABLE "trip_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"expected_cash_paise" bigint NOT NULL,
	"handed_over_cash_paise" bigint NOT NULL,
	"cash_variance_paise" bigint NOT NULL,
	"upi_collected_paise" bigint DEFAULT 0 NOT NULL,
	"expenses_paise" bigint DEFAULT 0 NOT NULL,
	"stock_variance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_variance" boolean DEFAULT false NOT NULL,
	"settled_by" text,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "trip_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"retailer_id" text NOT NULL,
	"state" "stop_state" DEFAULT 'pending' NOT NULL,
	"failure_reason" "stop_failure_reason",
	"failure_note" text,
	"planned_collection_paise" bigint DEFAULT 0 NOT NULL,
	"eta_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"arrived_lat" double precision,
	"arrived_lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_no" text,
	"trip_date" date NOT NULL,
	"vehicle_id" text NOT NULL,
	"driver_id" text,
	"helper_id" text,
	"state" "trip_state" DEFAULT 'planned' NOT NULL,
	"van_sales_enabled" boolean DEFAULT false NOT NULL,
	"planned_stops" integer DEFAULT 0 NOT NULL,
	"start_odometer_km" integer,
	"end_odometer_km" integer,
	"opening_cash_paise" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicle_positions" (
	"tenant_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"trip_id" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"reg_no" text NOT NULL,
	"name" text,
	"kind" text DEFAULT 'tempo' NOT NULL,
	"capacity_cases" integer,
	"location_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "corrections_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"review_session_id" text NOT NULL,
	"path" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corrections_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"page_no" integer NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"uploaded_by" text NOT NULL,
	"supplier_id" text,
	"qr_payload" jsonb,
	"irn" text,
	"irn_verified" boolean DEFAULT false NOT NULL,
	"content_hash" text,
	"committed_entity_type" text,
	"committed_entity_id" text,
	"committed_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "engine_disagreements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"path" text NOT NULL,
	"values" jsonb NOT NULL,
	"resolved_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engine_disagreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "extraction_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"extraction_id" text NOT NULL,
	"check" text NOT NULL,
	"passed" boolean NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extraction_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"engine" "extraction_engine" NOT NULL,
	"model" text,
	"prompt_version" text,
	"result" jsonb NOT NULL,
	"confidence" real,
	"cost_paise" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extractions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"base_extraction_id" text,
	"status" "review_session_status" DEFAULT 'open' NOT NULL,
	"reviewed" jsonb,
	"locked_until" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sku_match_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"extraction_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" text NOT NULL,
	"score" real NOT NULL,
	"reason" text NOT NULL,
	"chosen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sku_match_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"gstin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"document_id" text,
	"object_key" text,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "claim_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"scheme_id" text,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"variant_id" text,
	"qty_pcs" integer DEFAULT 0 NOT NULL,
	"amount_paise" bigint NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "claim_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"format" text NOT NULL,
	"object_key" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"claim_no" text,
	"supplier_id" text NOT NULL,
	"brand_id" text,
	"kind" "claim_kind" NOT NULL,
	"status" "claim_status" DEFAULT 'draft' NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"claimed_paise" bigint DEFAULT 0 NOT NULL,
	"settled_paise" bigint DEFAULT 0 NOT NULL,
	"external_ref" text,
	"submitted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"from" text NOT NULL,
	"retailer_id" text,
	"body" text,
	"media_object_key" text,
	"provider_message_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"template_key" text,
	"to" text NOT NULL,
	"recipient_user_id" text,
	"recipient_retailer_id" text,
	"locale" text DEFAULT 'hi-IN' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"cost_paise" integer,
	"error" text,
	"ref_type" text,
	"ref_id" text,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"key" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"locale" text NOT NULL,
	"provider_template_name" text,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_windows" (
	"tenant_id" text NOT NULL,
	"phone" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_windows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_rep_stats" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"productive_visits" integer DEFAULT 0 NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"order_value_paise" bigint DEFAULT 0 NOT NULL,
	"lines_sold" integer DEFAULT 0 NOT NULL,
	"collected_paise" bigint DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_rep_stats_tenant_id_user_id_day_pk" PRIMARY KEY("tenant_id","user_id","day")
);
--> statement-breakpoint
ALTER TABLE "daily_rep_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_tenant_stats" (
	"tenant_id" text NOT NULL,
	"day" date NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"invoiced_paise" bigint DEFAULT 0 NOT NULL,
	"collected_paise" bigint DEFAULT 0 NOT NULL,
	"outstanding_paise" bigint DEFAULT 0 NOT NULL,
	"delivered_stops" integer DEFAULT 0 NOT NULL,
	"failed_stops" integer DEFAULT 0 NOT NULL,
	"active_retailers" integer DEFAULT 0 NOT NULL,
	"by_brand" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_tenant_stats_tenant_id_day_pk" PRIMARY KEY("tenant_id","day")
);
--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_summary" (
	"tenant_id" text NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"today_invoiced_paise" bigint DEFAULT 0 NOT NULL,
	"today_collected_paise" bigint DEFAULT 0 NOT NULL,
	"total_outstanding_paise" bigint DEFAULT 0 NOT NULL,
	"overdue_paise" bigint DEFAULT 0 NOT NULL,
	"mtd_sales_paise" bigint DEFAULT 0 NOT NULL,
	"mtd_gross_margin_paise" bigint DEFAULT 0 NOT NULL,
	"stock_value_paise" bigint DEFAULT 0 NOT NULL,
	"near_expiry_value_paise" bigint DEFAULT 0 NOT NULL,
	"pending_approvals" integer DEFAULT 0 NOT NULL,
	"active_trips" integer DEFAULT 0 NOT NULL,
	"detail" jsonb,
	CONSTRAINT "owner_summary_tenant_id_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "owner_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retailer_behaviour" (
	"tenant_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"last_order_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"last_payment_at" timestamp with time zone,
	"orders_last_30" integer DEFAULT 0 NOT NULL,
	"value_last_30_paise" bigint DEFAULT 0 NOT NULL,
	"avg_days_to_pay" integer,
	"usual_basket" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lapsed_risk" integer DEFAULT 0 NOT NULL,
	"units_last_30" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retailer_behaviour_tenant_id_retailer_id_pk" PRIMARY KEY("tenant_id","retailer_id")
);
--> statement-breakpoint
ALTER TABLE "retailer_behaviour" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"requested_by" text NOT NULL,
	"object_key" text,
	"row_count" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"source_object_key" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"requested_by" text NOT NULL,
	"total_rows" integer,
	"ok_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"committed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"import_job_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"status" "import_row_status" DEFAULT 'staged' NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tally_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"tally_name" text NOT NULL,
	"tally_parent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tally_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tally_sync_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" text NOT NULL,
	"tally_guid" text,
	"tally_voucher_id" text,
	"export_job_id" text,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tally_sync_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"target_id" text NOT NULL,
	"achieved_value" bigint DEFAULT 0 NOT NULL,
	"achieved_pieces" integer DEFAULT 0 NOT NULL,
	"achieved_pct_bps" bigint DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "computed_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"breakdown" jsonb NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "computed_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "targets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" text,
	"metric" "target_metric" NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"target_value" bigint NOT NULL,
	"payout_rule" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_consents" ADD CONSTRAINT "location_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_external_codes" ADD CONSTRAINT "product_external_codes_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_packs" ADD CONSTRAINT "product_packs_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_proposals" ADD CONSTRAINT "product_proposals_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_proposed_by_tenant_id_tenants_id_fk" FOREIGN KEY ("proposed_by_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_product_authorisations" ADD CONSTRAINT "rep_product_authorisations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_product_authorisations" ADD CONSTRAINT "rep_product_authorisations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_product_authorisations" ADD CONSTRAINT "rep_product_authorisations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_policies" ADD CONSTRAINT "return_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_policies" ADD CONSTRAINT "return_policies_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_pack_configs" ADD CONSTRAINT "supplier_pack_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_pack_configs" ADD CONSTRAINT "supplier_pack_configs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_pack_configs" ADD CONSTRAINT "supplier_pack_configs_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_product_costs" ADD CONSTRAINT "tenant_product_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_product_costs" ADD CONSTRAINT "tenant_product_costs_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_product_costs" ADD CONSTRAINT "tenant_product_costs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_products" ADD CONSTRAINT "tenant_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_products" ADD CONSTRAINT "tenant_products_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_assignments" ADD CONSTRAINT "beat_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_assignments" ADD CONSTRAINT "beat_assignments_beat_id_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."beats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_assignments" ADD CONSTRAINT "beat_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beats" ADD CONSTRAINT "beats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_optins" ADD CONSTRAINT "directory_optins_identity_id_retailer_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."retailer_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp" ADD CONSTRAINT "pjp_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp" ADD CONSTRAINT "pjp_beat_id_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."beats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pjp" ADD CONSTRAINT "pjp_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_identities" ADD CONSTRAINT "retailer_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_links" ADD CONSTRAINT "retailer_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_links" ADD CONSTRAINT "retailer_links_identity_id_retailer_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."retailer_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_links" ADD CONSTRAINT "retailer_links_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_links" ADD CONSTRAINT "retailer_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailers" ADD CONSTRAINT "retailers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailers" ADD CONSTRAINT "retailers_identity_id_retailer_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."retailer_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailers" ADD CONSTRAINT "retailers_beat_id_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."beats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_beat_id_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."beats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bargain_requests" ADD CONSTRAINT "bargain_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bargain_requests" ADD CONSTRAINT "bargain_requests_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bargain_requests" ADD CONSTRAINT "bargain_requests_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bargain_requests" ADD CONSTRAINT "bargain_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bargain_requests" ADD CONSTRAINT "bargain_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_auto_approve_bounds" ADD CONSTRAINT "rep_auto_approve_bounds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_auto_approve_bounds" ADD CONSTRAINT "rep_auto_approve_bounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_price_overrides" ADD CONSTRAINT "retailer_price_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_price_overrides" ADD CONSTRAINT "retailer_price_overrides_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_price_overrides" ADD CONSTRAINT "retailer_price_overrides_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_price_overrides" ADD CONSTRAINT "retailer_price_overrides_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_free_variant_id_product_variants_id_fk" FOREIGN KEY ("free_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_cycle_count_id_cycle_counts_id_fk" FOREIGN KEY ("cycle_count_id") REFERENCES "public"."cycle_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_state_transitions" ADD CONSTRAINT "order_state_transitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_state_transitions" ADD CONSTRAINT "order_state_transitions_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_fulfil_from_location_id_locations_id_fk" FOREIGN KEY ("fulfil_from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grn_id_grns_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_supplier_invoice_line_id_supplier_invoice_lines_id_fk" FOREIGN KEY ("supplier_invoice_line_id") REFERENCES "public"."supplier_invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_grn_id_grns_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_grn_line_id_grn_lines_id_fk" FOREIGN KEY ("grn_line_id") REFERENCES "public"."grn_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lorry_receipts" ADD CONSTRAINT "lorry_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lorry_receipts" ADD CONSTRAINT "lorry_receipts_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_confirmations" ADD CONSTRAINT "pack_confirmations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_confirmations" ADD CONSTRAINT "pack_confirmations_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_confirmations" ADD CONSTRAINT "pack_confirmations_packed_by_users_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_picklist_id_picklists_id_fk" FOREIGN KEY ("picklist_id") REFERENCES "public"."picklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picklists" ADD CONSTRAINT "picklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picklists" ADD CONSTRAINT "picklists_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picklists" ADD CONSTRAINT "picklists_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ADD CONSTRAINT "ageing_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ADD CONSTRAINT "ageing_snapshots_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_discount_conditions" ADD CONSTRAINT "cash_discount_conditions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_discount_conditions" ADD CONSTRAINT "cash_discount_conditions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_discount_conditions" ADD CONSTRAINT "cash_discount_conditions_realised_receipt_id_receipts_id_fk" FOREIGN KEY ("realised_receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_stop_id_trip_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."trip_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_stop_id_trip_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."trip_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_evidence" ADD CONSTRAINT "pod_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_evidence" ADD CONSTRAINT "pod_evidence_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_points" ADD CONSTRAINT "trip_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_points" ADD CONSTRAINT "trip_points_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_helper_id_users_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections_log" ADD CONSTRAINT "corrections_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections_log" ADD CONSTRAINT "corrections_log_review_session_id_review_sessions_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_disagreements" ADD CONSTRAINT "engine_disagreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_disagreements" ADD CONSTRAINT "engine_disagreements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_checks" ADD CONSTRAINT "extraction_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_checks" ADD CONSTRAINT "extraction_checks_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_base_extraction_id_extractions_id_fk" FOREIGN KEY ("base_extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_match_candidates" ADD CONSTRAINT "sku_match_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_match_candidates" ADD CONSTRAINT "sku_match_candidates_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_match_candidates" ADD CONSTRAINT "sku_match_candidates_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_aliases" ADD CONSTRAINT "supplier_aliases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_aliases" ADD CONSTRAINT "supplier_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_statements" ADD CONSTRAINT "claim_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_statements" ADD CONSTRAINT "claim_statements_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_windows" ADD CONSTRAINT "whatsapp_windows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rep_stats" ADD CONSTRAINT "daily_rep_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rep_stats" ADD CONSTRAINT "daily_rep_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD CONSTRAINT "daily_tenant_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_summary" ADD CONSTRAINT "owner_summary_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_behaviour" ADD CONSTRAINT "retailer_behaviour_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_behaviour" ADD CONSTRAINT "retailer_behaviour_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_mappings" ADD CONSTRAINT "tally_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_sync_ledger" ADD CONSTRAINT "tally_sync_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_payouts" ADD CONSTRAINT "computed_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_payouts" ADD CONSTRAINT "computed_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_time_idx" ON "audit_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "location_consents_user_idx" ON "location_consents" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_rate_limits_key_idx" ON "otp_rate_limits" USING btree ("key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_manufacturer_name_idx" ON "brands" USING btree ("manufacturer_id","name");--> statement-breakpoint
CREATE INDEX "hsn_rates_code_from_idx" ON "hsn_rates" USING btree ("hsn_code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturers_name_idx" ON "manufacturers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "product_aliases_normalized_idx" ON "product_aliases" USING btree ("normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "product_external_codes_idx" ON "product_external_codes" USING btree ("system","code");--> statement-breakpoint
CREATE UNIQUE INDEX "product_packs_variant_level_idx" ON "product_packs" USING btree ("variant_id","level");--> statement-breakpoint
CREATE INDEX "product_proposals_status_idx" ON "product_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_ean_idx" ON "product_variants" USING btree ("ean") WHERE ean IS NOT NULL;--> statement-breakpoint
CREATE INDEX "products_manufacturer_idx" ON "products" USING btree ("manufacturer_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "rep_product_authorisations_idx" ON "rep_product_authorisations" USING btree ("tenant_id","user_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_policies_tenant_brand_idx" ON "return_policies" USING btree ("tenant_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_pack_configs_idx" ON "supplier_pack_configs" USING btree ("tenant_id","supplier_id","variant_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_idx" ON "suppliers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "tenant_product_costs_variant_idx" ON "tenant_product_costs" USING btree ("tenant_id","variant_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_products_idx" ON "tenant_products" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE INDEX "beat_assignments_user_idx" ON "beat_assignments" USING btree ("tenant_id","user_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "beats_tenant_name_idx" ON "beats" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "directory_optins_identity_idx" ON "directory_optins" USING btree ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pjp_beat_retailer_idx" ON "pjp" USING btree ("tenant_id","beat_id","retailer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retailer_identities_phone_idx" ON "retailer_identities" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "retailer_links_idx" ON "retailer_links" USING btree ("tenant_id","identity_id","retailer_id");--> statement-breakpoint
CREATE INDEX "retailer_links_identity_idx" ON "retailer_links" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "retailer_links_user_idx" ON "retailer_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retailers_tenant_code_idx" ON "retailers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "retailers_tenant_beat_idx" ON "retailers" USING btree ("tenant_id","beat_id");--> statement-breakpoint
CREATE INDEX "retailers_tenant_phone_idx" ON "retailers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "visits_user_day_idx" ON "visits" USING btree ("tenant_id","user_id","started_at");--> statement-breakpoint
CREATE INDEX "visits_retailer_idx" ON "visits" USING btree ("tenant_id","retailer_id");--> statement-breakpoint
CREATE INDEX "bargain_requests_status_idx" ON "bargain_requests" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_idx" ON "price_list_items" USING btree ("tenant_id","price_list_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_tenant_name_idx" ON "price_lists" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "rep_auto_approve_bounds_idx" ON "rep_auto_approve_bounds" USING btree ("tenant_id","user_id",coalesce(brand_id, ''));--> statement-breakpoint
CREATE INDEX "retailer_price_overrides_idx" ON "retailer_price_overrides" USING btree ("tenant_id","retailer_id","variant_id");--> statement-breakpoint
CREATE INDEX "schemes_tenant_valid_idx" ON "schemes" USING btree ("tenant_id","valid_from","valid_to");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_count_lines_idx" ON "cycle_count_lines" USING btree ("tenant_id","cycle_count_id","lot_id");--> statement-breakpoint
CREATE INDEX "cycle_counts_location_idx" ON "cycle_counts" USING btree ("tenant_id","location_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_tenant_name_idx" ON "locations" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "reservations_order_line_idx" ON "reservations" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE INDEX "reservations_state_idx" ON "reservations" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "stock_balances_location_idx" ON "stock_balances" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_ledger_idempotency_idx" ON "stock_ledger" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "stock_ledger_time_idx" ON "stock_ledger" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_ledger_lot_location_idx" ON "stock_ledger" USING btree ("tenant_id","lot_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_ref_idx" ON "stock_ledger" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_identity_idx" ON "stock_lots" USING btree ("tenant_id","variant_id","batch_no","mrp_paise");--> statement-breakpoint
CREATE INDEX "stock_lots_expiry_idx" ON "stock_lots" USING btree ("tenant_id","expiry_date");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "approvals_order_idx" ON "approvals" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "order_state_transitions_order_idx" ON "order_state_transitions" USING btree ("tenant_id","order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sales_order_lines_order_idx" ON "sales_order_lines" USING btree ("tenant_id","order_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_order_lines_variant_idx" ON "sales_order_lines" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE INDEX "sales_orders_retailer_idx" ON "sales_orders" USING btree ("tenant_id","retailer_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_orders_state_idx" ON "sales_orders" USING btree ("tenant_id","state","created_at");--> statement-breakpoint
CREATE INDEX "sales_orders_salesperson_idx" ON "sales_orders" USING btree ("tenant_id","salesperson_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_orders_no_idx" ON "sales_orders" USING btree ("tenant_id","order_no");--> statement-breakpoint
CREATE INDEX "grn_lines_grn_idx" ON "grn_lines" USING btree ("tenant_id","grn_id");--> statement-breakpoint
CREATE INDEX "grns_invoice_idx" ON "grns" USING btree ("tenant_id","supplier_invoice_id");--> statement-breakpoint
CREATE INDEX "grns_status_idx" ON "grns" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inbound_discrepancies_status_idx" ON "inbound_discrepancies" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "lorry_receipts_invoice_idx" ON "lorry_receipts" USING btree ("tenant_id","supplier_invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("tenant_id","supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_invoice_lines_invoice_idx" ON "supplier_invoice_lines" USING btree ("tenant_id","supplier_invoice_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_no_idx" ON "supplier_invoices" USING btree ("tenant_id","supplier_id","invoice_no","invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_irn_idx" ON "supplier_invoices" USING btree ("tenant_id","irn") WHERE irn IS NOT NULL;--> statement-breakpoint
CREATE INDEX "supplier_invoices_status_idx" ON "supplier_invoices" USING btree ("tenant_id","status","invoice_date");--> statement-breakpoint
CREATE INDEX "load_sheets_trip_idx" ON "load_sheets" USING btree ("tenant_id","trip_id");--> statement-breakpoint
CREATE INDEX "pack_confirmations_order_idx" ON "pack_confirmations" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "pick_lines_picklist_idx" ON "pick_lines" USING btree ("tenant_id","picklist_id");--> statement-breakpoint
CREATE INDEX "pick_lines_order_idx" ON "pick_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "picklists_status_idx" ON "picklists" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "credit_note_lines_note_idx" ON "credit_note_lines" USING btree ("tenant_id","credit_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_no_idx" ON "credit_notes" USING btree ("tenant_id","series_code","fy","credit_note_no") WHERE credit_note_no IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_no_idx" ON "invoices" USING btree ("tenant_id","series_code","fy","invoice_no") WHERE invoice_no IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_retailer_idx" ON "invoices" USING btree ("tenant_id","retailer_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "invoices_state_idx" ON "invoices" USING btree ("tenant_id","state","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_idx" ON "accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "accounts_party_idx" ON "accounts" USING btree ("tenant_id","party_type","party_id");--> statement-breakpoint
CREATE INDEX "allocations_invoice_idx" ON "allocations" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "allocations_receipt_idx" ON "allocations" USING btree ("tenant_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_discount_conditions_invoice_idx" ON "cash_discount_conditions" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "cash_discount_conditions_status_idx" ON "cash_discount_conditions" USING btree ("tenant_id","status","pay_by");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_idempotency_idx" ON "journal_entries" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "journal_entries_ref_idx" ON "journal_entries" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("tenant_id","entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_party_idx" ON "journal_lines" USING btree ("tenant_id","party_type","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_idempotency_idx" ON "receipts" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "receipts_retailer_idx" ON "receipts" USING btree ("tenant_id","retailer_id","received_at");--> statement-breakpoint
CREATE INDEX "receipts_trip_idx" ON "receipts" USING btree ("tenant_id","trip_id");--> statement-breakpoint
CREATE INDEX "collections_trip_idx" ON "collections" USING btree ("tenant_id","trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_receipt_idx" ON "collections" USING btree ("tenant_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_idempotency_idx" ON "deliveries" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "deliveries_invoice_idx" ON "deliveries" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "deliveries_trip_idx" ON "deliveries" USING btree ("tenant_id","trip_id");--> statement-breakpoint
CREATE INDEX "delivery_lines_delivery_idx" ON "delivery_lines" USING btree ("tenant_id","delivery_id");--> statement-breakpoint
CREATE INDEX "pod_evidence_delivery_idx" ON "pod_evidence" USING btree ("tenant_id","delivery_id");--> statement-breakpoint
CREATE INDEX "trip_expenses_trip_idx" ON "trip_expenses" USING btree ("tenant_id","trip_id");--> statement-breakpoint
CREATE INDEX "trip_points_trip_time_idx" ON "trip_points" USING btree ("tenant_id","trip_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_settlements_trip_idx" ON "trip_settlements" USING btree ("tenant_id","trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_stops_sequence_idx" ON "trip_stops" USING btree ("tenant_id","trip_id","sequence");--> statement-breakpoint
CREATE INDEX "trip_stops_retailer_idx" ON "trip_stops" USING btree ("tenant_id","retailer_id");--> statement-breakpoint
CREATE INDEX "trips_date_idx" ON "trips" USING btree ("tenant_id","trip_date");--> statement-breakpoint
CREATE INDEX "trips_state_idx" ON "trips" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "trips_driver_idx" ON "trips" USING btree ("tenant_id","driver_id","trip_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_positions_vehicle_idx" ON "vehicle_positions" USING btree ("tenant_id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_reg_idx" ON "vehicles" USING btree ("tenant_id","reg_no");--> statement-breakpoint
CREATE INDEX "corrections_log_session_idx" ON "corrections_log" USING btree ("tenant_id","review_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_pages_idx" ON "document_pages" USING btree ("tenant_id","document_id","page_no");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_hash_idx" ON "documents" USING btree ("tenant_id","content_hash") WHERE content_hash IS NOT NULL;--> statement-breakpoint
CREATE INDEX "engine_disagreements_document_idx" ON "engine_disagreements" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "extraction_checks_extraction_idx" ON "extraction_checks" USING btree ("tenant_id","extraction_id");--> statement-breakpoint
CREATE INDEX "extractions_document_idx" ON "extractions" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_sessions_open_idx" ON "review_sessions" USING btree ("tenant_id","document_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "sku_match_candidates_idx" ON "sku_match_candidates" USING btree ("tenant_id","extraction_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_aliases_idx" ON "supplier_aliases" USING btree ("tenant_id","normalized");--> statement-breakpoint
CREATE INDEX "claim_evidence_claim_idx" ON "claim_evidence" USING btree ("tenant_id","claim_id");--> statement-breakpoint
CREATE INDEX "claim_lines_claim_idx" ON "claim_lines" USING btree ("tenant_id","claim_id");--> statement-breakpoint
CREATE INDEX "claim_lines_source_idx" ON "claim_lines" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "claim_statements_claim_idx" ON "claim_statements" USING btree ("tenant_id","claim_id");--> statement-breakpoint
CREATE INDEX "claims_supplier_idx" ON "claims" USING btree ("tenant_id","supplier_id","period_from");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inbound_messages_idx" ON "inbound_messages" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_provider_idx" ON "inbound_messages" USING btree ("tenant_id","provider_message_id") WHERE provider_message_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_idx" ON "messages" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "messages_ref_idx" ON "messages" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_device_idx" ON "push_tokens" USING btree ("tenant_id","user_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_key_idx" ON "templates" USING btree (coalesce(tenant_id, ''),"key","channel","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_windows_idx" ON "whatsapp_windows" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "retailer_behaviour_lapsed_idx" ON "retailer_behaviour" USING btree ("tenant_id","lapsed_risk");--> statement-breakpoint
CREATE INDEX "export_jobs_status_idx" ON "export_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_idx" ON "import_rows" USING btree ("tenant_id","import_job_id","row_no");--> statement-breakpoint
CREATE INDEX "import_rows_status_idx" ON "import_rows" USING btree ("tenant_id","import_job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_mappings_idx" ON "tally_mappings" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tally_sync_ledger_doc_idx" ON "tally_sync_ledger" USING btree ("tenant_id","doc_type","doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_target_idx" ON "achievements" USING btree ("tenant_id","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "computed_payouts_idx" ON "computed_payouts" USING btree ("tenant_id","user_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "targets_user_period_idx" ON "targets" USING btree ("tenant_id","user_id","period_from");--> statement-breakpoint
CREATE POLICY "audit_log_tenant" ON "audit_log" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "feature_flags_tenant" ON "feature_flags" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_settings_owner" ON "tenant_settings" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "devices_own" ON "devices" AS PERMISSIVE FOR ALL TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "location_consents_rw" ON "location_consents" AS PERMISSIVE FOR ALL TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true)) OR (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'))) WITH CHECK (user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) = 'system');--> statement-breakpoint
CREATE POLICY "otp_rate_limits_system" ON "otp_rate_limits" AS PERMISSIVE FOR ALL TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) = 'system') WITH CHECK ((SELECT current_setting('app.actor_role', true)) = 'system');--> statement-breakpoint
CREATE POLICY "brands_read" ON "brands" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "brands_curate_insert" ON "brands" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "brands_curate_update" ON "brands" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "brands_curate_delete" ON "brands" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "hsn_rates_read" ON "hsn_rates" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "hsn_rates_curate_insert" ON "hsn_rates" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "hsn_rates_curate_update" ON "hsn_rates" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "hsn_rates_curate_delete" ON "hsn_rates" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "manufacturers_read" ON "manufacturers" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "manufacturers_curate_insert" ON "manufacturers" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "manufacturers_curate_update" ON "manufacturers" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "manufacturers_curate_delete" ON "manufacturers" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_aliases_read" ON "product_aliases" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "product_aliases_curate_insert" ON "product_aliases" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_aliases_curate_update" ON "product_aliases" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_aliases_curate_delete" ON "product_aliases" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_external_codes_read" ON "product_external_codes" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "product_external_codes_curate_insert" ON "product_external_codes" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_external_codes_curate_update" ON "product_external_codes" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_external_codes_curate_delete" ON "product_external_codes" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_packs_read" ON "product_packs" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "product_packs_curate_insert" ON "product_packs" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_packs_curate_update" ON "product_packs" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_packs_curate_delete" ON "product_packs" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_proposals_tenant" ON "product_proposals" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "product_proposals_curator" ON "product_proposals" AS PERMISSIVE FOR ALL TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_variants_read" ON "product_variants" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "product_variants_curate_insert" ON "product_variants" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_variants_curate_update" ON "product_variants" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_variants_curate_delete" ON "product_variants" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "product_variants_tenant_propose" ON "product_variants" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (status = 'proposed' AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND p.proposed_by_tenant_id = (SELECT current_setting('app.tenant_id', true))));--> statement-breakpoint
CREATE POLICY "products_read" ON "products" AS PERMISSIVE FOR SELECT TO "app_rw" USING (true);--> statement-breakpoint
CREATE POLICY "products_curate_insert" ON "products" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "products_curate_update" ON "products" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "products_curate_delete" ON "products" AS PERMISSIVE FOR DELETE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'));--> statement-breakpoint
CREATE POLICY "products_tenant_propose" ON "products" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (status = 'proposed' AND proposed_by_tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "rep_product_authorisations_tenant" ON "rep_product_authorisations" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "return_policies_tenant" ON "return_policies" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "supplier_pack_configs_tenant" ON "supplier_pack_configs" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "suppliers_tenant" ON "suppliers" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_product_costs_back_office" ON "tenant_product_costs" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "tenant_products_tenant" ON "tenant_products" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "beat_assignments_tenant" ON "beat_assignments" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "beats_tenant" ON "beats" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "directory_optins_own" ON "directory_optins" AS PERMISSIVE FOR ALL TO "app_rw" USING (EXISTS (SELECT 1 FROM retailer_identities ri WHERE ri.id = directory_optins.identity_id AND ri.user_id = (SELECT current_setting('app.actor_id', true)))) WITH CHECK (EXISTS (SELECT 1 FROM retailer_identities ri WHERE ri.id = directory_optins.identity_id AND ri.user_id = (SELECT current_setting('app.actor_id', true))));--> statement-breakpoint
CREATE POLICY "directory_optins_tenant_read" ON "directory_optins" AS PERMISSIVE FOR SELECT TO "app_rw" USING (active AND (tenant_id IS NULL OR tenant_id = (SELECT current_setting('app.tenant_id', true))));--> statement-breakpoint
CREATE POLICY "pjp_tenant" ON "pjp" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "retailer_identities_read" ON "retailer_identities" AS PERMISSIVE FOR SELECT TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true)) OR EXISTS (
        SELECT 1 FROM retailer_links l WHERE l.identity_id = retailer_identities.id AND l.tenant_id = (SELECT current_setting('app.tenant_id', true))
      ));--> statement-breakpoint
CREATE POLICY "retailer_identities_insert" ON "retailer_identities" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "retailer_identities_update" ON "retailer_identities" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'system'));--> statement-breakpoint
CREATE POLICY "retailer_links_read" ON "retailer_links" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) OR user_id = (SELECT current_setting('app.actor_id', true)));--> statement-breakpoint
CREATE POLICY "retailer_links_write_insert" ON "retailer_links" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "retailer_links_write_update" ON "retailer_links" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "retailer_links_write_delete" ON "retailer_links" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "retailers_read" ON "retailers" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "retailers_write_insert" ON "retailers" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "retailers_write_update" ON "retailers" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "retailers_write_delete" ON "retailers" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "visits_tenant" ON "visits" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "bargain_requests_tenant" ON "bargain_requests" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "price_list_items_tenant" ON "price_list_items" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "price_lists_tenant" ON "price_lists" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "rep_auto_approve_bounds_tenant" ON "rep_auto_approve_bounds" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "retailer_price_overrides_tenant" ON "retailer_price_overrides" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "schemes_tenant" ON "schemes" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "cycle_count_lines_tenant" ON "cycle_count_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "cycle_counts_tenant" ON "cycle_counts" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "locations_tenant" ON "locations" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "reservations_tenant" ON "reservations" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "stock_balances_tenant" ON "stock_balances" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "stock_ledger_tenant" ON "stock_ledger" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "stock_lots_tenant" ON "stock_lots" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "approvals_tenant" ON "approvals" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "order_state_transitions_read" ON "order_state_transitions" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR (SELECT o.retailer_id FROM sales_orders o WHERE o.id = order_state_transitions.order_id) IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "order_state_transitions_write_insert" ON "order_state_transitions" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "order_state_transitions_write_update" ON "order_state_transitions" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "order_state_transitions_write_delete" ON "order_state_transitions" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "sales_order_lines_read" ON "sales_order_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.order_id)
      ));--> statement-breakpoint
CREATE POLICY "sales_order_lines_write_insert" ON "sales_order_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "sales_order_lines_write_update" ON "sales_order_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "sales_order_lines_write_delete" ON "sales_order_lines" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "sales_order_lines_retailer_write" ON "sales_order_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.order_id AND o.state = 'draft' AND o.created_by = (SELECT current_setting('app.actor_id', true)))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = sales_order_lines.order_id AND o.state IN ('draft', 'submitted') AND o.created_by = (SELECT current_setting('app.actor_id', true))));--> statement-breakpoint
CREATE POLICY "sales_orders_read" ON "sales_orders" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "sales_orders_write_insert" ON "sales_orders" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "sales_orders_write_update" ON "sales_orders" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "sales_orders_write_delete" ON "sales_orders" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "sales_orders_retailer_insert" ON "sales_orders" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND source = 'retailer_app' AND state IN ('draft', 'submitted') AND created_by = (SELECT current_setting('app.actor_id', true))
        AND retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true)) AND l.user_id = (SELECT current_setting('app.actor_id', true)) AND l.status = 'active'
        ));--> statement-breakpoint
CREATE POLICY "sales_orders_retailer_update" ON "sales_orders" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND created_by = (SELECT current_setting('app.actor_id', true)) AND state = 'draft') WITH CHECK (state IN ('draft', 'submitted', 'cancelled'));--> statement-breakpoint
CREATE POLICY "grn_lines_tenant" ON "grn_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "grns_tenant" ON "grns" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "inbound_discrepancies_tenant" ON "inbound_discrepancies" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "lorry_receipts_tenant" ON "lorry_receipts" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "purchase_orders_back_office" ON "purchase_orders" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "supplier_invoice_lines_back_office" ON "supplier_invoice_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "supplier_invoices_back_office" ON "supplier_invoices" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "load_sheets_tenant" ON "load_sheets" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "pack_confirmations_tenant" ON "pack_confirmations" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "pick_lines_tenant" ON "pick_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "picklists_tenant" ON "picklists" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "credit_note_lines_read" ON "credit_note_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM credit_notes c WHERE c.id = credit_note_lines.credit_note_id)
      ));--> statement-breakpoint
CREATE POLICY "credit_note_lines_write_insert" ON "credit_note_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "credit_note_lines_write_update" ON "credit_note_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "credit_note_lines_write_delete" ON "credit_note_lines" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "credit_notes_read" ON "credit_notes" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "credit_notes_write_insert" ON "credit_notes" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "credit_notes_write_update" ON "credit_notes" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "credit_notes_write_delete" ON "credit_notes" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "invoice_lines_read" ON "invoice_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_lines.invoice_id)
      ));--> statement-breakpoint
CREATE POLICY "invoice_lines_write_insert" ON "invoice_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "invoice_lines_write_update" ON "invoice_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "invoice_lines_write_delete" ON "invoice_lines" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "invoices_read" ON "invoices" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "invoices_write_insert" ON "invoices" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "invoices_write_update" ON "invoices" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "invoices_write_delete" ON "invoices" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "accounts_tenant" ON "accounts" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "ageing_snapshots_read" ON "ageing_snapshots" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "ageing_snapshots_write_insert" ON "ageing_snapshots" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "ageing_snapshots_write_update" ON "ageing_snapshots" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "ageing_snapshots_write_delete" ON "ageing_snapshots" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "allocations_tenant" ON "allocations" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "cash_discount_conditions_tenant" ON "cash_discount_conditions" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "journal_entries_tenant" ON "journal_entries" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "journal_lines_tenant" ON "journal_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "receipts_read" ON "receipts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "receipts_write_insert" ON "receipts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "receipts_write_update" ON "receipts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "receipts_write_delete" ON "receipts" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "collections_tenant" ON "collections" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "deliveries_tenant" ON "deliveries" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "delivery_lines_tenant" ON "delivery_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "pod_evidence_tenant" ON "pod_evidence" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "trip_expenses_tenant" ON "trip_expenses" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "trip_points_read" ON "trip_points" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "trip_points_insert" ON "trip_points" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND user_id = (SELECT current_setting('app.actor_id', true)));--> statement-breakpoint
CREATE POLICY "trip_settlements_tenant" ON "trip_settlements" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "trip_stops_read" ON "trip_stops" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "trip_stops_write_insert" ON "trip_stops" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "trip_stops_write_update" ON "trip_stops" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "trip_stops_write_delete" ON "trip_stops" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "trips_tenant" ON "trips" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "vehicle_positions_tenant" ON "vehicle_positions" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "vehicles_tenant" ON "vehicles" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "corrections_log_back_office" ON "corrections_log" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "document_pages_tenant" ON "document_pages" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "documents_tenant" ON "documents" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "engine_disagreements_back_office" ON "engine_disagreements" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "extraction_checks_back_office" ON "extraction_checks" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "extractions_back_office" ON "extractions" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "review_sessions_back_office" ON "review_sessions" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "sku_match_candidates_back_office" ON "sku_match_candidates" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "supplier_aliases_tenant" ON "supplier_aliases" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "claim_evidence_back_office" ON "claim_evidence" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "claim_lines_back_office" ON "claim_lines" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "claim_statements_back_office" ON "claim_statements" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "claims_back_office" ON "claims" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "inbound_messages_tenant" ON "inbound_messages" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "messages_tenant" ON "messages" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "push_tokens_tenant" ON "push_tokens" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "templates_read" ON "templates" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id IS NULL OR tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "templates_write" ON "templates" AS PERMISSIVE FOR ALL TO "app_rw" USING ((tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) OR (tenant_id IS NULL AND (SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'))) WITH CHECK ((tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) OR (tenant_id IS NULL AND (SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')));--> statement-breakpoint
CREATE POLICY "whatsapp_windows_tenant" ON "whatsapp_windows" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "daily_rep_stats_read" ON "daily_rep_stats" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR user_id = (SELECT current_setting('app.actor_id', true))));--> statement-breakpoint
CREATE POLICY "daily_rep_stats_write" ON "daily_rep_stats" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system');--> statement-breakpoint
CREATE POLICY "daily_tenant_stats_tenant" ON "daily_tenant_stats" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "owner_summary_back_office" ON "owner_summary" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "retailer_behaviour_tenant" ON "retailer_behaviour" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "export_jobs_back_office" ON "export_jobs" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "import_jobs_back_office" ON "import_jobs" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "import_rows_back_office" ON "import_rows" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "tally_mappings_back_office" ON "tally_mappings" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "tally_sync_ledger_back_office" ON "tally_sync_ledger" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "achievements_read" ON "achievements" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR EXISTS (SELECT 1 FROM targets tg WHERE tg.id = achievements.target_id AND tg.user_id = (SELECT current_setting('app.actor_id', true)))));--> statement-breakpoint
CREATE POLICY "achievements_write" ON "achievements" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system');--> statement-breakpoint
CREATE POLICY "computed_payouts_back_office" ON "computed_payouts" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "targets_read" ON "targets" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR user_id = (SELECT current_setting('app.actor_id', true))));--> statement-breakpoint
CREATE POLICY "targets_write" ON "targets" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));