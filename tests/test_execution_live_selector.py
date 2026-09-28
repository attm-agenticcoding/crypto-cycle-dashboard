from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import update_execution_params as old
import update_execution_params_live as live


def rows(calendar="24X7", n=365):
    start = date(2025, 9, 29)
    return [old.Session(start + timedelta(days=i), 100 * math.exp(i / 3000), .009, runup=.011, market_calendar=calendar)
            for i in range(n) if live.session_day(start + timedelta(days=i), calendar)]


def candidate(lookback, first, spacing, costs):
    return old.CandidateResult(lookback, first, spacing, costs, [1.0] * len(costs), 0.0)


class SelectionTests(unittest.TestCase):
    def test_shared_market_volatility_cannot_protect_a_consistently_worse_prior(self):
        market = [(-1) ** i * 800 for i in range(26)]
        best = candidate(20, .003, .008, market)
        prior = candidate(20, .0025, .008, [x + 10 for x in market])
        self.assertGreater(best.stderr_bps, 100)
        chosen, _, band, _ = live.select_scored([prior, best], (20, .0025, .008))
        self.assertIs(chosen, best)
        self.assertEqual(len(band), 1)
        self.assertEqual(live.paired_stats(prior, best), (10, 0, .25))

    def test_uncertain_small_difference_retains_prior(self):
        best = candidate(20, .003, .008, [0.0] * 26)
        prior = candidate(20, .0025, .008, [(-1) ** i * 10 + .1 for i in range(26)])
        chosen, _, _, _ = live.select_scored([prior, best], (20, .0025, .008))
        self.assertIs(chosen, prior)

    def test_first_fit_has_no_implicit_btc_seed(self):
        seed = candidate(20, .0025, .008, [.1] * 26)
        best = candidate(15, .003, .009, [0.0] * 26)
        self.assertIs(live.select_scored([seed, best], None)[0], best)
        self.assertIs(live.select_scored([seed, best], (17, .0027, .0087))[0], best)

    def test_paired_band_invariant_to_identical_weekly_market_component(self):
        a = candidate(20, .003, .008, [i % 4 for i in range(26)])
        b = candidate(20, .0025, .008, [i % 3 for i in range(26)])
        before = live.paired_stats(a, b)
        a.costs_bps = [x + (-1) ** i * 1000 for i, x in enumerate(a.costs_bps)]
        b.costs_bps = [x + (-1) ** i * 1000 for i, x in enumerate(b.costs_bps)]
        self.assertEqual(before, live.paired_stats(a, b))

    def test_all_lookbacks_use_the_same_complete_weeks(self):
        for calendar in ("24X7", "XNYS"):
            data = rows(calendar)
            weeks = live.common_weeks(data)
            self.assertEqual(len(weeks), 26)
            self.assertGreaterEqual(weeks[0][0], 60)
            self.assertLess(weeks[-1][-1] + 1, len(data))
            for lookback in old.LOOKBACKS:
                for side in old.SIDES:
                    result = live.score_candidate(data, weeks, lookback, .0025, .008, side)
                    self.assertEqual(len(result.costs_bps), 26)

    def test_zero_hit_history_is_penalized_not_dropped(self):
        data = [old.Session(x.session_date, x.reference, 0, runup=0, market_calendar=x.market_calendar) for x in rows()]
        weeks = live.common_weeks(data)
        buy = live.score_candidate(data, weeks, 60, .005, .01, "buy")
        sell = live.score_candidate(data, weeks, 60, .005, .01, "sell")
        self.assertEqual(len(buy.costs_bps), 26)
        self.assertEqual(buy.mean_completion, 0)
        self.assertGreater(buy.mean_cost_bps, 0)
        self.assertLess(sell.mean_cost_bps, 0)
        self.assertAlmostEqual(buy.mean_cost_bps, -sell.mean_cost_bps)

    def test_missing_session_fails_closed(self):
        data = rows()
        del data[200]
        with self.assertRaisesRegex(ValueError, "Missing market session"):
            live.common_weeks(data)

    def test_insufficient_common_history_cannot_shrink_window(self):
        with self.assertRaisesRegex(ValueError, "26 common"):
            live.common_weeks(rows(n=220))

    def test_new_selector_version_forces_same_date_refresh(self):
        instrument = {"instrument_id": "TEST", "market_calendar": "24X7"}
        p = {"status": "minute-rolling", "data_as_of": "2026-09-27"}
        bundle = {"schema_version": 3, "instruments": {"TEST": {"sides": {"buy": dict(p), "sell": dict(p)}}}}
        now = datetime(2026, 9, 28, 8, tzinfo=old.ET)
        self.assertTrue(live.needs_refit(bundle, [instrument], now))
        for x in bundle["instruments"]["TEST"]["sides"].values():
            x["selector_version"] = live.SELECTOR_VERSION
        self.assertFalse(live.needs_refit(bundle, [instrument], now))

    def test_both_sides_stop_at_half_day_close_and_missing_minutes_fail(self):
        day = date(2026, 11, 27)
        start = datetime(2026, 11, 27, 9, 35, tzinfo=old.ET)
        bars = [old.MinuteBar(start + timedelta(minutes=i), 99, 100, 101) for i in range(205)]
        bars.append(old.MinuteBar(datetime(2026, 11, 27, 13, 0, tzinfo=old.ET), 50, 100, 150))
        result = live.build_complete_sessions(bars, "XNYS", day, day)
        self.assertAlmostEqual(result[0].drawdown, .01)
        self.assertAlmostEqual(result[0].runup, .01)
        with self.assertRaisesRegex(ValueError, "Incomplete minute"):
            live.build_complete_sessions(bars[1:], "XNYS", day, day)

    def test_calendar_scope_preserves_other_instruments(self):
        registry = old.load_registry(ROOT / "data/execution_instruments.json")
        listed = [x for x in registry["instruments"] if x["market_calendar"] == "XNYS"]
        crypto = next(x for x in registry["instruments"] if x["market_calendar"] == "24X7")
        data = rows("XNYS")
        selected = candidate(20, .0025, .008, [0.0] * 26)
        frozen_now = datetime(2026, 9, 28, 8, tzinfo=old.UTC)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "params.json"
            marker = {"preserve": "calendar not refreshed"}
            output.write_text(json.dumps({"schema_version": 3, "instruments": {crypto["instrument_id"]: marker}}))
            argv = ["live", "--force", "--calendar", "XNYS", "--output", str(output)]
            with patch.object(sys, "argv", argv), patch.object(live, "datetime") as clock, \
                    patch.object(old, "download_bars", return_value=[]), \
                    patch.object(live, "build_complete_sessions", return_value=data), \
                    patch.object(live, "fit", return_value=(selected, {"eligible_candidate_count": 1})):
                clock.now.return_value = frozen_now
                live.main()
            bundle = json.loads(output.read_text())
            self.assertEqual(bundle["instruments"][crypto["instrument_id"]], marker)
            for instrument in listed:
                for side in old.SIDES:
                    self.assertEqual(bundle["instruments"][instrument["instrument_id"]]["sides"][side]["selector_version"], live.SELECTOR_VERSION)

    def test_failure_never_publishes_half_a_bundle(self):
        registry = old.load_registry(ROOT / "data/execution_instruments.json")
        listed = next(x for x in registry["instruments"] if x["market_calendar"] == "XNYS")
        registry["instruments"] = [listed]
        registry["default_instrument_id"] = listed["instrument_id"]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            reg, output, snap = path / "registry.json", path / "params.json", path / "sessions.json"
            reg.write_text(json.dumps(registry)); output.write_text('{"schema_version":3,"instruments":{}}')
            snap.write_text('{"instruments":[]}')
            original = output.read_bytes()
            argv = ["live", "--force", "--registry", str(reg), "--output", str(output), "--input-snapshot", str(snap)]
            with patch.object(sys, "argv", argv), self.assertRaises(ValueError):
                live.main()
            self.assertEqual(output.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
