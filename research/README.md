# Execution v2 validation (isolated, not production)

This is an experiment to choose a defensible parameter-selection procedure, not
an automatic replacement for the live calculator. No production parameter file,
site, scheduler, credential, or broker connection is changed by these commands.

The initial [2026-09-19 comparison report](results/2026-09-19-report.md) found no
replacement clearing the predeclared checks. This does not establish that the
old selector is optimal; it means this experiment does not support a cutover.

## Reproduce

Python 3.12+ (standard library) and Node 22+ are sufficient.

```sh
python -m unittest discover -s tests -v
node --test tests/test_execution_core.cjs tests/test_execution_v2.cjs
python scripts/prepare_execution_v2.py
node scripts/validate_execution_v2.cjs
```

Output lives under ignored `.research/report/`. Archives are cached separately
under `.research/archives/`. The manual **Execution v2 isolated research** GitHub
workflow runs the same experiment with read-only repository permissions and
retains an artifact for 30 days. It has no production schedule or publishing
step. Pushes to the validation branch run the experiment; pull requests run
regression tests only. No secrets are required.

The loader validates the registry and rejects unsupported providers or custom
session anchors instead of silently substituting its fixed 09:35 ET / 00:00 UTC
research contracts. Both cache and output paths are restricted to `.research/`.

## Locked experiment

`execution-v2-protocol.json` was fixed before inspecting this implementation's
results. It covers 2025-01-01 through 2026-09-18. The 12 complete weeks beginning
2026-06-22 are reserved for evaluation **within this experiment**, but were not
untouched by prior work on this project. Do not label this pristine or prospective
evidence. Do not tune these settings against that suffix and retain its claim as
a holdout; a revised protocol requires a new validation record.

- 720 candidates, separately for every instrument and buy/sell direction.
- Identical full score weeks after the maximum 60-session warm-up plus the
  current listed-buy sample lag. No low-hit week is selectively discarded.
- Data completeness requires every needed minute. A missing next expected
  session cannot be silently replaced by a more distant reference.
- NYSE regular/half-day hours apply to both sides; crypto uses complete UTC days,
  including weekends. 2025's January 9 extraordinary closure is included.
- Daily plans use only earlier session excursions. The sell and crypto planners
  are the real shared page functions; the listed-buy adapter has exact parity
  tests against the current inline page functions.
- The inner scoring window is 26 completed weekly task episodes. A week's
  next-reference terminal label is withheld until strictly before the current
  daily decision; no unfinished-week labels are allowed.
- Every outer daily decision runs the actual selector procedure on that past-only
  inner window. Orders reset daily, hit estimates refresh daily, and only fills
  decrement the weekly and total inputs. Outer weekly account state carries
  across daily parameter decisions. A candidate's inner episode uses that fixed
  candidate throughout its week; the outer replay tests the adaptive procedure.
- Methods: repaired-common-data legacy distance control, lowest mean cost, and
  paired confirmation. The latter searches the first 18 inner weeks and confirms
  against its incumbent over the last 8 using paired differences and circular
  four-week blocks. With no validated ladder incumbent it starts from equal-paced
  execution, not a copied BTC seed. Its challenger must clear 5 bp materiality
  and a positive one-sided block-bootstrap lower limit. Switching fee is zero.
- The control retains the historical `(20, .25%, .80%)` seed to measure the
  distance rule, explicitly not to validate that seed for another instrument.
  It is not a reconstruction of the old unequal-window score or every historical
  production publication.
- Baselines: equal-paced daily reference execution and first-reference execution,
  using the same asset, task, fees, rounding, and opportunity-cost marking.
- Nominal selections are frozen for frictionless/adverse-fill sensitivity replays;
  stress results do not feed back into parameter selection.

## Tasks and metrics

BUY has a $10,000 quote-currency budget. Its cost is the deviation of the effective
price paid (budget divided by acquired plus terminal-equivalent units) from the
first reference. SELL starts with step-rounded inventory worth up to $10,000;
its cost is foregone net proceeds relative to that arrival notional. Costs in bp
are comparable **within** a task, not interchangeable between buy and sell.

Price-seeking uses the full weekly target and no deadline overlay. Unfilled
residual is valued at the next expected session reference with the declared
aggressive friction, not claimed as a fill. Finish mode starts with a 60% weekly
input and a 100% same-week deadline target, exercises the live pacing formula,
then assumes explicit aggressive completion 15 minutes before the final close.
It cannot see later passive extrema. The closeout reference is the minute close
already known at that time. BUY fee reserves and an aggressive buy closeout are
research contract additions, not existing automated page behavior.

Report mean, P95 and worst cost, passive and modeled completion, remaining
exposure, aggressive intervention, zero-fill days, and parameter changes.
One-sided familywise bootstrap bounds use aligned four-week blocks across all
declared selector/benchmark/scenario/task comparisons. These are approximate,
low-power retrospective estimates, not distribution-free guarantees. Inner
confirmation is reused over time; the full outer adaptive procedure, not an
inner winning score, is the object of evaluation.

All fees, slippage, fill fractions and penetration thresholds are sensitivity
assumptions. Minute extremes cannot reveal actual queue position, executable
bid/ask, partial-fill capacity, or market impact. Quantity/price constraints use
the current registry, not reconstructed historical exchange filters. Tests
cover reservations; the replay assumes existing orders are cancelled each day.

## Remaining promotion gates

ETF input is an indexed Binance spot proxy, anchored to a registry convenience
price at the dataset's start, **not historical ETF quotes or order-book fills**.
Different account sizes, multiweek deadlines, real tracking error, and orderbook
conditions need further validation before generalized claims.

The experiment assumes historical market observations were available at the
declared decision time. It does not reconstruct archive publication delays or
actual scaling-job completion timestamps. In particular, a crypto fit produced
at 04:30 cannot justify a real order submitted at 00:01 that same day. Address
that production contract and collect prospective shadow decisions before using
the replay as a description of real deployed performance.

Numeric gates require material improvement with positive simultaneous lower
bounds against control and both baselines across the three scenarios, without
more than 10 bp P95 deterioration or one percentage point completion loss versus
control. Even a numeric pass cannot promote a strategy: prospective evidence,
real-instrument data, live-policy alignment, and explicit rollout approval remain
separate. The runner always emits `promotion_allowed: false`.

## Audit trail

The report stores protocol/session/code hashes, every daily raw/adopted selection
and reason, and every weekly scenario outcome. Compressed candidate matrices
preserve the exact common week IDs for all candidates. Session metadata includes
all original archive URLs and SHA-256 hashes. Output guards and CI verify that
the protected production files are untouched.
