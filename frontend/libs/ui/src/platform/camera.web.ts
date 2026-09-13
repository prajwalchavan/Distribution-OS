/**
 * Camera on the web.
 *
 * A browser has no promise-shaped "take one photo" call, so this is a hidden `<input type="file"
 * accept="image/*" capture="environment">`: on an Android phone it opens the camera, on a desktop it
 * opens the file picker — which is the right answer in both places, since an accountant on a desktop
 * is attaching a scan, not photographing a bill.
 *
 * Barcode reading uses the platform `BarcodeDetector` where the browser has one (Chrome and the
 * Android WebView do) and answers `null` where it does not, with `available` telling the screen in
 * advance. No 200 KB decoder library rides along for a capability the phone builds already have.
 */
import { fitJpeg, type JpegAttempt } from './jpeg-budget.js'
import type { CapturedPhoto, PlatformCamera, ScannedCode } from './types.js'

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource | Blob) => Promise<{ rawValue: string; format: string }[]>
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
}

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor ?? null
}

const MAX_WIDTH = 1600
const QUALITY = 0.75

function pickFile(accept: string, capture: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    if (capture) input.setAttribute('capture', 'environment')
    input.style.display = 'none'
    let settled = false
    const finish = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => {
      finish(input.files?.[0] ?? null)
    })
    // A cancelled picker fires no `change` in most browsers; `cancel` is the one that does.
    input.addEventListener('cancel', () => {
      finish(null)
    })
    document.body.appendChild(input)
    input.click()
  })
}

/**
 * Down to `maxWidth` and out as JPEG — the ~200 KB budget of UX-00 section 8.2. With `maxBytes` the
 * JPEG is walked down the ladder of `jpeg-budget.ts` until it fits (DOS-056).
 */
async function compress(file: File, maxWidth: number, maxBytes?: number): Promise<CapturedPhoto> {
  /*
   * `createImageBitmap` THROWS on anything it cannot decode — a HEIC from an iPhone in a browser
   * that has no decoder for it, a truncated file, a `.jpg` that is not one. Unguarded, that
   * rejection escaped `photograph()` and left the caller's `await` hanging as an
   * "Uncaught (in promise) InvalidStateError: The source image could not be decoded", with NOTHING
   * on screen — measured at a shop door on the delivery app's proof-of-delivery step, where the
   * photo is mandatory and the driver simply saw the button do nothing.
   *
   * The platform layer's own rule (this folder's header) is that nothing throws for being
   * unavailable: a file we cannot re-encode is handed back AS IT IS, at its original size, and the
   * caller's size check decides. That is worse than a compressed photo and infinitely better than
   * no photo and no sentence.
   */
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { uri: URL.createObjectURL(file), mimeType: file.type, bytes: file.size }
  }
  const scale = Math.min(1, maxWidth / bitmap.width)
  const baseWidth = Math.round(bitmap.width * scale)
  const baseHeight = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return { uri: URL.createObjectURL(file), mimeType: file.type, bytes: file.size }
  }
  const encode = async (
    attempt: JpegAttempt,
  ): Promise<{ blob: Blob; width: number; height: number; bytes: number } | null> => {
    const width = Math.max(1, Math.round(baseWidth * attempt.scale))
    const height = Math.max(1, Math.round(baseHeight * attempt.scale))
    canvas.width = width
    canvas.height = height
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', attempt.quality)
    })
    return blob === null ? null : { blob, width, height, bytes: blob.size }
  }
  const encoded =
    maxBytes === undefined
      ? await encode({ scale: 1, quality: QUALITY })
      : await fitJpeg(maxBytes, encode)
  bitmap.close()
  if (!encoded) {
    return { uri: URL.createObjectURL(file), mimeType: file.type, bytes: file.size }
  }
  return {
    uri: URL.createObjectURL(encoded.blob),
    mimeType: 'image/jpeg',
    width: encoded.width,
    height: encoded.height,
    bytes: encoded.bytes,
  }
}

export const camera: PlatformCamera = {
  /**
   * A file input needs no permission grant; the browser asks for the camera itself when the user
   * chooses it. Reported as granted so a screen's flow reads the same on both platforms.
   */
  requestPermission: () => Promise.resolve({ granted: true, canAskAgain: true }),

  scan: async (options) => {
    const Ctor = detectorCtor()
    if (!Ctor) return null
    const file = await pickFile('image/*', true)
    if (!file) return null
    const detector = new Ctor(options?.formats ? { formats: [...options.formats] } : undefined)
    const codes = await detector.detect(file)
    const first = codes[0]
    if (!first) return null
    const found: ScannedCode = { value: first.rawValue, format: first.format }
    return found
  },

  photograph: async (options) => {
    const file = await pickFile('image/*', true)
    if (!file) return null
    return compress(file, options?.maxWidth ?? MAX_WIDTH, options?.maxBytes)
  },

  available: typeof document !== 'undefined',
}
