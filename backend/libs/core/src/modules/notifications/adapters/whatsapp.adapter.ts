import {
  digitsOnly,
  languageCode,
  readJson,
  type FetchLike,
  type MessageProvider,
  type ProviderSendRequest,
  type ProviderSendResult,
} from './provider.types.js'

/**
 * Meta WhatsApp Cloud API, template messages (brief §8.5: direct, no BSP fee). One platform WhatsApp
 * Business Account for the pilot; a tenant with its own `whatsapp.phone_number_id` sends from that
 * number (`request.senderId`), everyone else from `phoneNumberId`. Every outbound message is a
 * pre-approved TEMPLATE — Meta allows those any time, so the 24-hour session window is never a gate
 * here (brief §4.3). The body parameters are the message's positional values in the order the
 * template body names them (`payload.variableNames`).
 *
 * Errors: a 4xx other than 429 is the request's fault (an unknown template, an invalid number) and is
 * NOT retried — the row dead-letters at once with Meta's own message so the owner can read it; 429
 * and 5xx are retried on the backoff schedule; a thrown fetch (DNS, timeout) likewise.
 */
export interface WhatsAppProviderOptions {
  accessToken: string
  phoneNumberId: string
  apiVersion?: string | undefined
  baseUrl?: string | undefined
  /** What one utility template costs, recorded on the row (₹0.136 → 14 paise). */
  costPaise?: number | undefined
  timeoutMs?: number | undefined
  fetch?: FetchLike | undefined
}

export const WHATSAPP_API_VERSION = 'v21.0'
export const WHATSAPP_BASE_URL = 'https://graph.facebook.com'

export class MetaWhatsAppProvider implements MessageProvider {
  readonly name = 'meta-whatsapp-cloud'
  readonly channel = 'whatsapp' as const
  private readonly fetchImpl: FetchLike

  constructor(private readonly options: WhatsAppProviderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  /** The exact request Meta receives, exposed so a unit test asserts the shape without a network. */
  buildRequest(request: ProviderSendRequest): {
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
  } {
    const sender = request.senderId ?? this.options.phoneNumberId
    const version = this.options.apiVersion ?? WHATSAPP_API_VERSION
    const base = (this.options.baseUrl ?? WHATSAPP_BASE_URL).replace(/\/$/, '')
    const components =
      request.parameters.length > 0
        ? [
            {
              type: 'body',
              parameters: request.parameters.map((text) => ({ type: 'text', text })),
            },
          ]
        : []
    return {
      url: `${base}/${version}/${sender}/messages`,
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        'content-type': 'application/json',
      },
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: digitsOnly(request.to),
        type: 'template',
        template: {
          name: request.providerTemplateName,
          language: { code: languageCode(request.locale) },
          components,
        },
      },
    }
  }

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (!request.providerTemplateName) {
      return {
        ok: false,
        error: 'whatsapp: the template has no approved provider template name',
        retryable: false,
      }
    }
    if (digitsOnly(request.to).length < 10) {
      return {
        ok: false,
        error: `whatsapp: invalid destination number ${request.to}`,
        retryable: false,
      }
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
      const json = (await readJson(res)) as {
        messages?: { id?: string }[]
        error?: { message?: string; code?: number }
      } | null
      if (res.status >= 200 && res.status < 300) {
        const id = json?.messages?.[0]?.id
        if (!id)
          return { ok: false, error: 'whatsapp: no message id in the reply', retryable: true }
        return { ok: true, providerMessageId: id, costPaise: this.options.costPaise ?? 14 }
      }
      const message = json?.error?.message ?? `HTTP ${String(res.status)}`
      const code = json?.error?.code
      return {
        ok: false,
        error: `whatsapp: ${message}${code !== undefined ? ` (code ${String(code)})` : ''}`,
        retryable: res.status === 429 || res.status >= 500,
      }
    } catch (error) {
      return {
        ok: false,
        error: `whatsapp: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
