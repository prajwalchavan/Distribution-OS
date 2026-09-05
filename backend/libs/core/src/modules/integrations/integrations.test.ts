import { readFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { IMPORT_TARGETS, ImportMappingSchema } from '@dos/contracts'
import { parseAmountCell, parseDateCell, parsePhoneCell, parseUnitCell } from './fields.js'
import { normalizeRow, parseStateCell, suggestField, validateMappingForTarget } from './mapping.js'
import { parseSource, uniqueHeaders } from './parsing.js'
import { BUILTIN_PROFILES } from './profiles.data.js'
import { detectDelimiter, parseCsv, readXlsx, writeXlsx } from './xlsx.js'
import { renderCsv } from '../../platform/csv.js'
import { exportFileName, stableUuid, tallyGuidFor } from './integrations.internals.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name: string): string => readFileSync(join(fixtures, name), 'utf8')

describe('integrations: cells', () => {
  it('reads Indian mobiles in every spelling the files use', () => {
    expect(parsePhoneCell('9820000101')).toBe('+919820000101')
    expect(parsePhoneCell('+91 98200 00102')).toBe('+919820000102')
    expect(parsePhoneCell('0 9820000103')).toBe('+919820000103')
    expect(parsePhoneCell('919820000104')).toBe('+919820000104')
    expect(parsePhoneCell('98765')).toBeNull()
    expect(parsePhoneCell('1234567890')).toBeNull()
  })

  it('reads rupees to the paisa without a float, and paise as they are', () => {
    expect(parseAmountCell('18,400.00', 'rupees')).toBe(18_400_00)
    expect(parseAmountCell('Rs. 42,000', 'rupees')).toBe(42_000_00)
    expect(parseAmountCell('₹268.5', 'rupees')).toBe(26_850)
    expect(parseAmountCell('0.005', 'rupees')).toBe(1)
    expect(parseAmountCell('(250)', 'rupees')).toBe(-25_000)
    expect(parseAmountCell('250 Cr', 'rupees')).toBe(-25_000)
    expect(parseAmountCell('1234', 'paise')).toBe(1234)
    expect(parseAmountCell('12.34', 'paise')).toBeNull()
    expect(parseAmountCell('abc', 'rupees')).toBeNull()
  })

  it('reads dates day-first unless told otherwise', () => {
    expect(parseDateCell('02-06-2026', 'auto')).toBe('2026-06-02')
    expect(parseDateCell('2026-06-02', 'auto')).toBe('2026-06-02')
    expect(parseDateCell('2/6/26', 'auto')).toBe('2026-06-02')
    expect(parseDateCell('02-Jun-2026', 'auto')).toBe('2026-06-02')
    expect(parseDateCell('06/02/2026', 'MM/DD/YYYY')).toBe('2026-06-02')
    expect(parseDateCell('31-02-2026', 'auto')).toBeNull()
    expect(parseDateCell('yesterday', 'auto')).toBeNull()
    expect(parseDateCell('46084', 'auto')).toBe('2026-03-03')
  })

  it('reads states as codes or names, and units as the three the sell side knows', () => {
    expect(parseStateCell('27')).toBe('27')
    expect(parseStateCell('Maharashtra')).toBe('27')
    expect(parseStateCell('MH')).toBe('27')
    expect(parseStateCell('27-Maharashtra')).toBe('27')
    expect(parseStateCell('Narnia')).toBeNull()
    expect(parseUnitCell('CS')).toBe('case')
    expect(parseUnitCell('Pcs')).toBe('piece')
    expect(parseUnitCell('bag')).toBe('case')
    expect(parseUnitCell('litre')).toBeNull()
  })
})

describe('integrations: mapping', () => {
  it('every built-in profile is a complete mapping for its target', () => {
    for (const p of BUILTIN_PROFILES) {
      const mapping = ImportMappingSchema.parse(p.mapping)
      expect(validateMappingForTarget(mapping, p.target), p.key).toEqual([])
      expect(p.name.length).toBeLessThanOrEqual(60)
    }
    const targets = new Set(BUILTIN_PROFILES.map((p) => p.target))
    for (const target of Object.keys(IMPORT_TARGETS))
      expect(targets.has(target as never)).toBe(true)
  })

  it('refuses a mapping that leaves a required field or an anyOf group unmapped', () => {
    const mapping = ImportMappingSchema.parse({ columns: [{ column: 'Name', field: 'partyName' }] })
    const problems = validateMappingForTarget(mapping, 'party_master')
    expect(problems.map((p) => p.field)).toEqual(['phone', 'stateCode'])
    const outstanding = ImportMappingSchema.parse({
      columns: [
        { column: 'Bill', field: 'invoiceNo' },
        { column: 'Date', field: 'invoiceDate' },
        { column: 'Amt', field: 'amount' },
      ],
    })
    expect(validateMappingForTarget(outstanding, 'opening_outstanding')[0]?.message).toMatch(
      /Party code.*or.*Shop name/,
    )
  })

  it('suggests a field from the built-in profile first, then from the words in the header', () => {
    expect(suggestField('Party Code', 'tradeezee', 'party_master')).toBe('partyCode')
    expect(suggestField('Mobile No.', 'excel', 'party_master')).toBe('phone')
    expect(suggestField('Free Qty', 'other', 'brand_dms_invoices')).toBe('freeQty')
    expect(suggestField('Qty', 'other', 'brand_dms_invoices')).toBe('qty')
    expect(suggestField('Outstanding Balance', 'marg', 'opening_outstanding')).toBe('amount')
    expect(suggestField('Something else', 'other', 'party_master')).toBeNull()
    // A field the target does not have is never suggested, whatever the header says.
    expect(suggestField('Qty', 'other', 'party_master')).toBeNull()
  })

  it('normalises a row through constants, columns and overrides with English errors', () => {
    const mapping = ImportMappingSchema.parse({
      columns: [
        { column: 'Party Name', field: 'partyName' },
        { column: 'Mobile', field: 'phone' },
        { column: 'GSTIN', field: 'gstin' },
      ],
      constants: [{ field: 'stateCode', value: 'Maharashtra' }],
    })
    const good = normalizeRow(
      { 'Party Name': 'Shree Ganesh Kirana', Mobile: '98200 00101', GSTIN: '' },
      mapping,
      'party_master',
    )
    expect(good.errors).toEqual([])
    expect(good.values).toEqual({
      partyName: 'Shree Ganesh Kirana',
      phone: '+919820000101',
      stateCode: '27',
    })
    const bad = normalizeRow(
      { 'Party Name': 'X', Mobile: '98765', GSTIN: '27AAPFU0939F1ZX' },
      mapping,
      'party_master',
    )
    expect(bad.errors.map((e) => e.message)).toEqual([
      '"Mobile": "98765" is not an Indian mobile number',
      '"GSTIN": "27AAPFU0939F1ZX" is not a valid GSTIN',
    ])
    const fixed = normalizeRow(
      { 'Party Name': 'X', Mobile: '98765', GSTIN: '' },
      mapping,
      'party_master',
      { phone: '9820000108' },
    )
    expect(fixed.errors).toEqual([])
    expect(fixed.values.phone).toBe('+919820000108')
    expect(
      normalizeRow({ 'Party Name': '', Mobile: '', GSTIN: '' }, mapping, 'party_master').blank,
    ).toBe(true)
  })
})

describe('integrations: files', () => {
  it('parses the CSV fixtures with their delimiter, quotes and blank footer', () => {
    const table = parseCsv(fixture('tradeezee-outstanding.csv'))
    expect(table[0]?.[0]).toBe('Party Code')
    expect(table[1]?.[4]).toBe('18,400.00')
    expect(table[4]?.[4]).toBe('Rs. 42,000')
    expect(parseCsv('a;b\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ])
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
  })

  it('stages a CSV into records keyed by unique headers', () => {
    const parsed = parseSource(Buffer.from(fixture('tradeezee-party-master.csv'), 'utf8'), {
      hasHeaderRow: true,
      sheetName: null,
    })
    expect(parsed.headers).toContain('Party Code')
    expect(parsed.rows).toHaveLength(10)
    expect(parsed.rows[0]?.['Party Name']).toBe('Shree Ganesh Kirana')
    expect(parsed.sheetNames).toEqual([])
    expect(uniqueHeaders(['Name', '', 'name', 'Qty'])).toEqual(['Name', 'col_2', 'name (2)', 'Qty'])
    expect(() =>
      parseSource(Buffer.from('\0\0binary', 'utf8'), { hasHeaderRow: true, sheetName: null }),
    ).toThrow(/neither a CSV nor an XLSX/)
  })

  it('writes an XLSX the reader opens back, dates and numbers included', () => {
    const bytes = writeXlsx([
      {
        name: 'Parties',
        header: ['Party Name', 'Mobile', 'Balance', 'Bill Date'],
        rows: [
          ['Shree Ganesh Kirana', '9820000101', 18400, '2026-06-02'],
          ['A & B "Stores" <Ltd>', '9820000102', 31200.5, '2026-06-15'],
        ],
      },
      { name: 'Empty', header: ['x'], rows: [] },
    ])
    const book = readXlsx(bytes)
    expect(book.sheetNames).toEqual(['Parties', 'Empty'])
    const sheet = book.sheet()
    expect(sheet?.rows[0]).toEqual(['Party Name', 'Mobile', 'Balance', 'Bill Date'])
    expect(sheet?.rows[1]).toEqual(['Shree Ganesh Kirana', '9820000101', '18400', '2026-06-02'])
    expect(sheet?.rows[2]?.[0]).toBe('A & B "Stores" <Ltd>')
    expect(sheet?.rows[2]?.[2]).toBe('31200.5')
    expect(book.sheet('Nope')).toBeNull()
    const parsed = parseSource(bytes, { hasHeaderRow: true, sheetName: 'Parties' })
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]?.Balance).toBe('18400')
    expect(parsed.sheetNames).toEqual(['Parties', 'Empty'])
  })

  it('reads a workbook with shared strings, a date style and sparse cells', () => {
    // A minimal workbook assembled by hand: one shared string, one date-styled serial, a gap at B.
    const parts: Record<string, string> = {
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml':
        '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Bill Date</t></si><si><r><t>Am</t></r><r><t>ount</t></r></si></sst>',
      'xl/styles.xml':
        '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>46084</v></c><c r="C2"><v>18400</v></c></row></sheetData></worksheet>',
    }
    const bytes = zipOf(parts)
    const book = readXlsx(bytes)
    const sheet = book.sheet('Data')
    expect(sheet?.rows).toEqual([
      ['Bill Date', '', 'Amount'],
      ['2026-03-03', '', '18400'],
    ])
  })

  it('renders CSV with a BOM, CRLF and quoting Excel opens cleanly', () => {
    const csv = renderCsv(
      [{ a: 'x, y', b: 12.5, c: 'he said "hi"' }],
      [
        { header: 'A', key: 'a' },
        { header: 'B (₹)', key: 'b' },
        { header: 'C', value: (r) => r.c },
      ],
    )
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('A,B (₹),C\r\n"x, y",12.5,"he said ""hi"""\r\n')
  })
})

describe('integrations: ids and names', () => {
  it('derives stable ids and GUIDs', () => {
    expect(stableUuid('a')).toBe(stableUuid('a'))
    expect(stableUuid('a')).not.toBe(stableUuid('b'))
    expect(stableUuid('a')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(tallyGuidFor('t', 'invoice', 'i')).toBe(tallyGuidFor('t', 'invoice', 'i'))
    expect(exportFileName('tally_xml', { from: '2026-08-01', to: '2026-08-31' })).toBe(
      'tally-2026-08-01-to-2026-08-31.xml',
    )
    expect(exportFileName('outstanding_xlsx', { to: '2026-08-31', from: '2026-08-31' })).toBe(
      'outstanding-2026-08-31.xlsx',
    )
    expect(exportFileName('claim_sheet', {})).toBe('claim-sheet.bin')
  })
})

/** A stored (uncompressed) zip of the given parts, enough for the reader's central directory walk. */
function zipOf(parts: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(parts)) {
    const data = Buffer.from(text, 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt32LE(crc32(data), 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(parts).length, 8)
  eocd.writeUInt16LE(Object.keys(parts).length, 10)
  eocd.writeUInt32LE(dirSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, eocd])
}
