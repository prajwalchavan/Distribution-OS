/**
 * Camera on a phone.
 *
 * `expo-camera`'s `<CameraView>` is a component, not a call, so a promise-shaped `scan()` would need
 * the kit to own a full-screen scanner route — which would put navigation inside the design system.
 * Instead both jobs go through `expo-image-picker`'s camera (one promise, no UI to host) and a scan
 * decodes the photo with `scanFromURLAsync`. The godown holds the phone over the carton and taps
 * once, which is the same gesture either way.
 *
 * A live viewfinder with continuous decoding belongs in the warehouse app's own screen when that
 * slice is built; it can call `requestPermission()` here and mount `<CameraView>` itself.
 */
import { Camera, type BarcodeType } from 'expo-camera'
import { File } from 'expo-file-system'
import type * as ExpoImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import { fitJpeg } from './jpeg-budget.js'
import type { CapturedPhoto, PlatformCamera, ScannedCode } from './types.js'

const MAX_WIDTH = 1600
/** JPEG quality, 0–1. ~200 KB at 1600 px for a printed bill (UX-00 section 8.2). */
const QUALITY = 0.6

async function shoot(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) return null
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: QUALITY,
    exif: false,
  })
  if (result.canceled) return null
  return result.assets[0] ?? null
}

/**
 * expo-image-manipulator, loaded on first use rather than imported. Its entry calls
 * `requireNativeModule` as it loads, which THROWS in a build whose native side does not link the
 * module — and every app bundles this file, while only the delivery app asks for a squeezed photo
 * (DOS-056). A build without it gets the photo as the camera took it; the caller's size check decides.
 */
function imageManipulator(): typeof ExpoImageManipulator | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import crashes every build that does not link the native module (see above)
    return require('expo-image-manipulator') as typeof ExpoImageManipulator
  } catch {
    return null
  }
}

/** The bytes of a file the manipulator wrote, or null when it cannot be read back. */
function sizeOf(uri: string): number | null {
  try {
    return new File(uri).size
  } catch {
    return null
  }
}

/** A rung of the ladder that was not kept: a cache file, removed now rather than when the OS gets to it. */
function discard(uri: string): void {
  try {
    new File(uri).delete()
  } catch {
    // already gone, or never written: nothing to clean
  }
}

/**
 * The photo down to `maxWidth`, then down the JPEG ladder of `jpeg-budget.ts` until the file is at
 * most `maxBytes` (DOS-056). Null when this build has no manipulator or it could not render the photo.
 */
async function squeeze(
  asset: ImagePicker.ImagePickerAsset,
  maxWidth: number,
  maxBytes: number,
): Promise<CapturedPhoto | null> {
  const manipulator = imageManipulator()
  if (manipulator === null) return null
  const baseWidth = Math.min(asset.width, maxWidth)
  const written: string[] = []
  try {
    const fitted = await fitJpeg(maxBytes, async ({ scale, quality }) => {
      const context = manipulator.ImageManipulator.manipulate(asset.uri)
      try {
        context.resize({ width: Math.max(1, Math.round(baseWidth * scale)) })
        const image = await context.renderAsync()
        try {
          const saved = await image.saveAsync({
            compress: quality,
            format: manipulator.SaveFormat.JPEG,
          })
          written.push(saved.uri)
          const bytes = sizeOf(saved.uri)
          return bytes === null
            ? null
            : { uri: saved.uri, width: saved.width, height: saved.height, bytes }
        } finally {
          image.release()
        }
      } finally {
        context.release()
      }
    })
    for (const uri of written) if (uri !== fitted?.uri) discard(uri)
    if (fitted === null) return null
    return {
      uri: fitted.uri,
      mimeType: 'image/jpeg',
      width: fitted.width,
      height: fitted.height,
      bytes: fitted.bytes,
    }
  } catch {
    for (const uri of written) discard(uri)
    return null
  }
}

export const camera: PlatformCamera = {
  requestPermission: async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    return { granted: permission.granted, canAskAgain: permission.canAskAgain }
  },

  scan: async (options) => {
    const asset = await shoot()
    if (!asset) return null
    const codes = await Camera.scanFromURLAsync(
      asset.uri,
      options?.formats ? ([...options.formats] as BarcodeType[]) : undefined,
    )
    const first = codes[0]
    if (!first) return null
    const found: ScannedCode = { value: first.data, format: first.type }
    return found
  },

  photograph: async (options) => {
    const asset = await shoot()
    if (!asset) return null
    const maxWidth = options?.maxWidth ?? MAX_WIDTH
    const photo: CapturedPhoto = {
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      width: Math.min(asset.width, maxWidth),
      height: asset.height,
      bytes: asset.fileSize,
    }
    const maxBytes = options?.maxBytes
    if (maxBytes === undefined) return photo
    // Already a JPEG inside both budgets: nothing to squeeze.
    const fits =
      photo.mimeType === 'image/jpeg' &&
      asset.width <= maxWidth &&
      asset.fileSize !== undefined &&
      asset.fileSize <= maxBytes
    if (fits) return photo
    return (await squeeze(asset, maxWidth, maxBytes)) ?? photo
  },

  available: true,
}
