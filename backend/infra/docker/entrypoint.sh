#!/bin/sh
# One image, four verbs (docs/30). Anything not listed is exec'd as given, so `docker run ... sh`
# and `docker run ... node -e ...` still work for a human looking at a running box.
set -eu

case "${1:-serve}" in
  serve)
    exec node /app/dist/main.js
    ;;
  migrate)
    # @dos/db ships its migrations beside its dist/ (its package.json `files`), and migrate.js
    # resolves `../migrations` from its own location — so this reads /app/node_modules/@dos/db/migrations
    # inside the image, with no copy step and no path to keep in sync.
    exec node /app/node_modules/@dos/db/dist/migrate.js
    ;;
  bootstrap)
    shift
    exec node /app/bootstrap.mjs "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
