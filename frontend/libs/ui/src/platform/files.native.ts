/**
 * Files on a phone: `expo-document-picker` to pick, and the bytes read through `expo-file-system`
 * before a plain `fetch` PUTs them at the signed URL.
 *
 * The bytes are read explicitly rather than handed to `fetch` as a `file://` URI, because React
 * Native's fetch does not read local files: passing the URI straight through uploads an empty body
 * and the failure only shows up as a 0-byte object in the bucket, which nobody notices until a
 * distributor opens a blank invoice.
 */
import { File } from 'expo-file-system'
import * as DocumentPicker from 'expo-document-picker'

import type { PickedFile, PlatformFiles } from './types.js'

export const files: PlatformFiles = {
  pick: async (options) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: options?.mimeTypes ? [...options.mimeTypes] : '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    })
    if (result.canceled) return null
    const asset = result.assets[0]
    if (!asset) return null
    const file: PickedFile = {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      size: asset.size ?? 0,
    }
    return file
  },

  upload: async (file, signedUrl, options) => {
    const bytes = new File(file.uri).bytes()
    const response = await fetch(signedUrl, {
      method: options?.method ?? 'PUT',
      body: bytes as unknown as BodyInit,
      headers: { 'content-type': file.mimeType, ...(options?.headers ?? {}) },
    })
    if (!response.ok) {
      throw new Error(`Upload failed with ${String(response.status)}`)
    }
  },
}
