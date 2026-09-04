import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { contract } from '@dos/contracts'

export interface ClientOptions {
  baseUrl: string
  /** Returns the bearer token and tenant id for the current session (mobile reads from secure store). */
  getAuth: () => Promise<{ token?: string; tenantId?: string }>
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
      }
    },
  })
  return createORPCClient(link)
}
