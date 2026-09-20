/**
 * DOS-113 — every distributorship showed TWO plans, and for two of the three they disagreed.
 *
 * The plan lives in two columns on purpose (`tenants.plan` is what every service reads,
 * `subscriptions.plan` is what this console edits), and the product keeps them equal wherever it
 * writes either. The seed did not, so a walk read Tarsun as "Pilot" in the header chip and "Pro" in
 * the Subscription block of the SAME page, and Kalyan as "Growth" and "Standard". The seed is fixed
 * in the same change; this is the screen's half of it — the page reads the plan from ONE place, the
 * subscription it is about, and prints it once.
 *
 * Pure rules and the screen's own source: importing the screen in Node would pull in `react-native`
 * and `expo-router`, which resolve only under Metro (the pattern the owner app's guard specs use).
 */
import { describe, expect, it } from 'vitest'

import { planShown } from './plan'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('DOS-113: one plan per distributorship', () => {
  it('reads the plan from the subscription, and falls back to the tenant row only when there is none', () => {
    expect(planShown({ plan: 'pilot', subscription: { plan: 'pro' } })).toBe('pro')
    expect(planShown({ plan: 'growth', subscription: { plan: 'standard' } })).toBe('standard')
    expect(planShown({ plan: 'starter', subscription: null })).toBe('starter')
  })

  it('is printed ONCE on a distributorship’s page: the chip, and nothing beside it', async () => {
    const code = withoutComments(await read('../../app/distributors/[id].tsx'))

    // One reading, through the one rule.
    expect(code.match(/planShown\(/g) ?? []).toHaveLength(1)
    // …and no second one: neither the raw tenant column nor the subscription's own plan field.
    expect(code).not.toMatch(/word\(item\.plan\)/)
    expect(code).not.toMatch(/item\.subscription\.plan/)
  })
})
