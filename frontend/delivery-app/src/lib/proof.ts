/**
 * A photograph taken at a shop door or a fuel pump, turned into something the API will accept.
 *
 * TWO WAYS IN, and the SERVER decides which. `files.uploadUrl` answers either a pre-signed `url` (S3:
 * the app PUTs the bytes straight to storage — docs/20 rule 3, nothing binary ever streams through a
 * service) or `inline: true` (the local object-storage driver, which has nowhere to PUT), in which
 * case the bytes ride on the create call that consumes the key. This module asks, does whichever it
 * is told, and hands the caller the one field to send.
 *
 * A THIRD way, which is the one that matters on the road: with no signal there is no upload URL to
 * ask for, so the bytes go inline through the outbox with the delivery itself. That is why the photo
 * is held as base64 the moment it is taken rather than as a `blob:` URI the browser will forget —
 * `delivery.sync.ts` reads `pod[].inline` off the same op as the lines.
 *
 * The camera already compresses to ≤ 1600 px (UX-00 §8.2, `camera.web.ts` / `camera.native.ts`);
 * `InlineFileInput` caps a base64 body at ~700 KB, which is the wire limit this checks against so a
 * driver is told at the door rather than by a rejection in the tray an hour later.
 */
import { uuidv7 } from '@dos/domain'
import { camera, files as platformFiles } from '@dos/ui/platform'
import type { CapturedPhoto } from '@dos/ui/platform'

import { absoluteUrl } from '../config'

/** `InlineFileInput.contentBase64` is `.max(700_000)`; stay under it with room for the wrapper. */
export const MAX_INLINE_BASE64 = 690_000

/** The subset of `FileMimeTypeSchema` a camera can produce. */
export type ProofMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'

export interface CapturedProof {
  /**
   * The upload intent's id, minted ONCE when the photo is taken.
   *
   * `files.uploadUrl` takes an `id` that becomes the object's name and an `idempotencyKey`, and the
   * two have to move together: a stable key with a fresh `id` on every attempt is literally "the
   * same key with a different request", which the platform refuses — measured at a shop door, where
   * the FIRST attempt failed on an unrelated validation error and the retry could then never
   * succeed, on the one write a driver cannot skip. One photo, one id, one key, however many taps.
   */
  uploadId: string
  photo: CapturedPhoto
  mimeType: ProofMimeType
  contentBase64: string
  /** Decoded bytes, for the "too big" sentence and for `files.uploadUrl`. */
  bytes: number
}

const ALLOWED: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

/**
 * One photo, read into memory as base64.
 *
 * `null` when the person cancelled — a cancelled camera is not an error and must not paint one. A
 * mime type the platform allow-list does not carry is normalised to JPEG rather than refused: every
 * camera in this trade produces one, and a phone reporting `image/jpg` must not cost a driver a POD.
 */
export async function captureProof(): Promise<CapturedProof | null> {
  const photo = await camera.photograph({ maxWidth: 1600 })
  if (photo === null) return null
  const contentBase64 = await platformFiles.readBase64(photo)
  if (contentBase64 === null) return null
  const mimeType: ProofMimeType = ALLOWED.includes(photo.mimeType)
    ? (photo.mimeType as ProofMimeType)
    : 'image/jpeg'
  return {
    uploadId: uuidv7(),
    photo,
    mimeType,
    contentBase64,
    // base64 is 4 characters per 3 bytes; close enough for a size gate, and never larger than truth.
    bytes: photo.bytes ?? Math.floor((contentBase64.length * 3) / 4),
  }
}

export interface StoredProof {
  objectKey?: string
  inline?: { mimeType: ProofMimeType; contentBase64: string }
}

export interface UploadUrlAnswer {
  objectKey: string
  url: string | null
  method: 'PUT' | null
  headers: Record<string, string>
  inline: boolean
}

/**
 * Put the bytes wherever the server said to, and answer with the field the create call takes.
 *
 * The caller passes `ask` — the bound `files.uploadUrl` call — rather than the api client, so this
 * stays a pure function of its inputs and a screen that has no signal simply never calls it.
 */
export async function storeProof(
  proof: CapturedProof,
  ask: (input: { mimeType: ProofMimeType; bytes: number }) => Promise<UploadUrlAnswer>,
): Promise<StoredProof> {
  const answer = await ask({ mimeType: proof.mimeType, bytes: proof.bytes })
  if (answer.inline || answer.url === null) {
    return { inline: { mimeType: proof.mimeType, contentBase64: proof.contentBase64 } }
  }
  /*
   * THE SIGNED URL COMES BACK SERVICE-RELATIVE — `/storage/tenant/…?expires=…&signature=…`, exactly
   * like `logoUrl` — and a relative URL is resolved against the APP's origin in a browser
   * (`localhost:5177`, which is Metro, not the service) and against nothing at all on a phone.
   * Measured on the expense screen: the PUT went to the dev server, came back 200 because Metro
   * answers everything with the app shell, and the fuel bill was uploaded into thin air. Every
   * proof this app takes goes through here, so the absolutising goes here.
   */
  const target = absoluteUrl(answer.url) ?? answer.url
  await platformFiles.upload(proof.photo, target, {
    method: answer.method ?? 'PUT',
    headers: answer.headers,
  })
  return { objectKey: answer.objectKey }
}
