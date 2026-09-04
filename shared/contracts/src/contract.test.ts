import { describe, expect, it } from 'vitest'
import { HealthOutputSchema, IdempotencyKeySchema, PaiseSchema, PhoneSchema } from './index.js'

describe('contracts', () => {
  it('rejects floats where paise are required', () => {
    expect(PaiseSchema.safeParse(2116).success).toBe(true)
    expect(PaiseSchema.safeParse(21.16).success).toBe(false)
  })

  it('accepts only Indian mobiles in E.164', () => {
    expect(PhoneSchema.safeParse('+919876543210').success).toBe(true)
    expect(PhoneSchema.safeParse('9876543210').success).toBe(false)
    expect(PhoneSchema.safeParse('+911234567890').success).toBe(false)
  })

  it('requires a usable idempotency key', () => {
    expect(IdempotencyKeySchema.safeParse('short').success).toBe(false)
    expect(IdempotencyKeySchema.safeParse('0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a10').success).toBe(
      true,
    )
  })

  it('validates a health payload', () => {
    expect(
      HealthOutputSchema.safeParse({
        ok: true,
        version: '0.0.0',
        db: 'up',
        time: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })
})
