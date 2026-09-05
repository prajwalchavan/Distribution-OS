import { createHash, createPublicKey, createVerify, type KeyObject } from 'node:crypto'
import { QrPayloadSchema, type DocumentQrStatus, type QrPayload } from '@dos/contracts'
import { fromRupees, isValidGstin } from '@dos/domain'

/**
 * The e-invoice QR (docs/05 step 1). The IRP prints a JWS on every registered invoice:
 * `base64url(header).base64url(payload).base64url(signature)` where the payload's `data` is a JSON
 * string with ten fields (SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt dd/MM/yyyy, TotInvVal in
 * rupees, ItemCnt, MainHsnCode, Irn, IrnDt). Some billing software prints the bare JSON instead;
 * both are accepted. Nothing here touches the database.
 */

export interface DecodedQr {
  payload: QrPayload
  /** `kid` of the IRP signing key, when the QR was a JWS. */
  kid: string | null
  /** True when the QR carried a signature at all (a bare JSON QR cannot be verified). */
  signed: boolean
  verify(keys: KeyObject[]): boolean
}

interface RawQrData {
  SellerGstin?: unknown
  BuyerGstin?: unknown
  DocNo?: unknown
  DocTyp?: unknown
  DocDt?: unknown
  TotInvVal?: unknown
  ItemCnt?: unknown
  MainHsnCode?: unknown
  Irn?: unknown
  IrnDt?: unknown
}

const b64url = (part: string): Buffer => Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** dd/MM/yyyy (the IRP's format) or an ISO date → ISO date; null when neither. */
export function qrDateToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v)
  return iso ? iso[1] : null
}

/** "2020-12-07 15:31:22" (IST, as the IRP prints it) → an ISO datetime with the +05:30 offset. */
export function qrDateTimeToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value.trim())
  if (m) return `${m[1]}T${m[2]}+05:30`
  const iso = qrDateToIso(value)
  return iso ? `${iso}T00:00:00+05:30` : null
}

function normalisePayload(raw: RawQrData): QrPayload | null {
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const totRupees = raw.TotInvVal
  let totInvValPaise: number | null = null
  try {
    if (typeof totRupees === 'number' || typeof totRupees === 'string')
      totInvValPaise = fromRupees(typeof totRupees === 'number' ? totRupees : String(totRupees))
  } catch {
    totInvValPaise = null
  }
  const candidate = {
    sellerGstin: str(raw.SellerGstin)?.toUpperCase(),
    buyerGstin: str(raw.BuyerGstin)?.toUpperCase(),
    docNo: str(raw.DocNo),
    docTyp: str(raw.DocTyp)?.toUpperCase(),
    docDt: qrDateToIso(raw.DocDt),
    totInvValPaise,
    itemCnt: typeof raw.ItemCnt === 'number' ? raw.ItemCnt : Number(raw.ItemCnt),
    mainHsnCode: str(raw.MainHsnCode) ?? '',
    irn: str(raw.Irn)?.toLowerCase(),
    irnDt: qrDateTimeToIso(raw.IrnDt),
  }
  const parsed = QrPayloadSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/**
 * Decode the QR text. Returns null when it is neither a JWS nor a JSON of the ten fields — a QR that
 * is unreadable is `qr_status = 'absent'` and the pipeline continues on vision (brief §4.17).
 */
export function decodeQr(qrText: string): DecodedQr | null {
  const text = qrText.trim()
  const parts = text.split('.')
  if (parts.length === 3 && parts.every((p) => p.length > 0)) {
    const header = parseJson(b64url(parts[0] ?? '').toString('utf8')) as {
      kid?: unknown
      alg?: unknown
    } | null
    const body = parseJson(b64url(parts[1] ?? '').toString('utf8')) as { data?: unknown } | null
    const data =
      body && typeof body.data === 'string'
        ? (parseJson(body.data) as RawQrData | null)
        : body && typeof body.data === 'object'
          ? (body.data as RawQrData | null)
          : null
    const payload = data ? normalisePayload(data) : null
    if (!payload) return null
    const signedInput = `${parts[0] ?? ''}.${parts[1] ?? ''}`
    const signature = b64url(parts[2] ?? '')
    const alg = typeof header?.alg === 'string' ? header.alg : 'RS256'
    return {
      payload,
      kid: typeof header?.kid === 'string' ? header.kid : null,
      signed: true,
      verify: (keys) =>
        alg === 'RS256' &&
        keys.some((key) => {
          try {
            return createVerify('RSA-SHA256').update(signedInput).end().verify(key, signature)
          } catch {
            return false
          }
        }),
    }
  }
  const bare = parseJson(text) as RawQrData | null
  const payload = bare && typeof bare === 'object' ? normalisePayload(bare) : null
  if (!payload) return null
  return { payload, kid: null, signed: false, verify: () => false }
}

/**
 * The IRP keys from `DOCINT_IRP_KEYS`: a JWKS document (`{ keys: [...] }`) or a bare array of JWKs.
 * Absent or unparsable → an empty list, and every QR stays `decoded`.
 */
export function parseIrpKeys(json: string | null): { kid: string | null; key: KeyObject }[] {
  if (!json) return []
  const parsed = parseJson(json) as { keys?: unknown } | unknown[] | null
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray((parsed as { keys?: unknown }).keys)
      ? ((parsed as { keys: unknown[] }).keys ?? [])
      : []
  const out: { kid: string | null; key: KeyObject }[] = []
  for (const jwk of list) {
    if (!jwk || typeof jwk !== 'object') continue
    try {
      out.push({
        kid: typeof (jwk as { kid?: unknown }).kid === 'string' ? (jwk as { kid: string }).kid : null,
        key: createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }),
      })
    } catch {
      // a malformed key is skipped; the others may still verify
    }
  }
  return out
}

/** `decoded` without keys, `verified` when a key checks the signature, `signature_failed` otherwise. */
export function qrStatusFor(
  decoded: DecodedQr,
  keys: { kid: string | null; key: KeyObject }[],
): DocumentQrStatus {
  if (!decoded.signed || keys.length === 0) return 'decoded'
  const candidates = decoded.kid
    ? keys.filter((k) => k.kid === null || k.kid === decoded.kid)
    : keys
  return decoded.verify(candidates.map((k) => k.key)) ? 'verified' : 'signature_failed'
}

/**
 * The IRN is the SHA-256 of `SellerGstin|FY|DocTyp|DocNo` (the IRP's own derivation), which lets a
 * printed IRN be checked against the printed header when the signature could not be. FY is the
 * Indian financial year label of the invoice date (`2026-27`).
 */
export function irnHash(sellerGstin: string, fy: string, docTyp: string, docNo: string): string {
  return createHash('sha256')
    .update(`${sellerGstin.toUpperCase()}|${fy}|${docTyp.toUpperCase()}|${docNo.toUpperCase()}`)
    .digest('hex')
}

/** Both GSTINs of the QR must at least pass the mod-36 check before the QR is trusted at all. */
export function qrGstinsValid(payload: QrPayload): boolean {
  return isValidGstin(payload.sellerGstin) && isValidGstin(payload.buyerGstin)
}
