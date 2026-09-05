import { and, eq } from 'drizzle-orm'
import type { SyncOp } from '@dos/contracts'
import { DocumentKindSchema, DocumentPageMimeTypeSchema } from '@dos/contracts'
import { documentPages, documents, suppliers, type Db, type TenantContext } from '@dos/db'
import { documentMachine } from '@dos/domain'
import { assertTenantKey } from '../../platform/object-storage.js'
import { SyncRejection } from '../sync/index.js'

/**
 * ADR 0007 / brief §7 — what the warehouse phone pushes after a capture with no signal: a document
 * header and its page rows, PUT only. A device may never set a status other than `uploaded`, never
 * sends image bytes through a sync op (the attachment queue PUTs them to the slot's `object_key`
 * separately) and never submits — submit is an online call, because it starts the engine. Every
 * refusal is a `SyncRejection` (2xx plus a `sync_errors` row), never a 4xx that would wedge the queue.
 * Replays are handled upstream by `sync_ops(tenant, device, op_id)`, and again by each row's own id.
 */

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
const int = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v)
    ? v
    : typeof v === 'string' && /^\d+$/.test(v)
      ? Number(v)
      : undefined

function putOnly(op: SyncOp, table: string): void {
  if (op.op !== 'PUT')
    throw new SyncRejection(
      'unsupported_op',
      `${table} accepts PUT from a device, not ${op.op}; a captured document is never edited or deleted offline`,
    )
}

/** `documents`: PUT `{ kind, supplier_id?, expected_pages?, captured_at?, note?, status? ('uploaded' only) }`. */
export async function applyDocumentSync(tx: Db, op: SyncOp, ctx: TenantContext): Promise<void> {
  putOnly(op, 'documents')
  const data = op.data ?? {}
  const status = str(data.status)
  if (status !== undefined && status !== documentMachine.initial)
    throw new SyncRejection(
      'state_not_allowed',
      `a device may only create a document as ${documentMachine.initial}; submit it online`,
    )
  const kind = DocumentKindSchema.safeParse(str(data.kind))
  if (!kind.success) throw new SyncRejection('row_invalid', 'documents.kind is missing or unknown')
  const [existing] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, op.id))
    .limit(1)
  if (existing) return
  const supplierId = str(data.supplier_id)
  if (supplierId) {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .limit(1)
    if (!supplier) throw new SyncRejection('document_not_found', `supplier ${supplierId} not found`)
  }
  const capturedAt = str(data.captured_at) ?? op.clientTime
  await tx.insert(documents).values({
    id: op.id,
    tenantId: ctx.tenantId,
    kind: kind.data,
    status: documentMachine.initial,
    uploadedBy: ctx.actorId,
    supplierId: supplierId ?? null,
    expectedPages: int(data.expected_pages) ?? null,
    capturedAt: capturedAt ? new Date(capturedAt) : null,
    note: str(data.note)?.slice(0, 200) ?? null,
  })
}

/** `document_pages`: PUT `{ document_id, page_no, object_key, mime_type, width?, height?, bytes?, printed_page_label?, qr_detected? }`. */
export async function applyPageSync(tx: Db, op: SyncOp, ctx: TenantContext): Promise<void> {
  putOnly(op, 'document_pages')
  const data = op.data ?? {}
  const documentId = str(data.document_id)
  const pageNo = int(data.page_no)
  const objectKey = str(data.object_key)
  const mimeType = DocumentPageMimeTypeSchema.safeParse(str(data.mime_type))
  if (!documentId || pageNo === undefined || pageNo < 1 || !objectKey || !mimeType.success)
    throw new SyncRejection(
      'row_invalid',
      'document_pages needs document_id, page_no, object_key and mime_type',
    )
  if (typeof data.content_base64 === 'string')
    throw new SyncRejection(
      'page_missing_object',
      'image bytes never travel through sync; PUT them to object_key first',
    )
  const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  if (!doc) throw new SyncRejection('document_not_found', `document ${documentId} not found`)
  if (doc.status !== 'uploaded')
    throw new SyncRejection(
      'document_locked',
      `document ${documentId} is ${doc.status}; pages are added before submit`,
    )
  try {
    assertTenantKey(objectKey, ctx.tenantId)
  } catch {
    throw new SyncRejection('row_invalid', 'object_key does not belong to this distributor')
  }
  if (!objectKey.startsWith(`tenant/${ctx.tenantId}/docs/${documentId}/`))
    throw new SyncRejection('row_invalid', 'object_key must be a slot minted for this document')
  const [existing] = await tx
    .select({ id: documentPages.id })
    .from(documentPages)
    .where(and(eq(documentPages.documentId, documentId), eq(documentPages.pageNo, pageNo)))
    .limit(1)
  if (existing) return
  await tx.insert(documentPages).values({
    id: op.id,
    tenantId: ctx.tenantId,
    documentId,
    pageNo,
    objectKey,
    mimeType: mimeType.data,
    width: int(data.width) ?? null,
    height: int(data.height) ?? null,
    bytes: int(data.bytes) ?? null,
    printedPageLabel: str(data.printed_page_label)?.slice(0, 20) ?? null,
    qrDetected: data.qr_detected === true,
  })
}
