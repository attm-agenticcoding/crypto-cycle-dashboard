# Dashboard publication clock

The existing private renderer continues to own code, market inputs, durable state and the publishing key. This public workflow contains only the publication clock; it never checks out private source or downloads private artifacts.

The clock uses GitHub environment wait timers, then dispatches its next wait with the repository-scoped `GITHUB_TOKEN`. GitHub permits `workflow_dispatch` events initiated by that token. Wait time does not consume runner minutes. This removes cron event delivery from the continuing clock, while the independent queue watchdog handles scheduled restart attempts. Runner queues, API failures and GitHub availability can still delay or interrupt it; this is not an exact-time SLA.

## Configuration

- `dashboard-clock-verify`: one-minute wait, main branch only, no App secrets. A manual verification can enqueue at most one successor. Neither verification tick reads private credentials or requests publication.
- `dashboard-clock`: five-minute wait, main branch only. Its environment secrets are `CYCLE_CLOCK_APP_ID`, `CYCLE_CLOCK_INSTALLATION_ID`, `CYCLE_CLOCK_PRIVATE_KEY`, and `CYCLE_SOURCE_REPOSITORY`.
- A private GitHub App is installed on only the intended private source repository. Its only granted repository permission is Actions: write plus GitHub's required Metadata: read. Actions permission also permits access to runs and artifacts within that selected repository; GitHub does not offer per-workflow App permissions. The application has no source-content, repository-administration or account-wide access.
- The clock mints a token limited to that one repository, rejects unexpectedly broad token scopes, requests only the fixed production workflow on `main` with `force=false`, and immediately revokes the token. The source runner independently checks its durable completion markers and privacy rules.
- Only `workflow_dispatch` and `schedule` events on this repository's `main` branch are accepted. Fork and pull-request workflows cannot use the clock environments. Third-party checkout code is pinned to a commit.
- `DASHBOARD_CLOCK_ENABLED` is initially `false`. Enable it only after the two-tick verification succeeds and the scoped App is installed. Production dispatch uses `verify_only=false`, `remaining=0`. Observe the next automatic tick and a real refreshed publication before declaring end-to-end recovery.

Set `DASHBOARD_CLOCK_ENABLED=false` to stop the continuing clock; disable this workflow for an immediate dispatch stop. A run already executing can finish. The private renderer's cron configuration remains a fallback. No paid-plan or billing setting is changed.

Run `python3 -m unittest discover -s tests -p 'test_dashboard_*.py' -v` for scheduling, credential isolation, bounded verification, successor continuity and token revocation checks.

## Continuity across checkout failures

The first runner step in `dashboard-clock.yml` ensures a successor **before
checkout**. Its Python is inline so a failed Git fetch, missing promisor blob, or
missing repository script cannot prevent that step from executing. The following
checkout can still fail visibly; the next tick goes through the existing protected
environment and its normal wait. The publication script no longer enqueues runs.
It requires the first step's successful scheduling result before checking or
requesting publication, preserving the existing slot and private-renderer semantics.

Each tick reads all five active states for this exact public clock, excludes its
own run ID (including reruns), and lets an existing main-branch successor continue.
Known verification runs have their separate concurrency group; ambiguous main
runs block a new production dispatch. Each state is paginated in batches of 100,
up to GitHub's 1,000-result filtered-search bound. A count mismatch, changing total,
or repeated ID within a state's pages restarts the **whole read-only scan**, within
the full 90-second reconciliation budget with one-, two-, three-, four-, then
five-second capped backoff. The final sleep is capped by the remaining budget. A dispatch requires two
complete scans without a blocker. An observed active blocker is retained even if
a later status query reports that run completed, except for the narrowly proven
successful predecessor described below. Missing/malformed schema or
identity, more than 1,000 results, persistent inconsistency, and exhausted read
budget all fail closed. Retry diagnostics record the attempt, status, page, total,
and received row count without tokens or response bodies.

The reconciliation budget is 90 seconds, checked before reads and immediately
before dispatch; each HTTP read attempt uses at most five seconds or the remaining
budget, with at most two attempts. This is a cooperative budget, not a hard
whole-response deadline (urllib timeouts bound blocking socket operations).
The existing two-minute step timeout remains the outer bound. The step issues at
most one dispatch POST, with no retry after a lost or failed response. After an uncertain POST, the invocation performs a read-only reconciliation and
fails visibly with the observed IDs (or unavailable read-back). It never resends,
even if the index is empty. A later clock/watchdog check must reconcile again;
visibility is not an attribution or an exactly-once dispatch receipt. No cancellation, extra credential, permission, service, or
environment-rule change is introduced. Production retains `cancel-in-progress:
false`, and verification still allows at most one successor with `remaining=0`.

The inline program is executed directly by `tests/test_dashboard_successor.py`,
including from an empty working directory followed by Git exit 128. Regression
coverage includes each active state, reruns, disabled/untrusted contexts,
verification isolation, page boundaries through 1,000 results, transient and
persistent count mismatches, pagination drift and duplicates, cross-status
transitions, deadline exhaustion, API failures and ambiguous POST responses. The watchdog's existing CI job runs these tests on pull requests and
main pushes.

This protects against failures after the scheduling step begins. Runner startup,
action preparation, GitHub API outages, and incomplete run visibility can still
interrupt or delay a chain. GitHub dispatch has no atomic deduplication key; the
inventory check plus existing concurrency controls bounds ordinary recovery but
cannot eliminate every race with an independent dispatch. The independent
watchdog remains the fallback, subject to GitHub's cron and runner availability.


## Inventory interruption investigation — 2026-10-17

The [16:36 UTC run](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/39049787551)
and [21:14 UTC run](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/39069720956)
both failed at the inline `Incomplete or oversized run inventory` guard before
checkout, successor dispatch, or publication. The original guard required the
first page's row count to equal `total_count` and rejected totals above 100;
transport retries did not cover a successful HTTP response with inconsistent
inventory. The historic logs contain no queried status, count, or payload, so
these logs cannot establish whether each failure was count drift, truncation, or
malformed data. Read-only checks at 22:06 UTC found zero active runs and consistent
zero-count responses for all five states; the historical failure was not reproduced
in those later reads. Do not describe pagination overflow as a proven incident cause.

The repair covers both complete multi-page responses and transient count/page
inconsistency without relaxing completeness or identity validation. Future failures
will contain the missing status/count evidence. This change does not alter watchdog
recovery, the wait timer, environment settings, concurrency groups, private token
scope, publication code, or production data. A passing PR test is not evidence of
production recovery; merge and live continuation verification remain separate.

Reference: [GitHub workflow-run pagination and filtered-search limits](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28#list-workflow-runs-for-a-workflow).

## Production verification — 2026-10-04

Production was enabled at 19:30 UTC after the App installation and single-repository permissions were verified. The [first production clock run](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/37228531552) completed its five-minute wait, requested the missing 15:30 ET publication and automatically queued its successor. The App-triggered private publisher succeeded; the public snapshot was generated at 15:36:58 ET. Independent reads of the normal Pages URLs confirmed that both `index.html` and `snapshot.json` matched their SHA-256 entries in `cloud-runtime.json`, and the snapshot remained masked.

The [automatic successor](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/37228865360), started by `github-actions[bot]`, also completed successfully after its five-minute wait. It recognized that the slot was already published and queued [the next wait](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/37229197509) without another human dispatch.

The one-time mobile authorization form is closed. The App key is stored only as an encrypted environment Secret; temporary local private keys were deleted after storage and scope verification. No account-wide token was placed in a workflow, and the source repository remains private.

References: [environment wait timers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer), [GITHUB_TOKEN dispatch behavior](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs), [scoping installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

## Queue recovery and publication freshness

`dashboard-watchdog.yml` is independent of the production clock's concurrency
group and five-minute environment wait. It requests a check every five minutes,
with a three-minute execution timeout, replacing the old hourly restart trigger
so the two schedulers cannot inject competing production ticks. On a main-branch
code push, the privileged check waits for its regression tests to pass. It uses only this public repository's
ordinary `GITHUB_TOKEN` (`contents: read`, `actions: write`), and no private App
credentials, new persistent credentials, or new repository grants.

The watchdog may cancel at most one production-clock run per check. The original
runner-queue case requires all of these observations immediately before cancellation:

- exact clock workflow, main branch, recognized production event/name, first attempt;
- run and its sole `tick` job remain `queued` for strictly more than twenty minutes,
  conservatively measured after the most recent run update/job creation;
- no runner, runner group, or execution steps exist; the jobs response is complete;
- no pending environment approval or protection remains;
- a fresh second run/jobs read still meets every condition.

It also handles the separately verified **expired environment timer** case:

- both the run and sole `tick` remain `waiting`, first attempt, with no runner,
  runner group or execution steps;
- there is exactly one pending environment, the pinned `dashboard-clock` ID
  `23425337962`, with the configured five-minute timer and explicit empty reviewers;
- the timer's actual start plus five minutes is more than twenty minutes in the
  past; later run/job metadata makes this test more conservative;
- current environment configuration contains only that timer and the branch
  policy, the policy permits only the `main` branch, and the separate enabled
  custom-protection-rule inventory is explicitly empty;
- the complete evidence, including timer start, job ID, environment rules and
  inventories, is fetched again and must remain identical before cancellation.

This does not approve a deployment, skip a timer, use administrator bypass, or
change any environment rule. A replacement goes through the existing protected
production clock and its normal five-minute wait again. Missing, changed,
unreadable or unknown protection data blocks cancellation. The environment
metadata endpoints are exact GET-only additions using the existing Actions read
permission; no new permissions, credentials or secret access are added.

It never force-cancels, cancels an observed running job, or operates on a private
renderer, verification run, `/test/`, execution workflow, or unrelated repository.
Older manual runs without the new production/verification run-name marker are
ambiguous and deliberately left alone. Reruns are excluded because their original
creation time is not the queue start of the new attempt.

After cancellation, the watchdog checks that the exact run is conclusively
cancelled and re-lists runs. An unconfirmed cancellation blocks a restart in that
invocation even if the inventory temporarily misses the transitioning run.
An existing active or pending
production successor takes over without another dispatch. Only when no possible
production run remains does it request one existing production clock; a recent
terminal run imposes a twenty-minute restart cooldown. POST requests are not
automatically retried after uncertain network responses. This bounds recovery
and prevents watchdog-created self-enqueue chains or duplicate retry storms.

Recovery is not reported as healthy merely because an API accepted a request.
The check fetches the served main receipt, `index.html`, and `snapshot.json` with
a cache-busting query; checks both file hashes and the snapshot generation time;
and compares the publication's New York logical slot with the due slot, allowing
twenty minutes for publication. An old, mismatched, unavailable, or test-kind
publication fails the watchdog check and is described in its Actions summary.
The next scheduled check verifies recovery after the clock's normal wait.

Limitations: `timeout-minutes` limits execution, not the pre-run queue. GitHub
cron delivery and the watchdog's own runner allocation can also be delayed, so
this is not a guaranteed twenty-minute cancellation or refresh SLA. Cancellation
has no server-side atomic “only if still queued” condition: the final runner
assignment race is minimized by rechecking, not eliminated. Running jobs remain
subject to the existing three-minute clock timeout. Keep the production clock's
`cancel-in-progress: false`: its successor is enqueued before the current tick
finishes, so unconditional replacement could cancel its own parent.

Validation: `python3 -m unittest discover -s tests -p 'test_dashboard_*.py' -v`.
Coverage includes queue boundaries, running/verification/rerun exclusions,
approval protection, race rechecks, incomplete inventory, cancellation conflicts,
uncertain POST responses, restart cooldown/idempotency, actual served hashes,
stale/future timestamps, close/live ordering, Sunday close and DST. Timer recovery
adds the exact stuck-wait fixture, the 25-minute strict boundary, timer resets,
reviewer/custom-rule additions, unknown configuration, main-only policy checks,
read failures and confirmation of cancellation before any replacement.


## November 4 predecessor and read-budget repair (local preparation)

At 11:17 UTC the run index returned `total_count=1` with zero rows three times.
The three-attempt limit stopped recovery in approximately twelve seconds despite
a 90-second budget. Read-only whole-inventory retries now use that time budget;
invalid identities, refused reads, exhausted transport retries, oversize responses,
and deadline exhaustion still prevent dispatch. No mutation is retried.

At 16:31:32 UTC, clock `41867208857` treated predecessor `41865476360` as an
active successor. The public job record shows the predecessor's `Complete job`
step ended at 16:26:22 and its job completed at 16:26:24, before the current tick
started at 16:31:29. Tests preserve these actual job records and reconstruct the
reported stale run index; this is a local reproduction, not a live recovery test.

An older run ID only selects a candidate for additional evidence. Exemption
requires all of the following; anything unknown fails closed:

- Exact repository, workflow path and workflow ID, main branch, recognized event
  and production/verification name, SHA, positive run number and run attempt.
- The current run matches `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_SHA`, and
  `GITHUB_JOB=tick`, and its sole job is still running without a conclusion.
- The candidate has an earlier run number and creation time. Its sole job is
  fetched from the **specific attempt** endpoint and matches run ID, attempt,
  SHA, branch and repository run URL. The response must contain exactly one job;
  zero, extra, partial, or unexpected jobs cannot establish termination.
- The candidate job completed successfully before the current tick started, with
  all reported steps complete, success/skipped conclusions, and a successful
  `Complete job` step. Cancelled, denied, failure, unknown, and still-active jobs
  are not exempted. A stale run-level `in_progress`/null state is tolerated only
  with this successful job evidence.
- Run identity is read before and after jobs. Each complete inventory pass checks
  the evidence again. Every exempted candidate is rechecked before dispatch even
  if it disappears from a later index; the current execution is also rechecked.
  Changed attempts, job IDs, steps, times or other job data block dispatch.

Only existing Actions read access is used. The environment timers, concurrency,
cancellation behavior, workflow triggers, credentials and private publisher stay
unchanged. The private clock transport now retries GET only, including no retry
of installation-token creation, workflow dispatch, or revocation. Its refresh
guard checks all five active states and rejects missing/inconsistent inventory.
After an uncertain private dispatch it reads active state once more, revokes its
token, and reports uncertainty without another POST. A visible run is not proof
that this invocation caused it; an empty index is not proof of rejection.

### Completion-event recovery considered, deferred

Adding `workflow_run: completed` could reduce dependence on cron delivery but is
not part of this patch. It must examine successful completions too: the false
`successor-already-active` incident ended successfully. The existing twenty-minute
cooldown would defer an immediate completion-triggered restart, so merely adding
an event would not fix a broken chain. A separate design must reconcile the exact
trusted event/run/attempt and active inventory, preserve cooldown or establish an
equally safe replacement, and prevent dispatch/completion loops and duplicate
recovery paths. No extra permissions, dependencies, or triggers have been added.

### Required production acceptance after separately authorized rollout

Local tests, a successful merge check, verify-only ticks, or a manual catch-up do
not establish stable unattended publication. After an authorized rollout:

1. Recheck current main and CI path triggers, apply/review the exact patch, and
   preserve existing environment rules and both concurrency groups. A main push
   to these paths can run the watchdog and production recovery; authorization
   must cover that effect. Do not push this preparation without authorization.
2. Observe an existing production chain adopt the new workflow, or obtain
   separate permission for one guarded recovery if the chain is broken. That
   initial recovery does not count as unattended acceptance.
3. Observe at least one **subsequent scheduled due slot** with no manual dispatch,
   rerun, cancellation, local timer intervention or forced publication. Record the
   automatic clock and private publisher run IDs/attempts, event/actor, source
   timestamps, logical New York slot, generation and publication timestamps.
4. Independently fetch served `cloud-runtime.json`, `index.html`, and
   `snapshot.json`; verify both SHA-256 entries, `publisher=github-actions`,
   `kind=main`, masked snapshot, due slot and source freshness. Check retained
   history against its pre-slot baseline and the expected slot append/update;
   no unexplained rewrite or loss is acceptable.
5. Confirm a successor waits through the existing timer, runs automatically and
   creates the following successor. Reconcile all five active states and exact
   attempt jobs for public clocks and private publishers: at most one executing
   production writer, no competing chain, unchanged concurrency and protections.
6. Keep the full evidence and label the outcome accurately: one unattended slot
   demonstrates that slot, not long-term reliability. Outages, stale APIs and
   invisible dispatches remain possible; verify later slots before claiming
   sustained recovery. GitHub dispatch provides no atomic idempotency key and
   client-side reads cannot eliminate a concurrent rerun/dispatch race.

References: [attempt-specific job inventory](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt)
and [completion events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
