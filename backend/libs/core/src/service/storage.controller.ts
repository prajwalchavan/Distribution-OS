import { createHash } from 'node:crypto'
import { Controller, Get, Inject, Optional, Param, Put, Query, Req, Res } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { fileObjects, withSystem, type Db } from '@dos/db'
import { DB } from '../platform/db.module.js'
import {
  ALLOWED_CONTENT_TYPES,
  createObjectStorage,
  ObjectStorageError,
  parseObjectKey,
  verifyLocalObjectUrl,
} from '../platform/object-storage.js'

/**
 * `/storage/{key}?expires&signature` — the local object-storage driver's wire.
 *
 * On the founder's Mac there is no S3: `createObjectStorage()` keeps files under `backend/.storage`
 * and both `putUrl()` and `getUrl()` answer relative, HMAC-signed URLs (coordination §3.3). This
 * controller is what makes those URLs work: `PUT` verifies the PUT signature and writes the bytes
 * (the same allow-list and size cap `put()` enforces), `GET` verifies the GET signature and streams
 * them; anything else is 403. The S3 driver never comes here — its URLs point at the bucket. It sits
 * on every service because a URL is minted by whichever service the app talks to (`files.uploadUrl`,
 * `files.readUrl`, `billing.invoices.pdf`, `receipts.document`, `challans.pdf`).
 *
 * No bearer token is checked on purpose: the signature IS the authorisation, exactly as a pre-signed
 * S3 URL carries none. It is short-lived (15 minutes by default), bound to one key and to one verb.
 *
 * A successful PUT also flips the `file_objects` registry row for that key to `uploaded` (bytes and
 * sha256 recorded) as the system role — the local stand-in for the bucket notification S3 would
 * send — so `files.readUrl` and the retention sweep can tell a used upload URL from an abandoned one.
 */
@Controller('storage')
export class StorageController {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null = null) {}

  @Get('*')
  async serve(
    @Param('*') wildcard: string,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const key = decodeKey(wildcard)
    if (!key || !signature || !verifyLocalObjectUrl({ key, expires: Number(expires), signature })) {
      void reply.code(403).send({ code: 'FORBIDDEN', message: 'invalid or expired storage link' })
      return
    }
    if (!isLocalDriver()) {
      void reply.code(404).send({ code: 'NOT_FOUND', message: 'not served by this driver' })
      return
    }
    try {
      const body = await createObjectStorage().get(key)
      void reply
        .header('content-type', contentTypeFor(key))
        .header('cache-control', 'private, max-age=60')
        .header('content-disposition', `inline; filename="${key.split('/').pop() ?? 'file'}"`)
        .send(body)
    } catch (error) {
      if (error instanceof ObjectStorageError && error.code === 'not_found') {
        void reply.code(404).send({ code: 'NOT_FOUND', message: `no object at ${key}` })
        return
      }
      throw error
    }
  }

  @Put('*')
  async upload(
    @Param('*') wildcard: string,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const key = decodeKey(wildcard)
    if (
      !key ||
      !signature ||
      !verifyLocalObjectUrl({ key, expires: Number(expires), signature, method: 'PUT' })
    ) {
      void reply.code(403).send({ code: 'FORBIDDEN', message: 'invalid or expired upload link' })
      return
    }
    if (!isLocalDriver()) {
      void reply.code(404).send({ code: 'NOT_FOUND', message: 'not served by this driver' })
      return
    }
    const mimeType = (request.headers['content-type'] ?? '').split(';')[0]?.trim() ?? ''
    const body = await readBody(request)
    try {
      await createObjectStorage().put(key, body, mimeType)
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        void reply.code(400).send({ code: 'BAD_REQUEST', message: error.message })
        return
      }
      throw error
    }
    await this.markUploaded(key, body)
    void reply.code(200).send({ ok: true, objectKey: key, bytes: body.byteLength })
  }

  /** Best effort and never a failure of the upload: the registry may not hold a row for this key. */
  private async markUploaded(key: string, body: Buffer): Promise<void> {
    const parsed = parseObjectKey(key)
    if (!this.db || !parsed) return
    const sha256 = createHash('sha256').update(body).digest('hex')
    try {
      await withSystem(this.db, (tx) =>
        tx
          .update(fileObjects)
          .set({
            status: 'uploaded',
            bytes: body.byteLength,
            sha256,
            uploadedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(fileObjects.tenantId, parsed.tenantId), eq(fileObjects.objectKey, key))),
      )
    } catch (error) {
      console.warn('[storage] could not mark the upload in file_objects', error)
    }
  }
}

function isLocalDriver(): boolean {
  return (process.env.OBJECT_STORAGE_DRIVER?.trim() || 'local') === 'local'
}

function decodeKey(wildcard: string | undefined): string | null {
  if (!wildcard) return null
  try {
    return wildcard
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
}

function contentTypeFor(key: string): string {
  const ext = (key.split('.').pop() ?? '').toLowerCase()
  for (const [mime, meta] of Object.entries(ALLOWED_CONTENT_TYPES))
    if (meta.extensions.includes(ext)) return mime
  return 'application/octet-stream'
}

/** The raw bytes of the request. Fastify's default JSON parser never sees a PUT of an image or a PDF. */
async function readBody(request: FastifyRequest): Promise<Buffer> {
  const raw = request.body
  if (Buffer.isBuffer(raw)) return raw
  if (typeof raw === 'string') return Buffer.from(raw)
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  const chunks: Buffer[] = []
  for await (const chunk of request.raw)
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  return Buffer.concat(chunks)
}
