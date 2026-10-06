from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import dashboard_watchdog as wd

NOW = datetime(2026, 10, 6, 15, 30, tzinfo=timezone.utc)


def run(run_id=7, age=21, **updates):
    created = (NOW - timedelta(minutes=age)).isoformat()
    value = {'id': run_id, 'path': wd.CLOCK_PATH, 'head_branch': 'main', 'event': 'workflow_dispatch',
             'repository': {'full_name': wd.PUBLIC_REPOSITORY}, 'display_title': wd.PRODUCTION_NAME,
             'status': 'queued', 'conclusion': None, 'run_attempt': 1, 'created_at': created, 'updated_at': created}
    value.update(updates)
    return value


def jobs(value, **updates):
    job = {'id': 17, 'run_id': value['id'], 'name': 'tick', 'run_attempt': 1, 'status': 'queued',
           'conclusion': None, 'steps': [], 'runner_id': None, 'runner_name': None,
           'runner_group_id': None, 'created_at': value['created_at']}
    job.update(updates)
    return {'total_count': 1, 'jobs': [job]}


def env(**updates):
    value = {'GITHUB_REPOSITORY': wd.PUBLIC_REPOSITORY, 'GITHUB_REF': 'refs/heads/main',
             'GITHUB_EVENT_NAME': 'schedule', 'CLOCK_ENABLED': 'true', 'GH_TOKEN': 'test-only', 'GITHUB_RUN_ID': '11'}
    value.update(updates)
    return value


def publication(mode='live', slot='2026-10-06 11:00', **updates):
    snap = {'masked': True, 'run_kind': mode, 'generated_at': '2026-10-06T11:02:00-04:00'}
    raw = json.dumps(snap).encode()
    index = b'<html>actual main publication</html>'
    receipt = {'publisher': 'github-actions', 'kind': 'main', 'mode': mode, 'logical_slot': slot,
               'published_at_utc': '2026-10-06T15:02:20+00:00', 'files': {
                   'snapshot.json': hashlib.sha256(raw).hexdigest(), 'index.html': hashlib.sha256(index).hexdigest()}}
    receipt.update(updates)
    contents = {'cloud-runtime.json': json.dumps(receipt).encode(), 'snapshot.json': raw, 'index.html': index}
    return contents


def reader(contents):
    return lambda url: contents[url.split('?')[0].rsplit('/', 1)[1]]


class FakeAPI:
    def __init__(self, values=None):
        self.values = deepcopy(values or [])
        self.calls = []
        self.rechecks = 0
        self.mutate = None
        self.protections = []
        self.cancel_stays_active = False
        self.cancel_error = None
        self.dispatch_error = None
        self.job_override = None

    def __call__(self, path, token, method='GET', body=None):
        self.calls.append((path, method, body))
        if method == 'POST':
            if path.endswith('/cancel'):
                if self.cancel_error:
                    raise self.cancel_error
                run_id = int(path.split('/')[-2])
                if not self.cancel_stays_active:
                    for item in self.values:
                        if item['id'] == run_id:
                            item['status'] = 'completed'; item['conclusion'] = 'cancelled'
                return {}
            if path.endswith('/dispatches'):
                self.values.append(run(99, age=0, status='waiting'))
                if self.dispatch_error:
                    raise self.dispatch_error
                return {}
            raise AssertionError(path)
        if '/workflows/' in path:
            if '?status=' in path:
                status = path.split('?status=')[1].split('&')[0]
                rows = deepcopy([item for item in self.values if item['status'] == status])
                return {'workflow_runs': rows, 'total_count': len(rows)}
            return {'workflow_runs': deepcopy(sorted(self.values, key=lambda item: item['created_at'], reverse=True)), 'total_count': len(self.values)}
        run_id = int(path.split('/runs/')[1].split('/')[0])
        item = next(item for item in self.values if item['id'] == run_id)
        if '/jobs?' in path:
            return deepcopy(self.job_override or jobs(item))
        if path.endswith('/pending_deployments'):
            return self.protections
        self.rechecks += 1
        if self.rechecks == 2 and self.mutate:
            self.mutate(item)
        return deepcopy(item)

    def posts(self):
        return [call for call in self.calls if call[1] == 'POST']


class EligibilityTests(unittest.TestCase):
    def test_strict_twenty_minute_boundary(self):
        for seconds, expected in ((1199, False), (1200, False), (1201, True)):
            value = run(age=seconds / 60)
            self.assertEqual(wd.stalled(value, jobs(value), NOW), expected)

    def test_recent_transition_out_of_environment_wait_is_not_old_queue(self):
        value = run(age=30, updated_at=(NOW - timedelta(minutes=4)).isoformat())
        self.assertFalse(wd.stalled(value, jobs(value), NOW))

    def test_rejects_runner_steps_and_ambiguous_job_data(self):
        value = run()
        for update in ({'runner_id': 42}, {'runner_name': 'allocated'}, {'runner_group_id': 2},
                       {'steps': [{'name': 'Set up job'}]}, {'steps': None}, {'status': 'in_progress'},
                       {'run_attempt': 2}, {'name': 'other'}, {'run_id': 88}):
            with self.subTest(update=update):
                self.assertFalse(wd.stalled(value, jobs(value, **update), NOW))
        for key in ('runner_id', 'steps', 'created_at'):
            payload = jobs(value); del payload['jobs'][0][key]
            self.assertFalse(wd.stalled(value, payload, NOW))
        for payload in ({}, {'total_count': 2, 'jobs': [jobs(value)['jobs'][0]]}, {'total_count': 0, 'jobs': []}):
            self.assertFalse(wd.stalled(value, payload, NOW))

    def test_unrelated_runs_verifications_reruns_are_untouched(self):
        for update in ({'path': '.github/workflows/other.yml'}, {'head_branch': 'other'},
                       {'repository': {'full_name': 'other/repo'}}, {'display_title': wd.VERIFY_NAME},
                       {'display_title': 'Dashboard publication clock'}, {'run_attempt': 2},
                       {'event': 'pull_request'}, {'status': 'waiting'}, {'status': 'pending'},
                       {'status': 'in_progress'}, {'conclusion': 'success'}):
            value = run(**update)
            with self.subTest(update=update):
                self.assertFalse(wd.stalled(value, jobs(value), NOW))

    def test_legacy_scheduled_production_is_identifiable(self):
        value = run(event='schedule', display_title='Dashboard publication clock')
        self.assertTrue(wd.stalled(value, jobs(value), NOW))


class RecoveryTests(unittest.TestCase):
    def recover(self, api, **kwargs):
        return wd.recover(env(), api, NOW, reader(publication()), **kwargs)

    def test_cancel_only_stalled_and_leave_pending_successor(self):
        api = FakeAPI([run(), run(8, age=3, status='pending')])
        result = self.recover(api)
        self.assertEqual(result['cancelled'], [7])
        self.assertFalse(result['restart_requested'])
        self.assertEqual([call[0] for call in api.posts()], [wd.PREFIX + '/actions/runs/7/cancel'])

    def test_no_successor_restarts_once_and_second_check_does_not_duplicate(self):
        api = FakeAPI([run()])
        result = self.recover(api)
        self.assertTrue(result['restart_requested'])
        self.assertEqual(api.posts()[-1][2], {'ref': 'main', 'inputs': {'verify_only': 'false', 'remaining': '0'}})
        again = self.recover(api)
        self.assertFalse(again['restart_requested'])
        self.assertEqual(len(api.posts()), 2)

    def test_cancel_not_terminal_does_not_dispatch(self):
        api = FakeAPI([run()]); api.cancel_stays_active = True
        self.assertFalse(self.recover(api)['restart_requested'])
        self.assertEqual(len(api.posts()), 1)

    def test_cancel_conflict_never_force_cancels_or_dispatches(self):
        api = FakeAPI([run()]); api.cancel_error = RuntimeError('HTTP 409')
        with self.assertRaisesRegex(RuntimeError, '409'):
            self.recover(api)
        self.assertEqual(len(api.posts()), 1)
        self.assertTrue(api.posts()[0][0].endswith('/cancel'))

    def test_job_starts_during_revalidation(self):
        api = FakeAPI([run()]); api.mutate = lambda item: item.update(status='in_progress')
        self.assertEqual(self.recover(api)['cancelled'], [])
        self.assertEqual(api.posts(), [])

    def test_runner_assigned_during_revalidation(self):
        api = FakeAPI([run()])
        api.mutate = lambda item: setattr(api, 'job_override', jobs(item, runner_id=2))
        self.assertEqual(self.recover(api)['cancelled'], [])
        self.assertEqual(api.posts(), [])

    def test_pending_approval_or_wait_is_never_bypassed(self):
        api = FakeAPI([run()]); api.protections = [{'environment': {'name': 'dashboard-clock'}}]
        self.assertEqual(self.recover(api)['cancelled'], [])
        self.assertEqual(api.posts(), [])

    def test_dispatch_ambiguous_response_reconciles_next_time(self):
        api = FakeAPI([]); api.dispatch_error = RuntimeError('response uncertain')
        with self.assertRaisesRegex(RuntimeError, 'uncertain'):
            self.recover(api)
        self.assertEqual(len(api.posts()), 1)
        api.dispatch_error = None
        self.assertFalse(self.recover(api)['restart_requested'])
        self.assertEqual(len(api.posts()), 1)

    def test_recent_terminal_run_enforces_cooldown(self):
        api = FakeAPI([run(age=10, status='completed', conclusion='failure')])
        self.assertEqual(self.recover(api)['restart_cooldown_ids'], [7])
        self.assertEqual(api.posts(), [])

    def test_ambiguous_legacy_active_run_blocks_duplicate_chain(self):
        api = FakeAPI([run(display_title='Dashboard publication clock')])
        self.assertEqual(self.recover(api)['active_clock_ids'], [7])
        self.assertEqual(api.posts(), [])

    def test_known_verification_does_not_block_production_restart(self):
        api = FakeAPI([run(display_title=wd.VERIFY_NAME)])
        self.assertTrue(self.recover(api)['restart_requested'])
        self.assertEqual(len(api.posts()), 1)
        self.assertTrue(api.posts()[0][0].endswith('/dispatches'))

    def test_disabled_or_untrusted_context_cannot_mutate(self):
        api = FakeAPI([])
        self.assertEqual(wd.recover(env(CLOCK_ENABLED='false'), api), {'status': 'disabled'})
        for update in ({'GITHUB_REPOSITORY': 'other/repo'}, {'GITHUB_REF': 'refs/heads/other'},
                       {'GITHUB_EVENT_NAME': 'pull_request'}):
            with self.assertRaises(ValueError):
                wd.recover(env(**update), api)
        self.assertEqual(api.calls, [])

    def test_bad_inventory_fails_closed(self):
        writes = []
        def api(path, token, method='GET', body=None):
            if method != 'GET': writes.append(path)
            return {}
        with self.assertRaises(ValueError):
            self.recover(api)
        self.assertEqual(writes, [])

    def test_partial_inventory_and_malformed_rows_fail_before_any_write(self):
        for bad in ({'workflow_runs': [], 'total_count': 1},
                    {'workflow_runs': [run()], 'total_count': 2},
                    {'workflow_runs': [dict(run(), path=None)], 'total_count': 1},
                    {'workflow_runs': [dict(run(), repository={})], 'total_count': 1},
                    {'workflow_runs': [dict(run(), created_at='unknown')], 'total_count': 1}):
            writes = []
            def api(path, token, method='GET', body=None):
                if method != 'GET': writes.append(path)
                return bad
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.recover(api)
            self.assertEqual(writes, [])

    def test_recent_inventory_larger_than_one_page(self):
        rows = [run(i + 1, age=i, status='completed', conclusion='success') for i in range(101)]
        calls = []
        def api(path, token):
            calls.append(path)
            return {'workflow_runs': rows[:100], 'total_count': 101}
        self.assertEqual(len(wd.recent_production_runs(api, 'test', NOW)), 21)
        self.assertEqual(len(calls), 1)

    def test_one_cancel_maximum_per_invocation(self):
        api = FakeAPI([run(7, age=30), run(8, age=25)])
        result = self.recover(api)
        self.assertEqual(result['cancelled'], [7])
        self.assertEqual(len(api.posts()), 1)


class FreshnessTests(unittest.TestCase):
    def test_current_receipt_and_served_bytes_are_required(self):
        result = wd.freshness(NOW, '9', reader(publication()))
        self.assertTrue(result['fresh']); self.assertTrue(result['bytes_verified'])

    def test_stale_wrong_kind_wrong_publisher_future_time_or_slot(self):
        for changes in ({'logical_slot': '2026-10-05 16:00'}, {'kind': 'forward'}, {'publisher': 'other'},
                        {'published_at_utc': '2027-01-01T00:00:00+00:00'}, {'logical_slot': '2027-01-01 16:00'},
                        {'logical_slot': '2026-10-06 09:00'}, {'mode': 'daily'}):
            with self.subTest(changes=changes):
                self.assertFalse(wd.freshness(NOW, '9', reader(publication(**changes)))['fresh'])

    def test_each_public_file_hash_is_checked(self):
        for name in ('index.html', 'snapshot.json'):
            contents = publication(); contents[name] = b'old content'
            self.assertFalse(wd.freshness(NOW, '9', reader(contents))['fresh'])

    def test_snapshot_timestamp_cannot_be_stale_behind_new_receipt(self):
        contents = publication(); snap = json.loads(contents['snapshot.json']); snap['generated_at'] = '2026-10-05T11:02:00-04:00'
        contents['snapshot.json'] = json.dumps(snap).encode()
        receipt = json.loads(contents['cloud-runtime.json'])
        receipt['files']['snapshot.json'] = hashlib.sha256(contents['snapshot.json']).hexdigest()
        contents['cloud-runtime.json'] = json.dumps(receipt).encode()
        self.assertFalse(wd.freshness(NOW, '9', reader(contents))['fresh'])

    def test_old_generation_and_publication_cannot_be_relabelled_current_slot(self):
        contents = publication(published_at_utc='2026-10-05T15:02:20+00:00')
        snap = json.loads(contents['snapshot.json']); snap['generated_at'] = '2026-10-05T11:02:00-04:00'
        contents['snapshot.json'] = json.dumps(snap).encode()
        receipt = json.loads(contents['cloud-runtime.json'])
        receipt['files']['snapshot.json'] = hashlib.sha256(contents['snapshot.json']).hexdigest()
        contents['cloud-runtime.json'] = json.dumps(receipt).encode()
        self.assertFalse(wd.freshness(NOW, '9', reader(contents))['fresh'])

    def test_new_close_is_newer_than_prior_live_across_mode_transition(self):
        self.assertGreater(wd.slot_time('close', '2026-10-05'), wd.slot_time('live', '2026-10-05 16:00'))

    def test_sunday_and_dst_close_times(self):
        for date, expected in (('2026-10-04', '2026-10-05T00:00:00+00:00'),
                               ('2026-11-01', '2026-11-02T00:00:00+00:00'),
                               ('2026-11-02', '2026-11-03T01:30:00+00:00')):
            self.assertEqual(wd.slot_time('close', date).astimezone(timezone.utc).isoformat(), expected)

    def test_network_failure_cannot_report_healthy(self):
        def failed(url): raise OSError('unavailable')
        self.assertFalse(wd.freshness(NOW, '9', failed)['fresh'])


class TransportAndWorkflowTests(unittest.TestCase):
    def test_post_timeout_is_never_retried(self):
        with patch.object(wd.urllib.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = TimeoutError()
            with self.assertRaisesRegex(RuntimeError, 'uncertain'):
                wd.request(wd.PREFIX + '/actions/workflows/dashboard-clock.yml/dispatches', 'test', 'POST', {})
            self.assertEqual(opener.return_value.open.call_count, 1)

    def test_no_cross_repository_api_request(self):
        with self.assertRaises(ValueError):
            wd.request('/repos/other/repo/actions/runs/1/cancel', 'test', 'POST')

    def test_watchdog_is_independent_and_has_no_private_secret_access(self):
        text = (ROOT / '.github/workflows/dashboard-watchdog.yml').read_text()
        self.assertNotIn('secrets.', text)
        self.assertNotIn('environment:', text)
        self.assertIn('group: dashboard-watchdog-', text)
        self.assertIn('actions: write', text)
        self.assertIn('needs: tests', text)
        self.assertIn("needs.tests.result == 'success'", text)
        clock = (ROOT / '.github/workflows/dashboard-clock.yml').read_text()
        self.assertIn('run-name: Dashboard publication clock (', clock)
        self.assertIn('cancel-in-progress: false', clock)
        self.assertNotIn('  schedule:', clock)


if __name__ == '__main__':
    unittest.main()
