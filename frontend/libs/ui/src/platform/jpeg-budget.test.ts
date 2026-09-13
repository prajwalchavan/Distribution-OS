/**
 * DOS-056 — a proof photo is squeezed under its byte budget BEFORE it is queued, on both cameras.
 *
 * The encoder is injected, so the ladder is tested here without a canvas or a native module: the web
 * camera draws each rung on a canvas, the native one renders it through expo-image-manipulator.
 */
import { describe, expect, it } from 'vitest'

import { fitJpeg, JPEG_LADDER, type JpegAttempt } from './jpeg-budget'

/** A fake encoder: bytes fall with quality and with the square of the scale, like a real JPEG. */
function fakeEncoder(fullBytes: number): {
  encode: (attempt: JpegAttempt) => Promise<{ bytes: number; attempt: JpegAttempt }>
  tried: JpegAttempt[]
} {
  const tried: JpegAttempt[] = []
  return {
    tried,
    encode: (attempt) => {
      tried.push(attempt)
      return Promise.resolve({
        bytes: Math.round(fullBytes * attempt.quality * attempt.scale * attempt.scale),
        attempt,
      })
    },
  }
}

describe('fitJpeg', () => {
  it('DOS-056 re-encodes a proof photo down the ladder until it is at most 300 KB, and stops at the first rung that fits', async () => {
    // A 12 MP phone photo: ~2.4 MB at full quality.
    const { encode, tried } = fakeEncoder(2_400_000)
    const fitted = await fitJpeg(300_000, encode)
    expect(fitted).not.toBeNull()
    expect(fitted?.bytes).toBeLessThanOrEqual(300_000)
    // It stopped at the first rung under budget: every earlier rung was over it.
    const last = tried[tried.length - 1]
    expect(fitted?.attempt).toEqual(last)
    for (const attempt of tried.slice(0, -1))
      expect(
        Math.round(2_400_000 * attempt.quality * attempt.scale * attempt.scale),
      ).toBeGreaterThan(300_000)
  })

  it('DOS-056 a photo already under budget is encoded once, at the first rung', async () => {
    const { encode, tried } = fakeEncoder(250_000)
    const fitted = await fitJpeg(300_000, encode)
    expect(tried).toEqual([JPEG_LADDER[0]])
    expect(fitted?.bytes).toBeLessThanOrEqual(300_000)
  })

  it('DOS-056 answers the smallest encoding when no rung fits, and null when nothing could be encoded', async () => {
    const { encode } = fakeEncoder(1_000_000_000)
    const fitted = await fitJpeg(300_000, encode)
    const smallest = Math.min(
      ...JPEG_LADDER.map((a) => Math.round(1_000_000_000 * a.quality * a.scale * a.scale)),
    )
    expect(fitted?.bytes).toBe(smallest)
    expect(await fitJpeg(300_000, () => Promise.resolve(null))).toBeNull()
  })
})
