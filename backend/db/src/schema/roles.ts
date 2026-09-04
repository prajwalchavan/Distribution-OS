import { pgRole } from 'drizzle-orm/pg-core'

/**
 * ADR 0002: two database roles.
 *  - the owner role (DATABASE_URL) runs migrations and is never used by the app at runtime;
 *  - `app_rw` is what the API and worker connect as. It has no BYPASSRLS, so every tenant table's
 *    policies apply to it; FORCE ROW LEVEL SECURITY is set in migrations so even the table owner obeys them.
 */
export const appRw = pgRole('app_rw')
