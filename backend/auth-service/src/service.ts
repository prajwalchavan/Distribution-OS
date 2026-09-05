import { AuthModule, defineService } from '@dos/core'

/**
 * Sign-in for every app (:3000): username + password → EdDSA access token + rotating refresh token,
 * refresh, logout, switch distributor, sessions, change password, and the public keys every other
 * service verifies tokens with. It serves all seven membership roles because everyone signs in here.
 */
export const service = defineService({
  name: 'auth',
  title: 'Auth service',
  defaultPort: 3000,
  roles: ['owner', 'manager', 'accountant', 'salesperson', 'warehouse', 'delivery', 'retailer'],
  modules: [AuthModule],
  contractKeys: ['health', 'auth'],
})
