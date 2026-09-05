import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ALLOWED_CONTENT_TYPES,
  assertTenantKey,
  createObjectStorage,
  objectKey,
  ObjectStorageError,
  presignS3,
  sigv4SigningKey,
  verifyLocalObjectUrl,
} from './object-storage.js'

const TENANT = '01a06c945a6c752aab3c65716a47362f'
const OTHER_TENANT = '01a06c945a6c752aab3c65716a473999'

describe('object storage — local driver', () => {
  let dir: string
  let env: NodeJS.ProcessEnv

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dos-object-storage-'))
    env = {
      NODE_ENV: 'test',
      OBJECT_STORAGE_DRIVER: 'local',
      OBJECT_STORAGE_DIR: dir,
      OBJECT_STORAGE_SIGNING_SECRET: 'spec-secret',
    }
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const key = (): string =>
    objectKey({
      tenantId: TENANT,
      domain: 'invoices',
      entityId: '01a06c945a6c752aab3c65716a470001',
      name: 'invoice-original',
      ext: 'pdf',
    })

  it('builds the canonical tenant-scoped key', () => {
    expect(key()).toBe(
      `tenant/${TENANT}/invoices/01a06c945a6c752aab3c65716a470001/invoice-original.pdf`,
    )
  })

  it('round trips put -> get -> delete, and a missing key is not_found', async () => {
    const storage = createObjectStorage(env)
    const body = Buffer.from('%PDF-1.7 pretend invoice')
    await storage.put(key(), body, 'application/pdf')

    const read = await storage.get(key())
    expect(read.equals(body)).toBe(true)

    await storage.delete(key())
    await expect(storage.get(key())).rejects.toMatchObject({ code: 'not_found' })

    // delete is idempotent: a second delete of a gone object is not an error
    await expect(storage.delete(key())).resolves.toBeUndefined()
    await expect(storage.get(`tenant/${TENANT}/invoices/nope/missing.pdf`)).rejects.toBeInstanceOf(
      ObjectStorageError,
    )
  })

  it('putUrl is inline with no URL, because there is nothing to pre-sign locally', async () => {
    const storage = createObjectStorage(env)
    const result = await storage.putUrl(key(), { mimeType: 'application/pdf', bytes: 1024 })
    expect(result).toMatchObject({ url: null, method: null, inline: true, headers: {} })
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('getUrl signs a URL that verifies, and rejects a tampered one', async () => {
    const now = new Date('2026-09-05T10:00:00.000Z')
    const storage = createObjectStorage(env, { now: () => now })
    const url = new URL(await storage.getUrl(key(), 600), 'http://localhost')

    const expires = Number(url.searchParams.get('expires'))
    const signature = url.searchParams.get('signature') ?? ''
    expect(url.pathname).toBe(`/storage/${key()}`)
    expect(expires).toBe(Math.floor(now.getTime() / 1000) + 600)

    expect(verifyLocalObjectUrl({ key: key(), expires, signature }, env, now)).toBe(true)
    // a different key with the same signature, an edited signature, and an expired stamp all fail
    expect(
      verifyLocalObjectUrl(
        { key: `tenant/${OTHER_TENANT}/invoices/x/y.pdf`, expires, signature },
        env,
        now,
      ),
    ).toBe(false)
    expect(
      verifyLocalObjectUrl(
        { key: key(), expires, signature: signature.replace(/.$/, '0') },
        env,
        now,
      ),
    ).toBe(false)
    expect(
      verifyLocalObjectUrl(
        { key: key(), expires, signature },
        env,
        new Date('2026-09-06T10:00:00Z'),
      ),
    ).toBe(false)
  })
})

describe('object storage — key and content guards', () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    OBJECT_STORAGE_DRIVER: 'local',
    OBJECT_STORAGE_DIR: '/tmp/dos-object-storage-guards',
    OBJECT_STORAGE_SIGNING_SECRET: 'spec-secret',
  }
  const storage = createObjectStorage(env)
  const good = `tenant/${TENANT}/pod/01a06c945a6c752aab3c65716a470002/photo.jpg`

  it('refuses a key that escapes its tenant prefix', () => {
    expect(() => {
      assertTenantKey(`tenant/${OTHER_TENANT}/pod/x/photo.jpg`, TENANT)
    }).toThrow(ObjectStorageError)
    expect(() => {
      assertTenantKey(`tenant/${TENANT}/../${OTHER_TENANT}/pod/x/photo.jpg`, TENANT)
    }).toThrow(/illegal object key segment/)
    expect(() => {
      assertTenantKey(`/etc/passwd`, TENANT)
    }).toThrow(ObjectStorageError)
    expect(() => {
      assertTenantKey(`tenant/${TENANT}/pod/x/..\\..\\secret.jpg`, TENANT)
    }).toThrow(ObjectStorageError)
    // the canonical form and the bare `{tenantId}/…` form both pass
    expect(() => {
      assertTenantKey(good, TENANT)
    }).not.toThrow()
    expect(() => {
      assertTenantKey(`${TENANT}/pod/x/photo.jpg`, TENANT)
    }).not.toThrow()
  })

  it('refuses a path traversal at the driver even if it reached one', async () => {
    await expect(storage.get('tenant/../../etc/passwd')).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })

  it('refuses a content type that is not on the allow-list', async () => {
    await expect(
      storage.putUrl(`tenant/${TENANT}/docs/x/payload.exe`, {
        mimeType: 'application/x-msdownload',
        bytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'invalid_content_type' })
    await expect(
      storage.put(`tenant/${TENANT}/docs/x/notes.txt`, Buffer.from('hi'), 'text/plain'),
    ).rejects.toMatchObject({ code: 'invalid_content_type' })
    // right mime, wrong extension on the key
    await expect(
      storage.putUrl(`tenant/${TENANT}/docs/x/sheet.csv`, {
        mimeType: 'application/pdf',
        bytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'invalid_content_type' })
  })

  it('refuses an oversize object, before any byte is sent', async () => {
    const limit = ALLOWED_CONTENT_TYPES['image/jpeg']?.maxBytes ?? 0
    await expect(
      storage.putUrl(good, { mimeType: 'image/jpeg', bytes: limit + 1 }),
    ).rejects.toMatchObject({ code: 'too_large' })
    await expect(storage.putUrl(good, { mimeType: 'image/jpeg', bytes: 0 })).rejects.toMatchObject({
      code: 'too_large',
    })
    await expect(
      storage.putUrl(good, { mimeType: 'image/jpeg', bytes: limit }),
    ).resolves.toMatchObject({ inline: true })
  })
})

describe('object storage — s3 driver signing', () => {
  /**
   * AWS publishes the signing key for (secret wJalrX…, 20120215, us-east-1, iam) as a fixed hex
   * string in "Examples of how to derive a signing key for Signature Version 4". Pinning it here
   * proves the four-HMAC chain independently of anything else in this file.
   */
  it('derives the AWS reference signing key', () => {
    expect(
      sigv4SigningKey(
        'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        '20120215',
        'us-east-1',
        'iam',
      ).toString('hex'),
    ).toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d')
  })

  /**
   * AWS's own published Signature Version 4 example for a pre-signed GET (query-string
   * authentication, `examplebucket/test.txt`, 2013-05-24, 24 hours). The canonical request's
   * SHA-256 — `3bfa2928…` — is the constant printed in those docs, so asserting it proves this
   * implementation builds AWS's canonical request byte for byte. With that hash and the signing key
   * above both pinned to published constants, the final signature is arithmetic; it is asserted so
   * any future edit that changes signing shows up as a failing test, with no network call.
   */
  it('reproduces the AWS reference presigned GET canonical request for a fixed clock', () => {
    const result = presignS3({
      method: 'GET',
      endpoint: 'https://examplebucket.s3.amazonaws.com',
      key: 'test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      expiresIn: 86400,
      now: new Date('2013-05-24T00:00:00.000Z'),
    })

    expect(result.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
        'host:examplebucket.s3.amazonaws.com\n',
        'host',
        'UNSIGNED-PAYLOAD',
      ].join('\n'),
    )
    expect(result.stringToSign).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20130524T000000Z',
        '20130524/us-east-1/s3/aws4_request',
        '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04',
      ].join('\n'),
    )
    expect(result.signature).toBe(
      '3ed0be64024db54d5574a27da223529635c383f911f80e636f0ccc13890053d2',
    )
    expect(result.url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=3ed0be64024db54d5574a27da223529635c383f911f80e636f0ccc13890053d2',
    )
  })

  it('mints a pre-signed PUT with the right shape and a session token when present', async () => {
    const now = new Date('2026-09-05T06:30:00.000Z')
    const storage = createObjectStorage(
      {
        NODE_ENV: 'test',
        OBJECT_STORAGE_DRIVER: 's3',
        OBJECT_STORAGE_S3_BUCKET: 'dos-pilot',
        OBJECT_STORAGE_S3_REGION: 'ap-south-1',
        OBJECT_STORAGE_S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        OBJECT_STORAGE_S3_SESSION_TOKEN: 'session-token',
      },
      { now: () => now },
    )
    const key = `tenant/${TENANT}/invoices/01a06c945a6c752aab3c65716a470003/invoice.pdf`
    const result = await storage.putUrl(key, {
      mimeType: 'application/pdf',
      bytes: 4096,
      ttlSeconds: 300,
    })

    expect(result.inline).toBe(false)
    expect(result.method).toBe('PUT')
    expect(result.headers).toEqual({ 'content-type': 'application/pdf' })
    expect(result.expiresAt).toBe('2026-09-05T06:35:00.000Z')

    const url = new URL(result.url ?? '')
    expect(url.origin).toBe('https://dos-pilot.s3.ap-south-1.amazonaws.com')
    expect(url.pathname).toBe(`/${key}`)
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260905T063000Z')
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20260905/ap-south-1/s3/aws4_request',
    )
    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('session-token')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)

    // the same signing is deterministic for the same clock
    const again = await storage.putUrl(key, {
      mimeType: 'application/pdf',
      bytes: 4096,
      ttlSeconds: 300,
    })
    expect(again.url).toBe(result.url)
  })

  it('refuses to build an s3 driver with no credentials', () => {
    expect(() => createObjectStorage({ NODE_ENV: 'test', OBJECT_STORAGE_DRIVER: 's3' })).toThrow(
      /OBJECT_STORAGE_S3_BUCKET/,
    )
  })

  it('refuses an unknown driver', () => {
    expect(() => createObjectStorage({ OBJECT_STORAGE_DRIVER: 'gdrive' })).toThrow(
      /unknown OBJECT_STORAGE_DRIVER/,
    )
  })
})
