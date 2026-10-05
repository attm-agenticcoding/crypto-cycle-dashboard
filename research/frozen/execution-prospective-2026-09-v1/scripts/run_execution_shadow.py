#!/usr/bin/env python3
"""Collect prospective paper-decision receipts without touching production.

Live receipts require the trusted main-branch GitHub workflow. Other runs are
explicitly test-only. Artifacts are append-only evidence, not broker orders.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from prepare_execution_v2 import ROOT, session_day, next_session

REPOSITORY = "attm-agenticcoding/crypto-cycle-dashboard"
WORKFLOW = "execution-prospective-shadow.yml"
UTC = timezone.utc
CODE_FILES = ["scripts/run_execution_shadow.py", "scripts/execution_shadow.cjs",
              "scripts/prepare_execution_v2.py", "scripts/execution_v2.cjs",
              "scripts/update_execution_params.py", "scripts/execution_registry.py",
              "scripts/crypto_execution.py", "execution/execution-core.js", "execution/index.html"]
PROTECTED = ["data/execution_params.json", "data/execution_instruments.json", "execution/index.html",
             "execution/execution-core.js", "scripts/update_execution_params.py", ".github/workflows/update-execution-params.yml"]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def iso(stamp: datetime) -> str:
    return stamp.astimezone(UTC).isoformat().replace("+00:00", "Z")


def plan_targets(now: datetime, config: dict) -> list[dict]:
    if now.tzinfo is None:
        raise ValueError("An aware clock is required")
    as_of = now.astimezone(UTC).date() - timedelta(days=1)
    targets = []
    for calendar, zone in (("XNYS", ZoneInfo("America/New_York")), ("24X7", UTC)):
        local = now.astimezone(zone)
        day = local.date() + (timedelta(days=1) if calendar == "24X7" else timedelta())
        cutoff = time(0) if calendar == "24X7" else time(9, 30)
        if calendar == "XNYS":
            while not session_day(day, calendar) or datetime.combine(day, cutoff, zone) <= now:
                day += timedelta(days=1)
        if day > date.fromisoformat(config["ends_on"]):
            continue
        observed = as_of
        while not session_day(observed, calendar):
            observed -= timedelta(days=1)
        reference = time(0) if calendar == "24X7" else time(9, 35)
        anchor = datetime.combine(day, reference, zone)
        targets.append({"calendar": calendar, "date": day.isoformat(),
                        "freeze_before": iso(datetime.combine(day, cutoff, zone)),
                        "reference_at": iso(anchor), "execution_starts_at": iso(anchor + timedelta(minutes=1)),
                        "expected_data_session": observed.isoformat()})
    return targets


def mature_weeks(as_of: date, config: dict) -> dict[str, list[dict]]:
    """Expected coverage independent of whether a market archive is missing."""
    result = {"XNYS": [], "24X7": []}
    monday = date.fromisoformat(config["starts_on"])
    if monday.weekday() != 0:
        raise ValueError("The trial must start on a Monday")
    while monday + timedelta(days=6) <= min(as_of, date.fromisoformat(config["ends_on"])):
        for calendar in result:
            dates = [monday + timedelta(days=i) for i in range(7) if session_day(monday + timedelta(days=i), calendar)]
            terminal = next_session(dates[-1], calendar)
            if terminal <= as_of:
                result[calendar].append({"week": monday.isoformat(), "dates": [day.isoformat() for day in dates],
                                         "terminal_date": terminal.isoformat()})
        monday += timedelta(days=7)
    return result


def gh_api(endpoint: str, binary=False):
    result = subprocess.run(["gh", "api", endpoint], check=True, capture_output=True)
    return result.stdout if binary else json.loads(result.stdout)


def trusted_source(run: dict) -> bool:
    return run.get("head_branch") == "main" and run.get("event") in ("schedule", "workflow_dispatch") and \
        run.get("path") == f".github/workflows/{WORKFLOW}"


def trusted_run(run: dict) -> bool:
    return trusted_source(run) and run.get("conclusion") == "success"


def completed_runs():
    page = 1
    while True:
        runs = gh_api(f"repos/{REPOSITORY}/actions/workflows/{WORKFLOW}/runs?branch=main&status=completed&per_page=100&page={page}")["workflow_runs"]
        yield from runs
        if len(runs) < 100:
            return
        page += 1


def restore_latest(folder: Path) -> None:
    for run in completed_runs():
        if not trusted_source(run):
            continue
        run_id = int(run["id"])
        artifacts = gh_api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts")["artifacts"]
        matches = [a for a in artifacts if a["name"] == f"execution-shadow-state-{run_id}"]
        if not trusted_run(run):
            if matches:
                raise RuntimeError("An unsuccessful run already published a receipt artifact; review it instead of replacing its decisions")
            continue
        if not matches:
            # A completed active live run must not disappear silently.
            raise RuntimeError("An earlier shadow run has no retained state artifact; do not silently reset the trial")
        if len(matches) != 1 or matches[0]["expired"]:
            raise RuntimeError("The prior immutable state is ambiguous or expired")
        artifact = matches[0]
        payload = gh_api(f"repos/{REPOSITORY}/actions/artifacts/{int(artifact['id'])}/zip", binary=True)
        expected_digest = artifact.get("digest")
        if expected_digest and expected_digest != "sha256:" + sha(payload):
            raise RuntimeError("Artifact download digest mismatch")
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            # Read only the one named member; never extract arbitrary archive paths.
            raw = archive.read("shadow-state.json")
            if len(raw) > 40_000_000:
                raise RuntimeError("Unexpectedly large shadow state")
            json.loads(raw)
        (folder / "prior-state.json").write_bytes(raw)
        metadata = {"verified_github_source": True, "artifact_id": int(artifact["id"]), "run_id": str(run_id),
                    "created_at": artifact["created_at"], "source_commit": run["head_sha"], "archive_sha256": sha(payload)}
        (folder / "prior-artifact.json").write_text(json.dumps(metadata))
        print(f"Restored immutable shadow state from run {run_id}", flush=True)
        return


def workflow_output(name, value):
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as stream:
            stream.write(f"{name}={value}\n")


def dispatch_diagnostics(now: datetime) -> dict:
    """Observe GitHub dispatch latency; the nominal daily slot is only inferred."""
    result = {"event": os.environ.get("GITHUB_EVENT_NAME", "local"), "collector_started_at": iso(now)}
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return result
    try:
        run = gh_api(f"repos/{REPOSITORY}/actions/runs/{int(os.environ['GITHUB_RUN_ID'])}")
        created = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
        started = datetime.fromisoformat(run["run_started_at"].replace("Z", "+00:00"))
        result.update(run_created_at=run["created_at"], run_started_at=run["run_started_at"],
                      creation_to_start_seconds=(started - created).total_seconds())
        if result["event"] == "schedule":
            event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
            cron = event.get("schedule", "")
            result["cron_utc"] = cron
            match = re.fullmatch(r"(\d{1,2}) (\d{1,2}) \* \* \*", cron)
            if match:
                nominal = created.astimezone(UTC).replace(hour=int(match[2]), minute=int(match[1]), second=0, microsecond=0)
                if nominal > created:
                    nominal -= timedelta(days=1)
                result.update(nominal_slot_inferred=iso(nominal),
                              schedule_to_creation_seconds_inferred=(created - nominal).total_seconds(),
                              inference_note="Nearest prior daily UTC slot; GitHub does not expose the original scheduled instant. Delays of 24h+ are ambiguous.")
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        # Optional observability must not stop collection. Do not log credentials
        # or the API response body if diagnostics are temporarily unavailable.
        result["diagnostics_unavailable"] = type(error).__name__
    return result


def collect(folder: Path, restore_only: bool) -> None:
    if not restore_only:
        subprocess.run([sys.executable, str(ROOT / "scripts/prepare_execution_v2.py"),
                        "--protocol", str(folder / "input-protocol.json"), "--output", str(folder / "sessions.json")], check=True)
    subprocess.run(["node", str(ROOT / "scripts/execution_shadow.cjs"), str(folder)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-test", action="store_true", help="Never create prospective evidence")
    parser.add_argument("--restore-only", action="store_true", help="Verify/seal existing official receipts; do not download observations, fit, or settle")
    args = parser.parse_args()
    config_bytes = (ROOT / "research/execution-shadow-protocol.json").read_bytes()
    config = json.loads(config_bytes)
    base_bytes = (ROOT / "research/execution-v2-protocol.json").read_bytes()
    if sha(base_bytes) != config["base_protocol_sha256"]:
        raise RuntimeError("The predeclared baseline protocol changed")
    registry_sha = sha((ROOT / "data/execution_instruments.json").read_bytes())
    if registry_sha != config["registry_sha256"]:
        raise RuntimeError("Registry changed; declare a new cohort rather than silently mixing experiments")
    now = datetime.now(UTC)
    if now.date() > date.fromisoformat(config["collect_until"]):
        workflow_output("active", "false")
        print("Trial collection has ended; no new downloads or decisions.")
        return
    workflow_output("active", "true")
    official = not args.local_test and os.environ.get("GITHUB_ACTIONS") == "true" and \
        os.environ.get("GITHUB_REPOSITORY") == REPOSITORY and os.environ.get("GITHUB_REF") == "refs/heads/main" and \
        os.environ.get("GITHUB_EVENT_NAME") in ("schedule", "workflow_dispatch") and \
        os.environ.get("GITHUB_WORKFLOW_REF") == f"{REPOSITORY}/.github/workflows/{WORKFLOW}@refs/heads/main"
    kind = "prospective" if official else "test_only"
    run_id = os.environ.get("GITHUB_RUN_ID", "local-test")
    prefix = "execution-shadow-state" if official else "execution-shadow-test"
    workflow_output("artifact_name", f"{prefix}-{run_id}")
    # A unique folder means an old local state can never masquerade as restored evidence.
    folder = ROOT / ".research" / "shadow-runs" / (str(run_id) + "-" + now.strftime("%Y%m%dT%H%M%S%f"))
    folder.mkdir(parents=True)
    workflow_output("output_path", str(folder / "export"))
    if official or args.restore_only:
        restore_latest(folder)
    if args.restore_only and not all((folder / f).is_file() for f in ("prior-state.json", "prior-artifact.json")):
        raise RuntimeError("Restore-only requires an existing official ledger")
    compatibility_bytes = (ROOT / "research/execution-shadow-compatibility.json").read_bytes()
    protocol = json.loads(base_bytes)
    protocol["as_of"] = (now.date() - timedelta(days=1)).isoformat()
    protocol["evaluation_end"] = protocol["as_of"]
    request = {"record_kind": kind, "run_id": run_id, "planned_at": iso(now), "as_of": protocol["as_of"],
               "restore_only": args.restore_only, "dispatch": dispatch_diagnostics(now),
               "compatibility_manifest_sha256": sha(compatibility_bytes),
               "targets": plan_targets(now, config), "registry_sha256": registry_sha,
               "mature_weeks": mature_weeks(date.fromisoformat(protocol["as_of"]), config),
               "instrument_ids": sorted(i["instrument_id"] for i in json.loads((ROOT / "data/execution_instruments.json").read_bytes())["instruments"] if i.get("enabled", True)),
               "implementation_sha256": {f: sha((ROOT / f).read_bytes()) for f in CODE_FILES},
               "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()}
    protected = {f: sha((ROOT / f).read_bytes()) for f in PROTECTED}
    (folder / "request.json").write_text(json.dumps(request, indent=2) + "\n")
    (folder / "shadow-protocol.json").write_bytes(config_bytes)
    (folder / "compatibility.json").write_bytes(compatibility_bytes)
    (folder / "input-protocol.json").write_text(json.dumps(protocol, indent=2) + "\n")
    collect(folder, args.restore_only)
    if protected != {f: sha((ROOT / f).read_bytes()) for f in PROTECTED}:
        raise RuntimeError("Protected production files changed")
    print(f"Shadow artifact directory: {folder / 'export'}", flush=True)


if __name__ == "__main__":
    main()
