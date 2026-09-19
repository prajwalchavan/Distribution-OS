/**
 * Sign a person in on the iPhone simulator and record the EXACT epoch millisecond of the "Sign in" tap.
 * That millisecond is the zero of every offset in the timeline files.
 *
 * Usage: node signin.mjs <username> <password> <shotPrefix>
 * Writes <shotPrefix>-1-signin-form.png, <shotPrefix>-2-after-tap-<n>.png (six, ~1 s apart),
 *        <shotPrefix>-3-home.png, <shotPrefix>-4-synced.png and prints the tap time.
 */
import * as d from './ios.mjs'

const [user, pass, prefix] = process.argv.slice(2)

await d.shot(`${prefix}-1-signin-form.png`)
console.log('--- before:', (await d.labels()).slice(0, 12).join(' | '))

await d.setClass('XCUIElementTypeTextField', 0, user)
await d.sleep(400)
// the password box is a SecureTextField once focused; try both
try {
  await d.setClass('XCUIElementTypeSecureTextField', 0, pass)
} catch {
  await d.setClass('XCUIElementTypeTextField', 1, pass)
}
await d.sleep(400)
await d.shot(`${prefix}-1b-filled.png`)

const { t, el } = await d.tapLabel((l) => l === 'Sign in', 0, 'Button')
if (!el) {
  console.log('SIGN IN BUTTON NOT FOUND')
  process.exit(2)
}
console.log(`SIGNIN_TAP ${user} t=${t} ${new Date(t).toISOString()} at ${Math.round(el.x + el.w / 2)},${Math.round(el.y + el.h / 2)}`)

for (let i = 1; i <= 6; i++) {
  await d.sleep(1000)
  await d.shot(`${prefix}-2-after-tap-${i}.png`)
}
await d.sleep(2000)
await d.shot(`${prefix}-3-home.png`)
console.log('--- home:', (await d.labels()).slice(0, 18).join(' | '))
await d.sleep(8000)
await d.shot(`${prefix}-4-synced.png`)
console.log('--- settled:', (await d.labels()).slice(0, 18).join(' | '))
console.log(`SIGNIN_TAP_EPOCH=${t}`)
