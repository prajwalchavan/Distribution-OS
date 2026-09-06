/**
 * The memory adapter's engine: a small, exact SQL interpreter (docs/27 §2 — "an in-memory
 * SQL-compatible store").
 *
 * WHY THIS EXISTS AT ALL. `expo-sqlite` is the real store on a phone and, where the browser gives
 * OPFS in a cross-origin-isolated page, on the web too. Neither is available in a plain browser tab
 * without COOP/COEP, in a Vitest process, or in a Vite harness — and the design's answer to that is
 * an in-memory adapter that is HONEST rather than absent (`persistent: false`, and the strip says
 * "Offline data is not saved on this browser"). Pulling a 1 MB WASM build of SQLite into every app's
 * bundle to serve the fallback would cost every field phone the download; this is one file and runs
 * the same statements the other two adapters run.
 *
 * WHAT IT SUPPORTS, exactly — nothing wider, because the only SQL that reaches it is SQL this library
 * writes (docs/27 §11: "screens never write SQL; only the library does"):
 *
 *   CREATE TABLE [IF NOT EXISTS] t (col TYPE [NOT NULL] [PRIMARY KEY [AUTOINCREMENT]] [UNIQUE], …,
 *                                   PRIMARY KEY (a, b))
 *   DROP TABLE [IF EXISTS] t          CREATE INDEX … (accepted and ignored: an in-memory scan needs none)
 *   INSERT [OR REPLACE] INTO t (cols) VALUES (?, …)
 *   UPDATE t SET c = ?, … [WHERE expr]
 *   DELETE FROM t [WHERE expr]
 *   SELECT * | col [AS alias] | COUNT(*) | MIN(col) | MAX(col) FROM t [WHERE expr]
 *          [ORDER BY col [ASC|DESC], …] [LIMIT n [OFFSET m]]
 *
 * and in an expression: `= == != <> < <= > >=`, `IS [NOT] NULL`, `[NOT] IN (…)`, `[NOT] LIKE`,
 * `AND`, `OR`, `NOT`, parentheses, `?` placeholders, numbers, single-quoted strings, NULL.
 *
 * Placeholders are bound WHILE PARSING, in written order — which is exactly how SQLite numbers them —
 * so evaluation never has to carry a cursor and a WHERE that runs once per row cannot consume a
 * parameter twice.
 *
 * Comparison follows SQLite where it matters for us: a comparison involving NULL is unknown and a
 * WHERE keeps only rows that are TRUE; `ORDER BY` sorts NULLs first; a number sorts before a string.
 */
import type { SqlValue } from './types.js'

export class SqlError extends Error {
  constructor(
    message: string,
    readonly sql?: string,
  ) {
    super(sql === undefined ? message : `${message} — in: ${sql}`)
    this.name = 'SqlError'
  }
}

export type Row = Record<string, SqlValue>

interface ColumnDef {
  name: string
  unique: boolean
}

interface TableData {
  name: string
  columns: ColumnDef[]
  primaryKey: string[]
  autoIncrement: string | null
  nextAuto: number
  rows: Row[]
}

// ---------------------------------------------------------------------------------------------------------------
// Tokeniser

type TokenKind = 'name' | 'number' | 'string' | 'punct' | 'param'
interface Token {
  kind: TokenKind
  value: string
}

const PUNCT = new Set(['(', ')', ',', '*', '=', '<', '>', '.'])

function tokenise(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < sql.length) {
    const ch = sql[i] ?? ''
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === '?') {
      tokens.push({ kind: 'param', value: '?' })
      i += 1
      continue
    }
    if (ch === "'") {
      let out = ''
      i += 1
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        if (sql[i] === "'") break
        out += sql[i]
        i += 1
      }
      if (sql[i] !== "'") throw new SqlError('unterminated string literal', sql)
      i += 1
      tokens.push({ kind: 'string', value: out })
      continue
    }
    if (ch === '"') {
      let out = ''
      i += 1
      while (i < sql.length && sql[i] !== '"') {
        out += sql[i]
        i += 1
      }
      if (sql[i] !== '"') throw new SqlError('unterminated quoted identifier', sql)
      i += 1
      tokens.push({ kind: 'name', value: out })
      continue
    }
    if (/[0-9]/.test(ch)) {
      let out = ''
      while (i < sql.length && /[0-9.]/.test(sql[i] ?? '')) {
        out += sql[i]
        i += 1
      }
      tokens.push({ kind: 'number', value: out })
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let out = ''
      while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i] ?? '')) {
        out += sql[i]
        i += 1
      }
      tokens.push({ kind: 'name', value: out })
      continue
    }
    if (ch === '<' && sql[i + 1] === '>') {
      tokens.push({ kind: 'punct', value: '<>' })
      i += 2
      continue
    }
    if ((ch === '<' || ch === '>' || ch === '!' || ch === '=') && sql[i + 1] === '=') {
      tokens.push({ kind: 'punct', value: `${ch}=` })
      i += 2
      continue
    }
    if (PUNCT.has(ch)) {
      tokens.push({ kind: 'punct', value: ch })
      i += 1
      continue
    }
    throw new SqlError(`unexpected character ${ch}`, sql)
  }
  return tokens
}

// ---------------------------------------------------------------------------------------------------------------
// Expressions

type Expr =
  | { t: 'value'; v: SqlValue }
  | { t: 'col'; name: string }
  | { t: 'not'; e: Expr }
  | { t: 'and' | 'or'; l: Expr; r: Expr }
  | { t: 'cmp'; op: string; l: Expr; r: Expr }
  | { t: 'isNull'; e: Expr; negated: boolean }
  | { t: 'in'; e: Expr; list: Expr[]; negated: boolean }
  | { t: 'like'; e: Expr; pattern: Expr; negated: boolean }

const COMPARATORS = new Set(['=', '==', '!=', '<>', '<', '<=', '>', '>='])

class Parser {
  private at = 0

  constructor(
    private readonly tokens: Token[],
    private readonly sql: string,
    private readonly params: readonly SqlValue[],
    private paramAt: number,
  ) {}

  /** Where the next statement of the same batch should start binding. */
  paramCursor(): number {
    return this.paramAt
  }

  peek(): Token | undefined {
    return this.tokens[this.at]
  }

  isWord(word: string, offset = 0): boolean {
    const token = this.tokens[this.at + offset]
    return token?.kind === 'name' && token.value.toUpperCase() === word
  }

  isPunct(value: string, offset = 0): boolean {
    const token = this.tokens[this.at + offset]
    return token?.kind === 'punct' && token.value === value
  }

  take(): Token {
    const token = this.tokens[this.at]
    if (!token) throw new SqlError('unexpected end of statement', this.sql)
    this.at += 1
    return token
  }

  eatWord(word: string): boolean {
    if (!this.isWord(word)) return false
    this.at += 1
    return true
  }

  expectWord(word: string): void {
    if (!this.eatWord(word)) throw new SqlError(`expected ${word}`, this.sql)
  }

  eatPunct(value: string): boolean {
    if (!this.isPunct(value)) return false
    this.at += 1
    return true
  }

  expectPunct(value: string): void {
    if (!this.eatPunct(value)) throw new SqlError(`expected ${value}`, this.sql)
  }

  atEnd(): boolean {
    return this.at >= this.tokens.length
  }

  name(): string {
    const token = this.take()
    if (token.kind !== 'name') throw new SqlError(`expected a name, got ${token.value}`, this.sql)
    if (this.isPunct('.')) {
      // `t.col`: the qualifier is noise, one table per statement.
      this.at += 1
      return this.name()
    }
    return token.value
  }

  expr(): Expr {
    return this.orExpr()
  }

  /** A single value: `?` (bound here, in written order), a literal or a column. */
  operand(): Expr {
    const token = this.take()
    if (token.kind === 'param') {
      const value = this.params[this.paramAt] ?? null
      this.paramAt += 1
      return { t: 'value', v: value }
    }
    if (token.kind === 'number') return { t: 'value', v: Number(token.value) }
    if (token.kind === 'string') return { t: 'value', v: token.value }
    if (token.kind === 'name') {
      const upper = token.value.toUpperCase()
      if (upper === 'NULL') return { t: 'value', v: null }
      if (upper === 'TRUE') return { t: 'value', v: 1 }
      if (upper === 'FALSE') return { t: 'value', v: 0 }
      if (this.isPunct('.')) {
        this.at += 1
        return { t: 'col', name: this.name() }
      }
      return { t: 'col', name: token.value }
    }
    throw new SqlError(`unexpected ${token.value}`, this.sql)
  }

  private orExpr(): Expr {
    let left = this.andExpr()
    while (this.eatWord('OR')) left = { t: 'or', l: left, r: this.andExpr() }
    return left
  }

  private andExpr(): Expr {
    let left = this.notExpr()
    while (this.eatWord('AND')) left = { t: 'and', l: left, r: this.notExpr() }
    return left
  }

  private notExpr(): Expr {
    if (this.eatWord('NOT')) return { t: 'not', e: this.notExpr() }
    return this.predicate()
  }

  private predicate(): Expr {
    if (this.eatPunct('(')) {
      const inner = this.expr()
      this.expectPunct(')')
      return this.suffix(inner)
    }
    return this.suffix(this.operand())
  }

  private suffix(left: Expr): Expr {
    if (this.eatWord('IS')) {
      const negated = this.eatWord('NOT')
      this.expectWord('NULL')
      return { t: 'isNull', e: left, negated }
    }
    let negated = false
    if (this.isWord('NOT') && (this.isWord('IN', 1) || this.isWord('LIKE', 1))) {
      this.at += 1
      negated = true
    }
    if (this.eatWord('IN')) {
      this.expectPunct('(')
      const list: Expr[] = []
      if (!this.isPunct(')')) {
        do list.push(this.operand())
        while (this.eatPunct(','))
      }
      this.expectPunct(')')
      return { t: 'in', e: left, list, negated }
    }
    if (this.eatWord('LIKE')) return { t: 'like', e: left, pattern: this.operand(), negated }
    const token = this.peek()
    if (token?.kind === 'punct' && COMPARATORS.has(token.value)) {
      this.at += 1
      return { t: 'cmp', op: token.value, l: left, r: this.operand() }
    }
    return left
  }
}

function compare(a: SqlValue, b: SqlValue): number {
  // SQLite's storage-class order, which is what makes ORDER BY deterministic with mixed types.
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return a === b ? 0 : a < b ? -1 : 1
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'is')
}

/** `null` is SQL's UNKNOWN; a WHERE keeps only rows that are TRUE. */
type Truth = boolean | null

function value(expr: Expr, row: Row): SqlValue {
  switch (expr.t) {
    case 'value':
      return expr.v
    case 'col':
      return row[expr.name] ?? null
    default: {
      const truth = test(expr, row)
      return truth === null ? null : truth ? 1 : 0
    }
  }
}

function test(expr: Expr, row: Row): Truth {
  switch (expr.t) {
    case 'and': {
      const l = test(expr.l, row)
      const r = test(expr.r, row)
      if (l === false || r === false) return false
      return l === null || r === null ? null : true
    }
    case 'or': {
      const l = test(expr.l, row)
      const r = test(expr.r, row)
      if (l === true || r === true) return true
      return l === null || r === null ? null : false
    }
    case 'not': {
      const inner = test(expr.e, row)
      return inner === null ? null : !inner
    }
    case 'isNull': {
      const target = value(expr.e, row)
      return expr.negated ? target !== null : target === null
    }
    case 'in': {
      const target = value(expr.e, row)
      if (target === null) return null
      const hit = expr.list.some((item) => {
        const candidate = value(item, row)
        return candidate !== null && compare(target, candidate) === 0
      })
      return expr.negated ? !hit : hit
    }
    case 'like': {
      const target = value(expr.e, row)
      const pattern = value(expr.pattern, row)
      if (target === null || pattern === null) return null
      const hit = likeToRegExp(String(pattern)).test(String(target))
      return expr.negated ? !hit : hit
    }
    case 'cmp': {
      const l = value(expr.l, row)
      const r = value(expr.r, row)
      if (l === null || r === null) return null
      const order = compare(l, r)
      switch (expr.op) {
        case '=':
        case '==':
          return order === 0
        case '!=':
        case '<>':
          return order !== 0
        case '<':
          return order < 0
        case '<=':
          return order <= 0
        case '>':
          return order > 0
        default:
          return order >= 0
      }
    }
    default: {
      const target = value(expr, row)
      return target === null ? null : target !== 0 && target !== ''
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The database

interface Projection {
  kind: 'all' | 'col' | 'count' | 'min' | 'max'
  name: string
  alias: string
}

export class MemoryDatabase {
  private tables = new Map<string, TableData>()

  /** A point-in-time copy for `transaction()` to roll back to. Rows are replaced, never mutated. */
  snapshot(): Map<string, TableData> {
    const copy = new Map<string, TableData>()
    for (const [name, table] of this.tables)
      copy.set(name, { ...table, columns: [...table.columns], rows: [...table.rows] })
    return copy
  }

  restore(snapshot: Map<string, TableData>): void {
    this.tables = snapshot
  }

  run(sql: string, params: readonly SqlValue[] = []): Row[] {
    let cursor = 0
    let last: Row[] = []
    for (const statement of splitStatements(sql)) {
      const parser = new Parser(tokenise(statement), statement, params, cursor)
      last = this.runOne(parser, statement)
      cursor = parser.paramCursor()
    }
    return last
  }

  private table(name: string, sql: string): TableData {
    const table = this.tables.get(name)
    if (!table) throw new SqlError(`no such table: ${name}`, sql)
    return table
  }

  private runOne(parser: Parser, sql: string): Row[] {
    const head = parser.peek()
    const verb = head?.kind === 'name' ? head.value.toUpperCase() : ''
    switch (verb) {
      case 'CREATE':
        this.create(parser, sql)
        return []
      case 'DROP':
        this.drop(parser)
        return []
      case 'INSERT':
        this.insert(parser, sql)
        return []
      case 'UPDATE':
        this.update(parser, sql)
        return []
      case 'DELETE':
        this.delete(parser, sql)
        return []
      case 'SELECT':
        return this.select(parser, sql)
      case 'PRAGMA':
      case 'BEGIN':
      case 'COMMIT':
      case 'ROLLBACK':
      case 'VACUUM':
      case 'ANALYZE':
        return []
      default:
        throw new SqlError(`unsupported statement ${verb || '(empty)'}`, sql)
    }
  }

  private create(parser: Parser, sql: string): void {
    parser.expectWord('CREATE')
    parser.eatWord('UNIQUE')
    if (parser.eatWord('INDEX')) return // an in-memory scan needs no index; accepted and ignored.
    parser.expectWord('TABLE')
    if (parser.eatWord('IF')) {
      parser.expectWord('NOT')
      parser.expectWord('EXISTS')
    }
    const name = parser.name()
    if (this.tables.has(name)) return
    parser.expectPunct('(')
    const columns: ColumnDef[] = []
    const primaryKey: string[] = []
    let autoIncrement: string | null = null
    do {
      if (parser.isWord('PRIMARY')) {
        parser.expectWord('PRIMARY')
        parser.expectWord('KEY')
        parser.expectPunct('(')
        do primaryKey.push(parser.name())
        while (parser.eatPunct(','))
        parser.expectPunct(')')
        continue
      }
      if (parser.isWord('UNIQUE') && parser.isPunct('(', 1)) {
        parser.expectWord('UNIQUE')
        parser.expectPunct('(')
        const unique: string[] = []
        do unique.push(parser.name())
        while (parser.eatPunct(','))
        parser.expectPunct(')')
        for (const column of columns) if (unique.includes(column.name)) column.unique = true
        continue
      }
      const column: ColumnDef = { name: parser.name(), unique: false }
      while (!parser.isPunct(',') && !parser.isPunct(')') && !parser.atEnd()) {
        if (parser.isWord('PRIMARY')) {
          parser.expectWord('PRIMARY')
          parser.expectWord('KEY')
          primaryKey.push(column.name)
          if (parser.eatWord('AUTOINCREMENT')) autoIncrement = column.name
          continue
        }
        if (parser.isWord('UNIQUE')) {
          parser.expectWord('UNIQUE')
          column.unique = true
          continue
        }
        if (parser.eatPunct('(')) {
          while (!parser.eatPunct(')')) parser.take()
          continue
        }
        parser.take()
      }
      columns.push(column)
    } while (parser.eatPunct(','))
    parser.expectPunct(')')
    this.tables.set(name, { name, columns, primaryKey, autoIncrement, nextAuto: 1, rows: [] })
    void sql
  }

  private drop(parser: Parser): void {
    parser.expectWord('DROP')
    const isIndex = parser.isWord('INDEX')
    parser.take()
    if (parser.eatWord('IF')) parser.expectWord('EXISTS')
    const name = parser.name()
    if (!isIndex) this.tables.delete(name)
  }

  private insert(parser: Parser, sql: string): void {
    parser.expectWord('INSERT')
    let replace = false
    if (parser.eatWord('OR')) {
      replace = parser.isWord('REPLACE') || parser.isWord('IGNORE')
      parser.take()
    }
    parser.expectWord('INTO')
    const table = this.table(parser.name(), sql)
    const columns: string[] = []
    parser.expectPunct('(')
    do columns.push(parser.name())
    while (parser.eatPunct(','))
    parser.expectPunct(')')
    parser.expectWord('VALUES')
    do {
      parser.expectPunct('(')
      const row: Row = {}
      for (const column of table.columns) row[column.name] = null
      let index = 0
      do {
        const cell = value(parser.operand(), {})
        const name = columns[index]
        if (name !== undefined) row[name] = cell
        index += 1
      } while (parser.eatPunct(','))
      parser.expectPunct(')')
      if (table.autoIncrement !== null && row[table.autoIncrement] === null) {
        row[table.autoIncrement] = table.nextAuto
        table.nextAuto += 1
      }
      this.put(table, row, replace, sql)
    } while (parser.eatPunct(','))
  }

  private put(table: TableData, row: Row, replace: boolean, sql: string): void {
    if (table.primaryKey.length > 0) {
      const at = table.rows.findIndex((candidate) =>
        table.primaryKey.every((key) => compare(candidate[key] ?? null, row[key] ?? null) === 0),
      )
      if (at >= 0) {
        if (!replace) throw new SqlError(`UNIQUE constraint failed on ${table.name}`, sql)
        table.rows[at] = row
        return
      }
    }
    for (const column of table.columns) {
      if (!column.unique) continue
      const cell = row[column.name] ?? null
      if (cell === null) continue
      const clash = table.rows.some((other) => compare(other[column.name] ?? null, cell) === 0)
      if (!clash) continue
      if (!replace)
        throw new SqlError(`UNIQUE constraint failed: ${table.name}.${column.name}`, sql)
      table.rows = table.rows.filter((other) => compare(other[column.name] ?? null, cell) !== 0)
    }
    table.rows.push(row)
  }

  private update(parser: Parser, sql: string): void {
    parser.expectWord('UPDATE')
    const table = this.table(parser.name(), sql)
    parser.expectWord('SET')
    const assignments: { column: string; expr: Expr }[] = []
    do {
      const column = parser.name()
      parser.expectPunct('=')
      assignments.push({ column, expr: parser.operand() })
    } while (parser.eatPunct(','))
    const where = parser.eatWord('WHERE') ? parser.expr() : null
    table.rows = table.rows.map((row) => {
      if (where !== null && test(where, row) !== true) return row
      const next: Row = { ...row }
      for (const assignment of assignments) next[assignment.column] = value(assignment.expr, row)
      return next
    })
  }

  private delete(parser: Parser, sql: string): void {
    parser.expectWord('DELETE')
    parser.expectWord('FROM')
    const table = this.table(parser.name(), sql)
    const where = parser.eatWord('WHERE') ? parser.expr() : null
    table.rows = where === null ? [] : table.rows.filter((row) => test(where, row) !== true)
  }

  private select(parser: Parser, sql: string): Row[] {
    parser.expectWord('SELECT')
    const projections: Projection[] = []
    do {
      if (parser.eatPunct('*')) {
        projections.push({ kind: 'all', name: '*', alias: '*' })
        continue
      }
      if (
        (parser.isWord('COUNT') || parser.isWord('MIN') || parser.isWord('MAX')) &&
        parser.isPunct('(', 1)
      ) {
        const fn = parser.name().toUpperCase()
        parser.expectPunct('(')
        const inner = parser.eatPunct('*') ? '*' : parser.name()
        parser.expectPunct(')')
        const alias = parser.eatWord('AS') ? parser.name() : `${fn.toLowerCase()}(${inner})`
        projections.push({
          kind: fn === 'COUNT' ? 'count' : fn === 'MIN' ? 'min' : 'max',
          name: inner,
          alias,
        })
        continue
      }
      const name = parser.name()
      const alias = parser.eatWord('AS') ? parser.name() : name
      projections.push({ kind: 'col', name, alias })
    } while (parser.eatPunct(','))
    parser.expectWord('FROM')
    const table = this.table(parser.name(), sql)
    const where = parser.eatWord('WHERE') ? parser.expr() : null
    let rows = where === null ? table.rows : table.rows.filter((row) => test(where, row) === true)

    if (parser.eatWord('ORDER')) {
      parser.expectWord('BY')
      const keys: { column: string; desc: boolean }[] = []
      do {
        const column = parser.name()
        const desc = parser.isWord('DESC')
        if (desc || parser.isWord('ASC')) parser.take()
        keys.push({ column, desc })
      } while (parser.eatPunct(','))
      rows = [...rows].sort((a, b) => {
        for (const key of keys) {
          const order = compare(a[key.column] ?? null, b[key.column] ?? null)
          if (order !== 0) return key.desc ? -order : order
        }
        return 0
      })
    }

    let limit: number | null = null
    let offset = 0
    if (parser.eatWord('LIMIT')) {
      limit = Number(value(parser.operand(), {}) ?? 0)
      if (parser.eatWord('OFFSET')) offset = Number(value(parser.operand(), {}) ?? 0)
    }

    if (projections.some((p) => p.kind === 'count' || p.kind === 'min' || p.kind === 'max')) {
      const out: Row = {}
      for (const projection of projections) {
        if (projection.kind === 'count') {
          out[projection.alias] = rows.length
          continue
        }
        const values = rows
          .map((row) => row[projection.name] ?? null)
          .filter((cell): cell is string | number => cell !== null)
        const first = values[0]
        if (first === undefined) {
          out[projection.alias] = null
          continue
        }
        out[projection.alias] = values.reduce((best, cell) => {
          const order = compare(cell, best)
          return (projection.kind === 'min' ? order < 0 : order > 0) ? cell : best
        }, first)
      }
      return [out]
    }

    const page = rows.slice(offset, limit === null ? undefined : offset + limit)
    if (projections.length === 1 && projections[0]?.kind === 'all')
      return page.map((row) => ({ ...row }))
    return page.map((row) => {
      const out: Row = {}
      for (const projection of projections) {
        if (projection.kind === 'all') {
          Object.assign(out, row)
          continue
        }
        out[projection.alias] = row[projection.name] ?? null
      }
      return out
    })
  }
}

/** Statements are separated by `;` outside quotes. */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i] ?? ''
    if (quote !== null) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === ';') {
      if (current.trim() !== '') out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') out.push(current.trim())
  return out
}
