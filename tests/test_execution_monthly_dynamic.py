import copy
import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import optimize_monthly_dynamic as m

INSTRUMENT=dict(quantity_step=.0001,price_tick=.01,min_quantity=.0001,min_notional=1,min_price=.01,max_price=0,max_quantity=0,max_notional=0)
SCENARIO=dict(fee_bps=0,penetration_bps=0,fill_fraction=1,immediate_slippage_bps=0)
CANDIDATE=dict(id='monthly-10-1-1',lookback=10,fill_intensity=1,allocation_scale=1)


class DynamicMonthlyTests(unittest.TestCase):
    def test_published_profiles_preserve_provenance_monthly_caps_and_cash_carry(self):
        report=json.loads((ROOT/'data/execution_monthly_dynamic_params.json').read_text())
        self.assertEqual(report['protocol_sha256'],hashlib.sha256((ROOT/'research/execution-monthly-dynamic-protocol.json').read_bytes()).hexdigest())
        for instrument in report['instruments'].values():
            self.assertEqual(set(instrument['profiles']),{str(n) for n in range(1,32)})
            for key,p in instrument['profiles'].items():
                self.assertLess(p['latest_training_months'][-1],instrument['data_as_of'][:7])
                for scenario in p['oos'].values():
                    self.assertLessEqual(scenario['max_monthly_trades'],int(key))
                    self.assertGreaterEqual(scenario['mean_completion'],0)
                    self.assertLessEqual(scenario['mean_completion'],1+1e-9)
                    self.assertGreaterEqual(scenario['mean_unspent_cash'],0)
            path=instrument['profiles']['5']['nominal_path']
            for i,row in enumerate(path):
                self.assertAlmostEqual(row['contributed'],(i+1)*10000)
                self.assertAlmostEqual(row['cash']+row['spent'],row['contributed'],places=6)
            self.assertAlmostEqual(sum(row['wealth_change'] for row in path),path[-1]['wealth'],places=6)

    def test_python_browser_policy_parity_over_days_slots_and_candidates(self):
        p=json.loads((ROOT/'research/execution-monthly-dynamic-protocol.json').read_text())
        cases=[]
        for c in m.candidates(p):
            samples=[dict(date=f'2026-01-{i%28+1:02d}',drawdown_pct=.1+(i*17%41)/10) for i in range(c['lookback'])]
            # Generate actual unique session keys, not duplicated day strings.
            from datetime import date,timedelta
            for i,s in enumerate(samples):s['date']=str(date(2026,1,1)+timedelta(days=i))
            for days,slots in [(20,5),(2,5),(20,1),(1,1),(0,1),(31,31)]:
                cases.append(dict(samples=samples,sessionDate='2026-06-01',remainingDays=days,slots=slots,candidate=c))
        js="const p=require('./execution/monthly-policy.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(x=>p.decision(x)))));"
        out=json.loads(subprocess.run(['node','-e',js],input=json.dumps(cases),text=True,capture_output=True,check=True,cwd=ROOT).stdout)
        for case,actual in zip(cases,out):
            expected=m.decision([x['drawdown_pct']/100 for x in case['samples']],case['remainingDays'],case['slots'],case['candidate'])
            for field in ['offset','fraction']:self.assertAlmostEqual(actual[field],expected[field],places=12)

    def test_unspent_cash_and_acquired_units_carry_and_only_trade_count_resets(self):
        rows=[dict(date=f'2026-04-{i+1:02d}',reference=100,monthly_low=99,monthly_close_price=105) for i in range(5)]
        args=dict(rows=rows,indices=list(range(5)),instrument=INSTRUMENT,cap=1,decide=lambda *x:dict(offset=.005,fraction=.25),flow='month_start',scenario=SCENARIO,notional=10000)
        first=m.run_month(**args)
        second=m.run_month(**args,state=first['state'])
        self.assertEqual(first['trades'],1);self.assertEqual(second['trades'],1)
        self.assertGreater(second['orders'][0]['spent'],first['orders'][0]['spent'])
        self.assertGreater(second['state']['quantity'],first['state']['quantity'])
        self.assertAlmostEqual(second['state']['cash']+second['state']['spent'],20000)
        self.assertAlmostEqual(first['wealth_change']+second['wealth_change'],second['state']['wealth'])
        self.assertEqual(first['state']['contributed'],10000,'input state was not mutated')

    def test_nonfill_never_turns_into_a_month_end_fill_and_fees_cannot_exceed_allocation(self):
        rows=[dict(date='2026-04-30',reference=100,monthly_low=100,monthly_close_price=110)]
        args=dict(rows=rows,indices=[0],instrument=INSTRUMENT,cap=5,decide=lambda *x:dict(offset=.005,fraction=.25),flow='month_start',scenario=SCENARIO,notional=10000)
        first=m.run_month(**args);second=m.run_month(**args,state=first['state'])
        self.assertEqual(second['state']['cash'],20000);self.assertEqual(second['trades'],0)
        rows[0]['monthly_low']=90
        r=m.run_month(**{**args,'scenario':{**SCENARIO,'fee_bps':50,'fill_fraction':.5}})
        self.assertLessEqual(r['monthly_spent'],2500)
        self.assertAlmostEqual(r['state']['cash']+r['state']['spent'],10000)

    def test_selection_uses_training_only_and_reports_impossible_constraint(self):
        p=dict(scenarios=[dict(name='nominal')],maximum_completion_deterioration=.05)
        options=[CANDIDATE,{**CANDIDATE,'id':'other','allocation_scale':.5}]
        variant=('month_start','nominal')
        cache={}
        for month in ['2026-01','2026-02']:
            for cid,cost,completion in [('fixed-25-split',0,.9),(CANDIDATE['id'],10,.88),('other',-100,.1)]:
                cache[(month,cid,variant)]=dict(cost_bps=cost,deployed_fraction=completion)
        selected,ok=m.select(['2026-01'],cache,options,[variant],p)
        self.assertTrue(ok);self.assertEqual(selected['id'],CANDIDATE['id'])
        cache[('2026-02','other',variant)]['cost_bps']=-999999
        self.assertEqual(m.select(['2026-01'],cache,options,[variant],p),(selected,ok))
        cache[('2026-01','fixed-25-split',variant)]['deployed_fraction']=2
        self.assertFalse(m.select(['2026-01'],cache,options,[variant],p)[1])

if __name__=='__main__':unittest.main()
