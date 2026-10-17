"""Execute the actual inline workflow code, including without a checkout."""
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import types
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / '.github/workflows/dashboard-clock.yml').read_text()
SOURCE = textwrap.dedent(WORKFLOW.split('# BEGIN CHECKOUT-INDEPENDENT SUCCESSOR\n', 1)[1]
                        .split('          # END CHECKOUT-INDEPENDENT SUCCESSOR', 1)[0])
successor = types.ModuleType('successor')
exec(compile(SOURCE, 'dashboard-clock.yml:inline-successor', 'exec'), successor.__dict__)


def run(run_id=123, status='in_progress', **updates):
    return {'id': run_id, 'path': '.github/workflows/dashboard-clock.yml', 'head_branch': 'main',
            'repository': {'full_name': successor.REPOSITORY}, 'status': status,
            'event': 'workflow_dispatch', 'display_title': 'Dashboard publication clock (production)', **updates}


class FakeAPI:
    def __init__(self, runs=()):
        self.runs = list(runs)
        self.calls = []

    def __call__(self, path, token, method='GET', body=None):
        self.calls.append((path, token, method, body))
        if method == 'POST':
            return {}
        status = path.split('status=')[1].split('&')[0]
        rows = [deepcopy(item) for item in self.runs if item['status'] == status]
        page = int(path.split('page=')[-1])
        return {'workflow_runs': rows[(page - 1) * 100:page * 100], 'total_count': len(rows)}

    @property
    def posts(self):
        return [call for call in self.calls if call[2] == 'POST']


class SuccessorTests(unittest.TestCase):
    def env(self, **updates):
        return {'GITHUB_REPOSITORY': successor.REPOSITORY, 'GITHUB_REF': 'refs/heads/main',
                'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_RUN_ID': '123',
                'GH_TOKEN': 'test-self-token', 'CLOCK_ENABLED': 'true', 'VERIFY_ONLY': 'false',
                'REMAINING': '0', **updates}

    def test_exactly_one_successor_excludes_current_run_including_reruns(self):
        for attempt in (1, 2):
            api = FakeAPI([run(run_attempt=attempt)])
            self.assertEqual(successor.enqueue(self.env(), api), {'status': 'successor-enqueued'})
            self.assertEqual(len(api.calls), 11)
            self.assertEqual(api.posts, [(successor.PREFIX + '/dispatches', 'test-self-token', 'POST',
                {'ref': 'main', 'inputs': {'verify_only': 'false', 'remaining': '0'}})])

    def test_all_five_active_successor_states_block_another_dispatch(self):
        for status in successor.ACTIVE:
            api = FakeAPI([run(), run(124, status)])
            self.assertEqual(successor.enqueue(self.env(), api),
                             {'status': 'successor-already-active', 'run_ids': [124]})
            self.assertEqual(api.posts, [])

    def test_unknown_main_run_blocks_but_verify_and_other_branches_do_not(self):
        for title in ('Dashboard publication clock', 'unrecognized title'):
            api = FakeAPI([run(124, 'waiting', display_title=title)])
            self.assertEqual(successor.enqueue(self.env(), api)['status'], 'successor-already-active')
        api = FakeAPI([run(124, 'waiting', display_title=successor.VERIFY_NAME),
                       run(125, 'queued', head_branch='test')])
        self.assertEqual(successor.enqueue(self.env(), api)['status'], 'successor-enqueued')

    def test_verification_has_one_successor_then_stops_without_private_credentials(self):
        api = FakeAPI([run()])
        env = self.env(VERIFY_ONLY='true', REMAINING='1', CLOCK_ENABLED='false')
        self.assertEqual(successor.enqueue(env, api)['status'], 'successor-enqueued')
        self.assertEqual(api.posts[0][3]['inputs'], {'verify_only': 'true', 'remaining': '0'})
        env['REMAINING'] = '0'
        api = FakeAPI()
        self.assertEqual(successor.enqueue(env, api), {'status': 'verification-complete'})
        self.assertEqual(api.calls, [])

    def test_existing_verification_successor_blocks_only_verification(self):
        api = FakeAPI([run(124, 'waiting', display_title=successor.VERIFY_NAME)])
        self.assertEqual(successor.enqueue(self.env(VERIFY_ONLY='true', REMAINING='1'), api)['status'],
                         'successor-already-active')
        self.assertEqual(api.posts, [])

    def test_disabled_production_does_not_read_or_dispatch(self):
        api = FakeAPI()
        self.assertEqual(successor.enqueue(self.env(CLOCK_ENABLED='false'), api), {'status': 'disabled'})
        self.assertEqual(api.calls, [])

    def test_untrusted_context_and_invalid_inputs_fail_before_api_calls(self):
        for change in ({'GITHUB_REPOSITORY': 'other/fork'}, {'GITHUB_REF': 'refs/heads/other'},
                       {'GITHUB_EVENT_NAME': 'pull_request'}, {'GITHUB_EVENT_NAME': 'push'},
                       {'REMAINING': '-1'}, {'REMAINING': '2'}, {'VERIFY_ONLY': 'anything'},
                       {'GITHUB_RUN_ID': ''}, {'GITHUB_RUN_ID': '0'}):
            api = FakeAPI()
            with self.assertRaises(ValueError):
                successor.enqueue(self.env(**change), api)
            self.assertEqual(api.calls, [])

    def test_malformed_and_oversized_inventories_fail_closed_without_retry(self):
        for payload in ({}, [], None, {'total_count': False, 'workflow_runs': []},
                        {'total_count': -1, 'workflow_runs': []},
                        {'total_count': 1001, 'workflow_runs': [run(i + 1) for i in range(100)]}):
            calls = []
            def api(*args):
                calls.append(args)
                return payload
            with self.assertRaises(ValueError), patch.object(successor.time, 'sleep') as sleep:
                successor.enqueue(self.env(), api)
            self.assertEqual(len(calls), 1)
            sleep.assert_not_called()

    def test_persistent_missing_rows_and_duplicates_retry_three_times_then_fail_closed(self):
        for payload in ({'total_count': 1, 'workflow_runs': []},
                        {'total_count': 0, 'workflow_runs': [run()]},
                        {'total_count': 2, 'workflow_runs': [run(), run()]}):
            calls = []
            def api(*args):
                calls.append(args)
                return payload
            with patch.object(successor.time, 'sleep') as sleep, patch('sys.stdout', new_callable=io.StringIO) as output:
                with self.assertRaisesRegex(ValueError, 'inconsistent after 3'):
                    successor.enqueue(self.env(), api)
            self.assertEqual(len(calls), 3)
            self.assertEqual([c.args[0] for c in sleep.call_args_list], [1, 2])
            diagnostics = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([d['attempt'] for d in diagnostics], [1, 2, 3])
            self.assertIn('status=requested page=1', diagnostics[0]['reason'])
            self.assertNotIn('test-self-token', output.getvalue())

    def test_transient_count_mismatch_restarts_entire_scan_then_dispatches_once(self):
        api = FakeAPI([run()])
        failed = False
        def request(*args):
            nonlocal failed
            if 'status=in_progress' in args[0] and not failed:
                failed = True
                api.calls.append((*args, 'GET', None))
                return {'total_count': 1, 'workflow_runs': []}
            return api(*args)
        with patch.object(successor.time, 'sleep') as sleep:
            self.assertEqual(successor.enqueue(self.env(), request)['status'], 'successor-enqueued')
        self.assertEqual(len(api.posts), 1)
        self.assertEqual(sum('status=requested' in c[0] for c in api.calls), 3)
        sleep.assert_called_once_with(1)

    def test_transient_mismatch_recovery_finds_new_blocker_without_post(self):
        api = FakeAPI([run(124, 'waiting')])
        first = True
        def request(*args):
            nonlocal first
            if first:
                first = False
                return {'total_count': 1, 'workflow_runs': []}
            return api(*args)
        with patch.object(successor.time, 'sleep'):
            self.assertEqual(successor.enqueue(self.env(), request),
                             {'status': 'successor-already-active', 'run_ids': [124]})
        self.assertEqual(api.posts, [])

    def test_inventory_paginates_and_finds_blocker_after_first_page(self):
        for total in (100, 101, 1000):
            rows = [run(1000 + i, 'waiting', head_branch='other') for i in range(total)]
            rows[-1]['head_branch'] = 'main'
            api = FakeAPI(rows)
            self.assertEqual(successor.enqueue(self.env(), api),
                             {'status': 'successor-already-active', 'run_ids': [rows[-1]['id']]})
            pages = [c[0] for c in api.calls if 'status=waiting' in c[0]]
            self.assertEqual(len(pages), (total + 99) // 100)
            self.assertEqual(api.posts, [])

    def test_complete_paginated_nonblockers_can_dispatch_once(self):
        api = FakeAPI([run(i + 1000, 'waiting', head_branch='other') for i in range(101)])
        self.assertEqual(successor.enqueue(self.env(), api)['status'], 'successor-enqueued')
        self.assertEqual(len(api.posts), 1)
        self.assertEqual(sum('page=2' in c[0] for c in api.calls), 2)

    def test_total_drift_or_duplicate_across_pages_restarts_from_page_one(self):
        for problem in ('count', 'duplicate'):
            rows = [run(i + 1000, 'waiting', head_branch='other') for i in range(101)]
            api = FakeAPI(rows)
            failed = False
            def request(*args):
                nonlocal failed
                payload = api(*args)
                if 'status=waiting' in args[0] and 'page=2' in args[0] and not failed:
                    failed = True
                    if problem == 'count':
                        payload['total_count'] = 100
                        payload['workflow_runs'] = []
                    else:
                        payload['workflow_runs'] = [deepcopy(rows[0])]
                return payload
            with patch.object(successor.time, 'sleep'):
                self.assertEqual(successor.enqueue(self.env(), request)['status'], 'successor-enqueued')
            self.assertEqual(sum('status=requested' in c[0] for c in api.calls), 3)
            self.assertEqual(len(api.posts), 1)

    def test_cross_status_transition_does_not_erase_observed_active_blocker(self):
        api = FakeAPI()
        def request(path, *args):
            api.calls.append((path, *args))
            if 'status=waiting' in path:
                return {'total_count': 1, 'workflow_runs': [run(124, 'waiting')]}
            if 'status=in_progress' in path:
                return {'total_count': 1, 'workflow_runs': [run(124, 'completed')]}
            return {'total_count': 0, 'workflow_runs': []}
        self.assertEqual(successor.enqueue(self.env(), request),
                         {'status': 'successor-already-active', 'run_ids': [124]})
        self.assertFalse(any('/dispatches' in c[0] for c in api.calls))

    def test_cross_status_metadata_change_cannot_erase_earlier_blocker(self):
        for change in ({'head_branch': 'other'}, {'display_title': successor.VERIFY_NAME}):
            calls = []
            def request(path, *args):
                calls.append(path)
                if 'status=waiting' in path:
                    return {'total_count': 1, 'workflow_runs': [run(124, 'waiting')]}
                if 'status=in_progress' in path:
                    return {'total_count': 1, 'workflow_runs': [run(124, **change)]}
                return {'total_count': 0, 'workflow_runs': []}
            self.assertEqual(successor.enqueue(self.env(), request),
                             {'status': 'successor-already-active', 'run_ids': [124]})
            self.assertFalse(any('/dispatches' in path for path in calls))

    def test_second_complete_scan_observes_new_successor(self):
        api = FakeAPI()
        def request(*args):
            if len(api.calls) == 5:
                api.runs.append(run(124, 'waiting'))
            return api(*args)
        self.assertEqual(successor.enqueue(self.env(), request)['status'], 'successor-already-active')
        self.assertEqual(api.posts, [])

    def test_deadline_expiring_during_scan_never_dispatches(self):
        api = FakeAPI()
        seconds = 0
        def request(*args):
            nonlocal seconds
            result = api(*args)
            seconds = 91
            return result
        with patch.object(successor.time, 'monotonic', side_effect=lambda: seconds):
            with self.assertRaisesRegex(ValueError, 'deadline'):
                successor.enqueue(self.env(), request)
        self.assertEqual(api.posts, [])

    def test_deadline_expiring_after_final_read_never_dispatches(self):
        api = FakeAPI()
        seconds = 0
        def request(*args):
            nonlocal seconds
            result = api(*args)
            if len(api.calls) == 10:
                seconds = 91
            return result
        with patch.object(successor.time, 'monotonic', side_effect=lambda: seconds):
            with self.assertRaisesRegex(ValueError, 'deadline'):
                successor.enqueue(self.env(), request)
        self.assertEqual(len(api.calls), 10)
        self.assertEqual(api.posts, [])

    def test_http_get_timeout_and_retry_fit_remaining_budget(self):
        with patch.object(successor.time, 'monotonic', return_value=89.5), \
                patch.object(successor.urllib.request, 'build_opener') as opener, \
                patch.object(successor.time, 'sleep') as sleep:
            opener.return_value.open.side_effect = TimeoutError()
            with self.assertRaisesRegex(ValueError, 'deadline'):
                successor.github_api(successor.PREFIX + '/runs', 'test', deadline=90)
            self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 0.5)
            self.assertEqual(opener.return_value.open.call_count, 1)
            sleep.assert_not_called()

    def test_malformed_run_identity_never_dispatches(self):
        for change in ({'path': 'other.yml'}, {'repository': {}}, {'id': None},
                       {'head_branch': ''}, {'display_title': None}, {'status': 'unknown'}):
            with self.assertRaises(ValueError):
                successor.enqueue(self.env(), lambda *args: {'total_count': 1, 'workflow_runs': [run(**change)]})

    def test_an_inventory_failure_never_dispatches(self):
        api = FakeAPI()
        def request(*args):
            if 'status=waiting' in args[0]:
                raise RuntimeError('read unavailable')
            return api(*args)
        with self.assertRaisesRegex(RuntimeError, 'read unavailable'):
            successor.enqueue(self.env(), request)
        self.assertEqual(api.posts, [])

    def test_ambiguous_dispatch_is_not_repeated_by_enqueue(self):
        api = FakeAPI()
        def request(*args):
            result = api(*args)
            if len(args) > 2 and args[2] == 'POST':
                raise TimeoutError('response lost after acceptance')
            return result
        with self.assertRaises(TimeoutError):
            successor.enqueue(self.env(), request)
        self.assertEqual(len(api.posts), 1)

    def test_http_dispatch_errors_have_exactly_one_attempt(self):
        for failure in (TimeoutError(), urllib.error.URLError('offline'),
                        urllib.error.HTTPError('https://api.github.com', 503, 'busy', {}, None),
                        urllib.error.HTTPError('https://api.github.com', 429, 'limited', {}, None)):
            with patch.object(successor.urllib.request, 'build_opener') as opener, patch.object(successor.time, 'sleep') as sleep:
                opener.return_value.open.side_effect = failure
                with self.assertRaisesRegex(RuntimeError, 'reconcile'):
                    successor.github_api(successor.PREFIX + '/dispatches', 'test', 'POST', {})
                self.assertEqual(opener.return_value.open.call_count, 1)
                sleep.assert_not_called()

    def test_reads_retry_at_most_twice_and_reject_redirects_or_forbidden(self):
        for code, expected in ((503, 2), (429, 2), (403, 1), (302, 1)):
            with patch.object(successor.urllib.request, 'build_opener') as opener, patch.object(successor.time, 'sleep'):
                opener.return_value.open.side_effect = urllib.error.HTTPError('https://api.github.com', code, 'error', {}, None)
                with self.assertRaises(RuntimeError):
                    successor.github_api(successor.PREFIX + '/runs', 'test')
                self.assertEqual(opener.return_value.open.call_count, expected)
                self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 5)
        self.assertIsNone(successor.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere'))

    def test_real_inline_main_schedules_without_checkout_and_survives_git_exit_128(self):
        api = FakeAPI([run()])
        def open_response(req, timeout):
            payload = api(req.full_url.removeprefix('https://api.github.com'), 'test-self-token', req.method,
                          json.loads(req.data) if req.data else None)
            return io.BytesIO(json.dumps(payload).encode())
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'output'
            try:
                os.chdir(temporary)
                self.assertFalse(Path('scripts/dashboard_clock.py').exists())
                with patch.dict(os.environ, self.env(GITHUB_OUTPUT=str(output)), clear=True), \
                        patch.object(successor.urllib.request, 'build_opener') as opener, patch('sys.stdout', new_callable=io.StringIO):
                    opener.return_value.open.side_effect = open_response
                    exec(compile(SOURCE, 'dashboard-clock.yml:inline-successor', 'exec'), {'__name__': '__main__'})
                # The following checkout/git operation fails, but dispatch is already complete.
                git = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True)
                self.assertEqual(git.returncode, 128)
                self.assertEqual(output.read_text(), 'status=successor-enqueued\n')
                self.assertEqual(len(api.posts), 1)
            finally:
                os.chdir(previous)

    def test_workflow_orders_scheduler_before_checkout_with_existing_protections(self):
        before_checkout = WORKFLOW.split('      - name: Check out only the public clock', 1)[0]
        self.assertIn('# END CHECKOUT-INDEPENDENT SUCCESSOR', before_checkout)
        self.assertNotIn('uses:', before_checkout)
        self.assertNotIn('secrets.', before_checkout)
        self.assertIn('shell: python', before_checkout)
        self.assertIn('cancel-in-progress: false', WORKFLOW)
        self.assertIn('deployment: false', WORKFLOW)
        self.assertIn('timeout-minutes: 3', WORKFLOW)
        self.assertIn('CLOCK_SUCCESSOR_STATUS: ${{ steps.successor.outputs.status }}', WORKFLOW)
        self.assertNotIn('continue-on-error:', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
