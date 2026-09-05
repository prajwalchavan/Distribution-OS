import type { FetchLike, ProviderSet } from './provider.types.js'
import { Msg91SmsProvider } from './sms.adapter.js'
import { StubProvider } from './stub.adapter.js'
import { MetaWhatsAppProvider } from './whatsapp.adapter.js'

/**
 * Which provider each channel gets, from the environment (docs/26): the real Meta / MSG91 client only
 * when its credentials are set, the deterministic stub otherwise, and ALWAYS the stub under
 * `NODE_ENV=test` — specs and `pnpm smoke` never reach a network. Push is stubbed in this slice (the
 * staff apps register tokens; the FCM/Expo sender is a later addition on the same interface).
 *
 *   WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID   → Meta Cloud API (WHATSAPP_COST_PAISE, default 14)
 *   MSG91_AUTH_KEY + MSG91_SENDER_ID                   → MSG91 (MSG91_ROUTE 4, MSG91_DLT_TEMPLATE_ID, SMS_COST_PAISE 20)
 */
export interface CreateProvidersOptions {
  fetch?: FetchLike | undefined
}

export function createProviders(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateProvidersOptions = {},
): ProviderSet {
  const test = env.NODE_ENV === 'test'
  const whatsappToken = env.WHATSAPP_ACCESS_TOKEN?.trim()
  const whatsappNumber = env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const msg91Key = env.MSG91_AUTH_KEY?.trim()
  const msg91Sender = env.MSG91_SENDER_ID?.trim()
  const whatsapp =
    !test && whatsappToken && whatsappNumber
      ? new MetaWhatsAppProvider({
          accessToken: whatsappToken,
          phoneNumberId: whatsappNumber,
          apiVersion: env.WHATSAPP_API_VERSION?.trim() || undefined,
          costPaise: positiveInt(env.WHATSAPP_COST_PAISE),
          fetch: options.fetch,
        })
      : new StubProvider('whatsapp')
  const sms =
    !test && msg91Key && msg91Sender
      ? new Msg91SmsProvider({
          authKey: msg91Key,
          senderId: msg91Sender,
          route: env.MSG91_ROUTE?.trim() || undefined,
          dltTemplateId: env.MSG91_DLT_TEMPLATE_ID?.trim() || undefined,
          costPaise: positiveInt(env.SMS_COST_PAISE),
          fetch: options.fetch,
        })
      : new StubProvider('sms')
  return { whatsapp, sms, push: new StubProvider('push') }
}

function positiveInt(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/** Every channel on the stub, with an optional forced failure — what specs use. */
export function stubProviders(
  options: ConstructorParameters<typeof StubProvider>[1] = {},
): ProviderSet {
  return {
    whatsapp: new StubProvider('whatsapp', options),
    sms: new StubProvider('sms', options),
    push: new StubProvider('push', options),
  }
}

export { StubProvider, STUB_COST_PAISE, stubMessageId } from './stub.adapter.js'
export {
  MetaWhatsAppProvider,
  WHATSAPP_API_VERSION,
  WHATSAPP_BASE_URL,
} from './whatsapp.adapter.js'
export { Msg91SmsProvider, MSG91_BASE_URL } from './sms.adapter.js'
export type {
  FetchLike,
  MessageProvider,
  ProviderChannel,
  ProviderSendRequest,
  ProviderSendResult,
  ProviderSet,
} from './provider.types.js'
export { digitsOnly, languageCode } from './provider.types.js'
