import type { Locale } from '../notifications.internals.js'

/**
 * The small typed interface every outbound channel sits behind (brief §4.14). The dispatch sweep
 * hands a provider one queued row's frozen payload and records what came back; it never knows
 * whether the other side is Meta, MSG91 or the deterministic stub, and nothing in a request path
 * ever calls `send` (queue, then dispatch — docs/20 rule 3).
 */
export type ProviderChannel = 'whatsapp' | 'sms' | 'push'

export interface ProviderSendRequest {
  messageId: string
  tenantId: string
  channel: ProviderChannel
  /** E.164 phone for WhatsApp / SMS; the device token for push. */
  to: string
  locale: Locale
  /** The rendered text (SMS and push send it as is; WhatsApp sends the approved template instead). */
  body: string | null
  /** The name Meta approved the WhatsApp template under; null on the other channels. */
  providerTemplateName: string | null
  /** Positional parameter values in the template's `{{n}}` order (first appearance in the body). */
  parameters: string[]
  /** The tenant's own WhatsApp sender (`whatsapp.phone_number_id`) when it has one; else the platform's. */
  senderId?: string | null | undefined
}

export type ProviderSendResult =
  | { ok: true; providerMessageId: string; costPaise: number }
  | {
      ok: false
      error: string
      /** false = the provider says this will never work (bad number, unknown template): stop retrying. */
      retryable: boolean
      costPaise?: number | undefined
    }

export interface MessageProvider {
  readonly name: string
  readonly channel: ProviderChannel
  send(request: ProviderSendRequest): Promise<ProviderSendResult>
}

export interface ProviderSet {
  whatsapp: MessageProvider
  sms: MessageProvider
  push: MessageProvider
}

/** A `fetch` the real adapters call; injected by the unit tests so no test ever reaches a network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>

/** WhatsApp / SMS phone numbers travel as digits with the country code and no `+`. */
export function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, '')
}

/** `en-IN` → `en`, the language code Meta's template `language.code` and MSG91 expect. */
export function languageCode(locale: Locale): string {
  return locale.split('-')[0] ?? 'en'
}

/** Read a JSON response body without throwing on a non-JSON error page. */
export async function readJson(res: { text(): Promise<string> }): Promise<unknown> {
  const text = await res.text()
  if (text.trim().length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text.slice(0, 500) }
  }
}
