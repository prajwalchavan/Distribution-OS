/**
 * DOS-102 — which distributor this shop lands in after a sign-in on THIS device.
 *
 * A shopkeeper who buys from three distributors was always dropped into the first membership of the
 * list, whatever they had been using: `LoginInput.tenantId` is deliberately not asked for (sign-in.tsx)
 * and nothing remembered the last one. The remembered id is DEVICE-LOCAL — it lives in
 * `platform.storage`, never on the server, because "the one I use on this phone" is a property of the
 * phone and not of the account.
 *
 * A stored id that is no longer an active membership is ignored, never shown as an error: a shop that
 * has been unlinked simply lands where a fresh install would.
 */
import { storage } from '@dos/ui/platform'

export const LAST_TENANT_KEY = 'dos.lastTenantId'

/** Remember where this device ended up. Failures are silent: this is a convenience, not state. */
export function rememberDistributor(tenantId: string): void {
  try {
    storage.setItemSync(LAST_TENANT_KEY, tenantId)
  } catch {
    // A browser with site data blocked keeps working; it just always lands in the first membership.
  }
}

/**
 * The distributor to open after a sign-in, or null to keep the one the server chose: null when
 * nothing is remembered, when the remembered one is where we already are, or when it is not an
 * ACTIVE membership of this login any more.
 */
export function distributorToOpen(
  landedTenantId: string,
  memberships: readonly { tenantId: string; status: string }[],
): string | null {
  let stored: string | null = null
  try {
    stored = storage.getItemSync(LAST_TENANT_KEY)
  } catch {
    stored = null
  }
  if (stored === null || stored === landedTenantId) return null
  const match = memberships.find((m) => m.tenantId === stored && m.status === 'active')
  return match ? stored : null
}
