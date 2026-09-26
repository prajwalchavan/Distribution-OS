/**
 * A reader for the DATA PAGES of an uncompressed SQL Server full backup (`.bak`), with no SQL Server.
 *
 * WHAT A `.bak` IS. A Microsoft Tape Format (MTF) container: `TAPE`, `SSET`, `VOLB` and `FILE` descriptor
 * blocks and then the database file's 8 KB pages, in extent order, with the extents that were never
 * allocated left out — so page N is NOT at `N * 8192`, and consecutive pages are not always adjacent.
 * A backup taken `WITH COMPRESSION` stores those pages inside compressed blocks and cannot be read this
 * way (the two founder backups are not compressed: their pages sit in the file as they sat on disk).
 *
 * HOW WE READ IT.
 *   1. Sniff pages: every 512-byte boundary whose 96-byte page header is a plausible DATA page (header
 *      version 1, type 1, data file 1) with a slot array that points back inside the page. The page id and
 *      object id come from the header. This finds the pages wherever the MTF framing put them.
 *   2. Read the catalogue from its own base tables, found by object id: `sysschobjs` (34: table names),
 *      `syscolpars` (41: column names, types, lengths), `sysallocunits` (7) and `sysrowsets` (5), which
 *      say which page objects belong to which table.
 *   3. Decode records with the row format every version since SQL Server 2005 shares: status bytes,
 *      end-of-fixed-data offset, fixed columns, column count, null bitmap, variable-column end offsets,
 *      variable data.
 *
 * WHAT IT REFUSES. A table whose records do not carry exactly the fixed-area size its declared columns
 * add up to (a column dropped or its type altered after rows were written — the physical layout then
 * lives in `sysrscols`, which this reader does not decode) throws `BakLayoutError` rather than return
 * shifted numbers. Compressed backups, encrypted backups, LOB (text/image/xml) and row-overflow
 * columns come back as `null`.
 */

export const PAGE_SIZE = 8192
const HEADER_SIZE = 96

export class BakLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BakLayoutError'
  }
}

export type BakValue = string | number | boolean | null

export interface BakColumn {
  name: string
  /** SQL Server system type id (56 = int, 231 = nvarchar, 108 = numeric ...). */
  xtype: number
  /** Storage length in bytes (a `char(n)` is n, an `nchar(n)` is 2n, a numeric is 5/9/13/17). */
  length: number
  prec: number
  scale: number
  colid: number
}

export type BakRow = Record<string, BakValue>

interface DataPage {
  offset: number
  pageId: number
  indexId: number
  objectId: number
  slots: number
}

// system type ids
export const T = {
  tinyint: 48,
  smallint: 52,
  int: 56,
  bigint: 127,
  bit: 104,
  datetime: 61,
  smalldatetime: 58,
  decimal: 106,
  numeric: 108,
  float: 62,
  real: 59,
  money: 60,
  smallmoney: 122,
  uniqueidentifier: 36,
  char: 175,
  nchar: 239,
  varchar: 167,
  nvarchar: 231,
  varbinary: 165,
  binary: 173,
  text: 35,
  ntext: 99,
  image: 34,
  date: 40,
  timestamp: 189,
} as const

const VARIABLE = new Set<number>([
  T.varchar,
  T.nvarchar,
  T.varbinary,
  T.text,
  T.ntext,
  T.image,
  98 /* sql_variant */,
  241 /* xml */,
])

function decimalBytes(prec: number): number {
  return prec <= 9 ? 5 : prec <= 19 ? 9 : prec <= 28 ? 13 : 17
}

/** Bytes a fixed-length column takes in the row, or `null` for a variable-length one. */
export function fixedLength(c: Pick<BakColumn, 'xtype' | 'length' | 'prec'>): number | null {
  if (VARIABLE.has(c.xtype)) return null
  switch (c.xtype) {
    case T.tinyint:
    case T.bit:
      return 1
    case T.smallint:
      return 2
    case T.int:
    case T.real:
    case T.smalldatetime:
    case T.smallmoney:
      return 4
    case T.bigint:
    case T.datetime:
    case T.float:
    case T.money:
    case T.timestamp:
      return 8
    case T.uniqueidentifier:
      return 16
    case T.date:
      return 3
    case T.decimal:
    case T.numeric:
      return decimalBytes(c.prec)
    case T.char:
    case T.nchar:
    case T.binary:
      return c.length
    default:
      return null
  }
}

interface Laid {
  col: BakColumn
  /** Fixed-column offset from the record start (after the 4-byte header), or a negative 1-based variable ordinal. */
  offset: number
  nullbit: number
}

/** The layout of a table that has never lost or re-typed a column: fixed columns first, then variable ones, each in column-id order. */
export function naiveLayout(columns: readonly BakColumn[]): { laid: Laid[]; fixedEnd: number } {
  let at = 4
  let variable = 0
  const laid: Laid[] = columns.map((col, i) => {
    const fl = fixedLength(col)
    if (fl !== null) {
      const l = { col, offset: at, nullbit: i }
      at += fl
      return l
    }
    variable += 1
    return { col, offset: -variable, nullbit: i }
  })
  return { laid, fixedEnd: at }
}

export function decodeValue(c: BakColumn, raw: Buffer): BakValue {
  switch (c.xtype) {
    case T.tinyint:
      return raw.readUInt8(0)
    case T.smallint:
      return raw.readInt16LE(0)
    case T.int:
      return raw.readInt32LE(0)
    case T.bigint: {
      const v = raw.readBigInt64LE(0)
      return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
    }
    case T.bit:
      return (raw.readUInt8(0) & 1) === 1
    case T.char:
    case T.varchar:
      return raw.toString('latin1').replace(/ +$/, '')
    case T.nchar:
    case T.nvarchar:
      return raw.toString('utf16le').replace(/ +$/, '')
    case T.datetime: {
      const ticks = raw.readUInt32LE(0)
      const days = raw.readInt32LE(4)
      return new Date(Date.UTC(1900, 0, 1) + days * 86_400_000 + Math.round((ticks * 10) / 3))
        .toISOString()
        .slice(0, 23)
    }
    case T.smalldatetime: {
      const days = raw.readUInt16LE(0)
      const minutes = raw.readUInt16LE(2)
      return new Date(Date.UTC(1900, 0, 1) + days * 86_400_000 + minutes * 60_000)
        .toISOString()
        .slice(0, 23)
    }
    case T.money:
      return Number(raw.readBigInt64LE(0)) / 10_000
    case T.smallmoney:
      return raw.readInt32LE(0) / 10_000
    case T.float:
      return raw.readDoubleLE(0)
    case T.real:
      return raw.readFloatLE(0)
    case T.decimal:
    case T.numeric: {
      let mag = 0n
      for (let i = raw.length - 1; i >= 1; i--) mag = (mag << 8n) | BigInt(raw[i] ?? 0)
      const v = Number(mag) / 10 ** c.scale
      return raw[0] === 1 ? v : -v
    }
    case T.date: {
      // `Date.UTC(1, …)` would mean 1901; year 1 needs setUTCFullYear.
      const origin = new Date(0)
      origin.setUTCFullYear(1, 0, 1)
      origin.setUTCHours(0, 0, 0, 0)
      return new Date(origin.getTime() + raw.readUIntLE(0, 3) * 86_400_000)
        .toISOString()
        .slice(0, 10)
    }
    default:
      return raw.toString('hex')
  }
}

/**
 * Decode one record against a layout. Returns `null` for a record that is not live data (a ghost, a
 * forwarding stub, an index or LOB record) and throws `BakLayoutError` when the record's fixed area is not
 * the size the layout expects.
 */
export function decodeRecord(
  rec: Buffer,
  layout: { laid: readonly Laid[]; fixedEnd: number },
  table: string,
  strict = true,
): BakRow | null {
  if (rec.length < 4) return null
  const status = rec[0] ?? 0
  const type = (status >> 1) & 7
  // 0 = primary record, 1 = forwarded record; 2 = forwarding stub, 4 = LOB fragment, 5-7 = ghosts.
  if (type !== 0 && type !== 1) return null
  const fixedEnd = rec.readUInt16LE(2)
  // The engine's own base tables gained columns between versions, so their trailing columns are read only when
  // the record has them; a user table must match exactly or its numbers would be shifted.
  if (strict && fixedEnd !== layout.fixedEnd)
    throw new BakLayoutError(
      `${table}: a record's fixed area is ${String(fixedEnd)} bytes, its columns add up to ${String(layout.fixedEnd)} (a column was dropped or re-typed after rows were written)`,
    )
  if (fixedEnd + 2 > rec.length) return null
  const ncols = rec.readUInt16LE(fixedEnd)
  let at = fixedEnd + 2
  const hasNullBitmap = (status & 0x10) !== 0
  const hasVariable = (status & 0x20) !== 0
  const bitmapBytes = Math.ceil(ncols / 8)
  const bitmap = hasNullBitmap ? rec.subarray(at, at + bitmapBytes) : Buffer.alloc(bitmapBytes)
  if (hasNullBitmap) at += bitmapBytes
  const variableCount = hasVariable ? rec.readUInt16LE(at) : 0
  const ends: number[] = []
  if (hasVariable) {
    for (let i = 0; i < variableCount; i++) ends.push(rec.readUInt16LE(at + 2 + 2 * i))
    at += 2 + 2 * variableCount
  }
  const isNull = (bit: number): boolean =>
    bit < ncols && (((bitmap[bit >> 3] ?? 0) >> (bit & 7)) & 1) === 1
  const out: BakRow = {}
  for (const l of layout.laid) {
    if (l.offset > 0) {
      const len = fixedLength(l.col) ?? 0
      out[l.col.name] =
        l.offset + len > fixedEnd || isNull(l.nullbit)
          ? null
          : decodeValue(l.col, rec.subarray(l.offset, l.offset + len))
    } else {
      const i = -l.offset - 1
      const end = ends[i]
      if (end === undefined || isNull(l.nullbit) || (end & 0x8000) !== 0) {
        out[l.col.name] = null
        continue
      }
      const start = i === 0 ? at : (ends[i - 1] ?? at) & 0x7fff
      out[l.col.name] = decodeValue(l.col, rec.subarray(start, end & 0x7fff))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// the catalogue's own base tables, whose layouts are fixed by the engine

const col = (
  name: string,
  xtype: number,
  length: number,
  colid: number,
  prec = 0,
  scale = 0,
): BakColumn => ({ name, xtype, length, prec, scale, colid })

export const SYSSCHOBJS = [
  col('id', T.int, 4, 1),
  col('name', T.nvarchar, 256, 2),
  col('nsid', T.int, 4, 3),
  col('nsclass', T.tinyint, 1, 4),
  col('status', T.int, 4, 5),
  col('type', T.char, 2, 6),
  col('pid', T.int, 4, 7),
  col('pclass', T.tinyint, 1, 8),
  col('intprop', T.int, 4, 9),
  col('created', T.datetime, 8, 10),
  col('modified', T.datetime, 8, 11),
  col('status2', T.int, 4, 12),
]
export const SYSCOLPARS = [
  col('id', T.int, 4, 1),
  col('number', T.smallint, 2, 2),
  col('colid', T.int, 4, 3),
  col('name', T.nvarchar, 256, 4),
  col('xtype', T.tinyint, 1, 5),
  col('utype', T.int, 4, 6),
  col('length', T.smallint, 2, 7),
  col('prec', T.tinyint, 1, 8),
  col('scale', T.tinyint, 1, 9),
  col('collationid', T.int, 4, 10),
  col('status', T.int, 4, 11),
  col('maxinrow', T.smallint, 2, 12),
  col('xmlns', T.int, 4, 13),
  col('dflt', T.int, 4, 14),
  col('chk', T.int, 4, 15),
  col('idtval', T.varbinary, 64, 16),
]
export const SYSALLOCUNITS = [
  col('auid', T.bigint, 8, 1),
  col('type', T.tinyint, 1, 2),
  col('ownerid', T.bigint, 8, 3),
  col('status', T.int, 4, 4),
  col('fgid', T.smallint, 2, 5),
  col('pgfirst', T.binary, 6, 6),
  col('pgroot', T.binary, 6, 7),
  col('pgfirstiam', T.binary, 6, 8),
  col('pcused', T.bigint, 8, 9),
  col('pcdata', T.bigint, 8, 10),
  col('pcreserved', T.bigint, 8, 11),
  col('dbfragid', T.int, 4, 12),
]
export const SYSROWSETS = [
  col('rowsetid', T.bigint, 8, 1),
  col('ownertype', T.tinyint, 1, 2),
  col('idmajor', T.int, 4, 3),
  col('idminor', T.int, 4, 4),
  col('numpart', T.int, 4, 5),
  col('status', T.int, 4, 6),
  col('fgidfs', T.smallint, 2, 7),
  col('rowcnt', T.bigint, 8, 8),
  col('cmprlevel', T.tinyint, 1, 9),
  col('fillfact', T.tinyint, 1, 10),
  col('maxnullbit', T.smallint, 2, 11),
  col('maxleaf', T.int, 4, 12),
  col('maxint', T.smallint, 2, 13),
  col('minleaf', T.int, 4, 14),
  col('minint', T.smallint, 2, 15),
  col('rsguid', T.varbinary, 16, 16),
  col('lockres', T.varbinary, 8, 17),
  col('scope_id', T.int, 4, 18),
]

const OBJ = { sysrowsets: 5, sysallocunits: 7, sysschobjs: 34, syscolpars: 41 } as const

export interface BakStats {
  dataPages: number
  tables: number
}

export class SqlBackup {
  private readonly buf: Buffer
  private readonly byUnit = new Map<string, DataPage[]>()
  private readonly tableIds = new Map<string, number>()
  private readonly columnsOf = new Map<number, BakColumn[]>()
  private readonly unitsOf = new Map<number, string[]>()
  private pageCount = 0

  constructor(buffer: Buffer) {
    this.buf = buffer
    this.sniffPages()
    this.readCatalogue()
  }

  static isMtf(buffer: Buffer): boolean {
    return buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === 'TAPE'
  }

  stats(): BakStats {
    return { dataPages: this.pageCount, tables: this.tableIds.size }
  }

  tableNames(): string[] {
    return [...this.tableIds.keys()].sort()
  }

  hasTable(name: string): boolean {
    return this.tableIds.has(name)
  }

  columns(name: string): BakColumn[] {
    const id = this.tableIds.get(name)
    if (id === undefined) throw new Error(`no table ${name} in the backup`)
    return this.columnsOf.get(id) ?? []
  }

  /** Every live row of a user table. Throws `BakLayoutError` when the table's physical layout is not the declared one. */
  rows(name: string): BakRow[] {
    const id = this.tableIds.get(name)
    if (id === undefined) throw new Error(`no table ${name} in the backup`)
    const layout = naiveLayout(this.columnsOf.get(id) ?? [])
    const out: BakRow[] = []
    for (const unit of this.unitsOf.get(id) ?? []) {
      for (const page of this.byUnit.get(unit) ?? []) {
        for (const rec of this.records(page)) {
          const row = decodeRecord(rec, layout, name)
          if (row) out.push(row)
        }
      }
    }
    return out
  }

  /** Like `rows`, but `null` (with the reason) instead of a throw when the layout is unsupported. */
  tryRows(name: string): { rows: BakRow[] } | { unsupported: string } {
    try {
      return { rows: this.rows(name) }
    } catch (e) {
      if (e instanceof BakLayoutError) return { unsupported: e.message }
      throw e
    }
  }

  // -------------------------------------------------------------------------------------------------------------

  private records(page: DataPage): Buffer[] {
    const out: Buffer[] = []
    for (let s = 0; s < page.slots; s++) {
      const slot = page.offset + PAGE_SIZE - 2 * (s + 1)
      const at = this.buf.readUInt16LE(slot)
      if (at < HEADER_SIZE || at >= PAGE_SIZE) continue
      out.push(this.buf.subarray(page.offset + at, page.offset + PAGE_SIZE))
    }
    return out
  }

  private sniffPages(): void {
    const b = this.buf
    const found = new Map<number, DataPage>()
    const maxPageId = Math.ceil(b.length / PAGE_SIZE) * 16
    for (let o = 0; o + PAGE_SIZE <= b.length; o += 512) {
      if (b[o] !== 1 || b[o + 1] !== 1) continue
      if (b.readUInt16LE(o + 36) !== 1) continue
      const pageId = b.readUInt32LE(o + 32)
      if (pageId > maxPageId) continue
      const slots = b.readUInt16LE(o + 22)
      const freeData = b.readUInt16LE(o + 30)
      if (slots > (PAGE_SIZE - HEADER_SIZE) / 2 || freeData > PAGE_SIZE || freeData < HEADER_SIZE)
        continue
      let ok = true
      for (let s = 0; s < slots && ok; s++) {
        const at = b.readUInt16LE(o + PAGE_SIZE - 2 * (s + 1))
        if (at < HEADER_SIZE || at >= PAGE_SIZE) ok = false
      }
      if (!ok) continue
      const page: DataPage = {
        offset: o,
        pageId,
        indexId: b.readUInt16LE(o + 6),
        objectId: b.readUInt32LE(o + 24),
        slots,
      }
      const seen = found.get(pageId)
      if (!seen || page.slots > seen.slots) found.set(pageId, page)
    }
    for (const page of [...found.values()].sort((a, c) => a.pageId - c.pageId)) {
      const key = `${String(page.indexId)}:${String(page.objectId)}`
      const list = this.byUnit.get(key)
      if (list) list.push(page)
      else this.byUnit.set(key, [page])
    }
    this.pageCount = found.size
  }

  /** The pages of a system base table: its object id, whichever index id (0 or 1) the engine gave it. */
  private systemRows(objectId: number, columns: BakColumn[]): BakRow[] {
    const layout = naiveLayout(columns)
    const out: BakRow[] = []
    for (const idx of [0, 1]) {
      for (const page of this.byUnit.get(`${String(idx)}:${String(objectId)}`) ?? []) {
        for (const rec of this.records(page)) {
          const row = decodeRecord(rec, layout, `sys${String(objectId)}`, false)
          if (row) out.push(row)
        }
      }
    }
    return out
  }

  private readCatalogue(): void {
    const objects = this.systemRows(OBJ.sysschobjs, SYSSCHOBJS)
    const tables = objects.filter((o) => typeof o.type === 'string' && o.type.trim() === 'U')
    for (const t of tables) {
      if (typeof t.name === 'string' && typeof t.id === 'number') this.tableIds.set(t.name, t.id)
    }
    const colRows = this.systemRows(OBJ.syscolpars, SYSCOLPARS)
    for (const c of colRows) {
      if (typeof c.id !== 'number' || typeof c.name !== 'string') continue
      const list = this.columnsOf.get(c.id) ?? []
      list.push({
        name: c.name,
        xtype: Number(c.xtype),
        length: Number(c.length),
        prec: Number(c.prec),
        scale: Number(c.scale),
        colid: Number(c.colid),
      })
      this.columnsOf.set(c.id, list)
    }
    for (const list of this.columnsOf.values()) list.sort((a, c) => a.colid - c.colid)
    // Ids above 2^53 come back as decimal strings (see `decodeValue`), so they are keyed as text.
    const rowsets = new Map<string, number>()
    for (const r of this.systemRows(OBJ.sysrowsets, SYSROWSETS)) {
      if ((r.idminor === 0 || r.idminor === 1) && r.rowsetid !== null)
        rowsets.set(String(r.rowsetid), Number(r.idmajor))
    }
    for (const a of this.systemRows(OBJ.sysallocunits, SYSALLOCUNITS)) {
      if (a.type !== 1 || a.ownerid === null || a.auid === null) continue
      const table = rowsets.get(String(a.ownerid))
      if (table === undefined) continue
      // allocation unit id = index id (bits 48-63) | object id (bits 16-47); a page header carries both.
      const auid = BigInt(String(a.auid))
      const key = `${String((auid >> 48n) & 0xffffn)}:${String((auid >> 16n) & 0xffffffffn)}`
      const list = this.unitsOf.get(table) ?? []
      list.push(key)
      this.unitsOf.set(table, list)
    }
  }
}
