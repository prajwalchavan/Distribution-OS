/**
 * The memory adapter's engine, on its own. Everything above it — the schema, the pull, the outbox —
 * assumes these statements mean what SQLite means by them, so they are asserted here once.
 */
import { describe, expect, it } from 'vitest'

import { MemoryDatabase, SqlError, splitStatements } from './sql.js'

function fresh(): MemoryDatabase {
  const db = new MemoryDatabase()
  db.run(
    'CREATE TABLE IF NOT EXISTS shops (id TEXT, name TEXT, dues INTEGER, beat_id TEXT, PRIMARY KEY (id))',
  )
  return db
}

describe('MemoryDatabase', () => {
  it('inserts, selects and orders like SQLite', () => {
    const db = fresh()
    db.run('INSERT INTO shops (id, name, dues, beat_id) VALUES (?, ?, ?, ?)', [
      'a',
      'Alan Stores',
      1200,
      'b1',
    ])
    db.run('INSERT INTO shops (id, name, dues, beat_id) VALUES (?, ?, ?, ?)', [
      'b',
      'Bharat Kirana',
      300,
      'b1',
    ])
    const rows = db.run('SELECT * FROM shops ORDER BY dues DESC')
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('replaces on the primary key and refuses a duplicate without OR REPLACE', () => {
    const db = fresh()
    db.run('INSERT INTO shops (id, name) VALUES (?, ?)', ['a', 'first'])
    db.run('INSERT OR REPLACE INTO shops (id, name) VALUES (?, ?)', ['a', 'second'])
    expect(db.run('SELECT name FROM shops')).toEqual([{ name: 'second' }])
    expect(() => db.run('INSERT INTO shops (id, name) VALUES (?, ?)', ['a', 'third'])).toThrow(
      SqlError,
    )
  })

  it('binds placeholders in written order across SET and WHERE', () => {
    const db = fresh()
    db.run('INSERT INTO shops (id, name, dues) VALUES (?, ?, ?)', ['a', 'Alan', 100])
    db.run('INSERT INTO shops (id, name, dues) VALUES (?, ?, ?)', ['b', 'Bharat', 200])
    db.run('UPDATE shops SET name = ?, dues = ? WHERE id = ?', ['Changed', 999, 'b'])
    expect(db.run('SELECT id, name, dues FROM shops ORDER BY id')).toEqual([
      { id: 'a', name: 'Alan', dues: 100 },
      { id: 'b', name: 'Changed', dues: 999 },
    ])
  })

  it('runs a WHERE once per row without eating a placeholder twice', () => {
    const db = fresh()
    for (const id of ['a', 'b', 'c'])
      db.run('INSERT INTO shops (id, beat_id) VALUES (?, ?)', [id, id === 'c' ? 'b2' : 'b1'])
    const rows = db.run('SELECT id FROM shops WHERE beat_id = ? ORDER BY id', ['b1'])
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('supports IN, IS NULL, LIKE, NOT and parentheses', () => {
    const db = fresh()
    db.run('INSERT INTO shops (id, name, dues) VALUES (?, ?, ?)', ['a', 'Alan Stores', null])
    db.run('INSERT INTO shops (id, name, dues) VALUES (?, ?, ?)', ['b', 'Bharat', 5])
    db.run('INSERT INTO shops (id, name, dues) VALUES (?, ?, ?)', ['c', 'Chetan', 9])
    expect(db.run('SELECT id FROM shops WHERE id IN (?, ?) ORDER BY id', ['a', 'c'])).toEqual([
      { id: 'a' },
      { id: 'c' },
    ])
    expect(db.run('SELECT id FROM shops WHERE dues IS NULL')).toEqual([{ id: 'a' }])
    expect(db.run("SELECT id FROM shops WHERE name LIKE 'Alan%'")).toEqual([{ id: 'a' }])
    expect(
      db.run('SELECT id FROM shops WHERE (dues > ? AND dues < ?) OR id = ? ORDER BY id', [
        4,
        6,
        'a',
      ]),
    ).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(db.run('SELECT id FROM shops WHERE dues NOT IN (?) ORDER BY id', [5])).toEqual([
      { id: 'c' },
    ])
  })

  it('counts, and answers MIN over a filtered set', () => {
    const db = fresh()
    db.run('INSERT INTO shops (id, dues) VALUES (?, ?)', ['a', 40])
    db.run('INSERT INTO shops (id, dues) VALUES (?, ?)', ['b', 10])
    expect(db.run('SELECT COUNT(*) AS n FROM shops')).toEqual([{ n: 2 }])
    expect(db.run('SELECT COUNT(*) AS n, MIN(dues) AS at FROM shops WHERE dues > ?', [20])).toEqual(
      [{ n: 1, at: 40 }],
    )
    expect(db.run('SELECT MIN(dues) AS at FROM shops WHERE dues > ?', [99])).toEqual([{ at: null }])
  })

  it('auto-increments a rowid primary key and honours a UNIQUE column', () => {
    const db = new MemoryDatabase()
    db.run('CREATE TABLE q (seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE, tbl TEXT)')
    db.run('INSERT INTO q (op_id, tbl) VALUES (?, ?)', ['o1', 'visits'])
    db.run('INSERT INTO q (op_id, tbl) VALUES (?, ?)', ['o2', 'visits'])
    expect(db.run('SELECT seq, op_id FROM q ORDER BY seq')).toEqual([
      { seq: 1, op_id: 'o1' },
      { seq: 2, op_id: 'o2' },
    ])
    expect(() => db.run('INSERT INTO q (op_id) VALUES (?)', ['o1'])).toThrow(/UNIQUE/)
  })

  it('sorts NULLs first and numbers before strings, as SQLite does', () => {
    const db = fresh()
    db.run('INSERT INTO shops (id, name) VALUES (?, ?)', ['a', null])
    db.run('INSERT INTO shops (id, name) VALUES (?, ?)', ['b', 'zzz'])
    expect(db.run('SELECT id FROM shops ORDER BY name')).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('splits a multi-statement script outside quotes', () => {
    expect(splitStatements("SELECT ';' FROM shops; DELETE FROM shops")).toEqual([
      "SELECT ';' FROM shops",
      'DELETE FROM shops',
    ])
  })

  it('rolls a snapshot back', () => {
    const db = fresh()
    db.run('INSERT INTO shops (id) VALUES (?)', ['a'])
    const snapshot = db.snapshot()
    db.run('INSERT INTO shops (id) VALUES (?)', ['b'])
    expect(db.run('SELECT COUNT(*) AS n FROM shops')).toEqual([{ n: 2 }])
    db.restore(snapshot)
    expect(db.run('SELECT COUNT(*) AS n FROM shops')).toEqual([{ n: 1 }])
  })
})
