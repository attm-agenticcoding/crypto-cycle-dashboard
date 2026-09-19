#!/usr/bin/env python3
"""Build immutable, auditable research sessions; never writes production data.

Only standard-library dependencies. Archives are cached with SHA-256 provenance.
Missing minutes reject a session for every candidate, not just poor performers.
Calendar scope is deliberately bounded to verified 2025/2026 NYSE calendars.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from execution_registry import load_registry
from update_execution_params import (
    ARCHIVE_ROOT, is_market_session_day, month_sequence, parse_zip,
    request_bytes, sell_session_end,
)

ROOT = Path(__file__).resolve().parents[1]
CALENDAR_SOURCES = [
    "https://www.nyse.com/trade/hours-calendars",
    "https://www.nyse.com/publicdocs/ICE_NYSE_2025_Yearly_Trading_Calendar.pdf",
    "https://ir.theice.com/press/news-details/2024/The-New-York-Stock-Exchange-Will-Close-Markets-on-January-9-to-Honor-the-Passing-of-Former-President-Jimmy-Carter-on-National-Day-of-Mourning/default.aspx",
]


def validate_research_contract(instrument: dict) -> None:
    expected = (("UTC", "00:00", "00:01", "24:00") if instrument["market_calendar"] == "24X7"
                else ("America/New_York", "09:35", "09:36", "16:00"))
    actual = tuple(instrument[key] for key in ("timezone", "reference_time", "fill_start_time", "session_end_time"))
    source = instrument["scaling_source"]
    if actual != expected or source["provider"] != "binance_vision" or source["interval"] != "1m":
        raise ValueError(f"Unsupported research data/session contract for {instrument['instrument_id']}; do not silently substitute a different window")


def session_day(day: date, market: str) -> bool:
    if market == "24X7":
        return True
    if market != "XNYS" or day.year not in (2025, 2026):
        raise ValueError("Research NYSE calendar is verified only for 2025/2026")
    return is_market_session_day(day) and day != date(2025, 1, 9)


def next_session(day: date, market: str) -> date:
    day += timedelta(days=1)
    while not session_day(day, market):
        day += timedelta(days=1)
    return day


def minute_number(value: time) -> int:
    return value.hour * 60 + value.minute


def build_research_sessions(bars, market: str, start: date, end: date):
    zone = ZoneInfo("UTC" if market == "24X7" else "America/New_York")
    by_day = defaultdict(dict)
    duplicates = 0
    for bar in bars:
        local = bar.opened_at.astimezone(zone)
        if not start <= local.date() <= end or not session_day(local.date(), market):
            continue
        minute = local.hour * 60 + local.minute
        if minute in by_day[local.date()]:
            duplicates += 1
            if by_day[local.date()][minute] != bar:
                raise ValueError(f"Conflicting minute bars: {local}")
        by_day[local.date()][minute] = bar
    sessions, rejected = [], []
    day = start
    while day <= end:
        if not session_day(day, market):
            day += timedelta(days=1)
            continue
        ref_minute = 0 if market == "24X7" else 9 * 60 + 35
        close = 1440 if market == "24X7" else minute_number(sell_session_end(day))
        minute_map = by_day.get(day, {})
        required = set(range(ref_minute, close))
        missing = sorted(required - minute_map.keys())
        if missing:
            rejected.append({"date": day.isoformat(), "missing_minutes": len(missing)})
            day += timedelta(days=1)
            continue
        eligible = [minute_map[m] for m in range(ref_minute + 1, close)]
        if any(b.high is None or not (0 < b.low <= b.close <= b.high) for b in eligible):
            raise ValueError(f"Invalid OHLC on {day}")
        reference = minute_map[ref_minute].close
        pre_closeout = [minute_map[m] for m in range(ref_minute + 1, close - 15)]
        sessions.append({
            "date": day.isoformat(), "reference": reference,
            "low": min(b.low for b in eligible), "high": max(b.high for b in eligible),
            "pre_closeout_low": min(b.low for b in pre_closeout),
            "pre_closeout_high": max(b.high for b in pre_closeout),
            # At 15:45, only the 15:44 minute close is known, not 15:45's close.
            "closeout_reference": minute_map[close - 16].close,
            "close_price": minute_map[close - 1].close,
            "close_minutes": close, "minute_count": len(eligible),
            "next_session_date": next_session(day, market).isoformat(),
            "drawdown_pct": max(0, 1 - min(b.low for b in eligible) / reference) * 100,
            "runup_pct": max(0, max(b.high for b in eligible) / reference - 1) * 100,
        })
        day += timedelta(days=1)
    by_date = {row["date"]: row for row in sessions}
    for row in sessions:
        later = by_date.get(row["next_session_date"])
        row["next_reference"] = later["reference"] if later else None
    weeks = defaultdict(list)
    for index, row in enumerate(sessions):
        d = date.fromisoformat(row["date"])
        monday = d - timedelta(days=d.weekday())
        weeks[monday].append(index)
    episodes = []
    for monday, indices in sorted(weeks.items()):
        if monday < start or monday + timedelta(days=6) > end:
            continue
        expected = [(monday + timedelta(days=n)).isoformat() for n in range(7)
                    if session_day(monday + timedelta(days=n), market)]
        actual = [sessions[i]["date"] for i in indices]
        if actual != expected or not sessions[indices[-1]]["next_reference"]:
            continue
        episodes.append({"week": monday.isoformat(), "indices": indices,
                         "terminal_date": sessions[indices[-1]]["next_session_date"]})
    return {"sessions": sessions, "weeks": episodes,
            "quality": {"rejected_sessions": rejected, "duplicate_minutes": duplicates,
                        "accepted_sessions": len(sessions), "complete_weeks": len(episodes)}}


def archive_specs(symbol, start, end):
    # Monthly only after that entire UTC month has completed. Daily otherwise.
    current = datetime.now(timezone.utc).date()
    for year, month in month_sequence(start, end):
        if (year, month) < (current.year, current.month):
            name = f"{symbol}-1m-{year:04d}-{month:02d}.zip"
            yield name, f"{ARCHIVE_ROOT}/monthly/klines/{symbol}/1m/{name}"
        else:
            day = max(start, date(year, month, 1))
            while day <= end and day.month == month:
                name = f"{symbol}-1m-{day.isoformat()}.zip"
                yield name, f"{ARCHIVE_ROOT}/daily/klines/{symbol}/1m/{name}"
                day += timedelta(days=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, default=ROOT / "research/execution-v2-protocol.json")
    parser.add_argument("--cache", type=Path, default=ROOT / ".research/archives")
    parser.add_argument("--output", type=Path, default=ROOT / ".research/sessions.json")
    args = parser.parse_args()
    if not all(p.resolve().is_relative_to(ROOT / ".research") for p in (args.output, args.cache)):
        parser.error("Research output and cache must remain inside the ignored .research/ tree")
    raw_protocol = args.protocol.read_bytes()
    protocol = json.loads(raw_protocol)
    start, end = date.fromisoformat(protocol["start"]), date.fromisoformat(protocol["as_of"])
    registry_raw = (ROOT / "data/execution_instruments.json").read_bytes()
    instruments = [i for i in load_registry(ROOT / "data/execution_instruments.json")["instruments"] if i.get("enabled", True)]
    for instrument in instruments:
        validate_research_contract(instrument)
    args.cache.mkdir(parents=True, exist_ok=True)
    result = {"schema_version": 1, "protocol_sha256": hashlib.sha256(raw_protocol).hexdigest(),
              "registry_sha256": hashlib.sha256(registry_raw).hexdigest(),
              "calendar_sources": CALENDAR_SOURCES, "archives": [], "instruments": []}

    def fetch(spec):
        name, url = spec
        path = args.cache / name
        payload = path.read_bytes() if path.exists() else request_bytes(url, timeout=45)
        bars = parse_zip(payload)  # Validate before caching.
        if not path.exists():
            path.write_bytes(payload)
        return bars, {"name": name, "url": url, "bytes": len(payload),
                      "sha256": hashlib.sha256(payload).hexdigest()}

    for symbol in sorted({i["scaling_source"]["symbol"] for i in instruments}):
        bars = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            for downloaded, manifest in pool.map(fetch, archive_specs(symbol, start, end)):
                bars.extend(b for b in downloaded if start <= b.opened_at.date() <= end)
                result["archives"].append(manifest)
                print(f"Read {manifest['name']}", flush=True)
        bars.sort(key=lambda b: b.opened_at)
        for instrument in instruments:
            if instrument["scaling_source"]["symbol"] != symbol:
                continue
            market = instrument["market_calendar"]
            built = build_research_sessions(bars, market, start, end)
            built["instrument"] = instrument
            built["price_source"] = "direct_spot" if market == "24X7" else "indexed_spot_proxy_NOT_ETF_quotes"
            if market != "24X7":
                factor = instrument["default_reference_price"] / built["sessions"][0]["reference"]
                for row in built["sessions"]:
                    for field in ("reference", "low", "high", "pre_closeout_low", "pre_closeout_high",
                                  "closeout_reference", "close_price", "next_reference"):
                        if row[field] is not None:
                            row[field] *= factor
                built["proxy_index_factor"] = factor
            result["instruments"].append(built)
            print(f"Built {instrument['instrument_id']}: {built['quality']}", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(f"Research-only output: {args.output}")


if __name__ == "__main__":
    main()
