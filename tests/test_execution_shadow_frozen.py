"""Synthetic-only collector integration: frozen imports, contract and checkout provenance."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from execution_shadow_fixture import FROZEN_ROOT, REPO_ROOT, load_frozen_modules

CONTRACT = "ef1ef81a5a6515ed9642f98a4a9df15c403e3e23f33879e7af8144f204578724"


def synthetic_prior_state():
    """Generated test receipt; never loads an archived trial payload."""
    payload = {"record_kind": "prospective", "calendar": "XNYS", "effective_date": "2026-09-21",
               "generated_at": "2026-09-19T09:20:00Z", "freeze_before": "2026-09-21T13:30:00Z",
               "run_id": "synthetic-only", "source_commit": "synthetic-test-only", "previous_receipt_hash": None}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    state = {"schema_version": 1, "contract_hash": CONTRACT, "experiment_id": "execution-prospective-2026-09-v1",
             "receipts": [{"payload": payload, "hash": digest, "seal": None}], "evaluations": [], "events": []}
    metadata = {"verified_github_source": True, "artifact_id": 1000, "run_id": "synthetic-only",
                "source_commit": "synthetic-test-only", "created_at": "2026-09-19T09:25:00Z"}
    return state, metadata


class FrozenCollectorTests(unittest.TestCase):
    def test_all_python_dependencies_resolve_inside_the_frozen_root(self):
        shadow, preparation = load_frozen_modules()
        self.assertEqual(shadow.ROOT, FROZEN_ROOT)
        self.assertEqual(preparation.ROOT, FROZEN_ROOT)
        self.assertEqual(Path(shadow.__file__).resolve().parents[1], FROZEN_ROOT)
        self.assertEqual(Path(preparation.__file__).resolve().parents[1], FROZEN_ROOT)
        for function in [preparation.load_registry, preparation.request_bytes, preparation.is_market_session_day]:
            self.assertTrue(Path(function.__code__.co_filename).resolve().is_relative_to(FROZEN_ROOT))

    def test_unmodified_runner_uses_frozen_hashes_but_records_the_current_workflow_commit(self):
        # A real Git ancestor deliberately differs from the original source commit.
        with tempfile.TemporaryDirectory(prefix="shadow-collector-test-") as temporary:
            repo = Path(temporary)
            frozen = repo / "research/frozen/execution-prospective-2026-09-v1"
            shutil.copytree(FROZEN_ROOT, frozen, ignore=shutil.ignore_patterns(".research", "__pycache__"))
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            subprocess.run(["git", "-c", "user.email=test@example.invalid", "-c", "user.name=Offline test",
                            "commit", "--allow-empty", "-qm", "Test current workflow provenance"], cwd=repo, check=True)
            commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
            self.assertNotEqual(commit, "dcc2d5feb9a3054a7eae570e3b6ef487496e70e4")
            originals = repo / "test-inputs"
            originals.mkdir()
            original, metadata = synthetic_prior_state()
            (originals / "shadow-state.json").write_text(json.dumps(original))
            (originals / "prior-artifact.json").write_text(json.dumps(metadata))
            # Replace network restoration with generated test data. Execute the unchanged
            # collector and Node restore-only path; no actual trial artifact is loaded.
            script = r'''
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import run_execution_shadow as collector
class FixedClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 5, 12, 30, tzinfo=timezone.utc).astimezone(tz)
inputs = Path(sys.argv[2])
def restore(folder):
    (folder / "prior-state.json").write_bytes((inputs / "shadow-state.json").read_bytes())
    (folder / "prior-artifact.json").write_bytes((inputs / "prior-artifact.json").read_bytes())
with patch.object(collector, "datetime", FixedClock), patch.object(collector, "restore_latest", restore), \
     patch.object(collector, "gh_api", side_effect=AssertionError("Offline: no API call allowed")), \
     patch.object(sys, "argv", ["run_execution_shadow.py", "--local-test", "--restore-only"]):
    collector.main()
'''
            output = repo / "workflow-output"
            env = {k: v for k, v in os.environ.items() if not k.startswith("GITHUB_")}
            env["GITHUB_OUTPUT"] = str(output)
            result = subprocess.run([sys.executable, "-c", script, str(frozen / "scripts"), str(originals)],
                                    cwd=repo, env=env, text=True, capture_output=True, check=True)
            values = dict(line.split("=", 1) for line in output.read_text().splitlines())
            exported = Path(values["output_path"])
            self.assertTrue(exported.is_relative_to(frozen / ".research/shadow-runs"))
            self.assertEqual(values["artifact_name"], "execution-shadow-test-local-test")
            request = json.loads((exported / "request.json").read_text())
            self.assertEqual(request["source_commit"], commit)
            self.assertEqual(request["record_kind"], "test_only")
            shadow, _ = load_frozen_modules()
            expected_hashes = {name: hashlib.sha256((FROZEN_ROOT / name).read_bytes()).hexdigest() for name in shadow.CODE_FILES}
            self.assertEqual(request["implementation_sha256"], expected_hashes)
            restored = json.loads((exported / "shadow-state.json").read_text())
            self.assertEqual(restored["contract_hash"], CONTRACT)
            self.assertEqual([r["payload"] for r in restored["receipts"]], [r["payload"] for r in original["receipts"]])
            self.assertEqual([r["hash"] for r in restored["receipts"]], [r["hash"] for r in original["receipts"]])
            self.assertEqual(restored["evaluations"], original["evaluations"])
            self.assertFalse((exported / "sessions.json").exists())
            self.assertIn("Shadow artifact directory", result.stdout)


if __name__ == "__main__":
    unittest.main()
