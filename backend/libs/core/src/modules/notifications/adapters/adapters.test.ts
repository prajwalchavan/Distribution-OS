import { describe, expect, it } from 'vitest'
import type { FetchLike, ProviderSendRequest } from './provider.types.js'
import { createProviders } from './index.js'
import { Msg91SmsProvider } from './sms.adapter.js'
import { StubProvider, stubMessageId } from './stub.adapter.js'
import { MetaWhatsAppProvider } from './whatsapp.adapter.js'

/**
 * The provider adapters, exercised with a fake `fetch` (brief §4.14): what leaves for Meta and MSG91
 * is asserted byte for byte; nothing here opens a socket.
 */
const request: ProviderSendRequest = {
  messageId: '01920000-0000-7000-8000-00000000abcd',
  tenantId: '01a06c94-5a6c-752a-ab3c-65716a47362f',
  channel: 'whatsapp',
  to: '+91 98100 00101',
  locale: 'en-IN',
  body: 'Hi Shree Ganesh Kirana, your bill INV/26-27/0042 for ₹1,234.50 is issued. — Tarsun Enterprises',
  providerTemplateName: 'invoice_issued_en',
  parameters: ['Shree Ganesh Kirana', 'INV/26-27/0042', '₹1,234.50', 'Tarsun Enterprises'],
  senderId: null,
}

interface Captured {
  url: string
  init: { method: string; headers: Record<string, string>; body: string }
}

function fakeFetch(status: number, reply: unknown): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = []
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(reply)) })
  }
  return { fetch, calls }
}

describe('Meta WhatsApp Cloud API adapter', () => {
  it('posts a template message with positional body parameters to the sender number', async () => {
    const { fetch, calls } = fakeFetch(200, { messages: [{ id: 'wamid.HBgL' }] })
    const provider = new MetaWhatsAppProvider({
      accessToken: 'EAAG-test-token',
      phoneNumberId: '100000000000001',
      fetch,
    })
    const result = await provider.send(request)
    expect(result).toEqual({ ok: true, providerMessageId: 'wamid.HBgL', costPaise: 14 })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://graph.facebook.com/v21.0/100000000000001/messages')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.headers).toEqual({
      authorization: 'Bearer EAAG-test-token',
      'content-type': 'application/json',
    })
    expect(JSON.parse(call?.init.body ?? '{}')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919810000101',
      type: 'template',
      template: {
        name: 'invoice_issued_en',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Shree Ganesh Kirana' },
              { type: 'text', text: 'INV/26-27/0042' },
              { type: 'text', text: '₹1,234.50' },
              { type: 'text', text: 'Tarsun Enterprises' },
            ],
          },
        ],
      },
    })
  })

  it("sends from the tenant's own phone number id when it has one, in the shop's language", () => {
    const provider = new MetaWhatsAppProvider({ accessToken: 't', phoneNumberId: 'platform' })
    const built = provider.buildRequest({
      ...request,
      senderId: '200000000000002',
      locale: 'mr-IN',
      parameters: [],
    })
    expect(built.url).toBe('https://graph.facebook.com/v21.0/200000000000002/messages')
    const body = built.body as { template: { language: { code: string }; components: unknown[] } }
    expect(body.template.language.code).toBe('mr')
    expect(body.template.components).toEqual([])
  })

  it('treats a 4xx as permanent and a 5xx / 429 / thrown fetch as retryable', async () => {
    const bad = new MetaWhatsAppProvider({
      accessToken: 't',
      phoneNumberId: 'p',
      fetch: fakeFetch(400, { error: { message: 'Invalid parameter', code: 100 } }).fetch,
    })
    expect(await bad.send(request)).toEqual({
      ok: false,
      error: 'whatsapp: Invalid parameter (code 100)',
      retryable: false,
    })
    const throttled = new MetaWhatsAppProvider({
      accessToken: 't',
      phoneNumberId: 'p',
      fetch: fakeFetch(429, { error: { message: 'Too many' } }).fetch,
    })
    expect((await throttled.send(request)).ok).toBe(false)
    expect((await throttled.send(request)) as { retryable: boolean }).toMatchObject({
      retryable: true,
    })
    const down = new MetaWhatsAppProvider({
      accessToken: 't',
      phoneNumberId: 'p',
      fetch: () => Promise.reject(new Error('ECONNRESET')),
    })
    expect(await down.send(request)).toEqual({
      ok: false,
      error: 'whatsapp: ECONNRESET',
      retryable: true,
    })
  })

  it('refuses without a provider template name or a usable number, without calling out', async () => {
    const { fetch, calls } = fakeFetch(200, {})
    const provider = new MetaWhatsAppProvider({ accessToken: 't', phoneNumberId: 'p', fetch })
    const noTemplate = await provider.send({ ...request, providerTemplateName: null })
    expect(noTemplate).toMatchObject({ ok: false, retryable: false })
    const noNumber = await provider.send({ ...request, to: '12345' })
    expect(noNumber).toMatchObject({ ok: false, retryable: false })
    expect(calls).toHaveLength(0)
  })
})

describe('MSG91 SMS adapter', () => {
  it('posts the rendered body on the transactional route under the DLT sender header', async () => {
    const { fetch, calls } = fakeFetch(200, {
      type: 'success',
      message: '3763646c3058373530393938',
    })
    const provider = new Msg91SmsProvider({
      authKey: 'msg91-auth-key',
      senderId: 'DSTOSX',
      dltTemplateId: '1207160000000000001',
      fetch,
    })
    const result = await provider.send({ ...request, channel: 'sms', providerTemplateName: null })
    expect(result).toEqual({
      ok: true,
      providerMessageId: '3763646c3058373530393938',
      costPaise: 20,
    })
    const call = calls[0]
    expect(call?.url).toBe('https://api.msg91.com/api/v2/sendsms')
    expect(call?.init.headers).toEqual({
      authkey: 'msg91-auth-key',
      'content-type': 'application/json',
    })
    expect(JSON.parse(call?.init.body ?? '{}')).toEqual({
      sender: 'DSTOSX',
      route: '4',
      country: '91',
      unicode: '1',
      DLT_TE_ID: '1207160000000000001',
      sms: [{ message: request.body, to: ['919810000101'] }],
    })
  })

  it('reads an MSG91 error type on a 2xx as a permanent refusal and a 5xx as retryable', async () => {
    const refused = new Msg91SmsProvider({
      authKey: 'k',
      senderId: 'S',
      fetch: fakeFetch(200, { type: 'error', message: 'invalid destination number' }).fetch,
    })
    expect(await refused.send({ ...request, channel: 'sms' })).toEqual({
      ok: false,
      error: 'sms: invalid destination number',
      retryable: false,
    })
    const down = new Msg91SmsProvider({
      authKey: 'k',
      senderId: 'S',
      fetch: fakeFetch(503, null).fetch,
    })
    expect(await down.send({ ...request, channel: 'sms' })).toEqual({
      ok: false,
      error: 'sms: HTTP 503',
      retryable: true,
    })
  })

  it('never sends an empty body', async () => {
    const { fetch, calls } = fakeFetch(200, {})
    const provider = new Msg91SmsProvider({ authKey: 'k', senderId: 'S', fetch })
    expect(await provider.send({ ...request, channel: 'sms', body: '' })).toMatchObject({
      ok: false,
      retryable: false,
    })
    expect(calls).toHaveLength(0)
  })
})

describe('the stub and the factory', () => {
  it('answers deterministically with a realistic cost, and fails on request', async () => {
    const stub = new StubProvider('whatsapp')
    const first = await stub.send(request)
    expect(first).toEqual({
      ok: true,
      providerMessageId: stubMessageId('whatsapp', request),
      costPaise: 14,
    })
    expect(await stub.send(request)).toEqual(first)
    expect(await new StubProvider('sms').send(request)).toMatchObject({ costPaise: 20 })
    const failing = new StubProvider('sms', { fail: () => 'MSG91: invalid destination number' })
    expect(await failing.send(request)).toEqual({
      ok: false,
      error: 'MSG91: invalid destination number',
      retryable: true,
      costPaise: 0,
    })
  })

  it('picks the real adapters only with credentials, and never under NODE_ENV=test', () => {
    const none = createProviders({})
    expect(none.whatsapp.name).toBe('stub-whatsapp')
    expect(none.sms.name).toBe('stub-sms')
    expect(none.push.name).toBe('stub-push')
    const real = createProviders({
      NODE_ENV: 'development',
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      MSG91_AUTH_KEY: 'k',
      MSG91_SENDER_ID: 'DSTOSX',
    })
    expect(real.whatsapp.name).toBe('meta-whatsapp-cloud')
    expect(real.sms.name).toBe('msg91-sms')
    const test = createProviders({
      NODE_ENV: 'test',
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      MSG91_AUTH_KEY: 'k',
      MSG91_SENDER_ID: 'DSTOSX',
    })
    expect(test.whatsapp.name).toBe('stub-whatsapp')
    expect(test.sms.name).toBe('stub-sms')
  })
})
