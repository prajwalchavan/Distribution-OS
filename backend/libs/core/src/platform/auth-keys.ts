import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, type JWK } from 'jose'

/** Access tokens are EdDSA (Ed25519) JWTs: tiny, fast to verify, no shared secret leaves auth-service. */
export const AUTH_ALG = 'EdDSA'
export const AUTH_ISSUER = 'dos-auth'
export const AUTH_AUDIENCE = 'dos'

export interface AuthKeys {
  kid: string
  /** Only auth-service holds the private key (AUTH_JWT_PRIVATE_KEY). Null everywhere else. */
  privateKey: CryptoKey | null
  publicKey: CryptoKey
  /** Public JWK with kid/alg/use, as served at /.well-known/jwks.json. */
  publicJwk: JWK
}

/** Keys travel through env as base64url(JSON JWK) so a key fits on one .env line. */
export function encodeJwk(jwk: JWK): string {
  return Buffer.from(JSON.stringify(jwk), 'utf8').toString('base64url')
}

export function decodeJwk(value: string): JWK {
  try {
    return JSON.parse(Buffer.from(value.trim(), 'base64url').toString('utf8')) as JWK
  } catch {
    throw new Error('AUTH_JWT_*_KEY is not base64url(JSON JWK); run `pnpm auth:keygen`')
  }
}

export async function generateAuthKeys(): Promise<{
  privateJwk: JWK
  publicJwk: JWK
  kid: string
}> {
  const pair = await generateKeyPair(AUTH_ALG, { extractable: true })
  const privateJwk = await exportJWK(pair.privateKey)
  const publicJwk = await exportJWK(pair.publicKey)
  const kid = await calculateJwkThumbprint(publicJwk)
  return {
    privateJwk: { ...privateJwk, kid, alg: AUTH_ALG, use: 'sig' },
    publicJwk: { ...publicJwk, kid, alg: AUTH_ALG, use: 'sig' },
    kid,
  }
}

async function fromJwks(privateJwk: JWK | null, publicJwk: JWK): Promise<AuthKeys> {
  const kid = publicJwk.kid ?? (await calculateJwkThumbprint(publicJwk))
  const publicKey = (await importJWK({ ...publicJwk, kid }, AUTH_ALG)) as CryptoKey
  const privateKey = privateJwk ? ((await importJWK(privateJwk, AUTH_ALG)) as CryptoKey) : null
  return { kid, privateKey, publicKey, publicJwk: { ...publicJwk, kid, alg: AUTH_ALG, use: 'sig' } }
}

let cached: Promise<AuthKeys> | null = null

/**
 * Loads the signing/verifying keys once per process.
 *  - AUTH_JWT_PUBLIC_KEY set → verify-only (every service). AUTH_JWT_PRIVATE_KEY set too → can sign (auth-service).
 *  - Neither set: under NODE_ENV=test (vitest) an ephemeral pair is generated so specs are self-contained;
 *    in development/production it is an error — run `pnpm auth:keygen` and put both lines in backend/.env.
 */
export function loadAuthKeys(env: NodeJS.ProcessEnv = process.env): Promise<AuthKeys> {
  cached ??= (async () => {
    const priv = env.AUTH_JWT_PRIVATE_KEY?.trim()
    const pub = env.AUTH_JWT_PUBLIC_KEY?.trim()
    if (pub || priv) {
      const privateJwk = priv ? decodeJwk(priv) : null
      const publicJwk = pub ? decodeJwk(pub) : publicFromPrivate(privateJwk as JWK)
      return fromJwks(privateJwk, publicJwk)
    }
    if (env.NODE_ENV === 'test' || env.AUTH_EPHEMERAL_KEYS === 'true') {
      const generated = await generateAuthKeys()
      return fromJwks(generated.privateJwk, generated.publicJwk)
    }
    throw new Error(
      'AUTH_JWT_PUBLIC_KEY (and AUTH_JWT_PRIVATE_KEY for auth-service) missing: run `pnpm auth:keygen` and add the lines to backend/.env',
    )
  })()
  return cached
}

function publicFromPrivate(jwk: JWK): JWK {
  // Ed25519 JWK: dropping `d` leaves the public half.
  const { d: _d, ...pub } = jwk
  return pub
}

/** Specs that need a fresh key pair (or different env) call this before booting an app. */
export function resetAuthKeysForTests(): void {
  cached = null
}
