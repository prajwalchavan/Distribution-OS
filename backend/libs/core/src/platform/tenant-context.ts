import { AsyncLocalStorage } from 'node:async_hooks'
import type { TenantContext } from '@dos/db'

/**
 * Request-scoped tenant context. Set once by the TenantGuard from the verified session and read by
 * services through `withTenant`, so no query can forget the tenant filter (RLS enforces it again).
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>()

export function currentTenant(): TenantContext {
  const ctx = tenantStorage.getStore()
  if (!ctx) throw new Error('No tenant context: handler ran outside TenantGuard')
  return ctx
}
