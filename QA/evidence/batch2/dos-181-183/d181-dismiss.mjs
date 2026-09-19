// DOS-181 — dismiss a named system dialog button by TEXT (never a coordinate).
// node d181-dismiss.mjs "No thanks" [more texts…]
import * as A from './d181-lib.mjs'

async function main() {
  const wanted = process.argv.slice(2)
  await A.newSession()
  await A.sleep(1200)
  for (const t of wanted) {
    const e = await A.el(A.byText(t))
    if (!e) {
      A.log('not on screen:', t)
      continue
    }
    const pkg = await A.attr(e, 'package').catch(() => '?')
    await A.click(e)
    A.log('clicked', JSON.stringify(t), 'in', pkg)
    await A.sleep(1500)
  }
  A.log('screen now:', await A.texts(1200))
  await A.quit()
}

main().catch(async (e) => {
  A.log('dismiss FAILED', e.message)
  await A.quit()
  process.exit(1)
})
