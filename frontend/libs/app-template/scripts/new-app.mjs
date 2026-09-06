#!/usr/bin/env node
/**
 * `pnpm --filter @dos/app-template new <role> <port>`
 *
 * Copies the skeleton into `frontend/<role>-app` and rewrites the six places a role's identity is
 * written down: the package name and its `web` port, `app.json` (name, slug, scheme, bundle ids),
 * `src/config.ts` (role, title, ports, touch floor, density), the `.env.example` service URL, and the
 * README title. Every other file lands byte-identical, which is the point — a difference between two
 * apps should be a difference someone chose.
 *
 * It refuses to overwrite an existing app: `rm -rf frontend/<role>-app` first if that is what you mean.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const templateRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontendRoot = resolve(templateRoot, '../..')

/**
 * The seven apps and what each one is. Ports are docs/22 §8 (2026-09-06) and docs/18; the touch floor
 * is UX-00 §5.2 — `field` 69 (sales, retailer) · `floor` 76 (warehouse, delivery stop actions) ·
 * `phone` 63 (owner, manager) · desk buttons are 32 whatever the app.
 */
const ROLES = {
  owner: { title: 'Owner', webPort: 5173, servicePort: 3001, touch: 'phone', density: 'desk' },
  manager: { title: 'Manager', webPort: 5174, servicePort: 3002, touch: 'phone', density: 'desk' },
  sales: { title: 'Sales', webPort: 5175, servicePort: 3003, touch: 'field', density: 'field' },
  warehouse: {
    title: 'Warehouse',
    webPort: 5176,
    servicePort: 3004,
    touch: 'floor',
    density: 'field',
  },
  delivery: {
    title: 'Delivery',
    webPort: 5177,
    servicePort: 3005,
    touch: 'field',
    density: 'field',
  },
  retailer: {
    title: 'Retailer',
    webPort: 5178,
    servicePort: 3006,
    touch: 'field',
    density: 'field',
  },
  admin: { title: 'Admin', webPort: 5179, servicePort: 3007, touch: 'phone', density: 'desk' },
}

/**
 * Files and folders that are the template's own and never travel into an app.
 *
 * `scripts/` is NOT one of them: `package.json`'s `web`, `export:web` and `build` all call
 * `./scripts/sync-fonts.mjs`, so an app generated without it has a build that fails on a missing
 * file. Only `new-app.mjs` — this generator, which an app must not carry — is filtered out below.
 */
const SKIP = new Set(['node_modules', 'dist', '.expo', 'README.md', 'expo-env.d.ts'])
const SKIP_FILES = new Set(['scripts/new-app.mjs'])

function fail(message) {
  console.error(`new-app: ${message}`)
  process.exit(1)
}

const [roleArg, portArg] = process.argv.slice(2)
if (!roleArg) {
  fail(
    `usage: pnpm --filter @dos/app-template new <role> [port]\n  roles: ${Object.keys(ROLES).join(', ')}`,
  )
}

const role = roleArg.replace(/-app$/, '')
const known = ROLES[role]
const webPort = Number(portArg ?? known?.webPort ?? 5170)
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) {
  fail(`"${String(portArg)}" is not a port`)
}

const config = {
  title: known?.title ?? role.charAt(0).toUpperCase() + role.slice(1),
  servicePort: known?.servicePort ?? 3001,
  touch: known?.touch ?? 'phone',
  density: known?.density ?? 'desk',
}

const target = join(frontendRoot, `${role}-app`)
if (existsSync(target)) fail(`${target} already exists`)

mkdirSync(target, { recursive: true })
cpSync(templateRoot, target, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(templateRoot.length + 1)
    if (rel === '') return true
    const head = rel.split('/')[0]
    return !SKIP.has(head) && !SKIP_FILES.has(rel)
  },
})

const edit = (file, change) => {
  const path = join(target, file)
  writeFileSync(path, change(readFileSync(path, 'utf8')))
}

// --- package.json -------------------------------------------------------------------------------
edit('package.json', (raw) => {
  const pkg = JSON.parse(raw)
  pkg.name = `@dos/${role}-app`
  pkg.description = `Distribution OS - ${config.title}: one Expo codebase shipping as website, Android and iOS (docs/08 §0). Talks to its own service on :${String(config.servicePort)}.`
  delete pkg.scripts.new
  pkg.scripts.web = `node ./scripts/sync-fonts.mjs && expo start --web --port ${String(webPort)}`

  /*
   * `link:` is a RELATIVE path, and an app sits one directory shallower than the template
   * (`frontend/<role>-app` against `frontend/libs/app-template`). Copied verbatim, every link to
   * `backend/libs` would point one level above the repo — and the failure is not an install error but
   * a silent `any` for every contract type, which is the one mistake this repo cannot afford.
   */
  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (typeof spec !== 'string' || !spec.startsWith('link:')) continue
    const absolute = resolve(templateRoot, spec.slice('link:'.length))
    pkg.dependencies[name] = `link:${relative(target, absolute).split('\\').join('/')}`
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
})

// --- app.json -----------------------------------------------------------------------------------
edit('app.json', (raw) => {
  const manifest = JSON.parse(raw)
  manifest.expo.name = `Distribution OS - ${config.title}`
  manifest.expo.slug = `dos-${role}`
  manifest.expo.scheme = `dos-${role}`
  manifest.expo.ios.bundleIdentifier = `in.distributionos.${role}`
  manifest.expo.android.package = `in.distributionos.${role}`
  return `${JSON.stringify(manifest, null, 2)}\n`
})

// --- src/config.ts ------------------------------------------------------------------------------
edit('src/config.ts', (raw) =>
  raw
    .replace(/role: '[^']*'/, `role: '${role}'`)
    .replace(/title: '[^']*'/, `title: 'Distribution OS - ${config.title}'`)
    .replace(/webPort: \d+/, `webPort: ${String(webPort)}`)
    .replace(/servicePort: \d+/, `servicePort: ${String(config.servicePort)}`)
    .replace(/touch: '[^']*'/, `touch: '${config.touch}'`)
    .replace(/density: '[^']*'/, `density: '${config.density}'`),
)

// --- .env.example -------------------------------------------------------------------------------
edit('.env.example', (raw) =>
  raw
    .replace('http://127.0.0.1:3001', `http://127.0.0.1:${String(config.servicePort)}`)
    .replace('EXPO_PUBLIC_API_PREFIX=/owner', `EXPO_PUBLIC_API_PREFIX=/${role}`),
)

// --- README -------------------------------------------------------------------------------------
writeFileSync(
  join(target, 'README.md'),
  `# Distribution OS - ${config.title} (\`@dos/${role}-app\`)

One Expo codebase: website + Android + iOS (docs/08 §0). Generated from \`@dos/app-template\`.

\`\`\`bash
cd backend  && pnpm --filter @dos/auth-service dev            # :3000, sign-in
cd backend  && pnpm --filter @dos/${role}-service dev          # :${String(config.servicePort)}
cd frontend && pnpm --filter @dos/${role}-app web              # http://localhost:${String(webPort)}
cd frontend && pnpm --filter @dos/${role}-app ios              # the iOS simulator
cd frontend && pnpm --filter @dos/${role}-app android          # a connected device or emulator
\`\`\`

Screens are written against the \`@dos/ui\` contract only; \`react-native\` and \`react-dom\` are
unimportable here (ESLint). Platform behaviour goes through \`@dos/ui/platform\`.
`,
)

console.log(`new-app: created frontend/${role}-app`)
console.log(`  web    http://localhost:${String(webPort)}`)
console.log(`  api    http://127.0.0.1:${String(config.servicePort)}`)
console.log('  next   cd frontend && pnpm install')
