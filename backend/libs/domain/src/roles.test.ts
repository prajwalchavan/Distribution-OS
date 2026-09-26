import { describe, expect, it } from 'vitest'
import { electionRefusal } from './roles.js'

describe('electionRefusal', () => {
  it('DOS-210: says "an accountant" and "an owner", never "a accountant"', () => {
    expect(
      electionRefusal({
        distributor: 'Tarsun Enterprise',
        membershipRole: 'accountant',
        actAs: 'manager',
      }),
    ).toBe('Your login at Tarsun Enterprise is an accountant; ask the owner to add manager to it.')
    expect(
      electionRefusal({ distributor: 'Tarsun', membershipRole: 'owner', actAs: 'platform_admin' }),
    ).toBe('Your login at Tarsun is an owner; ask the owner to add platform_admin to it.')
  })

  it('keeps "a" before a consonant, the sentence docs/29 §2 states', () => {
    for (const role of ['manager', 'salesperson', 'warehouse', 'delivery', 'retailer']) {
      expect(electionRefusal({ distributor: 'Tarsun', membershipRole: role, actAs: 'x' })).toBe(
        `Your login at Tarsun is a ${role}; ask the owner to add x to it.`,
      )
    }
  })
})
