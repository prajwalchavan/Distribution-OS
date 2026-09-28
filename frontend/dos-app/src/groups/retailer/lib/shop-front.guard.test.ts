/**
 * The shopkeeper's home is a shop front (founder, 2026-09-28: "a shopping app feel, not some complex
 * feel"; "minimise the understanding effort"; decided the same day: no photos yet, English only).
 *
 * What is pinned, so a later change has to argue with it in the open:
 *
 * - the four entries a shopping app has — Shop, Orders, Money, Me — are the primary section, and every
 *   page the navigation carried before is still a destination (nothing removed);
 * - every label in the navigation is a plain word of at most 20 characters, and the machine word
 *   "retailer" is gone from the chrome;
 * - the home opens on items: the figures it used to open on are folded under "More", the distributor
 *   cards sit behind the chip, and one slim money line comes after the products;
 * - "Order again" is still two taps (UX-01 R3): the card pushes `/order?repeat=…` and nothing is written
 *   until "Place order";
 * - every shopping screen carries the cart bar, and a money amount is never pre-filled on the home;
 * - signing out empties every basket on the device.
 *
 * Read as source: a screen pulls in `react-native` through the kit's native entry, which only Metro
 * resolves. `@types/node` is deliberately absent from an app, so the Node functions come in through
 * non-literal specifiers.
 */
import { describe, expect, it } from 'vitest'

import { SECTIONS } from '../nav'
import { strings } from '../strings'

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

async function read(path: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const APP = '../../../../app/retailer/'

describe('the navigation of a shopping app', () => {
  it('Shop, Orders, Money and Me are the primary section, in that order', () => {
    const primary = SECTIONS.find((section) => section.primary === true)
    expect(primary?.items.map((item) => item.label)).toEqual(['Shop', 'Orders', 'Money', 'Me'])
    expect(primary?.items.map((item) => item.href)).toEqual([
      '/retailer',
      '/retailer/orders',
      '/retailer/dues',
      '/retailer/profile',
    ])
  })

  it('every page the navigation carried before 2026-09-28 is still a destination', () => {
    const hrefs = SECTIONS.flatMap((section) => section.items.map((item) => item.href))
    for (const page of [
      '/retailer',
      '/retailer/orders',
      '/retailer/deals',
      '/retailer/dues',
      '/retailer/bills',
      '/retailer/receipts',
      '/retailer/statement',
      '/retailer/returns',
      '/retailer/inbox',
      '/retailer/shop',
      '/retailer/settings',
    ])
      expect(hrefs, page).toContain(page)
  })

  it('every label is a plain word of at most 20 characters, and "retailer" is never one', () => {
    for (const section of SECTIONS) {
      for (const item of section.items) {
        expect(item.label.length, item.label).toBeLessThanOrEqual(20)
        expect(item.label.toLowerCase()).not.toContain('retailer')
      }
    }
  })

  it('the header and the account menu no longer print the machine role', async () => {
    const layout = await read(`${APP}_layout.tsx`)
    expect(layout).not.toMatch(/roleLabel:\s*(session\.role|membership\.role)/)
    expect(layout).toContain("roleLabel: strings['app.shopOwner']")
  })
})

describe('the home is a shop front', () => {
  it('opens on items: search, the last order, your items, brands, offers — and the cart bar', async () => {
    const home = await read(`${APP}index.tsx`)
    for (const block of [
      'testID="r2-search"',
      'testID="r2-last-order"',
      'testID="r2-your-items"',
      'testID="r2-brands"',
      '<OffersRow',
      'bottomBar={<ShopCartBar',
    ])
      expect(home, block).toContain(block)
  })

  it('the figures it used to open on are folded under More; the cards sit behind the chip', async () => {
    const home = await read(`${APP}index.tsx`)
    const more = home.indexOf('function HomeMore(')
    expect(more).toBeGreaterThan(-1)
    // The four-figure strip exists only inside the "More" block.
    expect(home.indexOf('<KpiStrip')).toBeGreaterThan(more)
    expect(home).toMatch(/<MoreGroup[\s\S]*?<HomeMore \/>[\s\S]*?<\/MoreGroup>/)
    expect(home).toMatch(/<Sheet[\s\S]*?<DistributorList/)
  })

  it('the money line comes after the products, and no amount is pre-filled on the home', async () => {
    const home = await read(`${APP}index.tsx`)
    expect(home.indexOf('testID="r2-money"')).toBeGreaterThan(
      home.indexOf('testID="r2-your-items"'),
    )
    expect(home.indexOf('testID="r2-money"')).toBeGreaterThan(home.indexOf('testID="r2-brands"'))
    expect(home).not.toContain('RupeeInput')
  })

  it('"Order again" is still two taps: the card opens the order screen on a fresh repeat id (DOS-098)', async () => {
    const home = await read(`${APP}index.tsx`)
    expect(home).toContain('go.push(`/order?repeat=${uuidv7()}`)')
    expect(home).toMatch(/testID: 'r2-order-again'/)
    // Nothing is written from the home: no create, no submit.
    expect(home).not.toMatch(/orders\.(create|submit)\(/)
  })

  it('a brand page sells into the same basket and carries the same bar', async () => {
    const brand = await read(`${APP}brand/[id].tsx`)
    expect(brand).toContain('useShopping()')
    expect(brand).toContain('bottomBar={<ShopCartBar')
  })

  it('the order screen shops from the same basket and empties it once the order is placed', async () => {
    const order = await read(`${APP}order.tsx`)
    expect(order).toContain('useShopping()')
    expect(order).not.toMatch(/useState<readonly DraftLine\[\]>/)
    const placed = order.indexOf('void cart.clear()')
    expect(placed).toBeGreaterThan(-1)
    expect(order.indexOf('go.replace(`/orders/${done.item.id}?placed=1`)')).toBeGreaterThan(placed)
  })

  it('signing out empties every basket on the device, from the menu and from Me', async () => {
    const layout = await read(`${APP}_layout.tsx`)
    expect(layout).toContain('onSignOut: leave')
    const me = await read(`${APP}profile.tsx`)
    expect(me).toContain('leave()')
    const shopping = await read('./shopping.ts')
    expect(shopping).toMatch(/clearAllCarts\(\)[\s\S]*?signOut\(\)/)
  })
})

describe('the words on the home and in the navigation (rule 5: <= 20 characters)', () => {
  it('every button and heading label of the shop front fits', () => {
    const labels = [
      'nav.tabShop',
      'nav.tabOrders',
      'nav.tabMoney',
      'nav.tabMe',
      'nav.bills',
      'nav.receipts',
      'nav.statement',
      'nav.deals',
      'nav.returns',
      'nav.inbox',
      'nav.shop',
      'nav.account',
      'r2.change',
      'r2.switch',
      'r2.call',
      'r2.orderAgain',
      'r2.addLastOrder',
      'r2.seeAll',
      'r2.seeOffers',
      'r2.seeOrder',
      'r2.payNow',
      'r2.seeAllOrders',
      'r2.yourItems',
      'r2.byBrand',
      'r2.offers',
      'r2.lastOrderTitle',
      'r2.lastOrders',
      'r2.searchItems',
      'me.password',
      'me.signOut',
      'me.stay',
    ] as const
    for (const key of labels) expect(strings[key].length, key).toBeLessThanOrEqual(20)
  })
})
