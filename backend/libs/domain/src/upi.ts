/**
 * The UPI intent — `upi://pay?pa=<vpa>&pn=<payee>&am=<rupees>&tr=<ref>[&tn=<note>]&cu=INR` — as one full
 * URI, printed as a QR on a bill and handed to a UPI app as a deep link. Pure string work with no
 * dependencies, so billing (a bill's QR), receivables (a shop's own payment intent) and the apps build
 * it the same way.
 *
 * The payee is the DISTRIBUTOR's own display name (docs/17 §D6). Returns null — never an invented VPA —
 * when the tenant has not configured one, or when there is nothing to pay: a QR that pays the wrong person
 * is far worse than no QR.
 *
 * `note` becomes `tn`, the field a person-to-person payee's app and bank statement show; `tr` is a merchant
 * reference. Without a note the output is exactly what billing has always printed.
 */
export function upiIntent(i: {
  vpa: string | null
  payeeName: string
  amountPaise: number
  reference: string | null
  note?: string | null
}): string | null {
  if (!i.vpa || i.amountPaise <= 0) return null
  const amount = (i.amountPaise / 100).toFixed(2)
  const params = [
    `pa=${encodeURIComponent(i.vpa)}`,
    `pn=${encodeURIComponent(i.payeeName)}`,
    `am=${amount}`,
    ...(i.reference ? [`tr=${encodeURIComponent(i.reference.replace(/\//g, '-'))}`] : []),
    ...(i.note ? [`tn=${encodeURIComponent(i.note)}`] : []),
    'cu=INR',
  ]
  return `upi://pay?${params.join('&')}`
}
