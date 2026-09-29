import { assertIsoDate, todayIst } from './ids.js'

/**
 * The arguments the tool and the coverage check share: which API, which distributor, who signs in, and the
 * business date. Checked the same way in both so a typo stops both before the first request.
 */
export interface CommonArgs {
  api: string
  tenant: string
  ownerUsername: string
  passwordFile: string
  loginsFile: string
  date: string
}

export interface RawCommonArgs {
  api?: string | undefined
  tenant?: string | undefined
  'owner-username'?: string | undefined
  'owner-password-file'?: string | undefined
  'logins-file'?: string | undefined
  date?: string | undefined
  'allow-remote'?: boolean | undefined
}

export const COMMON_OPTIONS = {
  api: { type: 'string' },
  tenant: { type: 'string' },
  'owner-username': { type: 'string' },
  'owner-password-file': { type: 'string' },
  'logins-file': { type: 'string' },
  date: { type: 'string' },
  'allow-remote': { type: 'boolean', default: false },
} as const

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** The checked arguments, or the reason they are refused (the caller prints it and exits 2). */
export function checkCommonArgs(
  raw: RawCommonArgs,
  now: number = Date.now(),
): CommonArgs | { refused: string } {
  const api = (raw.api ?? '').replace(/\/+$/, '')
  const tenant = raw.tenant ?? ''
  const passwordFile = raw['owner-password-file'] ?? ''
  const loginsFile = raw['logins-file'] ?? ''
  if (!api || !tenant || !passwordFile || !loginsFile)
    return { refused: '--api, --tenant, --owner-password-file and --logins-file are required' }
  let host: string
  try {
    host = new URL(api).hostname
  } catch {
    return { refused: '--api is not a URL' }
  }
  // The tool talks to an API on the same machine: the server runs it against 127.0.0.1:3100.
  if (!LOCAL_HOSTS.has(host) && raw['allow-remote'] !== true)
    return { refused: '--api must be on this machine (127.0.0.1); --allow-remote overrides' }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenant))
    return { refused: '--tenant must be a distributor slug' }
  const today = todayIst(now)
  const date = raw.date ?? today
  try {
    assertIsoDate(date)
  } catch {
    return { refused: '--date must be YYYY-MM-DD' }
  }
  if (date > today) return { refused: `--date ${date} has not come yet (today is ${today} IST)` }
  return {
    api,
    tenant,
    ownerUsername: raw['owner-username'] ?? `owner.${tenant}`,
    passwordFile,
    loginsFile,
    date,
  }
}
