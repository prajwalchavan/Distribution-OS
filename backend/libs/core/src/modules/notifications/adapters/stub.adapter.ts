import { createHash } from 'node:crypto'
import type {
  MessageProvider,
  ProviderChannel,
  ProviderSendRequest,
  ProviderSendResult,
} from './provider.types.js'

/**
 * The deterministic provider: the default whenever a channel has no credentials, and the only one a
 * spec or `pnpm smoke` ever reaches (brief §4.14, the same "stub until credentials exist" posture as
 * billing's IRN). A stub send "succeeds" with a provider id derived from the message id, so the same
 * row always gets the same id and a demo log looks real, and it records the channel's realistic
 * cost: ₹0.136 per WhatsApp utility template (docs/10) rounded to 14 paise, a flat 20 paise SMS,
 * nothing for push. `fail` lets a spec force a failure ("MSG91: invalid destination number") to
 * exercise the backoff and the dead letter.
 */
export const STUB_COST_PAISE: Readonly<Record<ProviderChannel, number>> = {
  whatsapp: 14,
  sms: 20,
  push: 0,
}

export interface StubProviderOptions {
  costPaise?: number | undefined
  /** Return an error message to fail this send (retryable unless `permanent` is true); null to succeed. */
  fail?: ((request: ProviderSendRequest) => string | null) | undefined
  permanent?: boolean | undefined
}

export class StubProvider implements MessageProvider {
  readonly name: string
  constructor(
    readonly channel: ProviderChannel,
    private readonly options: StubProviderOptions = {},
  ) {
    this.name = `stub-${channel}`
  }

  send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    const error = this.options.fail?.(request) ?? null
    const costPaise = this.options.costPaise ?? STUB_COST_PAISE[this.channel]
    if (error !== null) {
      return Promise.resolve({ ok: false, error, retryable: !this.options.permanent, costPaise: 0 })
    }
    return Promise.resolve({
      ok: true,
      providerMessageId: stubMessageId(this.channel, request),
      costPaise,
    })
  }
}

export function stubMessageId(channel: ProviderChannel, request: { messageId: string }): string {
  const digest = createHash('sha1').update(`${channel}:${request.messageId}`).digest('hex')
  return `stub-${channel}-${digest.slice(0, 16)}`
}
