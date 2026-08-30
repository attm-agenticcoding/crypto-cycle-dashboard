#!/usr/bin/env python3
"""Refresh rolling BTC execution parameters for the GitHub Pages calculator.

The estimator uses public BTCUSDT one-minute bars as a liquid, continuously
traded proxy for BTC Mini's intraday path.  A reference is fixed at the close
of the 09:35 America/New_York minute; fills may only occur from 09:36 onward.
Candidate lookbacks, first offsets, and rung spacings are evaluated with
walk-forward weekly implementation shortfall.  A one-standard-error plateau
and yesterday's parameters keep the published controls from chasing a noisy
single-day argmin.
"""

from __future__ import annotations

import argparse
import calendar
import io
import json
import math
import statistics
import sys
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo


ET = ZoneInfo("America/New_York")
UTC = timezone.utc
ARCHIVE_ROOT = "https://data.binance.vision/data/spot"
USER_AGENT = "crypto-cycle-dashboard-execution/1.0"
MAX_RUNGS = 12

LOOKBACKS = (10, 15, 20, 30, 45, 60)
FIRST_OFFSETS = tuple(x / 10_000 for x in (10, 15, 20, 25, 30, 35, 40, 50))
SPACINGS = tuple(x / 10_000 for x in range(30, 101, 5))


@dataclass(frozen=True)
class MinuteBar:
    opened_at: datetime
    low: float
    close: float


@dataclass(frozen=True)
class Session:
    session_date: date
    reference: float
    drawdown: float
    next_reference_return: float | None = None


@dataclass
class CandidateResult:
    lookback: int
    first_offset: float
    spacing: float
    costs_bps: list[float]
    passive_completion: list[float]
    zero_fill_rate: float

    @property
    def mean_cost_bps(self) -> float:
        return statistics.fmean(self.costs_bps)

    @property
    def stderr_bps(self) -> float:
        if len(self.costs_bps) < 2:
            return 0.0
        return statistics.stdev(self.costs_bps) / math.sqrt(len(self.costs_bps))

    @property
    def mean_completion(self) -> float:
        return statistics.fmean(self.passive_completion)


def request_bytes(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def parse_zip(payload: bytes) -> list[MinuteBar]:
    bars: list[MinuteBar] = []
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = [name for name in archive.namelist() if name.endswith(".csv")]
        if not names:
            return bars
        with archive.open(names[0]) as raw:
            for line in io.TextIOWrapper(raw, encoding="utf-8"):
                fields = line.rstrip().split(",")
                if len(fields) < 5 or not fields[0].isdigit():
                    continue
                stamp = int(fields[0])
                # Binance began publishing some archives in microseconds.
                if stamp > 10**14:
                    stamp //= 1000
                opened_at = datetime.fromtimestamp(stamp / 1000, tz=UTC)
                bars.append(MinuteBar(opened_at, float(fields[3]), float(fields[4])))
    return bars


def month_sequence(start: date, end: date) -> Iterable[tuple[int, int]]:
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield year, month
        month += 1
        if month == 13:
            year += 1
            month = 1


def download_bars(start: date, end: date) -> list[MinuteBar]:
    bars: list[MinuteBar] = []
    failures: list[str] = []
    current_month = (datetime.now(UTC).year, datetime.now(UTC).month)

    for year, month in month_sequence(start, end):
        month_start = date(year, month, 1)
        month_end = date(year, month, calendar.monthrange(year, month)[1])
        use_monthly = (year, month) < current_month and month_start >= date(2017, 1, 1)
        if use_monthly:
            name = f"BTCUSDT-1m-{year:04d}-{month:02d}.zip"
            url = f"{ARCHIVE_ROOT}/monthly/klines/BTCUSDT/1m/{name}"
            try:
                bars.extend(parse_zip(request_bytes(url)))
                continue
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, zipfile.BadZipFile) as exc:
                failures.append(f"monthly {year:04d}-{month:02d}: {exc}")

        day = max(start, month_start)
        last = min(end, month_end)
        while day <= last:
            name = f"BTCUSDT-1m-{day.isoformat()}.zip"
            url = f"{ARCHIVE_ROOT}/daily/klines/BTCUSDT/1m/{name}"
            try:
                bars.extend(parse_zip(request_bytes(url)))
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, zipfile.BadZipFile) as exc:
                # A just-finished UTC day may not have been published yet.
                failures.append(f"daily {day.isoformat()}: {exc}")
            day += timedelta(days=1)

    bars = [bar for bar in bars if start <= bar.opened_at.date() <= end]
    bars.sort(key=lambda bar: bar.opened_at)
    if not bars:
        raise RuntimeError("No Binance minute archives were available: " + "; ".join(failures[-5:]))
    return bars


def observed(day: date) -> date:
    if day.weekday() == 5:
        return day - timedelta(days=1)
    if day.weekday() == 6:
        return day + timedelta(days=1)
    return day


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    shift = (weekday - first.weekday()) % 7
    return first + timedelta(days=shift + 7 * (n - 1))


def last_weekday(year: int, month: int, weekday: int) -> date:
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def easter_sunday(year: int) -> date:
    # Anonymous Gregorian algorithm.
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def market_holidays(year: int) -> set[date]:
    return {
        observed(date(year, 1, 1)),
        nth_weekday(year, 1, 0, 3),          # Martin Luther King Jr. Day
        nth_weekday(year, 2, 0, 3),          # Presidents Day
        easter_sunday(year) - timedelta(days=2),
        last_weekday(year, 5, 0),            # Memorial Day
        observed(date(year, 6, 19)),
        observed(date(year, 7, 4)),
        nth_weekday(year, 9, 0, 1),          # Labor Day
        nth_weekday(year, 11, 3, 4),         # Thanksgiving
        observed(date(year, 12, 25)),
    }


def is_market_session_day(day: date) -> bool:
    return day.weekday() < 5 and day not in market_holidays(day.year)


def previous_market_session(day: date) -> date:
    candidate = day - timedelta(days=1)
    while not is_market_session_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


def expected_market_session(now_et: datetime) -> date:
    """Return the latest NYSE session that should be complete at this time."""
    today = now_et.date()
    if is_market_session_day(today) and now_et.time() >= time(16, 0):
        return today
    return previous_market_session(today)


def published_data_as_of(output_path: Path) -> date | None:
    try:
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        if payload.get("status") != "minute-rolling":
            return None
        return date.fromisoformat(str(payload["data_as_of"]))
    except (FileNotFoundError, KeyError, json.JSONDecodeError, TypeError, ValueError):
        return None


def build_sessions(bars: list[MinuteBar]) -> list[Session]:
    by_session: dict[date, dict[time, MinuteBar]] = defaultdict(dict)
    years: set[int] = set()
    for bar in bars:
        local = bar.opened_at.astimezone(ET)
        years.add(local.year)
        by_session[local.date()][local.time().replace(second=0, microsecond=0)] = bar
    holidays = set().union(*(market_holidays(year) for year in years))

    provisional: list[Session] = []
    for session_date in sorted(by_session):
        if session_date.weekday() >= 5 or session_date in holidays:
            continue
        minute_map = by_session[session_date]
        ref_bar = minute_map.get(time(9, 35))
        if ref_bar is None:
            continue
        eligible = [
            bar.low
            for minute, bar in minute_map.items()
            if time(9, 36) <= minute < time(16, 0)
        ]
        if len(eligible) < 300:
            continue
        reference = ref_bar.close
        drawdown = max(0.0, (reference - min(eligible)) / reference)
        provisional.append(Session(session_date, reference, drawdown))

    sessions: list[Session] = []
    for index, session in enumerate(provisional):
        next_return = None
        if index + 1 < len(provisional):
            next_return = provisional[index + 1].reference / session.reference - 1
        sessions.append(Session(session.session_date, session.reference, session.drawdown, next_return))
    return sessions


def hit_count(drawdown: float, first_offset: float, spacing: float) -> int:
    if drawdown + 1e-12 < first_offset:
        return 0
    return min(MAX_RUNGS, 1 + int((drawdown - first_offset + 1e-12) / spacing))


def percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def evaluate_candidate(
    sessions: list[Session], lookback: int, first_offset: float, spacing: float
) -> CandidateResult | None:
    weeks: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, session in enumerate(sessions):
        iso = session.session_date.isocalendar()
        weeks[(iso.year, iso.week)].append(index)

    costs: list[float] = []
    completions: list[float] = []
    zero_days = 0
    observed_days = 0
    for indices in weeks.values():
        start = indices[0]
        if start < lookback or len(indices) < 3:
            continue
        train = sessions[start - lookback : start]
        expected_hits = statistics.fmean(
            hit_count(item.drawdown, first_offset, spacing) for item in train
        )
        if expected_hits < 0.10:
            continue

        initial_reference = sessions[start].reference
        remaining = 1.0
        normalized_cost = 0.0
        for day_number, index in enumerate(indices):
            session = sessions[index]
            days_left = len(indices) - day_number
            shares_per_rung = remaining / (days_left * expected_hits)
            hits = hit_count(session.drawdown, first_offset, spacing)
            observed_days += 1
            if hits == 0:
                zero_days += 1
            for rung in range(hits):
                if remaining <= 1e-12:
                    break
                quantity = min(shares_per_rung, remaining)
                limit = session.reference * (1 - first_offset - rung * spacing)
                normalized_cost += quantity * limit / initial_reference
                remaining -= quantity

        completions.append(1 - remaining)
        next_index = indices[-1] + 1
        completion_reference = (
            sessions[next_index].reference if next_index < len(sessions) else sessions[indices[-1]].reference
        )
        normalized_cost += remaining * completion_reference / initial_reference
        costs.append((normalized_cost - 1.0) * 10_000)

    if len(costs) < 4:
        return None
    return CandidateResult(
        lookback,
        first_offset,
        spacing,
        costs,
        completions,
        zero_days / observed_days if observed_days else 1.0,
    )


def previous_parameters(output_path: Path) -> tuple[int, float, float]:
    try:
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        return (
            int(payload.get("lookback_sessions", 20)),
            float(payload.get("first_offset_pct", 0.25)) / 100,
            float(payload.get("spacing_pct", 0.80)) / 100,
        )
    except (FileNotFoundError, json.JSONDecodeError, TypeError, ValueError):
        return (20, 0.0025, 0.0080)


def choose_candidate(sessions: list[Session], prior: tuple[int, float, float]) -> CandidateResult:
    candidates: list[CandidateResult] = []
    for lookback in LOOKBACKS:
        for first_offset in FIRST_OFFSETS:
            for spacing in SPACINGS:
                result = evaluate_candidate(sessions, lookback, first_offset, spacing)
                if result is not None:
                    candidates.append(result)
    if not candidates:
        raise RuntimeError("Not enough complete sessions for walk-forward evaluation")

    best = min(candidates, key=lambda item: item.mean_cost_bps)
    threshold = best.mean_cost_bps + max(best.stderr_bps, 0.25)
    plateau = [item for item in candidates if item.mean_cost_bps <= threshold]
    prior_lookback, prior_first, prior_spacing = prior

    def regularization_distance(item: CandidateResult) -> tuple[float, float]:
        distance = (
            abs(item.first_offset - prior_first) / 0.0005
            + abs(item.spacing - prior_spacing) / 0.0005
            + 0.15 * abs(item.lookback - prior_lookback) / 5
        )
        return (distance, item.mean_cost_bps)

    return min(plateau, key=regularization_distance)


def as_percent(value: float, digits: int = 4) -> float:
    return round(value * 100, digits)


def build_payload(sessions: list[Session], selected: CandidateResult) -> dict:
    recent = sessions[-selected.lookback :]
    hits = [hit_count(item.drawdown, selected.first_offset, selected.spacing) for item in recent]
    samples = [
        {
            "date": item.session_date.isoformat(),
            "drawdown_pct": as_percent(item.drawdown, 5),
            "next_reference_return_pct": (
                as_percent(item.next_reference_return, 5)
                if item.next_reference_return is not None
                else None
            ),
        }
        for item in sessions[-90:]
    ]
    return {
        "schema_version": 1,
        "status": "minute-rolling",
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "data_as_of": sessions[-1].session_date.isoformat(),
        "market_proxy": "BTCUSDT",
        "execution_instrument": "Grayscale Bitcoin Mini Trust ETF (BTC)",
        "timezone": "America/New_York",
        "reference_time": "09:35",
        "fill_start_time": "09:36",
        "session_end_time": "16:00",
        "lookback_sessions": selected.lookback,
        "first_offset_pct": as_percent(selected.first_offset),
        "spacing_pct": as_percent(selected.spacing),
        "expected_rungs_per_session": round(statistics.fmean(hits), 4),
        "zero_fill_probability": round(sum(hit == 0 for hit in hits) / len(hits), 4),
        "sample_sessions": len(sessions),
        "walk_forward_weeks": len(selected.costs_bps),
        "walk_forward_mean_implementation_shortfall_bps": round(selected.mean_cost_bps, 3),
        "walk_forward_stderr_bps": round(selected.stderr_bps, 3),
        "walk_forward_mean_passive_completion": round(selected.mean_completion, 4),
        "selection_rule": "one-standard-error plateau, then minimum distance from prior published parameters",
        "session_samples": samples,
        "notes": [
            "BTCUSDT is a liquid intraday proxy; order prices are applied to the user-entered BTC ETF reference price.",
            "The 09:35 bar sets the reference and is excluded from fills; eligible lows begin at 09:36 ET.",
            "Unfilled weekly quantity is completed at the next available reference in the walk-forward cost calculation.",
        ],
    }


def should_run(force: bool, output_path: Path, now_et: datetime | None = None) -> bool:
    if force:
        return True
    current = now_et or datetime.now(ET)
    expected = expected_market_session(current)
    published = published_data_as_of(output_path)
    if published is not None and published >= expected:
        print(f"Execution parameters already cover {published}; expected at least {expected}. Nothing to do.")
        return False
    print(f"Execution parameters are stale ({published or 'missing'}); expected {expected}. Catch-up required.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Ignore the freshness guard and refit immediately")
    parser.add_argument("--days", type=int, default=220, help="Calendar days of minute archives to request")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "execution_params.json",
    )
    args = parser.parse_args()

    now_et = datetime.now(ET)
    expected_session = expected_market_session(now_et)
    if not should_run(args.force, args.output, now_et):
        return 0

    today_utc = datetime.now(UTC).date()
    start = today_utc - timedelta(days=args.days)
    end = today_utc - timedelta(days=1)
    bars = download_bars(start, end)
    sessions = build_sessions(bars)
    if len(sessions) < 75:
        raise RuntimeError(f"Only {len(sessions)} complete NY sessions were available; need at least 75")
    if sessions[-1].session_date < expected_session:
        raise RuntimeError(
            f"Latest complete NY session is {sessions[-1].session_date}; expected {expected_session}. "
            "The source archive is not ready yet, so a later scheduled retry should run again."
        )

    prior = previous_parameters(args.output)
    selected = choose_candidate(sessions, prior)
    payload = build_payload(sessions, selected)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        "Published",
        args.output,
        f"offset={payload['first_offset_pct']:.2f}%",
        f"spacing={payload['spacing_pct']:.2f}%",
        f"lookback={payload['lookback_sessions']}",
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # GitHub Actions should surface a concise failure.
        print(f"execution parameter update failed: {exc}", file=sys.stderr)
        raise
