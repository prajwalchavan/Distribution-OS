import type { SellerBranding } from '@dos/contracts'
import type { Sheet } from '../layout.js'
import { addressLines, type JpegImage } from '../pdf.js'

/** Copies GST wants printed on a goods invoice. */
export const COPY_LABELS: Record<string, string> = {
  original: 'Original for Recipient',
  duplicate: 'Duplicate for Transporter',
  triplicate: 'Triplicate for Supplier',
}

/**
 * THE WHITE-LABEL HEADER (docs/17 §D6, docs/22 never-list 10): the DISTRIBUTOR's own logo, name,
 * address, GSTIN and FSSAI at the top of every document, and never "Distribution OS" anywhere on it.
 * `title` sits on the right with the copy label under it.
 */
export function sellerHeader(
  sheet: Sheet,
  seller: SellerBranding,
  logo: JpegImage | null,
  title: string,
  subtitle: string | null,
): void {
  const top = sheet.y
  let textLeft = sheet.left
  if (logo) {
    const h = sheet.logo(logo, sheet.left, top, 90, 44)
    textLeft =
      sheet.left + Math.min(90, logo.width * Math.min(90 / logo.width, 44 / logo.height, 1)) + 8
    void h
  }
  const nameSize = 13
  sheet.pdf.text(textLeft, top + nameSize, seller.displayName, { font: 'bold', size: nameSize })
  let y = top + nameSize + 4
  const lines = [
    seller.displayName !== seller.legalName ? seller.legalName : null,
    ...addressLines(seller.address),
    seller.gstin ? `GSTIN ${seller.gstin}` : null,
    seller.fssai ? `FSSAI ${seller.fssai}` : null,
  ].filter((l): l is string => Boolean(l))
  for (const line of lines) {
    y += 10.5
    sheet.pdf.text(textLeft, y, line, { size: 8, gray: 0.25 })
  }
  sheet.pdf.text(sheet.right, top + 14, title, { font: 'bold', size: 14, align: 'right' })
  if (subtitle)
    sheet.pdf.text(sheet.right, top + 26, subtitle, { size: 8, align: 'right', gray: 0.35 })
  sheet.y = Math.max(y + 8, top + 48, logo ? top + 52 : 0)
  sheet.hr({ gray: 0.2, width: 0.8 })
  sheet.space(2)
}

/** Narrow (80 mm) header: centred name, then the address lines. */
export function thermalHeader(sheet: Sheet, seller: SellerBranding, title: string): void {
  sheet.text(seller.displayName, { font: 'bold', size: 11, align: 'center' })
  for (const line of addressLines(seller.address))
    sheet.text(line, { size: 7.5, align: 'center', gray: 0.3 })
  if (seller.gstin) sheet.text(`GSTIN ${seller.gstin}`, { size: 7.5, align: 'center', gray: 0.3 })
  if (seller.fssai) sheet.text(`FSSAI ${seller.fssai}`, { size: 7.5, align: 'center', gray: 0.3 })
  sheet.space(2)
  sheet.text(title, { font: 'bold', size: 10, align: 'center' })
  sheet.hr()
}

export function footer(sheet: Sheet, seller: SellerBranding, extra: string | null = null): void {
  sheet.space(6)
  if (seller.invoiceFooter) sheet.paragraph(seller.invoiceFooter, { size: 7.5, gray: 0.3 })
  if (extra) sheet.paragraph(extra, { size: 7.5, gray: 0.3 })
  sheet.space(14)
  sheet.text(`For ${seller.displayName}`, { size: 8.5, align: 'right' })
  sheet.space(18)
  sheet.text('Authorised signatory', { size: 8, align: 'right', gray: 0.35 })
}

/** `2 cs + 3 pcs` from pieces and a case size; plain pieces when there is no case. */
export function qtyText(qtyPcs: number, caseSize: number | null): string {
  if (!caseSize || caseSize <= 1) return `${String(qtyPcs)} pcs`
  const cases = Math.floor(qtyPcs / caseSize)
  const loose = qtyPcs % caseSize
  if (cases === 0) return `${String(loose)} pcs`
  return loose === 0 ? `${String(cases)} cs` : `${String(cases)} cs + ${String(loose)} pcs`
}
