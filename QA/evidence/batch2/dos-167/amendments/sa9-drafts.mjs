import * as A from './sa-appium.mjs'
const prefix = 'sa-09'
async function main() {
  await A.newSession(); await A.sleep(3500); await A.dismissLogBox()
  await A.clickText('Orders'); await A.sleep(3000)
  await A.clickText('Drafts'); await A.sleep(3000); await A.dismissLogBox()
  A.log('DRAFTS:', await A.texts(2500))
  await A.shot(`${prefix}-01-drafts`)
  await A.quit()
}
main().catch(async (e) => { A.log('FAILED', e.message); try { await A.shot(`${prefix}-ERROR`) } catch {}; await A.quit(); process.exit(1) })
