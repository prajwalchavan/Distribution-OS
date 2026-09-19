#!/bin/zsh
# Pull one person's sales store off the phone, WAL included, and dump the outbox.
# usage: sa-pull.sh <storeName> <tag>
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$PATH"
EV="/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/amendments"
DB=$1; TAG=$2
for suf in "" "-wal" "-shm"; do
  adb shell "run-as in.distributionos.sales cat files/SQLite/${DB}${suf} > /data/local/tmp/${TAG}.db${suf}" 2>/dev/null
  adb pull /data/local/tmp/${TAG}.db${suf} "$EV/${TAG}.db${suf}" >/dev/null 2>&1
  adb shell rm -f /data/local/tmp/${TAG}.db${suf}
done
echo "== $TAG : _outbox =="
sqlite3 "$EV/${TAG}.db" "select seq,op_id,tbl,row_id,op,status,attempts,created_at,coalesce(sent_at,''),coalesce(acked_at,'') from _outbox order by seq;" 2>&1
echo "-- whose store:"
sqlite3 "$EV/${TAG}.db" "select key||'='||value from _sync_state where key in ('userId','tenantId','role','deviceId','lastPulledAt','lastUploadAt');" 2>&1
echo "-- _sync_errors: $(sqlite3 "$EV/${TAG}.db" 'select count(*) from _sync_errors;' 2>&1)"
