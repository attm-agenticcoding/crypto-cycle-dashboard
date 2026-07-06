# Robust Evaluation

Generated: 2026-07-06T16:12:38.075128+00:00
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
- synthetic_delayed_lower_low: FAIL (paths=1, failing=1, min DCA18 ratio=1.287973)
- synthetic_false_bottom_continued_grind: FAIL (paths=1, failing=1, min DCA18 ratio=1.429945)
- synthetic_fast_v_participation: PASS (paths=1, failing=0, min DCA18 ratio=1.033405)
- synthetic_shallow_recover: PASS (paths=1, failing=0, min DCA18 ratio=0.844307)
- early_exhaustion_guard: PASS (historical flags=0, synthetic flags=0)

## Cap Rationale Audit

- Status: **REVIEW_REQUIRED**
- Caps classified: 38; standard metrics: 6; non-canonical thresholds: 38; review-required: 25; implementation-review: 0
- Source mix: canonical metrics=0, nominal statistical targets=2, baseline-relative gates=11, policy risk tolerances=4, heuristic stress gates=21
- Interpretation: Most metrics used here are standard diagnostics, but the explicit numeric caps are local governance thresholds unless marked as nominal statistical targets. A triggered local cap should be read as WATCH/REVIEW evidence, not as proof that the model violated a universal market-standard constant.

| Cap | Source | Effect | Threshold | Observed | Status | Implementation |
|---|---:|---:|---:|---:|---:|---:|
| forecast.bottom_down20_calibration_mae_0_18 | policy_risk_tolerance | WATCH_ONLY | <= 0.18 | 0.1959 | TRIGGERED | ENFORCED |
| forecast.bottom_loco_log_loss_vs_null | baseline_relative_gate | REPORT_ONLY | <= 0.0 | 0.0394 | TRIGGERED | ENFORCED |
| forecast.bottom_raw_p10_p90_coverage_80 | nominal_statistical_target | REPORT_ONLY | >= 0.8 | 0.5294 | TRIGGERED | ENFORCED |
| forecast.bottom_conformal_each_fold_coverage_80 | heuristic_stress_gate | RESEARCH_WARNING | >= 0.8 | 0.0000 | TRIGGERED | ENFORCED |
| common_exam.parameter_plateau_heldout_edge_deterioration_5pp | heuristic_stress_gate | HARD_PROMOTION_BLOCK | >= -0.05 | -0.1291 | TRIGGERED | ENFORCED |
| common_exam.synthetic_delayed_lower_low_avg_premium_60 | heuristic_stress_gate | HARD_PROMOTION_BLOCK | <= 0.6 | 0.7336 | TRIGGERED | ENFORCED |
| common_exam.synthetic_false_bottom_unlock_20pp | heuristic_stress_gate | HARD_PROMOTION_BLOCK | <= 0.2 | 0.2260 | TRIGGERED | ENFORCED |
| forecast.top_drawdown35_calibration_mae_0_18 | policy_risk_tolerance | WATCH_ONLY | <= 0.18 | 0.1681 | PASS | ENFORCED |
| current_utility.accum_parameter_stability_terminal_win_50 | heuristic_stress_gate | WATCH_ONLY | >= 0.5 | 0.8750 | PASS | ENFORCED |
| current_utility.accum_window_jitter_terminal_win_60 | heuristic_stress_gate | WATCH_ONLY | >= 0.6 | 0.7500 | PASS | ENFORCED |
| current_utility.accum_window_jitter_cost_win_50 | heuristic_stress_gate | WATCH_ONLY | >= 0.5 | 0.6250 | PASS | ENFORCED |
| current_utility.accum_window_jitter_worst_terminal_edge_minus15 | heuristic_stress_gate | WATCH_ONLY | >= -0.15 | -0.1085 | PASS | ENFORCED |
| current_utility.accum_target_perturbation_terminal_win_60 | heuristic_stress_gate | WATCH_ONLY | >= 0.6 | 0.7500 | PASS | ENFORCED |
| current_utility.accum_target_perturbation_cost_win_50 | heuristic_stress_gate | WATCH_ONLY | >= 0.5 | 0.6250 | PASS | ENFORCED |
| current_utility.accum_target_perturbation_worst_terminal_edge_minus15 | heuristic_stress_gate | WATCH_ONLY | >= -0.15 | -0.0255 | PASS | ENFORCED |
| current_utility.accum_loo_worst_terminal_edge_minus15 | heuristic_stress_gate | WATCH_ONLY | >= -0.15 | -0.0177 | PASS | ENFORCED |
| current_utility.distribution_parameter_stability_win_rate_70 | heuristic_stress_gate | WATCH_ONLY | >= 0.7 | 1.0000 | PASS | ENFORCED |
| current_utility.distribution_parameter_stability_end_value_75 | heuristic_stress_gate | WATCH_ONLY | >= 0.75 | 1.0994 | PASS | ENFORCED |
| ... | ... | ... | ... | ... | ... | 9 more in JSON |

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
| BTC | PASS | 4 | 4 | 0.288151 | 7.083256 | 0.15683 | 0.10999 | current utility asset gate passed |
| ETH | WATCH | 4 | 3 | 0.092177 | 9.569627 | 0.19587 | 0.16814 | bottom calibration watch |

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

### Decoupled Deep-Anchor Candidate

- Verdict: **REJECTED_SYNTHETIC_GATES**
- Best recipe: `library_p75_blend_50` (synthetic gates pass=False, historical utility preserved=True)
- Best synthetic status: **FAIL**; historical terminal win-rate 62%, worst terminal delta -3.7%, new early-exhaustion episodes 0
- The decoupled-deep-anchor sweep tests whether replacing the fixed forecast multiplier with asset-library support can solve the open synthetic gates without touching release mechanics. A rejected result means the remaining failure is not explained by the deep anchor alone; the evidence should be used before proposing a broader production policy change.

| Recipe | Verdict | Synthetic gap | Delayed avg/low | False-bottom 4w unlock | Hist win | Worst hist delta |
|---|---:|---:|---:|---:|---:|---:|
| library_median_blend_50 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 62% | -5.8% |
| library_p75_blend_50 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 62% | -3.7% |
| library_max_blend_35 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 62% | -6.8% |
| library_max_blend_50 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 62% | -7.6% |

### Release-Hardening Candidate

- Research-only causal overlay: throttles early front-loading by realized depth, caps the four-week unlock, and holds a late reserve until a non-forecast trigger (fast crash, deep capitulation, final third, or resolution) fires.
- Verdict: **REJECTED_HISTORICAL_UTILITY** (synthetic gates pass=True, historical utility preserved=False)
- Synthetic common-exam gates: **PASS**
- Historical vs live: terminal win-rate 38%, worst terminal delta -25.2%, mean terminal delta -6.0%, cost-premium win-rate 38%, new early-exhaustion episodes 0

| Synthetic path | Candidate metric | Value | Gate |
|---|---|---:|---|
| delayed_lower_low | avg entry premium to low | 54.5% | <= 60% |
| false_bottom_continued_grind | max four-week unlock | 15.7% | <= 20% |
| fast_v | deployed by fast-V low | 44.4% | >= 30% |
| shallow_recover | terminal vs DCA52 | 98.1% | >= 95% |

| Asset | Episode | Live terminal | Cand terminal | Terminal delta | Live avg/low | Cand avg/low | Premium delta |
|---|---|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.296 | 0.970 | -25.2% | 73.4% | 131.8% | 58.3% |
| ETH | 2018 bear (single low) | 0.566 | 0.442 | -21.8% | 166.7% | 241.1% | 74.4% |
| BTC | 2022 bear (DOUBLE bottom) | 1.827 | 1.725 | -5.5% | 39.5% | 47.7% | 8.2% |
| ETH | 2022 bear (DOUBLE bottom) | 1.607 | 1.475 | -8.2% | 35.1% | 47.2% | 12.1% |
| BTC | 2019 H2 correction (mid-cycle) | 1.131 | 1.195 | 5.7% | 16.6% | 7.0% | -9.6% |
| ETH | 2019 H2 correction (mid-cycle) | 1.336 | 1.390 | 4.0% | 44.9% | 37.3% | -7.6% |
| BTC | 2020 COVID crash (fast V) | 1.480 | 1.443 | -2.5% | 25.9% | 29.3% | 3.4% |
| ETH | 2020 COVID crash (fast V) | 1.849 | 1.952 | 5.5% | 33.5% | 26.0% | -7.5% |

- The release-hardening overlay clears the delayed-lower-low average entry premium and false-bottom four-week unlock synthetic gates by throttling early front-loading and holding a late reserve until a non-forecast trigger fires. On the real accumulation episodes the same deferral buys later and higher in prolonged deep bears (2018 BTC/ETH worst), so terminal value and average cost both deteriorate versus live. Under the pre-registered promotion rule (historical utility AND common exam) the candidate is not promotable; it is recorded as a REJECTED research candidate with an explicit trade-off, not a production change.

### Posterior Target Governor Candidate

- Verdict: **REJECTED_SYNTHETIC_GATES**
- Best recipe: `zero_posterior_lower_bound` (synthetic gates pass=False, historical utility preserved=False)
- Best synthetic status: **FAIL**; historical terminal win-rate 25%, worst terminal delta -14.3%, new early-exhaustion episodes 0
- The posterior-target governor tests the mechanism identified by first-decline attribution. The zero-posterior lower bound improves the open synthetic paths but still leaves delayed-lower-low average entry premium above the 60% gate, so model_target governance alone is insufficient; the remaining failure also involves the duration-CDF/depth-floor path.

| Recipe | Verdict | Synthetic gap | Delayed avg/low | False-bottom 4w unlock | Fast-V DCA18 | Hist win | Worst hist delta |
|---|---:|---:|---:|---:|---:|---:|---:|
| rate_limited_fast_bypass | REJECTED_SYNTHETIC_GATES | 0.125445 | 72.5% | 16.0% | 94.7% | 62% | -7.3% |
| zero_posterior_lower_bound | REJECTED_SYNTHETIC_GATES | 0.063994 | 66.4% | 8.3% | 91.2% | 25% | -14.3% |

### First-Decline-Leg Buy Attribution (research diagnostic)

- Attributes every live-policy buy on the two failing synthetic paths to its deployment mechanism, so the next candidate targets the real driver.

**delayed_lower_low** (low=32.0 at week 56, avg entry premium 73.4%, dominant premium source: `model_target_base`)

| Source | Spent | Avg price | Premium to low | Premium $ contrib | Pre-low | Post-low |
|---|---:|---:|---:|---:|---:|---:|
| model_target_base | 36.2% | 71.7641 | 124.3% | 0.4504 | 36.2% | 0.0% |
| duration_cdf_depth_floor | 40.3% | 48.2511 | 50.8% | 0.2044 | 31.7% | 8.5% |
| price_improvement_catchup | 0.0% | 82.5 | 157.8% | 0.0004 | 0.0% | 0.0% |
| redeploy | 18.0% | 49.4261 | 54.5% | 0.0983 | 0.0% | 18.0% |
- Max four-week unlock 21.5% at weeks 5-8 from: model_target_base 21.5%, price_improvement_catchup 0.0%

**false_bottom_continued_grind** (low=25.0 at week 76, avg entry premium 110.6%, dominant premium source: `model_target_base`)

| Source | Spent | Avg price | Premium to low | Premium $ contrib | Pre-low | Post-low |
|---|---:|---:|---:|---:|---:|---:|
| model_target_base | 38.0% | 77.7518 | 211.0% | 0.8022 | 38.0% | 0.0% |
| duration_cdf_depth_floor | 42.0% | 41.4851 | 65.9% | 0.2767 | 42.0% | 0.0% |
| reserve_tail | 1.0% | 26.5 | 6.0% | 0.0006 | 1.0% | 0.0% |
| price_improvement_catchup | 0.0% | 83.5714 | 234.3% | 0.0006 | 0.0% | 0.0% |
| unattributed | 0.0% | n/a | n/a | n/a | n/a | n/a |
- Max four-week unlock 22.6% at weeks 7-10 from: model_target_base 22.6%

- On both open synthetic failures the model_target (posterior) schedule is the dominant dollar-premium source: it front-loads the working bucket during the first decline leg at the highest pre-low prices (avg premium +124% delayed / +211% false-bottom), while the duration-CDF depth floor and post-low redeploy buy far cheaper. The max four-week unlock is likewise a first-decline-leg working-bucket ramp. This means the deep anchor and the reserve/release mechanics are not the primary levers for these two gates; a future candidate should govern how fast the posterior target itself deploys before final-low risk has decayed.

### Delayed-Premium Gate Attainability (cross-round synthesis)

- Gate: delayed-lower-low avg entry premium <= 60%; attainable without historical-utility loss: **False**; review status: **THRESHOLD_REVIEW_REQUIRED**
- Minimum threshold for any tested lever: 54.5%; for a utility-preserving tested lever: 73.4%

| Lever | Delayed avg premium | Gate pass | Historical utility preserved |
|---|---:|---:|---:|
| live_policy | 73.4% | False | True |
| posterior_target_zero_lower_bound | 66.4% | False | False |
| release_hardening_target_and_depth_floor_throttle | 54.5% | True | False |

| Review threshold | Passing levers | Utility-preserving passing levers | Interpretation |
|---:|---|---|---|
| 60% | release_hardening_target_and_depth_floor_throttle | none | only_non_utility_preserving_or_unscored_levers_pass |
| 65% | release_hardening_target_and_depth_floor_throttle | none | only_non_utility_preserving_or_unscored_levers_pass |
| 70% | posterior_target_zero_lower_bound, release_hardening_target_and_depth_floor_throttle | none | only_non_utility_preserving_or_unscored_levers_pass |
| 75% | live_policy, posterior_target_zero_lower_bound, release_hardening_target_and_depth_floor_throttle | live_policy | at_least_one_utility_preserving_tested_lever_passes |

- Across every tested lever the delayed-lower-low average entry premium gate (<= 60%) is reachable only by throttling first-decline depth-floor deployment (the release-hardening lever), which the historical-utility audit rejects on prolonged 2018-style bears. Governing the posterior target alone floors at roughly 66% because the duration-CDF depth floor independently deploys the working bucket at first-decline prices. No tested lever reaches the gate while preserving historical utility, so within the current policy architecture this gate appears unattainable without historical-utility loss. Per the governance point, the next round should either accept this as the documented trade-off of record, or review whether the 60% threshold is attainable and correctly specified, keeping the current value as a sensitivity row and justifying any change with this frontier rather than tuning to pass.

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
| BTC | 2025-10-06 | 77% | 91% | 1.68 | 146.7% | 0.957093 |
| ETH | 2021-05-12 | 100% | 74% | 20.19 | 299.6% | 19.889905 |
| ETH | 2021-11-10 | 100% | 74% | 8.75 | 255.2% | 8.308763 |
| ETH | 2025-08-22 | 78% | 93% | 1.09 | 217.5% | 0.510212 |

Distribution anti-overfit checks:
- Parameter perturbations: min win-rate 100%, worst low/hold 121.1%, worst end/hold 109.9%
- Top-date jitter [-60, -30, 0, 30, 60]: min win-rate 100%, worst low/hold 100.0%, worst end/hold 114.3%
- Leave-one-top-out: worst held-out low/hold 142.2%, worst held-out end/hold 139.0%
- Chronological holdout since 2021-01-01: win-rate 100%, worst end/hold 139.0%

| Perturbation | Windows | Win-rate | Worst low/hold | Worst end/hold | Median avg/peak |
|---|---:|---:|---:|---:|---:|
| live | 7 | 100% | 142.2% | 139.0% | 79% |
| earlier_tighter | 7 | 100% | 145.6% | 142.2% | 80% |
| later_looser | 7 | 100% | 121.1% | 109.9% | 84% |
| less_rerisk | 7 | 100% | 139.2% | 136.0% | 77% |

| Top-date jitter | Windows | Win-rate | Worst low/hold | Worst end/hold |
|---:|---:|---:|---:|---:|
| -60d | 7 | 100% | 100.0% | 114.7% |
| -30d | 7 | 100% | 146.1% | 114.3% |
| 0d | 7 | 100% | 142.2% | 139.0% |
| 30d | 7 | 100% | 151.3% | 146.7% |
| 60d | 7 | 100% | 151.3% | 146.7% |

Distribution diagnostics:
- Worst value at post-top low: BTC 2021-04-14 sold=90% low/hold=142.2% end/hold=139.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=146.7%; BTC 2021-11-10 sold=90% low/hold=215.4% end/hold=207.2%
- Worst end value vs hold: BTC 2021-04-14 sold=90% low/hold=142.2% end/hold=139.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=146.7%; BTC 2021-11-10 sold=90% low/hold=215.4% end/hold=207.2%
- Lowest sold fraction: BTC 2017-12-17 sold=77% low/hold=418.9% end/hold=382.0%; BTC 2025-10-06 sold=77% low/hold=151.3% end/hold=146.7%; ETH 2025-08-22 sold=78% low/hold=243.3% end/hold=217.5%
