import { Controller, Get, Module, UnauthorizedException, UseGuards } from '@nestjs/common'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AUTH_ALG,
  AUTH_AUDIENCE,
  AUTH_ISSUER,
  generateAuthKeys,
  loadAuthKeys,
  type AuthKeys,
} from '../../platform/index.js'
import {
  bearer,
  bootTestApp,
  signTestToken,
  TEST_DEVICE_ID,
  TEST_SESSION_ID,
} from '../../testing/app.js'
import {
  createTokenVerifier,
  currentAccessClaims,
  TenantGuard,
  type TokenVerifier,
} from './tenant.guard.js'

const actor = {
  tenantId: '00000000-0000-7000-8000-000000000001',
  actorId: '00000000-0000-7000-8000-000000000002',
  role: 'owner' as const,
}

describe('TenantGuard token verifier', () => {
  let keys: AuthKeys
  let verifier: TokenVerifier

  beforeAll(async () => {
    keys = await loadAuthKeys()
    verifier = createTokenVerifier(keys)
  })

  const sign = async (
    claims: Record<string, unknown>,
    edit: (jwt: SignJWT) => SignJWT = (jwt) => jwt,
    header: Record<string, unknown> = { alg: AUTH_ALG, kid: keys.kid },
  ): Promise<string> => {
    if (!keys.privateKey) throw new Error('no private key in test env')
    const now = Math.floor(Date.now() / 1000)
    const base = new SignJWT(claims)
      .setProtectedHeader(header as { alg: string })
      .setSubject(actor.actorId)
      .setIssuer(AUTH_ISSUER)
      .setAudience(AUTH_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
    return edit(base).sign(keys.privateKey)
  }
  const good = { tid: actor.tenantId, role: 'owner', sid: TEST_SESSION_ID, did: TEST_DEVICE_ID }
  const rejects = (token: string, message: string): void => {
    let caught: unknown
    try {
      verifier.verify(token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(UnauthorizedException)
    expect((caught as UnauthorizedException).message).toBe(message)
  }

  it('accepts a token signed the way auth-service signs it and returns its claims', async () => {
    const claims = verifier.verify(await signTestToken(actor))
    expect(claims).toMatchObject({
      sub: actor.actorId,
      tid: actor.tenantId,
      role: 'owner',
      sid: TEST_SESSION_ID,
      did: TEST_DEVICE_ID,
    })
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/)
    expect(claims.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('accepts a pre-tenant token (no tid, no role) and an audience given as an array', async () => {
    const pre = verifier.verify(await signTestToken(actor, { withoutTenant: true }))
    expect(pre.tid).toBeNull()
    expect(pre.role).toBeNull()
    const arr = await sign(good, (jwt) => jwt.setAudience([AUTH_AUDIENCE, 'other']))
    expect(verifier.verify(arr).role).toBe('owner')
  })

  it('tolerates 30 seconds of clock skew on exp and nbf, no more', async () => {
    const now = Math.floor(Date.now() / 1000)
    const justExpired = await sign(good, (jwt) => jwt.setExpirationTime(now - 20))
    expect(verifier.verify(justExpired).sub).toBe(actor.actorId)
    const expired = await sign(good, (jwt) => jwt.setExpirationTime(now - 45))
    rejects(expired, 'token expired')
    const soon = await sign(good, (jwt) => jwt.setNotBefore(now + 20))
    expect(verifier.verify(soon).sub).toBe(actor.actorId)
    const tooSoon = await sign(good, (jwt) => jwt.setNotBefore(now + 45))
    rejects(tooSoon, 'sign in required')
  })

  it('refuses the wrong issuer, audience, algorithm, key id and a missing exp', async () => {
    rejects(await sign(good, (jwt) => jwt.setIssuer('someone-else')), 'sign in required')
    rejects(await sign(good, (jwt) => jwt.setAudience('other')), 'sign in required')
    rejects(
      await sign(good, (jwt) => jwt, { alg: AUTH_ALG, kid: 'not-our-key' }),
      'sign in required',
    )
    // A header claiming a different algorithm must not get through even though the bytes are signed.
    const [, payload, signature] = (await sign(good)).split('.')
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    rejects(`${noneHeader}.${payload}.${signature}`, 'sign in required')
    rejects(`${noneHeader}.${payload}.`, 'sign in required')
    const epochExp = await sign(good, (jwt) => jwt.setExpirationTime(0))
    // jose refuses exp = 0 as "in the past" only at verify time; our verifier calls it expired.
    rejects(epochExp, 'token expired')
  })

  it('refuses a tampered payload and a token signed with another key pair', async () => {
    const [header, , signature] = (await sign(good)).split('.')
    const forged = Buffer.from(
      JSON.stringify({
        ...good,
        sub: actor.actorId,
        iss: AUTH_ISSUER,
        aud: AUTH_AUDIENCE,
        role: 'manager',
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString('base64url')
    rejects(`${header}.${forged}.${signature}`, 'sign in required')

    const other = await generateAuthKeys()
    const { importJWK } = await import('jose')
    const otherPrivate = (await importJWK(other.privateJwk, AUTH_ALG)) as CryptoKey
    const now = Math.floor(Date.now() / 1000)
    const foreign = await new SignJWT(good)
      .setProtectedHeader({ alg: AUTH_ALG, kid: keys.kid })
      .setSubject(actor.actorId)
      .setIssuer(AUTH_ISSUER)
      .setAudience(AUTH_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(otherPrivate)
    rejects(foreign, 'sign in required')
  })

  it('refuses malformed claims: no sid, unknown role, a role without a tenant or a tenant without a role', async () => {
    rejects(await sign({ ...good, sid: undefined }), 'sign in required')
    rejects(await sign({ ...good, role: 'curator' }), 'sign in required')
    rejects(await sign({ ...good, tid: undefined }), 'sign in required')
    rejects(await sign({ ...good, role: undefined }), 'sign in required')
    rejects('garbage', 'sign in required')
    rejects('a.b.c', 'sign in required')
  })
})

/** Routes that exist only here: one outside the contract, one that is public in the matrix. */
@Controller()
@UseGuards(TenantGuard)
class ProbeController {
  @Get('/not-in-the-contract')
  undeclared(): { ok: boolean } {
    return { ok: true }
  }

  @Get('/health/ping')
  publicRoute(): { ok: boolean } {
    return { ok: true }
  }

  @Get('/tenancy/me')
  claims(): { sub: string; sid: string; tid: string | null } {
    const c = currentAccessClaims()
    return { sub: c.sub, sid: c.sid, tid: c.tid }
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('TenantGuard route resolution', () => {
  let app: Awaited<ReturnType<typeof bootTestApp>>
  beforeAll(async () => {
    app = await bootTestApp([ProbeModule])
  })
  afterAll(async () => {
    await app.close()
  })

  it('fails closed with 500 for a handler that has no permission entry, even for a valid owner token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/not-in-the-contract',
      headers: await bearer(actor),
    })
    expect(res.statusCode).toBe(500)
    expect(res.json<{ message: string }>().message).toMatch(/no permission entry/)
  })

  it('lets a public procedure through without any token', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ping' })
    expect(res.statusCode).toBe(200)
  })

  it('makes the verified claims available to the handler through currentAccessClaims()', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/tenancy/me',
      headers: await bearer(actor),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sub: actor.actorId, sid: TEST_SESSION_ID, tid: actor.tenantId })
  })
})
