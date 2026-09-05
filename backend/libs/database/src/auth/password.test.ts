import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  normalizeUsername,
  USERNAME_REGEX,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './password.js'

describe('password', () => {
  it('round-trips a password through argon2id and rejects everything else', async () => {
    const hash = await hashPassword('Dos@1234')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(hash, 'Dos@1234')).toBe(true)
    expect(await verifyPassword(hash, 'dos@1234')).toBe(false)
    // a malformed hash is "not this password", never an exception
    expect(await verifyPassword('not-a-hash', 'Dos@1234')).toBe(false)
  })

  it('enforces 8–72 characters with a letter and a digit', () => {
    expect(validatePassword('Dos@1234')).toBeNull()
    expect(validatePassword('short1')).toMatch(/at least 8/)
    expect(validatePassword(`${'a'.repeat(72)}1`)).toMatch(/at most 72/)
    expect(validatePassword('alphabetsonly')).toMatch(/digit/)
    expect(validatePassword('12345678')).toMatch(/letter/)
  })
})

describe('username', () => {
  it('normalises to trimmed lowercase', () => {
    expect(normalizeUsername('  Sunil.Tarsun ')).toBe('sunil.tarsun')
  })

  it('accepts 3–32 chars of [a-z0-9._] starting with a letter or digit', () => {
    expect(USERNAME_REGEX.test('dinesh.patil')).toBe(true)
    expect(USERNAME_REGEX.test('7up_guy')).toBe(true)
    expect(USERNAME_REGEX.test('.leading')).toBe(false)
    expect(USERNAME_REGEX.test('ab')).toBe(false)
    expect(USERNAME_REGEX.test('a'.repeat(33))).toBe(false)
    expect(USERNAME_REGEX.test('has space')).toBe(false)
  })

  it('validates the normalised form, so mixed case is accepted and lowered', () => {
    expect(validateUsername(' Vikas.Kadam ')).toBeNull()
    expect(validateUsername('ab')).toMatch(/3–32/)
    expect(validateUsername('bad!name')).toMatch(/lowercase letters/)
  })
})
