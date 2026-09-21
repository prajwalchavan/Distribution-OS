/**
 * Regenerates the README of every backend service and frontend app from the shared contract.
 *   pnpm docs:readme          write files
 *   pnpm docs:readme --check  exit 1 if any README is stale (CI)
 *
 * TWO APPS, NOT SEVEN (docs/31 §7). The six per-role apps were retired at the one-app merge: their six
 * entries here — each with its own `dir`, `name` and `run:` block — are one `ONE_APP` entry whose six
 * groups carry the screens and name the service each group talks to. `admin-app` keeps a single-service
 * entry in `APPS`, because the console is a separate app that talks to :3007 alone.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  renderAppReadme,
  renderOneAppReadme,
  renderServiceReadme,
  type AppGroupReadme,
  type ServiceDefinition,
} from '@dos/core'

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

/**
 * THE ONE APP (docs/31, docs/29 §3): one Expo codebase serving the website, Android and iOS for all six
 * business roles, one visible route base per group, one service behind each. Six entries collapsed into
 * this one; the screens each group used to list are the headings below.
 */
const ONE_APP = {
  dir: '../frontend/dos-app',
  name: '@dos/dos-app',
  title: 'Distribution OS',
  blurb:
    'ONE Expo codebase shipping as website + Android + iOS (docs/08 §0) for all six business roles. The elected role in the access token decides which route group opens and which service every call leaves for; a person whose membership permits more than one role chooses at "Continue as …" after the password (docs/29 §2, docs/31 ruling B3). The desk shell renders at 1024 px and wider, the phone shell below it, from the same screens. Purchase cost, margin and stock value are served to the back-office groups alone, and the server answers 403 for anything the elected role may not call — the app carries no second permission list. Sign in with username + password (auth-service :3000); the app keeps a refresh token per device.',
  run: [
    'cd backend  && pnpm --filter @dos/auth-service dev        # :3000, sign-in',
    'cd backend  && pnpm dev                                   # the six role services, :3001-:3006',
    'cd frontend && pnpm --filter @dos/dos-app web             # http://localhost:5173',
    'cd frontend && pnpm --filter @dos/dos-app android         # Pixel_7_API_36 (boot it with -memory 3072)',
    'cd frontend && pnpm --filter @dos/dos-app ios             # the iOS simulator',
  ].join('\n'),
  env: 'EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3000; EXPO_PUBLIC_API_URL is the ALL-IN-ONE base (docs/26 §7) and is left unset locally, where each group talks to its own port',
  groups: [
    {
      heading: 'Owner',
      base: '/owner',
      service: 'owner',
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
      ],
    },
    {
      heading: 'Manager and accountant',
      base: '/manager',
      service: 'manager',
      screens: [
        'Approvals queue and the review desk',
        'Orders, drafts and dispatch status',
        'Fulfilment: pack, load-out, trips',
        'Stock, inbound documents and the gate count',
        'Billing desk, credit notes and brand-DMS invoices',
        'Money: receipts, day-end, claims',
        'Registers, team and the Tally export',
        'Prices and schemes, shops, staff, settings',
      ],
    },
    {
      heading: 'Sales',
      base: '/sales',
      service: 'sales',
      screens: [
        "Today's beat, in PJP order, offline-first",
        'Shop card (last order, outstanding, usual basket) and the catalog',
        'Order editor in cases and pieces, priced by the engine',
        'Bargain request, lapsed shops, a new shop',
        'My orders, drafts, visits and inbox',
      ],
    },
    {
      heading: 'Warehouse',
      base: '/warehouse',
      service: 'warehouse',
      screens: [
        'Inbound invoices, capture and the blind GRN gate count',
        'Stock by lot and location, counts and reservations',
        'Order queue → picklist → pack',
        'Load sheet, trips and check-in',
      ],
    },
    {
      heading: 'Delivery',
      base: '/delivery',
      service: 'delivery',
      screens: [
        'Start trip and the day',
        'Stops in order; deliver / partial / failed with proof',
        'Collect payment, van sales from vehicle stock',
        'Expenses, the money tray and settlement at check-in',
      ],
    },
    {
      heading: 'Shop',
      base: '/retailer',
      service: 'retailer',
      screens: [
        'My distributors, one card each',
        'Catalog with availability, reorder and deals',
        'Order status and the bill behind it',
        'Outstanding bills and dues with a UPI QR',
        'Returns, receipts, statement and the inbox',
      ],
    },
  ],
} as const

/**
 * The apps that talk to exactly ONE service. After the merge that is the platform console and nothing
 * else — auth-service has no app of its own, because every app signs in against it.
 */
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
  admin: {
    dir: '../frontend/admin-app',
    name: '@dos/admin-app',
    title: 'Admin console',
    blurb:
      "Distribution OS's OWN console, not a distributor's app: onboard a distributor (tenant, chart of accounts, first owner login, trial), keep its plan and subscription state, ask a distributor's owner for time-boxed support access and hand it back, look up a global sign-in identity across every distributor it belongs to, and read the platform's counts and audit trail. This is the one surface in the product where \"Distribution OS\" is the brand on screen, because the reader is our own staff — everywhere else the distributor's own name and logo show (docs/22 §9 item 10). Sign in with username + password at auth-service :3000, but at POST /auth/platform/login, not /auth/login: a console account holds no membership, so there is no distributor to pick. ONE Expo codebase shipping as website + Android + iOS (docs/08 §0), desk-first: the rail at 1024 px and wider, the phone shell below it, the same screens.",
    run: 'pnpm --filter @dos/auth-service dev    # :3000, sign-in\npnpm --filter @dos/admin-service dev   # :3007\ncd frontend && pnpm --filter @dos/admin-app web   # http://localhost:5179',
    env: 'EXPO_PUBLIC_API_URL / VITE_API_URL=http://localhost:3007; VITE_AUTH_URL=http://localhost:3000',
    screens: [
      'Platform: tenants by status and plan, active users, work per day, storage',
      'Distributors: list with plan, subscription state and size',
      'Onboard a distributor: tenant, first owner login, trial',
      'One distributor: subscription, suspension, support window, storage',
      'Subscriptions: plan, seats, price, trial and renewal dates, past due',
      'Support access: ask, watch the owner decide, open the window, hand it back',
      'People: one identity across every distributor',
      'Audit trail: every platform action, and every read under a support window',
      'Account: this console login and the devices signed in as it',
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

const definitions = new Map<string, ServiceDefinition>()
for (const name of services) {
  const mod = (await import(`../${name}-service/src/service.ts`)) as {
    service: ServiceDefinition
  }
  definitions.set(name, mod.service)
  emit(`${name}-service/README.md`, renderServiceReadme(mod.service))
  const app = APPS[name]
  if (app && existsSync(resolve(root, app.dir)))
    emit(`${app.dir}/README.md`, renderAppReadme({ ...app, service: mod.service }))
}

if (existsSync(resolve(root, ONE_APP.dir))) {
  const groups: AppGroupReadme[] = ONE_APP.groups.map((group) => {
    const service = definitions.get(group.service)
    // A group whose service is not in `services` above would render an empty endpoint table and read
    // as "this group calls nothing" — the opposite of the truth. Fail instead.
    if (service === undefined) throw new Error(`no service definition for group ${group.heading}`)
    return { heading: group.heading, base: group.base, service, screens: [...group.screens] }
  })
  emit(`${ONE_APP.dir}/README.md`, renderOneAppReadme({ ...ONE_APP, groups }))
}
if (check && stale > 0) {
  console.error(`${stale} README(s) out of date — run pnpm docs:readme`)
  process.exit(1)
}
