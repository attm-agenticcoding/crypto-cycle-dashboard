import csv, io, json, unittest
from datetime import date, datetime, timezone, timedelta
import run
class ResearchTests(unittest.TestCase):
    def test_expected_fixed_at_week_start_matches_calibrator(self):
        # Monday zero hits must not lower Tuesday expected; a daily rolling
        # lookback would yield 1/(4*.9), whereas both implementations give .25.
        days=[date(2026,9,21)+timedelta(days=i) for i in range(16)]
        excursions=[.01]*10+[0,.01,0,0,0,0]
        ss=[run.legacy.Session(d,100,e,None,e,'XNYS') for d,e in zip(days,excursions)]
        prices={str(d):100 for d in days}
        for side in ('buy','sell'):
            actual=run.evaluate(ss,list(range(10,15)),(10,.01,.1),side,0,prices,prices)
            production=run.live.score_candidate(ss,[list(range(10,15))],10,.01,.1,side)
            self.assertAlmostEqual(actual['completion'],.25)
            self.assertAlmostEqual(actual['completion'],production.passive_completion[0])
    def test_dst(self):
        self.assertEqual(datetime(2026,3,6,12,tzinfo=timezone.utc).astimezone(run.legacy.ET).hour,7)
        self.assertEqual(datetime(2026,3,9,11,tzinfo=timezone.utc).astimezone(run.legacy.ET).hour,7)
    def test_calendar(self):
        for day in (date(2026,7,3),date(2026,4,3),date(2026,10,17)):
            self.assertFalse(run.live.session_day(day,'XNYS'))
        for day in (date(2025,11,28),date(2025,12,24)):
            self.assertEqual(run.legacy.sell_session_end(day).hour,13)
        self.assertEqual(run.legacy.sell_session_end(date(2026,7,2)).hour,16)
    def test_penetration(self):
        self.assertEqual(run.count(.003,.003,.0095,'buy',0),1)
        self.assertEqual(run.count(.003,.003,.0095,'buy',.0005),0)
        self.assertEqual(run.count(.003+.0005*.997,.003,.0095,'buy',.0005),1)
        self.assertEqual(run.count(.003+.0005*1.003,.003,.0095,'sell',.0005),1)
    def test_minute_contract(self):
        rows=list(csv.DictReader(io.StringIO((run.ROOT/'sessions.csv').read_text())))
        for row in rows:
            a=run.ANCHORS[row['anchor']]
            self.assertEqual(int(row['eligible_minutes']),int(row['close_minute'])-a-1)
            self.assertLess(date.fromisoformat(row['date']).weekday(),5)
        self.assertEqual(len(rows),251*3)
    def test_no_future_training(self):
        for row in csv.DictReader(io.StringIO((run.ROOT/'training.csv').read_text())):
            self.assertLess(row['train_last'],row['week'])
    def test_accounting(self):
        for row in csv.DictReader(io.StringIO((run.ROOT/'oos_weekly.csv').read_text())):
            self.assertAlmostEqual(float(row['completion'])+float(row['uncompleted']),1)
            self.assertAlmostEqual(float(row['cost_bps']),float(row['opportunity_bps'])+float(row['passive_contribution_bps']),places=7)
            self.assertTrue(0<=float(row['completion'])<=1)
    def test_baseline(self):
        for row in json.loads((run.ROOT/'baseline.json').read_text()).values(): self.assertTrue(row['matches'])
if __name__=='__main__': unittest.main()
