/**
 * `@dos/core/documents` — the PDF renderer the worker calls (docs/23 §8.2, §8.20 item 4). Plain
 * functions, no Nest DI. See `render.ts` for the contract and `pdf.ts` for the writer.
 */
export { renderDocument, DocumentNotFound, type RenderedDocument } from './render.js'
export { renderInvoice } from './templates/invoice.js'
export { renderCreditNote } from './templates/credit-note.js'
export { renderChallan } from './templates/challan.js'
export { renderReceipt } from './templates/receipt.js'
export {
  PdfWriter,
  PAGE_SIZES,
  amountInWords,
  money,
  parseJpeg,
  prettyDate,
  rupees,
  textWidth,
  wrapText,
  type JpegImage,
} from './pdf.js'
export { Sheet } from './layout.js'
export {
  DOCUMENT_KINDS,
  DOCUMENT_RENDER_EVENT,
  documentObjectKey,
  isCanonicalVariant,
  type DocumentCopy,
  type DocumentFormat,
  type DocumentRenderKind,
  type DocumentRenderRequest,
} from '../platform/documents.js'
