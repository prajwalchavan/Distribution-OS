/**
 * One brand's items, as tiles (founder, 2026-09-28: "Shop by brand" on the shop front).
 *
 * The items come from the distributor's own listed price list (`usePriceList`), filtered to the brand
 * on the device — the same read the home and search use, so opening a brand costs no round trip and
 * a brand tile never promises items this distributor does not sell. Every + goes into the one basket
 * (`src/groups/retailer/lib/cart.ts`), and the bar at the foot opens the order screen.
 */
import { useSession } from '@dos/api-client/react'
import { Button, EmptyState, Screen, Stack, TileGrid, useGo, useStrings } from '@dos/ui'
import { useLocalSearchParams } from 'expo-router'

import { NO_BRAND, displayName, itemsOfBrand } from '../../../src/groups/retailer/lib/catalog'
import { usePiecesEntry } from '../../../src/groups/retailer/lib/pieces'
import { ItemTile, ShopCartBar } from '../../../src/groups/retailer/lib/shop-ui'
import { useShopping } from '../../../src/groups/retailer/lib/shopping'
import { Async } from '../../../src/groups/retailer/lib/ui'

export default function Brand(): React.JSX.Element {
  const t = useStrings()
  const go = useGo()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string }>()
  const brandId = typeof params.id === 'string' ? params.id : ''

  const shopping = useShopping()
  const { list, cart } = shopping
  const items = itemsOfBrand(list.items, brandId)
  const title = brandId === NO_BRAND ? t('r2.otherItems') : (items[0]?.brandName ?? t('r2.byBrand'))

  const pieces = usePiecesEntry({
    nameOf: (variantId) => {
      const item = list.byVariant.get(variantId)
      return item === undefined ? '' : displayName(item)
    },
    piecesOf: cart.piecesOf,
    setQty: shopping.setQty,
    testID: 'rb-pieces',
  })

  return (
    <Screen
      title={title}
      context={session?.tenant.displayName}
      testID="rb-screen"
      bottomBar={<ShopCartBar shopping={shopping} />}
    >
      <Async state={[shopping.my, list]} rows={4}>
        {items.length === 0 ? (
          <Stack gap={4}>
            <EmptyState message={t('rb.none')} testID="rb-none" />
            <Button
              label={t('rb.back')}
              variant="secondary"
              onPress={() => {
                go.replace('/')
              }}
            />
          </Stack>
        ) : (
          <TileGrid testID="rb-tiles">
            {items.map((item) => (
              <ItemTile
                key={item.variantId}
                item={item}
                shopping={shopping}
                onOpenPieces={pieces.open}
                testID={`rb-tile-${item.variantId}`}
              />
            ))}
          </TileGrid>
        )}
      </Async>
      {pieces.sheet}
    </Screen>
  )
}
