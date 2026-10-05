# Prospective paper-policy validation

This follows the retrospective comparison; it does not replace production.
The five original design points were not five release phases. The first report
implemented task definitions, full-process replay, selector comparisons,
independent buy/sell fits, and reporting. Its evidence was retrospective and used
proxy ETF prices. This next stage addresses actual decision availability and
collects future, precommitted paper-policy outcomes. Real ETF data and explicit
production rollout approval remain separate gates.

## Activation and isolation

The separately approved `Execution prospective shadow` workflow already collects
on the default `main` branch. This phase-one repair only relocates its runtime
to the identical frozen kernel; it does not create or restart the experiment.
**A research-branch/PR run is not live collection.** Only the exact approved
workflow, repository, main branch and scheduled/manual event can create
prospective records. All other runs are explicitly `test_only` and cannot enter
the trial.

Permissions are `contents: read` and `actions: read`; there is no repository
push, production dispatch, Pages publishing step, credential secret, broker
connection, or order submission. Neither this workflow nor its runner edits the
production scaling schedule, calculator, registry, or parameter bundle. The
existing main-dashboard and scaling producers remain in place.

Keep restoring the existing ledger; do not reinitialize it for this calculator
release. Scheduled runs remain independent of the user's computer. The daily
times are **05:17 UTC** and **07:17 UTC** (retry), with UTC explicitly declared.
These earlier attempts provide buffer for the multi-hour dispatch delays
observed on September 20–21; they do not guarantee punctual execution.
They are research collection
times, not a new production schedule. GitHub may delay or drop scheduled jobs;
on-time artifacts, not scheduled start times, determine eligibility.

## Timing contract

| Calendar | Policy becomes effective | Available data at fit | Reference / first eligible fill |
|---|---|---|---|
| NYSE / ETF | Earliest session whose 09:30 ET freeze deadline is still future | Completed sessions through the previous UTC day | 09:35-minute close / 09:36 ET |
| 24/7 crypto | Next UTC day, never the already-started day | Through the previous UTC day: a day-D fit for D+1 knows at most D-1 | 00:00-minute close / 00:01 UTC |

Crypto's candidate-cost replay uses the same one-session observation lag. The
original fixed retrospective experiment retains its original semantics, so its
reported results remain reproducible. The experiment-era listed-buy extra sample
lag remains preserved inside the frozen study; the repaired live calculator no
longer drops that newest completed excursion. Buy and sell freeze separate
hit-estimation samples.

The next anchor price is unknown when a receipt is frozen. The receipt commits
to a parameter-selection result and deterministic execution policy, not to
submitted orders at a price already known. Later settlement supplies the actual
historical anchor and evaluates the committed policy with simulated fills.
Future data never re-select that day's parameters or refresh its frozen history.

No current-day catch-up is invented after the cutoff. An NYSE run arriving after
09:30 targets the next eligible session; after 16:00 it likewise cannot claim
to have placed earlier orders. Missing/late prior sessions stay missing.

## Fixed cohort and acceptance window

`execution-shadow-protocol.json` pins the original protocol hash and registry
hash. The cohort is ARCX:BTC, ARCX:ETH, BINANCE:SPOT:BTCUSDT, and
BINANCE:SPOT:ETHUSDT, each independently fitted for buy/sell and
price-seeking/finish-by-deadline tasks. Fit code, calendar helpers, and the experiment-era
planning functions are hashed into the experiment contract. A changed frozen registry
or frozen implementation stops collection; a different experiment/version must be
declared rather than silently mixing it into this one. The sole maintenance
exception is the exact old/new code-contract pair in
`execution-shadow-compatibility.json`: the September 21 timestamp-precision
repair leaves the study protocol and execution policy unchanged. It records a
hashed migration audit while preserving every frozen receipt and settled result.
Unknown future code hashes still fail closed.

### Frozen execution boundary (October 2026)

Both research workflows now execute the byte-identical September experiment
implementation under `research/frozen/execution-prospective-2026-09-v1/`.
That tree preserves the original relative paths, all nine `CODE_FILES`, the
registry, protocols, compatibility manifest, and protected-file sentinels.
The retrospective entry point is frozen there too. The source snapshot is
`dcc2d5feb9a3054a7eae570e3b6ef487496e70e4`; `frozen-manifest.json`
records each original Git blob and SHA-256 hash.

This is a relocation, not a new policy version or a compatibility migration.
The prospective contract remains
`ef1ef81a5a6515ed9642f98a4a9df15c403e3e23f33879e7af8144f204578724`,
and the existing compatibility manifest is unchanged byte-for-byte. New live
calculator changes do not enter this experiment. Receipt source commits still
identify the current workflow checkout, while implementation hashes identify
its unchanged frozen policy. Original receipts retain their original commits.

The untouched collector resolves its own `ROOT` inside the frozen tree and
exports to that tree's ignored `.research/` directory. The workflow uploads the
collector's actual `output_path`; it does not guess the old root output path.
The outer workflow still verifies that live production files were untouched.
The copied production parameter bundle and scaling workflow are immutable
integrity sentinels only: the collector never runs the copied production
workflow or reads its parameter bundle to select decisions.

Root-level legacy research scripts remain unchanged for source history; they
are no longer the supported reproduction or collection entry points because
root-level replay can import the evolving live core. Use the frozen commands
below. Freeze changes require a separately declared experiment, not an expanded
maintenance allowlist. [Frozen-tree details](frozen/execution-prospective-2026-09-v1/README.md).

The predeclared 12 full weeks are **2026-09-21 through 2026-12-13**. Earlier
receipts are pilot records only. Collection continues through December 16 to
obtain terminal references; later runs do no downloading or fitting. The cron
itself is not automatically deleted and can still launch a small no-op job.

Every method must have the same on-time receipt coverage. Missing market data,
missing receipts and late artifact seals are explicitly reported against the
calendar's expected weeks, including entirely missing weeks. A common week
counts only when all four instruments and all four task types are covered.
The experiment does not quietly extend its end date or reduce its required
sample after a failure; insufficient coverage yields an insufficient-evidence
result and needs a separately declared follow-up experiment.

The five methods, 720-candidate grid, 26-week score window, paired confirmation,
cost/fill scenarios, and completion/tail checks remain the declared research
protocol. Paired confirmation starts with equal-paced execution; the old seed
is a control, not a validated incumbent. Interim tables are descriptive only.
Joint uncertainty and numeric checks wait for all 12 common weeks. Even a pass
always has `promotion_allowed: false`.

## Evidence and retries

- First frozen receipt per calendar/session wins, including one later found to
  be late. Retry runs cannot replace it or manufacture missed earlier receipts.
- Each receipt stores generation time, cutoff, effective session, code/input
  provenance, last observed session, raw and adopted parameters, reasons, and
  the exact side-specific history. Receipts form a SHA-256 hash chain.
- An official immutable GitHub artifact supplies an external publication seal.
  Both generation and server artifact creation must be before the cutoff.
  A newly uploaded receipt initially says `awaiting_immutable_artifact_seal`;
  the next trusted restore reads GitHub metadata and seals it. That one-run
  reporting lag is not a missed scaling run.
  GitHub's second-resolution timestamp denotes a one-second precision interval;
  it can overlap a generation timestamp in the same second without predating it.
  The entire artifact interval must still be before the freeze deadline. Raw
  timestamps are retained; actual reversals and late/ambiguous seals remain invalid.
- Only a trusted successful main-branch workflow artifact can restore state.
  Failed runs without artifacts may be retried. An unsuccessful run that already
  published decisions stops for review, rather than allowing replacement.
  Missing, ambiguous, expired, or mismatched prior state also fails closed.
- Settlement requires all daily receipts and uses only their frozen choices.
  Settled results are hashed and idempotent. Revised already-settled market
  observations stop the job instead of silently rewriting performance.

## Where to compare

GitHub Actions → **Execution prospective shadow** → a successful run → artifact
`execution-shadow-state-RUN_ID`. Branch dry runs instead produce
`execution-shadow-test-RUN_ID`. There is no separate shadow dashboard URL.

Each artifact contains:

- `report.md`: coverage, latest raw/adopted selections and reasons, and common
  prospective weekly comparisons once available.
- `report.json`: every coverage failure, descriptive summaries, cost/completion/
  tail metrics, all three scenarios, and eventual joint checks.
- `shadow-state.json`: the cumulative receipt ledger and settled task outcomes.
- `sessions.json`: that run's input snapshot, archive URLs, and SHA-256 hashes.
- `request.json`, `input-protocol.json`, `shadow-protocol.json`: fixed contract,
  target sessions, code hashes and provenance.
- `compatibility.json`: the exact permitted maintenance migration, with its hash
  pinned in the request and any migration audit. `request.json` and `report.json`
  also distinguish server run creation/start from the inferred daily cron slot.
  GitHub does not expose the original nominal scheduled instant; a delay of a
  full day or more cannot be inferred unambiguously.

For recovery without new observations, manually dispatch with `restore_only`
set to `true`. This still restores only the trusted successful main-branch
artifact; it validates/migrates the contract and seals already-frozen decisions,
then uploads a cumulative ledger. It downloads no market observations, fits no
new decisions, and settles no new outcomes. Its `report.md`/`report.json` are
**recovery proofs, not performance reports**, and there is no `sessions.json`.
The original artifact metadata is retained in `prior-artifact.json`. Normal
scheduled runs retain their usual data/fitting/settlement path. A local or
branch recovery test can read official state but exports `test_only` artifacts;
those artifacts can never become an official restore source.

Retention is **90 days per artifact**, not permanent storage. Every successful
run carries the small cumulative ledger/results forward. Earlier full input
snapshots expire with their own artifacts; download any needed long-term audit
copies. If all usable state expires, the runner will not silently reset.

Local verification (never counts as prospective evidence):

```sh
python -m unittest discover -s tests -v
node --test tests/test_execution_*.cjs
python research/frozen/execution-prospective-2026-09-v1/scripts/run_execution_shadow.py --local-test
python research/frozen/execution-prospective-2026-09-v1/scripts/run_execution_shadow.py --local-test --restore-only
```

These commands write only ignored `.research/` research outputs inside the frozen tree. Cloud/local
generation timestamps and run IDs differ; on identical observations, compare
the frozen task selections, score fingerprints, histories and target sessions.
The operational restore-only command requires authenticated `gh` read access to
the official workflow artifacts. PR checks run synthetic offline regression and
integrity tests only; they do not fetch archived trial data.

## Verification boundary

The public regression suite uses generated synthetic observations, receipts and
server metadata. It does not contain or download archived trial state. CI checks:

- every one of the 16 frozen source files against its original Git blob and
  SHA-256 hash, plus the exact contract and unchanged compatibility manifest;
- byte-identical synthetic ledger replay and idempotent restore-only sealing;
- synthetic settlement for all four instruments, both sides and both modes,
  across five policies and three scenarios;
- isolation from deliberately broken live planner and registry copies;
- Python dependency resolution within the frozen tree, current-checkout Git
  provenance, and the frozen workflow/output paths.

Separately, before publication, a local-only replay of the existing archived
artifact preserved all 28 actual receipt payloads/hashes and all 16 settled
task-weeks. Their outcomes were independently recomputed, the last eight-task
crypto receipt was refitted exactly, and restore-only sealing was checked against
verified server metadata. Those real-artifact inputs and replay tools remain
outside the published repository. These are completed local verification results,
not claims that GitHub CI replays actual trial data.

Neither synthetic tests nor local replay create new prospective evidence or
validate the repaired live calculator's new policy.

## Limitations

ETF data are still indexed spot proxies, not historical ETF quotes. Fee levels,
partial fills, market orders and closeout are assumptions; these reports are
neither real trades nor a forecast or guarantee. The research's explicit fee
reserve and final closeout are not automatic actions of the live calculator.
Public archives cannot reveal queue position, liquidity or market impact.

Binance daily archives become available the next day; monthly archives are
published on the first Monday. The research loader conservatively keeps using
daily archives for the prior month through the eighth day of a new month.
Unexpected publication delay fails the run and leaves a visible coverage gap.

Sources: [Binance public-data publication contract](https://github.com/binance/binance-public-data),
[GitHub scheduled-event limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[GitHub workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).
