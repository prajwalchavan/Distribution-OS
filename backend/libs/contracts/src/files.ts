import { oc } from '@orpc/contract'
import { z } from 'zod'
import { IdSchema, MutationBase } from './common.js'

/**
 * Files — the HTTP face of the object-storage platform (`backend/libs/core/src/platform/
 * object-storage.ts`, coordination §3.3). Nothing binary ever streams through a service (docs/20 rule
 * 3): a client asks for an upload URL, PUTs the bytes straight to storage (or, on the local driver,
 * sends them inline on the create call that consumes the key), and later asks for a read URL. The two
 * procedures here are the ONLY signed-URL minting on the wire; docint's `documents.pageUploadUrl` is a
 * thin wrapper over the same platform functions, never a second implementation (docs/23 §8.5).
 *
 * WHICH SERVICES MOUNT `files`:
 *
 *   owner :3001      YES — logo upload (Settings > Branding), import files, evidence reads
 *   manager :3002    YES — manager + accountant: claim evidence, import files, reads of POD, expense
 *                    proofs and supplier-invoice pages on the review desk
 *   sales :3003      NO  — a rep uploads nothing and every document it opens (a bill's PDF) carries its
 *                    own URL from `billing.invoices.pdf`
 *   warehouse :3004  YES — damage photos at the gate; reads of the challan it printed
 *   delivery :3005   YES — proof-of-delivery photos and expense proofs from the road
 *   retailer :3006   YES — `readUrl` ONLY (the POD photo of its own delivery, R4). `uploadUrl` is STAFF
 *                    and refuses the shop in PERMISSIONS
 *
 * Key convention, fixed in coordination §3.3 and built by `objectKey()` on the server, never by the
 * client: `tenant/{tenantId}/{domain}/{entityId}/{name}.{ext}`. The server chooses the name and the
 * extension from `mimeType`; the client only says what the file is FOR (`domain`) and which row it
 * belongs to (`entityId`). `assertTenantKey()` anchors every key at the caller's tenant on both
 * procedures, so a key from another distributor is `invalid_key`, never another tenant's bytes.
 *
 * PER-DOMAIN ROLE CHECK — the guard gates the verb (STAFF may mint an upload URL, ANY_MEMBER a read
 * URL); the handler applies this table before touching storage, and a failure is 403:
 *
 *   domain    upload (who puts it there)                   read (who may open it)
 *   -------   ------------------------------------------   -------------------------------------------------
 *   logo      owner                                        every member (it is on every screen)
 *   pod       delivery, owner, manager (DOORSTEP)          STOCK_VIEWERS + the shop that received it
 *   expense   delivery, owner, manager, accountant         BACK_OFFICE + the crew member who recorded it
 *   claim     owner, manager (claims are BACK_OFFICE)      BACK_OFFICE
 *   import    owner, manager, accountant                   BACK_OFFICE
 *   damage    warehouse, delivery, owner, manager          BACK_OFFICE_OR_WAREHOUSE + DOORSTEP
 *   docs      never here — docint's own procedure          BACK_OFFICE_OR_WAREHOUSE: a supplier invoice
 *             (a page belongs to a document row)           page carries purchase rates and is never
 *                                                          readable by the field or the shop (docs/17 A12)
 *   invoices, challans, statements, exports — written only by the worker; a read follows the RLS of the
 *             owning document (a shop reads its own invoice PDF, nobody else's)
 *
 * The size cap on the wire is 15 MB — the largest a phone photo compressed by the app should be
 * (UX-00 §8.3 says ≤ 1600 px / ~200 KB is the target); the platform's per-content-type limits apply
 * underneath and may be lower. A GET of a key that nothing references any more is NOT_FOUND, and an
 * upload URL is single-use for its `expiresAt` window (15 minutes).
 */

/** What the file is for. Decides the key prefix, the allowed uploaders and the allowed readers (table above). */
export const FileDomainSchema = z.enum(['logo', 'pod', 'expense', 'claim', 'import', 'damage'])
export type FileDomain = z.infer<typeof FileDomainSchema>

/** The platform allow-list: photos, PDFs and the tabular formats the importer reads. Never octet-stream. */
export const FileMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/json',
])
export type FileMimeType = z.infer<typeof FileMimeTypeSchema>

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

export const FileUploadUrlInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the upload intent; becomes the object name, so a retry reuses the key. */
  id: IdSchema,
  domain: FileDomainSchema,
  /** The row the file belongs to: the tenant id for a logo, the delivery / expense / claim / import id otherwise. */
  entityId: IdSchema,
  mimeType: FileMimeTypeSchema,
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})
export type FileUploadUrlIn = z.infer<typeof FileUploadUrlInput>

/**
 * `inline: true` (the local driver) means "there is no URL to PUT to — send the bytes on the create
 * call that consumes `objectKey`"; `url` and `method` are null in that case. On S3 the client PUTs
 * the bytes to `url` with exactly `headers` before `expiresAt`.
 */
export const FileUploadUrlOutput = z.object({
  objectKey: z.string(),
  url: z.string().nullable(),
  method: z.enum(['PUT']).nullable(),
  headers: z.record(z.string(), z.string()),
  inline: z.boolean(),
  expiresAt: z.string(),
})
export type FileUploadUrl = z.infer<typeof FileUploadUrlOutput>

export const FileReadUrlInput = z.object({
  objectKey: z.string().min(1).max(512),
})
export type FileReadUrlIn = z.infer<typeof FileReadUrlInput>

export const FileReadUrlOutput = z.object({
  url: z.string(),
  expiresAt: z.string(),
})
export type FileReadUrl = z.infer<typeof FileReadUrlOutput>

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `files: filesContract` in contract.ts

export const filesContract = {
  uploadUrl: oc
    .route({
      method: 'POST',
      path: '/files/upload-url',
      summary:
        'Mint a pre-signed upload for a logo, POD photo, expense proof, claim evidence or import',
    })
    .input(FileUploadUrlInput)
    .output(FileUploadUrlOutput),
  readUrl: oc
    .route({
      method: 'GET',
      path: '/files/read-url',
      summary: 'A short-lived read URL for an object key this role may open',
    })
    .input(FileReadUrlInput)
    .output(FileReadUrlOutput),
}
