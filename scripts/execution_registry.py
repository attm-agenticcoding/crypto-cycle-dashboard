#!/usr/bin/env python3
"""Validation helpers for the execution-instrument registry."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


SUPPORTED_PROVIDERS = {"binance_vision"}
SUPPORTED_MARKET_CALENDARS = {"XNYS"}
SUPPORTED_TIMEZONES = {"America/New_York"}


class RegistryError(ValueError):
    """Raised when an execution-instrument registry is invalid."""


def _required_text(value: Any, field: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise RegistryError(f"{field} must be text")
    cleaned = " ".join(value.split())
    if not cleaned:
        raise RegistryError(f"{field} is required")
    if len(cleaned) > maximum:
        raise RegistryError(f"{field} must be at most {maximum} characters")
    return cleaned


def _code(value: Any, field: str, pattern: str, maximum: int) -> str:
    cleaned = _required_text(value, field, maximum).upper()
    if not re.fullmatch(pattern, cleaned):
        raise RegistryError(f"{field} has an invalid format: {cleaned!r}")
    return cleaned


def _clock(value: Any, field: str) -> str:
    cleaned = _required_text(value, field, 5)
    match = re.fullmatch(r"([01][0-9]|2[0-3]):([0-5][0-9])", cleaned)
    if not match:
        raise RegistryError(f"{field} must use 24-hour HH:MM format")
    return cleaned


def validate_instrument(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RegistryError("each instrument must be an object")

    symbol = _code(raw.get("symbol"), "symbol", r"[A-Z0-9][A-Z0-9.\-]{0,14}", 15)
    exchange_mic = _code(raw.get("exchange_mic"), "exchange_mic", r"[A-Z0-9]{4}", 4)
    expected_id = f"{exchange_mic}:{symbol}"
    supplied_id = _required_text(raw.get("instrument_id", expected_id), "instrument_id", 32).upper()
    if supplied_id != expected_id:
        raise RegistryError(f"instrument_id must be {expected_id!r}")

    source = raw.get("scaling_source")
    if not isinstance(source, dict):
        raise RegistryError(f"{expected_id}: scaling_source must be an object")
    provider = _required_text(source.get("provider"), "scaling_source.provider", 32).lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise RegistryError(
            f"{expected_id}: unsupported scaling provider {provider!r}; "
            f"supported providers: {', '.join(sorted(SUPPORTED_PROVIDERS))}"
        )
    proxy_symbol = _code(
        source.get("symbol"), "scaling_source.symbol", r"[A-Z0-9][A-Z0-9._\-]{1,24}", 25
    )
    interval = _required_text(source.get("interval", "1m"), "scaling_source.interval", 8)
    if interval != "1m":
        raise RegistryError(f"{expected_id}: only 1m scaling data is currently supported")
    rationale = _required_text(source.get("rationale"), "scaling_source.rationale", 280)

    market_calendar = _required_text(raw.get("market_calendar"), "market_calendar", 12).upper()
    if market_calendar not in SUPPORTED_MARKET_CALENDARS:
        raise RegistryError(
            f"{expected_id}: unsupported market calendar {market_calendar!r}; "
            f"supported calendars: {', '.join(sorted(SUPPORTED_MARKET_CALENDARS))}"
        )
    timezone = _required_text(raw.get("timezone"), "timezone", 64)
    if timezone not in SUPPORTED_TIMEZONES:
        raise RegistryError(f"{expected_id}: unsupported timezone {timezone!r}")

    try:
        default_reference_price = float(raw.get("default_reference_price"))
    except (TypeError, ValueError) as exc:
        raise RegistryError(f"{expected_id}: default_reference_price must be a number") from exc
    if not (0 < default_reference_price < 10_000_000):
        raise RegistryError(f"{expected_id}: default_reference_price must be positive")

    reference_time = _clock(raw.get("reference_time"), "reference_time")
    fill_start_time = _clock(raw.get("fill_start_time"), "fill_start_time")
    session_end_time = _clock(raw.get("session_end_time"), "session_end_time")
    if not reference_time < fill_start_time < session_end_time:
        raise RegistryError(
            f"{expected_id}: times must satisfy reference_time < fill_start_time < session_end_time"
        )

    return {
        "instrument_id": expected_id,
        "symbol": symbol,
        "exchange": _required_text(raw.get("exchange"), "exchange", 80),
        "exchange_mic": exchange_mic,
        "name": _required_text(raw.get("name"), "name", 140),
        "asset_class": _required_text(raw.get("asset_class"), "asset_class", 40),
        "currency": _code(raw.get("currency"), "currency", r"[A-Z]{3}", 3),
        "market_calendar": market_calendar,
        "timezone": timezone,
        "reference_time": reference_time,
        "fill_start_time": fill_start_time,
        "session_end_time": session_end_time,
        "default_reference_price": round(default_reference_price, 8),
        "scaling_source": {
            "provider": provider,
            "symbol": proxy_symbol,
            "interval": interval,
            "rationale": rationale,
        },
        "enabled": bool(raw.get("enabled", True)),
    }


def validate_registry(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RegistryError("registry must be an object")
    if int(raw.get("schema_version", 0)) != 1:
        raise RegistryError("registry schema_version must be 1")

    raw_instruments = raw.get("instruments")
    if not isinstance(raw_instruments, list) or not raw_instruments:
        raise RegistryError("registry must contain at least one instrument")
    instruments = [validate_instrument(item) for item in raw_instruments]
    ids = [item["instrument_id"] for item in instruments]
    if len(ids) != len(set(ids)):
        raise RegistryError("registry contains duplicate instrument_id values")

    default_id = _required_text(raw.get("default_instrument_id"), "default_instrument_id", 32).upper()
    if default_id not in ids:
        raise RegistryError("default_instrument_id must identify a registered instrument")
    if not next(item for item in instruments if item["instrument_id"] == default_id)["enabled"]:
        raise RegistryError("default_instrument_id must identify an enabled instrument")
    if not any(item["enabled"] for item in instruments):
        raise RegistryError("registry must contain at least one enabled instrument")

    return {
        "schema_version": 1,
        "default_instrument_id": default_id,
        "instruments": instruments,
    }


def load_registry(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RegistryError(f"registry not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RegistryError(f"registry is not valid JSON: {exc}") from exc
    return validate_registry(raw)


def write_registry(path: Path, registry: dict[str, Any]) -> None:
    normalized = validate_registry(registry)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")
