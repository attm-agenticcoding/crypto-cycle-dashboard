# Execution calibration cloud recovery — 2026-10-22

Execution calibration belongs to this public repository's standard `ubuntu-latest`
GitHub Actions runner. Its compute minutes do not consume the private-repository
monthly allowance. CCD's separate local runtime and LST are outside this change.

## Incident

After the October 20 local migration, the cloud calibration workflow was disabled.
On October 21 both local equity attempts rejected an incomplete October 21 minute
archive. On October 22 the Mac slept through the crypto slots; delayed attempts
encountered GitHub DNS failures, including a 996-second resolving timeout. The
local attempt marker consumed each slot before network/fit success, preventing
recovery after connectivity returned. Subsequent idle heartbeats showed no error
although the published bundle remained stale. OS sleep/wake logs corroborated the
sleep-related interruption; the unavailable equity archive's exact upstream HTTP
status was not retained by the downloader.

The supervised October 22 recovery published both calendars, all instruments and
both sides through October 21. Data commits: `dadce7d` (equity), `1783585` (crypto).
Each publication was verified against the actual Pages parameter file SHA256.

## Operating contract

- Disable `execution` in the local dashboard runtime's `state/config.json` under
  its existing writer lock before enabling this workflow. Preserve other flags.
- Enable `update-execution-params.yml`; public Actions remains the single owner.
- Keep equity checks at 20:30/22:30 America/New_York weekdays. At 04:30/08:30 UTC
  daily, check both calendars so late equity archives can recover before opening.
- Scheduled checks skip current parameters before downloads. Manual dispatch
  forces a supervised real fit of both calendars. The statistical fitter,
  archive completeness gates, model and execution strategy are unchanged.
- Fit calendars independently, publish successful complete bundles, and still
  mark the run failed if either requested calendar failed.
- Request the existing branch-based Pages build explicitly when served bytes lag,
  using the workflow's Pages write permission; GITHUB_TOKEN pushes alone do not
  trigger that build. Require exact parameter hash agreement before success.
- Rebase output commits onto concurrent dashboard publications; reject conflicts
  and never force-push. Failed workflow runs remain visible in Actions.

Validation: 157 Python tests and 11 JavaScript core tests passed locally. On macOS,
use `TMPDIR=/private/tmp` for the existing frozen-shadow test's path comparison.
No private Actions workflow is enabled or used by this recovery.

## Cloud acceptance completed

[Production run 39789814441](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/39789814441)
ran on GitHub's `ubuntu-latest` runner and passed all checks. Both real calibration
fits completed at 13:48:22 UTC; output commit
`bd4c4d4a69f69cc88e2748708ccc809bcf255357` was pushed. The explicit Pages build and
served-byte hash verification succeeded at 13:49:16 UTC. All four instruments and
both sides cover October 21. This verifies real cloud compute and publication,
not just workflow enablement. The next unattended scheduled run is still future.

The local runtime config has `execution=false` (other flags preserved), confirmed
by a subsequent natural heartbeat. Cloud `update-execution-params.yml` is active.
A local backup of the previous config is retained for recovery. No private-runner
quota, billing configuration, or Mac sleep setting was changed.
