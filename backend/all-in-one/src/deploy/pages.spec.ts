import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, readArtifact } from './paths.js'

/**
 * DEP-07 — the web apps' pipeline, and the image pipeline that feeds the VM.
 *
 * The apps are on Cloudflare Pages and the API is on the VM (docs/26 §9 as-built), so a web build
 * has to be told where its API lives BEFORE Metro runs: Expo inlines every `EXPO_PUBLIC_*` variable
 * at build time, and a bundle built with the founder's 127.0.0.1 in it is a bundle that works only
 * on the founder's Mac.
 *
 * The script is parameterised by app because there are seven of them today and ONE of them
 * tomorrow: the founder decided on 2026-09-21 (docs/22 §8) that role election and the single merged
 * app land BEFORE go-live, website included, and that the seven per-role web apps are retired at
 * that merge. `dos` is that app's name here, and it must already be a value the script accepts.
 *
 * The image half is separate on purpose: it builds and pushes, and it deploys NOTHING. The runbook
 * (docs/30) is the deploy.
 */
const script = readArtifact('frontend/scripts/pages-deploy.sh')
const imageWorkflow = readArtifact('.github/workflows/image.yml')
const ciWorkflow = readArtifact('.github/workflows/ci.yml')

/** The dry run prints the exact commands it would run, so the wiring can be read without Metro. */
function plan(app: string, env: Record<string, string> = {}): string {
  const run = spawnSync('bash', [resolve(REPO_ROOT, 'frontend/scripts/pages-deploy.sh'), app], {
    encoding: 'utf8',
    cwd: resolve(REPO_ROOT, 'frontend'),
    env: { ...process.env, PAGES_DRY_RUN: '1', DOMAIN: 'distributionos.in', ...env },
  })
  if (run.status !== 0)
    throw new Error(`pages-deploy.sh ${app} exited ${String(run.status)}:\n${run.stderr}`)
  return `${run.stdout}${run.stderr}`
}

describe('DEP-07 the Pages pipeline and the image pipeline', () => {
  it('DEP-07 builds ONE app and points it at api.<domain> with that app’s all-in-one prefix', () => {
    const owner = plan('owner')
    expect(owner).toMatch(/pnpm --filter @dos\/owner-app (run )?export:web/)
    expect(owner).toMatch(/EXPO_PUBLIC_API_URL=https:\/\/api\.distributionos\.in\b/)
    expect(owner).toMatch(/EXPO_PUBLIC_API_PREFIX=\/owner\b/)
    expect(owner).toMatch(/EXPO_PUBLIC_AUTH_URL=https:\/\/api\.distributionos\.in\/auth\b/)
    // Another app, same script, different prefix and project — that is what "parameterised" means.
    const warehouse = plan('warehouse')
    expect(warehouse).toMatch(/pnpm --filter @dos\/warehouse-app (run )?export:web/)
    expect(warehouse).toMatch(/EXPO_PUBLIC_API_PREFIX=\/warehouse\b/)
  })

  it('DEP-07 already accepts the one merged app the founder put before go-live', () => {
    // docs/22 §8, 2026-09-21: role election first, then the six business apps become ONE Expo
    // project that is one website, one Android app and one iOS app, and THEN the simulation runs on
    // it. The merged app elects its role at sign-in, so it cannot be nailed to one service prefix
    // at build time the way the seven are.
    const one = plan('dos')
    expect(one).toMatch(/pnpm --filter @dos\/dos-app (run )?export:web/)
    // S-192: the cache must go with the URL. The first publish shipped the previous build's inlined
    // 127.0.0.1:3210 because the export reused Metro's cache; --clear is what stops that.
    expect(one).toMatch(/export:web --clear\b/)
    expect(one).toMatch(/EXPO_PUBLIC_API_URL=https:\/\/api\.distributionos\.in\b/)
    expect(one).not.toMatch(/EXPO_PUBLIC_API_PREFIX=\/dos\b/)
  })

  it('DEP-07 prints the prefix it exports, empty string included', () => {
    // The banner used to read "(unset)" above a build command that exported
    // EXPO_PUBLIC_API_PREFIX='' — an empty string, which is not the same thing and is what Expo
    // actually inlines. Both are now printed from the same variable, and this is the check that
    // they still agree: what a reader sees in the banner is what the bundle is built with.
    for (const app of ['owner', 'warehouse', 'dos']) {
      const out = plan(app)
      const banner = /^EXPO_PUBLIC_API_PREFIX=(\S*)/m.exec(out)?.[1] ?? '<no banner line>'
      const exported = /EXPO_PUBLIC_API_PREFIX='([^']*)'/.exec(out)?.[1] ?? '<not exported>'
      expect(banner, `${app}: the banner and the build command disagree`).toBe(exported)
    }
    expect(plan('dos'), 'an exported empty string is not "unset"').not.toMatch(/unset/)
  })

  it('DEP-07 publishes dist with wrangler to a named project, and fixes deep links', () => {
    const owner = plan('owner')
    expect(owner).toMatch(/wrangler pages deploy/)
    expect(owner).toMatch(/--project-name dos-owner\b/)
    // expo exports a single-page bundle: without this rule Pages answers 404 for /orders/123 on a
    // hard refresh, which is every deep link anyone ever shares.
    expect(script).toMatch(/_redirects/)
    expect(script).toMatch(/\/\*\s+\/index\.html\s+200/)
    // The project name is a parameter, not a constant: the merged app gets its own.
    expect(plan('owner', { PAGES_PROJECT: 'dos-web' })).toMatch(/--project-name dos-web\b/)
  })

  it('DEP-07 refuses an app it does not know and a build with no domain', () => {
    const wrong = spawnSync(
      'bash',
      [resolve(REPO_ROOT, 'frontend/scripts/pages-deploy.sh'), 'nosuch'],
      {
        encoding: 'utf8',
        env: { ...process.env, PAGES_DRY_RUN: '1', DOMAIN: 'distributionos.in' },
      },
    )
    expect(wrong.status).not.toBe(0)
    expect(`${wrong.stdout}${wrong.stderr}`).toMatch(/nosuch/)

    const noDomain = spawnSync(
      'bash',
      [resolve(REPO_ROOT, 'frontend/scripts/pages-deploy.sh'), 'owner'],
      {
        encoding: 'utf8',
        env: Object.fromEntries(
          Object.entries({ ...process.env, PAGES_DRY_RUN: '1' }).filter(([k]) => k !== 'DOMAIN'),
        ),
      },
    )
    expect(
      noDomain.status,
      'a build with no DOMAIN would inline 127.0.0.1 into the bundle',
    ).not.toBe(0)
  })

  it('DEP-07 image.yml builds arm64 and pushes to GHCR, and deploys nothing', () => {
    expect(imageWorkflow).toMatch(/^on:\n(\s+\S.*\n)*\s+push:\n\s+branches:\s*\[main\]/m)
    expect(imageWorkflow).toMatch(/^permissions:\n(\s+\S.*\n)*\s+packages:\s*write$/m)
    expect(imageWorkflow).toMatch(/uses:\s*docker\/login-action@/)
    expect(imageWorkflow).toMatch(/uses:\s*docker\/build-push-action@/)
    // linux/arm64 is not a preference: the Oracle Always Free shape is Ampere, and an amd64 image
    // simply does not run on it.
    expect(imageWorkflow).toMatch(/platforms:\s*linux\/arm64\s*$/m)
    expect(imageWorkflow).toMatch(/file:\s*backend\/infra\/docker\/Dockerfile\s*$/m)
    expect(imageWorkflow).toMatch(/context:\s*backend\s*$/m)
    expect(imageWorkflow).toMatch(/push:\s*true\s*$/m)
    expect(imageWorkflow).toMatch(/ghcr\.io/)
    // Nothing may reach the box on its own: no ssh, no deploy key, no compose over the wire.
    const text = imageWorkflow.toLowerCase()
    for (const forbidden of ['ssh-action', 'scp ', 'docker compose up', 'known_hosts']) {
      expect(text, `image.yml must not deploy (${forbidden})`).not.toContain(forbidden)
    }
  })

  it('DEP-07 leaves ci.yml exactly as it was', () => {
    // The image pipeline is a SEPARATE workflow; CI's two jobs and the order of the backend gate are
    // the ones CLAUDE.md documents, unchanged.
    expect(ciWorkflow).toMatch(/^jobs:\n\s{2}backend:/m)
    expect(ciWorkflow).toMatch(/^\s{2}frontend:$/m)
    const runs = [...ciWorkflow.matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1])
    expect(runs.slice(0, 9)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm build',
      'pnpm docs:readme:check',
      'pnpm db:migrate',
      'pnpm db:seed',
      'pnpm test',
    ])
    expect(ciWorkflow).not.toMatch(/ghcr\.io|wrangler|docker build|build-push-action/)
  })
})
