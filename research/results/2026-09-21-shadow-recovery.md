# September 21 shadow timestamp repair

Scope: prospective shadow operation only. Production parameters, calculator,
registry, updater and schedules are unchanged. No trades, new selection rule,
retroactive decision fitting, study extension or promotion is authorized here.

## Incident and provenance

- Last successful source: [run 35622136814](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/35622136814).
- Immutable artifact: `execution-shadow-state-35622136814`, ID `10649937490`.
- Artifact archive SHA-256: `29c26aaa62f85fd36488b6700ae1f0dc7ef361ea58daf3d0a5b095bd5f065ee4`.
- Source commit: `1b8cb762acce4cbb1b5923b833ffbf3b8fa7fd30`.
- [Failed next restore](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/35640399526):
  `Artifact predates its payload`.
- Receipt generation: `2026-09-21T15:56:35.218Z`; GitHub artifact creation:
  `2026-09-21T15:56:35Z`. The comparison incorrectly treated a whole-second
  server timestamp as an exact millisecond instant, reporting a 218ms reversal.

The ledger contained five calendar/session receipts (eight instrument/side/mode
tasks in each): XNYS September 21–22 and crypto September 20–22. The crypto
September 20 entry is a pre-trial pilot. The first three were already sealed;
the last two needed the original source artifact's seal.

## Repair and boundaries

Timestamp comparison now uses precision intervals. Whole-second artifact time
`15:56:35Z` is compatible with payload generation within that same second.
The entire interval must still lie before the freeze deadline. Earlier
non-overlapping timestamps, late receipts and ambiguous deadline overlap fail.
Original timestamp strings, receipt payloads, selections, history samples,
source commits, hashes and any settled outcomes are not rewritten. Imports
validate every pending receipt before adding any seals.

The code contract remains locked. A manifest explicitly permits only:

- From `ef59324da0b2b97145d0369e88d2c90052d7aa3d40393bfa9d85907abb1fbd37`
- To `ef1ef81a5a6515ed9642f98a4a9df15c403e3e23f33879e7af8144f204578724`

The audit records migration time/run, both contracts, manifest hash, original
receipt count/tip and evaluation hash. Tests pin unchanged policy files and the
exact `fitTask`, `freezeCalendar`, and `settle` function sources. Future
unreviewed code changes still stop collection.

`restore_only` enables recovery without downloading archives, fitting decisions
or evaluating new outcomes. This matters independently of the precision bug:
at `2026-09-22T02:14Z`, the September 21 BTCUSDT and ETHUSDT daily archives both
returned HTTP 404. A recovery report must not be represented as a fresh fit or
prospective performance result.

## Scheduling

Configured UTC slots were 09:17/13:17. September 20 runs were created at
13:35/16:50; September 21 at 15:54/18:45. Run start times matched creation and
steps began within seconds. The observed delay was before run creation, not
parameter-fitting duration. GitHub's internal cause is not established.

Shadow now retains two attempts, at 05:17/07:17 UTC, leaving more buffer before
the unchanged cutoff. Reports add dispatch diagnostics, explicitly labeling
the nearest prior cron slot as inferred. GitHub schedules remain best-effort;
this change does not guarantee punctual delivery or backfill missed decisions.
Production schedules are untouched.

## Verification before cloud deployment

- 45 Python and 42 Node tests pass, including the exact 218ms case, cutoff
  boundaries, atomic failed import, migration rejection/idempotence, and a
  restore-only CLI run without any market sessions file.
- A read-only download of the real official artifact was recovered locally as
  `test_only`: all five timing checks pass; all original payloads/hashes and
  evaluations are unchanged. The original three seals are retained.
- Canonical digest of original payloads, hashes and evaluations:
  `266cd12d8845f9bf0e1196e502acabfb8639efacb5a34627393ea7d2dd569fa8`.
- Receipt-chain tip remains
  `cb877527ea21089bd94e794f2f6b1139079d07cce002602cf533196625bbbf88`.
- There are still zero settled task-weeks and no prospective performance
  conclusion. The fixed twelve-week evidence requirement remains in force.

Official recovery is verified separately through the successful main-branch
Actions run and its immutable artifact; branch/local outputs never count as
official activation or future performance evidence.

References: [GitHub artifact API](https://docs.github.com/en/rest/actions/artifacts),
[scheduled-event limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
