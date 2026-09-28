import { describe, expect, it } from 'vitest'
import { csvCell, renderCsv } from './csv.js'

/**
 * QA DOS-292 (architect ruling 2026-09-28): the ONE place a CSV cell is written guards what a spreadsheet
 * would run as a formula — a text cell that begins with = + - @, a tab or a carriage return gets a single
 * quote in front — and never touches a number, decided by the column's type and not by the text.
 */
describe('renderCsv: formula injection (DOS-292)', () => {
  it('guards every text cell a spreadsheet would run', () => {
    for (const text of ['=1+1', '+91 98200', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])
      expect(csvCell(text).replace(/^"|"$/g, '').startsWith(`'`), JSON.stringify(text)).toBe(true)
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csvCell('Ramesh Kirana')).toBe('Ramesh Kirana')
    expect(csvCell('a-b = c')).toBe('a-b = c')
  })

  it('never guards a number: a JavaScript number, or a plain number in a number column', () => {
    expect(csvCell(-40)).toBe('-40')
    expect(csvCell(-0.4)).toBe('-0.4')
    expect(csvCell('-1234.50', 'number')).toBe('-1234.50')
    expect(csvCell('-40', 'number')).toBe('-40')
  })

  it('decides by the column, not by what the text looks like', () => {
    // a text column guards even a number-looking value; a number column still guards a formula
    expect(csvCell('-40', 'text')).toBe(`'-40`)
    expect(csvCell(-40, 'text')).toBe(`'-40`)
    expect(csvCell('=1+1', 'number')).toBe(`'=1+1`)
    expect(csvCell('-2+3', 'number')).toBe(`'-2+3`)
  })

  it('writes a whole file with the guard per column and RFC 4180 quoting intact', () => {
    const csv = renderCsv(
      [
        { shop: '=cmd|"/c calc"!A1', roundOff: -0.4, code: '-7' },
        { shop: 'Plain, Shop', roundOff: 0.2, code: '12' },
      ],
      [
        { header: 'Shop', key: 'shop', type: 'text' },
        { header: 'Round off (₹)', key: 'roundOff', type: 'number' },
        { header: 'Code', key: 'code' },
      ],
    )
    expect(csv).toBe(
      `\uFEFFShop,Round off (₹),Code\r\n"'=cmd|""/c calc""!A1",-0.4,'-7\r\n"Plain, Shop",0.2,12\r\n`,
    )
  })
})
