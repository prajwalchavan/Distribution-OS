import { describe, expect, it } from 'vitest'
import { ALL_ROLES } from '@dos/contracts'
import type { ServiceDefinition } from '../service/define.js'
import { renderAppReadme, renderServiceReadme } from './readme.js'

/** Minimal fixture: one public endpoint (health.ping) plus a mix of role-gated ones (tenancy.*). */
const ownerLike: ServiceDefinition = {
  name: 'owner',
  title: 'Owner service',
  defaultPort: 3001,
  roles: ['owner'],
  modules: [],
  contractKeys: ['health', 'tenancy'],
}

/** Public-only fixture, to check nothing auth-shaped leaks in when nothing needs a token. */
const healthOnly: ServiceDefinition = {
  name: 'health-check',
  title: 'Health-only test service',
  defaultPort: 9001,
  roles: ['owner'],
  modules: [],
  contractKeys: ['health'],
}

/** Serves the whole back office, so an endpoint can exclude one of its OWN served roles. */
const backOfficeLike: ServiceDefinition = {
  name: 'manager',
  title: 'Manager service',
  defaultPort: 3002,
  roles: ['owner', 'manager', 'accountant'],
  modules: [],
  contractKeys: ['health', 'tenancy'],
}

/** Serves every membership role, the way auth-service itself must. */
const authLike: ServiceDefinition = {
  name: 'auth',
  title: 'Auth service',
  defaultPort: 3000,
  roles: [...ALL_ROLES],
  modules: [],
  contractKeys: ['health', 'auth'],
}

describe('renderServiceReadme', () => {
  it('is deterministic (CI compares the generated file byte for byte)', () => {
    expect(renderServiceReadme(ownerLike)).toBe(renderServiceReadme(ownerLike))
  })

  it('puts a Sign in section right after the intro, before Run', () => {
    const md = renderServiceReadme(ownerLike)
    const signIn = md.indexOf('## Sign in')
    const run = md.indexOf('## Run')
    expect(signIn).toBeGreaterThan(0)
    expect(run).toBeGreaterThan(signIn)
  })

  it('describes the full login/refresh/logout flow for auth-service itself', () => {
    const md = renderServiceReadme(authLike)
    const signInSection = md.slice(md.indexOf('## Sign in'), md.indexOf('## Run'))
    expect(signInSection).toContain('POST /auth/login')
    expect(signInSection).toContain('accessToken')
    expect(signInSection).toContain('refreshToken')
    expect(signInSection).toContain('rotates')
    expect(signInSection).toContain('/auth/refresh')
  })

  it('points every other service at auth-service:3000 for a token', () => {
    const md = renderServiceReadme(ownerLike)
    const signInSection = md.slice(md.indexOf('## Sign in'), md.indexOf('## Run'))
    expect(signInSection).toContain('auth-service')
    expect(signInSection).toContain('POST http://localhost:3000/auth/login')
    expect(signInSection).toContain('Authorization: Bearer')
  })

  it('adds a Roles column to the endpoint index, filled from the permission table', () => {
    const md = renderServiceReadme(ownerLike)
    expect(md).toContain('| Method | Path | What it does | Roles |')
    expect(md).toMatch(
      /\| GET \| `\/tenancy\/me` \| [^|]+\| owner, manager, accountant, salesperson, warehouse, delivery, retailer \|/,
    )
    expect(md).toMatch(/\| GET \| `\/health\/ping` \| [^|]+\| public \|/)
  })

  it('shows Authorization: Bearer on a role-gated sample request', () => {
    const md = renderServiceReadme(ownerLike)
    const meSection = md.slice(
      md.indexOf('### GET `/tenancy/me`'),
      md.indexOf('### GET `/tenancy/staff`'),
    )
    expect(meSection).toContain('**Roles:** owner, manager, accountant, salesperson')
    expect(meSection).toContain('Authorization: Bearer eyJhbGciOiJFZERTQSIs')
  })

  it('never shows an Authorization header on a sample or a role-403 for a public-only service', () => {
    const md = renderServiceReadme(healthOnly)
    // Skip the boilerplate "Sign in" prose, which mentions the header in general terms even when
    // this particular fixture happens to expose no protected endpoint.
    const afterIntro = md.slice(md.indexOf('## Run'))
    expect(afterIntro).not.toContain('Authorization: Bearer')
    expect(afterIntro).not.toContain('may not call')
  })

  it('gives a "service does not serve" 403 on a single-role service (requireServed runs first)', () => {
    // ownerLike serves only 'owner'; tenancy.staff.create (ONBOARDERS = owner, manager) never
    // excludes the one role this service does serve, so the only real 403 is service-scope.
    const md = renderServiceReadme(ownerLike)
    const staffCreateSection = md.slice(
      md.indexOf('### POST `/tenancy/staff`'),
      md.indexOf('### POST `/tenancy/staff/set-password`'),
    )
    expect(staffCreateSection).toContain('401 —')
    expect(staffCreateSection).toMatch(/owner-service does not serve the \w+ role/)
    expect(staffCreateSection).not.toContain('may not call')
  })

  it('gives a "role may not call" 403 when the excluded role IS served by this service', () => {
    // backOfficeLike serves owner, manager, accountant; tenancy.staff.create is owner/manager only,
    // so 'accountant' is served by this service yet refused by this specific endpoint.
    const md = renderServiceReadme(backOfficeLike)
    const staffCreateSection = md.slice(
      md.indexOf('### POST `/tenancy/staff`'),
      md.indexOf('### POST `/tenancy/staff/set-password`'),
    )
    expect(staffCreateSection).toContain('the accountant role may not call POST /tenancy/staff')
  })

  it('ends with a compact permission matrix listing every procedure and all seven role columns', () => {
    const md = renderServiceReadme(ownerLike)
    expect(md).toContain('## Permission matrix')
    expect(md).toContain('| Procedure | O | M | A | S | W | D | R |')
    expect(md).toContain('`health.ping`')
    expect(md).toContain('`tenancy.me`')
    expect(md).toContain('`tenancy.staff.list`')
  })

  it('marks a matrix cell refused when this service does not serve that role, even if the permission table allows it', () => {
    // tenancy.me is ANY_MEMBER (every role), but ownerLike only serves 'owner'.
    const md = renderServiceReadme(ownerLike)
    const matrix = md.slice(md.indexOf('## Permission matrix'))
    const meRow = matrix.split('\n').find((l) => l.includes('`tenancy.me`'))
    expect(meRow).toBeDefined()
    const cells = meRow!
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)
    expect(cells[0]).toBe('`tenancy.me`')
    expect(cells[1]).toBe('✓') // owner: served, and allowed
    expect(cells[2]).toBe('–') // manager: allowed by the matrix, but this service does not serve it
  })

  it('marks every column public-open for health.ping', () => {
    const md = renderServiceReadme(ownerLike)
    const matrix = md.slice(md.indexOf('## Permission matrix'))
    const pingRow = matrix.split('\n').find((l) => l.includes('`health.ping`'))
    const cells = pingRow!
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)
    expect(cells.slice(1)).toEqual(['✓', '✓', '✓', '✓', '✓', '✓', '✓'])
  })
})

describe('renderAppReadme', () => {
  const app = {
    name: '@dos/owner-app',
    title: 'Owner app',
    blurb: 'Test blurb for the owner app.',
    service: ownerLike,
    run: 'pnpm --filter @dos/owner-app dev',
    env: 'VITE_API_URL',
    screens: ['Dashboard'],
  }

  it('is deterministic', () => {
    expect(renderAppReadme(app)).toBe(renderAppReadme(app))
  })

  it('has a Sign in paragraph naming auth-service and the Bearer header', () => {
    const md = renderAppReadme(app)
    expect(md).toContain('## Sign in')
    const signIn = md.slice(md.indexOf('## Sign in'), md.indexOf('## Run'))
    expect(signIn).toContain('auth-service')
    expect(signIn).toContain('Authorization: Bearer')
    expect(signIn).toContain('refresh token')
  })

  it('adds a Roles column to the endpoint table it uses', () => {
    const md = renderAppReadme(app)
    expect(md).toContain('| Method | Path | Used for | Roles |')
    expect(md).toMatch(/\| GET \| `\/tenancy\/me` \| [^|]+\| owner, manager,/)
  })
})
