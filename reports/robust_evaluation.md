# Robust Evaluation

Generated: 2026-06-30T19:14:36.088362+00:00
Verdict: **PASS (current utility suite only)**

Reasons:
- all promotion gates passed

Scope caveat added 2026-07-05:
- This PASS is limited to the dashboard's current utility-style promotion suite.
- The stricter common exam is **NOT PASSED**: +/-25% parameter-plateau,
  delayed-lower-low, fast-V, shallow-recover and early-exhaustion stress gates
  are not accepted here yet.
- Fable's external core-only port of the convex shape found real LOCO merit, but
  failed the plateau and synthetic-stress checks. The dashboard full stack
  still needs to replay those shapes with reserve release, redeploy and re-arm
  before any robustness claim is promoted.

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
| BTC | PASS | 4 | 4 | 0.331715 | 7.086513 | 0.16381 | 0.11455 | asset gate passed |
| ETH | PASS | 4 | 3 | 0.063737 | 9.590683 | 0.14996 | 0.16266 | asset gate passed |

## Accumulation Policy

- Episodes: 8
- Terminal win-rate vs median simple baseline: 88%
- Avg-cost win-rate vs median simple baseline: 62%
- Worst terminal edge vs median baseline: -2.1%
- Mean terminal edge vs median baseline: 23.3%

| Asset | Episode | Policy terminal | Edge vs median | Avg/low | Cost edge | Utility |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.37 | 45.0% | 64.1% | -89.1% | 0.104855 |
| ETH | 2018 bear (single low) | 0.55 | 17.6% | 175.6% | -432.7% | -1.11468 |
| BTC | 2022 bear (DOUBLE bottom) | 1.92 | 59.0% | 32.5% | -50.1% | 0.792915 |
| ETH | 2022 bear (DOUBLE bottom) | 1.59 | 49.4% | 36.3% | -60.3% | 0.457078 |
| BTC | 2019 H2 correction (mid-cycle) | 1.13 | 0.9% | 16.0% | -3.9% | 0.084797 |
| ETH | 2019 H2 correction (mid-cycle) | 1.33 | -2.1% | 43.8% | 2.3% | 0.194 |
| BTC | 2020 COVID crash (fast V) | 1.44 | 6.7% | 27.9% | 0.5% | 0.344293 |
| ETH | 2020 COVID crash (fast V) | 1.83 | 9.8% | 33.6% | 14.8% | 0.718551 |

Parameter stability:
- live: terminal win-rate 88%, worst edge -2.1%, mean edge 23.3%
- shallower_faster: terminal win-rate 88%, worst edge -4.1%, mean edge 22.0%
- deeper_more_reserve: terminal win-rate 88%, worst edge -1.1%, mean edge 22.9%

Accumulation anti-overfit checks:
- Window jitter: min terminal win-rate 62%, min cost win-rate 62%, worst terminal edge -11.2%
- Target perturbations: min terminal win-rate 75%, min cost win-rate 62%, worst terminal edge -2.9%
- Leave-one-episode-out: worst held-out terminal edge -2.1%, worst held-out cost edge 14.8%
- Chronological holdout since 2020-01-01: terminal win-rate 100%, worst terminal edge 6.7%

| Window jitter | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| start -30d / end 0d | 8 | 88% | 88% | -1.4% | 8.9% |
| start 0d / end -30d | 8 | 100% | 88% | 5.0% | 8.5% |
| start 0d / end 0d | 8 | 88% | 62% | -2.1% | 14.8% |
| start 0d / end 30d | 8 | 100% | 62% | 2.5% | 21.4% |
| start 30d / end 0d | 8 | 62% | 62% | -11.2% | 26.1% |

| Target perturbation | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| live | 8 | 88% | 62% | -2.1% | 14.8% |
| conservative_90 | 8 | 75% | 62% | -2.9% | 18.5% |
| aggressive_110 | 8 | 88% | 75% | -1.5% | 11.4% |
| lagged_14d | 8 | 88% | 62% | -2.2% | 15.8% |

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
