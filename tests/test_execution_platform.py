from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date, datetime
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


class RegistryTests(unittest.TestCase):
    def test_checked_in_registry_is_valid(self) -> None:
        registry = load_registry(ROOT / "data" / "execution_instruments.json")
        self.assertEqual(registry["default_instrument_id"], "ARCX:BTC")
        self.assertEqual(registry["instruments"][0]["scaling_source"]["symbol"], "BTCUSDT")

    def test_duplicate_instrument_ids_are_rejected(self) -> None:
        item = load_registry(ROOT / "data" / "execution_instruments.json")["instruments"][0]
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
        original = json.loads((ROOT / "data" / "execution_instruments.json").read_text())
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
        original = load_registry(ROOT / "data" / "execution_instruments.json")
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
                    load_registry(ROOT / "data" / "execution_instruments.json"),
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
        self.instrument = load_registry(ROOT / "data" / "execution_instruments.json")["instruments"][0]

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
        self.assertFalse(should_run(False, payload, [self.instrument], now_et))
        prior = previous_parameters(payload, "ARCX:BTC")
        self.assertIsNotNone(prior)
        self.assertEqual(prior[0], 15)
        self.assertAlmostEqual(prior[1], 0.002)
        self.assertAlmostEqual(prior[2], 0.007)
        self.assertEqual(instruments_needing_update(payload, [self.instrument], date(2026, 9, 10)), ["ARCX:BTC"])

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
            Session(date(2026, 7, 1) if index == 0 else date(2026, 9, 30), 100 + index, 0.01, 0.001)
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
                updater, "choose_candidate", return_value=selected
            ):
                self.assertEqual(updater.main(), 0)
            bundle = json.loads(output_path.read_text())
            self.assertEqual(set(bundle["instruments"]), {"ARCX:BTC", "XNAS:IBIT"})
            self.assertEqual(download.call_count, 1)


if __name__ == "__main__":
    unittest.main()
