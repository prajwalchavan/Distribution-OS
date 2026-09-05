-- Hand-written companion to 0008_billing_expand.sql. Everything declarable in src/schema/billing.ts —
-- the four indexes — is in the GENERATED 0008 and is deliberately NOT repeated here
-- (docs/plans/00-coordination.md §2 rule 3).
--
-- THE ONE CHANGE: tenant_settings becomes readable by staff (coordination §5.1).
--
-- 0002 gave tenant_settings a single policy, `tenant_settings_owner`, FOR ALL to owner/system. Under
-- FORCE ROW LEVEL SECURITY (0003) that means a manager, accountant, salesperson, warehouse or delivery
-- actor reads NOTHING from the table: `SELECT value FROM tenant_settings WHERE key = 'upi_vpa'` comes
-- back empty rather than forbidden. Every consumer therefore reads "not configured" and silently does
-- the wrong thing — billing prints a bill with no UPI QR for the shop to scan, the white-label document
-- header falls back to no name at all, warehouse compares an e-way-bill threshold it cannot see, and
-- delivery settles a trip against a tolerance of zero. Nothing errors; the settings just vanish for
-- everyone except the owner.
--
-- Three briefs each proposed a different fix (a three-key whitelist, STAFF_ROLES over all keys, and
-- "assume we can read it"). A key whitelist that four later migrations keep editing is worse than the
-- problem, so this is ONE policy, added once, never edited:
--
--   * SELECT only. Writes stay owner-only through the untouched `tenant_settings_owner`; permissive
--     policies OR together, so the owner keeps full read and write and loses nothing.
--   * Every role except `retailer`. A shopkeeper is a guest in the distributor's tenant and has no
--     business reading its configuration; everything a retailer needs to see is already on the
--     documents addressed to them.
--   * Never a key named `secret.%`. Convention fixed here and binding on every later module: a setting
--     that holds a credential or a token — an MSG91 key, a WhatsApp token, a bank API secret — is named
--     `secret.<name>` and stays owner/system-only by construction, so widening staff reads today cannot
--     leak a credential added in six months. Nothing currently in the table qualifies.
--
-- The white-label settings this unlocks (docs/17 §D answer 6, seeded in src/tenant-bootstrap.ts):
-- `branding.display_name`, `branding.logo_object_key`, `branding.invoice_footer` and `upi_vpa`. Every
-- document a shopkeeper sees carries the DISTRIBUTOR's own name and logo, so every role that renders or
-- prints one has to be able to read them.
--
-- Not declared in src/schema/platform.ts on purpose: declaring it there would make the next
-- `pnpm db:generate` emit this DDL a second time into a generated file (§2 rule 3). The table's drizzle
-- declaration carries a comment pointing here so the next agent to touch its policies sees this one.
DROP POLICY IF EXISTS "tenant_settings_staff_read" ON "tenant_settings";--> statement-breakpoint
CREATE POLICY "tenant_settings_staff_read" ON "tenant_settings" AS PERMISSIVE FOR SELECT TO app_rw
  USING (
    tenant_id = (SELECT current_setting('app.tenant_id', true))
    AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
    AND key NOT LIKE 'secret.%'
  );
