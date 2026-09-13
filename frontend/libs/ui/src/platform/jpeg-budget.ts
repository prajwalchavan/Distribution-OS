/**
 * The byte budget a photo is squeezed into before it leaves the camera module (DOS-056).
 *
 * A proof of delivery taken with no signal rides INSIDE the queued `deliveries` op (docs/27 §15), so
 * its size is the size of a sync batch: the delivery app asks `camera.photograph` for at most 300 KB of
 * JPEG, and both cameras walk the same ladder to get there — the web one draws each rung on a canvas,
 * the native one renders it through expo-image-manipulator. Quality goes down first (cheap, and a
 * printed bill stays legible), then the size. The encoder is injected, so the ladder is testable
 * without either renderer.
 *
 * Platform-neutral on purpose: it is not a capability, so it has no `.web.ts` / `.native.ts` pair and
 * is not exported from the platform barrels.
 */

export interface JpegAttempt {
  /** Fraction of the width the photo already has once `maxWidth` has capped it. */
  scale: number
  /** JPEG quality, 0–1. */
  quality: number
}

export const JPEG_LADDER: readonly JpegAttempt[] = [
  { scale: 1, quality: 0.75 },
  { scale: 1, quality: 0.6 },
  { scale: 1, quality: 0.45 },
  { scale: 0.75, quality: 0.6 },
  { scale: 0.75, quality: 0.45 },
  { scale: 0.5, quality: 0.6 },
  { scale: 0.5, quality: 0.45 },
  { scale: 0.35, quality: 0.45 },
  { scale: 0.25, quality: 0.4 },
]

/**
 * The first rung whose encoding is at most `maxBytes`. When no rung fits, the smallest encoding
 * produced (the caller's own size gate then decides); `null` only when nothing could be encoded.
 * An `encode` that answers `null` for a rung is skipped.
 */
export async function fitJpeg<T extends { bytes: number }>(
  maxBytes: number,
  encode: (attempt: JpegAttempt) => Promise<T | null>,
): Promise<T | null> {
  let smallest: T | null = null
  for (const attempt of JPEG_LADDER) {
    const encoded = await encode(attempt)
    if (encoded === null) continue
    if (encoded.bytes <= maxBytes) return encoded
    if (smallest === null || encoded.bytes < smallest.bytes) smallest = encoded
  }
  return smallest
}
