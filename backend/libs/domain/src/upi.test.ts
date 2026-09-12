import { describe, expect, it } from 'vitest'
import { upiIntent } from './upi.js'

/** The query keys of a `upi://pay?…` intent, in the order they are written. */
function keysOf(url: string): string[] {
  return url
    .slice('upi://pay?'.length)
    .split('&')
    .map((part) => part.slice(0, part.indexOf('=')))
}

describe('upiIntent', () => {
  it('DOS-094: upiIntent emits one upi://pay? prefix, am from paise, tr with slashes as dashes, tn only when a note is given, and null without a VPA', () => {
    const base = { vpa: 'tarsun@upi', payeeName: 'Tarsun Enterprise', reference: null }

    // one scheme prefix, never two
    const one = upiIntent({ ...base, amountPaise: 1 }) ?? ''
    expect(one.startsWith('upi://pay?pa=')).toBe(true)
    expect(one.split('upi://pay?')).toHaveLength(2)

    // the amount is rupees with two decimals, built from integer paise
    expect(one).toContain('&am=0.01&')
    expect(upiIntent({ ...base, amountPaise: 456_100 })).toContain('&am=4561.00&')
    expect(upiIntent({ ...base, amountPaise: 3_584_300 })).toContain('&am=35843.00&')

    // the payee's VPA and name are percent-encoded, so an `&` in a shop name cannot split a field
    const named = upiIntent({ ...base, payeeName: 'Shree Ganesh & Sons', amountPaise: 100 }) ?? ''
    expect(named).toContain('pa=tarsun%40upi&')
    expect(named).toContain('&pn=Shree%20Ganesh%20%26%20Sons&')

    // a reference's slashes become dashes; no reference, no `tr`
    expect(upiIntent({ ...base, amountPaise: 100, reference: 'INV/2026-27/0433' })).toContain(
      '&tr=INV-2026-27-0433&',
    )
    expect(one).not.toContain('tr=')

    // `tn` only when a note is given, written after `tr` and before `cu`
    expect(one).not.toContain('tn=')
    expect(upiIntent({ ...base, amountPaise: 100, note: null })).not.toContain('tn=')
    const noted =
      upiIntent({
        ...base,
        amountPaise: 3_584_300,
        reference: 'PAY-9520ecba4571',
        note: 'PAY-9520ecba4571',
      }) ?? ''
    expect(keysOf(noted)).toEqual(['pa', 'pn', 'am', 'tr', 'tn', 'cu'])
    expect(noted).toBe(
      'upi://pay?pa=tarsun%40upi&pn=Tarsun%20Enterprise&am=35843.00&tr=PAY-9520ecba4571&tn=PAY-9520ecba4571&cu=INR',
    )

    // never an invented payee, never a zero or negative request
    expect(upiIntent({ ...base, vpa: null, amountPaise: 100 })).toBeNull()
    expect(upiIntent({ ...base, vpa: '', amountPaise: 100 })).toBeNull()
    expect(upiIntent({ ...base, amountPaise: 0 })).toBeNull()
    expect(upiIntent({ ...base, amountPaise: -100 })).toBeNull()

    // without a note the output is byte-for-byte what billing prints on a bill's QR today
    expect(
      upiIntent({
        vpa: 'tarsun@okhdfcbank',
        payeeName: 'M/s. Tarsun Enterprise',
        amountPaise: 547_200,
        reference: 'INV/0753',
      }),
    ).toBe(
      'upi://pay?pa=tarsun%40okhdfcbank&pn=M%2Fs.%20Tarsun%20Enterprise&am=5472.00&tr=INV-0753&cu=INR',
    )
  })
})
