import io
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from prepare_execution_v2 import archive_specs
from run_execution_shadow import plan_targets, mature_weeks, trusted_run, restore_latest, sha, WORKFLOW

CONFIG = json.loads((Path(__file__).resolve().parents[1] / "research/execution-shadow-protocol.json").read_text())


def targets(stamp):
    return {t["calendar"]: t for t in plan_targets(datetime.fromisoformat(stamp), CONFIG)}


class ShadowTimingTests(unittest.TestCase):
    def test_crypto_never_backdates_a_morning_fit_to_midnight(self):
        crypto = targets("2026-09-21T09:17:00+00:00")["24X7"]
        self.assertEqual(crypto["date"], "2026-09-22")
        self.assertEqual(crypto["expected_data_session"], "2026-09-20")
        self.assertEqual(crypto["freeze_before"], "2026-09-22T00:00:00Z")
        self.assertEqual(crypto["execution_starts_at"], "2026-09-22T00:01:00Z")

    def test_listed_freeze_is_strictly_before_open_and_never_catches_up_past_orders(self):
        before = targets("2026-09-21T13:29:59+00:00")["XNYS"]
        self.assertEqual(before["date"], "2026-09-21")
        self.assertEqual(before["expected_data_session"], "2026-09-18")
        self.assertEqual(before["execution_starts_at"], "2026-09-21T13:36:00Z")
        for stamp in ["2026-09-21T13:30:00+00:00", "2026-09-21T20:01:00+00:00"]:
            self.assertEqual(targets(stamp)["XNYS"]["date"], "2026-09-22")

    def test_weekend_holiday_and_daylight_saving(self):
        self.assertEqual(targets("2026-09-19T09:17:00+00:00")["XNYS"]["date"], "2026-09-21")
        self.assertEqual(targets("2026-09-07T09:17:00+00:00")["XNYS"]["date"], "2026-09-08")
        self.assertEqual(targets("2026-11-02T13:17:00+00:00")["XNYS"]["freeze_before"], "2026-11-02T14:30:00Z")
        self.assertEqual(targets("2026-11-26T09:17:00+00:00")["XNYS"]["date"], "2026-11-27")
        with self.assertRaises(ValueError):
            plan_targets(datetime(2026, 9, 19), CONFIG)

    def test_no_new_targets_after_fixed_end(self):
        self.assertEqual(targets("2026-12-14T09:17:00+00:00"), {})

    def test_expected_mature_weeks_independent_of_observed_bars(self):
        self.assertEqual(mature_weeks(date(2026, 9, 27), CONFIG), {"XNYS": [], "24X7": []})
        first = mature_weeks(date(2026, 9, 28), CONFIG)
        self.assertEqual(len(first["XNYS"][0]["dates"]), 5)
        self.assertEqual(len(first["24X7"][0]["dates"]), 7)
        self.assertEqual(first["24X7"][0]["terminal_date"], "2026-09-28")
        last = mature_weeks(date(2026, 12, 16), CONFIG)
        self.assertEqual(len(last["XNYS"]), 12)
        self.assertEqual(len(last["24X7"]), 12)
        thanksgiving = next(w for w in last["XNYS"] if w["week"] == "2026-11-23")
        self.assertNotIn("2026-11-26", thanksgiving["dates"])

    def test_month_boundary_waits_for_monthly_archive_publication(self):
        for current in [date(2026, 10, 1), date(2026, 10, 8)]:
            specs = list(archive_specs("BTCUSDT", date(2026, 9, 1), date(2026, 9, 30), current))
            self.assertEqual(len(specs), 30)
            self.assertTrue(all("/daily/" in url for name, url in specs))
        specs = list(archive_specs("BTCUSDT", date(2026, 9, 1), date(2026, 9, 30), date(2026, 10, 9)))
        self.assertEqual(len(specs), 1)
        self.assertIn("/monthly/", specs[0][1])
        specs = list(archive_specs("BTCUSDT", date(2026, 12, 31), date(2027, 1, 1), date(2027, 1, 2)))
        self.assertEqual([name for name, url in specs], ["BTCUSDT-1m-2026-12-31.zip", "BTCUSDT-1m-2027-01-01.zip"])


class ShadowRestoreTests(unittest.TestCase):
    run_fixture = {"id": 123, "head_branch": "main", "head_sha": "abc", "event": "schedule", "conclusion": "success", "path": f".github/workflows/{WORKFLOW}"}

    def test_only_exact_successful_main_workflow_is_eligible(self):
        self.assertTrue(trusted_run(self.run_fixture))
        for field, value in [("head_branch", "test"), ("event", "pull_request"), ("conclusion", "failure"), ("path", ".github/workflows/other.yml")]:
            self.assertFalse(trusted_run({**self.run_fixture, field: value}))

    def test_restores_state_with_server_metadata_not_payload_clock(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("shadow-state.json", '{"schema_version":1}')
            z.writestr("../../must-not-extract", "unsafe")
        archive = buffer.getvalue()
        artifact = {"id": 456, "name": "execution-shadow-state-123", "expired": False, "created_at": "2026-09-19T10:00:00Z", "digest": "sha256:" + sha(archive)}
        with tempfile.TemporaryDirectory() as tmp, patch("run_execution_shadow.gh_api", side_effect=[{"workflow_runs": [self.run_fixture]}, {"artifacts": [artifact]}, archive]):
            restore_latest(Path(tmp))
            self.assertEqual(json.loads((Path(tmp) / "prior-artifact.json").read_text())["created_at"], artifact["created_at"])
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["prior-artifact.json", "prior-state.json"])

    def test_missing_or_expired_state_is_not_silently_reset(self):
        for artifacts in [[], [{"id": 456, "name": "execution-shadow-state-123", "expired": True}]]:
            with tempfile.TemporaryDirectory() as tmp, patch("run_execution_shadow.gh_api", side_effect=[{"workflow_runs": [self.run_fixture]}, {"artifacts": artifacts}]):
                with self.assertRaises(RuntimeError):
                    restore_latest(Path(tmp))

    def test_archive_digest_mismatch_fails_closed(self):
        artifact = {"id": 456, "name": "execution-shadow-state-123", "expired": False, "digest": "sha256:wrong"}
        with tempfile.TemporaryDirectory() as tmp, patch("run_execution_shadow.gh_api", side_effect=[{"workflow_runs": [self.run_fixture]}, {"artifacts": [artifact]}, b"bytes"]):
            with self.assertRaisesRegex(RuntimeError, "digest mismatch"):
                restore_latest(Path(tmp))

    def test_failed_run_with_published_decisions_cannot_be_ignored(self):
        artifact = {"id": 456, "name": "execution-shadow-state-123", "expired": False}
        with tempfile.TemporaryDirectory() as tmp, patch("run_execution_shadow.gh_api", side_effect=[
            {"workflow_runs": [{**self.run_fixture, "conclusion": "cancelled"}]}, {"artifacts": [artifact]}]):
            with self.assertRaisesRegex(RuntimeError, "unsuccessful run already published"):
                restore_latest(Path(tmp))


if __name__ == "__main__":
    unittest.main()
