from __future__ import annotations

import json
import io
import sys
import tempfile
import unittest
import zipfile
from datetime import date, datetime, timedelta, time
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from execution_registry import RegistryError, load_registry, validate_registry, write_registry  # noqa: E402
from register_execution_instrument import (  # noqa: E402
    build_instrument_from_issue,
    register,
    validate_owner_issue,
)
from remove_execution_instrument import remove, remove_from_registry  # noqa: E402
import update_execution_params as updater  # noqa: E402
from update_execution_params import (  # noqa: E402
    CandidateResult,
    Session,
    build_payload,
    instruments_needing_update,
    previous_parameters,
    should_run,
)


ISSUE_BODY = """### Execution ticker
IBIT

### Listing exchange name
Nasdaq

### Listing exchange MIC
XNAS

### Official instrument name
iShares Bitcoin Trust ETF

### Asset class
ETF

### Trading currency
USD

### Default reference price
52.75

### Market calendar
US equities — NYSE calendar (XNYS)

### Minute-data source
Binance Vision spot archives

### Scaling proxy symbol
BTCUSDT

### Proxy mapping rationale
The ETF holds spot Bitcoin, so BTCUSDT represents its intraday exposure.

### Mapping confirmation
- [x] I verified the mapping.
"""


def base_registry() -> dict:
    item = build_instrument_from_issue(ISSUE_BODY)
    item.update(instrument_id="ARCX:BTC", symbol="BTC", exchange="NYSE Arca", exchange_mic="ARCX", name="Grayscale Bitcoin Mini Trust ETF", default_reference_price=35)
    return {"schema_version": 1, "default_instrument_id": "ARCX:BTC", "instruments": [item]}


class RegistryTests(unittest.TestCase):
    def test_checked_in_registry_is_valid(self) -> None:
        registry = load_registry(ROOT / "data" / "execution_instruments.json")
        self.assertIn(registry["default_instrument_id"], [item["instrument_id"] for item in registry["instruments"] if item["enabled"]])

    def test_duplicate_instrument_ids_are_rejected(self) -> None:
        item = base_registry()["instruments"][0]
        with self.assertRaisesRegex(RegistryError, "duplicate"):
            validate_registry(
                {
                    "schema_version": 1,
                    "default_instrument_id": item["instrument_id"],
                    "instruments": [item, item],
                }
            )


class RegistrationTests(unittest.TestCase):
    def test_issue_fields_create_unambiguous_identity(self) -> None:
        instrument = build_instrument_from_issue(ISSUE_BODY)
        self.assertEqual(instrument["instrument_id"], "XNAS:IBIT")
        self.assertEqual(instrument["name"], "iShares Bitcoin Trust ETF")
        self.assertEqual(instrument["scaling_source"]["symbol"], "BTCUSDT")
        self.assertEqual(instrument["default_reference_price"], 52.75)

    def test_only_repository_owner_is_accepted(self) -> None:
        event = {
            "repository": {"owner": {"login": "attm-agenticcoding"}},
            "issue": {
                "user": {"login": "someone-else"},
                "title": "[Execution instrument] IBIT",
                "body": ISSUE_BODY,
            },
        }
        with self.assertRaisesRegex(RegistryError, "only the repository owner"):
            validate_owner_issue(event)

    def test_owner_issue_is_written_to_registry(self) -> None:
        event = {
            "repository": {"owner": {"login": "attm-agenticcoding"}},
            "issue": {
                "user": {"login": "attm-agenticcoding"},
                "title": "[Execution instrument] IBIT",
                "body": ISSUE_BODY,
            },
        }
        original = base_registry()
        with tempfile.TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "event.json"
            registry_path = Path(temp_dir) / "registry.json"
            event_path.write_text(json.dumps(event), encoding="utf-8")
            registry_path.write_text(json.dumps(original), encoding="utf-8")
            self.assertEqual(register(event_path, registry_path, check_source=False), "XNAS:IBIT")
            registered = load_registry(registry_path)
            self.assertEqual(
                [item["instrument_id"] for item in registered["instruments"]],
                ["ARCX:BTC", "XNAS:IBIT"],
            )


class RemovalTests(unittest.TestCase):
    def two_instrument_registry(self) -> dict:
        original = base_registry()
        return {
            "schema_version": 1,
            "default_instrument_id": "ARCX:BTC",
            "instruments": [original["instruments"][0], build_instrument_from_issue(ISSUE_BODY)],
        }

    def test_non_default_instrument_is_removed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            write_registry(registry_path, self.two_instrument_registry())
            removed, default_id = remove_from_registry(registry_path, " xnas : ibit ")
            self.assertEqual(removed, "XNAS:IBIT")
            self.assertEqual(default_id, "ARCX:BTC")
            self.assertEqual(
                [item["instrument_id"] for item in load_registry(registry_path)["instruments"]],
                ["ARCX:BTC"],
            )

    def test_removing_default_chooses_remaining_instrument(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            write_registry(registry_path, self.two_instrument_registry())
            removed, default_id = remove_from_registry(registry_path, "ARCX:BTC")
            self.assertEqual(removed, "ARCX:BTC")
            self.assertEqual(default_id, "XNAS:IBIT")
            self.assertEqual(load_registry(registry_path)["default_instrument_id"], "XNAS:IBIT")

    def test_final_enabled_instrument_cannot_be_removed(self) -> None:
        with self.assertRaisesRegex(RegistryError, "final enabled"):
            with tempfile.TemporaryDirectory() as temp_dir:
                registry_path = Path(temp_dir) / "registry.json"
                write_registry(
                    registry_path,
                    base_registry(),
                )
                remove_from_registry(registry_path, "ARCX:BTC")

    def test_owner_removal_issue_is_applied(self) -> None:
        event = {
            "repository": {"owner": {"login": "attm-agenticcoding"}},
            "issue": {
                "user": {"login": "attm-agenticcoding"},
                "title": "[Remove execution instrument] XNAS:IBIT",
                "body": "### Instrument ID\nXNAS:IBIT\n\n### Replacement default instrument ID\n_No response_\n",
            },
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            event_path = Path(temp_dir) / "event.json"
            registry_path = Path(temp_dir) / "registry.json"
            event_path.write_text(json.dumps(event), encoding="utf-8")
            write_registry(registry_path, self.two_instrument_registry())
            self.assertEqual(remove(event_path, registry_path), ("XNAS:IBIT", "ARCX:BTC"))


class UpdaterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instrument = base_registry()["instruments"][0]

    def test_v2_bundle_freshness_and_prior(self) -> None:
        payload = {
            "schema_version": 2,
            "instruments": {
                "ARCX:BTC": {
                    "status": "minute-rolling",
                    "data_as_of": "2026-09-09",
                    "lookback_sessions": 15,
                    "first_offset_pct": 0.2,
                    "spacing_pct": 0.7,
                }
            },
        }
        now_et = datetime(2026, 9, 10, 9, 0, tzinfo=ZoneInfo("America/New_York"))
        # A fresh legacy BUY bundle must still run once to obtain SELL scaling.
        self.assertTrue(should_run(False, payload, [self.instrument], now_et))
        prior = previous_parameters(payload, "ARCX:BTC")
        self.assertIsNotNone(prior)
        self.assertEqual(prior[0], 15)
        self.assertAlmostEqual(prior[1], 0.002)
        self.assertAlmostEqual(prior[2], 0.007)
        self.assertIsNone(previous_parameters(payload, "ARCX:BTC", "sell"))
        self.assertEqual(instruments_needing_update(payload, [self.instrument], date(2026, 9, 10)), ["ARCX:BTC"])

        buy = payload["instruments"]["ARCX:BTC"]
        sell = {**buy, "first_offset_pct": 0.4}
        payload["instruments"]["ARCX:BTC"] = {**buy, "sides": {"buy": buy, "sell": sell}}
        self.assertFalse(should_run(False, payload, [self.instrument], now_et))
        self.assertAlmostEqual(previous_parameters(payload, "ARCX:BTC", "sell")[1], 0.004)
        sell["data_as_of"] = "2026-09-08"
        self.assertTrue(should_run(False, payload, [self.instrument], now_et))

    def test_payload_carries_instrument_and_proxy(self) -> None:
        sessions = [
            Session(date(2026, 8, day), 100 + day, 0.01, 0.001)
            for day in range(1, 12)
        ]
        selected = CandidateResult(10, 0.0025, 0.008, [1.0, 2.0], [0.9, 1.0], 0.2)
        payload = build_payload(self.instrument, sessions, selected, "2026-09-10T12:00:00Z")
        self.assertEqual(payload["instrument_id"], "ARCX:BTC")
        self.assertEqual(payload["market_proxy"], "BTCUSDT")
        self.assertEqual(payload["default_reference_price"], 35)

    def test_forced_run_fits_every_instrument_and_reuses_shared_proxy(self) -> None:
        second = build_instrument_from_issue(ISSUE_BODY)
        registry = {
            "schema_version": 1,
            "default_instrument_id": "ARCX:BTC",
            "instruments": [self.instrument, second],
        }
        sessions = [
            Session(date(2026, 7, 1) if index == 0 else date(2026, 9, 30), 100 + index, 0.01, 0.001, runup=0.02)
            for index in range(80)
        ]
        selected = CandidateResult(10, 0.0025, 0.008, [1.0, 2.0], [0.9, 1.0], 0.2)
        with tempfile.TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            output_path = Path(temp_dir) / "params.json"
            write_registry(registry_path, registry)
            argv = [
                "update_execution_params.py",
                "--force",
                "--registry",
                str(registry_path),
                "--output",
                str(output_path),
            ]
            with patch.object(sys, "argv", argv), patch.object(
                updater, "download_bars", return_value=[]
            ) as download, patch.object(updater, "build_sessions", return_value=sessions), patch.object(
                updater, "choose_candidate", side_effect=[selected, CandidateResult(15, .004, .006, [3., 4.], [.8, .9], .3)]
            ) as choose:
                self.assertEqual(updater.main(), 0)
            bundle = json.loads(output_path.read_text())
            self.assertEqual(set(bundle["instruments"]), {"ARCX:BTC", "XNAS:IBIT"})
            self.assertEqual(download.call_count, 1)
            self.assertEqual(choose.call_count, 2)
            self.assertEqual({call.args[2] for call in choose.call_args_list}, {"buy", "sell"})
            for item in bundle["instruments"].values():
                self.assertEqual(set(item["sides"]), {"buy", "sell"})
                self.assertEqual(item["sides"]["sell"]["first_offset_pct"], .4)
                self.assertEqual(item["sides"]["buy"]["first_offset_pct"], .25)


class SellFittingTests(unittest.TestCase):
    def test_archive_high_and_reference_exclusion(self) -> None:
        raw = io.BytesIO()
        stamp = int(datetime(2026, 9, 10, 13, 35, tzinfo=updater.UTC).timestamp() * 1_000_000)
        with zipfile.ZipFile(raw, "w") as archive:
            archive.writestr("sample.csv", f"{stamp},99,103,98,100,20\n")
        parsed = updater.parse_zip(raw.getvalue())[0]
        self.assertEqual((parsed.low, parsed.close, parsed.high), (98, 100, 103))
        bars = [updater.MinuteBar(parsed.opened_at, 1, 100, 900)]
        bars += [updater.MinuteBar(parsed.opened_at + timedelta(minutes=i), 99, 100, 102) for i in range(1, 385)]
        sessions = updater.build_sessions(bars)
        self.assertAlmostEqual(sessions[0].drawdown, .01)
        self.assertAlmostEqual(sessions[0].runup, .02)
        self.assertIsNone(sessions[0].next_reference_return)

    def test_half_day_sell_highs_stop_at_core_close(self) -> None:
        start = datetime(2026, 11, 27, 9, 35, tzinfo=updater.ET)
        bars = [updater.MinuteBar(start, 100, 100, 100)]
        bars += [updater.MinuteBar(start + timedelta(minutes=i), 99, 100, 102 if i < 205 else 500) for i in range(1, 385)]
        self.assertAlmostEqual(updater.build_sessions(bars)[0].runup, .02)
        self.assertEqual(updater.sell_session_end(date(2026, 11, 27)), time(13))

    def test_sell_cannot_use_buy_drawdowns_as_highs(self) -> None:
        with self.assertRaisesRegex(ValueError, "minute highs"):
            updater.excursion(Session(date(2026, 9, 10), 100, .04), "sell")

    def test_shortfall_sign_and_penalty_for_unfilled_declining_inventory(self) -> None:
        days = [date(2026, 2, 2) + timedelta(days=i) for i in range(75)]
        days = [day for day in days if updater.is_market_session_day(day)]
        sessions = [Session(day, 100, .004, runup=.004) for day in days]
        buy = updater.evaluate_candidate(sessions, 10, .0025, .008, "buy")
        sell = updater.evaluate_candidate(sessions, 10, .0025, .008, "sell")
        self.assertAlmostEqual(buy.mean_cost_bps, -25)
        self.assertAlmostEqual(sell.mean_cost_bps, -25)
        declining = [Session(day, 100 - i * .8, .01, runup=.004 if i % 5 == 0 else 0) for i, day in enumerate(days)]
        result = updater.evaluate_candidate(declining, 10, .0025, .008, "sell")
        self.assertGreater(result.mean_cost_bps, 0)
        self.assertGreater(result.zero_fill_rate, .5)


if __name__ == "__main__":
    unittest.main()
