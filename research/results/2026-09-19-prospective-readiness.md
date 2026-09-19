# Prospective shadow readiness — 2026-09-19

## Status

Implemented and dry-run verified on the isolated research branch. **Not yet
merged or enabled as a scheduled main-branch experiment.** Production remains
unchanged. This is a pipeline/readiness result, not evidence that any selector
has superior prospective performance.

The earlier stage covered all five design topics in a retrospective experiment,
not only the first topic. This stage adds pre-session availability, immutable
decision receipts, and subsequent evaluation of those exact decisions.

## Verified implementation

- Code commit: `7c26cb445bb775336973aff2e1d03a64be2cb4f3`.
- Local and GitHub regression suites: **39 Python + 35 Node = 74 passing tests**.
- [GitHub full shadow dry run](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/35452699263): successful.
- Artifact: `execution-shadow-test-35452699263`; artifact ID `10587122969`.
- Artifact creation time: `2026-09-19T15:45:10Z`.
- GitHub/downloaded archive SHA-256: `2fbf2d7651cbd5e8575f238b63b0236a092bf57dccd008c2619af085682ec682`.
- Experiment/code contract SHA-256: `ef59324da0b2b97145d0369e88d2c90052d7aa3d40393bfa9d85907abb1fbd37`.
- Input snapshot SHA-256: `a0a5c52dad39ad39f0c8102ad62c21658c97f5969d0d127d713a760edeeff6f4`.
- Input protocol SHA-256: `4beee40ba0f39dc2ec108bb8b13577c6da8477180ad1e5f18f11be1ccd8dc65a`.

The cloud and local dry runs have byte-identical input snapshots and code
hashes, and exactly equal targets, histories, training windows, all candidate
score fingerprints, raw/adopted choices and reasons for **16 independent tasks
and 48 selector decisions**. Receipt generation timestamps, run IDs and the
resulting receipt-chain hashes differ by construction; those were not falsely
reported as identical.

The [full retrospective regression](https://github.com/attm-agenticcoding/crypto-cycle-dashboard/actions/runs/35452699326)
also succeeded. Relative to the earlier verified cloud run `35450407926`, all
task outcomes, metrics, gates, **14,568 daily decisions**, and the entire
**892,800-value candidate score matrix** are exactly unchanged. The uncompressed
matrix SHA-256 remains
`8bd606b4ab1186eb3cdb970a3e10140cf17acb57edc163c961d17e02a0bd0346`.

The two calendar receipts target NYSE **2026-09-21** and crypto **2026-09-20**.
Both remain `test_only`, regardless of their upload time. The crypto Sunday
record is outside the declared full-week trial even if produced by an official
main-branch workflow. **Completed prospective weeks: 0.**

## Integrity cases covered

Tests cover strict freeze boundaries; UTC next-day crypto; holidays, weekends
and DST; late and missing receipts; missing whole market weeks; immutable first
receipt on retries; per-side frozen histories; crypto historical observation lag;
hash-chain and result tampering; wrong source commit; invalid or expired state;
failed runs that already published decisions; revised market observations;
complete-cohort coverage; and withholding joint checks until twelve full weeks.

The production parameter bundle, registry, calculator files, updater and
production scaling workflow are unchanged relative to main. No live orders,
production dispatch, Pages publishing step, or write-scoped secret is introduced.

## Activation remains separate

An approved merge to main and an initial manual run are needed to start official
collection. The workflow would then run at 09:17 and 13:17 UTC daily, preserving
existing production times. The full-week window is September 21–December 13;
collection ends December 16. Reports remain GitHub artifacts, not a shadow URL.
See the [full prospective contract](../prospective-shadow.md).

ETF inputs still use spot proxies. Costs and fills remain hypotheses. A future
numeric pass cannot automatically switch production or validate real ETF fills.
