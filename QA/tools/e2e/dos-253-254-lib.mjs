// Shared by the DOS-253 / DOS-254 walks (business simulation day 7 fixes). Test copies only.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PW = process.env.PLAYWRIGHT_MODULE ?? 'playwright'
export const { chromium } = await import(PW)

export const APP = process.env.APP_URL ?? 'http://127.0.0.1:5417'
export const DB = process.env.DATABASE_URL ?? ''
if (!/test/.test(DB)) {
  console.error('DATABASE_URL must name a test copy (it writes)')
  process.exit(2)
}
const PSQL = existsSync('/opt/homebrew/opt/postgresql@17/bin/psql')
  ? '/opt/homebrew/opt/postgresql@17/bin/psql'
  : 'psql'
export const EV = fileURLToPath(new URL('../../evidence/simulation/fixes/day7/', import.meta.url))
mkdirSync(EV, { recursive: true })
export const DESK = { width: 1280, height: 800 }
export const PHONE = { width: 390, height: 844 }
export const TENANT = "(select id from tenants where slug = 'tarsun')"

export const results = []
export function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
export function sql(query) {
  return execFileSync(PSQL, [DB, '-Atc', query], { encoding: 'utf8' }).trim()
}
/** A screenshot and the page's visible text beside it (the text is what a check reads). */
export async function shot(page, name) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${EV}${name}.png` })
  writeFileSync(`${EV}${name}.txt`, await page.locator('body').innerText())
}

export async function signIn(page, username, role) {
  await page.goto(`${APP}/sign-in`)
  await page.waitForLoadState('networkidle')
  const welcome = page.getByText('Sign in', { exact: true })
  if ((await page.locator('input[type=password]').count()) === 0 && (await welcome.count()) > 0) {
    await welcome.first().click()
  }
  await page.locator('input[type=password]').waitFor()
  await page.locator('input[type=text]').first().fill(username)
  await page.locator('input[type=password]').fill('Dos@1234')
  await page.locator('input[type=password]').press('Enter')
  const chooser = page.getByText('Continue as', { exact: true })
  try {
    await chooser.waitFor({ timeout: 6000 })
    await page.getByText(role, { exact: true }).first().click()
    await page.getByText('Continue', { exact: true }).click()
  } catch {
    /* a one-role person goes straight in */
  }
  await page.waitForTimeout(1500)
}

export function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks held`)
  if (failed.length > 0) {
    for (const f of failed) console.log(`FAILED: ${f.name} — ${f.detail}`)
    process.exit(1)
  }
}
