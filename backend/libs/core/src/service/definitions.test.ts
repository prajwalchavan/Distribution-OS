import { describe, expect, it } from 'vitest'
import { DeliveryModule } from '../modules/delivery/index.js'
import { WarehouseModule } from '../modules/warehouse/index.js'
import { SERVICE_DEFINITIONS } from './definitions.js'

/**
 * WHAT A COMPOSITION MUST CARRY. A rule that lives in one module but is enforced by another only holds where
 * both are mounted, and nothing at start-up notices when one is missing.
 */
describe('service definitions', () => {
  it('DOS-172: every service mounting WarehouseModule mounts DeliveryModule, so the road hold is registered wherever load sheets are served', () => {
    // Delivery tells the godown which bills still ride a van that has not checked in
    // (`LoadSheetsService.registerRoadHold`, called from `DeliveryModule.onModuleInit`). Without it the
    // lookup is empty: `loadSheets.create` and `packs.list?status=awaiting_load` would offer a held bill.
    const servingLoadSheets = SERVICE_DEFINITIONS.filter(
      (definition) =>
        definition.modules.includes(WarehouseModule) ||
        definition.contractKeys.includes('warehouse'),
    )
    expect(servingLoadSheets.map((definition) => definition.name)).toEqual(
      expect.arrayContaining(['owner', 'manager', 'warehouse', 'delivery']),
    )
    for (const definition of servingLoadSheets)
      expect(definition.modules, definition.name).toContain(DeliveryModule)
  })
})
