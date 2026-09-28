import { describe, expect, it } from 'vitest'

import { catalogOrderKey, compareCatalogOrder } from './catalog-order'

/** The same seven items the server's catalogue-order spec uses, in the order the ruling reads them. */
const ITEMS = [
  {
    brandName: 'Amul',
    productName: 'Butter',
    variantName: 'Amul Butter 100 g',
    netQty: 100,
    netUnit: 'g',
  },
  {
    brandName: 'Amul',
    productName: 'Taaza',
    variantName: 'Amul Taaza 500 ml',
    netQty: 500,
    netUnit: 'ml',
  },
  {
    brandName: 'Amul',
    productName: 'Taaza',
    variantName: 'Amul Taaza 1 L',
    netQty: 1,
    netUnit: 'l',
  },
  {
    brandName: 'britannia',
    productName: 'Marie Gold',
    variantName: 'Marie Gold 250 g',
    netQty: 250,
    netUnit: 'g',
  },
  {
    brandName: 'britannia',
    productName: 'Marie Gold',
    variantName: 'Marie Gold 500 g',
    netQty: 500,
    netUnit: 'g',
  },
  {
    brandName: 'britannia',
    productName: 'Marie Gold',
    variantName: 'Marie Gold 1 kg',
    netQty: 1,
    netUnit: 'kg',
  },
  {
    brandName: null,
    productName: 'Loose Sugar',
    variantName: 'Loose Sugar 1 kg',
    netQty: 1,
    netUnit: 'kg',
  },
]

describe('the catalogue order on the rep’s phone (UX-O-8 ruling)', () => {
  it('reads brand, item, pack size — case-insensitive, a kilogram after 500 grams, no brand under its maker', () => {
    const keyed = ITEMS.map((item, i) => ({
      name: item.variantName,
      key: catalogOrderKey({
        ...item,
        manufacturerName: 'Maker Foods',
        variantId: `v${String(i)}`,
      }),
    }))
    const shuffled = [keyed[6], keyed[2], keyed[5], keyed[0], keyed[3], keyed[1], keyed[4]].filter(
      (row): row is (typeof keyed)[number] => row !== undefined,
    )
    shuffled.sort((a, b) => compareCatalogOrder(a.key, b.key))
    expect(shuffled.map((row) => row.name)).toEqual(ITEMS.map((item) => item.variantName))
  })
})
