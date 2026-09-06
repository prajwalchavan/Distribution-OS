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
const services = [
  'auth',
  'owner',
  'manager',
  'sales',
  'warehouse',
  'delivery',
  'retailer',
  // Module 13, the platform console (founder decision 2026-09-05). Last, because it is ours and not a
  // distributor's: its README is the only one that documents `platform_admin` and `/auth/platform/login`.
  'admin',
] as const

/** auth-service has no app of its own — every app signs in against it. */
const APPS: Partial<
  Record<
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
  >
> = {
  owner: {
    dir: '../frontend/owner-app',
    name: '@dos/owner-app',
    title: 'Owner app',
    blurb:
      'The distributor: the day (KPIs, approvals, money, stock), the growth and performance graphs, the registers behind every number, prices and schemes, shops, staff and settings. ONE Expo codebase shipping as website + Android + iOS (docs/08 §0); the desk shell at 1024 px and wider, the phone shell below it, the same screens. Purchase cost, margin and stock value are served to this app alone. Sign in with username + password (auth-service :3000); the app keeps a refresh token per device.',
    run: 'pnpm --filter @dos/auth-service dev   # :3000, sign-in\npnpm --filter @dos/owner-service dev   # :3001\ncd frontend && pnpm --filter @dos/owner-app web   # http://localhost:5173\ncd frontend && pnpm --filter @dos/owner-app ios   # the iOS simulator',
    env: 'EXPO_PUBLIC_API_URL=http://127.0.0.1:3001; EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3000',
    screens: [
      'Today (O1): KPI strip with sparklines, sales trend, brand mix, ageing ladder, "Needs you"',
      'Approvals (O3, j/k/1/2) and the live map (O4)',
      'Orders (O5) and trips & settlements (O18)',
      'Bills, GST summary and credit notes (O13, O14)',
      'Money: outstanding & ageing, receipts & banking, books, claims (O10–O12, O19)',
      'Stock, inbound, documents inbox, catalog & costs (O15, O16, O26, O9)',
      'Shops (O6) with per-shop dues, credit, behaviour and statement',
      'Growth & performance (O2), Profit — owner only (O17), Incentives (O20), Exports & Tally (O22)',
      'Prices & schemes with a what-if quote (O8), Beats & staff (O7)',
      'Settings: branding, numbering, flags, policy, support access (O24); imports (O21); messages (O23); audit (O25)',
      'Sign in (X1) and the forced password change (X2): until `mustChangePassword` clears, every route lands there and no chrome renders',
    ],
  },
  manager: {
    dir: '../frontend/manager-app',
    name: '@dos/manager-app',
    title: 'Manager app',
    blurb:
      'The back office shared by the manager and the accountant: approvals, orders, stock and GRNs, billing desk, receipts and ageing, GST registers, exports. Purchase cost is visible here (back-office role). Sign in with username + password (auth-service :3000); the app keeps a refresh token per device.',
    run: 'pnpm --filter @dos/manager-service dev   # :3002\ncd frontend && pnpm --filter @dos/manager-app start   # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3002',
    screens: [
      'Approvals queue',
      'Orders and dispatch status',
      'Stock, GRNs and discrepancies',
      'Billing desk and credit notes',
      'Receipts, allocations, ageing',
      'GST registers and Tally export',
    ],
  },
  sales: {
    dir: '../frontend/sales-app',
    name: '@dos/sales-app',
    title: 'Salesperson app',
    blurb:
      'The beat day: shops in PJP order, check-in, order editor in cases and pieces priced by the engine, bargain requests, visits, offline-first sync. Sign in with username + password (auth-service :3000); the app keeps a refresh token per device.',
    run: 'pnpm --filter @dos/sales-service dev   # :3003\npnpm --filter @dos/sales-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3003',
    screens: [
      "Today's beat",
      'Shop card (last order, outstanding, usual basket)',
      'Order editor',
      'Bargain request',
      'Visits and performance',
    ],
  },
  warehouse: {
    dir: '../frontend/warehouse-app',
    name: '@dos/warehouse-app',
    title: 'Warehouse app',
    blurb:
      'Inbound: photograph the supplier invoice, review the extraction, blind gate count, post the GRN. Outbound: order queue, picklist, pack, load sheet. Sign in with username + password (auth-service :3000); the app keeps a refresh token per device.',
    run: 'pnpm --filter @dos/warehouse-service dev   # :3004\npnpm --filter @dos/warehouse-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3004',
    screens: [
      'Inbound invoices and GRN gate count',
      'Stock by lot and location',
      'Order queue → picklist → pack',
      'Load sheet and check-out',
    ],
  },
  delivery: {
    dir: '../frontend/delivery-app',
    name: '@dos/delivery-app',
    title: 'Delivery app',
    blurb:
      'The trip: stops in order, delivered/partial/failed with proof, collections, van sales from vehicle stock, settlement at check-in. Location shared only while a trip is active. Sign in with username + password (auth-service :3000); the app keeps a refresh token per device.',
    run: 'pnpm --filter @dos/delivery-service dev   # :3005\npnpm --filter @dos/delivery-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3005',
    screens: [
      'Start trip',
      'Next stop / map hand-off',
      'Deliver / partial / failed + POD',
      'Collect payment',
      'On-spot order',
      'Settlement',
    ],
  },
  admin: {
    dir: '../frontend/admin-app',
    name: '@dos/admin-app',
    title: 'Admin console',
    blurb:
      "Distribution OS's OWN console, not a distributor's app: onboard a distributor (tenant, chart of accounts, first owner login, trial), keep its plan and subscription state, ask a distributor's owner for time-boxed support access and hand it back, look up a global sign-in identity across every distributor it belongs to, and read the platform's counts and audit trail. This is the one surface in the product where \"Distribution OS\" is the brand on screen, because the reader is our own staff — everywhere else the distributor's own name and logo show (docs/22 §9 item 10). Sign in with username + password at auth-service :3000, but at POST /auth/platform/login, not /auth/login: a console account holds no membership, so there is no distributor to pick. Placeholder package for now — the frontend is built after the backend chain.",
    run: 'pnpm --filter @dos/auth-service dev    # :3000, sign-in\npnpm --filter @dos/admin-service dev   # :3007',
    env: 'EXPO_PUBLIC_API_URL / VITE_API_URL=http://localhost:3007; VITE_AUTH_URL=http://localhost:3000',
    screens: [
      'Distributors: list with plan, subscription state and size',
      'Onboard a distributor: tenant, first owner login, trial',
      'One distributor: subscription, support grants, storage',
      'Plans and subscription state',
      'Support access: ask, watch, hand back',
      'Users: one identity across every distributor',
      'Platform metrics and the audit trail',
    ],
  },
  retailer: {
    dir: '../frontend/retailer-app',
    name: '@dos/retailer-app',
    title: 'Retailer app',
    blurb:
      "The shop's side: one card per linked distributor, catalog with availability, reorder, order status, bills and dues with UPI QR, request a discount. Online-first; WhatsApp deep links land here. Sign in with username + password (auth-service :3000); the app keeps a refresh token per device.",
    run: 'pnpm --filter @dos/retailer-service dev   # :3006\npnpm --filter @dos/retailer-app start     # Expo: press w (web), a (Android), i (iOS)',
    env: 'EXPO_PUBLIC_API_URL=http://localhost:3006',
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
  const mod = (await import(`../${name}-service/src/service.ts`)) as {
    service: ServiceDefinition
  }
  emit(`${name}-service/README.md`, renderServiceReadme(mod.service))
  const app = APPS[name]
  if (app && existsSync(resolve(root, app.dir)))
    emit(`${app.dir}/README.md`, renderAppReadme({ ...app, service: mod.service }))
}
if (check && stale > 0) {
  console.error(`${stale} README(s) out of date — run pnpm docs:readme`)
  process.exit(1)
}
