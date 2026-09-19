/**
 * DOS-167 close — sign in as <user> on the sales app and wait until the beat is on the phone.
 * Usage: node signin.mjs <user> <tag> [--no-wait-sync]
 * Marks the sign-in tap's wall-clock in <tag>-signin.txt: every offset in the timeline is measured from it.
 */
import fs from 'node:fs'

import { newSession, Session, sleep, waitFor, dismissLogBox } from './drive.mjs'

const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'
const user = process.argv[2]
const tag = process.argv[3]
const waitSync = !process.argv.includes('--no-wait-sync')
const lines = []
const say = (s) => {
  lines.push(s)
  console.log(s)
}

const sess = new Session(await newSession('in.distributionos.sales'))
say(`# ${tag}: sign in ${user}  session ${sess.id}  ${new Date().toISOString()}`)

await dismissLogBox(sess)
await waitFor(async () => (await sess.texts()).some((t) => t.includes('Distribution OS - Sales') || t === 'Sign in'), {
  timeout: 240000,
  what: 'the sign-in form',
})
await sess.shot(`${tag}-1-signin-form`)
say(`form texts: ${(await sess.texts()).join(' | ').slice(0, 400)}`)

const u = await sess.byId('sign-in-username')
await sess.click(u)
await sess.clear(u)
await sess.type(u, user)
const p = await sess.byId('sign-in-password')
await sess.click(p)
await sess.clear(p)
await sess.type(p, 'Dos@1234')
await sess.hideKeyboard()
await sleep(300)

const submit = await sess.byId('sign-in-submit')
const TAP = Date.now()
await sess.click(submit)
say(`SIGN_IN_TAPPED_AT ${TAP} ${new Date(TAP).toISOString()}`)
fs.writeFileSync(`${OUT}/${tag}-signin-tap.txt`, `${String(TAP)}\n${new Date(TAP).toISOString()}\n${user}\n`)

// the first seconds, as screenshots, for the leak window
for (let i = 1; i <= 6; i += 1) {
  await sess.shot(`${tag}-2-after-tap-${String(i)}`)
  say(`shot ${i} +${String(Date.now() - TAP)}ms`)
}

await waitFor(
  async () => {
    const t = await sess.texts()
    return !t.some((x) => x.includes('Use the username') || x.includes('Invalid username')) && t.some((x) => x === 'Beat' || x.includes("Today's beat"))
  },
  { timeout: 180000, what: 'the beat screen' },
)
await dismissLogBox(sess)
await sess.shot(`${tag}-3-home`)
say(`home +${String(Date.now() - TAP)}ms: ${(await sess.texts()).join(' | ').slice(0, 700)}`)

if (waitSync) {
  await waitFor(
    async () => {
      const t = await sess.texts()
      return t.some((x) => /Shops: [1-9]/.test(x)) || t.some((x) => x.includes('Updated'))
    },
    { timeout: 180000, what: 'the beat synced onto the phone' },
  )
  await sleep(4000)
  await dismissLogBox(sess)
  await sess.shot(`${tag}-4-synced`)
  say(`synced +${String(Date.now() - TAP)}ms: ${(await sess.texts()).join(' | ').slice(0, 700)}`)
}

fs.appendFileSync(`${OUT}/${tag}-signin.txt`, lines.join('\n') + '\n')
console.log('SESSION_ID', sess.id)
