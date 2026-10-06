"""Narrow public-clock recovery; no private source or App credentials are used."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

from dashboard_clock import PUBLIC_REPOSITORY, WORKFLOW, RECEIPT_URL, ET, target_at, NoRedirect

PREFIX = f'/repos/{PUBLIC_REPOSITORY}'
CLOCK_PATH = '.github/workflows/' + WORKFLOW
PRODUCTION_NAME = 'Dashboard publication clock (production)'
VERIFY_NAME = 'Dashboard publication clock (verify)'
THRESHOLD = timedelta(minutes=20)
ACTIVE = ('requested', 'pending', 'waiting', 'queued', 'in_progress')


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Missing timestamp')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timestamp must include timezone')
    return result.astimezone(timezone.utc)


def request(path, token, method='GET', body=None):
    # Fixed repository, fixed endpoints supplied only by this program.
    if not path.startswith(PREFIX + '/actions/'):
        raise ValueError('Watchdog API target is outside the public repository')
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request('https://api.github.com' + path, data=payload, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json', 'User-Agent': 'dashboard-queue-watchdog',
                 'X-GitHub-Api-Version': '2022-11-28'})
    # POST is deliberately attempted once. An ambiguous response must not cause
    # duplicate dispatches or repeated cancellations; the next check reconciles.
    attempts = 3 if method == 'GET' else 1
    for attempt in range(attempts):
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
                data = response.read()
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as exc:
            if method != 'GET' or exc.code < 500 or attempt == attempts - 1:
                raise RuntimeError(f'GitHub {method} returned HTTP {exc.code}; reconcile before retry') from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise RuntimeError(f'GitHub {method} response uncertain; reconcile on next check') from None
        time.sleep(attempt + 1)


def clock_run(run):
    return (run.get('path') == CLOCK_PATH and run.get('head_branch') == 'main'
            and run.get('event') in ('schedule', 'workflow_dispatch')
            and run.get('repository', {}).get('full_name') == PUBLIC_REPOSITORY)


def production_run(run):
    # Older manual runs have no public input discriminator: never cancel them.
    return clock_run(run) and (run.get('event') == 'schedule'
                              or run.get('display_title') == PRODUCTION_NAME)


def is_blocker(run):
    # An ambiguous old manual run might be production. Conservatively do not
    # launch a second chain beside it; known verify runs have a separate group.
    return (clock_run(run) and run.get('status') in ACTIVE
            and run.get('display_title') != VERIFY_NAME)


def inventory_page(payload, page):
    rows = payload.get('workflow_runs')
    total = payload.get('total_count')
    if (not isinstance(rows, list) or type(total) is not int or total < 0
            or len(rows) != min(100, max(0, total - (page - 1) * 100))):
        raise ValueError('Incomplete run inventory; refusing recovery')
    for run in rows:
        if (not isinstance(run, dict) or type(run.get('id')) is not int or run['id'] <= 0
                or any(not isinstance(run.get(field), str) or not run[field]
                       for field in ('path', 'head_branch', 'event', 'display_title', 'status'))
                or not isinstance(run.get('repository'), dict)
                or not isinstance(run['repository'].get('full_name'), str)
                or type(run.get('run_attempt')) is not int or run['run_attempt'] < 1
                or 'conclusion' not in run):
            raise ValueError('Malformed run identity; refusing recovery')
        timestamp(run.get('created_at'))
        timestamp(run.get('updated_at'))
    return rows


def active_runs(api, token):
    found = {}
    for status in ACTIVE:
        for page in range(1, 11):
            payload = api(f'{PREFIX}/actions/workflows/{WORKFLOW}/runs?status={status}&per_page=100&page={page}', token)
            rows = inventory_page(payload, page)
            for run in rows:
                found[run['id']] = run
            if len(rows) < 100:
                break
        else:
            raise ValueError('Run inventory exceeds safety bound; refusing recovery')
    return list(found.values())


def recent_production_runs(api, token, now):
    found = []
    for page in range(1, 11):
        payload = api(f'{PREFIX}/actions/workflows/{WORKFLOW}/runs?per_page=100&page={page}', token)
        rows = inventory_page(payload, page)
        dates = []
        for run in rows:
            dates.append(timestamp(run.get('created_at')))
            if production_run(run) and now - dates[-1] <= THRESHOLD:
                found.append(run['id'])
        # GitHub returns workflow runs newest first. Read all pages that could
        # overlap the cooldown; do not mistake the normal 100-row cap for empty.
        if len(rows) < 100 or (dates and min(dates) < now - THRESHOLD):
            return found
    raise ValueError('Recent run inventory exceeds safety bound; refusing dispatch')


def stalled(run, jobs, now):
    if (not production_run(run) or run.get('status') != 'queued'
            or run.get('conclusion') is not None or run.get('run_attempt') != 1):
        return False
    if not isinstance(jobs, dict) or jobs.get('total_count') != 1 or len(jobs.get('jobs', [])) != 1:
        return False
    job = jobs['jobs'][0]
    if (job.get('name') != 'tick' or job.get('run_id') != run.get('id')
            or job.get('run_attempt') != 1 or job.get('status') != 'queued'
            or job.get('conclusion') is not None or job.get('steps') != []
            or 'runner_id' not in job or job['runner_id'] is not None
            or job.get('runner_name') not in (None, '') or job.get('runner_group_id') is not None):
        return False
    try:
        # updated_at includes the transition out of the five-minute environment
        # wait. This conservative maximum never counts that wait as queue age.
        since = max(timestamp(run['created_at']), timestamp(run['updated_at']), timestamp(job['created_at']))
        return now - since > THRESHOLD
    except (KeyError, TypeError, ValueError):
        return False


def slot_time(mode, slot):
    if mode == 'live':
        result = datetime.strptime(slot, '%Y-%m-%d %H:%M').replace(tzinfo=ET)
        if result.strftime('%H:%M') != '06:30' and not (9 <= result.hour <= 16 and result.minute in (0, 30)
            and '09:30' <= result.strftime('%H:%M') <= '16:00'):
            raise ValueError('Invalid live slot')
        return result
    if mode == 'close':
        day = datetime.strptime(slot, '%Y-%m-%d').date()
        if day.weekday() == 6:
            return datetime.combine(day + timedelta(days=1), datetime.min.time(), timezone.utc)
        return datetime.combine(day, datetime.min.time().replace(hour=20, minute=30), ET)
    raise ValueError('Not a main publication mode')


def public_bytes(url):
    req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'dashboard-queue-watchdog'})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
        return response.read(2_000_001)


def freshness(now, run_id, read=public_bytes):
    """Check actual index/snapshot bytes against the public publication receipt."""
    required = target_at(now - THRESHOLD)
    result = {'fresh': False, 'required_mode': required[0], 'required_slot': required[1]}
    try:
        suffix = '?watchdog=' + str(int(run_id))
        receipt = json.loads(read(RECEIPT_URL + suffix))
        if receipt.get('publisher') != 'github-actions' or receipt.get('kind') != 'main':
            raise ValueError('Receipt is not a main publication')
        published = timestamp(receipt.get('published_at_utc'))
        if published > now + timedelta(minutes=5):
            raise ValueError('Future publication time')
        actual_slot = slot_time(receipt.get('mode'), receipt.get('logical_slot'))
        if actual_slot > now + timedelta(minutes=5):
            raise ValueError('Future logical slot')
        if published < actual_slot - timedelta(minutes=5):
            raise ValueError('Publication time predates its claimed logical slot')
        for name in ('snapshot.json', 'index.html'):
            data = read(RECEIPT_URL.rsplit('/', 1)[0] + '/' + name + suffix)
            if len(data) > 2_000_000 or hashlib.sha256(data).hexdigest() != receipt.get('files', {}).get(name):
                raise ValueError('Served ' + name + ' does not match publication receipt')
            if name == 'snapshot.json':
                snapshot = json.loads(data)
                generated = timestamp(snapshot.get('generated_at'))
                if snapshot.get('masked') is not True or snapshot.get('run_kind') != receipt.get('mode'):
                    raise ValueError('Snapshot publication contract mismatch')
                if generated > published + timedelta(minutes=5) or published - generated > timedelta(minutes=20):
                    raise ValueError('Snapshot generation time does not match publication')
                if generated < actual_slot - timedelta(minutes=5):
                    raise ValueError('Snapshot generation time predates its claimed logical slot')
        result.update(mode=receipt['mode'], slot=receipt['logical_slot'], generated_at=snapshot['generated_at'],
                      published_at_utc=receipt['published_at_utc'], bytes_verified=True,
                      fresh=actual_slot >= slot_time(*required))
        if not result['fresh']:
            result['error'] = 'Main publication is behind the 20-minute grace target'
    except (OSError, TypeError, KeyError, ValueError) as exc:
        result['error'] = str(exc)
    return result


def recover(env, api=request, now=None, read=public_bytes):
    if (env.get('GITHUB_REPOSITORY') != PUBLIC_REPOSITORY or env.get('GITHUB_REF') != 'refs/heads/main'
            or env.get('GITHUB_EVENT_NAME') not in ('schedule', 'workflow_dispatch', 'push')):
        raise ValueError('Watchdog is restricted to trusted main events')
    if env.get('CLOCK_ENABLED') != 'true':
        return {'status': 'disabled'}
    now = now or datetime.now(timezone.utc)
    token = env['GH_TOKEN']
    result = {'cancelled': [], 'cancel_requested': [], 'restart_requested': False}
    runs = active_runs(api, token)
    for candidate in sorted(runs, key=lambda run: run.get('created_at', '')):
        if not production_run(candidate) or candidate.get('status') != 'queued':
            continue
        run_id = int(candidate['id'])
        path = f'{PREFIX}/actions/runs/{run_id}'
        run = api(path, token)
        jobs = api(path + '/jobs?filter=latest&per_page=100', token)
        if not stalled(run, jobs, now):
            continue
        # Never bypass a pending approval or environment protection rule.
        if api(path + '/pending_deployments', token) != []:
            continue
        # Reduce the queue-to-runner race using fresh metadata and jobs. REST
        # cancellation has no atomic conditional operation; that residual race
        # cannot be eliminated by a client-side predicate.
        run = api(path, token)
        jobs = api(path + '/jobs?filter=latest&per_page=100', token)
        if not stalled(run, jobs, now):
            continue
        api(path + '/cancel', token, 'POST')
        result['cancel_requested'].append(run_id)
        terminal = api(path, token)
        if terminal.get('status') == 'completed' and terminal.get('conclusion') == 'cancelled':
            result['cancelled'].append(run_id)
        break  # At most one cancellation per check; no broad cleanup loops.
    # A pre-existing pending successor should take over without another dispatch.
    # If cancellation is still asynchronous, its active run also blocks dispatch.
    remaining = [run for run in active_runs(api, token) if is_blocker(run)]
    result['active_clock_ids'] = sorted(run['id'] for run in remaining)
    if not remaining:
        # A visible terminal clock in the last twenty minutes is a dispatch
        # cooldown for ambiguous prior responses and canceled manual attempts.
        cooling = recent_production_runs(api, token, now)
        if cooling:
            result['restart_cooldown_ids'] = cooling
        else:
            api(f'{PREFIX}/actions/workflows/{WORKFLOW}/dispatches', token, 'POST',
                {'ref': 'main', 'inputs': {'verify_only': 'false', 'remaining': '0'}})
            result['restart_requested'] = True
    result['publication'] = freshness(now, env['GITHUB_RUN_ID'], read)
    result['status'] = 'healthy' if result['publication']['fresh'] else 'publication-not-fresh'
    return result


def main():
    result = recover(os.environ)
    print(json.dumps(result, sort_keys=True))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as output:
            output.write('### Main dashboard queue and freshness check\n\n```json\n'
                         + json.dumps(result, indent=2, sort_keys=True) + '\n```\n')
    if result.get('status') == 'publication-not-fresh':
        print('::error::Main dashboard publication is stale or its served bytes could not be verified; recovery is not yet confirmed.')
        raise SystemExit(1)


if __name__ == '__main__':
    main()
