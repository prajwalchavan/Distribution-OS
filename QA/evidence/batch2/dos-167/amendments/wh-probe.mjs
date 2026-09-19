import * as A from './wh-appium.mjs'
await A.newSession()
await A.sleep(1500)
await A.dismissSystemDialogs()
const xml = await A.source()
console.log(xml.replace(/></g, '>\n<').split('\n').filter(l=>/resource-id="[^"]+"|content-desc="[^"]{1,80}"|text="[^"]+"/.test(l)).map(l=>l.replace(/bounds="/,'|bounds="').slice(0,300)).join('\n').slice(0,6000))
await A.quit()
