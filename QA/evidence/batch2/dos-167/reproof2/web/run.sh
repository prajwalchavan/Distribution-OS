#!/bin/bash
# How every script in this folder was run (DOS-167 ruling-3 re-proof, web, 2026-09-19, main ce3dc8c).
# Playwright lives in QA/tools/node_modules; ESM resolves from the script's own folder, so link it once:
D="/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/reproof2/web"
ln -sfn "/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/node_modules" "$D/node_modules"
export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
# the QA Chromium with a CDP port, and the sales Metro on :5175 from the MAIN checkout
# (cd QA/tools && PW_PORT=9341 node pw-server.mjs &) ; bash "$D/restart-metro.sh" cold1
#
# (1) three cold first loads, Metro restarted with --clear between them
#   bash "$D/restart-metro.sh" coldN && (cd "$D" && PW_PORT=9341 node diag.mjs --label cold-0N --delay 0 --watch 25000)
# (2) warm Metro, the expo-sqlite chunk and its worker held back
#   (cd "$D" && PW_PORT=9341 node diag.mjs --label d600-0N   --delay 600  --watch 25000)
#   (cd "$D" && PW_PORT=9341 node diag.mjs --label d1500-0N  --delay 1500 --watch 25000)
# (3) the production export, served with COOP/COEP
#   (cd frontend && pnpm --filter @dos/sales-app exec expo export --platform web --output-dir "$D/web-export")
#   node "$D/../diagnose/serve-export.mjs" "$D/web-export" 5199 &
#   (cd "$D" && PW_PORT=9341 node diag.mjs --label prod-d600-0N --delay 600 --app http://localhost:5199 \
#       --slow '/(index|worker)-[0-9a-f]{32}\.js$')
# (4) the next person on the same profile after a slow load
#   (cd "$D" && PW_PORT=9341 node diag.mjs --label d600-next-0N --delay 600 --watch 20000 --second amit)
# (5)(6)(7)(8)(9)(10) the s-098 variants (the 20 ms S-140 flash watch is inside them)
#   S098_OUT=QA/evidence/batch2/dos-167/reproof2/web/ PW_PORT=9341 node QA/tools/e2e/s-098-shared-device.mjs v5a
#   ... v5b, v5c, v5d, vmem, vkill, vkillr, vswitch  (one invocation each keeps the results apart)
# (cc) the induced 15 s deadline fallback, and the merge review's owed screen walk
#   (cd "$D" && PW_PORT=9341 node deadline.mjs --label dl-0N --delay 20000)
# A4 a second tab of the same person
#   (cd "$D" && PW_PORT=9341 node twotabs.mjs --label tt-0N)
