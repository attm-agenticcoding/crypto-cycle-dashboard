#!/usr/bin/env python3
"""Fit real 24/7 data in isolation; never alter the production registry/bundle."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from crypto_execution import crypto_instrument
from execution_registry import write_registry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    # Convenience reference only; fitting uses actual minute closes, not this price.
    item = crypto_instrument("BTCUSDT", 100000)
    with tempfile.TemporaryDirectory(prefix="crypto-validation-") as temporary:
        folder = Path(temporary)
        registry, output = folder / "registry.json", folder / "params.json"
        write_registry(registry, {"schema_version": 1, "default_instrument_id": item["instrument_id"], "instruments": [item]})
        subprocess.run([sys.executable, str(Path(__file__).with_name("update_execution_params.py")), "--force", "--calendar", "24X7", "--registry", str(registry), "--output", str(output)], check=True)
        fitted = json.loads(output.read_text())["instruments"][item["instrument_id"]]
    fields = ("trade_side", "data_as_of", "lookback_sessions", "lookback_unit", "first_offset_pct", "spacing_pct", "expected_rungs_per_session", "sample_sessions", "walk_forward_weeks", "walk_forward_mean_implementation_shortfall_bps", "walk_forward_stderr_bps", "walk_forward_mean_passive_completion")
    sides = {}
    for side in ("buy", "sell"):
        values = fitted["sides"][side]
        weekends = sum(date.fromisoformat(sample["date"]).weekday() >= 5 for sample in values["session_samples"])
        if values["market_calendar"] != "24X7" or values["timezone"] != "UTC" or weekends < 20:
            raise RuntimeError("The 24/7 fit did not include enough UTC weekend observations")
        sides[side] = {**{field: values[field] for field in fields}, "recent_weekend_samples": weekends}
    report = {
        "validation": "isolated-real-data-24x7", "production_registry_modified": False,
        "instrument_id": item["instrument_id"], "generated_at": fitted["generated_at"],
        "reference_time": fitted["reference_time"], "fill_start_time": fitted["fill_start_time"],
        "session_end_time": fitted["session_end_time"], "timezone": fitted["timezone"],
        "price_tick": fitted["price_tick"], "quantity_step": fitted["quantity_step"],
        "min_notional": fitted["min_notional"], "sides": sides,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
