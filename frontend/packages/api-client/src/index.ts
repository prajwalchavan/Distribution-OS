import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { contract } from '@dos/contracts'

export interface AuthContext {
  token?: string
  tenantId?: string
  /**
   * Placeholder auth (see CLAUDE.md "TenantGuard"): until Better Auth lands the API trusts these headers.
   * Real sessions will send only the bearer token; keep these optional so the switch is one line.
   */
  actorId?: string
  actorRole?: string
}

export interface ClientOptions {
  baseUrl: string
  /** Returns the current session (mobile reads from secure store, web from memory/localStorage). */
  getAuth: () => Promise<AuthContext> | AuthContext
}

export type ApiClient = ContractRouterClient<typeof contract>

export function createApiClient(options: ClientOptions): ApiClient {
  const link = new OpenAPILink(contract, {
    url: options.baseUrl,
    headers: async () => {
      const auth = await options.getAuth()
      return {
        ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
        ...(auth.tenantId ? { 'x-tenant-id': auth.tenantId } : {}),
        ...(auth.actorId ? { 'x-actor-id': auth.actorId } : {}),
        ...(auth.actorRole ? { 'x-actor-role': auth.actorRole } : {}),
      }
    },
  })
  return createORPCClient(link)
}

export type { contract }
