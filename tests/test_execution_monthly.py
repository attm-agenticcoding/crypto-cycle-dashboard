import copy
import json
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import optimize_monthly_execution as m
import prepare_monthly_execution as prep
from update_execution_params import MinuteBar

ROOT=Path(__file__).resolve().parents[1]
P=json.loads((ROOT/'research/execution-monthly-protocol.json').read_text())
INSTRUMENT=dict(quantity_step=.0001,price_tick=.01,min_quantity=.0001,min_notional=1,min_price=.01,max_price=0,max_quantity=0,max_notional=0,market_calendar='24X7')
SCENARIO=dict(fee_bps=0,penetration_bps=0,fill_fraction=1,immediate_slippage_bps=0)


def rows(n=20):
    return [dict(date=f'2026-04-{i+1:02d}',reference=100,monthly_low=99,monthly_close_price=110,drawdown_pct=1) for i in range(n)]


class MonthlyExecutionTests(unittest.TestCase):
    def episode(self,cap=5,**kwargs):
        rs=kwargs.pop('data',rows())
        return m.episode(rs,list(range(len(rs))),INSTRUMENT,cap,[.005]*len(rs),kwargs.pop('flow','month_start'),kwargs.pop('scenario',SCENARIO),10000,**kwargs)

    def test_full_amount_not_split_by_limit(self):
        for cap in [1,3,5,10,31]:
            r=self.episode(cap)
            self.assertEqual(r['orders'][0]['quantity'],100)
            self.assertEqual(r['orders'][0]['spent'],9950)
            self.assertLessEqual(r['trades'],cap)
            self.assertAlmostEqual(r['cash']+r['spent'],10000)

    def test_zero_limit_and_nonfill_keep_cash_not_fictitious_fills(self):
        r=self.episode(0)
        self.assertEqual((r['cash'],r['quantity'],r['trades']),(10000,0,0))
        data=rows()
        for x in data: x['monthly_low']=100
        r=self.episode(data=data)
        self.assertEqual((r['cash'],r['quantity'],r['trades']),(10000,0,0))
        immediate=self.episode(data=data,immediate=True)
        self.assertGreater(immediate['wealth'],r['wealth'])

    def test_fixed_cash_arrivals_do_not_depend_on_limit_and_cap_resets_per_month(self):
        for cap in [0,1,2,5,31]:
            r=self.episode(cap,flow='five_installments')
            self.assertAlmostEqual(r['spent']+r['cash'],10000)
            self.assertLessEqual(r['trades'],cap)
        self.assertEqual(self.episode(1),self.episode(1))

    def test_partial_replacements_consume_slots_and_fees_cannot_overspend(self):
        s={**SCENARIO,'fill_fraction':.5,'fee_bps':10}
        r=self.episode(3,scenario=s)
        self.assertEqual(r['trades'],3)
        self.assertLess(r['completion'],1)
        self.assertGreaterEqual(r['cash'],0)
        self.assertAlmostEqual(r['cash']+r['spent'],10000)

    def test_quantile_is_strictly_past_and_lookback_changes_distance(self):
        rs=rows(20)
        for i,r in enumerate(rs): r['drawdown_pct']=.1 if i<10 else 2
        c=dict(kind='quantile',lookback=10,quantile=.5)
        before=m.offset(rs,15,c,P)
        poisoned=copy.deepcopy(rs)
        for r in poisoned[15:]: r['drawdown_pct']=100
        self.assertEqual(m.offset(poisoned,15,c,P),before)
        self.assertNotEqual(m.offset(rs,20,c,P),m.offset(rs,20,{**c,'lookback':20},P))

    def test_training_selection_cannot_read_scored_or_future_months(self):
        options=[dict(id='fixed-25',kind='fixed',offset_bps=25),dict(id='fixed-5',kind='fixed',offset_bps=5)]
        variant=('month_start','nominal')
        cache={}
        for month in ['2026-01','2026-02','2026-03']:
            for c,cost in zip(options,[10,5]): cache[(month,c['id'],variant)]=dict(cost_bps=cost,completion=.99)
        selected=m.select(['2026-01','2026-02'],cache,options,[variant],P)
        cache[('2026-03','fixed-25',variant)]['cost_bps']=-999999
        self.assertEqual(m.select(['2026-01','2026-02'],cache,options,[variant],P),selected)
        self.assertEqual(selected['id'],'fixed-5')

    def test_completion_constraint_prevents_abandoning_capital_to_win(self):
        options=[dict(id='fixed-25',kind='fixed',offset_bps=25),dict(id='fixed-200',kind='fixed',offset_bps=200)]
        v=('month_start','nominal')
        cache={('2026-01','fixed-25',v):dict(cost_bps=10,completion=.95),('2026-01','fixed-200',v):dict(cost_bps=-1000,completion=.1)}
        self.assertEqual(m.select(['2026-01'],cache,options,[v],P)['id'],'fixed-25')

    def test_missing_minutes_or_partial_month_remove_month_for_every_candidate(self):
        rs=[]
        day=date(2026,1,1)
        while day<=date(2026,4,11):
            review=day-timedelta(days=1)
            rs.append(dict(date=str(day),review_date_ny=str(review),review_month=review.strftime('%Y-%m')))
            day+=timedelta(days=1)
        complete=m.complete_months(rs,'24X7',0)
        self.assertEqual(list(complete),['2026-01','2026-02','2026-03'])
        missing=[r for r in rs if r['date']!='2026-02-15']
        self.assertNotIn('2026-02',m.complete_months(missing,'24X7',0))

    def test_ny_month_boundary_excludes_late_crypto_touches_in_summer_and_winter(self):
        instrument=json.loads((ROOT/'data/execution_instruments.json').read_text())['instruments'][2]
        for day,cutoff,month in [(date(2026,4,1),4,'2026-03'),(date(2026,12,1),5,'2026-11')]:
            start=datetime(day.year,day.month,day.day,tzinfo=timezone.utc)
            bars=[MinuteBar(start+timedelta(minutes=i),99 if i<cutoff*60 else 1,100,101) for i in range(1440)]
            r=prep.monthly_rows(bars,instrument,day,day)['sessions'][0]
            self.assertEqual(r['review_month'],month)
            self.assertEqual(r['monthly_low'],99)
            self.assertEqual(r['low'],1)

    def test_all_published_profiles_respect_counts_and_remain_research_only(self):
        report=json.loads((ROOT/'data/execution_monthly_params.json').read_text())
        self.assertEqual(report['status'],'research_only')
        self.assertEqual(report['default_monthly_limit'],5)
        for instrument in report['instruments'].values():
            for k,profile in instrument['profiles'].items():
                self.assertFalse(profile['production_promoted'])
                self.assertTrue(profile['latest_training_months'][-1]<instrument['data_as_of'][:7])
                for d in profile['oos'].values():
                    self.assertLessEqual(d['max_trades'],int(k))
                    self.assertGreaterEqual(d['mean_completion'],0)
                    self.assertLessEqual(d['mean_completion'],1+1e-9)
                    self.assertGreaterEqual(d['mean_unspent_cash'],0)

if __name__=='__main__': unittest.main()
