import { and, eq } from 'drizzle-orm'
import type { DeliveryChallan } from '@dos/contracts'
import { deliveryChallans, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { sellerBranding } from '../tenancy/index.js'
import { challanDetail } from './warehouse.mappers.js'

/**
 * The Rule 55 challan data the worker's PDF renderer prints from — what `warehouse.challans.get`
 * answers, through the same mapper. Plain function, no Nest DI (coordination §3.9 worker rule).
 */
export async function loadChallanDocument(
  tx: Db,
  challanId: string,
): Promise<DeliveryChallan | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(deliveryChallans)
    .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, challanId)))
    .limit(1)
  if (!row) return null
  return challanDetail(tx, row, sellerBranding)
}
