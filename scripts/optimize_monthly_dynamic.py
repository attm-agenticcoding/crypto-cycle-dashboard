#!/usr/bin/env python3
"""Fit daily price/size policies with monthly slots and genuine cash carry."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import statistics as stats
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import optimize_monthly_execution as old

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'monthly-dynamic-v1'


def candidates(p):
    return [dict(id=f'monthly-{n}-{u:g}-{a:g}', lookback=n, fill_intensity=u, allocation_scale=a)
            for n in p['lookbacks'] for u in p['fill_intensities'] for a in p['allocation_scales']]


def decision(moves, days, slots, candidate):
    if days <= 0 or slots <= 0:
        return dict(offset=0.0, fraction=0.0, quantile=None, opportunities=0)
    if len(moves) != candidate['lookback'] or any(not math.isfinite(x) or x < 0 for x in moves):
        raise ValueError('A complete finite strictly prior lookback is required')
    opportunities = min(days, slots)
    q = max(.25, min(.9, 1 - candidate['fill_intensity'] * opportunities / days))
    offset = max(.0005, min(.05, old.quantile(moves, q)))
    median = max(.0005, old.quantile(moves, .5))
    edge = max(.5, min(2, math.sqrt(offset / median)))
    fraction = max(.05, min(.75 if opportunities > 1 else 1, candidate['allocation_scale'] / opportunities * edge))
    return dict(offset=offset, fraction=fraction, quantile=q, opportunities=opportunities)


def start_state():
    return dict(cash=0.0, quantity=0.0, contributed=0.0, spent=0.0, wealth=0.0)


def run_month(rows, indices, instrument, cap, decide, flow, scenario, notional, state=None, benchmark=None):
    """Carry cash/holdings; reset only filled-order count. No fabricated closeout."""
    if not isinstance(cap, int) or cap < 0:
        raise ValueError('Invalid monthly cap')
    if flow not in ('month_start', 'five_installments'):
        raise ValueError('Invalid arrival scenario')
    state = dict(start_state() if state is None else state)
    arrivals = {0:notional} if flow == 'month_start' else {math.floor(j*(len(indices)-1)/4):notional/5 for j in range(5)}
    if len(arrivals) != (1 if flow == 'month_start' else 5):
        raise ValueError('Too few monthly sessions for fixed installments')
    previous_spent, previous_wealth = state['spent'], state['wealth']
    trades, orders = 0, []
    fee = scenario['fee_bps']/10000
    step, tick = instrument['quantity_step'], instrument['price_tick']
    for position, index in enumerate(indices):
        arrival = arrivals.get(position, 0)
        state['cash'] += arrival
        state['contributed'] += arrival
        slots, days = cap-trades, len(indices)-position
        if not slots or state['cash'] <= 0:
            continue
        row = rows[index]
        ref = row['reference']
        if benchmark:
            offset = 0 if benchmark == 'immediate' else .0025
            fraction = 1/min(slots, days) if benchmark == 'fixed-25-split' else 1
        else:
            picked = decide(index, days, slots)
            offset, fraction = picked['offset'], picked['fraction']
        budget = state['cash']*fraction
        limit = ref*(1+scenario['immediate_slippage_bps']/10000) if benchmark == 'immediate' else old.down(ref*(1-offset), tick)
        if limit <= 0 or limit < instrument['min_price'] or (instrument['max_price'] > 0 and limit > instrument['max_price']):
            continue
        quantity = old.down(min(budget/ref, budget/(limit*(1+fee))), step)
        if instrument['max_quantity'] > 0:
            quantity = min(quantity, old.down(instrument['max_quantity'], step))
        if instrument['max_notional'] > 0:
            quantity = min(quantity, old.down(instrument['max_notional']/limit, step))
        if quantity < instrument['min_quantity'] or quantity*limit < instrument['min_notional']:
            continue
        if benchmark != 'immediate' and row['monthly_low'] > limit*(1-scenario['penetration_bps']/10000):
            continue
        filled = quantity if benchmark == 'immediate' else old.down(quantity*scenario['fill_fraction'], step)
        cost = filled*limit*(1+fee)
        while cost > budget+1e-8 and filled > 0:
            filled = old.down(max(0, filled-step), step)
            cost = filled*limit*(1+fee)
        if filled <= 0:
            continue
        state['cash'] -= cost
        state['spent'] += cost
        state['quantity'] += filled
        trades += 1
        orders.append(dict(date=row['date'],price=limit,quantity=filled,spent=cost,offset=offset,fraction=fraction,days=days,slots=slots))
    state['wealth'] = state['cash']+state['quantity']*rows[indices[-1]]['monthly_close_price']
    return dict(state=state,monthly_spent=state['spent']-previous_spent,
                wealth_change=state['wealth']-previous_wealth,trades=trades,orders=orders)


def select(training, cache, options, variants, p):
    def average(cid, metric, scenario=None):
        return stats.fmean(cache[(m,cid,v)][metric] for m in training for v in variants if scenario is None or v[1] == scenario)
    names = [s['name'] for s in p['scenarios']]
    floor = {name:average('fixed-25-split','deployed_fraction',name)-p['maximum_completion_deterioration'] for name in names}
    eligible = [c for c in options if all(average(c['id'],'deployed_fraction',name)>=floor[name]-1e-12 for name in names)]
    if eligible:
        return min(eligible,key=lambda c:(average(c['id'],'cost_bps'),c['lookback'],c['id'])), True
    # Do not claim an impossible constraint passed. Return a disclosed candidate
    # for user-requested model arithmetic, with no validation/optimality claim.
    return min(options,key=lambda c:(-min(average(c['id'],'deployed_fraction',name)-floor[name] for name in names),average(c['id'],'cost_bps'),c['id'])), False


def fit_instrument(item, p):
    rows, instrument = item['sessions'], item['instrument']
    months = old.complete_months(rows,instrument['market_calendar'],p['max_lookback'])
    keys, options = list(months), candidates(p)
    count = p['training_months']
    folds = [(keys[i],keys[i-count:i]) for i in range(count,len(keys))
             if all(old.month_after(a)==b for a,b in zip(keys[i-count:i+1],keys[i-count+1:i+1]))]
    if not folds:
        raise ValueError('No causal completed-month folds')
    # Cash may not jump across a missing month that hides orders/funding.
    if any(old.month_after(a)!=b for a,b in zip(keys,keys[1:])):
        raise ValueError('Missing full month breaks continuous cash-carry replay')
    variants = [(flow,s['name']) for flow in p['capital_arrivals'] for s in p['scenarios']]
    scenario_by_name = {s['name']:s for s in p['scenarios']}
    option_by_id = {c['id']:c for c in options}
    histories = {(i,n):[r['drawdown_pct']/100 for r in rows[i-n:i]] for n in p['lookbacks'] for i in range(p['max_lookback'],len(rows))}
    @lru_cache(maxsize=None)
    def choose(cid,index,days,slots):
        c=option_by_id[cid]
        return decision(histories[(index,c['lookback'])],days,slots,c)
    benchmarks = ['immediate','fixed-25-full','fixed-25-split']
    profiles = {}
    for cap in p['monthly_limits']:
        cache = {}
        for variant in variants:
            flow,name = variant
            kw=dict(rows=rows,instrument=instrument,cap=cap,flow=flow,scenario=scenario_by_name[name],notional=p['task_notional'])
            for cid in benchmarks+[c['id'] for c in options]:
                state = start_state()
                for month,indices in months.items():
                    result = run_month(indices=indices,state=state,decide=lambda i,d,k:choose(cid,i,d,k),benchmark=cid if cid in benchmarks else None,**kw)
                    state = result['state']
                    immediate = result if cid == 'immediate' else cache[(month,'immediate',variant)]
                    cache[(month,cid,variant)] = dict(wealth_change=result['wealth_change'],cost_bps=(immediate['wealth_change']-result['wealth_change'])/p['task_notional']*10000,
                        deployed_fraction=result['monthly_spent']/p['task_notional'])
        choices = [(month,*select(training,cache,options,variants,p)) for month,training in folds]
        latest,eligible = select(keys[-count:],cache,options,variants,p)
        paths = {}
        for variant in variants:
            flow,name=variant
            kw=dict(rows=rows,instrument=instrument,cap=cap,flow=flow,scenario=scenario_by_name[name],notional=p['task_notional'])
            for label in ['selected']+benchmarks:
                state=start_state()
                path=[]
                for month,candidate,_ in choices:
                    result=run_month(indices=months[month],state=state,decide=lambda i,d,k:choose(candidate['id'],i,d,k),benchmark=None if label=='selected' else label,**kw)
                    state=result['state']
                    path.append(dict(month=month,cash=state['cash'],wealth=state['wealth'],spent=state['spent'],contributed=state['contributed'],
                        wealth_change=result['wealth_change'],trades=result['trades'],monthly_spent=result['monthly_spent']))
                paths[(label,variant)]=path
        diagnostics={}
        passed=len(folds)>=p['minimum_oos_months']
        for scenario in p['scenarios']:
            name=scenario['name']
            selected_paths=[paths[('selected',(flow,name))] for flow in p['capital_arrivals']]
            comparisons={}
            for benchmark in benchmarks:
                diffs=[stats.fmean((paths[(benchmark,(flow,name))][j]['wealth_change']-paths[('selected',(flow,name))][j]['wealth_change'])/p['task_notional']*10000 for flow in p['capital_arrivals']) for j in range(len(choices))]
                interval=old.block_interval(diffs,p)
                completion_gap=stats.fmean((paths[('selected',(flow,name))][-1]['spent']-paths[(benchmark,(flow,name))][-1]['spent'])/paths[('selected',(flow,name))][-1]['contributed'] for flow in p['capital_arrivals'])
                comparisons[benchmark]=dict(mean_excess_cost_bps=stats.fmean(diffs),block_interval_95_bps=interval,completion_gap=completion_gap)
                passed=passed and interval is not None and interval[1]<-p['materiality_bps'] and completion_gap>=-p['maximum_completion_deterioration']
            diagnostics[name]=dict(mean_completion=stats.fmean(path[-1]['spent']/path[-1]['contributed'] for path in selected_paths),
                mean_unspent_cash=stats.fmean(path[-1]['cash'] for path in selected_paths),mean_monthly_trades=stats.fmean(row['trades'] for path in selected_paths for row in path),
                max_monthly_trades=max(row['trades'] for path in selected_paths for row in path),comparisons=comparisons)
        profiles[str(cap)]=dict(monthly_limit=cap,candidate=latest,training_constraint_passed=eligible,latest_training_months=keys[-count:],
            oos_months=[m for m,_,_ in choices],advantage_check_passed=bool(passed),oos=diagnostics,
            folds=[dict(month=m,candidate=c['id'],training_constraint_passed=ok) for m,c,ok in choices])
        if cap==5:
            profiles[str(cap)]['nominal_path']=paths[('selected',('month_start','nominal'))]
        print(instrument['instrument_id'],'cap',cap,'candidate',latest['id'],flush=True)
    return dict(instrument_id=instrument['instrument_id'],symbol=instrument['symbol'],price_source=item['price_source'],data_as_of=rows[-1]['date'],
                common_months=keys,profiles=profiles,quality=item['quality'])


def markdown(bundle):
    lines=['# Monthly dynamic price and allocation model','',f"Generated {bundle['generated_at']}; `{VERSION}`. Price priority with cash carry; fitted candidates are not claims of validated optimality.",'',
        'Each daily plan recalculates both limit distance and investment fraction from strictly completed drawdowns, days left this month, free trade slots and the entered price/capital. Unfilled cash carries to subsequent months. There is no required month-end purchase.','',
        'Default cap 5. Costs are walk-forward portfolio implementation differences versus same-cap immediate execution per dollar contributed; negative is better. Cash and acquired units carry throughout each out-of-sample path.','',
        '| Instrument | Latest fitted policy | OOS months | Nominal excess bp (95% block interval) | Deployed | Advantage check |',
        '|---|---|---:|---|---:|---|']
    for item in bundle['instruments'].values():
        p=item['profiles']['5'];d=p['oos']['nominal'];c=d['comparisons']['immediate'];lo,hi=c['block_interval_95_bps']
        lines.append(f"| {item['instrument_id']} | {p['candidate']['id']} | {len(p['oos_months'])} | {c['mean_excess_cost_bps']:.2f} [{lo:.2f}, {hi:.2f}] | {d['mean_completion']:.1%} | {'passed (retrospective only)' if p['advantage_check_passed'] else 'not passed'} |")
    lines+=['','Selection uses only six preceding complete months from continuously carried counterfactual policies. OOS candidate changes retain the selected path’s own cash and holdings. Five installments is a funding sensitivity, not automatic five-way sizing. The exact selection/completion constraint and benchmarks are pinned in the protocol.','',
        'Monthly observations include changes in the marked-to-market value of previous fills. The sum of monthly wealth-gap increments equals the final wealth gap; unspent cash is never counted as a hypothetical fill. Paired block intervals are exploratory, retrospective and uncorrected for candidate search.','',
        'The calculator uses the fitted policy requested by the user and labels its evidence. An unsuccessful advantage check does not become a success because a policy is available in the calculator. Live offsets use the existing daily completed-session feed; candidate coefficients are a dated research fit, with no new production schedule.','',
        'ETF replay uses indexed spot proxies, not ETF quotes. Fees/partial fills/touch penetration are scenarios. Each daily replacement assumes confirmed cancellation; the calculator does not submit or cancel broker orders. Arbitrary intraday repricing is not validated by the fixed daily observation times in this replay.','',
        f"Input SHA-256: `{bundle['input_sha256']}`. Protocol SHA-256: `{bundle['protocol_sha256']}`.",'',
        'Reproduce in the cloud: `python3 scripts/prepare_monthly_execution.py --protocol research/execution-monthly-dynamic-protocol.json --output .research/monthly-dynamic-sessions.json`, then `python3 scripts/optimize_monthly_dynamic.py`.','']
    return '\n'.join(lines)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,default=ROOT/'.research/monthly-dynamic-sessions.json')
    p.add_argument('--protocol',type=Path,default=ROOT/'research/execution-monthly-dynamic-protocol.json')
    p.add_argument('--output',type=Path,default=ROOT/'data/execution_monthly_dynamic_params.json')
    p.add_argument('--report',type=Path,default=ROOT/'research/results/monthly-dynamic-report.md')
    a=p.parse_args()
    raw=a.input.read_bytes();snapshot=json.loads(raw)
    protocol_raw=a.protocol.read_bytes();protocol=json.loads(protocol_raw)
    digest=hashlib.sha256(protocol_raw).hexdigest()
    if snapshot.get('schema_version')!=2 or snapshot['protocol_sha256']!=digest or protocol['version']!=VERSION:
        raise ValueError('Snapshot/protocol mismatch')
    result=dict(schema_version=1,policy_version=VERSION,status='fitted_candidate_unproven',generated_at=datetime.now(timezone.utc).isoformat(),
        default_monthly_limit=5,input_sha256=hashlib.sha256(raw).hexdigest(),protocol_sha256=digest,protocol=protocol,archives=snapshot['archives'],
        registry_sha256=snapshot['registry_sha256'],instruments={})
    for item in snapshot['instruments']:
        fitted=fit_instrument(item,protocol)
        result['instruments'][fitted['instrument_id']]=fitted
    a.output.parent.mkdir(parents=True,exist_ok=True)
    tmp=a.output.with_suffix('.tmp');tmp.write_text(json.dumps(result,separators=(',',':'))+'\n');tmp.replace(a.output)
    a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(markdown(result))
    print('Saved',a.output,flush=True)


if __name__=='__main__':main()
