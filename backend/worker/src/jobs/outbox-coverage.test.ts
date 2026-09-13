import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PgBoss } from 'pg-boss'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import type { Db } from '@dos/db'
import { stubProviders } from '@dos/core/notifications'
import { registerAiJobs } from './ai.js'
import { registerDocintJobs } from './docint.js'
import { registerIncentivesJobs } from './incentives.js'
import { registerIntegrationsJobs } from './integrations.js'
import { registerNotificationsJobs } from './notifications.js'
import { clearOutboxHandlers, registeredEventTypes, registerOutboxHandler } from './outbox-relay.js'
import { registerReportingJobs } from './reporting.js'

/*
 * The outbox relay claims only rows whose event type has a registered handler; every other row waits,
 * unpublished, for ever. That is how "Send statement" answered 200 and sent nothing (DOS-007): the service
 * wrote `StatementRequested` and no worker job listened. This guard reads every event type the backend
 * can write to `outbox_events` straight from the source and fails when one has no handler in the worker
 * and is not declared audit-only below — so the next request nobody consumes fails CI instead of a shop.
 */

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SOURCE_ROOTS = ['libs/core/src', 'libs/database/src', 'worker/src']
const MAIN = join(backendRoot, 'worker/src/main.ts')

/**
 * Event types written for the record: no background work follows from them today, so the relay never
 * claims their rows. Adding a type here is the decision that nothing has to happen when it is written.
 * An event that asks for work — a render, a send, a recompute (`StatementRequested` before DOS-007) —
 * needs a handler instead. The list cannot rot: a type that stops being emitted, or gains a handler,
 * fails the guard until it is removed.
 */
const AUDIT_ONLY: ReadonlySet<string> = new Set([
  // receivables
  'CashDiscountRealised',
  'InvoicePaid',
  'ChequeDeposited',
  'AllocationChanged',
  'PaymentIntentCreated',
  'InvoiceWrittenOff',
  'ChequeBounced',
  'ReceiptReversed',
  // orders (fulfilment steps; the shop hears confirm / cancel through notifications)
  'OrderPicking',
  'OrderPacked',
  'OrderDispatched',
  'OrderDelivered',
  'OrderPartiallyDelivered',
  'OrderReturnedUndelivered',
  // warehouse
  'PicklistStarted',
  'LoadSheetApproved',
  'LoadSheetConfirmed',
  'DeliveryChallanIssued',
  // delivery (the doorstep receipt is announced once, as `ReceiptRecorded`)
  'TripPlanned',
  'TripLoading',
  'TripReturned',
  'TripCancelled',
  'StopFailed',
  'CollectionRecorded',
  'VanSaleInvoiced',
  'TripSettled',
  'TripSettlementVariance',
  // billing
  'InvoiceCancelled',
  'CreditNoteIssued',
  // docint (the pipeline's later steps run on pg-boss queues, not on these rows)
  'docint.document.extracted',
  'docint.document.needs_review',
  'docint.document.reviewed',
  'docint.document.failed',
  'docint.supplier_invoice.drafted',
  // claims (the claim sheet itself is rendered off `integrations.export.requested`)
  'ClaimSubmitted',
  'ClaimSettled',
  'ClaimRejected',
  'ClaimWrittenOff',
  'ClaimStatementRequested',
  // ai
  'AiOrderDraftParsed',
  'AiOrderDraftConfirmed',
  // incentives
  'IncentiveStatementComputed',
  'IncentiveStatementApproved',
  // integrations. docs/plans/integrations.md §7 names notifications as a later consumer of both ("import
  // finished", "your export is ready"); that consumer is not built, and nothing waits on these rows today.
  'ImportCommitted',
  'ExportReady',
])

/** Everything `main.ts` runs that registers outbox handlers, called here the same way. */
const REGISTRARS: Readonly<Record<string, (boss: PgBoss, db: Db) => Promise<void>>> = {
  registerDocintJobs,
  registerIntegrationsJobs,
  registerNotificationsJobs: (boss, db) => registerNotificationsJobs(boss, db, stubProviders()),
  registerReportingJobs,
  registerIncentivesJobs,
  registerAiJobs,
}

/** A pg-boss that accepts every queue, worker and schedule and runs nothing. */
const idleBoss = {
  createQueue: async () => undefined,
  work: async () => 'idle',
  schedule: async () => undefined,
  send: async () => null,
} as unknown as PgBoss

// ---------------------------------------------------------------------------------------------------------------
// the source scan

interface Defined<T> {
  file: string
  value: T
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') out.push(...sourceFiles(path))
    } else if (entry.name.endsWith('.ts') && !/\.(spec|test|d)\.ts$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ||
  ts.isAsExpression(e) ||
  ts.isSatisfiesExpression(e) ||
  ts.isNonNullExpression(e)
    ? unwrap(e.expression)
    : e

const isText = (e: ts.Node): e is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)

/**
 * Every event type an `insert(outboxEvents).values({ eventType })` can write, resolved through string
 * constants, `as const` objects, literal-union parameter types and — for a helper whose parameter is a
 * plain `string` — the arguments at each of its call sites. Anything it cannot resolve is reported, never
 * skipped, so a new way of writing an event fails the guard until the scan understands it.
 */
function scanOutboxEventTypes(extraFiles: readonly string[] = []): {
  emitted: Map<string, Set<string>>
  unresolved: string[]
  resolve: (e: ts.Expression) => string[]
  files: Map<string, ts.SourceFile>
} {
  const files = new Map<string, ts.SourceFile>()
  for (const root of SOURCE_ROOTS)
    for (const path of sourceFiles(join(backendRoot, root))) {
      const text = readFileSync(path, 'utf8')
      files.set(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true))
    }
  for (const path of extraFiles)
    if (!files.has(path))
      files.set(
        path,
        ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true),
      )

  const strings = new Map<string, Defined<string>[]>()
  const objects = new Map<string, Defined<string[]>[]>()
  const aliases = new Map<string, Defined<ts.TypeNode>[]>()
  const callables = new Map<string, number>()
  const add = <T>(map: Map<string, Defined<T>[]>, name: string, file: string, value: T): void => {
    map.set(name, [...(map.get(name) ?? []), { file, value }])
  }
  const walk = (node: ts.Node, visit: (n: ts.Node) => void): void => {
    visit(node)
    ts.forEachChild(node, (child) => {
      walk(child, visit)
    })
  }

  for (const [file, source] of files) {
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue
          const init = unwrap(d.initializer)
          if (isText(init)) add(strings, d.name.text, file, init.text)
          if (ts.isObjectLiteralExpression(init)) {
            const values = init.properties.map((p) =>
              ts.isPropertyAssignment(p) && isText(unwrap(p.initializer))
                ? (unwrap(p.initializer) as ts.StringLiteral).text
                : null,
            )
            if (values.length > 0 && values.every((v) => v !== null))
              add(objects, d.name.text, file, values)
          }
        }
      }
      if (ts.isTypeAliasDeclaration(statement))
        add(aliases, statement.name.text, file, statement.type)
    }
    walk(source, (n) => {
      if (
        (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) &&
        n.name &&
        ts.isIdentifier(n.name)
      )
        callables.set(n.name.text, (callables.get(n.name.text) ?? 0) + 1)
    })
  }

  const unresolved: string[] = []
  const where = (node: ts.Node): string => {
    const source = node.getSourceFile()
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
    return `${relative(backendRoot, source.fileName)}:${String(line)}`
  }
  const fail = (node: ts.Node, why: string): string[] => {
    unresolved.push(`${where(node)} ${why}: ${node.getText().slice(0, 80)}`)
    return []
  }
  /** The one definition of `name`: the file's own, else the only one in the backend. */
  const lookup = <T>(map: Map<string, Defined<T>[]>, name: string, at: ts.Node): T | undefined => {
    const all = map.get(name) ?? []
    const own = all.find((d) => d.file === at.getSourceFile().fileName)
    if (own) return own.value
    return all.length === 1 ? all[0]?.value : undefined
  }

  const resolveType = (
    type: ts.TypeNode,
    param: ts.ParameterDeclaration,
    depth: number,
  ): string[] => {
    if (depth > 8) return fail(type, 'type too deep')
    if (ts.isParenthesizedTypeNode(type)) return resolveType(type.type, param, depth + 1)
    if (ts.isUnionTypeNode(type)) return type.types.flatMap((t) => resolveType(t, param, depth + 1))
    if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return [type.literal.text]
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && !type.typeArguments) {
      const alias = lookup(aliases, type.typeName.text, type)
      return alias ? resolveType(alias, param, depth + 1) : fail(type, 'unknown type')
    }
    if (ts.isIndexedAccessTypeNode(type)) {
      let object = type.objectType
      while (ts.isParenthesizedTypeNode(object)) object = object.type
      if (ts.isTypeQueryNode(object) && ts.isIdentifier(object.exprName)) {
        const values = lookup(objects, object.exprName.text, type)
        if (values) return values
      }
      return fail(type, 'unresolvable indexed type')
    }
    if (type.kind === ts.SyntaxKind.StringKeyword) return fromCallSites(param, depth + 1)
    return fail(type, 'unresolvable parameter type')
  }

  /** A `string` parameter: what every caller of the helper passes in that position. */
  const fromCallSites = (param: ts.ParameterDeclaration, depth: number): string[] => {
    const fn = param.parent
    const name =
      (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) &&
      fn.name &&
      ts.isIdentifier(fn.name)
        ? fn.name.text
        : null
    if (!name) return fail(param, 'string parameter of an unnamed function')
    if ((callables.get(name) ?? 0) !== 1) return fail(param, `helper name ${name} is not unique`)
    const index = fn.parameters.indexOf(param)
    const out: string[] = []
    for (const source of files.values())
      walk(source, (n) => {
        if (!ts.isCallExpression(n)) return
        const callee = n.expression
        const called = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null
        if (called !== name) return
        const arg = n.arguments[index]
        if (arg) out.push(...resolveExpr(arg, depth + 1))
        else if (param.initializer) out.push(...resolveExpr(param.initializer, depth + 1))
        else fail(n, `call passes no ${param.name.getText()}`)
      })
    return out
  }

  const resolveIdentifier = (id: ts.Identifier, depth: number): string[] => {
    for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p)) {
        const param = p.parameters.find((q) => ts.isIdentifier(q.name) && q.name.text === id.text)
        if (param)
          return param.type
            ? resolveType(param.type, param, depth + 1)
            : fail(id, 'untyped parameter')
      }
    }
    const value = lookup(strings, id.text, id)
    return value !== undefined ? [value] : fail(id, 'unknown identifier')
  }

  const resolveExpr = (expression: ts.Expression, depth: number): string[] => {
    if (depth > 12) return fail(expression, 'expression too deep')
    const e = unwrap(expression)
    if (isText(e)) return [e.text]
    if (ts.isConditionalExpression(e))
      return [...resolveExpr(e.whenTrue, depth + 1), ...resolveExpr(e.whenFalse, depth + 1)]
    if (ts.isIdentifier(e)) return resolveIdentifier(e, depth + 1)
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const values = lookup(objects, e.expression.text, e)
      const key = e.name.text
      const object = values ? findObject(e.expression.text, e) : undefined
      const member = object?.properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText() === key,
      )
      if (member && ts.isPropertyAssignment(member))
        return resolveExpr(member.initializer, depth + 1)
      return fail(e, 'unknown constant member')
    }
    if (ts.isElementAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const values = lookup(objects, e.expression.text, e)
      return values ?? fail(e, 'unknown constant map')
    }
    return fail(e, 'unresolvable expression')
  }

  const findObject = (name: string, at: ts.Node): ts.ObjectLiteralExpression | undefined => {
    const all = (objects.get(name) ?? []).map((d) => d.file)
    const file = all.includes(at.getSourceFile().fileName)
      ? at.getSourceFile().fileName
      : all.length === 1
        ? all[0]
        : undefined
    const source = file ? files.get(file) : undefined
    for (const statement of source?.statements ?? [])
      if (ts.isVariableStatement(statement))
        for (const d of statement.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
            const init = unwrap(d.initializer)
            if (ts.isObjectLiteralExpression(init)) return init
          }
    return undefined
  }

  const emitted = new Map<string, Set<string>>()
  for (const [file, source] of files) {
    const text = source.getFullText()
    if (/insert\s+into\s+"?outbox_events/i.test(text))
      unresolved.push(`${relative(backendRoot, file)} writes outbox_events in raw SQL`)
    let sites = 0
    walk(source, (n) => {
      if (
        !ts.isCallExpression(n) ||
        !ts.isPropertyAccessExpression(n.expression) ||
        n.expression.name.text !== 'values'
      )
        return
      const insert = n.expression.expression
      if (
        !ts.isCallExpression(insert) ||
        !ts.isPropertyAccessExpression(insert.expression) ||
        insert.expression.name.text !== 'insert' ||
        insert.arguments[0]?.getText() !== 'outboxEvents'
      )
        return
      sites += 1
      const arg = n.arguments[0] ? unwrap(n.arguments[0]) : undefined
      const rows = arg && ts.isArrayLiteralExpression(arg) ? arg.elements : arg ? [arg] : []
      if (rows.length === 0) fail(n, 'values() without rows')
      for (const row of rows) {
        const object = unwrap(row)
        if (!ts.isObjectLiteralExpression(object)) {
          fail(row, 'outbox row is not an object literal')
          continue
        }
        const property = object.properties.find((p) => p.name?.getText() === 'eventType')
        const types =
          property && ts.isPropertyAssignment(property)
            ? resolveExpr(property.initializer, 0)
            : property && ts.isShorthandPropertyAssignment(property)
              ? resolveIdentifier(property.name, 0)
              : fail(object, 'outbox row without eventType')
        for (const type of types) emitted.set(type, (emitted.get(type) ?? new Set()).add(where(n)))
      }
    })
    const written = text.match(/\.insert\(\s*outboxEvents\s*\)/g)?.length ?? 0
    if (written !== sites)
      unresolved.push(
        `${relative(backendRoot, file)} inserts into outboxEvents ${String(written)} time(s), scanned ${String(sites)}`,
      )
  }
  return { emitted, unresolved, resolve: (e) => resolveExpr(e, 0), files }
}

/** What `main.ts` wires: the `register*Jobs` registrars it awaits and the handlers it registers itself. */
function mainWiring(scan: ReturnType<typeof scanOutboxEventTypes>): {
  registrars: string[]
  direct: string[]
} {
  const source = scan.files.get(MAIN)
  if (!source) throw new Error(`cannot read ${MAIN}`)
  const registrars: string[] = []
  const direct: string[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (/^register\w+Jobs$/.test(n.expression.text)) registrars.push(n.expression.text)
      const first = n.arguments[0]
      if (n.expression.text === 'registerOutboxHandler' && first)
        direct.push(...scan.resolve(first))
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  return { registrars: registrars.sort(), direct: direct.sort() }
}

describe('outbox coverage guard', () => {
  const scan = scanOutboxEventTypes([MAIN])

  afterAll(() => {
    clearOutboxHandlers()
  })

  it('DOS-007: the guard wires the same job registrars and direct outbox handlers as main.ts', () => {
    const wiring = mainWiring(scan)
    expect(Object.keys(REGISTRARS).sort()).toEqual(wiring.registrars)
    expect(wiring.direct).toEqual(['DocumentRenderRequested'])
  })

  it('DOS-007: every event type a module writes to the outbox has a registered worker handler or is declared audit-only', async () => {
    expect(scan.unresolved).toEqual([])
    const emitted = [...scan.emitted.keys()].sort()
    // Not vacuous: each way the modules name an event type today is resolved.
    expect(emitted).toEqual(
      expect.arrayContaining([
        'OrderConfirmed', // a literal-union type alias on the helper
        'InvoiceCancelled', // an inline literal union on a private method
        'DocumentRenderRequested', // a string constant
        'CreditNoteIssued', // a literal in the row
        'ChequeBounced', // a conditional argument to a `string` helper
        'docint.supplier_invoice.drafted', // an `as const` member passed to a `string` helper
        'IncentiveAchievementRecomputeRequested', // `(typeof EVENTS)[keyof typeof EVENTS]`
        'StatementRequested',
      ]),
    )

    clearOutboxHandlers()
    for (const register of Object.values(REGISTRARS)) await register(idleBoss, {} as Db)
    for (const type of mainWiring(scan).direct) registerOutboxHandler(type, async () => undefined)
    const handled = new Set(registeredEventTypes())

    const orphaned = emitted
      .filter((type) => !handled.has(type) && !AUDIT_ONLY.has(type))
      .map((type) => `${type} (written at ${[...(scan.emitted.get(type) ?? [])].join(', ')})`)
    expect(orphaned).toEqual([])
    expect([...AUDIT_ONLY].filter((type) => !scan.emitted.has(type))).toEqual([])
    expect([...AUDIT_ONLY].filter((type) => handled.has(type))).toEqual([])
  })
})
