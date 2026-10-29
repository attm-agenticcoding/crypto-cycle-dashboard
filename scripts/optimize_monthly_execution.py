#!/usr/bin/env python3
"""Causal monthly single-order BUY research. Never places orders or promotes fits."""
from __future__ import annotations
import argparse
import calendar
import hashlib
import json
import math
import random
import statistics as stats
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import prepare_execution_v2 as source

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'monthly-single-order-v1'


def quantile(values, p):
    v = sorted(values)
    n = (len(v)-1)*p
    lo = int(n)
    return v[lo] + (v[min(lo+1,len(v)-1)]-v[lo])*(n-lo)


def down(value, step):
    return math.floor(value/step+1e-9)*step


def candidates(protocol):
    return ([dict(id=f'fixed-{b}',kind='fixed',offset_bps=b) for b in protocol['fixed_offsets_bps']]
        + [dict(id=f'q-{n}-{q}',kind='quantile',lookback=n,quantile=q)
           for n in protocol['lookbacks'] for q in protocol['drawdown_quantiles']])


def offset(rows, index, candidate, protocol):
    if candidate['kind']=='fixed': return candidate['offset_bps']/10000
    n = candidate['lookback']
    if index<n: raise ValueError('Insufficient strictly prior history')
    raw=quantile([x['drawdown_pct']/100 for x in rows[index-n:index]],candidate['quantile'])
    lo,hi=protocol['offset_bounds_bps']
    return max(lo/10000,min(hi/10000,raw))


def month_after(key):
    y,m=map(int,key.split('-'))
    return f'{y+int(m==12):04d}-{m%12+1:02d}'


def complete_months(rows, market, warmup):
    grouped=defaultdict(list)
    for i,r in enumerate(rows):
        grouped[r['review_month']].append(i)
    valid={}
    for month,indices in sorted(grouped.items()):
        y,m=map(int,month.split('-'))
        expected=[date(y,m,d).isoformat() for d in range(1,calendar.monthrange(y,m)[1]+1)
                  if source.session_day(date(y,m,d),market)]
        actual=[rows[i]['review_date_ny'] for i in indices]
        if actual!=expected or indices[0]<warmup: continue
        # A missing earlier session must not silently shorten any lookback.
        history=rows[indices[0]-warmup:indices[-1]+1]
        if any(source.next_session(date.fromisoformat(a['date']),market).isoformat()!=b['date']
               for a,b in zip(history,history[1:])): continue
        valid[month]=indices
    return valid


def episode(rows, indices, instrument, cap, distances, flow, scenario, notional, immediate=False):
    if not isinstance(cap,int) or cap<0: raise ValueError('Monthly cap must be a nonnegative integer')
    if flow not in ('month_start','five_installments'): raise ValueError('Unknown capital arrival scenario')
    requests={0:notional} if flow=='month_start' else {math.floor(j*(len(indices)-1)/4):notional/5 for j in range(5)}
    if len(requests)!=(1 if flow=='month_start' else 5): raise ValueError('Too few sessions for the fixed arrival schedule')
    cash=spent=quantity=0.0
    trades=0
    fee=scenario['fee_bps']/10000
    step=instrument['quantity_step']
    tick=instrument['price_tick']
    orders=[]
    for position,index in enumerate(indices):
        cash+=requests.get(position,0)
        if trades>=cap or cash<=0: continue
        row=rows[index]
        ref=row['reference']
        limit=(ref*(1+scenario['immediate_slippage_bps']/10000) if immediate
               else down(ref*(1-distances[index]),tick))
        if limit<=0 or limit<instrument['min_price'] or (instrument['max_price']>0 and limit>instrument['max_price']): continue
        q=down(min(cash/ref,cash/(limit*(1+fee))),step)
        if instrument['max_quantity']>0: q=min(q,down(instrument['max_quantity'],step))
        if instrument['max_notional']>0: q=min(q,down(instrument['max_notional']/limit,step))
        if q<instrument['min_quantity'] or q*limit<instrument['min_notional']: continue
        if not immediate and row['monthly_low']>limit*(1-scenario['penetration_bps']/10000): continue
        filled=q if immediate else down(q*scenario['fill_fraction'],step)
        if filled<=0: continue
        cost=filled*limit*(1+fee)
        while cost>cash and filled>0:
            filled=down(max(0,filled-step),step)
            cost=filled*limit*(1+fee)
        if filled<=0: continue
        cash-=cost
        spent+=cost
        quantity+=filled
        trades+=1
        orders.append(dict(date=row['date'],quantity=filled,price=limit,spent=cost))
    return dict(wealth=cash+quantity*rows[indices[-1]]['monthly_close_price'],cash=cash,spent=spent,
                quantity=quantity,completion=spent/notional,trades=trades,orders=orders)


def block_interval(values, protocol):
    if len(values)<2: return None
    rng=random.Random(protocol['seed'])
    n=len(values)
    means=[]
    for _ in range(protocol['bootstrap_replicates']):
        sampled=[]
        while len(sampled)<n:
            start=rng.randrange(n)
            sampled.extend(values[(start+j)%n] for j in range(min(protocol['bootstrap_block_months'],n)))
        means.append(stats.fmean(sampled[:n]))
    return [quantile(means,.025),quantile(means,.975)]


def select(training, cache, options, variants, protocol):
    def summary(cid,metric):
        return stats.fmean(cache[(month,cid,v)][metric] for month in training for v in variants)
    # Predeclared completion constraint keeps cheap nonfills from winning by
    # simply abandoning more capital than the fixed-distance benchmark.
    floor=summary('fixed-25','completion')-protocol['maximum_completion_deterioration']
    eligible=[c for c in options if summary(c['id'],'completion')>=floor-1e-12]
    if not eligible: raise ValueError('Fixed benchmark must be an eligible candidate')
    return min(eligible,key=lambda c:(summary(c['id'],'cost_bps'),c['kind']!='fixed',c.get('lookback',0),c['id']))


def fit_instrument(item, protocol):
    rows=item['sessions']
    instrument=item['instrument']
    months=complete_months(rows,instrument['market_calendar'],protocol['max_lookback'])
    options=candidates(protocol)
    variants=[(flow,s['name']) for flow in protocol['capital_arrivals'] for s in protocol['scenarios']]
    scenario_by_name={s['name']:s for s in protocol['scenarios']}
    distances={c['id']:[offset(rows,i,c,protocol) if i>=protocol['max_lookback'] else None for i in range(len(rows))] for c in options}
    count=protocol['training_months']
    keys=list(months)
    folds=[]
    for pos in range(count,len(keys)):
        chain=keys[pos-count:pos+1]
        if all(month_after(a)==b for a,b in zip(chain,chain[1:])):
            folds.append((keys[pos],chain[:-1]))
    if not folds: raise ValueError('No complete causal training/test windows')
    latest_train=keys[-count:]
    if len(latest_train)<count or any(month_after(a)!=b for a,b in zip(latest_train,latest_train[1:])):
        raise ValueError('Latest training months are incomplete/nonconsecutive')
    profiles={}
    for cap in protocol['monthly_limits']:
        cache={}
        for month,indices in months.items():
            for variant in variants:
                flow,name=variant
                args=(rows,indices,instrument,cap)
                kw=dict(flow=flow,scenario=scenario_by_name[name],notional=protocol['task_notional'])
                baseline=episode(*args,None,**kw,immediate=True)
                baseline['cost_bps']=0.0
                cache[(month,'immediate',variant)]=baseline
                for c in options:
                    result=episode(*args,distances[c['id']],**kw)
                    result['cost_bps']=(baseline['wealth']-result['wealth'])/protocol['task_notional']*10000
                    cache[(month,c['id'],variant)]=result
        chosen=[(month,select(training,cache,options,variants,protocol)) for month,training in folds]
        diagnostics={}
        passed=len(folds)>=protocol['minimum_oos_months']
        for scenario in protocol['scenarios']:
            name=scenario['name']
            selected_rows=[cache[(m,c['id'],(f,name))] for m,c in chosen for f in protocol['capital_arrivals']]
            comparisons={}
            for benchmark in ('immediate','fixed-25'):
                diffs=[stats.fmean(cache[(m,c['id'],(f,name))]['cost_bps']-cache[(m,benchmark,(f,name))]['cost_bps'] for f in protocol['capital_arrivals']) for m,c in chosen]
                baseline_rows=[cache[(m,benchmark,(f,name))] for m,c in chosen for f in protocol['capital_arrivals']]
                interval=block_interval(diffs,protocol)
                completion_gap=stats.fmean(r['completion'] for r in selected_rows)-stats.fmean(r['completion'] for r in baseline_rows)
                comparisons[benchmark]=dict(mean_excess_cost_bps=stats.fmean(diffs),block_interval_95_bps=interval,completion_gap=completion_gap)
                passed=passed and interval is not None and interval[1]<-protocol['materiality_bps'] and completion_gap>=-protocol['maximum_completion_deterioration']
            diagnostics[name]=dict(mean_completion=stats.fmean(r['completion'] for r in selected_rows),mean_trades=stats.fmean(r['trades'] for r in selected_rows),max_trades=max(r['trades'] for r in selected_rows),mean_unspent_cash=stats.fmean(r['cash'] for r in selected_rows),comparisons=comparisons)
        latest=select(latest_train,cache,options,variants,protocol)
        profile=dict(monthly_limit=cap,candidate=latest,next_offset_pct=offset(rows,len(rows),latest,protocol)*100,
                     latest_training_months=latest_train,oos_months=[m for m,_ in chosen],oos=diagnostics,
                     retrospective_gate_passed=bool(passed),production_promoted=False,
                     folds=[dict(month=m,candidate=c['id'],nominal_cost_bps=stats.fmean(cache[(m,c['id'],(f,'nominal'))]['cost_bps'] for f in protocol['capital_arrivals'])) for m,c in chosen])
        profiles[str(cap)]=profile
    return dict(instrument_id=instrument['instrument_id'],symbol=instrument['symbol'],price_source=item['price_source'],
                data_as_of=rows[-1]['date'],market_calendar=instrument['market_calendar'],
                common_months=keys,profiles=profiles,quality=item['quality'])


def markdown(bundle):
    lines=['# Monthly single-order BUY optimization','',f"Generated {bundle['generated_at']}. Protocol `{VERSION}`. Research only; no automatic promotion.",'',
        'Cash sizing uses the full outstanding amount. Monthly limits do not divide capital. The two standardized cash-arrival paths are assumptions, not reconstructed personal/CCD deployment history.','',
        'Default monthly cap: 5. Cost differences below are selected walk-forward policy minus same-cap immediate execution; negative is better. Intervals use paired 3-month blocks and are exploratory.','',
        '| Instrument | Latest candidate | Next offset | OOS months | Nominal excess bp (95% interval) | Completion | Gate |',
        '|---|---|---:|---:|---|---:|---|']
    for item in bundle['instruments'].values():
        p=item['profiles']['5'];d=p['oos']['nominal'];c=d['comparisons']['immediate'];lo,hi=c['block_interval_95_bps']
        lines.append(f"| {item['instrument_id']} | {p['candidate']['id']} | {p['next_offset_pct']:.3f}% | {len(p['oos_months'])} | {c['mean_excess_cost_bps']:.2f} [{lo:.2f}, {hi:.2f}] | {d['mean_completion']:.1%} | {'pass (research only)' if p['retrospective_gate_passed'] else 'not passed'} |")
    lines+=['','The gate requires at least eight test months, >5 bp improvement with the upper paired interval below -5 bp against both immediate and fixed 25 bp benchmarks under both nominal and adverse assumptions, and no >1 percentage-point completion deterioration. These are retrospective checks, not proof of future advantage.','',
        'ETF runs use indexed Binance spot proxies, not ETF quotes. Fees, touch penetration and partial fills are hypothetical sensitivities. Current order increments/filters are held constant. Daily cancellation/review and a single instrument consuming the available allowance are replay assumptions. Other accounts, sells and carried working orders still need the user-entered shared slot reservations.','',
        f"Input SHA-256: `{bundle['input_sha256']}`. Protocol SHA-256: `{bundle['protocol_sha256']}`.",'',
        'Reproduce: `python3 scripts/prepare_monthly_execution.py` then `python3 scripts/optimize_monthly_execution.py`. Archives are cached with SHA-256 provenance under ignored `.research/`; the complete compact report is in `data/execution_monthly_params.json`.','']
    return '\n'.join(lines)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,default=ROOT/'.research/monthly-sessions.json')
    p.add_argument('--protocol',type=Path,default=ROOT/'research/execution-monthly-protocol.json')
    p.add_argument('--output',type=Path,default=ROOT/'data/execution_monthly_params.json')
    p.add_argument('--report',type=Path,default=ROOT/'research/results/monthly-single-order-report.md')
    a=p.parse_args()
    raw=a.input.read_bytes();snapshot=json.loads(raw)
    protocol_raw=a.protocol.read_bytes();protocol=json.loads(protocol_raw)
    digest=hashlib.sha256(protocol_raw).hexdigest()
    if snapshot.get('schema_version')!=2 or snapshot['protocol_sha256']!=digest: raise ValueError('Snapshot/protocol mismatch; rebuild inputs')
    result=dict(schema_version=1,policy_version=VERSION,generated_at=datetime.now(timezone.utc).isoformat(),default_monthly_limit=5,
                status='research_only',input_sha256=hashlib.sha256(raw).hexdigest(),protocol_sha256=digest,
                protocol=protocol,archives=snapshot['archives'],registry_sha256=snapshot['registry_sha256'],instruments={})
    for item in snapshot['instruments']:
        fitted=fit_instrument(item,protocol)
        result['instruments'][fitted['instrument_id']]=fitted
        print(fitted['instrument_id'],json.dumps(fitted['profiles']['5']),flush=True)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    tmp=a.output.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(a.output)
    a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(markdown(result))
    print('Saved',a.output,flush=True)

if __name__=='__main__': main()
