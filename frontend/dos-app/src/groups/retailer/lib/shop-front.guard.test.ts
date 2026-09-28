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
 * - signing out empties every basket on the device, and ASKS FIRST wherever it is offered;
 * - on a phone the first screen sells: the chip is the shell's header and the last-order card is one
 *   row with its button beside the words (retailer check, 2026-09-28: 0 "+ Add" above the fold).
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
    /*
     * The cards behind the chip. Since the retailer check of 2026-09-28 the chip and its sheet are one
     * component (`DistributorChip`, `./distributors.tsx`), so the phone shell's header and the desk
     * page open the same cards; the home names the chip and the chip holds the sheet.
     */
    expect(home).toContain('<DistributorChip')
    expect(await read('./distributors.tsx')).toMatch(
      /export function DistributorChip[\s\S]*?<Sheet[\s\S]*?<DistributorList/,
    )
  })

  it('on a phone the chip is the header, and the last order is one row: products on the first screen', async () => {
    const layout = await read(`${APP}_layout.tsx`)
    expect(layout).toMatch(
      /header=\{chipIsTheName \? <DistributorChip place="header" \/> : undefined\}/,
    )
    expect(layout).toContain("viewport.kind === 'phone' && pathname === routeFor(GROUP, '/')")
    const home = await read(`${APP}index.tsx`)
    // No second chip row on a phone: the page draws it only on a desk.
    expect(home).toContain('{phone ? null : <DistributorChip place="page" />}')
    // The last-order card keeps its button BESIDE the words, never the kit JobCard's full-width one.
    expect(home).not.toContain('<JobCard')
    const card = home.slice(home.indexOf('function LastOrderCard('))
    expect(card).toMatch(/<Row gap=\{3\} align="center">[\s\S]*?<Button[\s\S]*?fullWidth=\{false\}/)
    expect(card).toContain('testID="r2-last-order"')
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

  it('a tile says its stock in the shop words, before the + as well as after it (retailer check)', async () => {
    const tile = await read('./shop-ui.tsx')
    expect(tile).toContain("t('r7.outOfStock')")
    expect(tile).toContain("t('r7.lowStock'")
    expect(tile).toContain("t('r2.stockShort'")
    // The kit stepper's own availability line ("0 cs available — rest short-supplied") is not fed.
    expect(tile).not.toContain('availablePieces=')
    expect(strings['qty.onlyAvailable']).not.toMatch(/short-supplied|\bcs\b/)
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

  /*
   * Until the retailer check of 2026-09-28 the menu passed `onSignOut: leave` and only Me asked first,
   * so one stray tap in the ⋯ sheet emptied a half-built basket without a word. Both now open the same
   * `useLeaveConfirm` dialog, whose confirm is the only caller of `leave()`.
   */
  it('signing out empties every basket on the device, and asks first from the menu and from Me', async () => {
    const layout = await read(`${APP}_layout.tsx`)
    expect(layout).toContain('onSignOut: leaveConfirm.ask')
    expect(layout).toContain('{leaveConfirm.dialog}')
    expect(layout).not.toMatch(/onSignOut:\s*leave\b(?!Confirm)/)
    const me = await read(`${APP}profile.tsx`)
    expect(me).toContain('onPress={leaveConfirm.ask}')
    expect(me).toContain('{leaveConfirm.dialog}')
    const confirm = await read('./leave-confirm.tsx')
    expect(confirm).toMatch(/onConfirm=\{\(\) => \{\s*setAsking\(false\)\s*leave\(\)/)
    expect(confirm).toContain("body={t('me.signOutBody')}")
    const shopping = await read('./shopping.ts')
    expect(shopping).toMatch(/clearAllCarts\(\)[\s\S]*?signOut\(\)/)
  })

  it('the sign-out dialog names the basket and no device (DOS-179: it opens on a counter PC too)', () => {
    for (const key of ['me.signOutTitle', 'me.signOutBody'] as const)
      expect(strings[key], key).not.toMatch(/\b(this|the)\s+(phone|device|browser)\b/i)
    expect(strings['me.signOutBody']).toContain('basket')
  })
})

describe('the words on the home and in the navigation (rule 5: <= 20 characters)', () => {
  it('the Money page s four tabs are one short word each, so a 390 px phone does not cut them', () => {
    for (const key of ['tab.due', 'tab.bills', 'tab.paid', 'tab.history'] as const)
      expect(strings[key].length, key).toBeLessThanOrEqual(7)
  })

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
      'tab.due',
      'tab.bills',
      'tab.paid',
      'tab.history',
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
