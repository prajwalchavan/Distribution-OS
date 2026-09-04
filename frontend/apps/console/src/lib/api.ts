import { createApiClient } from '@dos/api-client'
import { currentSession } from './session.js'

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`,
  getAuth: () => {
    const s = currentSession()
    return s ? { tenantId: s.tenantId, actorId: s.actorId, actorRole: s.role } : {}
  },
})

/** Stable query keys: [domain, procedure, input]. */
export const qk = {
  me: () => ['tenancy', 'me'] as const,
  health: () => ['health', 'ping'] as const,
  catalogSearch: (q: string) => ['catalog', 'search', q] as const,
  tenantCatalog: (q: string, listedOnly: boolean) =>
    ['tenantCatalog', 'list', q, listedOnly] as const,
  costs: (variantId?: string) => ['tenantCatalog', 'costs', variantId ?? ''] as const,
  suppliers: () => ['tenantCatalog', 'suppliers'] as const,
}

/** One idempotency key per user intent (a click); regenerate only for a new intent. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
