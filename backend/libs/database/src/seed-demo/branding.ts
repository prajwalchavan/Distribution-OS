/**
 * White-label branding for the pilot distributor, from the founder's own letterhead (2026-09-06).
 *
 * Every document a shop sees carries the DISTRIBUTOR's identity, never ours (docs/22 §9 rule 10):
 * `branding.display_name` heads the invoice, `branding.address` is the seller block printed under it,
 * `branding.logo_object_key` is the mark the PDF renderer draws top-left, and `branding.invoice_footer`
 * is the line under the totals. The other two distributors get their own values from
 * `seed-demo/tenants.ts`; this file is the pilot's, and it is the only place in the seed that carries
 * real-world data rather than invented data.
 *
 * The logo is written straight into the local object store (`backend/.storage`, the `local` driver's
 * root, which maps an object key to a path one-for-one) because there is no upload endpoint at seed
 * time. On S3 the owner uploads it from the settings screen and this step is skipped: a missing file
 * is not an error, it just leaves `logo_object_key` unset and the renderer prints no logo.
 */
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'

import type { Db } from '../client.js'
import { tenantSettings } from '../schema/index.js'
import { TENANT_SETTING_KEYS } from '../tenant-bootstrap.js'

/** M/s. Tarsun Enterprise, Kalyan (W) — the pilot customer, from its letterhead. */
export const PILOT_BRANDING = {
  legalName: 'M/s. Tarsun Enterprise',
  displayName: 'Tarsun Enterprise',
  gstin: '27CNGPP9039R1ZX',
  stateCode: '27',
  proprietor: 'Sagar Vinod Patil',
  phone: '+919820813844',
  email: 'trasun0711@gmail.com',
  addressLines: [
    'Shop No. 4, Mangeshi Elite Phase - 2',
    'Rambaug Lane No. 4, Kalyan (W)',
    'Thane, Maharashtra - 421 301',
  ],
} as const

/** The seller block as the invoice, credit note, challan and receipt print it. */
export const PILOT_ADDRESS_BLOCK = [
  ...PILOT_BRANDING.addressLines,
  `Phone ${PILOT_BRANDING.phone}`,
  PILOT_BRANDING.email,
].join('\n')

const LOGO_KEY_FOR = (tenantId: string): string => `tenant/${tenantId}/branding/logo.jpg`

function storageRoot(): string {
  const configured = process.env.OBJECT_STORAGE_DIR?.trim()
  if (configured) return resolve(configured)
  // `backend/.storage`: this file is libs/database/src/seed-demo/branding.ts, so four levels up.
  return resolve(fileURLToPath(new URL('../../../../.storage', import.meta.url)))
}

function logoSource(): string {
  return fileURLToPath(new URL('./assets/tarsun-logo.jpg', import.meta.url))
}

/**
 * Copies the logo into the object store and answers its key, or null when either the asset or the
 * store is unavailable (an S3 deployment, a read-only checkout): the caller then leaves the setting
 * alone rather than pointing it at a file that does not exist.
 */
async function placeLogo(tenantId: string): Promise<string | null> {
  const key = LOGO_KEY_FOR(tenantId)
  const target = join(storageRoot(), key)
  try {
    const bytes = await readFile(logoSource())
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    return key
  } catch {
    return null
  }
}

/**
 * Idempotent: the settings are upserted and the logo file is rewritten byte-for-byte, so two seeds in
 * a row leave the same rows and the same file (the seed-idempotency spec counts on it).
 */
export async function seedPilotBranding(db: Db, tenantId: string): Promise<void> {
  const logoKey = await placeLogo(tenantId)
  const rows = [
    { key: TENANT_SETTING_KEYS.brandingDisplayName, value: PILOT_BRANDING.displayName },
    { key: TENANT_SETTING_KEYS.brandingAddress, value: PILOT_ADDRESS_BLOCK },
    {
      key: TENANT_SETTING_KEYS.brandingInvoiceFooter,
      value: `${PILOT_BRANDING.displayName} — Wholesale & Distribution · GSTIN ${PILOT_BRANDING.gstin}`,
    },
    ...(logoKey ? [{ key: TENANT_SETTING_KEYS.brandingLogoObjectKey, value: logoKey }] : []),
  ]
  await db
    .insert(tenantSettings)
    .values(rows.map((r) => ({ tenantId, key: r.key, value: r.value })))
    .onConflictDoUpdate({
      target: [tenantSettings.tenantId, tenantSettings.key],
      set: { value: sql`excluded.value` },
    })
}

/** Kept so a future caller can stream the asset without reading it all into memory. */
export const openLogoStream = (): ReturnType<typeof createReadStream> =>
  createReadStream(logoSource())
