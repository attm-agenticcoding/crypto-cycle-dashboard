# Robust Evaluation

Generated: 2026-07-05T16:49:00.592364+00:00
Verdict: **PASS_CURRENT_UTILITY_AUDIT**

Reasons:
- all current utility promotion gates passed
- common-exam plateau and synthetic adverse-path gates are reported separately and are not included in this scoped verdict

Boundary:
- This verdict covers the historical utility audit, replay/jitter/target perturbation checks, leave-one-episode-out, and chronological holdout shown below.
- The stricter common exam is computed separately in `reports/common_exam_audit.md` and is not part of this scoped utility verdict.
- Fable's 2026-07-05 external core-only port found real LOCO merit but failed plateau and synthetic-stress checks; use the common exam below as the dashboard full-stack promotion gate.

## Common Exam

- Status: **FAIL**
- parameter_plateau_25pct: FAIL (cells=11, failing=3, worst shift=18.2%)
- synthetic_delayed_lower_low: PASS (paths=1, failing=0, min DCA18 ratio=1.229883)
- synthetic_false_bottom_continued_grind: PASS (paths=1, failing=0, min DCA18 ratio=1.301719)
- synthetic_fast_v_participation: PASS (paths=1, failing=0, min DCA18 ratio=1.029854)
- synthetic_shallow_recover: PASS (paths=1, failing=0, min DCA18 ratio=0.85128)
- early_exhaustion_guard: FAIL (historical flags=1, synthetic flags=1)

## Forecast Calibration

- BTC bottom: n=443, down20 MAE raw→cal=0.32126→0.16381, brier raw→cal=0.36367→0.29007, median low abs err=36.1%, timing abs days=84.0
- ETH bottom: n=390, down20 MAE raw→cal=0.18714→0.14996, brier raw→cal=0.26109→0.2738, median low abs err=48.8%, timing abs days=73.0
- BTC top: n=128, dd35 MAE raw→cal=0.10706→0.11455, brier raw→cal=0.2277→0.23263, event rate=29.7%, avg pred raw→cal=22.9%→31.4%
- ETH top: n=91, dd35 MAE raw→cal=0.26611→0.16266, brier raw→cal=0.32161→0.30892, event rate=49.5%, avg pred raw→cal=22.8%→33.4%

## Policy Objective

- Version: policy-utility-v1
- Purpose: Judge policy changes by causal capital-deployment outcomes, not by bottom/top forecast aesthetics.
- Accumulation utility: `pool_return - 0.30*avg_entry_premium_to_low - 0.20*max_portfolio_drawdown - 0.10*underparticipation_at_low + 0.05*dry_at_low_optional_reserve`
- Distribution utility: `(value_at_post_top_low-1) + 0.30*(end_value_vs_hold-1) + 0.20*avg_sell_pct_of_peak - 0.20*max_portfolio_drawdown - 0.10*underdistribution`

## Asset Stratification

| Asset | Status | Accum eps | Dist windows | Acc utility | Dist utility | Bottom MAE | Top MAE | Reasons |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| BTC | PASS | 4 | 4 | 0.261337 | 7.086513 | 0.16381 | 0.11455 | current utility asset gate passed |
| ETH | PASS | 4 | 3 | 0.034189 | 9.590683 | 0.14996 | 0.16266 | current utility asset gate passed |

## Accumulation Policy

- Episodes: 8
- Terminal win-rate vs median simple baseline: 88%
- Avg-cost win-rate vs median simple baseline: 75%
- Worst terminal edge vs median baseline: -2.3%
- Mean terminal edge vs median baseline: 19.8%

| Asset | Episode | Policy terminal | Edge vs median | Avg/low | Cost edge | Utility |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.20 | 27.8% | 87.8% | -65.5% | -0.138675 |
| ETH | 2018 bear (single low) | 0.54 | 17.3% | 177.5% | -430.9% | -1.12436 |
| BTC | 2022 bear (DOUBLE bottom) | 1.86 | 53.0% | 36.8% | -45.8% | 0.710802 |
| ETH | 2022 bear (DOUBLE bottom) | 1.51 | 41.0% | 43.8% | -52.7% | 0.345412 |
| BTC | 2019 H2 correction (mid-cycle) | 1.13 | 1.0% | 15.8% | -4.1% | 0.08714 |
| ETH | 2019 H2 correction (mid-cycle) | 1.33 | -2.3% | 43.8% | 2.3% | 0.192774 |
| BTC | 2020 COVID crash (fast V) | 1.48 | 10.2% | 25.6% | -1.9% | 0.386079 |
| ETH | 2020 COVID crash (fast V) | 1.83 | 10.2% | 33.3% | 14.6% | 0.722931 |

### Expected-Regret Candidate

- Research-only reference-style expected-regret sizing ported into the Model accumulation harness.
- Terminal win-rate vs Model live: 50%
- Avg-cost win-rate vs Model live: 75%
- Mean terminal delta vs Model: -0.5%
- Mean avg-cost premium delta vs Model: -10.3%
- Worst terminal delta vs Model: -52.0%

| Asset | Episode | Policy terminal | Exp-reg terminal | Delta | Model avg/low | Exp-reg avg/low | Model spent@low | Exp-reg spent@low |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.197 | 1.909 | 71.2% | 87.8% | 17.8% | 80% | 40% |
| ETH | 2018 bear (single low) | 0.544 | 0.579 | 3.5% | 177.5% | 160.5% | 100% | 76% |
| BTC | 2022 bear (DOUBLE bottom) | 1.863 | 1.926 | 6.2% | 36.8% | 32.3% | 80% | 86% |
| ETH | 2022 bear (DOUBLE bottom) | 1.509 | 1.607 | 9.8% | 43.8% | 35.1% | 47% | 1% |
| BTC | 2019 H2 correction (mid-cycle) | 1.130 | 1.019 | -11.1% | 15.8% | 5.2% | 47% | 5% |
| ETH | 2019 H2 correction (mid-cycle) | 1.331 | 1.062 | -26.9% | 43.8% | 43.0% | 49% | 3% |
| BTC | 2020 COVID crash (fast V) | 1.477 | 1.425 | -5.1% | 25.6% | 32.5% | 17% | 11% |
| ETH | 2020 COVID crash (fast V) | 1.833 | 1.313 | -52.0% | 33.3% | 55.6% | 38% | 3% |

### Cap-Regime Switch Candidate

- Research-only hybrid: expected-regret sizing in mature/deep bears, Model full-policy cumulative target in causal fast-shock/shallow-correction regimes.
- Terminal win-rate vs Model live: 62%
- Avg-cost win-rate vs Model live: 62%
- Mean terminal delta vs Model: 11.4%
- Mean avg-cost premium delta vs Model: -12.6%
- Worst terminal delta vs Model: 0.0%
- Mean weeks using Model regime: 50%

| Asset | Episode | Policy terminal | Exp-reg terminal | Cap-switch terminal | Cap delta | Model avg/low | Exp-reg avg/low | Cap avg/low | Cap spent@low | Model-regime weeks |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.197 | 1.909 | 1.909 | 71.2% | 87.8% | 17.8% | 17.8% | 40% | 1% |
| ETH | 2018 bear (single low) | 0.544 | 0.579 | 0.579 | 3.5% | 177.5% | 160.5% | 160.5% | 76% | 0% |
| BTC | 2022 bear (DOUBLE bottom) | 1.863 | 1.926 | 1.926 | 6.2% | 36.8% | 32.3% | 32.3% | 86% | 0% |
| ETH | 2022 bear (DOUBLE bottom) | 1.509 | 1.607 | 1.607 | 9.8% | 43.8% | 35.1% | 35.1% | 1% | 0% |
| BTC | 2019 H2 correction (mid-cycle) | 1.130 | 1.019 | 1.130 | 0.0% | 15.8% | 5.2% | 15.8% | 47% | 100% |
| ETH | 2019 H2 correction (mid-cycle) | 1.331 | 1.062 | 1.333 | 0.2% | 43.8% | 43.0% | 43.4% | 49% | 97% |
| BTC | 2020 COVID crash (fast V) | 1.477 | 1.425 | 1.477 | 0.0% | 25.6% | 32.5% | 25.6% | 17% | 100% |
| ETH | 2020 COVID crash (fast V) | 1.833 | 1.313 | 1.833 | 0.0% | 33.3% | 55.6% | 33.3% | 38% | 100% |

Parameter stability:
- live: terminal win-rate 88%, worst edge -2.3%, mean edge 19.8%
- shallower_faster: terminal win-rate 88%, worst edge -4.4%, mean edge 18.8%
- deeper_more_reserve: terminal win-rate 88%, worst edge -1.3%, mean edge 20.7%

Accumulation anti-overfit checks:
- Window jitter: min terminal win-rate 75%, min cost win-rate 62%, worst terminal edge -11.4%
- Target perturbations: min terminal win-rate 75%, min cost win-rate 62%, worst terminal edge -3.1%
- Leave-one-episode-out: worst held-out terminal edge -2.3%, worst held-out cost edge 14.6%
- Chronological holdout since 2020-01-01: terminal win-rate 100%, worst terminal edge 10.2%
- Cap-switch window jitter vs Model: min terminal win-rate 50%, worst terminal delta -16.2%, worst cost delta 117.3%
- Cap-switch target perturbation vs Model: min terminal win-rate 62%, worst terminal delta 0.0%, worst cost delta 0.0%
- Cap-switch leave-one-episode-out vs Model: min remaining terminal win-rate 57%, worst held-out terminal delta 0.0%, worst held-out cost delta 0.0%
- Cap-switch chronological holdout since 2020-01-01: terminal win-rate 50%, worst terminal delta 0.0%

| Window jitter | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| start -30d / end 0d | 8 | 88% | 88% | -1.5% | 11.7% |
| start 0d / end -30d | 8 | 100% | 88% | 5.1% | 8.3% |
| start 0d / end 0d | 8 | 88% | 75% | -2.3% | 14.6% |
| start 0d / end 30d | 8 | 100% | 62% | 2.6% | 21.1% |
| start 30d / end 0d | 8 | 75% | 62% | -11.4% | 23.5% |

| Target perturbation | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| live | 8 | 88% | 75% | -2.3% | 14.6% |
| conservative_90 | 8 | 75% | 62% | -3.1% | 18.5% |
| aggressive_110 | 8 | 88% | 75% | -1.6% | 11.0% |
| lagged_14d | 8 | 88% | 62% | -2.4% | 14.0% |

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
| BTC | 2025-10-06 | 77% | 91% | 1.68 | 151.1% | 0.970122 |
| ETH | 2021-05-12 | 100% | 74% | 20.19 | 299.6% | 19.889905 |
| ETH | 2021-11-10 | 100% | 74% | 8.75 | 255.2% | 8.308763 |
| ETH | 2025-08-22 | 78% | 93% | 1.09 | 238.6% | 0.573382 |

Distribution anti-overfit checks:
- Parameter perturbations: min win-rate 100%, worst low/hold 121.1%, worst end/hold 119.0%
- Top-date jitter [-60, -30, 0, 30, 60]: min win-rate 100%, worst low/hold 100.0%, worst end/hold 114.3%
- Leave-one-top-out: worst held-out low/hold 142.2%, worst held-out end/hold 139.0%
- Chronological holdout since 2021-01-01: win-rate 100%, worst end/hold 139.0%

| Perturbation | Windows | Win-rate | Worst low/hold | Worst end/hold | Median avg/peak |
|---|---:|---:|---:|---:|---:|
| live | 7 | 100% | 142.2% | 139.0% | 79% |
| earlier_tighter | 7 | 100% | 145.6% | 142.2% | 80% |
| later_looser | 7 | 100% | 121.1% | 119.0% | 84% |
| less_rerisk | 7 | 100% | 139.2% | 136.0% | 77% |

| Top-date jitter | Windows | Win-rate | Worst low/hold | Worst end/hold |
|---:|---:|---:|---:|---:|
| -60d | 7 | 100% | 100.0% | 114.7% |
| -30d | 7 | 100% | 146.1% | 114.3% |
| 0d | 7 | 100% | 142.2% | 139.0% |
| 30d | 7 | 100% | 151.3% | 151.1% |
| 60d | 7 | 100% | 151.3% | 151.1% |

Distribution diagnostics:
- Worst value at post-top low: BTC 2021-04-14 sold=90% low/hold=142.2% end/hold=139.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=151.1%; BTC 2021-11-10 sold=90% low/hold=215.4% end/hold=207.2%
- Worst end value vs hold: BTC 2021-04-14 sold=90% low/hold=142.2% end/hold=139.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=151.1%; BTC 2021-11-10 sold=90% low/hold=215.4% end/hold=207.2%
- Lowest sold fraction: BTC 2017-12-17 sold=77% low/hold=418.9% end/hold=382.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=151.1%; ETH 2025-08-22 sold=78% low/hold=243.3% end/hold=238.6%
