// DOS-181 — copy the phone's own SQLite store out and read the rows that matter.
// node d181-pull-db.mjs <tag>
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import * as A from './d181-lib.mjs'

const tag = process.argv[2] || 'db'
const PKG = 'in.distributionos.delivery'

function sh(cmd) {
  return execFileSync('/bin/sh', ['-c', cmd], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const ADB = process.env.HOME + '/Library/Android/sdk/platform-tools/adb'

function main() {
  const ls = sh(`"${ADB}" shell run-as ${PKG} ls files/SQLite`).trim().split(/\s+/)
  const base = ls.find((f) => !f.endsWith('-shm') && !f.endsWith('-wal'))
  if (!base) throw new Error('no store file: ' + ls.join(' '))
  A.log('store file', base)
  // Copy the file AND its -wal/-shm so the pulled copy holds everything the app has written.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      sh(`"${ADB}" shell "run-as ${PKG} cat files/SQLite/${base}${suffix} > /data/local/tmp/${tag}.db${suffix}"`)
      sh(`"${ADB}" pull /data/local/tmp/${tag}.db${suffix} "${A.EV}/${tag}.db${suffix}" >/dev/null`)
      sh(`"${ADB}" shell rm -f /data/local/tmp/${tag}.db${suffix}`)
    } catch (e) {
      A.log('no', suffix || 'main', String(e.message).slice(0, 80))
    }
  }
  const db = `${A.EV}/${tag}.db`
  const q = (sql) => {
    try {
      return execFileSync('sqlite3', [db, sql], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
    } catch (e) {
      return 'SQL FAILED: ' + String(e.message).slice(0, 200)
    }
  }
  const out = []
  const add = (title, sql) => {
    const r = q(sql)
    out.push(`--- ${title}\n${sql}\n${r}\n`)
    A.log(`--- ${title}\n${r}`)
  }
  add('tables', "select name from sqlite_master where type='table' order by name;")
  out.push('')
  writeFileSync(`${A.EV}/${tag}-tables.txt`, out.join('\n'))
  const tables = q("select name from sqlite_master where type='table' order by name;").split('\n')
  const outbox = tables.filter((t) => /outbox|op|queue/i.test(t))
  A.log('candidate outbox tables:', outbox.join(', '))
}

main()
