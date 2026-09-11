#!/usr/bin/env python3
"""Register an owner-submitted execution instrument from a GitHub issue form."""

from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from execution_registry import RegistryError, load_registry, validate_instrument, write_registry
from crypto_execution import crypto_instrument


ARCHIVE_ROOT = "https://data.binance.vision/data/spot/daily/klines"
USER_AGENT = "crypto-cycle-dashboard-instrument-registration/1.0"
ISSUE_TITLE_PREFIX = "[Execution instrument]"

MARKET_CALENDARS = {
    "US equities — NYSE calendar (XNYS)": "XNYS",
}
DATA_SOURCES = {
    "Binance Vision spot archives": "binance_vision",
}


def issue_sections(body: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in body.splitlines():
        if raw_line.startswith("### "):
            current = raw_line[4:].strip()
            sections.setdefault(current, [])
        elif current is not None:
            sections[current].append(raw_line)
    return {name: "\n".join(lines).strip() for name, lines in sections.items()}


def required_section(sections: dict[str, str], name: str) -> str:
    value = sections.get(name, "").strip()
    if not value or value == "_No response_":
        raise RegistryError(f"issue field {name!r} is required")
    return value


def build_instrument_from_issue(body: str) -> dict:
    sections = issue_sections(body)
    market_label = required_section(sections, "Market calendar")
    source_label = required_section(sections, "Minute-data source")
    if market_label not in MARKET_CALENDARS:
        raise RegistryError(f"unsupported Market calendar selection: {market_label!r}")
    if source_label not in DATA_SOURCES:
        raise RegistryError(f"unsupported Minute-data source selection: {source_label!r}")
    try:
        default_reference_price = float(required_section(sections, "Default reference price"))
    except ValueError as exc:
        raise RegistryError("Default reference price must be a positive number") from exc

    return validate_instrument(
        {
            "symbol": required_section(sections, "Execution ticker"),
            "exchange": required_section(sections, "Listing exchange name"),
            "exchange_mic": required_section(sections, "Listing exchange MIC"),
            "name": required_section(sections, "Official instrument name"),
            "asset_class": required_section(sections, "Asset class"),
            "currency": required_section(sections, "Trading currency"),
            "market_calendar": MARKET_CALENDARS[market_label],
            "timezone": "America/New_York",
            "reference_time": "09:35",
            "fill_start_time": "09:36",
            "session_end_time": "16:00",
            "default_reference_price": default_reference_price,
            "scaling_source": {
                "provider": DATA_SOURCES[source_label],
                "symbol": required_section(sections, "Scaling proxy symbol"),
                "interval": "1m",
                "rationale": required_section(sections, "Proxy mapping rationale"),
            },
            "enabled": True,
        }
    )


def validate_owner_issue(event: dict, title_prefix: str = ISSUE_TITLE_PREFIX) -> str:
    issue = event.get("issue") or {}
    repository = event.get("repository") or {}
    owner = (repository.get("owner") or {}).get("login")
    author = (issue.get("user") or {}).get("login")
    title = str(issue.get("title") or "")
    if not owner or author != owner:
        raise RegistryError("only the repository owner may register an execution instrument")
    if not title.startswith(title_prefix):
        raise RegistryError(f"issue title must start with {title_prefix!r}")
    return str(issue.get("body") or "")


def validate_binance_archive(symbol: str, now: datetime | None = None) -> None:
    current = now or datetime.now(timezone.utc)
    errors: list[str] = []

    def fetch_day(day) -> None:
        name = f"{symbol}-1m-{day.isoformat()}.zip"
        url = f"{ARCHIVE_ROOT}/{symbol}/1m/{name}"
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            if not any(item.endswith(".csv") for item in archive.namelist()):
                raise RegistryError(f"{symbol}: archive contains no CSV data")

    recent_found = False
    for days_ago in range(1, 8):
        day = (current - timedelta(days=days_ago)).date()
        try:
            fetch_day(day)
            recent_found = True
            break
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, zipfile.BadZipFile) as exc:
            errors.append(f"{day}: {exc}")
    if not recent_found:
        raise RegistryError(
            f"No recent Binance Vision 1m archive was found for {symbol}. "
            "Check the proxy symbol before registering it. " + "; ".join(errors[-3:])
        )

    # The fitter needs at least 75 complete US sessions. Confirm that the same
    # proxy also existed 150 days ago instead of accepting a brand-new pair
    # that can pass only the recent-file check.
    historical_day = (current - timedelta(days=150)).date()
    try:
        fetch_day(historical_day)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, zipfile.BadZipFile) as exc:
        raise RegistryError(
            f"{symbol} has a recent archive but no 1m archive on {historical_day}; "
            "the rolling fitter requires a longer history."
        ) from exc


def register(event_path: Path, registry_path: Path, check_source: bool = True) -> str:
    try:
        event = json.loads(event_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise RegistryError(f"unable to read GitHub issue event: {exc}") from exc
    body = validate_owner_issue(event)
    sections = issue_sections(body)
    if sections.get("Execution market") == "Binance Spot — 24/7":
        instrument = crypto_instrument(required_section(sections, "Spot pair"), float(required_section(sections, "Default reference price")))
    else:
        instrument = build_instrument_from_issue(body)
    if check_source:
        source = instrument["scaling_source"]
        if source["provider"] == "binance_vision":
            validate_binance_archive(source["symbol"])

    registry = load_registry(registry_path)
    instrument_id = instrument["instrument_id"]
    if any(item["instrument_id"] == instrument_id for item in registry["instruments"]):
        raise RegistryError(f"{instrument_id} is already registered")
    registry["instruments"].append(instrument)
    registry["instruments"].sort(key=lambda item: item["instrument_id"])
    write_registry(registry_path, registry)
    return instrument_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", type=Path, required=True, help="GitHub issue event JSON")
    parser.add_argument(
        "--registry",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "execution_instruments.json",
    )
    parser.add_argument(
        "--skip-source-check",
        action="store_true",
        help="Skip the remote archive check (intended only for local tests)",
    )
    args = parser.parse_args()
    instrument_id = register(args.event, args.registry, not args.skip_source_check)
    print(f"Registered {instrument_id}. It will be fitted by the next scaling run.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"execution instrument registration failed: {exc}", file=sys.stderr)
        raise
