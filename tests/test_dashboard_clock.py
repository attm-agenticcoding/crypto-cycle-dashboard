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

    def test_weekday_boundaries_and_two_hour_spacing(self):
        for date in ('2026-03-06','2026-03-09','2026-10-20','2026-10-30','2026-11-02'):
            for instant, mode, slot in [('06:30','close',None),('08:29','close',None),
                    ('08:30','live','08:30'),('09:30','live','08:30'),('10:29','live','08:30'),
                    ('10:30','live','10:30'),('12:30','live','12:30'),('14:30','live','14:30'),
                    ('16:00','live','14:30'),('16:30','live','16:30'),('20:29','live','16:30'),
                    ('20:30','close',date),('23:59','close',date)]:
                now=datetime.fromisoformat(f'{date}T{instant}').replace(tzinfo=clock.ET)
                target=slot if slot else (now.date()-clock.timedelta(days=1)).isoformat()
                if mode=='live':target=f'{date} {slot}'
                self.assertEqual(clock.target_at(now),(mode,target))
            self.assertEqual([h*60+m for h,m in clock.LIVE_TIMES],[510,630,750,870,990])

    def test_weekends_only_close_and_sunday_follows_new_york_dst(self):
        for date in ('2026-03-07','2026-03-08','2026-10-31','2026-11-01'):
            for hour in range(24):
                now=datetime.fromisoformat(f'{date}T{hour:02d}:30').replace(tzinfo=clock.ET)
                day=now.date() if hour>=20 else now.date()-clock.timedelta(days=1)
                self.assertEqual(clock.target_at(now),('close',day.isoformat()))
        for date,utc in [('2026-03-08','2026-03-09T00:30:00+00:00'),('2026-11-01','2026-11-02T01:30:00+00:00')]:
            self.assertEqual(clock.close_at(datetime.fromisoformat(date).date()).astimezone(clock.timezone.utc).isoformat(),utc)

    def test_removed_slots_do_not_dispatch_private(self):
        for date,slot,start,count in [('2026-10-20','08:30','08:30',120),('2026-10-20','14:30','14:30',120)]:
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
        receipt = {'publisher': 'github-actions', 'kind': 'main', 'mode': 'live', 'logical_slot': '2026-10-06 10:30'}
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
            if '/runs?' in path: return {'total_count': 1 if running else 0}
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
        with patch.object(clock, 'app_jwt', return_value='test-jwt'), self.assertRaisesRegex(RuntimeError, 'dispatch failed'):
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


if __name__ == '__main__': unittest.main()
