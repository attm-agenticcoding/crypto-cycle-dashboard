# Dashboard publication clock

The existing private renderer continues to own code, market inputs, durable state and the publishing key. This public workflow contains only the publication clock; it never checks out private source or downloads private artifacts.

The clock uses GitHub environment wait timers, then dispatches its next wait with the repository-scoped `GITHUB_TOKEN`. GitHub permits `workflow_dispatch` events initiated by that token. Wait time does not consume runner minutes. This removes cron event delivery from the continuing clock, while an hourly cron remains a restart attempt. Runner queues, API failures and GitHub availability can still delay or interrupt it; this is not an exact-time SLA.

## Configuration

- `dashboard-clock-verify`: one-minute wait, main branch only, no App secrets. A manual verification can enqueue at most one successor. Neither verification tick reads private credentials or requests publication.
- `dashboard-clock`: five-minute wait, main branch only. Its environment secrets are `CYCLE_CLOCK_APP_ID`, `CYCLE_CLOCK_INSTALLATION_ID`, `CYCLE_CLOCK_PRIVATE_KEY`, and `CYCLE_SOURCE_REPOSITORY`.
- A private GitHub App is installed on only the intended private source repository. Its only granted repository permission is Actions: write plus GitHub's required Metadata: read. Actions permission also permits access to runs and artifacts within that selected repository; GitHub does not offer per-workflow App permissions. The application has no source-content, repository-administration or account-wide access.
- The clock mints a token limited to that one repository, rejects unexpectedly broad token scopes, requests only the fixed production workflow on `main` with `force=false`, and immediately revokes the token. The source runner independently checks its durable completion markers and privacy rules.
- Only `workflow_dispatch` and `schedule` events on this repository's `main` branch are accepted. Fork and pull-request workflows cannot use the clock environments. Third-party checkout code is pinned to a commit.
- `DASHBOARD_CLOCK_ENABLED` is initially `false`. Enable it only after the two-tick verification succeeds and the scoped App is installed. Production dispatch uses `verify_only=false`, `remaining=0`. Observe the next automatic tick and a real refreshed publication before declaring end-to-end recovery.

Set `DASHBOARD_CLOCK_ENABLED=false` to stop the continuing clock; disable this workflow for an immediate dispatch stop. A run already executing can finish. The private renderer's cron configuration remains a fallback. No paid-plan or billing setting is changed.

Run `python3 -m unittest discover -s tests -p test_dashboard_clock.py -v` for scheduling, credential isolation, bounded verification, successor continuity and token revocation checks.

## Production verification — 2026-10-04

Production was enabled at 19:30 UTC after the App installation and single-repository permissions were verified. The [first production clock run](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/37228531552) completed its five-minute wait, requested the missing 15:30 ET publication and automatically queued its successor. The App-triggered private publisher succeeded; the public snapshot was generated at 15:36:58 ET. Independent reads of the normal Pages URLs confirmed that both `index.html` and `snapshot.json` matched their SHA-256 entries in `cloud-runtime.json`, and the snapshot remained masked.

The [automatic successor](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/37228865360), started by `github-actions[bot]`, also completed successfully after its five-minute wait. It recognized that the slot was already published and queued [the next wait](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/37229197509) without another human dispatch.

The one-time mobile authorization form is closed. The App key is stored only as an encrypted environment Secret; temporary local private keys were deleted after storage and scope verification. No account-wide token was placed in a workflow, and the source repository remains private.

References: [environment wait timers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer), [GITHUB_TOKEN dispatch behavior](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs), [scoping installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
