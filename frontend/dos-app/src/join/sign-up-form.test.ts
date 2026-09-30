/**
 * M1 (blind check of the shopkeeper's sign-up) — a username a shopkeeper might type is answered ON THE FORM, in words,
 * never sent to come back as "Input validation failed". Every payload the form lets through is parsed with the
 * contract's own schema, and every username it lets through passes the rule every login shares (`UsernameSchema`).
 */
import { SignUpInput, UsernameSchema } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Read as SOURCE, like the other app guards: importing the screen in Node pulls in `react-native`. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

import { strings } from '../strings'
import { normalUsername, signUpProblems, usernameProblem, type SignUpFields } from './sign-up-form'

const good: SignUpFields = {
  phone: '98765 43210',
  name: 'Ravi Kumar',
  shopName: 'Ravi General Stores',
  username: 'ravi.kumar',
  password: 'OwnWay2468',
  again: 'OwnWay2468',
}

describe('the sign-up form checks what the server checks', () => {
  it('answers a space, a hyphen, a leading dot and other signs on the field, in words', () => {
    expect(usernameProblem('ravi kumar')).toBe('su.usernameSpace')
    expect(usernameProblem('ravi-kumar')).toBe('su.usernameChars')
    expect(usernameProblem('.ravi')).toBe('su.usernameChars')
    expect(usernameProblem('_ravi')).toBe('su.usernameChars')
    expect(usernameProblem('ravi@shop')).toBe('su.usernameChars')
    expect(usernameProblem('रवि कुमार')).toBe('su.usernameSpace')
    expect(usernameProblem('रविकुमार')).toBe('su.usernameChars')
    expect(usernameProblem('ab')).toBe('su.usernameNeeded')
    expect(usernameProblem('a'.repeat(33))).toBe('su.usernameLong')
    expect(signUpProblems({ ...good, username: 'ravi kumar' })).toEqual({
      username: 'su.usernameSpace',
    })
  })

  it('forgives capitals and spaces around the name, as sign-in does', () => {
    expect(usernameProblem('  Ravi.Kumar_2 ')).toBeNull()
    expect(normalUsername('  Ravi.Kumar_2 ')).toBe('ravi.kumar_2')
  })

  it('lets through only usernames the rule of every login takes', () => {
    const tries = [
      'ravi kumar',
      'ravi-kumar',
      '.ravi',
      '_ravi',
      'ravi.kumar',
      'Ravi_2',
      '9ravi',
      'ab',
      'abc',
      'a'.repeat(32),
      'a'.repeat(33),
      'ravi!',
      'ravi..k',
    ]
    for (const raw of tries) {
      const passes = UsernameSchema.safeParse(raw).success
      expect(usernameProblem(raw) === null, raw).toBe(passes)
    }
  })

  it('has words for every problem it can name', () => {
    const words = strings as Record<string, string>
    for (const key of [
      'su.usernameNeeded',
      'su.usernameLong',
      'su.usernameSpace',
      'su.usernameChars',
      'su.mobileBad',
      'su.nameNeeded',
      'su.shopNeeded',
      'app.passwordRule',
      'app.passwordMismatch',
    ]) {
      expect(words[key], key).toBeTruthy()
    }
  })

  it('sends what the contract takes when the form finds nothing wrong', () => {
    expect(signUpProblems(good)).toEqual({})
    const payload = {
      id: '01a0d0c5-0000-7000-8000-000000000001',
      phone: '+919876543210',
      username: normalUsername(good.username),
      password: good.password,
      name: good.name,
      shopName: good.shopName,
      deviceId: '01a0d0c5-0000-7000-8000-000000000002',
    }
    expect(SignUpInput.safeParse(payload).success).toBe(true)
    expect(UsernameSchema.safeParse(payload.username).success).toBe(true)
  })

  it('holds the password rule and the second typing', () => {
    expect(signUpProblems({ ...good, password: 'short1', again: 'short1' }).password).toBe(
      'app.passwordRule',
    )
    expect(
      signUpProblems({ ...good, password: 'onlyletters', again: 'onlyletters' }).password,
    ).toBe('app.passwordRule')
    expect(signUpProblems({ ...good, again: 'OwnWay2469' }).again).toBe('app.passwordMismatch')
  })

  it('is what the sign-up screen checks before it sends anything', async () => {
    const screen = await read('../../app/sign-up.tsx')
    expect({
      usesTheChecks:
        /signUpProblems\(\{ phone, name, shopName, username, password, again \}\)/.test(screen),
      sendsTheNormalName: /username: normalUsername\(username\)/.test(screen),
      noLengthOnlyCheck: /username\.trim\(\)\.length < 3/.test(screen),
    }).toEqual({ usesTheChecks: true, sendsTheNormalName: true, noLengthOnlyCheck: false })
  })
})
