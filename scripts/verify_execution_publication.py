"""Request the existing branch-based Pages build and verify served parameter bytes."""
import hashlib
import os
from pathlib import Path
import subprocess
import time
import urllib.request


def served_digest(url):
    request = urllib.request.Request(url + '?calibration=' + str(time.time_ns()),
                                     headers={'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return hashlib.sha256(response.read()).hexdigest()
    except (OSError, TimeoutError):
        return None


def verify(repository, path, attempts=60, pause=10):
    owner, name = repository.split('/')
    url = f'https://{owner}.github.io/{name}/data/execution_params.json'
    expected = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if served_digest(url) == expected:
        print('Pages parameters already verified:', expected)
        return
    # GITHUB_TOKEN commits do not trigger the legacy Pages build automatically.
    subprocess.run(['gh', 'api', '--method', 'POST',
                    f'repos/{repository}/pages/builds'], check=True, timeout=60)
    for _ in range(attempts):
        if served_digest(url) == expected:
            print('Pages parameters verified:', expected)
            return
        time.sleep(pause)
    raise RuntimeError('Pages parameters do not match the committed calibration bundle')


if __name__ == '__main__':
    verify(os.environ['GITHUB_REPOSITORY'], 'data/execution_params.json')
