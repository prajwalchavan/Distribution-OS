import { defineService, PlatformAdminModule } from '@dos/core'

/**
 * MODULE 13 — the platform console of Distribution OS itself (founder decision 2026-09-05, docs/22 §2
 * row 7 and §8): "a seventh app + service for organisation onboarding, plans and subscription state,
 * support-access grants — time-boxed, owner-approved, audited".
 *
 * It is the ONLY service whose `roles` list names `platform_admin`, and `platform_admin` is the only
 * role it serves. Both halves of that matter, and `TenantGuard` enforces them symmetrically:
 *   - a `platform_admin` token is refused, at the gate and before any handler, on all six tenant
 *     services (403 "<name>-service does not serve the platform_admin role"), unless it carries an
 *     owner-approved support pass;
 *   - every membership role — a distributor's own owner included — is refused here for the mirror
 *     reason, and `permissions.ts` names none of them on any `admin.*` row.
 *
 * Sign in at auth-service (:3000) with `POST /auth/platform/login`, not `/auth/login`: a console
 * account holds no membership, so there is no distributor to pick. The demo account is
 * `dos.admin` / `Dos@1234` (`pnpm db:seed`).
 *
 * WHAT IT CANNOT SEE. Nothing here reads a distributor's trade. The sizes on the tenant list and the
 * platform metrics are COUNTS and storage bytes; the one path to a distributor's own rows is a support
 * grant its OWNER approved, exchanged for a five-minute pass at `auth.supportPass` and audited on every
 * request (`platform/support-access.ts`).
 */
export const service = defineService({
  name: 'admin',
  title: 'Admin console service',
  defaultPort: 3007,
  roles: ['platform_admin'],
  modules: [PlatformAdminModule],
  contractKeys: ['health', 'admin'],
})
