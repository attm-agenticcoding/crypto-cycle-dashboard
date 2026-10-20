"""Offline research only. No production writes or network access."""
import csv, hashlib, json, math, random, statistics, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parents[1]/'scripts'))
import update_execution_params as legacy
import update_execution_params_live as live
START=date(2025,10,20); END=date(2026,10,19)
ANCHORS={'07:00':420,'08:00':480,'09:35':575}

def write_csv(name,rows):
    with (ROOT/name).open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)

def session_excursions(minute_map, anchor, end):
    """Anchor close is known only after that minute; never fill in anchor bar."""
    ref=minute_map[anchor].close
    eligible=[minute_map[x] for x in range(anchor+1,end)]
    down=max(0,1-min(b.low for b in eligible)/ref)
    up=max(0,max(b.high for b in eligible)/ref-1)
    return ref,down,up

def select_training_window(costs, fold, prior):
    """Use only the 26 completed weeks before fold, including for paired SE."""
    candidates=[legacy.CandidateResult(p[0],p[1],p[2],values[fold-26:fold],[],0)
                for p,values in costs.items()]
    return live.select_scored(candidates,prior)

def load():
    byday=defaultdict(dict); total=0
    for item in json.loads((ROOT/'input_manifest.json').read_text()):
        p=ROOT/'cache'/item['file']; raw=p.read_bytes()
        assert hashlib.sha256(raw).hexdigest()==item['sha256']
        for b in legacy.parse_zip(raw):
            t=b.opened_at.astimezone(legacy.ET); d=t.date(); m=t.hour*60+t.minute
            if START<=d<=END and live.session_day(d,'XNYS') and 420<=m<960:
                assert m not in byday[d],f'duplicate {d} {m}'
                assert all(math.isfinite(v) for v in (b.low,b.close,b.high)) and 0<b.low<=b.close<=b.high
                byday[d][m]=b; total+=1
    rows=[]; sessions={a:[] for a in ANCHORS}; bars=[]
    d=START
    while d<=END:
        if live.session_day(d,'XNYS'):
            c=legacy.sell_session_end(d); end=c.hour*60+c.minute
            mp=byday[d]
            assert set(range(420,end))<=mp.keys(),f'missing minute {d}'
            terminal=mp[end-1].close
            for a,m in ANCHORS.items():
                ref,down,up=session_excursions(mp,m,end)
                sessions[a].append(legacy.Session(d,ref,down,None,up,'XNYS'))
                rows.append(dict(date=str(d),anchor=a,reference=ref,drawdown=down,runup=up,common_reference=mp[420].close,terminal=terminal,close_minute=end,eligible_minutes=end-m-1,anchor_utc=mp[m].opened_at.isoformat()))
            bars.extend(mp[x] for x in range(575,end))
        d+=timedelta(days=1)
    write_csv('sessions.csv',rows)
    common={r['date']:r['common_reference'] for r in rows}; terminal={r['date']:r['terminal'] for r in rows}
    return sessions,common,terminal,bars,total

def count(exc,first,spacing,side,penetration):
    # Buy low <= limit*(1-p); sell high >= limit*(1+p).
    hits=0
    for k in range(legacy.MAX_RUNGS):
        dist=first+k*spacing
        threshold=dist+penetration*(1-dist if side=='buy' else 1+dist)
        hits+=exc+1e-12>=threshold
    return hits

def evaluate(sessions,indices,p,side,pen,common,terminal,trace=None):
    lookback,first,spacing=p; start=indices[0]
    # Match production calibration: estimate before the week, then hold fixed.
    # Only remaining quantity/days and each day reference change within the week.
    expected=statistics.fmean(count(legacy.excursion(s,side),first,spacing,side,pen) for s in sessions[start-lookback:start])
    initial=common[str(sessions[start].session_date)]; end=terminal[str(sessions[indices[-1]].session_date)]
    rem=1.; value=0.; cash=1.2*initial; budget_bound=False; zero=0
    for pos,index in enumerate(indices):
        row=sessions[index]; hits=count(legacy.excursion(row,side),first,spacing,side,pen); zero+=hits==0
        per=rem/((len(indices)-pos)*expected) if expected>0 else 0.
        if trace is not None:
            trace.append(dict(date=str(row.session_date),expected=expected,per_rung=per,fills=[]))
        for rung in range(hits):
            limit=row.reference*(1+(first+rung*spacing)*(1 if side=='sell' else -1))
            qty=min(per,rem)
            if side=='buy':
                allowed=cash/limit
                if qty>allowed+1e-12: budget_bound=True
                qty=min(qty,allowed); cash-=qty*limit
            if trace is not None: trace[-1]['fills'].append((limit,qty))
            value+=qty*limit; rem-=qty
            if rem<=1e-12: rem=0.; break
    sign=1 if side=='buy' else -1
    executed=1-rem
    return dict(cost_bps=sign*((value+rem*end)/initial-1)*10000,completion=executed,uncompleted=rem,
                passive_price_bps=(value/executed/initial-1)*10000 if executed>0 else None,
                opportunity_bps=sign*rem*(end/initial-1)*10000,
                passive_contribution_bps=sign*(value-executed*initial)/initial*10000,
                terminal_return_bps=(end/initial-1)*10000,zero_day_fraction=zero/len(indices),budget_bound=budget_bound)

def fit_on(sessions,weeks,side,pen,common,terminal):
    scored=[]
    for lb in legacy.LOOKBACKS:
        for f in legacy.FIRST_OFFSETS:
            for sp in legacy.SPACINGS:
                p=(lb,f,sp)
                score=statistics.fmean(evaluate(sessions,w,p,side,pen,common,terminal)['cost_bps'] for w in weeks)
                scored.append((score,p))
    return min(scored)

def bootstrap(vals):
    rng=random.Random(20261020); n=len(vals)
    samples=sorted(statistics.fmean(rng.choices(vals,k=n)) for _ in range(5000))
    return samples[125],samples[4874]

def main():
    sessions,common,terminal,bars,total=load()
    base=live.build_complete_sessions(bars,'XNYS',START,END)
    bundle=json.loads((ROOT.parents[1]/'data/execution_params.json').read_text())['instruments']['ARCX:BTC']
    baseline={}
    for side in legacy.SIDES:
        published=bundle['sides'][side]
        prior=(published['lookback_sessions'],published['first_offset_pct']/100,published['spacing_pct']/100)
        selected,diag=live.fit(base,prior,side)
        baseline[side]=dict(reproduced=live.parameters(selected),published={k:published[k] for k in live.parameters(selected)},diagnostics=diag)
        baseline[side]['matches']=baseline[side]['reproduced']==baseline[side]['published']
    (ROOT/'baseline.json').write_text(json.dumps(baseline,indent=2)+'\n')
    weeks=live.common_weeks(base) # production returns last26; research needs all completed weeks after warmup
    grouped=defaultdict(list)
    for i,s in enumerate(base): grouped[s.session_date-timedelta(days=s.session_date.weekday())].append(i)
    weeks=[]
    for monday,ix in grouped.items():
        expected=[monday+timedelta(days=i) for i in range(5) if live.session_day(monday+timedelta(days=i),'XNYS')]
        if ix[0]>=60 and [base[i].session_date for i in ix]==expected: weeks.append(ix)
    assert len(weeks)>26
    results=[]; trainings=[]; frozen=[]
    for side in legacy.SIDES:
        for pen in (0,.0005,.001):
            for anchor,ss in sessions.items():
                grid=[(lb,f,sp) for lb in legacy.LOOKBACKS for f in legacy.FIRST_OFFSETS for sp in legacy.SPACINGS]
                costs={p:[evaluate(ss,w,p,side,pen,common,terminal)['cost_bps'] for w in weeks] for p in grid}
                frozen_p=None
                prior=None
                for fold in range(26,len(weeks)):
                    train=weeks[fold-26:fold]; test=weeks[fold]
                    assert train[-1][-1]<test[0]
                    selected,best,plateau,old=select_training_window(costs,fold,prior)
                    p=(selected.lookback,selected.first_offset,selected.spacing); prior=p
                    score=selected.mean_cost_bps
                    if frozen_p is None: frozen_p=p
                    frozen.append(dict(side=side,penetration_bps=pen*10000,anchor=anchor,week=str(ss[test[0]].session_date),lookback=frozen_p[0],first_pct=frozen_p[1]*100,spacing_pct=frozen_p[2]*100,**evaluate(ss,test,frozen_p,side,pen,common,terminal)))
                    common_fields=dict(side=side,penetration_bps=pen*10000,anchor=anchor,week=str(ss[test[0]].session_date),lookback=p[0],first_pct=p[1]*100,spacing_pct=p[2]*100,train_first=str(ss[train[0][0]].session_date),train_last=str(ss[train[-1][-1]].session_date))
                    trainings.append(dict(**common_fields,in_sample_cost_bps=score))
                    results.append(dict(**common_fields,**evaluate(ss,test,p,side,pen,common,terminal)))
                print(side,pen,anchor,'done',flush=True)
    write_csv('frozen_oos_weekly.csv',frozen)
    write_csv('oos_weekly.csv',results); write_csv('training.csv',trainings)
    summary=[]; paired=[]
    for side in legacy.SIDES:
        for pen in (0,5,10):
            for a in ANCHORS:
                group=[r for r in results if r['side']==side and r['penetration_bps']==pen and r['anchor']==a]
                summary.append(dict(side=side,penetration_bps=pen,anchor=a,weeks=len(group),**{k:statistics.fmean(r[k] for r in group) for k in ('cost_bps','completion','uncompleted','opportunity_bps','passive_contribution_bps','zero_day_fraction')},passive_price_bps=statistics.fmean(r['passive_price_bps'] for r in group if r['passive_price_bps'] is not None),budget_bound_weeks=sum(r['budget_bound'] for r in group)))
                if a!='09:35':
                    baseline_group=[r for r in results if r['side']==side and r['penetration_bps']==pen and r['anchor']=='09:35']
                    assert [r['week'] for r in group]==[r['week'] for r in baseline_group]
                    diff=[r['cost_bps']-b['cost_bps'] for r,b in zip(group,baseline_group)]; lo,hi=bootstrap(diff)
                    paired.append(dict(side=side,penetration_bps=pen,anchor=a,delta_cost_bps=statistics.fmean(diff),bootstrap_low=lo,bootstrap_high=hi,win_weeks=sum(v<0 for v in diff),weeks=len(diff)))
    write_csv('summary.csv',summary); write_csv('paired.csv',paired)
    meta=dict(start=str(START),end=str(END),sessions=len(base),filtered_minutes=total,complete_weeks_after_warmup=len(weeks),oos_weeks=len(weeks)-26,oos_first=str(base[weeks[26][0]].session_date),oos_last=str(base[weeks[-1][-1]].session_date),half_days=[str(s.session_date) for s in base if legacy.sell_session_end(s.session_date).hour==13],base_commit='51042f7',candidates=720)
    (ROOT/'run_metadata.json').write_text(json.dumps(meta,indent=2)+'\n'); print(json.dumps(meta)); print(summary)
if __name__=='__main__': main()
