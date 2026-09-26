import {
  naiveLayout,
  fixedLength,
  PAGE_SIZE,
  SYSALLOCUNITS,
  SYSCOLPARS,
  SYSROWSETS,
  SYSSCHOBJS,
  T,
  type BakColumn,
  type BakValue,
} from './mssql-bak.js'

/**
 * Builders for the legacy specs. EVERYTHING here is synthetic: the specs never contain a row of the
 * founder's files (they hold real customers), and never read them.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** A GSTIN-shaped id with a CORRECT check digit, from its first 14 characters (`27ABCDE1234F1Z`). */
export function gstin(base14: string): string {
  let total = 0
  for (let i = 0; i < 14; i++) {
    const product = ALPHABET.indexOf(base14[i] ?? '') * (i % 2 === 0 ? 1 : 2)
    total += Math.floor(product / 36) + (product % 36)
  }
  return `${base14}${ALPHABET[(36 - (total % 36)) % 36] ?? '0'}`
}

/** Header row + data rows as the string grid `readXlsx` returns. */
export function grid(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string[][] {
  return [[...headers], ...rows.map((r) => r.map(String))]
}

// ---------------------------------------------------------------------------------------------------------------
// a synthetic SQL Server backup: MTF preamble, then data pages (with gaps), catalogue tables and user tables

export interface SyntheticTable {
  name: string
  columns: BakColumn[]
  rows: Record<string, BakValue>[]
  /** Encode records as if the table had gained a 4-byte fixed column that the catalogue does not list. */
  extraFixedBytes?: number
}

export const col = (
  name: string,
  xtype: number,
  length: number,
  colid: number,
  prec = 0,
  scale = 0,
): BakColumn => ({ name, xtype, length, prec, scale, colid })

function encodeFixed(c: BakColumn, v: BakValue): Buffer {
  const len = fixedLength(c) ?? 0
  const b = Buffer.alloc(len)
  if (v === null) return b
  switch (c.xtype) {
    case T.tinyint:
      b.writeUInt8(Number(v))
      break
    case T.smallint:
      b.writeInt16LE(Number(v))
      break
    case T.int:
      b.writeInt32LE(Number(v))
      break
    case T.bigint:
      b.writeBigInt64LE(BigInt(String(v)))
      break
    case T.numeric:
    case T.decimal: {
      const scaled = BigInt(Math.round(Number(v) * 10 ** c.scale))
      b.writeUInt8(scaled < 0n ? 0 : 1)
      let mag = scaled < 0n ? -scaled : scaled
      for (let i = 1; i < len; i++) {
        b.writeUInt8(Number(mag & 0xffn), i)
        mag >>= 8n
      }
      break
    }
    case T.datetime: {
      const ms = Date.parse(`${String(v)}Z`) - Date.UTC(1900, 0, 1)
      const days = Math.floor(ms / 86_400_000)
      const ticks = Math.round(((ms - days * 86_400_000) * 3) / 10)
      b.writeUInt32LE(ticks, 0)
      b.writeInt32LE(days, 4)
      break
    }
    case T.char:
      b.write(String(v).padEnd(len, ' '), 'latin1')
      break
    case T.binary:
      Buffer.from(String(v), 'hex').copy(b)
      break
    default:
      throw new Error(`encodeFixed: type ${String(c.xtype)}`)
  }
  return b
}

function encodeVariable(c: BakColumn, v: BakValue): Buffer {
  if (v === null) return Buffer.alloc(0)
  if (c.xtype === T.nvarchar) return Buffer.from(String(v), 'utf16le')
  if (c.xtype === T.varchar) return Buffer.from(String(v), 'latin1')
  if (c.xtype === T.varbinary) return Buffer.from(String(v), 'hex')
  throw new Error(`encodeVariable: type ${String(c.xtype)}`)
}

/** One primary record in the SQL Server row format (the inverse of `decodeRecord`). */
export function encodeRecord(
  columns: readonly BakColumn[],
  row: Record<string, BakValue>,
  extraFixedBytes = 0,
): Buffer {
  const { laid, fixedEnd } = naiveLayout(columns)
  const end = fixedEnd + extraFixedBytes
  const fixed = Buffer.alloc(end - 4)
  const nullBits = Buffer.alloc(Math.ceil(columns.length / 8))
  const vars: Buffer[] = []
  for (const l of laid) {
    const v = row[l.col.name] ?? null
    if (v === null)
      nullBits[l.nullbit >> 3] = (nullBits[l.nullbit >> 3] ?? 0) | (1 << (l.nullbit & 7))
    if (l.offset > 0) encodeFixed(l.col, v).copy(fixed, l.offset - 4)
    else vars.push(encodeVariable(l.col, v))
  }
  const head = Buffer.from([vars.length > 0 ? 0x30 : 0x10, 0, 0, 0])
  head.writeUInt16LE(end, 2)
  const ncols = Buffer.alloc(2)
  ncols.writeUInt16LE(columns.length)
  const parts: Buffer[] = [head, fixed, ncols, nullBits]
  if (vars.length > 0) {
    const count = Buffer.alloc(2)
    count.writeUInt16LE(vars.length)
    let at = end + 2 + nullBits.length + 2 + 2 * vars.length
    const ends = Buffer.alloc(2 * vars.length)
    vars.forEach((b, i) => {
      at += b.length
      ends.writeUInt16LE(at, 2 * i)
    })
    parts.push(count, ends, ...vars)
  }
  return Buffer.concat(parts)
}

let nextPageId = 100

/** An 8 KB data page holding `records` for (indexId, objectId), with the slot array at the end. */
export function dataPage(indexId: number, objectId: number, records: readonly Buffer[]): Buffer {
  const page = Buffer.alloc(PAGE_SIZE)
  page[0] = 1
  page[1] = 1
  page.writeUInt16LE(indexId, 6)
  page.writeUInt16LE(records.length, 22)
  page.writeUInt32LE(objectId, 24)
  page.writeUInt32LE(nextPageId++, 32)
  page.writeUInt16LE(1, 36)
  let at = 96
  records.forEach((r, i) => {
    r.copy(page, at)
    page.writeUInt16LE(at, PAGE_SIZE - 2 * (i + 1))
    at += r.length
  })
  page.writeUInt16LE(PAGE_SIZE - at, 28)
  page.writeUInt16LE(at, 30)
  return page
}

/** A whole mini backup: `TAPE` preamble, then pages 512-aligned with filler between them, like extents with gaps. */
export function buildBackup(tables: readonly SyntheticTable[]): Buffer {
  const pages: Buffer[] = []
  const objectIdOf = (i: number): number => 2000 + i
  const rowsetIdOf = (i: number): number => 900 + i
  const unitObjectOf = (i: number): number => 300 + i
  const sysCols = (t: readonly BakColumn[]): BakColumn[] => [...t]

  // the engine's own base tables (sysschobjs WITHOUT `status2`, as in the founder's backups)
  const schobjCols = sysCols(SYSSCHOBJS).slice(0, 11)
  pages.push(
    dataPage(
      1,
      34,
      tables.map((t, i) =>
        encodeRecord(schobjCols, {
          id: objectIdOf(i),
          name: t.name,
          nsid: 1,
          nsclass: 0,
          status: 0,
          type: 'U',
          pid: 0,
          pclass: 1,
          intprop: 0,
          created: '2026-05-15T00:00:00.000',
          modified: '2026-05-15T00:00:00.000',
        }),
      ),
    ),
  )
  const colRows = tables.flatMap((t, i) =>
    t.columns.map((c) =>
      encodeRecord(SYSCOLPARS, {
        id: objectIdOf(i),
        number: c.colid,
        colid: c.colid,
        name: c.name,
        xtype: c.xtype,
        utype: c.xtype,
        length: c.length,
        prec: c.prec,
        scale: c.scale,
        collationid: 0,
        status: 0,
        maxinrow: 0,
        xmlns: 0,
        dflt: 0,
        chk: 0,
        idtval: null,
      }),
    ),
  )
  pages.push(dataPage(1, 41, colRows))
  pages.push(
    dataPage(
      0,
      5,
      tables.map((t, i) =>
        encodeRecord(SYSROWSETS.slice(0, 8), {
          rowsetid: rowsetIdOf(i),
          ownertype: 1,
          idmajor: objectIdOf(i),
          idminor: 0,
          numpart: 1,
          status: 0,
          fgidfs: 0,
          rowcnt: t.rows.length,
        }),
      ),
    ),
  )
  pages.push(
    dataPage(
      0,
      7,
      tables.map((t, i) =>
        encodeRecord(SYSALLOCUNITS.slice(0, 11), {
          // index id 256 (bits 48-63) | object id (bits 16-47), the way a heap's allocation unit is numbered
          auid: String((256n << 48n) | (BigInt(unitObjectOf(i)) << 16n)),
          type: 1,
          ownerid: rowsetIdOf(i),
          status: 0,
          fgid: 1,
          pgfirst: '000000000000',
          pgroot: '000000000000',
          pgfirstiam: '000000000000',
          pcused: 1,
          pcdata: 1,
          pcreserved: 1,
        }),
      ),
    ),
  )
  tables.forEach((t, i) => {
    // rows spread over pages of at most 20 records, so a table spans several pages
    for (let at = 0; at < t.rows.length; at += 20)
      pages.push(
        dataPage(
          256,
          unitObjectOf(i),
          t.rows.slice(at, at + 20).map((r) => encodeRecord(t.columns, r, t.extraFixedBytes ?? 0)),
        ),
      )
  })

  const out: Buffer[] = [Buffer.concat([Buffer.from('TAPE'), Buffer.alloc(6652)])]
  for (const p of pages) {
    out.push(p, Buffer.alloc(1024)) // an unallocated extent's worth of zeros between pages
  }
  return Buffer.concat(out)
}
