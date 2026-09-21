import { describe, expect, it } from 'vitest'
import { readArtifact } from './paths.js'

/**
 * DEP-08 and DEP-09 — the runbook, and what docs/26 now says.
 *
 * A runbook is only worth having if a reader can tell, per command, whether it has ever been run.
 * The convention is machine-checked here: every fenced command block is preceded by a marker,
 * `[run here]` or `[not run here: …]`. An unmarked block is a claim nobody made, and those are the
 * ones that get believed.
 */
const runbook = readArtifact('docs/30-deploy-runbook.md')
const environments = readArtifact('docs/26-environments-and-configuration.md')

/**
 * Every fenced command block in the file, with the PARAGRAPH that precedes it — the marker and the
 * "Proves:" sentence are one paragraph, which may run to several lines.
 */
function blocks(markdown: string): { marker: string; body: string }[] {
  const out: { marker: string; body: string }[] = []
  const parts = markdown.split(/^```bash$/m)
  for (let i = 1; i < parts.length; i++) {
    const paragraphs = (parts[i - 1] ?? '').split(/\n\s*\n/).filter((p) => p.trim() !== '')
    out.push({ marker: paragraphs.at(-1) ?? '', body: (parts[i] ?? '').split('```')[0] ?? '' })
  }
  return out
}

describe('DEP-08 the deploy runbook', () => {
  it('DEP-08 marks every command as run here or not run here, with what it proves', () => {
    const found = blocks(runbook)
    expect(found.length, 'a runbook with no commands is not a runbook').toBeGreaterThan(10)
    for (const { marker, body } of found) {
      expect(marker, `unmarked command block:\n${body.slice(0, 120)}`).toMatch(
        /\[(run here[^\]]*|not run here:[^\]]*)\]/,
      )
      expect(marker, `no "Proves:" on:\n${body.slice(0, 120)}`).toMatch(/Proves:/)
    }
    // At least some of it really was run, or the file is a wish list.
    expect(found.filter((b) => /\[run here/.test(b.marker)).length).toBeGreaterThanOrEqual(3)
  })

  it('DEP-08 goes in order from a bare VM to a live API, and says how to go back', () => {
    for (const heading of [
      'What must be true before you start',
      'The VM',
      'Docker on the VM',
      'Secrets',
      'DNS',
      'First start',
      'Backups',
      'Cloudflare Pages',
      'Rollback',
    ]) {
      expect(runbook, `docs/30 has no "${heading}" section`).toContain(heading)
    }
    // Ordering that matters: DNS before the first start, because an ACME challenge against a name
    // that does not resolve burns a Let's Encrypt rate-limit slot.
    expect(runbook.indexOf('## 5. DNS')).toBeLessThan(runbook.indexOf('## 6. First start'))
    // And the rollback is real: a pinned tag, not "rebuild and hope".
    expect(runbook).toMatch(/DOS_IMAGE=.*sha-/)
    expect(runbook).toMatch(/expand-only/)
  })

  it('DEP-08 says bootstrap, never the dev seed, and says why', () => {
    expect(runbook).toMatch(/run --rm app bootstrap/)
    expect(runbook).toMatch(/Never `pnpm db:seed`/)
    expect(runbook).toMatch(/Dos@1234/)
  })

  it('DEP-08 carries the founder’s go-live gate: role election and the one app, website included', () => {
    // docs/22 §8, 2026-09-21. A runbook that publishes seven Pages projects on go-live day would be
    // deploying the thing the founder replaced.
    expect(runbook).toMatch(/role election/i)
    expect(runbook).toMatch(/before.{0,20}go-live/i)
    expect(runbook).toMatch(/dos-app|`dos`/)
    expect(runbook).toMatch(/retired at (that|the) merge/i)
  })

  it('DEP-08 is honest about what has never been run', () => {
    expect(runbook).toMatch(/What has NOT been run/i)
    expect(runbook).toMatch(/`docker build` has never been run/)
    expect(runbook).toMatch(/No `expo export` was run/)
  })
})

describe('DEP-09 docs/26 records what actually changed', () => {
  it('DEP-09 names Oracle, Pages and R2 in place of Lightsail, S3+CloudFront and S3', () => {
    expect(environments).toMatch(/as-built/i)
    expect(environments).toMatch(/Oracle/)
    expect(environments).toMatch(/Cloudflare Pages/)
    expect(environments).toMatch(/R2/)
    expect(environments).toMatch(/2026-09-21/)
    // The superseded plan must still be readable, and must be marked superseded rather than deleted:
    // docs/26 §5 is what the founder agreed to in September and the reasons for leaving it matter.
    expect(environments).toMatch(/Lightsail/)
  })

  it('DEP-09 gives a reason for each substitution, not just the new name', () => {
    const asBuilt = environments.slice(environments.search(/##\s*9\./))
    expect(asBuilt.length, 'docs/26 has no §9').toBeGreaterThan(400)
    // The one that decided everything else: a schema that needs `CREATE ROLE ... BYPASSRLS` cannot
    // live on a managed Postgres that withholds superuser.
    expect(asBuilt).toMatch(/BYPASSRLS/)
    expect(asBuilt).toMatch(/egress|bandwidth/i)
    expect(asBuilt).toMatch(/docs\/30/)
  })

  it('DEP-09 points the all-in-one base URLs at the shape the apps actually read', () => {
    // §7's original table put the prefix inside EXPO_PUBLIC_API_URL. The apps read an origin in
    // EXPO_PUBLIC_API_URL and the prefix separately in EXPO_PUBLIC_API_PREFIX (every app's
    // src/config.ts), which is what pages-deploy.sh sets.
    expect(environments).toMatch(/EXPO_PUBLIC_API_PREFIX/)
  })
})
