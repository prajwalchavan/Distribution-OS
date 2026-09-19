import json,sys,os,glob
D="/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/reproof2/web/runs"
rows=[]
for lab in sys.argv[1:]:
    p=os.path.join(D,lab+".json")
    if not os.path.exists(p):
        print("MISSING",lab); continue
    d=json.load(open(p))
    hdrs=d["headers"]
    empties=d["poolFiles"]-len(hdrs)
    junk=[h for h in hdrs if not h.startswith("/s") or len(h)!=52]
    off=[l["text"][:110] for l in d.get("offlineLines",[])]
    rows.append(dict(label=d["label"],delay=d["delayMs"],**{
      "pass":d["pass"],"hdrOk":d["wantedHeader"] in hdrs,"poolFiles":d["poolFiles"],"emptySlots":empties,
      "junkHeaders":junk,"manifest":d["manifestCalls"],"pull":d["pullCalls"],
      "notADatabase":d["notADatabase"],"cannotCreate":d["cannotCreate"],
      "notPersisted":d["beatFinal"]["notPersisted"],"stillLoading":d["beatFinal"]["stillLoading"],
      "coi":d["crossOriginIsolated"],"heldChunks":[x["url"].split("/")[-1][:48] for x in d["delayed"]],
      "offlineLines":off,
      "second":(None if d.get("second") is None else {"who":d["second"]["who"],"headers":d["second"]["headers"],"notPersisted":d["second"]["notPersisted"],"stillLoading":d["second"]["stillLoading"]}),
      "afterReload":(None if d.get("afterReload") is None else {"healed":d["afterReload"]["healed"],"headers":d["afterReload"]["headers"],"notPersisted":d["afterReload"]["notPersisted"]}),
    }))
print(json.dumps(rows,indent=1))
p=sum(1 for r in rows if r["pass"])
print("PASS %d/%d"%(p,len(rows)))
