import { inspect } from 'node:util'
import { ORPCError, ValidationError } from '@orpc/server'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServiceApp } from './bootstrap.js'
import { authServiceDefinition } from './definitions.js'
import { describeFailure, logServiceError } from './error-log.js'

/**
 * NOTHING A CALLER SENT IS WRITTEN TO THE SERVICE'S LOG (DOS-429; blind check of the shopkeeper's sign-up, B1).
 *
 * A real service, built by `createServiceApp` exactly as `main.ts` builds it — so with the `onError` interceptor the
 * spec harness leaves out — is sent a sign-up and a sign-in that fail the input schema, each carrying a password no
 * one else knows. Everything the process writes through `console.error` (and `console.log` / `console.warn`, in case
 * the logger ever moves) is read back: the refusal is there, in one line, and the password, the number and the name
 * are not.
 */
describe('the service log keeps nothing a caller sent', () => {
  let app: NestFastifyApplication
  const written: string[] = []
  const capture = (...args: unknown[]): void => {
    written.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 12 }))).join(' '))
  }

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(capture)
    vi.spyOn(console, 'warn').mockImplementation(capture)
    vi.spyOn(console, 'log').mockImplementation(capture)
    app = await createServiceApp(authServiceDefinition, { logger: false })
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await app.close()
  })

  const marker = (): string => `Secret${String(Date.now()).slice(-6)}x9`

  it('logs a sign-up that fails the schema as one line, without its password, number or name', async () => {
    const password = marker()
    const phone = '+919000000123'
    const name = 'Markername Onlyhere'
    written.length = 0
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      headers: { 'content-type': 'application/json' },
      // No deviceId and a one-letter shop name: refused by the schema, before any handler runs.
      payload: JSON.stringify({
        id: uuidv7(),
        phone,
        username: 'ravi.kumar',
        password,
        name,
        shopName: 'X',
      }),
    })
    expect(res.statusCode).toBe(400)
    const log = written.join('\n')
    expect(log).not.toContain(password)
    expect(log).not.toContain(phone)
    expect(log).not.toContain('Markername')
    expect(log).toContain('400 BAD_REQUEST')
    expect(log).toContain('deviceId')
  })

  it('logs a sign-in that fails the schema without its password (DOS-429)', async () => {
    const password = marker()
    written.length = 0
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'ravi kumar', password }),
    })
    expect(res.statusCode).toBe(400)
    const log = written.join('\n')
    expect(log).not.toContain(password)
    expect(log).not.toContain('ravi kumar')
    expect(log).toContain('400 BAD_REQUEST')
  })

  it('keeps a failure’s stack and drops the validated data and every secret-named value', () => {
    const lines: unknown[] = []
    const secret = marker()
    const failure = new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Output validation failed',
      cause: new ValidationError({
        message: 'Output validation failed',
        issues: [{ message: 'Invalid input', path: ['user', 'phone'] }],
        data: { user: { phone: '+919000000124', password: secret } },
      }),
    })
    logServiceError(failure, (...args) => lines.push(...args))
    const text = inspect(lines, { depth: 12 })
    expect(text).toContain('Output validation failed')
    expect(text).toContain('user.phone: Invalid input')
    expect(text).not.toContain(secret)
    expect(text).not.toContain('+919000000124')

    const withData = describeFailure(
      new ORPCError('INTERNAL_SERVER_ERROR', {
        data: { refreshToken: secret, nested: { apiKey: secret, count: 3 } },
      }),
    )
    const shown = inspect(withData, { depth: 12 })
    expect(shown).not.toContain(secret)
    expect(shown).toContain('count: 3')
    expect(shown).toContain('stack')
  })
})
