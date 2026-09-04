/**
 * Regenerates the README of every backend service and frontend app from the shared contract.
 *   pnpm docs:readme          write files
 *   pnpm docs:readme --check  exit 1 if any README is stale (CI)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderAppReadme, renderServiceReadme, type ServiceDefinition } from '@dos/core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const services = ['owner', 'sales', 'warehouse', 'delivery', 'retailer'] as const

const APPS: Record<
  (typeof services)[number],
  {
    dir: string
    name: string
    title: string
    blurb: string
    run: string
    env: string
    screens: string[]
  }
> = {
  owner: {
    dir: 'frontend/apps/console',
    name: '@dos/console',
    title: 'Owner console',
    blurb:
      'The distributor owner, manager and accountant: masters (catalog, costs, retailers, prices, schemes), the approvals queue, orders, and later billing desk, registers and imports. Web today (Vite); becomes `frontend-apps/owner-app` (Expo web + Android + iOS) in the layout restructure.',
    run: 'pnpm --filter @dos/owner-service dev   # :3001\npnpm --filter @dos/console dev         # http://localhost:5173 (proxies /api -> :3001)',
    env: 'VITE_API_URL, default same-origin /api → :3001',
    screens: [
      'Dashboard: API/DB status, tenant card',
      'Catalog: list/unlist variants, case size, MOQ, alias',
      'Purchase costs (owner/manager/accountant only)',
      'Retailers: list, add, credit terms',
      'Price lists & schemes, bargain queue',
      'Orders & approvals: queue, order drawer, confirm/cancel',
    ],
  },
  sales: {
    dir: 'frontend-apps/sales-app',
    name: '@dos/sales-app',
    title: 'Salesperson app',
    blurb:
      'The beat day: shops in PJP order, check-in, order editor in cases and pieces priced by the engine, bargain requests, visits, offline-first sync.',
    run: 'pnpm --filter @dos/sales-service dev   # :3002\npnpm --filter @dos/sales-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3002',
    screens: [
      "Today's beat",
      'Shop card (last order, outstanding, usual basket)',
      'Order editor',
      'Bargain request',
      'Visits and performance',
    ],
  },
  warehouse: {
    dir: 'frontend-apps/warehouse-app',
    name: '@dos/warehouse-app',
    title: 'Warehouse app',
    blurb:
      'Inbound: photograph the supplier invoice, review the extraction, blind gate count, post the GRN. Outbound: order queue, picklist, pack, load sheet.',
    run: 'pnpm --filter @dos/warehouse-service dev   # :3003\npnpm --filter @dos/warehouse-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3003',
    screens: [
      'Inbound invoices and GRN gate count',
      'Stock by lot and location',
      'Order queue → picklist → pack',
      'Load sheet and check-out',
    ],
  },
  delivery: {
    dir: 'frontend-apps/delivery-app',
    name: '@dos/delivery-app',
    title: 'Delivery app',
    blurb:
      'The trip: stops in order, delivered/partial/failed with proof, collections, van sales from vehicle stock, settlement at check-in. Location shared only while a trip is active.',
    run: 'pnpm --filter @dos/delivery-service dev   # :3004\npnpm --filter @dos/delivery-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3004',
    screens: [
      'Start trip',
      'Next stop / map hand-off',
      'Deliver / partial / failed + POD',
      'Collect payment',
      'On-spot order',
      'Settlement',
    ],
  },
  retailer: {
    dir: 'frontend-apps/retailer-app',
    name: '@dos/retailer-app',
    title: 'Retailer app',
    blurb:
      "The shop's side: one card per linked distributor, catalog with availability, reorder, order status, bills and dues with UPI QR, request a discount. Online-first; WhatsApp deep links land here.",
    run: 'pnpm --filter @dos/retailer-service dev   # :3005\npnpm --filter @dos/retailer-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3005',
    screens: [
      'My distributors',
      'Catalog and reorder',
      'Order status',
      'Outstanding bills + UPI QR',
      'Request discount',
    ],
  },
}

let stale = 0
function emit(path: string, content: string) {
  const abs = resolve(root, path)
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null
  if (check) {
    if (current !== content) {
      stale += 1
      console.error(`stale: ${path}`)
    }
    return
  }
  mkdirSync(dirname(abs), { recursive: true })
  if (current !== content) {
    writeFileSync(abs, content)
    console.warn(`wrote ${path}`)
  }
}

for (const name of services) {
  const mod = (await import(`../backend-services/${name}-service/src/service.ts`)) as {
    service: ServiceDefinition
  }
  emit(`backend-services/${name}-service/README.md`, renderServiceReadme(mod.service))
  const app = APPS[name]
  if (existsSync(resolve(root, app.dir)))
    emit(`${app.dir}/README.md`, renderAppReadme({ ...app, service: mod.service }))
}
if (check && stale > 0) {
  console.error(`${stale} README(s) out of date — run pnpm docs:readme`)
  process.exit(1)
}
