# Robust Evaluation

Generated: 2026-07-06T00:20:56.836776+00:00
Verdict: **WATCH_CURRENT_UTILITY_AUDIT**

Reasons:
- bottom calibration MAE 0.20 > 0.18

Boundary:
- This verdict covers the historical utility audit, replay/jitter/target perturbation checks, leave-one-episode-out, and chronological holdout shown below.
- The stricter common exam is computed separately in `reports/common_exam_audit.md` and is not part of this scoped utility verdict.
- Fable's 2026-07-05 external core-only port found real LOCO merit but failed plateau and synthetic-stress checks; use the common exam below as the dashboard full-stack promotion gate.

## Common Exam

- Status: **FAIL**
- parameter_plateau_25pct: FAIL (cells=11, failing=4, worst shift=10.0%, materiality=DELTA_ONLY_REVIEW, delta-only=4)
- synthetic_delayed_lower_low: PASS (paths=1, failing=0, min DCA18 ratio=1.287973)
- synthetic_false_bottom_continued_grind: PASS (paths=1, failing=0, min DCA18 ratio=1.429945)
- synthetic_fast_v_participation: PASS (paths=1, failing=0, min DCA18 ratio=1.033405)
- synthetic_shallow_recover: PASS (paths=1, failing=0, min DCA18 ratio=0.844307)
- early_exhaustion_guard: PASS (historical flags=0, synthetic flags=0)

## Forecast Calibration

- BTC bottom: n=444, down20 MAE raw→cal=0.30479→0.15683, brier raw→cal=0.3371→0.28649, median low abs err=32.6%, timing abs days=84.0
  - LOCO: low<spot LL raw/cal/null=0.23296/0.19106/0.15862; down20 LL raw/cal/null=1.19817/0.75529/0.72042; p10-p90 coverage=59.0% (target 80%); conformal candidate coverage=84.2% scale med/final=2.03128/2.00311, folds=WEAK_FOLDS min=0.0%
- ETH bottom: n=391, down20 MAE raw→cal=0.20247→0.19587, brier raw→cal=0.27125→0.2788, median low abs err=50.0%, timing abs days=73.0
  - LOCO: low<spot LL raw/cal/null=0.27359/0.20643/0.16704; down20 LL raw/cal/null=1.068/0.70995/0.70484; p10-p90 coverage=52.9% (target 80%); conformal candidate coverage=84.7% scale med/final=1.95694/1.95107, folds=WEAK_FOLDS min=4.8%
- BTC top: n=129, dd35 MAE raw→cal=0.10218→0.10999, brier raw→cal=0.22805→0.23257, event rate=30.2%, avg pred raw→cal=23.1%→31.5%
- ETH top: n=92, dd35 MAE raw→cal=0.27205→0.16814, brier raw→cal=0.3253→0.3104, event rate=50.0%, avg pred raw→cal=22.8%→33.4%

## Policy Objective

- Version: policy-utility-v1
- Purpose: Judge policy changes by causal capital-deployment outcomes, not by bottom/top forecast aesthetics.
- Accumulation utility: `pool_return - 0.30*avg_entry_premium_to_low - 0.20*max_portfolio_drawdown - 0.10*underparticipation_at_low + 0.05*dry_at_low_optional_reserve`
- Distribution utility: `(value_at_post_top_low-1) + 0.30*(end_value_vs_hold-1) + 0.20*avg_sell_pct_of_peak - 0.20*max_portfolio_drawdown - 0.10*underdistribution`

## Asset Stratification

| Asset | Status | Accum eps | Dist windows | Acc utility | Dist utility | Bottom MAE | Top MAE | Reasons |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| BTC | PASS | 4 | 4 | 0.288151 | 7.083705 | 0.15683 | 0.10999 | current utility asset gate passed |
| ETH | WATCH | 4 | 3 | 0.092177 | 9.57016 | 0.19587 | 0.16814 | bottom calibration watch |

## Accumulation Policy

- Episodes: 8
- Terminal win-rate vs median simple baseline: 88%
- Avg-cost win-rate vs median simple baseline: 75%
- Worst terminal edge vs median baseline: -1.8%
- Mean terminal edge vs median baseline: 22.4%

| Asset | Episode | Policy terminal | Edge vs median | Avg/low | Cost edge | Utility |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.30 | 37.7% | 73.4% | -79.8% | 0.003333 |
| ETH | 2018 bear (single low) | 0.57 | 19.5% | 166.7% | -441.7% | -1.038305 |
| BTC | 2022 bear (DOUBLE bottom) | 1.83 | 49.3% | 39.5% | -43.1% | 0.675662 |
| ETH | 2022 bear (DOUBLE bottom) | 1.61 | 50.8% | 35.1% | -61.4% | 0.474302 |
| BTC | 2019 H2 correction (mid-cycle) | 1.13 | 1.1% | 16.6% | -3.3% | 0.085831 |
| ETH | 2019 H2 correction (mid-cycle) | 1.34 | -1.8% | 44.9% | 3.4% | 0.194533 |
| BTC | 2020 COVID crash (fast V) | 1.48 | 10.5% | 25.9% | -1.5% | 0.387778 |
| ETH | 2020 COVID crash (fast V) | 1.85 | 11.8% | 33.5% | 14.8% | 0.738177 |

### Expected-Regret Candidate

- Research-only reference-style expected-regret sizing ported into the Model accumulation harness.
- Terminal win-rate vs Model live: 50%
- Avg-cost win-rate vs Model live: 75%
- Mean terminal delta vs Model: -3.1%
- Mean avg-cost premium delta vs Model: -6.7%
- Worst terminal delta vs Model: -53.6%

| Asset | Episode | Policy terminal | Exp-reg terminal | Delta | Model avg/low | Exp-reg avg/low | Model spent@low | Exp-reg spent@low |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.296 | 1.909 | 61.3% | 73.4% | 17.8% | 80% | 40% |
| ETH | 2018 bear (single low) | 0.566 | 0.579 | 1.3% | 166.7% | 160.5% | 72% | 76% |
| BTC | 2022 bear (DOUBLE bottom) | 1.827 | 1.926 | 9.9% | 39.5% | 32.3% | 74% | 86% |
| ETH | 2022 bear (DOUBLE bottom) | 1.607 | 1.607 | 0.0% | 35.1% | 35.1% | 44% | 1% |
| BTC | 2019 H2 correction (mid-cycle) | 1.131 | 1.019 | -11.2% | 16.6% | 5.2% | 47% | 5% |
| ETH | 2019 H2 correction (mid-cycle) | 1.336 | 1.062 | -27.4% | 44.9% | 43.0% | 49% | 3% |
| BTC | 2020 COVID crash (fast V) | 1.480 | 1.425 | -5.4% | 25.9% | 32.5% | 17% | 11% |
| ETH | 2020 COVID crash (fast V) | 1.849 | 1.313 | -53.6% | 33.5% | 55.6% | 38% | 3% |

### Cap-Regime Switch Candidate

- Research-only hybrid: expected-regret sizing in mature/deep bears, Model full-policy cumulative target in causal fast-shock/shallow-correction regimes.
- Terminal win-rate vs Model live: 62%
- Avg-cost win-rate vs Model live: 62%
- Mean terminal delta vs Model: 9.1%
- Mean avg-cost premium delta vs Model: -8.7%
- Worst terminal delta vs Model: 0.0%
- Mean weeks using Model regime: 50%

| Asset | Episode | Policy terminal | Exp-reg terminal | Cap-switch terminal | Cap delta | Model avg/low | Exp-reg avg/low | Cap avg/low | Cap spent@low | Model-regime weeks |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.296 | 1.909 | 1.909 | 61.3% | 73.4% | 17.8% | 17.8% | 40% | 1% |
| ETH | 2018 bear (single low) | 0.566 | 0.579 | 0.579 | 1.3% | 166.7% | 160.5% | 160.5% | 76% | 0% |
| BTC | 2022 bear (DOUBLE bottom) | 1.827 | 1.926 | 1.926 | 9.9% | 39.5% | 32.3% | 32.3% | 86% | 0% |
| ETH | 2022 bear (DOUBLE bottom) | 1.607 | 1.607 | 1.607 | 0.0% | 35.1% | 35.1% | 35.1% | 1% | 0% |
| BTC | 2019 H2 correction (mid-cycle) | 1.131 | 1.019 | 1.131 | 0.0% | 16.6% | 5.2% | 16.6% | 47% | 100% |
| ETH | 2019 H2 correction (mid-cycle) | 1.336 | 1.062 | 1.339 | 0.2% | 44.9% | 43.0% | 44.6% | 49% | 97% |
| BTC | 2020 COVID crash (fast V) | 1.480 | 1.425 | 1.480 | 0.0% | 25.9% | 32.5% | 25.9% | 17% | 100% |
| ETH | 2020 COVID crash (fast V) | 1.849 | 1.313 | 1.849 | 0.0% | 33.5% | 55.6% | 33.5% | 38% | 100% |

Parameter stability:
- live: terminal win-rate 88%, worst edge -1.8%, mean edge 22.4%
- shallower_faster: terminal win-rate 88%, worst edge -3.9%, mean edge 21.5%
- deeper_more_reserve: terminal win-rate 88%, worst edge -0.8%, mean edge 22.1%

Accumulation anti-overfit checks:
- Window jitter: min terminal win-rate 75%, min cost win-rate 62%, worst terminal edge -10.8%
- Target perturbations: min terminal win-rate 75%, min cost win-rate 62%, worst terminal edge -2.6%
- Leave-one-episode-out: worst held-out terminal edge -1.8%, worst held-out cost edge 14.8%
- Chronological holdout since 2020-01-01: terminal win-rate 100%, worst terminal edge 10.5%
- Cap-switch window jitter vs Model: min terminal win-rate 50%, worst terminal delta -18.4%, worst cost delta 128.0%
- Cap-switch target perturbation vs Model: min terminal win-rate 62%, worst terminal delta 0.0%, worst cost delta 0.0%
- Cap-switch leave-one-episode-out vs Model: min remaining terminal win-rate 57%, worst held-out terminal delta 0.0%, worst held-out cost delta 0.0%
- Cap-switch chronological holdout since 2020-01-01: terminal win-rate 50%, worst terminal delta 0.0%

| Window jitter | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| start -30d / end 0d | 8 | 88% | 75% | -1.0% | 11.7% |
| start 0d / end -30d | 8 | 100% | 88% | 5.1% | 9.3% |
| start 0d / end 0d | 8 | 88% | 75% | -1.8% | 14.8% |
| start 0d / end 30d | 8 | 100% | 62% | 1.4% | 20.5% |
| start 30d / end 0d | 8 | 75% | 62% | -10.8% | 23.7% |

| Target perturbation | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| live | 8 | 88% | 75% | -1.8% | 14.8% |
| conservative_90 | 8 | 75% | 62% | -2.6% | 18.7% |
| aggressive_110 | 8 | 88% | 75% | -1.1% | 11.3% |
| lagged_14d | 8 | 88% | 62% | -1.8% | 14.2% |

## Distribution Policy

- Windows: 7
- Value-at-low win-rate vs hold: 100%
- Windows with end value below 75% of hold: 0
- Worst end value vs hold: 139.0%
- Mean value-at-low edge vs hold: +5.46

| Asset | Top | Sold | Avg/peak | Value@low | End vs hold | Utility |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 2017-12-17 | 77% | 94% | 18.07 | 382.0% | 18.052682 |
| BTC | 2021-04-14 | 90% | 79% | 7.49 | 139.0% | 6.704192 |
| BTC | 2021-11-10 | 90% | 79% | 3.22 | 207.2% | 2.619057 |
| BTC | 2025-10-06 | 77% | 91% | 1.68 | 147.3% | 0.958889 |
| ETH | 2021-05-12 | 100% | 74% | 20.19 | 299.6% | 19.889905 |
| ETH | 2021-11-10 | 100% | 74% | 8.75 | 255.2% | 8.308763 |
| ETH | 2025-08-22 | 78% | 93% | 1.09 | 218.1% | 0.511813 |

Distribution anti-overfit checks:
- Parameter perturbations: min win-rate 100%, worst low/hold 121.1%, worst end/hold 110.2%
- Top-date jitter [-60, -30, 0, 30, 60]: min win-rate 100%, worst low/hold 100.0%, worst end/hold 114.3%
- Leave-one-top-out: worst held-out low/hold 142.2%, worst held-out end/hold 139.0%
- Chronological holdout since 2021-01-01: win-rate 100%, worst end/hold 139.0%

| Perturbation | Windows | Win-rate | Worst low/hold | Worst end/hold | Median avg/peak |
|---|---:|---:|---:|---:|---:|
| live | 7 | 100% | 142.2% | 139.0% | 79% |
| earlier_tighter | 7 | 100% | 145.6% | 142.2% | 80% |
| later_looser | 7 | 100% | 121.1% | 110.2% | 84% |
| less_rerisk | 7 | 100% | 139.2% | 136.0% | 77% |

| Top-date jitter | Windows | Win-rate | Worst low/hold | Worst end/hold |
|---:|---:|---:|---:|---:|
| -60d | 7 | 100% | 100.0% | 114.7% |
| -30d | 7 | 100% | 146.1% | 114.3% |
| 0d | 7 | 100% | 142.2% | 139.0% |
| 30d | 7 | 100% | 151.3% | 147.3% |
| 60d | 7 | 100% | 151.3% | 147.3% |

Distribution diagnostics:
- Worst value at post-top low: BTC 2021-04-14 sold=90% low/hold=142.2% end/hold=139.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=147.3%; BTC 2021-11-10 sold=90% low/hold=215.4% end/hold=207.2%
- Worst end value vs hold: BTC 2021-04-14 sold=90% low/hold=142.2% end/hold=139.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=147.3%; BTC 2021-11-10 sold=90% low/hold=215.4% end/hold=207.2%
- Lowest sold fraction: BTC 2017-12-17 sold=77% low/hold=418.9% end/hold=382.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=147.3%; ETH 2025-08-22 sold=78% low/hold=243.3% end/hold=218.1%
