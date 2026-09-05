import {
  digitsOnly,
  readJson,
  type FetchLike,
  type MessageProvider,
  type ProviderSendRequest,
  type ProviderSendResult,
} from './provider.types.js'

/**
 * MSG91 transactional SMS (route 4) through the v2 `sendsms` endpoint: the rendered body goes out as
 * is under the platform's DLT-registered sender header. A DLT template id (`dltTemplateId`) is
 * carried when the account has one registered for the wording. The SMS fallback exists so a shop
 * that never opted into WhatsApp still gets its bill (docs/17 A6) — never a silent drop.
 *
 * MSG91 answers `{ type: 'success', message: '<request id>' }` on acceptance and `{ type: 'error',
 * message: '…' }` otherwise; an `error` type on a 2xx is a permanent refusal (a bad number, a blocked
 * header), an HTTP 5xx / 429 or a thrown fetch is retried on the backoff schedule.
 */
export interface SmsProviderOptions {
  authKey: string
  /** The 6-character DLT sender id (header). */
  senderId: string
  route?: string | undefined
  country?: string | undefined
  dltTemplateId?: string | undefined
  baseUrl?: string | undefined
  costPaise?: number | undefined
  timeoutMs?: number | undefined
  fetch?: FetchLike | undefined
}

export const MSG91_BASE_URL = 'https://api.msg91.com'

export class Msg91SmsProvider implements MessageProvider {
  readonly name = 'msg91-sms'
  readonly channel = 'sms' as const
  private readonly fetchImpl: FetchLike

  constructor(private readonly options: SmsProviderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  /** The exact request MSG91 receives, exposed so a unit test asserts the shape without a network. */
  buildRequest(request: ProviderSendRequest): {
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
  } {
    const base = (this.options.baseUrl ?? MSG91_BASE_URL).replace(/\/$/, '')
    return {
      url: `${base}/api/v2/sendsms`,
      headers: { authkey: this.options.authKey, 'content-type': 'application/json' },
      body: {
        sender: this.options.senderId,
        route: this.options.route ?? '4',
        country: this.options.country ?? '91',
        unicode: '1',
        ...(this.options.dltTemplateId ? { DLT_TE_ID: this.options.dltTemplateId } : {}),
        sms: [{ message: request.body ?? '', to: [digitsOnly(request.to)] }],
      },
    }
  }

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (!request.body || request.body.trim().length === 0) {
      return { ok: false, error: 'sms: the message has no rendered body', retryable: false }
    }
    if (digitsOnly(request.to).length < 10) {
      return { ok: false, error: `sms: invalid destination number ${request.to}`, retryable: false }
    }
    const built = this.buildRequest(request)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000)
    try {
      const res = await this.fetchImpl(built.url, {
        method: 'POST',
        headers: built.headers,
        body: JSON.stringify(built.body),
        signal: controller.signal,
      })
      const json = (await readJson(res)) as { type?: string; message?: string } | null
      if (res.status >= 200 && res.status < 300) {
        if (
          json?.type === 'success' &&
          typeof json.message === 'string' &&
          json.message.length > 0
        ) {
          return {
            ok: true,
            providerMessageId: json.message,
            costPaise: this.options.costPaise ?? 20,
          }
        }
        return {
          ok: false,
          error: `sms: ${json?.message ?? 'MSG91 refused the message'}`,
          retryable: false,
        }
      }
      return {
        ok: false,
        error: `sms: ${json?.message ?? `HTTP ${String(res.status)}`}`,
        retryable: res.status === 429 || res.status >= 500,
      }
    } catch (error) {
      return {
        ok: false,
        error: `sms: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
