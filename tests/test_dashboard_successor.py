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

    def test_persistent_missing_rows_and_duplicates_use_90_second_budget_then_fail_closed(self):
        for payload in ({'total_count': 1, 'workflow_runs': []},
                        {'total_count': 0, 'workflow_runs': [run()]},
                        {'total_count': 2, 'workflow_runs': [run(), run()]}):
            calls = []
            def api(*args):
                calls.append(args)
                return payload
            seconds = [0]
            def advance(delay):
                seconds[0] += delay
            with patch.object(successor.time, 'monotonic', side_effect=lambda: seconds[0]), \
                    patch.object(successor.time, 'sleep', side_effect=advance) as sleep, \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                with self.assertRaisesRegex(ValueError, 'deadline'):
                    successor.enqueue(self.env(), api)
            self.assertEqual(seconds[0], 90)
            self.assertEqual(len(calls), 20)
            self.assertEqual([c.args[0] for c in sleep.call_args_list], [1, 2, 3, 4] + [5] * 16)
            diagnostics = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([d['attempt'] for d in diagnostics], list(range(1, 21)))
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
        with self.assertRaisesRegex(RuntimeError, 'uncertain.*no retry'):
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


class IncidentAPI(FakeAPI):
    """Recorded jobs plus reconstructed stale/active run indexes, all offline."""
    def __init__(self):
        self.fixture = json.loads((ROOT / 'tests/fixtures/clock-20261104.json').read_text())
        self.old = self.fixture['predecessor']
        self.current = self.fixture['current']
        self.old.update(status='in_progress', conclusion=None)
        self.current.update(status='in_progress', conclusion=None)
        current_job = self.fixture['current_jobs']['jobs'][0]
        current_job.update(status='in_progress', conclusion=None, completed_at=None)
        current_job['steps'] = current_job['steps'][:2]
        current_job['steps'][-1].update(status='in_progress', conclusion=None, completed_at=None)
        self.records = {self.old['id']: self.old, self.current['id']: self.current}
        self.jobs = {self.old['id']: self.fixture['predecessor_jobs'],
                     self.current['id']: self.fixture['current_jobs']}
        super().__init__([self.old, self.current])

    def __call__(self, path, token, method='GET', body=None):
        if path.startswith(successor.RUNS + '/'):
            self.calls.append((path, token, method, body))
            tail = path.removeprefix(successor.RUNS + '/').split('/')
            run_id = int(tail[0])
            if len(tail) == 1:
                return deepcopy(self.records[run_id])
            if len(tail) == 4 and tail[1] == 'attempts' and tail[3].startswith('jobs?'):
                # Enforce attempt-pinned endpoint; never silently supply latest.
                if int(tail[2]) != self.records[run_id]['run_attempt']:
                    raise ValueError('Attempt mismatch')
                return deepcopy(self.jobs[run_id])
            raise AssertionError(path)
        return super().__call__(path, token, method, body)

    def env(self):
        return SuccessorTests().env(GITHUB_RUN_ID=str(self.current['id']),
                GITHUB_RUN_ATTEMPT=str(self.current['run_attempt']),
                GITHUB_SHA=self.current['head_sha'], GITHUB_JOB='tick')


class IncidentRegressionTests(unittest.TestCase):
    def assert_closed(self, api, request=None, env=None):
        try:
            result = successor.enqueue(env or api.env(), request or api)
        except (ValueError, RuntimeError, OSError):
            pass
        else:
            self.assertEqual(result['status'], 'successor-already-active')
        self.assertEqual(api.posts, [])

    def test_november_4_1631_stale_predecessor_successfully_enqueues_one_successor(self):
        api = IncidentAPI()
        self.assertEqual(successor.enqueue(api.env(), api), {'status': 'successor-enqueued'})
        self.assertEqual(len(api.posts), 1)
        old_jobs_reads = [c for c in api.calls if f"/{api.old['id']}/attempts/1/jobs?" in c[0]]
        self.assertGreaterEqual(len(old_jobs_reads), 3)
        self.assertNotIn('/cancel', ' '.join(c[0] for c in api.calls))

    def test_november_4_1117_three_total_one_rows_zero_reads_do_not_exhaust_budget(self):
        api, seconds, failures = FakeAPI(), [0], [0]
        def request(*args):
            seconds[0] += 3
            if failures[0] < 3:
                failures[0] += 1
                return {'total_count': 1, 'workflow_runs': []}
            return api(*args)
        with patch.object(successor.time, 'monotonic', side_effect=lambda: seconds[0]), \
                patch.object(successor.time, 'sleep', side_effect=lambda delay: seconds.__setitem__(0, seconds[0] + delay)):
            self.assertEqual(successor.enqueue(SuccessorTests().env(), request)['status'], 'successor-enqueued')
        self.assertGreater(seconds[0], 12)
        self.assertLess(seconds[0], 90)
        self.assertEqual(failures[0], 3)
        self.assertEqual(len(api.posts), 1)

    def test_authoritative_success_and_matching_current_rerun_are_safe(self):
        api = IncidentAPI()
        api.records[api.old['id']] = {**api.old, 'status': 'completed', 'conclusion': 'success'}
        api.current['run_attempt'] = 2
        api.jobs[api.current['id']]['jobs'][0]['run_attempt'] = 2
        self.assertEqual(successor.enqueue(api.env(), api)['status'], 'successor-enqueued')
        self.assertEqual(len(api.posts), 1)

    def test_real_old_execution_or_cancellation_never_gets_exempted(self):
        for status, conclusion in [('in_progress', None), ('queued', None), ('waiting', None),
                                   ('completed', 'cancelled'), ('completed', 'action_required'),
                                   ('completed', 'unknown'), ('completed', None), ('completed', 'failure')]:
            with self.subTest(status=status, conclusion=conclusion):
                api = IncidentAPI()
                api.jobs[api.old['id']]['jobs'][0].update(status=status, conclusion=conclusion)
                self.assert_closed(api)
        for status, conclusion in [('waiting', None), ('pending', None), ('queued', None),
                                   ('completed', 'cancelled'), ('completed', 'action_required')]:
            api = IncidentAPI()
            # Index still says active while the authoritative run denies success.
            api.records[api.old['id']] = {**api.old, 'status': status, 'conclusion': conclusion}
            self.assert_closed(api)

    def test_unknown_or_changed_identity_and_predecessor_relationship_fail_closed(self):
        changes = [{'run_attempt': 0}, {'run_attempt': None}, {'workflow_id': 1},
                   {'head_branch': 'other'}, {'path': '.github/workflows/other.yml'},
                   {'repository': {'full_name': 'other/fork'}}, {'display_title': 'ambiguous'},
                   {'head_sha': 'x' * 40}, {'run_number': 99999},
                   {'created_at': '2026-11-04T16:32:00Z'}, {'event': 'pull_request'}]
        for change in changes:
            with self.subTest(change=change):
                api = IncidentAPI()
                # Keep original active index as a blocker; corrupt a detail read.
                api.records[api.old['id']] = {**api.old, **change}
                self.assert_closed(api)

    def test_complete_jobs_and_exact_attempt_are_required(self):
        for payload in ({}, {'total_count': 1, 'jobs': []}, {'total_count': 0, 'jobs': []},
                        {'total_count': 2, 'jobs': []}, {'total_count': True, 'jobs': [{}]}):
            api = IncidentAPI()
            api.jobs[api.old['id']] = payload
            self.assert_closed(api)
        for change in ({'run_attempt': 2}, {'run_id': 1}, {'id': None}, {'name': 'other'},
                       {'head_sha': '0' * 40}, {'head_branch': 'other'}, {'run_url': 'https://elsewhere'},
                       {'completed_at': None}, {'completed_at': '2026-11-04T16:32:00Z'},
                       {'completed_at': '2026-11-04T16:00:00Z'}, {'steps': []},
                       {'steps': [{'name': 'Complete job', 'status': 'in_progress', 'conclusion': None}]}):
            with self.subTest(change=change):
                api = IncidentAPI()
                api.jobs[api.old['id']]['jobs'][0].update(change)
                self.assert_closed(api)
        api = IncidentAPI()
        payload = api.jobs[api.old['id']]
        payload['jobs'].append(deepcopy(payload['jobs'][0]))
        payload['total_count'] = 2
        self.assert_closed(api)

    def test_current_execution_must_match_environment_attempt_sha_job_and_live_state(self):
        for change in ({'GITHUB_RUN_ATTEMPT': '2'}, {'GITHUB_RUN_ATTEMPT': ''},
                       {'GITHUB_SHA': '0' * 40}, {'GITHUB_JOB': 'other'}):
            api = IncidentAPI()
            self.assert_closed(api, env={**api.env(), **change})
        api = IncidentAPI()
        api.jobs[api.current['id']]['jobs'][0].update(status='completed', conclusion='cancelled')
        self.assert_closed(api)

    def test_incomplete_cleanup_steps_or_malformed_step_times_remain_blockers(self):
        for omitted in range(6):
            api = IncidentAPI()
            del api.jobs[api.old['id']]['jobs'][0]['steps'][omitted]
            self.assert_closed(api)
        for change in ({'number': 1}, {'status': 'in_progress'}, {'conclusion': 'cancelled'},
                       {'started_at': None}, {'completed_at': None},
                       {'completed_at': '2026-11-04T16:33:00Z'}):
            api = IncidentAPI()
            api.jobs[api.old['id']]['jobs'][0]['steps'][-2].update(change)
            self.assert_closed(api)

    def test_attempt_change_during_evidence_collection_blocks_dispatch(self):
        api = IncidentAPI()
        def request(*args):
            result = api(*args)
            if f"/{api.old['id']}/attempts/" in args[0]:
                api.records[api.old['id']]['run_attempt'] = 2
            return result
        self.assert_closed(api, request)

    def test_final_recheck_catches_new_attempt_even_after_index_drops_old_run(self):
        api, scans = IncidentAPI(), [0]
        def request(*args):
            if 'status=requested' in args[0]:
                scans[0] += 1
                if scans[0] == 2:
                    api.runs = [api.current]
                    api.records[api.old['id']]['run_attempt'] = 2
            return api(*args)
        self.assert_closed(api, request)

    def test_job_state_change_between_complete_scans_blocks_dispatch(self):
        api, scans = IncidentAPI(), [0]
        def request(*args):
            if 'status=requested' in args[0]:
                scans[0] += 1
                if scans[0] == 2:
                    api.jobs[api.old['id']]['jobs'][0]['status'] = 'in_progress'
            return api(*args)
        self.assert_closed(api, request)

    def test_current_job_identity_change_before_dispatch_fails_closed(self):
        api, reads = IncidentAPI(), [0]
        def request(*args):
            if f"/{api.current['id']}/attempts/" in args[0]:
                reads[0] += 1
                if reads[0] == 2:
                    api.jobs[api.current['id']]['jobs'][0]['id'] += 1
            return api(*args)
        self.assert_closed(api, request)

    def test_multiple_blockers_are_not_hidden_by_completed_predecessor(self):
        api = IncidentAPI()
        api.runs.extend([run(api.current['id'] + 1, 'waiting'), run(api.current['id'] + 2, 'queued')])
        result = successor.enqueue(api.env(), api)
        self.assertEqual(result['run_ids'], [api.current['id'] + 1, api.current['id'] + 2])
        self.assertEqual(api.posts, [])

    def test_new_successor_appearing_during_retirement_scan_prevents_post(self):
        api, scans = IncidentAPI(), [0]
        def request(*args):
            if 'status=requested' in args[0]:
                scans[0] += 1
                if scans[0] == 2:
                    api.runs.append(run(api.current['id'] + 1, 'pending'))
            return api(*args)
        self.assert_closed(api, request)

    def test_denied_or_rate_limited_job_evidence_never_grants_exemption(self):
        for code in (403, 404, 429, 503):
            api = IncidentAPI()
            def request(*args):
                if '/attempts/' in args[0]:
                    raise urllib.error.HTTPError('https://api.github.com', code, 'failed', {}, None)
                return api(*args)
            self.assert_closed(api, request)

    def test_accepted_dispatch_with_lost_response_reads_back_without_second_post(self):
        api = FakeAPI()
        def request(*args):
            result = api(*args)
            if len(args) > 2 and args[2] == 'POST':
                api.runs.append(run(124, 'waiting'))
                raise TimeoutError('Accepted remotely, response lost')
            return result
        with self.assertRaisesRegex(RuntimeError, r'uncertain; active run IDs=\[124\]; no retry'):
            successor.enqueue(SuccessorTests().env(), request)
        self.assertEqual(len(api.posts), 1)
        self.assertEqual(api.calls[-1][2], 'GET')

    def test_readback_denied_after_ambiguous_post_does_not_retry(self):
        api = FakeAPI()
        def request(*args):
            if api.posts:
                raise RuntimeError('read denied')
            result = api(*args)
            if len(args) > 2 and args[2] == 'POST':
                raise TimeoutError('response lost')
            return result
        with self.assertRaisesRegex(RuntimeError, 'uncertain; read-back unavailable; no retry'):
            successor.enqueue(SuccessorTests().env(), request)
        self.assertEqual(len(api.posts), 1)


if __name__ == '__main__':
    unittest.main()
