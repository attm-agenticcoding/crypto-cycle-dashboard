from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, time
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from crypto_execution import crypto_instrument
from execution_registry import RegistryError, validate_instrument, write_registry, load_registry
from register_execution_instrument import register
from remove_execution_instrument import remove_from_registry
import update_execution_params as updater
from test_execution_platform import base_registry

EXCHANGE_INFO = {"symbols": [{
    "symbol": "BTCUSDT", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDT",
    "isSpotTradingAllowed": True, "orderTypes": ["LIMIT", "MARKET"],
    "filters": [
        {"filterType": "PRICE_FILTER", "tickSize": "0.01", "minPrice": "0.01", "maxPrice": "1000000"},
        {"filterType": "LOT_SIZE", "stepSize": "0.00001", "minQty": "0.00001", "maxQty": "9000"},
        {"filterType": "NOTIONAL", "minNotional": "5", "maxNotional": "9000000"}
    ]
}]}


def crypto_fixture():
    return crypto_instrument("BTCUSDT", 100000, EXCHANGE_INFO)


class CryptoExecutionTests(unittest.TestCase):
    def test_registry_distinguishes_pair_from_proxy_and_rejects_futures(self):
        item = crypto_fixture()
        self.assertEqual(item["instrument_id"], "BINANCE:SPOT:BTCUSDT")
        self.assertEqual((item["currency"], item["base_asset"], item["quantity_step"]), ("USDT", "BTC", .00001))
        self.assertEqual((item["timezone"], item["session_end_time"]), ("UTC", "24:00"))
        for changes in [{"instrument_type": "crypto_perpetual"}, {"market_calendar": "XNYS"}, {"base_asset": "ETH"}, {"venue_code": "OTHER"}, {"price_tick": 0}]:
            with self.assertRaises(RegistryError):
                validate_instrument({**item, **changes})

    def test_registration_and_removal_use_exact_spot_id(self):
        event = {"repository": {"owner": {"login": "owner"}}, "issue": {"user": {"login": "owner"}, "title": "[Execution instrument] BTCUSDT", "body": "### Execution market\nBinance Spot — 24/7\n\n### Spot pair\nBTCUSDT\n\n### Default reference price\n100000"}}
        with tempfile.TemporaryDirectory() as temp:
            registry, source = Path(temp) / "registry.json", Path(temp) / "event.json"
            write_registry(registry, base_registry())
            source.write_text(json.dumps(event))
            with patch("register_execution_instrument.crypto_instrument", return_value=crypto_fixture()):
                self.assertEqual(register(source, registry, check_source=False), "BINANCE:SPOT:BTCUSDT")
            self.assertEqual(len(load_registry(registry)["instruments"]), 2)
            self.assertEqual(remove_from_registry(registry, "binance:spot:btcusdt")[0], "BINANCE:SPOT:BTCUSDT")

    def test_utc_weekend_cycle_excludes_reference_bar_and_next_midnight(self):
        start = datetime(2026, 9, 12, tzinfo=updater.UTC)
        bars = [updater.MinuteBar(start, 1, 100, 999)]
        bars += [updater.MinuteBar(start + timedelta(minutes=i), 95 if i == 1000 else 99, 100, 107 if i == 1439 else 101) for i in range(1, 1440)]
        bars.append(updater.MinuteBar(start + timedelta(days=1), 1, 100, 1000))
        sessions = updater.build_sessions(bars, time(0), time(0, 1), time.max, "24X7", "UTC")
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0].session_date, date(2026, 9, 12))
        self.assertAlmostEqual(sessions[0].drawdown, .05)
        self.assertAlmostEqual(sessions[0].runup, .07)
        self.assertEqual(updater.build_sessions(bars), [])

    def test_freshness_counts_weekends_and_utc_rollover(self):
        now = datetime(2026, 9, 13, 21, tzinfo=updater.ET) # Monday 01:00 UTC
        self.assertEqual(updater.expected_market_session(now, "24X7"), date(2026, 9, 13))
        self.assertEqual(updater.expected_market_session(now), date(2026, 9, 11))

    def test_calendar_scoped_run_preserves_equity_parameters(self):
        item = crypto_fixture()
        registry = base_registry()
        registry["instruments"].append(item)
        equity = {"instrument_id": "ARCX:BTC", "sentinel": "preserve this payload"}
        sessions = [updater.Session(date(2026, 12, 1), 100, .01, runup=.02, market_calendar="24X7") for _ in range(80)]
        candidate = updater.CandidateResult(10, .0025, .008, [1., 2.], [.9, 1.], .1)
        with tempfile.TemporaryDirectory() as temp:
            rp, out = Path(temp) / "registry.json", Path(temp) / "params.json"
            write_registry(rp, registry)
            out.write_text(json.dumps({"schema_version": 3, "instruments": {"ARCX:BTC": equity}}))
            argv = ["update_execution_params.py", "--force", "--calendar", "24X7", "--registry", str(rp), "--output", str(out)]
            with patch.object(sys, "argv", argv), patch.object(updater, "crypto_instrument", return_value=item), patch.object(updater, "download_bars", return_value=[]), patch.object(updater, "build_sessions", return_value=sessions), patch.object(updater, "choose_candidate", return_value=candidate):
                self.assertEqual(updater.main(), 0)
            payload = json.loads(out.read_text())
            self.assertEqual(payload["instruments"]["ARCX:BTC"], equity)
            crypto = payload["instruments"][item["instrument_id"]]
            self.assertEqual(set(crypto["sides"]), {"buy", "sell"})
            self.assertEqual(crypto["sides"]["buy"]["quantity_step"], .00001)
