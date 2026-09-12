/**
 * `@dos/ui/platform` — the few things that genuinely differ between a browser and a phone, declared
 * ONCE (docs/08 section 0, docs/22 section 8 decision of 2026-09-06).
 *
 * Every capability below is a `.web.ts` / `.native.ts` pair implementing the interface here. A screen
 * calls `documents.open(url)` or `camera.photograph()` and never learns which one ran; `parity.test.ts`
 * asserts the two halves export the same names, and the interfaces here make the compiler assert the
 * same shapes.
 *
 * Two rules the interfaces themselves carry:
 *
 * - **Nothing throws for being unavailable.** A capability the platform lacks answers `null`, `false`
 *   or an explicit `available: false`, so a screen degrades instead of crashing. A distributor's
 *   accountant on a desktop browser has no camera; that is a normal Tuesday, not an error.
 * - **Nothing asks twice.** Permission requests are explicit calls a screen makes when the user has
 *   already said what they want to do — never on mount, never as a modal in front of a task
 *   (UX-00 section 12, "no modal blocks for sync, GPS or permissions").
 */

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

/**
 * Where a token or a small preference lives. `expo-secure-store` (Keychain / EncryptedSharedPreferences)
 * on a phone, `localStorage` in a browser — `secure` says which, so a screen can be honest about it.
 *
 * The synchronous pair exists because `@dos/api-client`'s `TokenStorage` reads before every request
 * and cannot await; the async pair is the one to prefer everywhere else.
 */
export interface PlatformStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
  /** A cached synchronous read. Null when the key is unknown or the cache is cold. */
  getItemSync: (key: string) => string | null
  /** Writes through to the store; `null` removes. */
  setItemSync: (key: string, value: string | null) => void
  /** Prime the synchronous cache at boot. Resolves once every key given is readable. */
  prime: (keys: readonly string[]) => Promise<void>
  /** True when the store is encrypted at rest. */
  readonly secure: boolean
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

/**
 * An invoice, a credit note, a challan or a receipt — always a PDF the API rendered, never a
 * client-side re-draw of the same figures (`@dos/core/documents`). The URL is a signed read URL from
 * `files.signRead`; a raw object key never reaches a client. The local storage driver signs it
 * SERVICE-RELATIVE (`/storage/…`), so an app passes it through its own `absoluteUrl()` first
 * (`document-urls.test.ts` holds every app to that).
 */
export interface PlatformDocuments {
  /** Show it: a new tab in a browser, the preview/share sheet on a phone. */
  open: (url: string, options?: { filename?: string }) => Promise<void>
  /** Print it. The browser prints through the kit's print stylesheet; a phone uses the OS dialog. */
  print: (url: string, options?: { filename?: string }) => Promise<void>
  /**
   * Send it: hand the PDF FILE itself to the OS or browser share sheet, never a link, which dies with
   * its signature. `true` only when the file was handed over. `false` when nothing was sent — the
   * reader dismissed the sheet, or the browser cannot share files, in which case the PDF opens in a
   * tab so it can still be saved and attached by hand.
   */
  share: (
    url: string,
    options?: { filename?: string; title?: string; message?: string },
  ) => Promise<boolean>
  readonly canPrint: boolean
  readonly canShare: boolean
}

// ---------------------------------------------------------------------------
// camera
// ---------------------------------------------------------------------------

export interface PermissionResult {
  granted: boolean
  /** False once the user has refused permanently: the screen must send them to Settings instead. */
  canAskAgain: boolean
}

export interface CapturedPhoto {
  /** A local URI (`file://`, `blob:`) to hand to `files.upload`. */
  uri: string
  mimeType: string
  width?: number | undefined
  height?: number | undefined
  bytes?: number | undefined
}

export interface ScannedCode {
  value: string
  /** `qr`, `ean13`, `code128`, ... as the platform reports it. */
  format: string
}

/**
 * Two jobs, both on the inbound path: read a barcode (the gate count, a picklist confirmation) and
 * photograph a supplier bill (docs/05, "zero manual entry").
 *
 * Photos are compressed to <= 1600 px / ~200 KB before they leave the device (UX-00 section 8.2
 * performance budget) — a godown's phone on a 2G evening cannot afford a 4 MB original.
 */
export interface PlatformCamera {
  requestPermission: () => Promise<PermissionResult>
  /** One code. Null when the user cancelled or nothing decodable was in frame. */
  scan: (options?: { formats?: readonly string[] }) => Promise<ScannedCode | null>
  /** One photo. Null when the user cancelled. */
  photograph: (options?: { maxWidth?: number }) => Promise<CapturedPhoto | null>
  /** False where there is no camera at all (a desktop browser with none, an unsupported build). */
  readonly available: boolean
}

// ---------------------------------------------------------------------------
// location
// ---------------------------------------------------------------------------

export interface Coordinates {
  latitude: number
  longitude: number
  /** Metres, or null when the platform does not say. */
  accuracy: number | null
  /** Epoch ms. */
  at: number
}

export interface LocationPermissionResult extends PermissionResult {
  /** Granted for background use as well — the trip-scoped tracking of docs/22. */
  background: boolean
}

/**
 * Trip tracking, and nothing else. Location is shared only while a delivery trip is running
 * (docs/22); there is no ambient tracking anywhere in the product, which is why `watch` hands back a
 * stop function rather than living for the life of the app.
 */
export interface PlatformLocation {
  requestPermission: (options?: { background?: boolean }) => Promise<LocationPermissionResult>
  /** One fix. Null when permission was refused or no fix arrived in time. */
  current: () => Promise<Coordinates | null>
  /** Starts a watch; the returned function stops it. */
  watch: (
    onPoint: (point: Coordinates) => void,
    options?: { distanceMetres?: number; intervalMs?: number },
  ) => Promise<() => void>
  /** A browser tab stops when it is hidden; a phone can keep the trip's watch alive. */
  readonly canTrackInBackground: boolean
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

export interface PickedFile {
  uri: string
  name: string
  mimeType: string
  /** Bytes; 0 when the platform does not report a size. */
  size: number
}

/**
 * Pick a file and PUT it at a signed upload URL from `files.signUpload`. The app never sees an object
 * key and never talks to the bucket by any other route.
 */
export interface PlatformFiles {
  pick: (options?: { mimeTypes?: readonly string[] }) => Promise<PickedFile | null>
  upload: (
    file: PickedFile | CapturedPhoto,
    signedUrl: string,
    options?: { method?: 'PUT' | 'POST'; headers?: Readonly<Record<string, string>> },
  ) => Promise<void>
  /**
   * The bytes, base64 without a `data:` prefix — for the ONE case `upload` cannot serve.
   *
   * `files.uploadUrl` answers `inline: true` on the local object-storage driver (there is no bucket
   * to PUT to), and the procedures that consume a key then take the bytes on the create call itself:
   * `delivery.deliveries.record`'s `pod[].inline`, `delivery.expenses.record`'s `inline`. A screen
   * cannot do this for itself — `fetch('blob:…')` reads a browser blob and React Native's `fetch`
   * does NOT read a `file://` URI, it uploads an empty body — so the two-line difference lives here
   * with the rest of them.
   *
   * `null` when the file cannot be read. Never throws for being unavailable.
   */
  readBase64: (file: PickedFile | CapturedPhoto) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// haptics
// ---------------------------------------------------------------------------

/**
 * The four confirmations a hand feels through a glove in a godown. Silent where the platform has no
 * haptics — never a fallback beep, never a vibration a browser tab did not earn.
 */
export interface PlatformHaptics {
  tap: () => void
  success: () => void
  warning: () => void
  error: () => void
  readonly available: boolean
}

// ---------------------------------------------------------------------------
// share
// ---------------------------------------------------------------------------

export interface SharePayload {
  title?: string | undefined
  message?: string | undefined
  url?: string | undefined
}

/** Hand a bill or a payment link to WhatsApp. `false` means nothing was shared. */
export interface PlatformShare {
  share: (payload: SharePayload) => Promise<boolean>
  readonly available: boolean
}

// ---------------------------------------------------------------------------
// links
// ---------------------------------------------------------------------------

/**
 * Handing the job to an app the person already knows: the dialler, the map app, WhatsApp.
 *
 * UX-00 §6.15 is explicit that navigating TO a place is never drawn by us — a driver's own map app
 * knows the lanes of Kalyan better than any pin we could render. `mapsUrl` exists because the scheme
 * differs per platform (`geo:` on Android, Apple Maps on iOS, a universal link in a browser) and a
 * screen must not carry that fork. `open` answers `false` where nothing handles the URL; it never
 * throws for being unavailable.
 */
export interface PlatformLinks {
  open: (url: string) => Promise<boolean>
  mapsUrl: (latitude: number, longitude: number, label?: string) => string
  readonly available: boolean
}

// ---------------------------------------------------------------------------
// crypto
// ---------------------------------------------------------------------------

/**
 * Makes `crypto.getRandomValues` exist. Returns whether it is now available.
 *
 * `@dos/domain` is dependency-free by rule (it bundles into Expo unchanged), so `uuidv7()` reads the
 * global and throws when there is none — which on Hermes is every phone. Importing `@dos/ui/platform`
 * calls this once, so the first id an app asks for already works.
 */
export type CryptoInstall = () => boolean

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

/** The three values `auth.login`'s `platform` field takes (`AuthPlatformSchema` in `@dos/contracts`). */
export type PlatformOs = 'web' | 'android' | 'ios'

export interface Platform {
  readonly kind: 'web' | 'native'
  /** What to send as the sign-in platform, so `auth_sessions` can name the device honestly. */
  readonly os: PlatformOs
  readonly storage: PlatformStorage
  readonly documents: PlatformDocuments
  readonly camera: PlatformCamera
  readonly location: PlatformLocation
  readonly files: PlatformFiles
  readonly haptics: PlatformHaptics
  readonly share: PlatformShare
  readonly links: PlatformLinks
}
