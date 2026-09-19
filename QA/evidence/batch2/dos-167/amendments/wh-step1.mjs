import * as A from './wh-lib.mjs'
const user = process.argv[2] || 'bharat.jadhav'
const prefix = process.argv[3] || 'wh-02'
await A.newSession()
await A.sleep(2000)
await A.dismissSystemDialogs()
await A.signIn(user, prefix)
A.log('sqlite dir:\n' + A.sqliteFiles())
await A.quit()
