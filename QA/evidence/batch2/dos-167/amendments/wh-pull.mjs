// Pull the app's SQLite store WITH its -wal/-shm so nothing in the write-ahead log is missed.
import { execFileSync } from 'node:child_process'
const ADB = process.env.HOME + '/Library/Android/sdk/platform-tools/adb'
const PKG = 'in.distributionos.warehouse'
const EV = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/amendments'
const adb = (a, o = {}) => execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o })

export function listStores() {
  return adb(['shell', 'run-as', PKG, 'ls', '-la', 'files/SQLite']).trim()
}

export function pull(dbName, tag) {
  for (const suffix of ['', '-wal', '-shm']) {
    const remote = `files/SQLite/${dbName}${suffix}`
    const tmp = `/data/local/tmp/${tag}.db${suffix}`
    try {
      adb(['shell', `run-as ${PKG} cat ${remote} > ${tmp}`])
      adb(['pull', tmp, `${EV}/${tag}.db${suffix}`])
      adb(['shell', 'rm', '-f', tmp])
    } catch (e) {
      if (suffix === '') throw e
    }
  }
  return `${EV}/${tag}.db`
}

export function sql(local, q) {
  try {
    return execFileSync('sqlite3', [local, q], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
  } catch (e) {
    return 'sqlite failed: ' + String(e.stderr || e.message).slice(0, 400)
  }
}

if ((process.argv[1] || '').endsWith('wh-pull.mjs')) {
  const [, , dbName, tag] = process.argv
  const local = pull(dbName, tag)
  console.log('tables:', sql(local, ".tables").replace(/\s+/g, ' '))
  console.log('== _outbox ==')
  console.log(sql(local, 'select seq,op_id,tbl,row_id,op,status,attempts,created_at,sent_at,acked_at from _outbox order by seq'))
  console.log('== payload ==')
  console.log(sql(local, 'select data from _outbox order by seq'))
}
