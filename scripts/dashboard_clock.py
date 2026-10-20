"""A GitHub-only publication clock; private code never enters this runner."""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

PUBLIC_REPOSITORY = 'attm-agenticcoding/crypto-cycle-dashboard'
RECEIPT_URL = 'https://attm-agenticcoding.github.io/crypto-cycle-dashboard/cloud-runtime.json'
WORKFLOW = 'dashboard-clock.yml'
ET = ZoneInfo('America/New_York')


LIVE_TIMES = [(8, 30), (12, 30), (16, 30)]


def close_at(day):
    return datetime.combine(day, datetime.min.time().replace(hour=20, minute=30), ET)


def target_at(now):
    now = now.astimezone(ET)
    day = now.date()
    if now >= close_at(day):
        return 'close', day.isoformat()
    if day.weekday() < 5:
        slots = [datetime.combine(day, datetime.min.time().replace(hour=h, minute=m), ET) for h, m in LIVE_TIMES]
        past = [slot for slot in slots if slot <= now]
        if past:
            return 'live', max(past).strftime('%Y-%m-%d %H:%M')
    return 'close', (day - timedelta(days=1)).isoformat()


def is_current(receipt, target):
    return (receipt.get('publisher') == 'github-actions' and receipt.get('kind') == 'main'
            and receipt.get('mode') == target[0] and isinstance(receipt.get('logical_slot'), str)
            and receipt['logical_slot'] >= target[1])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(path, token, method='GET', body=None):
    if not path.startswith('/') or path.startswith('//'):
        raise ValueError('Invalid API path')
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request('https://api.github.com' + path, data=data, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json', 'User-Agent': 'dashboard-publication-clock',
                 'X-GitHub-Api-Version': '2022-11-28'})
    for attempt in range(3):
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
                payload = response.read()
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as exc:
            retry = exc.code >= 500 or exc.code == 429
            message = f'GitHub API returned HTTP {exc.code}'
        except (urllib.error.URLError, TimeoutError):
            retry = True
            message = 'GitHub API connection failed'
        if not retry or attempt == 2:
            raise RuntimeError(message) from None
        time.sleep(attempt + 1)


def app_jwt(app_id, pem, now=None):
    if not str(app_id).isdigit() or 'PRIVATE KEY-----' not in pem:
        raise ValueError('Scoped clock App credentials are not configured')
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
    seconds = int(time.time() if now is None else now)
    message = encode({'alg': 'RS256', 'typ': 'JWT'}) + b'.' + encode({'iat': seconds - 60, 'exp': seconds + 540, 'iss': str(app_id)})
    with tempfile.TemporaryDirectory(prefix='clock-key-') as temporary:
        key = Path(temporary) / 'app.pem'
        key.write_text(pem)
        key.chmod(0o600)
        result = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key)],
                                input=message, capture_output=True, check=False)
        if result.returncode:
            raise RuntimeError('App signature failed')
    return (message + b'.' + base64.urlsafe_b64encode(result.stdout).rstrip(b'=')).decode()


def refresh_private(env, request=api):
    repository = env.get('CYCLE_SOURCE_REPOSITORY', '')
    installation_id = env.get('CYCLE_CLOCK_INSTALLATION_ID', '')
    if not re.fullmatch(r'attm-agenticcoding/[A-Za-z0-9_.-]+', repository) or not installation_id.isdigit():
        raise ValueError('Scoped clock installation is not configured')
    jwt = app_jwt(env.get('CYCLE_CLOCK_APP_ID', ''), env.get('CYCLE_CLOCK_PRIVATE_KEY', ''))
    installation = request(f'/app/installations/{installation_id}/access_tokens', jwt, 'POST',
        {'repositories': [repository.split('/')[1]], 'permissions': {'actions': 'write'}})
    token = installation.get('token')
    if not token:
        raise RuntimeError('Installation token was not returned')
    try:
        permissions = installation.get('permissions', {})
        repositories = installation.get('repositories', [])
        if (permissions.get('actions') != 'write'
            or any(key not in ('actions', 'metadata') and value != 'none' for key, value in permissions.items())
            or len(repositories) != 1 or repositories[0].get('full_name') != repository
            or repositories[0].get('private') is not True):
            raise RuntimeError('Refusing unexpected installation scope')
        workflow = f'/repos/{repository}/actions/workflows/dashboard-cloud.yml'
        for status in ('in_progress', 'queued'):
            runs = request(workflow + f'/runs?status={status}&per_page=1', token)
            if runs.get('total_count', 0):
                return 'refresh-already-running'
        request(workflow + '/dispatches', token, 'POST',
                {'ref': 'main', 'inputs': {'mode': 'auto', 'force': 'false', 'publish': 'true'}})
        return 'refresh-requested'
    finally:
        request('/installation/token', token, 'DELETE')


def advance(env, verify_only, remaining, request=api, read_receipt=None, now=None):
    if env.get('GITHUB_REPOSITORY') != PUBLIC_REPOSITORY or env.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('Clock is restricted to the existing public main branch')
    if remaining not in (0, 1):
        raise ValueError('Verification is bounded to at most two ticks')
    if not verify_only and env.get('CLOCK_ENABLED') != 'true':
        return {'status': 'disabled'}
    # The inline workflow step schedules before checkout. Never dispatch here:
    # retrying publication or reaching this script must not create a second chain.
    successor = env.get('CLOCK_SUCCESSOR_STATUS')
    expected = ('successor-enqueued', 'successor-already-active') if not verify_only or remaining else ('verification-complete',)
    if successor not in expected:
        raise ValueError('Successor scheduling must complete before publication')
    if verify_only:
        return {'status': 'clock-verified', 'successor_enqueued': successor == 'successor-enqueued',
                'successor_status': successor,
                'run_id': env.get('GITHUB_RUN_ID'), 'actor': env.get('GITHUB_ACTOR')}
    target = target_at(now or datetime.now(timezone.utc))
    try:
        if read_receipt is None:
            req = urllib.request.Request(RECEIPT_URL + '?clock=' + env.get('GITHUB_RUN_ID', 'manual'),
                    headers={'Cache-Control': 'no-cache', 'User-Agent': 'dashboard-publication-clock'})
            with urllib.request.urlopen(req, timeout=15) as response:
                receipt = json.load(response)
        else:
            receipt = read_receipt()
        if is_current(receipt, target):
            return {'status': 'already-published', 'mode': target[0], 'slot': target[1]}
    except (OSError, ValueError, TypeError):
        pass  # The private runner independently checks its durable completion markers.
    return {'status': refresh_private(env, request), 'mode': target[0], 'slot': target[1]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', choices=('true', 'false'), required=True)
    parser.add_argument('--remaining', type=int, default=0)
    args = parser.parse_args()
    print(json.dumps(advance(os.environ, args.verify_only == 'true', args.remaining)))


if __name__ == '__main__':
    main()
