#!/usr/bin/env bash
# Writes a real `.env.prod` from `.env.prod.example`, with fresh secrets. Run ONCE per box:
#
#   cd /opt/dos/backend/infra && ./gen-secrets.sh
#
# It refuses to touch an existing .env.prod. Re-running it on a live box would replace the EdDSA
# signing key, and every access and refresh token on every phone in the distributorship is signed
# with that key: the whole staff would be signed out and the `auth_sessions` rows would no longer
# match. If a key really must be rotated, that is a deliberate act with its own runbook step.
#
# What it fills in: the EdDSA key pair, the Postgres password (in two places, which must agree), the
# object-storage signing secret and the first owner's password. What it CANNOT know, and prints as a
# checklist at the end: the domain, the ACME address, the image tag, the distributor's legal details
# and the R2 bucket and token.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE="${ENV_EXAMPLE:-$HERE/.env.prod.example}"
OUT="${ENV_OUT:-$HERE/.env.prod}"

[ -f "$EXAMPLE" ] || {
  echo "no $EXAMPLE to start from" >&2
  exit 1
}
if [ -e "$OUT" ]; then
  echo "$OUT already exists — refusing to overwrite it." >&2
  echo "Rotating the signing key signs every device out; do it deliberately, not by re-running this." >&2
  exit 1
fi

# Alphanumeric on purpose: these values go into a connection URL and a YAML file, and a random '@',
# '/' or '#' in a password is a support call at the worst possible moment.
# NOT `tr -dc ... </dev/urandom | head -c N`: head closes the pipe as soon as it has its N bytes,
# tr dies of SIGPIPE, and with `pipefail` the whole script exits 141 without printing a thing. Read a
# fixed block instead and let every stage consume all of its input.
random() {
  local n="${1:-32}" out=''
  while [ "${#out}" -lt "$n" ]; do
    out="$out$(head -c 192 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "${out:0:$n}"
}

# The EdDSA pair, in the base64url(JSON JWK) form every service decodes (libs/core auth-keys.ts).
# `pnpm auth:keygen` when the repo is on the box (it is: the runbook clones it for compose and these
# scripts); otherwise the same generator out of the image, which carries @dos/core already.
keygen() {
  if command -v pnpm >/dev/null 2>&1 && [ -f "$HERE/../package.json" ]; then
    (cd "$HERE/.." && pnpm --silent auth:keygen)
  elif command -v docker >/dev/null 2>&1 && [ -n "${DOS_IMAGE:-}" ]; then
    docker run --rm --entrypoint node "$DOS_IMAGE" -e '
      const { generateAuthKeys, encodeJwk } = await import("@dos/core");
      const k = await generateAuthKeys();
      console.log("AUTH_JWT_PRIVATE_KEY=" + encodeJwk(k.privateJwk));
      console.log("AUTH_JWT_PUBLIC_KEY=" + encodeJwk(k.publicJwk));
    '
  else
    echo "cannot generate auth keys: need either pnpm and the repo, or docker and DOS_IMAGE" >&2
    exit 1
  fi
}

KEYS="$(keygen)"
PRIVATE_KEY="$(printf '%s\n' "$KEYS" | sed -n 's/^AUTH_JWT_PRIVATE_KEY=//p')"
PUBLIC_KEY="$(printf '%s\n' "$KEYS" | sed -n 's/^AUTH_JWT_PUBLIC_KEY=//p')"
[ -n "$PRIVATE_KEY" ] && [ -n "$PUBLIC_KEY" ] || {
  echo "the key generator printed no key pair:" >&2
  printf '%s\n' "$KEYS" >&2
  exit 1
}

DB_PASSWORD="$(random 40)"
SIGNING_SECRET="$(random 48)"
OWNER_PASSWORD="$(random 20)"

# Written with a leading umask so the file is never briefly world-readable between create and chmod.
(
  umask 077
  : >"$OUT"
)

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    AUTH_JWT_PRIVATE_KEY=*) printf 'AUTH_JWT_PRIVATE_KEY=%s\n' "$PRIVATE_KEY" ;;
    AUTH_JWT_PUBLIC_KEY=*) printf 'AUTH_JWT_PUBLIC_KEY=%s\n' "$PUBLIC_KEY" ;;
    OBJECT_STORAGE_SIGNING_SECRET=*) printf 'OBJECT_STORAGE_SIGNING_SECRET=%s\n' "$SIGNING_SECRET" ;;
    POSTGRES_PASSWORD=*) printf 'POSTGRES_PASSWORD=%s\n' "$DB_PASSWORD" ;;
    OWNER_PASSWORD=*) printf 'OWNER_PASSWORD=%s\n' "$OWNER_PASSWORD" ;;
    # The same password, in the URL the app connects with. These two MUST agree.
    DATABASE_URL=*) printf 'DATABASE_URL=postgres://dos:%s@db:5432/dos\n' "$DB_PASSWORD" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <"$EXAMPLE" >>"$OUT"

chmod 600 "$OUT"

echo "wrote $OUT (mode 600) with a fresh EdDSA key pair, database password, storage secret and owner password."
echo
echo "STILL TO FILL IN BY HAND — this script cannot know them:"
echo "  DOS_IMAGE            the tag .github/workflows/image.yml pushed (never :latest)"
echo "  DOMAIN, ACME_EMAIL   the domain and a real mailbox for Let's Encrypt"
echo "  CORS_ORIGINS         the Pages hostname(s) the apps are served from"
echo "  OBJECT_STORAGE_PUBLIC_URL   https://api.<domain>"
echo "  TENANT_* and OWNER_NAME / OWNER_PHONE   the distributor and the person who signs in first"
echo "  BACKUP_S3_*          the R2 bucket and its API token (backup.sh refuses to run without them)"
echo
echo "The owner's first password is in $OUT as OWNER_PASSWORD. Read it once, hand it over out of"
echo "band, and have them change it at first sign-in. It is not printed here on purpose."
