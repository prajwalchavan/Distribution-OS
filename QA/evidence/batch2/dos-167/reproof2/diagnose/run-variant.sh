#!/bin/bash
# usage: run-variant.sh <variant> <delay> [runs]
set -e
D="/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/reproof2/diagnose"
V=$1; DELAY=$2; N=${3:-3}
node "$D/variant.mjs" "$V"
bash "$D/restart-metro.sh" >/dev/null 2>&1
sleep 3
cd "$D"
for i in $(seq 1 $N); do
  PW_PORT=9341 node diag.mjs --label "v$V-d$DELAY-$i" --delay "$DELAY" --watch 15000 2>&1 | head -1
done
python3 - "$V" "$DELAY" "$N" <<'PY'
import json,sys,os
V,DELAY,N=sys.argv[1],sys.argv[2],int(sys.argv[3])
D="/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/reproof2/diagnose/runs"
p=0
for i in range(1,N+1):
    d=json.load(open(os.path.join(D,"v%s-d%s-%d.json"%(V,DELAY,i))))
    cre=len([e for e in d['events'] if e['kind']=='console' and e.get('source')=='worker' and 'init-CREATES' in e.get('text','')])
    vfs=len([e for e in d['events'] if e['kind']=='console' and e.get('source')=='worker' and 'vfs-construct' in e.get('text','')])
    mo=[e['text'].split('path=')[1][:60] for e in d['events'] if e['kind']=='console' and e.get('source')=='page' and 'main-open' in e.get('text','')]
    print("  run%d pass=%s initCREATES=%d vfs=%d pool=%d manifest=%d pull=%d notADb=%d cantCreate=%d opens=%d"%(i,d['pass'],cre,vfs,d['poolFiles'],d['manifestCalls'],d['pullCalls'],d['notADatabase'],d['cannotCreate'],len(mo)))
    p+=1 if d['pass'] else 0
print("VARIANT %s delay=%s : %d/%d pass"%(V,DELAY,p,N))
PY
