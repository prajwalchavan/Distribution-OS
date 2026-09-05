import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, eq, getTableName, sql, type Table } from 'drizzle-orm'
import type { FileReadUrl, FileReadUrlIn, FileUploadUrl, FileUploadUrlIn } from '@dos/contracts'
import {
  creditNotes,
  deliveries,
  deliveryChallans,
  fileObjects,
  invoices,
  receipts,
  retailers,
  tripStops,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  ANY_MEMBER,
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import {
  ALLOWED_CONTENT_TYPES,
  assertTenantKey,
  createObjectStorage,
  objectKey,
  ObjectStorageError,
  parseObjectKey,
  type ObjectDomain,
  type ParsedObjectKey,
} from '../../platform/object-storage.js'

/**
 * The HTTP face of the object-storage platform (docs/23 §8.13, files.ts). Two procedures: mint a
 * pre-signed upload for a file the caller is about to put somewhere, and mint a read URL for a key
 * the caller is allowed to open. Nothing binary passes through here (docs/20 rule 3).
 *
 * THE PER-DOMAIN TABLE (files.ts header) is applied HERE, not by the guard: the guard gates the verb
 * (STAFF uploads, ANY_MEMBER asks to read) and this service decides, per domain, who may put a file
 * there and who may open it. A domain whose files belong to a document row (invoices, challans,
 * receipts, the rendered `documents/…`) follows that row's RLS: if the caller can select the row it
 * can open the file; a shop therefore opens its own invoice PDF and nobody else's.
 */

/** The contract's `domain` → the storage key domain (`claim` files live under coordination's `claims/`). */
const KEY_DOMAIN: Record<FileUploadUrlIn['domain'], ObjectDomain> = {
  logo: 'logo',
  pod: 'pod',
  expense: 'expense',
  claim: 'claims',
  import: 'import',
  damage: 'damage',
}

/** Who may put a file of each domain there (files.ts table, "upload" column). */
const UPLOADERS: Record<FileUploadUrlIn['domain'], readonly ActorRole[]> = {
  logo: ['owner', 'system'],
  pod: ['owner', 'manager', 'delivery', 'system'],
  expense: ['owner', 'manager', 'accountant', 'delivery', 'system'],
  claim: ['owner', 'manager', 'system'],
  import: ['owner', 'manager', 'accountant', 'system'],
  damage: ['owner', 'manager', 'warehouse', 'delivery', 'system'],
}

const BACK_OFFICE_ROLES: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']
const BACK_OFFICE_OR_WAREHOUSE: readonly ActorRole[] = [...BACK_OFFICE_ROLES, 'warehouse']
const STOCK_VIEWERS: readonly ActorRole[] = [...BACK_OFFICE_OR_WAREHOUSE, 'delivery']

/** How long an upload URL stays good: fifteen minutes (files.ts). */
const UPLOAD_TTL_SECONDS = 15 * 60
/** How long a read URL stays good: fifteen minutes, the storage default. */
const READ_TTL_SECONDS = 15 * 60

@Injectable()
export class FilesService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * Mint an upload URL and register the intent in `file_objects` (status `pending`). The key is the
   * server's: `tenant/{tenantId}/{domain}/{entityId}/{id}.{ext}` — a retry with the same client `id`
   * resolves to the same key and the same registry row, so an upload is never duplicated.
   */
  async uploadUrl(input: FileUploadUrlIn): Promise<FileUploadUrl> {
    requireRole(STAFF)
    const ctx = currentTenant()
    if (!UPLOADERS[input.domain].includes(ctx.actorRole))
      throw new ORPCError('FORBIDDEN', {
        message: `a ${ctx.actorRole} may not upload a ${input.domain} file`,
      })
    if (input.domain === 'logo' && input.entityId !== ctx.tenantId)
      throw new ORPCError('BAD_REQUEST', {
        message: 'a logo belongs to the tenant: entityId must be the tenant id',
      })
    const ext = ALLOWED_CONTENT_TYPES[input.mimeType]?.extensions[0]
    if (!ext)
      throw new ORPCError('BAD_REQUEST', { message: `${input.mimeType} is not a storable type` })
    const db = requireDb(this.db)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        let key: string
        try {
          key = objectKey({
            tenantId: ctx.tenantId,
            domain: KEY_DOMAIN[input.domain],
            entityId: input.entityId,
            name: input.id,
            ext,
          })
        } catch (error) {
          throw storageError(error)
        }
        const [existing] = await tx
          .select({ objectKey: fileObjects.objectKey })
          .from(fileObjects)
          .where(and(eq(fileObjects.tenantId, ctx.tenantId), eq(fileObjects.id, input.id)))
          .limit(1)
        if (existing && existing.objectKey !== key)
          throw new ORPCError('CONFLICT', {
            message: `file ${input.id} was already registered under another key`,
          })
        if (!existing)
          await tx.insert(fileObjects).values({
            id: input.id,
            tenantId: ctx.tenantId,
            domain: input.domain,
            entityId: input.entityId,
            objectKey: key,
            mimeType: input.mimeType,
            bytes: input.bytes,
            status: 'pending',
            uploadedBy: ctx.actorId,
          })
        let put
        try {
          put = await createObjectStorage().putUrl(key, {
            mimeType: input.mimeType,
            bytes: input.bytes,
            ttlSeconds: UPLOAD_TTL_SECONDS,
          })
        } catch (error) {
          throw storageError(error)
        }
        return {
          objectKey: key,
          url: put.url,
          method: put.method,
          headers: put.headers,
          inline: put.inline,
          expiresAt: put.expiresAt,
        }
      }),
    )
  }

  /**
   * A read URL for a key this role may open. The key is anchored at the caller's tenant first
   * (`assertTenantKey`: another distributor's key is `invalid_key`, never their bytes), then the
   * per-domain rule runs, then the URL is signed. A key that was registered and never uploaded, or
   * that nothing references, is NOT_FOUND.
   */
  async readUrl(input: FileReadUrlIn): Promise<FileReadUrl> {
    requireRole(ANY_MEMBER)
    const ctx = currentTenant()
    let parsed: ParsedObjectKey | null
    try {
      assertTenantKey(input.objectKey, ctx.tenantId)
      parsed = parseObjectKey(input.objectKey)
    } catch (error) {
      throw storageError(error)
    }
    if (!parsed)
      throw new ORPCError('BAD_REQUEST', {
        message: 'objectKey is not of the form tenant/{tenantId}/{domain}/{entityId}/{name}',
      })
    const db = requireDb(this.db)
    const allowed = await withTenant(db, ctx, (tx) => this.mayRead(tx, parsed))
    if (!allowed)
      throw new ORPCError('FORBIDDEN', {
        message: `a ${ctx.actorRole} may not open this ${parsed.domain} file`,
      })
    try {
      const url = await createObjectStorage().getUrl(input.objectKey, READ_TTL_SECONDS)
      return { url, expiresAt: new Date(Date.now() + READ_TTL_SECONDS * 1000).toISOString() }
    } catch (error) {
      throw storageError(error)
    }
  }

  /** The files.ts table, "read" column. Runs inside the caller's tenant transaction so RLS decides the document domains. */
  private async mayRead(tx: Db, key: ParsedObjectKey): Promise<boolean> {
    const ctx = currentTenant()
    const role = ctx.actorRole
    switch (key.domain) {
      case 'logo':
        return true
      case 'pod':
        if (STOCK_VIEWERS.includes(role)) return true
        // The shop that received it: the delivery's stop is the shop's own under trip_stops_read.
        return role === 'retailer' && (await this.exists(tx, deliveries, key.entityId, tripStops))
      case 'expense':
        return BACK_OFFICE_ROLES.includes(role) || (await this.uploadedByActor(tx, key))
      case 'claims':
      case 'import':
      case 'exports':
        return BACK_OFFICE_ROLES.includes(role)
      case 'damage':
        return STOCK_VIEWERS.includes(role)
      case 'docs':
        // A supplier invoice page carries purchase rates: never the field, never the shop (docs/17 A12).
        return BACK_OFFICE_OR_WAREHOUSE.includes(role)
      case 'invoices':
        return this.exists(tx, invoices, key.entityId)
      case 'challans':
        return this.exists(tx, deliveryChallans, key.entityId)
      case 'receipts':
        return this.exists(tx, receipts, key.entityId)
      case 'statements':
        return this.exists(tx, retailers, key.entityId)
      case 'documents':
        return this.documentVisible(tx, key)
      default:
        return false
    }
  }

  /** `documents/{kind}/{id}.pdf` — the worker's rendered documents follow the owning row's RLS. */
  private documentVisible(tx: Db, key: ParsedObjectKey): Promise<boolean> {
    const id = key.fileName.replace(/\.[a-z0-9]+$/i, '')
    switch (key.entityId) {
      case 'invoice':
        return this.exists(tx, invoices, id)
      case 'credit_note':
        return this.exists(tx, creditNotes, id)
      case 'challan':
        return this.exists(tx, deliveryChallans, id)
      case 'receipt':
        return this.exists(tx, receipts, id)
      default:
        return Promise.resolve(false)
    }
  }

  /** Can the caller SELECT that row? RLS answers; a row the caller may not see simply is not there. */
  private async exists(
    tx: Db,
    table: Table,
    id: string,
    viaStops?: typeof tripStops,
  ): Promise<boolean> {
    const { tenantId } = currentTenant()
    const result = viaStops
      ? await tx.execute(
          sql`select 1 from deliveries d join trip_stops s on s.id = d.stop_id
              where d.tenant_id = ${tenantId} and d.id = ${id} limit 1`,
        )
      : await tx.execute(
          sql`select 1 from ${sql.identifier(getTableName(table))} where tenant_id = ${tenantId} and id = ${id} limit 1`,
        )
    return result.rows.length > 0
  }

  private async uploadedByActor(tx: Db, key: ParsedObjectKey): Promise<boolean> {
    const ctx = currentTenant()
    const [row] = await tx
      .select({ uploadedBy: fileObjects.uploadedBy })
      .from(fileObjects)
      .where(
        and(
          eq(fileObjects.tenantId, ctx.tenantId),
          eq(
            fileObjects.objectKey,
            `tenant/${ctx.tenantId}/${key.domain}/${key.entityId}/${key.fileName}`,
          ),
        ),
      )
      .limit(1)
    return row?.uploadedBy === ctx.actorId
  }
}

/** `ObjectStorageError` → the HTTP answer files.ts promises; anything else is a real fault. */
function storageError(error: unknown): ORPCError<string, unknown> {
  if (error instanceof ObjectStorageError) {
    if (error.code === 'not_found') return new ORPCError('NOT_FOUND', { message: error.message })
    if (error.code === 'not_configured' || error.code === 'upstream')
      return new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message })
    return new ORPCError('BAD_REQUEST', { message: error.message, data: { code: error.code } })
  }
  if (error instanceof ORPCError) return error as ORPCError<string, unknown>
  return new ORPCError('INTERNAL_SERVER_ERROR', { message: String(error) })
}
