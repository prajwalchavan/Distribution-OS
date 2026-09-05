import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * A dependency-free XLSX reader and writer for the generic importer and the register exports.
 *
 * WHY NOT A LIBRARY. An `.xlsx` is a zip of XML: `node:zlib` inflates the entries and the four XML
 * parts a data sheet needs (workbook, relationships, shared strings, one worksheet) are small enough
 * to read with a tolerant tokenizer. The codebase already prefers a dependency-free writer where the
 * format is bounded (`documents/pdf.ts`, the SigV4 signer in `platform/object-storage.ts`), the npm
 * `xlsx` package is unmaintained on the registry with open advisories, and no dependency may be
 * installed inside a module slice. What this reads: shared and inline strings, numbers (as the file
 * wrote them, never through a float), booleans, ISO dates, and date-styled numbers (Excel serials →
 * `YYYY-MM-DD`). What it does not: formulas (the cached value is read), merged cells, styles beyond
 * the date formats, ZIP64. A distributor's export from TradeEzee, Marg, Busy or Tally is a flat sheet
 * of values, which is exactly this.
 *
 * The writer produces a plain workbook of inline strings and numbers with one bold header row, which
 * Excel, LibreOffice and Google Sheets open as is. Exports are register-sized (bounded by the caller),
 * so everything is built in memory.
 */

export interface XlsxSheet {
  name: string
  /** Every row as strings, exactly the cells the sheet holds; ragged rows are padded by the caller. */
  rows: string[][]
}

export interface XlsxWorkbook {
  sheetNames: string[]
  /** Reads one sheet by name (the first when omitted); `null` when the name is not in the workbook. */
  sheet(name?: string): XlsxSheet | null
}

export class XlsxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxError'
  }
}

// ---------------------------------------------------------------------------------------------------------------
// zip

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

/** Is this buffer a zip container at all (every XLSX starts with the local-header signature)? */
export function looksLikeXlsx(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.readUInt32LE(0) === SIG_LOCAL
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65_536); i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new XlsxError('not a zip file: the central directory is missing')
  const count = buffer.readUInt16LE(eocd + 10)
  const dirOffset = buffer.readUInt32LE(eocd + 16)
  const entries = new Map<string, Buffer>()
  let p = dirOffset
  for (let n = 0; n < count; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== SIG_CENTRAL)
      throw new XlsxError('corrupt zip: central directory entry expected')
    const method = buffer.readUInt16LE(p + 10)
    const compressedSize = buffer.readUInt32LE(p + 20)
    const nameLen = buffer.readUInt16LE(p + 28)
    const extraLen = buffer.readUInt16LE(p + 30)
    const commentLen = buffer.readUInt16LE(p + 32)
    const localOffset = buffer.readUInt32LE(p + 42)
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== SIG_LOCAL)
      throw new XlsxError(`corrupt zip: local header of ${name} expected`)
    const localNameLen = buffer.readUInt16LE(localOffset + 26)
    const localExtraLen = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLen + localExtraLen
    const raw = buffer.subarray(start, start + compressedSize)
    if (method === 0) entries.set(name, Buffer.from(raw))
    else if (method === 8) entries.set(name, inflateRawSync(raw))
    else throw new XlsxError(`unsupported zip compression method ${String(method)} on ${name}`)
  }
  return entries
}

interface ZipEntry {
  name: string
  data: Buffer
}

function writeZip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  // A fixed DOS timestamp keeps the file byte-for-byte reproducible for the same rows.
  const dosTime = 0
  const dosDate = (1 << 5) | 1 // 1980-01-01
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const deflated = deflateRawSync(entry.data)
    const store = deflated.length >= entry.data.length
    const data = store ? entry.data : deflated
    const method = store ? 0 : 8
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, data)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(SIG_CENTRAL, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(method, 10)
    dir.writeUInt16LE(dosTime, 12)
    dir.writeUInt16LE(dosDate, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(entry.data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt16LE(0, 30)
    dir.writeUInt16LE(0, 32)
    dir.writeUInt16LE(0, 34)
    dir.writeUInt16LE(0, 36)
    dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)
    offset += local.length + name.length + data.length
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(dirSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...parts, ...central, eocd])
}

// ---------------------------------------------------------------------------------------------------------------
// xml helpers

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITY[code] ?? whole
  })
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)
  return m ? unescapeXml(m[1] ?? '') : undefined
}

/** Every `<t>` text of a rich or plain string element, concatenated (a shared string may be split into runs). */
function textRuns(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1] ?? '')
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// reading

/** Column letters → zero-based index: A = 0, Z = 25, AA = 26. */
export function columnIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

/** Zero-based index → column letters (0 = A, 26 = AA). */
export function columnLetters(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Excel's built-in date number formats (1900 date system). Custom formats are checked by their code. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function dateStyles(stylesXml: string | undefined): Set<number> {
  const styles = new Set<number>()
  if (!stylesXml) return styles
  const customDate = new Set<number>()
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const tag = m[1] ?? ''
    const id = Number(attr(tag, 'numFmtId'))
    const code = (attr(tag, 'formatCode') ?? '').replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')
    if (/[dmy]/i.test(code) && !/[#0]/.test(code)) customDate.add(id)
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? ''
  let index = 0
  for (const m of cellXfs.matchAll(/<xf\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1] ?? '', 'numFmtId') ?? '0')
    if (BUILTIN_DATE_FORMATS.has(id) || customDate.has(id)) styles.add(index)
    index++
  }
  return styles
}

/** Excel serial (1900 system, with its 1900-02-29 quirk) → `YYYY-MM-DD`. */
export function excelSerialToIsoDate(serial: number): string {
  const days = Math.floor(serial)
  // 1899-12-30 is the epoch that absorbs Excel's phantom 29 February 1900 for every real date.
  const epoch = Date.UTC(1899, 11, 30)
  return new Date(epoch + days * 86_400_000).toISOString().slice(0, 10)
}

function cellText(
  tag: string,
  inner: string,
  shared: readonly string[],
  isDateStyle: (style: number | undefined) => boolean,
): string {
  const type = attr(tag, 't')
  const styleRaw = attr(tag, 's')
  const style = styleRaw === undefined ? undefined : Number(styleRaw)
  if (type === 'inlineStr') return textRuns(inner).trim()
  const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
  if (value === undefined) return ''
  const raw = unescapeXml(value)
  switch (type) {
    case 's':
      return (shared[Number(raw)] ?? '').trim()
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE'
    case 'str':
    case 'e':
      return raw.trim()
    case 'd':
      return raw.slice(0, 10)
    default: {
      if (isDateStyle(style) && /^-?\d+(\.\d+)?$/.test(raw))
        return excelSerialToIsoDate(Number(raw))
      // Numbers are kept as the file wrote them; `1.5E7` and the like are expanded without float noise.
      if (/[eE]/.test(raw)) {
        const n = Number(raw)
        return Number.isFinite(n) ? n.toLocaleString('en-US', { useGrouping: false }) : raw
      }
      return raw
    }
  }
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  const out: string[] = []
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push(textRuns(m[1] ?? ''))
  return out
}

/** Open a workbook. Throws `XlsxError` with a plain sentence when the bytes are not an XLSX. */
export function readXlsx(buffer: Buffer): XlsxWorkbook {
  if (!looksLikeXlsx(buffer)) throw new XlsxError('the file is not an XLSX workbook')
  const entries = readZipEntries(buffer)
  const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8')
  if (!workbookXml) throw new XlsxError('the workbook has no xl/workbook.xml part')
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const targets = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const tag = m[1] ?? ''
    const id = attr(tag, 'Id')
    const target = attr(tag, 'Target')
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }
  const sheets: { name: string; part: string }[] = []
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const tag = m[1] ?? ''
    const name = attr(tag, 'name') ?? `Sheet${String(sheets.length + 1)}`
    const rid = attr(tag, 'r:id') ?? attr(tag, 'id')
    const target = (rid && targets.get(rid)) || `worksheets/sheet${String(sheets.length + 1)}.xml`
    sheets.push({ name, part: `xl/${target}` })
  }
  if (sheets.length === 0) throw new XlsxError('the workbook has no sheets')
  const shared = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'))
  const dates = dateStyles(entries.get('xl/styles.xml')?.toString('utf8'))
  const isDateStyle = (style: number | undefined): boolean =>
    style !== undefined && dates.has(style)

  return {
    sheetNames: sheets.map((s) => s.name),
    sheet(name) {
      const meta = name === undefined ? sheets[0] : sheets.find((s) => s.name === name)
      if (!meta) return null
      const xml = entries.get(meta.part)?.toString('utf8')
      if (!xml) throw new XlsxError(`sheet '${meta.name}' has no worksheet part`)
      const rows: string[][] = []
      for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = []
        let next = 0
        for (const cell of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const tag = cell[1] ?? ''
          const ref = attr(tag, 'r')
          const letters = ref ? ref.replace(/\d+$/, '') : ''
          const index = letters ? columnIndex(letters) : next
          while (cells.length < index) cells.push('')
          cells[index] = cellText(tag, cell[2] ?? '', shared, isDateStyle)
          next = index + 1
        }
        rows.push(cells)
      }
      return { name: meta.name, rows }
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// writing

export type XlsxCell = string | number | null | undefined

export interface XlsxWriteSheet {
  name: string
  header: readonly string[]
  rows: readonly (readonly XlsxCell[])[]
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

function sheetXml(sheet: XlsxWriteSheet): string {
  const cell = (value: XlsxCell, col: number, row: number, header: boolean): string => {
    const ref = `${columnLetters(col)}${String(row)}`
    if (value === null || value === undefined || value === '') return ''
    if (typeof value === 'number' && Number.isFinite(value))
      return `<c r="${ref}"${header ? ' s="1"' : ''}><v>${String(value)}</v></c>`
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
  }
  const lines: string[] = []
  lines.push(`<row r="1">${sheet.header.map((h, c) => cell(h, c, 1, true)).join('')}</row>`)
  sheet.rows.forEach((row, i) => {
    const r = i + 2
    lines.push(`<row r="${String(r)}">${row.map((v, c) => cell(v, c, r, false)).join('')}</row>`)
  })
  const widths = sheet.header
    .map((h, c) => {
      const longest = Math.max(
        String(h).length,
        ...sheet.rows.slice(0, 200).map((r) => String(r[c] ?? '').length),
      )
      return `<col min="${String(c + 1)}" max="${String(c + 1)}" width="${String(Math.min(60, Math.max(10, longest + 2)))}" customWidth="1"/>`
    })
    .join('')
  return (
    `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths}</cols><sheetData>${lines.join('')}</sheetData></worksheet>`
  )
}

/** Build an XLSX workbook (one or more sheets) as bytes; the header row is bold and frozen. */
export function writeXlsx(sheets: readonly XlsxWriteSheet[]): Buffer {
  if (sheets.length === 0) throw new XlsxError('a workbook needs at least one sheet')
  const sheetEntries = sheets.map((s, i) => ({
    name: `xl/worksheets/sheet${String(i + 1)}.xml`,
    data: Buffer.from(sheetXml(s), 'utf8'),
  }))
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `</Types>`
  const rootRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
  const workbook =
    `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    sheets
      .map(
        (s, i) =>
          `<sheet name="${escapeXml(s.name.slice(0, 31))}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
      )
      .join('') +
    `</sheets></workbook>`
  const workbookRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${String(sheets.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
  const styles =
    `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `</styleSheet>`
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') },
    ...sheetEntries,
  ])
}

// ---------------------------------------------------------------------------------------------------------------
// csv

/** The delimiter a header line most plausibly uses: comma, semicolon, tab or pipe. */
export function detectDelimiter(line: string): string {
  let best = ','
  let bestCount = -1
  for (const d of [',', ';', '\t', '|']) {
    const count = line.split(d).length - 1
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/**
 * RFC 4180 with the field's real-world tolerance: a UTF-8 BOM, `\r\n` or `\n`, quoted fields with
 * doubled quotes, an auto-detected delimiter, and trailing blank lines dropped. Every cell is a string
 * exactly as written (trimmed); nothing is parsed here — the mapping decides what a cell means.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  s = s.replace(/\r\n?/g, '\n')
  const firstLine = s.slice(0, s.indexOf('\n') < 0 ? s.length : s.indexOf('\n'))
  const d = delimiter ?? detectDelimiter(firstLine)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? ''
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === d) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    rows.push(row)
  }
  while (rows.length > 0 && (rows[rows.length - 1] ?? []).every((c) => c === '')) rows.pop()
  return rows
}
