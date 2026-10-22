import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publication', Path(__file__).resolve().parents[1] / 'scripts/verify_execution_publication.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Publication(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'params.json'
        self.path.write_bytes(b'{"complete":true}')
        self.digest = m.hashlib.sha256(self.path.read_bytes()).hexdigest()

    def test_current_pages_does_not_request_rebuild(self):
        with patch.object(m, 'served_digest', return_value=self.digest), patch.object(m.subprocess, 'run') as run:
            m.verify('owner/repo', self.path)
            run.assert_not_called()

    def test_stale_pages_requests_build_then_verifies(self):
        with patch.object(m, 'served_digest', side_effect=[None, 'old', self.digest]), patch.object(m.subprocess, 'run') as run, patch.object(m.time, 'sleep'):
            m.verify('owner/repo', self.path, attempts=2)
            self.assertEqual(run.call_args.args[0], ['gh', 'api', '--method', 'POST', 'repos/owner/repo/pages/builds'])

    def test_failed_publication_cannot_report_success(self):
        with patch.object(m, 'served_digest', return_value='old'), patch.object(m.subprocess, 'run'), patch.object(m.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'do not match'):
                m.verify('owner/repo', self.path, attempts=2)

    def test_rejected_build_fails(self):
        with patch.object(m, 'served_digest', return_value=None), patch.object(m.subprocess, 'run', side_effect=RuntimeError('rejected')):
            with self.assertRaisesRegex(RuntimeError, 'rejected'):
                m.verify('owner/repo', self.path)

class CalendarRecovery(unittest.TestCase):
    def simulate(self, event, schedule, fail_xnys=False):
        import os
        import subprocess
        import textwrap
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/update-execution-params.yml').read_text()
        block = workflow.split('        id: fit\n', 1)[1].split('        run: |\n', 1)[1].split('      - name:', 1)[0]
        block = textwrap.dedent(block).replace('${{ github.event_name }}', event).replace('${{ github.event.schedule }}', schedule)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = root / 'python'
            command.write_text('#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n[[ "$FAIL_XNYS" != "yes" || "$*" != *XNYS* ]]\n')
            command.chmod(0o755)
            env = dict(os.environ, PATH=directory + ':' + os.environ['PATH'], CALL_LOG=str(root/'calls'), GITHUB_OUTPUT=str(root/'output'), FAIL_XNYS='yes' if fail_xnys else 'no')
            subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', block], env=env, check=True)
            return (root/'calls').read_text(), (root/'output').read_text()

    def test_morning_recovers_equity_and_crypto_independently(self):
        calls, output = self.simulate('schedule', '30 8 * * *', True)
        self.assertIn('--calendar XNYS', calls)
        self.assertIn('--calendar 24X7', calls)
        self.assertNotIn('--force', calls)
        self.assertEqual(output, 'failed=1\n')

    def test_evening_does_not_require_unpublished_crypto_day(self):
        calls, output = self.simulate('schedule', '30 20 * * 1-5')
        self.assertNotIn('24X7', calls)
        self.assertEqual(output, 'failed=0\n')

    def test_manual_checks_both_calendars_with_real_refit(self):
        calls, _ = self.simulate('workflow_dispatch', '')
        self.assertEqual(calls.count('--force'), 2)
