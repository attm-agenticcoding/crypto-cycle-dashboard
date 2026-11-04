import base64
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('clock', Path(__file__).resolve().parents[1] / 'scripts/dashboard_clock.py')
clock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clock)


class ClockTests(unittest.TestCase):
    def env(self):
        return {'GITHUB_REPOSITORY': clock.PUBLIC_REPOSITORY, 'GITHUB_REF': 'refs/heads/main',
                'GH_TOKEN': 'test-self-token', 'CLOCK_ENABLED': 'true', 'GITHUB_RUN_ID': '123',
                'CLOCK_SUCCESSOR_STATUS': 'successor-enqueued',
                'CYCLE_SOURCE_REPOSITORY': 'attm-agenticcoding/test-private-source',
                'CYCLE_CLOCK_INSTALLATION_ID': '456'}

    def test_weekday_boundaries_and_four_hour_spacing(self):
        for date in ('2026-03-06','2026-03-09','2026-10-20','2026-10-30','2026-11-02'):
            for instant, mode, slot in [('06:30','close',None),('08:29','close',None),
                    ('08:30','live','08:30'),('09:30','live','08:30'),('10:29','live','08:30'),
                    ('10:30','live','08:30'),('12:30','live','12:30'),('14:30','live','12:30'),
                    ('16:00','live','12:30'),('16:30','live','16:30'),('20:29','live','16:30'),
                    ('20:30','close',date),('23:59','close',date)]:
                now=datetime.fromisoformat(f'{date}T{instant}').replace(tzinfo=clock.ET)
                target=slot if slot else (now.date()-clock.timedelta(days=1)).isoformat()
                if mode=='live':target=f'{date} {slot}'
                self.assertEqual(clock.target_at(now),(mode,target))
            self.assertEqual([h*60+m for h,m in clock.LIVE_TIMES],[510,750,990])

    def test_weekends_only_close_and_sunday_follows_new_york_dst(self):
        for date in ('2026-03-07','2026-03-08','2026-10-31','2026-11-01'):
            for hour in range(24):
                now=datetime.fromisoformat(f'{date}T{hour:02d}:30').replace(tzinfo=clock.ET)
                day=now.date() if hour>=20 else now.date()-clock.timedelta(days=1)
                self.assertEqual(clock.target_at(now),('close',day.isoformat()))
        for date,utc in [('2026-03-08','2026-03-09T00:30:00+00:00'),('2026-11-01','2026-11-02T01:30:00+00:00')]:
            self.assertEqual(clock.close_at(datetime.fromisoformat(date).date()).astimezone(clock.timezone.utc).isoformat(),utc)

    def test_removed_slots_do_not_dispatch_private(self):
        for date,slot,start,count in [('2026-10-20','08:30','08:30',240),('2026-10-20','12:30','12:30',240)]:
            receipt={'publisher':'github-actions','kind':'main','mode':'live','logical_slot':f'{date} {slot}'}
            with patch.object(clock,'refresh_private') as private:
                for minute in range(count):
                    now=datetime.fromisoformat(f'{date}T{start}').replace(tzinfo=clock.ET)+clock.timedelta(minutes=minute)
                    self.assertEqual(clock.advance(self.env(),False,0,read_receipt=lambda:receipt,now=now)['status'],'already-published')
                private.assert_not_called()
        receipt={'publisher':'github-actions','kind':'main','mode':'close','logical_slot':'2026-10-23'}
        now=datetime.fromisoformat('2026-10-24T16:00').replace(tzinfo=clock.ET)
        with patch.object(clock,'refresh_private') as private:
            self.assertEqual(clock.advance(self.env(),False,0,read_receipt=lambda:receipt,now=now)['status'],'already-published')
            private.assert_not_called()

    def test_legacy_two_hour_receipts_do_not_create_retry_loop(self):
        for old,clock_time,next_slot in [('10:30','11:45','12:30'),('14:30','15:45','16:30')]:
            receipt={'publisher':'github-actions','kind':'main','mode':'live','logical_slot':f'2026-10-20 {old}'}
            with patch.object(clock,'refresh_private') as private:
                now=datetime.fromisoformat(f'2026-10-20T{clock_time}').replace(tzinfo=clock.ET)
                self.assertEqual(clock.advance(self.env(),False,0,read_receipt=lambda:receipt,now=now)['status'],'already-published')
                private.assert_not_called()
                now=datetime.fromisoformat(f'2026-10-20T{next_slot}').replace(tzinfo=clock.ET)
                clock.advance(self.env(),False,0,read_receipt=lambda:receipt,now=now)
                private.assert_called_once()

    def test_verification_never_dispatches_again_or_reads_private_credentials(self):
        calls = []
        env = self.env()
        request = lambda *args: calls.append(args) or {}
        with patch.object(clock, 'refresh_private') as private:
            result = clock.advance(env, True, 1, request)
            self.assertTrue(result['successor_enqueued'])
            env['CLOCK_SUCCESSOR_STATUS'] = 'verification-complete'
            clock.advance(env, True, 0, request)
            self.assertEqual(calls, [])
            private.assert_not_called()

    def test_wrong_branch_or_repository_cannot_use_the_clock(self):
        for update in [{'GITHUB_REF': 'refs/heads/untrusted'}, {'GITHUB_REPOSITORY': 'other/fork'}]:
            env = self.env(); env.update(update)
            with self.assertRaises(ValueError): clock.advance(env, False, 0)

    def test_disabled_production_does_not_enqueue_or_publish(self):
        env = self.env(); env['CLOCK_ENABLED'] = 'false'
        with patch.object(clock, 'api') as request, patch.object(clock, 'refresh_private') as private:
            self.assertEqual(clock.advance(env, False, 0, request), {'status': 'disabled'})
            request.assert_not_called(); private.assert_not_called()

    def test_verification_cannot_create_an_unbounded_chain(self):
        for value in (-1, 2, 100):
            with self.assertRaises(ValueError): clock.advance(self.env(), True, value)

    def test_completed_publication_skips_private_credentials_but_keeps_clock_running(self):
        receipt = {'publisher': 'github-actions', 'kind': 'main', 'mode': 'live', 'logical_slot': '2026-10-06 08:30'}
        calls = []
        with patch.object(clock, 'refresh_private') as private:
            result = clock.advance(self.env(), False, 0, lambda *args: calls.append(args) or {}, lambda: receipt,
                                   datetime.fromisoformat('2026-10-06T15:05:00+00:00'))
            self.assertEqual(result['status'], 'already-published')
            self.assertEqual(calls, [])
            private.assert_not_called()

    def test_a_source_failure_never_dispatches_another_successor(self):
        calls = []
        with patch.object(clock, 'refresh_private', side_effect=RuntimeError('source unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'source unavailable'):
                clock.advance(self.env(), False, 0, lambda *args: calls.append(args) or {}, lambda: {})
        self.assertEqual(calls, [])

    def test_publication_requires_confirmed_successor_scheduling(self):
        for status in (None, '', 'disabled', 'verification-complete', 'unknown'):
            env = self.env(); env['CLOCK_SUCCESSOR_STATUS'] = status
            with patch.object(clock, 'refresh_private') as private, self.assertRaisesRegex(ValueError, 'Successor'):
                clock.advance(env, False, 0)
            private.assert_not_called()

    def test_existing_successor_allows_publication_without_another_dispatch(self):
        env = self.env(); env['CLOCK_SUCCESSOR_STATUS'] = 'successor-already-active'
        with patch.object(clock, 'refresh_private', return_value='refresh-already-running') as private:
            self.assertEqual(clock.advance(env, False, 0, read_receipt=lambda: {})['status'], 'refresh-already-running')
            private.assert_called_once()

    def mock_private(self, extra_permission=False, running=False, fail_dispatch=False):
        calls = []
        def request(path, token, method='GET', body=None):
            calls.append((path, method, body))
            if path.endswith('/access_tokens'):
                self.assertEqual(body, {'repositories': ['test-private-source'], 'permissions': {'actions': 'write'}})
                return {'token': 'test-installation-token', 'permissions': {'actions': 'write', 'metadata': 'read',
                        **({'contents': 'write'} if extra_permission else {})}, 'repositories': [
                        {'full_name': 'attm-agenticcoding/test-private-source', 'private': True}]}
            if '/runs?' in path: return {'total_count': 1 if running else 0, 'workflow_runs': [{'id': 999}] if running else []}
            if path.endswith('/dispatches'):
                self.assertEqual(body, {'ref': 'main', 'inputs': {'mode': 'auto', 'force': 'false', 'publish': 'true'}})
                if fail_dispatch: raise RuntimeError('dispatch failed')
                return {}
            self.assertEqual((path, method), ('/installation/token', 'DELETE'))
            return {}
        return calls, request

    def test_refresh_uses_only_actions_scope_and_revokes_token(self):
        calls, request = self.mock_private()
        with patch.object(clock, 'app_jwt', return_value='test-jwt'):
            self.assertEqual(clock.refresh_private(self.env(), request), 'refresh-requested')
        self.assertEqual(calls[-1][:2], ('/installation/token', 'DELETE'))

    def test_broader_permissions_are_refused_before_dispatch(self):
        calls, request = self.mock_private(extra_permission=True)
        with patch.object(clock, 'app_jwt', return_value='test-jwt'), self.assertRaisesRegex(RuntimeError, 'scope'):
            clock.refresh_private(self.env(), request)
        self.assertFalse(any(path.endswith('/dispatches') for path, _, _ in calls))
        self.assertEqual(calls[-1][:2], ('/installation/token', 'DELETE'))

    def test_in_progress_source_does_not_get_another_dispatch(self):
        calls, request = self.mock_private(running=True)
        with patch.object(clock, 'app_jwt', return_value='test-jwt'):
            self.assertEqual(clock.refresh_private(self.env(), request), 'refresh-already-running')
        self.assertFalse(any(path.endswith('/dispatches') for path, _, _ in calls))

    def test_failed_private_dispatch_also_revokes_the_token(self):
        calls, request = self.mock_private(fail_dispatch=True)
        with patch.object(clock, 'app_jwt', return_value='test-jwt'), self.assertRaisesRegex(RuntimeError, 'dispatch uncertain'):
            clock.refresh_private(self.env(), request)
        self.assertEqual(calls[-1][:2], ('/installation/token', 'DELETE'))

    def test_jwt_has_a_real_rsa_signature_and_short_expiry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); key = root / 'key.pem'; public = root / 'public.pem'
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key)], check=True, capture_output=True)
            subprocess.run(['openssl', 'pkey', '-in', str(key), '-pubout', '-out', str(public)], check=True, capture_output=True)
            jwt = clock.app_jwt('123', key.read_text(), now=1000)
            header, payload, signature = jwt.split('.')
            claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            self.assertEqual(claims, {'iat': 940, 'exp': 1540, 'iss': '123'})
            sig = root / 'signature'; sig.write_bytes(base64.urlsafe_b64decode(signature + '=' * (-len(signature) % 4)))
            verified = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(public), '-signature', str(sig)],
                                      input=f'{header}.{payload}'.encode(), capture_output=True)
            self.assertEqual(verified.returncode, 0)


    def test_all_mutations_attempt_once_but_transient_gets_retry(self):
        import urllib.error
        for method, expected in [('POST', 1), ('DELETE', 1), ('GET', 3)]:
            for failure in (TimeoutError(), urllib.error.URLError('offline'),
                            urllib.error.HTTPError('https://api.github.com', 503, 'busy', {}, None),
                            urllib.error.HTTPError('https://api.github.com', 429, 'limited', {}, None)):
                with self.subTest(method=method, failure=type(failure).__name__), \
                        patch.object(clock.urllib.request, 'build_opener') as opener, \
                        patch.object(clock.time, 'sleep') as sleep:
                    opener.return_value.open.side_effect = failure
                    with self.assertRaises(RuntimeError):
                        clock.api('/test-only', 'fake-token', method)
                    self.assertEqual(opener.return_value.open.call_count, expected)
                    self.assertEqual(sleep.call_count, expected - 1)
        for code in (302, 401, 403, 404):
            with patch.object(clock.urllib.request, 'build_opener') as opener, patch.object(clock.time, 'sleep') as sleep:
                opener.return_value.open.side_effect = urllib.error.HTTPError('https://api.github.com', code, 'denied', {}, None)
                with self.assertRaises(RuntimeError):
                    clock.api('/test-only', 'fake-token')
                self.assertEqual(opener.return_value.open.call_count, 1)
                sleep.assert_not_called()

    def test_private_dispatch_lost_response_reconciles_and_revokes_without_retry(self):
        for accepted, read_denied in ((True, False), (False, False), (True, True)):
            calls, base = self.mock_private()
            dispatched = [False]
            def request(path, token, method='GET', body=None):
                if dispatched[0] and '/runs?' in path:
                    calls.append((path, method, body))
                    if read_denied:
                        raise RuntimeError('read denied')
                    return {'total_count': int(accepted), 'workflow_runs': [{'id': 999}] if accepted else []}
                result = base(path, token, method, body)
                if path.endswith('/dispatches'):
                    dispatched[0] = True
                    raise TimeoutError('response lost after possible acceptance')
                return result
            with patch.object(clock, 'app_jwt', return_value='test-jwt'), \
                    self.assertRaisesRegex(RuntimeError, 'dispatch uncertain.*no retry'):
                clock.refresh_private(self.env(), request)
            self.assertEqual(sum(p.endswith('/dispatches') for p, _, _ in calls), 1)
            post_index = next(i for i, (p, _, _) in enumerate(calls) if p.endswith('/dispatches'))
            self.assertIn('/runs?', calls[post_index + 1][0])
            self.assertEqual(calls[-1][:2], ('/installation/token', 'DELETE'))

    def test_every_private_active_state_blocks_and_missing_inventory_fails_closed(self):
        states = ('requested', 'pending', 'waiting', 'queued', 'in_progress')
        for state in states:
            calls, base = self.mock_private()
            def request(path, token, method='GET', body=None):
                if '/runs?' in path:
                    calls.append((path, method, body))
                    active = f'status={state}&' in path
                    return {'total_count': int(active), 'workflow_runs': [{'id': 999}] if active else []}
                return base(path, token, method, body)
            with patch.object(clock, 'app_jwt', return_value='test-jwt'):
                self.assertEqual(clock.refresh_private(self.env(), request), 'refresh-already-running')
            self.assertFalse(any(p.endswith('/dispatches') for p, _, _ in calls))
        for payload in ({}, [], {'total_count': 0}, {'total_count': 1, 'workflow_runs': []},
                        {'total_count': -1, 'workflow_runs': []}, {'total_count': False, 'workflow_runs': []}):
            calls, base = self.mock_private()
            def request(path, token, method='GET', body=None):
                if '/runs?' in path:
                    return payload
                return base(path, token, method, body)
            with patch.object(clock, 'app_jwt', return_value='test-jwt'), self.assertRaises(ValueError):
                clock.refresh_private(self.env(), request)
            self.assertFalse(any(p.endswith('/dispatches') for p, _, _ in calls))
            self.assertEqual(calls[-1][:2], ('/installation/token', 'DELETE'))

    def test_accepted_transport_post_is_not_repeated_even_when_reading_response_fails(self):
        class LostResponse:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): raise TimeoutError('accepted, response lost')
        with patch.object(clock.urllib.request, 'build_opener') as opener, patch.object(clock.time, 'sleep') as sleep:
            opener.return_value.open.return_value = LostResponse()
            with self.assertRaises(RuntimeError):
                clock.api('/test-only/dispatches', 'fake-token', 'POST', {})
            self.assertEqual(opener.return_value.open.call_count, 1)
            sleep.assert_not_called()


if __name__ == '__main__': unittest.main()
