import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * Object storage for every module that keeps a file: invoice and challan PDFs, POD photos, expense
 * proofs, document-intelligence page images, claim evidence, statements, imports and exports
 * (docs/plans/00-coordination.md §3.3). Built once, here, so nobody writes a second one.
 *
 * These are PLAIN FUNCTIONS, not an `@Injectable`. The pg-boss worker imports `@dos/core/platform`
 * and runs under tsx, which emits no `design:paramtypes`; a Nest service instantiated there would
 * silently receive `undefined` dependencies (CLAUDE.md, "Decorator metadata").
 *
 * Two drivers behind `OBJECT_STORAGE_DRIVER`:
 *
 * - `local` (the default, and the only one that works on the founder's Mac today): bytes land under
 *   `OBJECT_STORAGE_DIR` (default `backend/.storage`, git-ignored). `putUrl()` answers
 *   `{ url: null, inline: true }`, meaning "there is no pre-signed PUT here — send the bytes on the
 *   create call and the service will `put()` them". `getUrl()` answers an HMAC-signed relative URL a
 *   service can serve after checking it with `verifyLocalObjectUrl()`.
 * - `s3`: pre-signed PUT and GET, SigV4 signed here with `node:crypto`. No AWS SDK: a pre-signed URL
 *   is a query string, and the whole of SigV4 for one is below in `presignS3`.
 *
 * Nothing binary ever streams through a service (docs/20 rule 3): a caller either uploads straight to
 * S3 with the pre-signed URL, or hands the bytes to one create call on the local driver.
 */

/** The one key convention, fixed in coordination §3.3: `tenant/{tenantId}/{domain}/{entityId}/{name}.{ext}`. */
export const OBJECT_DOMAINS = [
  'docs',
  'invoices',
  'challans',
  'pod',
  'claims',
  'exports',
  'statements',
] as const

export type ObjectDomain = (typeof OBJECT_DOMAINS)[number]

export type ObjectStorageErrorCode =
  'invalid_key' | 'invalid_content_type' | 'too_large' | 'not_found' | 'not_configured' | 'upstream'

/**
 * Business faults from storage. Deliberately NOT an `ORPCError`: the worker imports this file and must
 * not pull the oRPC runtime in. Controllers map `not_found` to 404, `not_configured`/`upstream` to 500
 * and everything else to 400.
 */
export class ObjectStorageError extends Error {
  constructor(
    readonly code: ObjectStorageErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ObjectStorageError'
  }
}

/**
 * The allow-list. A caller may only store what is on it, at or under the size on it — no executables,
 * no archives, no "application/octet-stream" catch-all. Sizes are the largest a single row of the
 * owning table has any business holding, not a guess at the network.
 */
const MB = 1024 * 1024

export const ALLOWED_CONTENT_TYPES: Readonly<
  Record<string, { extensions: readonly string[]; maxBytes: number }>
> = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], maxBytes: 15 * MB },
  'image/png': { extensions: ['png'], maxBytes: 15 * MB },
  'image/webp': { extensions: ['webp'], maxBytes: 15 * MB },
  'image/heic': { extensions: ['heic'], maxBytes: 25 * MB },
  'application/pdf': { extensions: ['pdf'], maxBytes: 25 * MB },
  'text/csv': { extensions: ['csv'], maxBytes: 64 * MB },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extensions: ['xlsx'],
    maxBytes: 64 * MB,
  },
  'application/json': { extensions: ['json'], maxBytes: 64 * MB },
}

export interface PutUrlOptions {
  mimeType: string
  bytes: number
  ttlSeconds?: number
}

export interface PutUrlResult {
  /** `null` on the local driver: there is nowhere to PUT, so the caller sends the bytes inline. */
  url: string | null
  method: 'PUT' | null
  headers: Record<string, string>
  expiresAt: string
  inline: boolean
}

export interface ObjectStorage {
  putUrl(key: string, opts: PutUrlOptions): Promise<PutUrlResult>
  getUrl(key: string, ttlSeconds?: number): Promise<string>
  put(key: string, body: Buffer, mimeType: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

export interface ObjectStorageOptions {
  /** Injectable clock — the s3 driver's signatures and both drivers' expiries are time-derived. */
  now?: () => Date
}

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

const KEY_MAX_LENGTH = 512
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** `tenant/{tenantId}/` — the prefix every object of a tenant lives under. */
export function tenantKeyPrefix(tenantId: string): string {
  if (!SEGMENT.test(tenantId))
    throw new ObjectStorageError('invalid_key', `not a usable tenant id: ${tenantId}`)
  return `tenant/${tenantId}/`
}

/** Build the canonical key. Every module uses this rather than assembling a string of its own. */
export function objectKey(i: {
  tenantId: string
  domain: ObjectDomain
  entityId: string
  name: string
  ext: string
}): string {
  if (!OBJECT_DOMAINS.includes(i.domain))
    throw new ObjectStorageError('invalid_key', `unknown storage domain: ${String(i.domain)}`)
  const key = `${tenantKeyPrefix(i.tenantId)}${i.domain}/${i.entityId}/${i.name}.${i.ext}`
  assertObjectKey(key)
  return key
}

/**
 * Shape check, applied on every call of every driver. Rejects absolute paths, `.`/`..` segments,
 * backslashes, empty segments, control characters and anything over 512 bytes — so no key can ever
 * resolve outside the storage root on the local driver or outside its prefix on S3.
 */
export function assertObjectKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0)
    throw new ObjectStorageError('invalid_key', 'object key is empty')
  if (key.length > KEY_MAX_LENGTH)
    throw new ObjectStorageError(
      'invalid_key',
      `object key longer than ${KEY_MAX_LENGTH} characters`,
    )
  if (key.includes('\\') || key.includes('\0'))
    throw new ObjectStorageError('invalid_key', `object key contains an illegal character: ${key}`)
  const segments = key.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || !SEGMENT.test(segment))
      throw new ObjectStorageError(
        'invalid_key',
        `illegal object key segment "${segment}" in ${key}`,
      )
  }
}

/**
 * Tenant scoping. A retailer id in the URL must never reach another distributor's bytes, so every
 * procedure that takes a key from the wire calls this with `currentTenant().tenantId` first.
 *
 * Accepts the canonical `tenant/{tenantId}/…` and the bare `{tenantId}/…` form some briefs describe;
 * both are anchored at the tenant, which is the guarantee. `objectKey()` only ever emits the first.
 */
export function assertTenantKey(key: string, tenantId: string): void {
  assertObjectKey(key)
  if (!SEGMENT.test(tenantId))
    throw new ObjectStorageError('invalid_key', `not a usable tenant id: ${tenantId}`)
  if (key.startsWith(`tenant/${tenantId}/`) || key.startsWith(`${tenantId}/`)) return
  throw new ObjectStorageError(
    'invalid_key',
    `object key ${key} does not belong to tenant ${tenantId}`,
  )
}

function assertContentType(key: string, mimeType: string, bytes: number): void {
  const allowed = ALLOWED_CONTENT_TYPES[mimeType.toLowerCase().split(';')[0]?.trim() ?? '']
  if (!allowed)
    throw new ObjectStorageError(
      'invalid_content_type',
      `content type ${mimeType} is not storable; allowed: ${Object.keys(ALLOWED_CONTENT_TYPES).join(', ')}`,
    )
  const ext = key.includes('.') ? (key.split('.').pop() ?? '').toLowerCase() : ''
  if (ext && !allowed.extensions.includes(ext))
    throw new ObjectStorageError(
      'invalid_content_type',
      `key ${key} ends in .${ext}, which does not match ${mimeType}`,
    )
  if (!Number.isInteger(bytes) || bytes <= 0)
    throw new ObjectStorageError('too_large', `byte count must be a positive integer, got ${bytes}`)
  if (bytes > allowed.maxBytes)
    throw new ObjectStorageError(
      'too_large',
      `${bytes} bytes exceeds the ${allowed.maxBytes} byte limit for ${mimeType}`,
    )
}

// ---------------------------------------------------------------------------------------------
// Local driver
// ---------------------------------------------------------------------------------------------

/** Walk up to the workspace root (the directory holding `pnpm-workspace.yaml`) so every process — a
 *  service started in its own folder, the worker, a spec — resolves the same `backend/.storage`. */
function workspaceRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir)
  for (let hop = 0; hop < 12; hop++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(startDir)
}

const DEV_SIGNING_SECRET = 'dos-local-object-storage-dev-secret'

function localSigningSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.OBJECT_STORAGE_SIGNING_SECRET?.trim()
  if (secret) return secret
  if (env.NODE_ENV === 'production')
    throw new ObjectStorageError(
      'not_configured',
      'OBJECT_STORAGE_SIGNING_SECRET must be set when the local driver runs in production',
    )
  return DEV_SIGNING_SECRET
}

function localSignature(key: string, expires: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${key}\n${String(expires)}`)
    .digest('hex')
}

/**
 * Verify a URL minted by the local driver's `getUrl`. The service that serves `/storage/*` calls this
 * before opening the file; a wrong or expired signature is a 403, never a read.
 */
export function verifyLocalObjectUrl(
  i: { key: string; expires: number; signature: string },
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): boolean {
  if (!Number.isFinite(i.expires) || i.expires * 1000 < now.getTime()) return false
  let expected: string
  try {
    assertObjectKey(i.key)
    expected = localSignature(i.key, i.expires, localSigningSecret(env))
  } catch {
    return false
  }
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(i.signature, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function createLocalStorage(env: NodeJS.ProcessEnv, now: () => Date): ObjectStorage {
  const root = resolve(env.OBJECT_STORAGE_DIR?.trim() || join(workspaceRoot(), '.storage'))
  const base = env.OBJECT_STORAGE_PUBLIC_URL?.trim().replace(/\/$/, '') ?? ''
  const defaultTtl = Number(env.OBJECT_STORAGE_URL_TTL_SECONDS ?? 900)

  /** `assertObjectKey` already forbids `..`; this is the second lock on the same door. */
  const pathFor = (key: string): string => {
    assertObjectKey(key)
    const full = resolve(root, key)
    if (full !== root && !full.startsWith(root + '/'))
      throw new ObjectStorageError('invalid_key', `object key ${key} escapes the storage root`)
    return full
  }

  return {
    async putUrl(key, opts) {
      assertObjectKey(key)
      assertContentType(key, opts.mimeType, opts.bytes)
      const ttl = opts.ttlSeconds ?? defaultTtl
      return {
        url: null,
        method: null,
        headers: {},
        expiresAt: new Date(now().getTime() + ttl * 1000).toISOString(),
        inline: true,
      }
    },
    async getUrl(key, ttlSeconds) {
      assertObjectKey(key)
      const ttl = ttlSeconds ?? defaultTtl
      const expires = Math.floor(now().getTime() / 1000) + ttl
      const signature = localSignature(key, expires, localSigningSecret(env))
      const path = key.split('/').map(encodeURIComponent).join('/')
      return `${base}/storage/${path}?expires=${String(expires)}&signature=${signature}`
    },
    async put(key, body, mimeType) {
      assertContentType(key, mimeType, body.byteLength)
      const full = pathFor(key)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, body)
    },
    async get(key) {
      const full = pathFor(key)
      try {
        return await readFile(full)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT')
          throw new ObjectStorageError('not_found', `no object at ${key}`)
        throw err
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true })
    },
  }
}

// ---------------------------------------------------------------------------------------------
// S3 driver — SigV4 query signing, no SDK
// ---------------------------------------------------------------------------------------------

export interface PresignInput {
  method: 'GET' | 'PUT' | 'DELETE'
  /** Bucket origin, virtual-hosted or S3-compatible, e.g. `https://bucket.s3.ap-south-1.amazonaws.com`. */
  endpoint: string
  key: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string | undefined
  expiresIn: number
  now: Date
  service?: string
}

export interface PresignResult {
  url: string
  canonicalRequest: string
  stringToSign: string
  signature: string
}

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')
const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest()

/**
 * The four-step SigV4 signing key: `HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service),
 * "aws4_request")`. Exported so the spec can pin it against AWS's published derivation vector.
 */
export function sigv4SigningKey(
  secretAccessKey: string,
  shortDate: string,
  region: string,
  service: string,
): Buffer {
  return hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, shortDate), region), service),
    'aws4_request',
  )
}

/** RFC 3986. `encodeURIComponent` leaves `!'()*` alone; AWS wants them percent-encoded. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * Signature Version 4 for a pre-signed S3 URL. Everything AWS needs travels in the query string
 * (`X-Amz-*`) with an unsigned payload, so the browser or the worker uploads with a bare PUT and no
 * credentials of its own. Returns the intermediates as well so a unit test can pin the canonical
 * request and the signature against AWS's own published vector with no network call.
 */
export function presignS3(i: PresignInput): PresignResult {
  const url = new URL(i.endpoint)
  const service = i.service ?? 's3'
  const amzDate = i.now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const shortDate = amzDate.slice(0, 8)
  const scope = `${shortDate}/${i.region}/${service}/aws4_request`
  const prefix = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  const canonicalUri = `${prefix}/${i.key.split('/').map(uriEncode).join('/')}`

  const headers: Record<string, string> = { host: url.host }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]?.trim() ?? ''}\n`)
    .join('')

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${i.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(i.expiresIn),
    'X-Amz-SignedHeaders': signedHeaders,
  }
  if (i.sessionToken) query['X-Amz-Security-Token'] = i.sessionToken
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k] ?? '')}`)
    .join('&')

  const canonicalRequest = [
    i.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = sigv4SigningKey(i.secretAccessKey, shortDate, i.region, service)
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  return {
    url: `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    canonicalRequest,
    stringToSign,
    signature,
  }
}

interface S3Config {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string | undefined
}

function s3Config(env: NodeJS.ProcessEnv): S3Config {
  const bucket = env.OBJECT_STORAGE_S3_BUCKET?.trim()
  const region = env.OBJECT_STORAGE_S3_REGION?.trim() || 'ap-south-1'
  const accessKeyId = (env.OBJECT_STORAGE_S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID)?.trim()
  const secretAccessKey = (
    env.OBJECT_STORAGE_S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY
  )?.trim()
  const sessionToken = (env.OBJECT_STORAGE_S3_SESSION_TOKEN ?? env.AWS_SESSION_TOKEN)?.trim()
  const endpoint =
    env.OBJECT_STORAGE_S3_ENDPOINT?.trim() ||
    (bucket ? `https://${bucket}.s3.${region}.amazonaws.com` : '')
  if (!endpoint || !accessKeyId || !secretAccessKey)
    throw new ObjectStorageError(
      'not_configured',
      'OBJECT_STORAGE_DRIVER=s3 needs OBJECT_STORAGE_S3_BUCKET (or _ENDPOINT), an access key id and a secret access key',
    )
  return { endpoint, region, accessKeyId, secretAccessKey, sessionToken }
}

function createS3Storage(env: NodeJS.ProcessEnv, now: () => Date): ObjectStorage {
  // Read once, at construction, so a misconfigured deployment fails at boot rather than on the first
  // upload of the day.
  const config = s3Config(env)
  const defaultTtl = Number(env.OBJECT_STORAGE_URL_TTL_SECONDS ?? 900)
  const sign = (key: string, method: PresignInput['method'], ttl: number): string =>
    presignS3({ ...config, method, key, expiresIn: ttl, now: now() }).url

  const send = async (
    key: string,
    method: PresignInput['method'],
    init?: RequestInit,
  ): Promise<Response> => {
    assertObjectKey(key)
    const res = await fetch(sign(key, method, 60), { method, ...init })
    if (res.status === 404) throw new ObjectStorageError('not_found', `no object at ${key}`)
    if (!res.ok)
      throw new ObjectStorageError(
        'upstream',
        `object storage answered ${String(res.status)} for ${method} ${key}`,
      )
    return res
  }

  return {
    async putUrl(key, opts) {
      assertObjectKey(key)
      assertContentType(key, opts.mimeType, opts.bytes)
      const ttl = opts.ttlSeconds ?? defaultTtl
      return {
        url: sign(key, 'PUT', ttl),
        method: 'PUT',
        headers: { 'content-type': opts.mimeType },
        expiresAt: new Date(now().getTime() + ttl * 1000).toISOString(),
        inline: false,
      }
    },
    async getUrl(key, ttlSeconds) {
      assertObjectKey(key)
      return sign(key, 'GET', ttlSeconds ?? defaultTtl)
    },
    async put(key, body, mimeType) {
      assertContentType(key, mimeType, body.byteLength)
      await send(key, 'PUT', {
        body: new Uint8Array(body),
        headers: { 'content-type': mimeType },
      })
    },
    async get(key) {
      const res = await send(key, 'GET')
      return Buffer.from(await res.arrayBuffer())
    },
    async delete(key) {
      await send(key, 'DELETE')
    },
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * The single entry point. `OBJECT_STORAGE_DRIVER=local` (the default) needs no cloud account of any
 * kind, which is what makes the whole product runnable on one Mac with no Docker.
 */
export function createObjectStorage(
  env: NodeJS.ProcessEnv = process.env,
  opts: ObjectStorageOptions = {},
): ObjectStorage {
  const now = opts.now ?? (() => new Date())
  const driver = env.OBJECT_STORAGE_DRIVER?.trim() || 'local'
  if (driver === 'local') return createLocalStorage(env, now)
  if (driver === 's3') return createS3Storage(env, now)
  throw new ObjectStorageError(
    'not_configured',
    `unknown OBJECT_STORAGE_DRIVER "${driver}"; expected "local" or "s3"`,
  )
}
