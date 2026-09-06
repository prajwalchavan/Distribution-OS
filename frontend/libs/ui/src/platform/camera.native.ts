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
import * as ImagePicker from 'expo-image-picker'

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
    return photo
  },

  available: true,
}
