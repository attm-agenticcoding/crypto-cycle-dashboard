"""Known-answer and causal checks. No fitting runs, downloads or CSV writes."""
import csv, hashlib, io, json, unittest, zipfile
from dataclasses import replace
from datetime import date,datetime,timedelta,timezone
import run

def rows(name):
    return list(csv.DictReader(io.StringIO((run.ROOT/name).read_text())))

def scenario(history=(.01,), current=(.01,), reference=100, terminal=100):
    ex=list(history)+list(current)
    ss=[run.legacy.Session(date(2026,1,1)+timedelta(days=i),100,e,None,e,'XNYS') for i,e in enumerate(ex)]
    first=len(history); ss[first]=replace(ss[first],reference=reference)
    common={str(s.session_date):100 for s in ss}
    ends={str(s.session_date):terminal for s in ss}
    return ss,list(range(first,len(ss))),common,ends

class BoundaryTests(unittest.TestCase):
    def test_anchor_extremes_and_after_close_excluded(self):
        for anchor in run.ANCHORS.values():
            dt=datetime(2026,10,19,tzinfo=timezone.utc)
            mp={anchor:run.legacy.MinuteBar(dt,1,100,1000),
                anchor+1:run.legacy.MinuteBar(dt+timedelta(minutes=1),99,100,102),
                anchor+2:run.legacy.MinuteBar(dt+timedelta(minutes=2),1,100,1000)}
            ref,down,up=run.session_excursions(mp,anchor,anchor+2)
            self.assertEqual(ref,100); self.assertAlmostEqual(down,.01);self.assertAlmostEqual(up,.02)
            for side,exc in [('buy',down),('sell',up)]:
                self.assertEqual(run.count(exc,.03,.01,side,0),0)
            mp[anchor]=replace(mp[anchor],low=.1,high=10000)
            self.assertEqual((ref,down,up),run.session_excursions(mp,anchor,anchor+2))

    def test_future_cost_perturbation_cannot_change_past_selection(self):
        ps=[(10,.003,.0095),(20,.005,.008)]
        costs={ps[0]:list(range(40)),ps[1]:[v+2 for v in range(40)]}
        before=run.select_training_window(costs,26,None)[0]
        # Change the held-out fold itself and every later week by huge amounts.
        changed={p:v[:26]+[(-1 if i else 1)*1e9 for _ in v[26:]] for i,(p,v) in enumerate(costs.items())}
        after=run.select_training_window(changed,26,None)[0]
        self.assertEqual(run.live.parameters(before),run.live.parameters(after))
        self.assertEqual(before.costs_bps,after.costs_bps)
        # Also verify an existing prior uses only the same historical slice.
        self.assertEqual(run.live.parameters(run.select_training_window(costs,26,ps[1])[0]),
                         run.live.parameters(run.select_training_window(changed,26,ps[1])[0]))

    def test_future_path_perturbation_cannot_change_past_quantity(self):
        ss,ix,common,terminal=scenario(history=(.01,)*10,current=(.01,0,.01,0,0))
        future=[replace(ss[-1],session_date=ss[-1].session_date+timedelta(days=i+1),drawdown=99,runup=99,reference=1e8) for i in range(10)]
        for side in ('buy','sell'):
            past_trace=[]
            before=run.evaluate(ss,ix,(10,.01,.1),side,0,common,terminal,trace=past_trace)
            future_trace=[]
            after=run.evaluate(ss+future,ix,(10,.01,.1),side,0,common,terminal,trace=future_trace)
            self.assertEqual(before,after); self.assertEqual(past_trace,future_trace)
            # Perturb a later day *inside* the same test week. Every actual
            # earlier quantity, limit and expected value must remain identical.
            modified=list(ss);modified[ix[-1]]=replace(ss[ix[-1]],drawdown=1,runup=1,reference=10000)
            modified_trace=[]
            run.evaluate(modified,ix,(10,.01,.1),side,0,common,terminal,trace=modified_trace)
            self.assertEqual(past_trace[:-1],modified_trace[:-1])
            self.assertAlmostEqual(past_trace[0]['fills'][0][1],.2)
            self.assertAlmostEqual(past_trace[2]['fills'][0][1],.8/3)

    def test_zero_history_zero_and_partial_completion(self):
        for side in ('buy','sell'):
            ss,ix,c,t=scenario(history=(0,),current=(.5,),terminal=110)
            r=run.evaluate(ss,ix,(1,.01,.1),side,0,c,t)
            self.assertEqual(r['completion'],0);self.assertIsNone(r['passive_price_bps'])
            self.assertAlmostEqual(r['cost_bps'],1000*(1 if side=='buy' else -1))
            ss,ix,c,t=scenario(history=(.01,),current=(0,0))
            self.assertEqual(run.evaluate(ss,ix,(1,.01,.1),side,0,c,t)['completion'],0)
            ss,ix,c,t=scenario(history=(.01,),current=(.01,0),terminal=110)
            r=run.evaluate(ss,ix,(1,.01,.1),side,0,c,t)
            self.assertAlmostEqual(r['completion'],.5)
            # Buy .5*99+.5*110=104.5; sell .5*101+.5*110=105.5.
            self.assertAlmostEqual(r['cost_bps'],450 if side=='buy' else -550)
            self.assertAlmostEqual(r['opportunity_bps'],500 if side=='buy' else -500)

    def test_known_answer_full_completion_buy_sell(self):
        ss,ix,c,t=scenario(terminal=500)
        for side in ('buy','sell'):
            r=run.evaluate(ss,ix,(1,.01,.1),side,0,c,t)
            self.assertEqual(r['completion'],1);self.assertEqual(r['uncompleted'],0)
            self.assertAlmostEqual(r['passive_price_bps'],-100 if side=='buy' else 100)
            self.assertAlmostEqual(r['cost_bps'],-100)
            self.assertEqual(r['opportunity_bps'],0)

    def test_budget_trigger_caps_quantity(self):
        # P0=100 => budget120. Current anchor200 => first buy limit198.
        ss,ix,c,t=scenario(reference=200,terminal=210)
        r=run.evaluate(ss,ix,(1,.01,.1),'buy',0,c,t)
        self.assertTrue(r['budget_bound']);self.assertAlmostEqual(r['completion'],120/198)
        self.assertAlmostEqual(r['cost_bps'],((120+(1-120/198)*210)/100-1)*10000)
        self.assertAlmostEqual(r['completion']*198,120)

    def test_common_dates_terminal_reference_and_targets(self):
        grouped={}
        for row in rows('sessions.csv'): grouped.setdefault(row['date'],[]).append(row)
        self.assertEqual(len(grouped),251)
        for group in grouped.values():
            self.assertEqual({r['anchor'] for r in group},set(run.ANCHORS))
            for field in ('terminal','common_reference','close_minute'):
                self.assertEqual(len({r[field] for r in group}),1)
        groups={}
        for r in rows('oos_weekly.csv'):
            groups.setdefault((r['side'],r['penetration_bps'],r['week']),[]).append(r)
            self.assertAlmostEqual(float(r['completion'])+float(r['uncompleted']),1)
        self.assertEqual(len(groups),2*3*13)
        for group in groups.values():
            self.assertEqual({r['anchor'] for r in group},set(run.ANCHORS))
            self.assertEqual(len({r['terminal_return_bps'] for r in group}),1)

    def test_replay_all_saved_oos_after_refactor(self):
        ss={a:[] for a in run.ANCHORS};common={};terminal={}
        for row in rows('sessions.csv'):
            d=date.fromisoformat(row['date'])
            ss[row['anchor']].append(run.legacy.Session(d,float(row['reference']),float(row['drawdown']),None,float(row['runup']),'XNYS'))
            common[row['date']]=float(row['common_reference']);terminal[row['date']]=float(row['terminal'])
        saved=rows('oos_weekly.csv');self.assertEqual(len(saved),234)
        for row in saved:
            sessions=ss[row['anchor']]
            first=date.fromisoformat(row['week']);monday=first-timedelta(days=first.weekday())
            ix=[i for i,s in enumerate(sessions) if s.session_date-timedelta(days=s.session_date.weekday())==monday]
            p=(int(row['lookback']),float(row['first_pct'])/100,float(row['spacing_pct'])/100)
            actual=run.evaluate(sessions,ix,p,row['side'],float(row['penetration_bps'])/10000,common,terminal)
            for key,value in actual.items():
                if value is None:self.assertEqual(row[key],'')
                elif isinstance(value,bool):self.assertEqual(row[key],str(value))
                else:self.assertEqual(value,float(row[key]),(row['week'],row['anchor'],key))

    def test_raw_zip_independent_minute_to_sessions(self):
        # Independent zip/csv/timestamp/OHLC parser: do not call legacy.parse_zip
        # or run.session_excursions. Covers both DST changes and half-days.
        dates=['2025-10-31','2025-11-03','2025-11-28','2025-12-24','2026-03-06','2026-03-09','2026-10-19']
        saved={(r['date'],r['anchor']):r for r in rows('sessions.csv')}
        manifest={r['file']:r for r in json.loads((run.ROOT/'input_manifest.json').read_text())}
        for day in dates:
            name=f'BTCUSDT-1m-{day[:7]}.zip' if day[:7]!='2026-10' else f'BTCUSDT-1m-{day}.zip'
            path=run.ROOT/'cache'/name
            self.assertTrue(path.exists(),f'Redownload official input via download.py: {name}')
            raw=path.read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),manifest[name]['sha256'])
            minute={}
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                with z.open(next(n for n in z.namelist() if n.endswith('.csv'))) as f:
                    for fields in csv.reader(io.TextIOWrapper(f)):
                        stamp=int(fields[0]); seconds=stamp/(1_000_000 if stamp>10**14 else 1000)
                        utc=datetime.fromtimestamp(seconds,timezone.utc); local=utc.astimezone(run.legacy.ET)
                        if local.date().isoformat()==day:
                            m=local.hour*60+local.minute; self.assertNotIn(m,minute)
                            minute[m]=(float(fields[3]),float(fields[4]),float(fields[2]),utc.isoformat())
            for anchor,m in run.ANCHORS.items():
                row=saved[day,anchor];end=int(row['close_minute'])
                self.assertEqual(set(range(420,end))-minute.keys(),set())
                price=minute[m][1]; lows=[minute[k][0] for k in range(m+1,end)]; highs=[minute[k][2] for k in range(m+1,end)]
                for field,value in [('reference',price),('drawdown',max(0,1-min(lows)/price)),('runup',max(0,max(highs)/price-1)),('terminal',minute[end-1][1]),('common_reference',minute[420][1])]:
                    self.assertAlmostEqual(float(row[field]),value,places=12)
                self.assertEqual(row['anchor_utc'],minute[m][3])

if __name__=='__main__':unittest.main()
