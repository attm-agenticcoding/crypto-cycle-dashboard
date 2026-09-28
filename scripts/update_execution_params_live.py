#!/usr/bin/env python3
"""Production selector repair; the original updater remains frozen for shadow.

All candidates use the same 26 completed weeks. The one-SE stability rule uses
paired weekly excess costs, never the market volatility of one candidate.
This is a regularized selection heuristic, not a significance/equivalence test.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import update_execution_params as legacy

SELECTOR_VERSION = "common-week-paired-se-v1"
SCORE_WEEKS = 26
MINIMUM_BAND_BPS = 0.25


def session_day(day: date, calendar: str) -> bool:
    if calendar == "24X7":
        return True
    if calendar != "XNYS":
        raise ValueError("Unsupported market calendar")
    return legacy.is_market_session_day(day) and day != date(2025, 1, 9)


def build_complete_sessions(bars, calendar, start, end):
    """Use every required minute and the actual close for both directions."""
    zone = ZoneInfo("UTC" if calendar == "24X7" else "America/New_York")
    by_day = defaultdict(dict)
    for bar in bars:
        local = bar.opened_at.astimezone(zone)
        if not start <= local.date() <= end or not session_day(local.date(), calendar):
            continue
        minute = local.hour * 60 + local.minute
        prior = by_day[local.date()].get(minute)
        if prior is not None and prior != bar:
            raise ValueError("Conflicting minute bars")
        by_day[local.date()][minute] = bar
    rows = []
    day = start
    while day <= end:
        if session_day(day, calendar):
            reference_minute = 0 if calendar == "24X7" else 9 * 60 + 35
            close_time = legacy.sell_session_end(day)
            close = 1440 if calendar == "24X7" else close_time.hour * 60 + close_time.minute
            minute_map = by_day.get(day, {})
            required = range(reference_minute, close)
            if any(m not in minute_map for m in required):
                raise ValueError(f"Incomplete minute archive on {day}; preserve the last complete bundle")
            for m in required:
                b = minute_map[m]
                if any(x is None or not math.isfinite(x) for x in (b.low, b.close, b.high)) or not 0 < b.low <= b.close <= b.high:
                    raise ValueError(f"Invalid OHLC on {day}")
            reference = minute_map[reference_minute].close
            eligible = [minute_map[m] for m in range(reference_minute + 1, close)]
            rows.append({"date": day.isoformat(), "reference": reference,
                         "drawdown_pct": max(0, 1 - min(b.low for b in eligible) / reference) * 100,
                         "runup_pct": max(0, max(b.high for b in eligible) / reference - 1) * 100})
        day += timedelta(days=1)
    return rows_to_sessions(rows, calendar)


def common_weeks(sessions: list[legacy.Session]) -> list[list[int]]:
    if not sessions:
        raise ValueError("No sessions available")
    calendar = sessions[0].market_calendar
    previous = None
    weeks = defaultdict(list)
    for i, row in enumerate(sessions):
        if row.market_calendar != calendar or (previous is not None and row.session_date <= previous):
            raise ValueError("Sessions must be unique, chronological and use one calendar")
        if not math.isfinite(row.reference) or row.reference <= 0:
            raise ValueError("Invalid reference price")
        for value in (row.drawdown, row.runup):
            if value is None or not math.isfinite(value) or value < 0:
                raise ValueError("Both buy and sell excursions must be complete")
        if previous is not None:
            expected = previous + timedelta(days=1)
            while not session_day(expected, calendar):
                expected += timedelta(days=1)
            if expected != row.session_date:
                raise ValueError(f"Missing market session {expected}; preserve the last complete bundle")
        monday = row.session_date - timedelta(days=row.session_date.weekday())
        weeks[monday].append(i)
        previous = row.session_date
    eligible = []
    for monday, indices in weeks.items():
        expected = [monday + timedelta(days=i) for i in range(7)
                    if session_day(monday + timedelta(days=i), calendar)]
        observed = [sessions[i].session_date for i in indices]
        # Maximum lookback gives every candidate exactly the same warm-up.
        if indices[0] < max(legacy.LOOKBACKS) or observed != expected:
            continue
        # Both directions require a genuinely later terminal reference.
        if indices[-1] + 1 >= len(sessions):
            continue
        eligible.append(indices)
    if len(eligible) < SCORE_WEEKS:
        raise ValueError(f"Need {SCORE_WEEKS} common completed weeks after 60-session warm-up; got {len(eligible)}")
    return eligible[-SCORE_WEEKS:]


def score_candidate(sessions, weeks, lookback, first, spacing, side):
    costs, completions = [], []
    zero_days = observed_days = 0
    for indices in weeks:
        start = indices[0]
        history = sessions[start - lookback:start]
        expected_hits = statistics.fmean(legacy.hit_count(legacy.excursion(s, side), first, spacing) for s in history)
        initial = sessions[start].reference
        remaining, value = 1.0, 0.0
        for position, index in enumerate(indices):
            row = sessions[index]
            hits = legacy.hit_count(legacy.excursion(row, side), first, spacing)
            observed_days += 1
            zero_days += hits == 0
            # A zero-hit training sample never removes a difficult week.
            per_rung = remaining / ((len(indices) - position) * expected_hits) if expected_hits > 0 else 0.0
            for rung in range(hits):
                quantity = min(per_rung, remaining)
                distance = first + rung * spacing
                limit = row.reference * (1 + distance if side == "sell" else 1 - distance)
                value += quantity * limit / initial
                remaining -= quantity
                if remaining <= 1e-12:
                    break
        completions.append(1 - remaining)
        value += remaining * sessions[indices[-1] + 1].reference / initial
        costs.append((1 - value if side == "sell" else value - 1) * 10000)
    return legacy.CandidateResult(lookback, first, spacing, costs, completions,
                                  zero_days / observed_days)


def parameters(candidate):
    return {"lookback_sessions": candidate.lookback,
            "first_offset_pct": round(candidate.first_offset * 100, 4),
            "spacing_pct": round(candidate.spacing * 100, 4)}


def paired_stats(candidate, best):
    if len(candidate.costs_bps) != len(best.costs_bps):
        raise ValueError("Paired comparisons require identical weeks")
    differences = [a - b for a, b in zip(candidate.costs_bps, best.costs_bps)]
    gap = statistics.fmean(differences)
    se = statistics.stdev(differences) / math.sqrt(len(differences)) if len(differences) > 1 else 0.0
    return gap, se, max(se, MINIMUM_BAND_BPS)


def select_scored(candidates, prior):
    best = min(candidates, key=lambda c: c.mean_cost_bps)
    plateau = [c for c in candidates if paired_stats(c, best)[0] <= paired_stats(c, best)[2] + 1e-10]
    if prior is None:
        return best, best, plateau, None
    def distance(c):
        return (abs(c.first_offset - prior[1]) / .0005 + abs(c.spacing - prior[2]) / .0005
                + .15 * abs(c.lookback - prior[0]) / 5, c.mean_cost_bps)
    selected = min(plateau, key=distance)
    old = next((c for c in candidates if c.lookback == prior[0]
                and abs(c.first_offset - prior[1]) < 1e-10 and abs(c.spacing - prior[2]) < 1e-10), None)
    if old is None:
        selected = best
    return selected, best, plateau, old


def fit(sessions, prior, side):
    if side not in legacy.SIDES:
        raise ValueError("Unsupported trade side")
    weeks = common_weeks(sessions)
    candidates = [score_candidate(sessions, weeks, lookback, first, spacing, side)
                  for lookback in legacy.LOOKBACKS for first in legacy.FIRST_OFFSETS for spacing in legacy.SPACINGS]
    selected, best, plateau, old = select_scored(candidates, prior)
    gap, se, band = paired_stats(selected, best)
    retained = old is selected
    diagnostics = {
        "selector_version": SELECTOR_VERSION,
        "interpretation": "paired one-standard-error selection heuristic; not a significance or equivalence test",
        "candidate_count": len(candidates), "eligible_candidate_count": len(plateau),
        "common_scoring_weeks": [sessions[indices[0]].session_date.isoformat() for indices in weeks],
        "scoring_week_count": len(weeks), "minimum_band_bps": MINIMUM_BAND_BPS,
        "raw_minimum": {**parameters(best), "mean_cost_bps": best.mean_cost_bps},
        "adopted": {**parameters(selected), "mean_cost_bps": selected.mean_cost_bps,
                    "gap_to_raw_minimum_bps": gap, "paired_standard_error_bps": se, "allowed_gap_bps": band},
        "prior": ({**parameters(old), "mean_cost_bps": old.mean_cost_bps,
                   "gap_to_raw_minimum_bps": paired_stats(old, best)[0],
                   "paired_standard_error_bps": paired_stats(old, best)[1],
                   "allowed_gap_bps": paired_stats(old, best)[2], "eligible": any(c is old for c in plateau)} if old else None),
        "reason": ("Prior retained within its paired excess-cost band" if retained else
                   "No prior grid candidate; adopt the raw minimum" if old is None else
                   "Prior excluded by paired excess-cost band; adopt nearest eligible candidate"),
        "score_contract": "fixed weekly ladder and next-reference residual valuation; no spread, fees, queue or impact simulation",
        "prospective_validation": "not established; frozen shadow experiment is separate",
    }
    return selected, diagnostics


def needs_refit(bundle, instruments, now):
    for instrument in instruments:
        for side in legacy.SIDES:
            p = legacy.published_parameters(bundle, instrument["instrument_id"], side)
            if not p or p.get("selector_version") != SELECTOR_VERSION:
                return True
            observed = legacy.published_data_as_of(bundle, instrument["instrument_id"], side)
            if observed is None or observed < legacy.expected_market_session(now, instrument["market_calendar"]):
                return True
    return False


def rows_to_sessions(rows, calendar):
    return [legacy.Session(date.fromisoformat(x["date"]), x["reference"], x["drawdown_pct"] / 100,
                           rows[i + 1]["reference"] / x["reference"] - 1 if i + 1 < len(rows) else None,
                           x["runup_pct"] / 100, calendar) for i, x in enumerate(rows)]


def snapshot_sessions(snapshot, instrument, start, end):
    source = next((x for x in snapshot["instruments"] if x["instrument"]["instrument_id"] == instrument["instrument_id"]), None)
    if source is None:
        raise ValueError("Snapshot is missing a registered instrument")
    for field in ("market_calendar", "timezone", "reference_time", "fill_start_time", "session_end_time", "scaling_source"):
        if source["instrument"][field] != instrument[field]:
            raise ValueError(f"Snapshot contract mismatch: {field}")
    rows = [x for x in source["sessions"] if start.isoformat() <= x["date"] <= end.isoformat()]
    return rows_to_sessions(rows, instrument["market_calendar"])


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--calendar", choices=("XNYS", "24X7"))
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--registry", type=Path, default=root / "data/execution_instruments.json")
    parser.add_argument("--output", type=Path, default=root / "data/execution_params.json")
    parser.add_argument("--input-snapshot", type=Path, help="Read an archived sessions.json for reproducible offline fitting")
    args = parser.parse_args()
    registry = legacy.load_registry(args.registry)
    enabled = [x for x in registry["instruments"] if x["enabled"]]
    instruments = [x for x in enabled if not args.calendar or x["market_calendar"] == args.calendar]
    if not instruments:
        print("No enabled instruments in requested calendar")
        return 0
    previous = legacy.read_published_bundle(args.output)
    now = datetime.now(legacy.UTC)
    if not args.force and not needs_refit(previous, instruments, now.astimezone(legacy.ET)):
        print("Both directions have current data and selector version; skipping")
        return 0
    snapshot = json.loads(args.input_snapshot.read_text()) if args.input_snapshot else None
    if not snapshot:
        instruments = [legacy.crypto_instrument(x["symbol"], x["default_reference_price"])
                       if x["market_calendar"] == "24X7" else x for x in instruments]
    end, start = now.date() - timedelta(days=1), now.date() - timedelta(days=args.days)
    active_ids = {x["instrument_id"] for x in enabled}
    payloads = {k: v for k, v in previous.get("instruments", {}).items() if k in active_ids}
    groups, bar_cache = defaultdict(list), {}
    for instrument in instruments:
        source = instrument["scaling_source"]
        groups[(source["provider"], source["symbol"], source["interval"], instrument["market_calendar"],
                instrument["timezone"], instrument["reference_time"], instrument["fill_start_time"], instrument["session_end_time"])].append(instrument)
    generated = now.isoformat().replace("+00:00", "Z")
    for key, group in groups.items():
        instrument = group[0]
        if snapshot:
            sessions = snapshot_sessions(snapshot, instrument, start, end)
        else:
            if key[:3] not in bar_cache:
                bar_cache[key[:3]] = legacy.download_bars(instrument["scaling_source"], start, end)
            expected_contract = (("UTC", "00:00", "00:01", "24:00") if key[3] == "24X7"
                                 else ("America/New_York", "09:35", "09:36", "16:00"))
            if key[4:] != expected_contract:
                raise ValueError("Unsupported session contract; do not silently substitute reference times")
            sessions = build_complete_sessions(bar_cache[key[:3]], key[3], start, end)
        expected = legacy.expected_market_session(now.astimezone(legacy.ET), instrument["market_calendar"])
        if not sessions or sessions[-1].session_date < expected:
            raise ValueError(f"Archive not current through {expected}; last complete bundle is preserved")
        fitted = {}
        for side in legacy.SIDES:
            prior = next((p for x in group if (p := legacy.previous_parameters(previous, x["instrument_id"], side)) is not None), None)
            fitted[side] = fit(sessions, prior, side)
        for instrument in group:
            sides = {}
            for side, (selected, diagnostics) in fitted.items():
                payload = legacy.build_payload(instrument, sessions, selected, generated, side)
                payload.update(selector_version=SELECTOR_VERSION, selection_diagnostics=diagnostics,
                               selection_rule="common 26 completed weeks; paired excess-cost one-SE band; nearest prior within band")
                payload["notes"].extend([
                    "Both directions use complete sessions and stop at the actual core close on listed half days.",
                    "All 720 candidates use the same 26 completed scoring weeks; zero-hit weeks remain in the score.",
                    "The paired one-SE band is a stability heuristic, not statistical proof of equivalence or future advantage.",
                ])
                if args.input_snapshot:
                    payload["fit_input_snapshot_sha256"] = hashlib.sha256(args.input_snapshot.read_bytes()).hexdigest()
                sides[side] = payload
                print(f"{instrument['instrument_id']} {side}: {selected.lookback} / {selected.first_offset * 100:.2f}% / {selected.spacing * 100:.2f}%; eligible {diagnostics['eligible_candidate_count']}/720")
            payloads[instrument["instrument_id"]] = {**sides["buy"], "sides": sides}
    bundle = {"schema_version": 3, "sides": list(legacy.SIDES), "generated_at": generated,
              "default_instrument_id": registry["default_instrument_id"], "instrument_count": len(payloads), "instruments": payloads}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(bundle, indent=2) + "\n")
    temporary.replace(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
