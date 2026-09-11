#!/usr/bin/env python3
"""Remove an owner-selected execution instrument from the registry."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from execution_registry import RegistryError, load_registry, write_registry
from register_execution_instrument import issue_sections, required_section, validate_owner_issue


ISSUE_TITLE_PREFIX = "[Remove execution instrument]"
INSTRUMENT_ID_PATTERN = re.compile(r"(?:[A-Z0-9]{4}:[A-Z0-9][A-Z0-9.\-]{0,24}|BINANCE:SPOT:[A-Z0-9]{2,25})")


def normalize_instrument_id(value: str, field: str = "Instrument ID") -> str:
    normalized = "".join(value.split()).upper()
    if not INSTRUMENT_ID_PATTERN.fullmatch(normalized):
        raise RegistryError(
            f"{field} must use EXCHANGE_MIC:TICKER or BINANCE:SPOT:PAIR format"
        )
    return normalized


def remove_from_registry(
    registry_path: Path, instrument_id: str, replacement_default: str | None = None
) -> tuple[str, str]:
    registry = load_registry(registry_path)
    target_id = normalize_instrument_id(instrument_id)
    instruments = registry["instruments"]
    if not any(item["instrument_id"] == target_id for item in instruments):
        raise RegistryError(f"{target_id} is not registered")

    remaining = [item for item in instruments if item["instrument_id"] != target_id]
    enabled_remaining = sorted(
        (item for item in remaining if item["enabled"]), key=lambda item: item["instrument_id"]
    )
    if not enabled_remaining:
        raise RegistryError("the final enabled execution instrument cannot be removed")

    new_default = registry["default_instrument_id"]
    if new_default == target_id:
        if replacement_default and replacement_default.strip() not in {"", "_No response_"}:
            requested_default = normalize_instrument_id(
                replacement_default, "Replacement default instrument ID"
            )
            if not any(
                item["instrument_id"] == requested_default and item["enabled"]
                for item in remaining
            ):
                raise RegistryError(
                    "Replacement default instrument ID must identify another enabled instrument"
                )
            new_default = requested_default
        else:
            new_default = enabled_remaining[0]["instrument_id"]

    registry["default_instrument_id"] = new_default
    registry["instruments"] = remaining
    write_registry(registry_path, registry)
    return target_id, new_default


def remove(event_path: Path, registry_path: Path) -> tuple[str, str]:
    try:
        event = json.loads(event_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise RegistryError(f"unable to read GitHub issue event: {exc}") from exc
    body = validate_owner_issue(event, ISSUE_TITLE_PREFIX)
    sections = issue_sections(body)
    instrument_id = required_section(sections, "Instrument ID")
    replacement_default = sections.get("Replacement default instrument ID")
    return remove_from_registry(registry_path, instrument_id, replacement_default)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", type=Path, required=True, help="GitHub issue event JSON")
    parser.add_argument(
        "--registry",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "execution_instruments.json",
    )
    args = parser.parse_args()
    removed_id, default_id = remove(args.event, args.registry)
    print(f"Removed {removed_id}. Default execution instrument is {default_id}.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"execution instrument removal failed: {exc}", file=sys.stderr)
        raise
