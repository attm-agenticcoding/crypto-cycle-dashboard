import sys
import json
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from prepare_execution_v2 import build_research_sessions, session_day, validate_research_contract
from update_execution_params import MinuteBar


def bars(day, zone, start, end, adverse_after=None):
    first = datetime.fromisoformat(day).replace(tzinfo=ZoneInfo(zone))
    return [MinuteBar(first + timedelta(minutes=m), 90 if adverse_after is None or m < adverse_after else 1,
                      100, 110 if adverse_after is None or m < adverse_after else 1000) for m in range(start, end)]


class ResearchDataTests(unittest.TestCase):
    def test_custom_session_or_provider_requires_explicit_research_support(self):
        registry = json.loads((Path(__file__).resolve().parents[1] / "data/execution_instruments.json").read_text())
        for item in registry["instruments"]:
            validate_research_contract(item)
            with self.assertRaises(ValueError):
                validate_research_contract({**item, "reference_time": "09:00"})
            with self.assertRaises(ValueError):
                validate_research_contract({**item, "scaling_source": {**item["scaling_source"], "provider": "unverified"}})

    def test_half_day_applies_to_both_sides(self):
        day = date(2025, 11, 28)
        data = build_research_sessions(bars(str(day), "America/New_York", 575, 960, 780), "XNYS", day, day)
        row = data["sessions"][0]
        self.assertEqual(row["close_minutes"], 780)
        self.assertEqual(row["minute_count"], 204)
        self.assertEqual(row["low"], 90)
        self.assertEqual(row["high"], 110)

    def test_missing_minute_rejects_session_for_every_candidate(self):
        day = date(2026, 6, 22)
        sample = bars(str(day), "America/New_York", 575, 960)
        del sample[25]
        data = build_research_sessions(sample, "XNYS", day, day)
        self.assertFalse(data["sessions"])
        self.assertEqual(data["quality"]["rejected_sessions"][0]["missing_minutes"], 1)

    def test_closeout_reference_is_known_before_closeout(self):
        day = date(2026, 6, 22)
        sample = bars(str(day), "America/New_York", 575, 960)
        sample[945 - 575] = MinuteBar(sample[945 - 575].opened_at, 90, 109, 110)
        row = build_research_sessions(sample, "XNYS", day, day)["sessions"][0]
        self.assertEqual(row["closeout_reference"], 100)  # 15:44, not 15:45

    def test_crypto_includes_weekends_and_excludes_anchor_extremes(self):
        day = date(2026, 6, 21)
        sample = bars(str(day), "UTC", 0, 1440)
        sample[0] = MinuteBar(sample[0].opened_at, 1, 100, 1000)
        row = build_research_sessions(sample, "24X7", day, day)["sessions"][0]
        self.assertEqual(row["low"], 90)
        self.assertEqual(row["high"], 110)
        self.assertEqual(row["minute_count"], 1439)
        self.assertIsNone(row["next_reference"])

    def test_holidays_extraordinary_closure_and_bounded_calendar(self):
        for day in [date(2025, 1, 9), date(2026, 7, 3), date(2026, 9, 7)]:
            self.assertFalse(session_day(day, "XNYS"))
            self.assertTrue(session_day(day, "24X7"))
        with self.assertRaises(ValueError):
            session_day(date(2027, 1, 4), "XNYS")

    def test_missing_next_expected_session_does_not_jump_to_later_price(self):
        sample = bars("2026-06-22", "America/New_York", 575, 960) + bars("2026-06-24", "America/New_York", 575, 960)
        data = build_research_sessions(sample, "XNYS", date(2026, 6, 22), date(2026, 6, 24))
        self.assertIsNone(data["sessions"][0]["next_reference"])
        self.assertFalse(data["weeks"])


if __name__ == "__main__":
    unittest.main()
