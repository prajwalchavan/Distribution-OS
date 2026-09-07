/**
 * Files on the web: a hidden `<input type="file">` to pick, and `fetch` to PUT the bytes at the
 * signed URL `files.signUpload` returned. The app never sees an object key and never talks to the
 * bucket by any other route.
 */
import type { PickedFile, PlatformFiles } from './types.js'

export const files: PlatformFiles = {
  pick: (options) =>
    new Promise<PickedFile | null>((resolve) => {
      if (typeof document === 'undefined') {
        resolve(null)
        return
      }
      const input = document.createElement('input')
      input.type = 'file'
      if (options?.mimeTypes && options.mimeTypes.length > 0) {
        input.accept = options.mimeTypes.join(',')
      }
      input.style.display = 'none'
      let settled = false
      const finish = (file: PickedFile | null): void => {
        if (settled) return
        settled = true
        input.remove()
        resolve(file)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        finish(
          file
            ? {
                uri: URL.createObjectURL(file),
                name: file.name,
                mimeType: file.type === '' ? 'application/octet-stream' : file.type,
                size: file.size,
              }
            : null,
        )
      })
      input.addEventListener('cancel', () => {
        finish(null)
      })
      document.body.appendChild(input)
      input.click()
    }),

  upload: async (file, signedUrl, options) => {
    // Both a picked file and a captured photo are behind a `blob:` / `data:` URI here.
    const body = await fetch(file.uri).then((response) => response.blob())
    const response = await fetch(signedUrl, {
      method: options?.method ?? 'PUT',
      body,
      headers: { 'content-type': file.mimeType, ...(options?.headers ?? {}) },
    })
    if (!response.ok) {
      throw new Error(`Upload failed with ${String(response.status)}`)
    }
    if (file.uri.startsWith('blob:')) URL.revokeObjectURL(file.uri)
  },

  /**
   * A `blob:` / `data:` URI read back through `fetch`, then base64 by hand.
   *
   * `FileReader.readAsDataURL` would be shorter and is deliberately not used: it is callback-shaped,
   * and the chunked loop below is what keeps a ~200 KB photo (UX-00 §8.2 compresses to that) from
   * blowing the argument limit of `String.fromCharCode` — which is what a single spread does at
   * around 100 000 bytes, as a `RangeError` on the one screen a driver uses at a shop door.
   */
  readBase64: async (file) => {
    try {
      const buffer = await fetch(file.uri).then(async (r) => r.arrayBuffer())
      const bytes = new Uint8Array(buffer)
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)))
      }
      return btoa(binary)
    } catch {
      return null
    }
  },
}
