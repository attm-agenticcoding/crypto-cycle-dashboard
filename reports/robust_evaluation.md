# Robust Evaluation

Generated: 2026-08-31T18:59:30.515444+00:00
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
- parameter_plateau_25pct: FAIL (cells=11, failing=3, worst shift=9.9%, materiality=DELTA_ONLY_REVIEW, delta-only=3)
- synthetic_delayed_lower_low: PASS_BY_NON_DOMINANCE (paths=1, failing=1, min DCA18 ratio=1.287973)
- synthetic_false_bottom_continued_grind: PASS_BY_RATCHET (paths=1, failing=1, min DCA18 ratio=1.429945)
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
| forecast.bottom_loco_log_loss_vs_null | baseline_relative_gate | REPORT_ONLY | <= 0.0 | 0.0441 | TRIGGERED | ENFORCED |
| forecast.bottom_raw_p10_p90_coverage_80 | nominal_statistical_target | REPORT_ONLY | >= 0.8 | 0.5413 | TRIGGERED | ENFORCED |
| forecast.bottom_conformal_each_fold_coverage_80 | heuristic_stress_gate | RESEARCH_WARNING | >= 0.8 | 0.0000 | TRIGGERED | ENFORCED |
| common_exam.parameter_plateau_heldout_edge_deterioration_5pp | heuristic_stress_gate | HARD_PROMOTION_BLOCK | >= -0.05 | -0.1299 | TRIGGERED | ENFORCED |
| common_exam.synthetic_delayed_lower_low_avg_premium_60 | heuristic_stress_gate | HARD_PROMOTION_BLOCK | <= 0.6 | 0.7336 | TRIGGERED | ENFORCED |
| common_exam.synthetic_false_bottom_unlock_20pp | heuristic_stress_gate | HARD_PROMOTION_BLOCK | <= 0.2 | 0.2260 | TRIGGERED | ENFORCED |
| forecast.bottom_down20_calibration_mae_0_18 | policy_risk_tolerance | WATCH_ONLY | <= 0.18 | 0.1772 | PASS | ENFORCED |
| forecast.top_drawdown35_calibration_mae_0_18 | policy_risk_tolerance | WATCH_ONLY | <= 0.18 | 0.1730 | PASS | ENFORCED |
| current_utility.accum_parameter_stability_terminal_win_50 | heuristic_stress_gate | WATCH_ONLY | >= 0.5 | 0.8750 | PASS | ENFORCED |
| current_utility.accum_window_jitter_terminal_win_60 | heuristic_stress_gate | WATCH_ONLY | >= 0.6 | 0.7500 | PASS | ENFORCED |
| current_utility.accum_window_jitter_cost_win_50 | heuristic_stress_gate | WATCH_ONLY | >= 0.5 | 0.6250 | PASS | ENFORCED |
| current_utility.accum_window_jitter_worst_terminal_edge_minus15 | heuristic_stress_gate | WATCH_ONLY | >= -0.15 | -0.0359 | PASS | ENFORCED |
| current_utility.accum_target_perturbation_terminal_win_60 | heuristic_stress_gate | WATCH_ONLY | >= 0.6 | 0.7500 | PASS | ENFORCED |
| current_utility.accum_target_perturbation_cost_win_50 | heuristic_stress_gate | WATCH_ONLY | >= 0.5 | 0.7500 | PASS | ENFORCED |
| current_utility.accum_target_perturbation_worst_terminal_edge_minus15 | heuristic_stress_gate | WATCH_ONLY | >= -0.15 | -0.0371 | PASS | ENFORCED |
| current_utility.accum_loo_worst_terminal_edge_minus15 | heuristic_stress_gate | WATCH_ONLY | >= -0.15 | -0.0197 | PASS | ENFORCED |
| current_utility.distribution_parameter_stability_win_rate_70 | heuristic_stress_gate | WATCH_ONLY | >= 0.7 | 1.0000 | PASS | ENFORCED |
| current_utility.distribution_parameter_stability_end_value_75 | heuristic_stress_gate | WATCH_ONLY | >= 0.75 | 0.8572 | PASS | ENFORCED |
| ... | ... | ... | ... | ... | ... | 9 more in JSON |

## Forecast Calibration

- BTC bottom: n=452, down20 MAE raw→cal=0.29615→0.15435, brier raw→cal=0.32976→0.28008, median low abs err=33.1%, timing abs days=85.0
  - LOCO: low<spot LL raw/cal/null=0.22511/0.19955/0.16792; down20 LL raw/cal/null=1.18077/0.74588/0.71645; p10-p90 coverage=57.3% (target 80%); conformal candidate coverage=84.1% scale med/final=2.00042/1.99381, folds=WEAK_FOLDS min=0.0%
- ETH bottom: n=399, down20 MAE raw→cal=0.20672→0.17722, brier raw→cal=0.27016→0.27712, median low abs err=50.7%, timing abs days=75.0
  - LOCO: low<spot LL raw/cal/null=0.21948/0.14487/0.10076; down20 LL raw/cal/null=1.06955/0.7085/0.7056; p10-p90 coverage=54.1% (target 80%); conformal candidate coverage=84.5% scale med/final=1.95689/1.94657, folds=WEAK_FOLDS min=0.0%
- BTC top: n=130, dd35 MAE raw→cal=0.09764→0.10566, brier raw→cal=0.22813→0.23235, event rate=30.8%, avg pred raw→cal=23.4%→31.7%
- ETH top: n=93, dd35 MAE raw→cal=0.27704→0.17298, brier raw→cal=0.32763→0.31117, event rate=50.5%, avg pred raw→cal=22.8%→33.5%

## Policy Objective

- Version: policy-utility-v1
- Purpose: Judge policy changes by causal capital-deployment outcomes, not by bottom/top forecast aesthetics.
- Accumulation utility: `pool_return - 0.30*avg_entry_premium_to_low - 0.20*max_portfolio_drawdown - 0.10*underparticipation_at_low + 0.05*dry_at_low_optional_reserve`
- Distribution utility: `(value_at_post_top_low-1) + 0.30*(end_value_vs_hold-1) + 0.20*avg_sell_pct_of_peak - 0.20*max_portfolio_drawdown - 0.10*underdistribution`

## Asset Stratification

| Asset | Status | Accum eps | Dist windows | Acc utility | Dist utility | Bottom MAE | Top MAE | Reasons |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| BTC | PASS | 4 | 4 | 0.275421 | 8.159739 | 0.15435 | 0.10566 | current utility asset gate passed |
| ETH | PASS | 4 | 3 | 0.033213 | 9.082234 | 0.17722 | 0.17298 | current utility asset gate passed |

## Accumulation Policy

- Episodes: 8
- Terminal win-rate vs median simple baseline: 88%
- Avg-cost win-rate vs median simple baseline: 75%
- Worst terminal edge vs median baseline: -2.0%
- Mean terminal edge vs median baseline: 20.4%

| Asset | Episode | Policy terminal | Edge vs median | Avg/low | Cost edge | Utility |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.31 | 38.4% | 74.3% | -80.8% | 0.018212 |
| ETH | 2018 bear (single low) | 0.59 | 21.2% | 168.3% | -416.9% | -1.022332 |
| BTC | 2022 bear (DOUBLE bottom) | 1.71 | 40.0% | 51.5% | -36.5% | 0.523602 |
| ETH | 2022 bear (DOUBLE bottom) | 1.55 | 46.9% | 37.4% | -59.9% | 0.406165 |
| BTC | 2019 H2 correction (mid-cycle) | 1.14 | 2.7% | 17.3% | -3.6% | 0.092393 |
| ETH | 2019 H2 correction (mid-cycle) | 1.14 | -2.0% | 39.6% | 3.1% | 0.01831 |
| BTC | 2020 COVID crash (fast V) | 1.55 | 12.9% | 24.9% | -3.4% | 0.467475 |
| ETH | 2020 COVID crash (fast V) | 1.87 | 2.7% | 44.3% | 17.9% | 0.730708 |

### Expected-Regret Candidate

- Research-only reference-style expected-regret sizing ported into the Model accumulation harness.
- Terminal win-rate vs Model live: 38%
- Avg-cost win-rate vs Model live: 62%
- Mean terminal delta vs Model: 2.1%
- Mean avg-cost premium delta vs Model: -6.7%
- Worst terminal delta vs Model: -42.0%

| Asset | Episode | Policy terminal | Exp-reg terminal | Delta | Model avg/low | Exp-reg avg/low | Model spent@low | Exp-reg spent@low |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.308 | 1.941 | 63.3% | 74.3% | 17.6% | 79% | 40% |
| ETH | 2018 bear (single low) | 0.589 | 0.563 | -2.6% | 168.3% | 180.9% | 72% | 88% |
| BTC | 2022 bear (DOUBLE bottom) | 1.712 | 1.939 | 22.7% | 51.5% | 33.8% | 67% | 84% |
| ETH | 2022 bear (DOUBLE bottom) | 1.546 | 1.584 | 3.8% | 37.4% | 34.1% | 43% | 1% |
| BTC | 2019 H2 correction (mid-cycle) | 1.143 | 1.025 | -11.8% | 17.3% | 5.4% | 57% | 5% |
| ETH | 2019 H2 correction (mid-cycle) | 1.141 | 1.025 | -11.6% | 39.6% | 34.4% | 49% | 3% |
| BTC | 2020 COVID crash (fast V) | 1.547 | 1.496 | -5.1% | 24.9% | 33.2% | 30% | 12% |
| ETH | 2020 COVID crash (fast V) | 1.872 | 1.452 | -42.0% | 44.3% | 64.5% | 46% | 3% |

### Cap-Regime Switch Candidate

- Research-only hybrid: expected-regret sizing in mature/deep bears, Model full-policy cumulative target in causal fast-shock/shallow-correction regimes.
- Terminal win-rate vs Model live: 38%
- Avg-cost win-rate vs Model live: 38%
- Mean terminal delta vs Model: 10.9%
- Mean avg-cost premium delta vs Model: -8.1%
- Worst terminal delta vs Model: -2.6%
- Mean weeks using Model regime: 50%

| Asset | Episode | Policy terminal | Exp-reg terminal | Cap-switch terminal | Cap delta | Model avg/low | Exp-reg avg/low | Cap avg/low | Cap spent@low | Model-regime weeks |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.308 | 1.941 | 1.941 | 63.3% | 74.3% | 17.6% | 17.6% | 40% | 0% |
| ETH | 2018 bear (single low) | 0.589 | 0.563 | 0.563 | -2.6% | 168.3% | 180.9% | 180.9% | 88% | 0% |
| BTC | 2022 bear (DOUBLE bottom) | 1.712 | 1.939 | 1.939 | 22.7% | 51.5% | 33.8% | 33.8% | 84% | 0% |
| ETH | 2022 bear (DOUBLE bottom) | 1.546 | 1.584 | 1.584 | 3.8% | 37.4% | 34.1% | 34.1% | 1% | 0% |
| BTC | 2019 H2 correction (mid-cycle) | 1.143 | 1.025 | 1.143 | 0.0% | 17.3% | 5.4% | 17.3% | 57% | 100% |
| ETH | 2019 H2 correction (mid-cycle) | 1.141 | 1.025 | 1.139 | -0.2% | 39.6% | 34.4% | 40.0% | 42% | 97% |
| BTC | 2020 COVID crash (fast V) | 1.547 | 1.496 | 1.547 | 0.0% | 24.9% | 33.2% | 24.9% | 30% | 100% |
| ETH | 2020 COVID crash (fast V) | 1.872 | 1.452 | 1.872 | 0.0% | 44.3% | 64.5% | 44.3% | 46% | 100% |

### Decoupled Deep-Anchor Candidate

- Verdict: **REJECTED_SYNTHETIC_GATES**
- Best recipe: `library_max_blend_35` (synthetic gates pass=False, historical utility preserved=True)
- Best synthetic status: **FAIL**; historical terminal win-rate 62%, worst terminal delta -7.0%, new early-exhaustion episodes 0
- The decoupled-deep-anchor sweep tests whether replacing the fixed forecast multiplier with asset-library support can solve the open synthetic gates without touching release mechanics. A rejected result means the remaining failure is not explained by the deep anchor alone; the evidence should be used before proposing a broader production policy change.

| Recipe | Verdict | Synthetic gap | Delayed avg/low | False-bottom 4w unlock | Hist win | Worst hist delta |
|---|---:|---:|---:|---:|---:|---:|
| library_median_blend_50 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 50% | -2.9% |
| library_p75_blend_50 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 50% | -4.1% |
| library_max_blend_35 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 62% | -7.0% |
| library_max_blend_50 | REJECTED_SYNTHETIC_GATES | 0.159564 | 73.4% | 22.6% | 62% | -7.7% |

### Release-Hardening Candidate

- Research-only causal overlay: throttles early front-loading by realized depth, caps the four-week unlock, and holds a late reserve until a non-forecast trigger (fast crash, deep capitulation, final third, or resolution) fires.
- Verdict: **REJECTED_HISTORICAL_UTILITY** (synthetic gates pass=True, historical utility preserved=False)
- Synthetic common-exam gates: **PASS**
- Historical vs live: terminal win-rate 38%, worst terminal delta -19.5%, mean terminal delta -3.7%, cost-premium win-rate 38%, new early-exhaustion episodes 0

| Synthetic path | Candidate metric | Value | Gate |
|---|---|---:|---|
| delayed_lower_low | avg entry premium to low | 54.5% | <= 60% |
| false_bottom_continued_grind | max four-week unlock | 15.7% | <= 20% |
| fast_v | deployed by fast-V low | 44.4% | >= 30% |
| shallow_recover | terminal vs DCA52 | 98.1% | >= 95% |

| Asset | Episode | Live terminal | Cand terminal | Terminal delta | Live avg/low | Cand avg/low | Premium delta |
|---|---|---:|---:|---:|---:|---:|---:|
| BTC | 2018 bear (single low) | 1.308 | 1.126 | -13.9% | 74.3% | 102.6% | 28.3% |
| ETH | 2018 bear (single low) | 0.589 | 0.474 | -19.5% | 168.3% | 233.1% | 64.8% |
| BTC | 2022 bear (DOUBLE bottom) | 1.712 | 1.681 | -1.8% | 51.5% | 54.3% | 2.8% |
| ETH | 2022 bear (DOUBLE bottom) | 1.546 | 1.519 | -1.8% | 37.4% | 39.9% | 2.5% |
| BTC | 2019 H2 correction (mid-cycle) | 1.143 | 1.172 | 2.5% | 17.3% | 13.1% | -4.2% |
| ETH | 2019 H2 correction (mid-cycle) | 1.141 | 1.169 | 2.4% | 39.6% | 34.5% | -5.1% |
| BTC | 2020 COVID crash (fast V) | 1.547 | 1.490 | -3.7% | 24.9% | 30.0% | 5.1% |
| ETH | 2020 COVID crash (fast V) | 1.872 | 1.981 | 5.8% | 44.3% | 35.8% | -8.5% |

- The release-hardening overlay clears the delayed-lower-low average entry premium and false-bottom four-week unlock synthetic gates by throttling early front-loading and holding a late reserve until a non-forecast trigger fires. On the real accumulation episodes the same deferral buys later and higher in prolonged deep bears (2018 BTC/ETH worst), so terminal value and average cost both deteriorate versus live. Under the pre-registered promotion rule (historical utility AND common exam) the candidate is not promotable; it is recorded as a REJECTED research candidate with an explicit trade-off, not a production change.

### Posterior Target Governor Candidate

- Verdict: **REJECTED_SYNTHETIC_GATES**
- Best recipe: `zero_posterior_lower_bound` (synthetic gates pass=False, historical utility preserved=False)
- Best synthetic status: **FAIL**; historical terminal win-rate 25%, worst terminal delta -14.1%, new early-exhaustion episodes 0
- The posterior-target governor tests the mechanism identified by first-decline attribution. The zero-posterior lower bound improves the open synthetic paths but still leaves delayed-lower-low average entry premium above the 60% gate, so model_target governance alone is insufficient; the remaining failure also involves the duration-CDF/depth-floor path.

| Recipe | Verdict | Synthetic gap | Delayed avg/low | False-bottom 4w unlock | Fast-V DCA18 | Hist win | Worst hist delta |
|---|---:|---:|---:|---:|---:|---:|---:|
| rate_limited_fast_bypass | REJECTED_SYNTHETIC_GATES | 0.125445 | 72.5% | 16.0% | 94.7% | 38% | -5.7% |
| zero_posterior_lower_bound | REJECTED_SYNTHETIC_GATES | 0.063994 | 66.4% | 8.3% | 91.2% | 25% | -14.1% |

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

### Cost Of Relaxation

| Option | Delayed avg premium | Premium reduction vs live | Historical cost to accept |
|---|---:|---:|---|
| Keep current gate/blocker and live policy | 73.4% | 0.0% | none (status quo); current utility terminal win-rate vs median baseline 88% |
| Accept target-zero lower bound behavior | 66.4% | 7.0% | historical utility not preserved; verdict REJECTED_SYNTHETIC_GATES; terminal win-rate vs live 25%; worst terminal delta -14.1%; cost win-rate vs live 38%; worst cost-premium delta 17.9% |
| Accept release-hardening throttle behavior | 54.5% | 18.8% | historical utility not preserved; verdict REJECTED_HISTORICAL_UTILITY; terminal win-rate vs live 38%; worst terminal delta -19.5%; cost win-rate vs live 38%; worst cost-premium delta 64.8% |

- Across every tested lever the delayed-lower-low average entry premium gate (<= 60%) is reachable only by throttling first-decline depth-floor deployment (the release-hardening lever), which the historical-utility audit rejects on prolonged 2018-style bears. Governing the posterior target alone floors at roughly 66% because the duration-CDF depth floor independently deploys the working bucket at first-decline prices. No tested lever reaches the gate while preserving historical utility, so within the current policy architecture this gate appears unattainable without historical-utility loss. Per the governance point, the next round should either accept this as the documented trade-off of record, or review whether the 60% threshold is attainable and correctly specified, keeping the current value as a sensitivity row and justifying any change with this frontier rather than tuning to pass.

### Frontier-Aware Gate Proposal (research-only)

- Status: **PROPOSED_FRONTIER_AWARE_PASS**; proposed delayed-premium verdict: **PASS_BY_NON_DOMINANCE**; production policy change: **False**
- Non-dominance: incumbent `live_policy` non-dominated=**True**; dominating levers: none
- Relative premium guard vs `fixed_18w_dca_same_synthetic_path`: policy 73.4%; baseline 123.8%; policy/baseline 59.3%; status **PASS**
- Absolute 60% gate under this proposal: triggered=True; proposed effect=**WATCH_SENSITIVITY_ONLY**

- Recommended spec: Use non-dominance on the frozen delayed-premium/historical-utility frontier as the primary delayed-premium promotion criterion; keep the absolute 60/65/70/75 thresholds as WATCH sensitivity rows; retain a same-path DCA18-relative premium guard to catch genuine over-eagerness.
- This is a governance proposal, not a production change. It records that the incumbent survives by non-dominance: no tested candidate lowers delayed-premium while preserving historical utility.

Parameter stability:
- live: terminal win-rate 88%, worst edge -2.0%, mean edge 20.4%
- shallower_faster: terminal win-rate 88%, worst edge -2.7%, mean edge 19.7%
- deeper_more_reserve: terminal win-rate 88%, worst edge -1.7%, mean edge 19.6%

Accumulation anti-overfit checks:
- Window jitter: min terminal win-rate 75%, min cost win-rate 62%, worst terminal edge -3.6%
- Target perturbations: min terminal win-rate 75%, min cost win-rate 75%, worst terminal edge -3.7%
- Leave-one-episode-out: worst held-out terminal edge -2.0%, worst held-out cost edge 17.9%
- Chronological holdout since 2020-01-01: terminal win-rate 100%, worst terminal edge 2.7%
- Cap-switch window jitter vs Model: min terminal win-rate 38%, worst terminal delta -24.2%, worst cost delta 106.4%
- Cap-switch target perturbation vs Model: min terminal win-rate 38%, worst terminal delta -2.7%, worst cost delta 12.9%
- Cap-switch leave-one-episode-out vs Model: min remaining terminal win-rate 29%, worst held-out terminal delta -2.6%, worst held-out cost delta 12.6%
- Cap-switch chronological holdout since 2020-01-01: terminal win-rate 50%, worst terminal delta 0.0%

| Window jitter | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| start -30d / end 0d | 8 | 88% | 88% | -1.2% | 11.1% |
| start 0d / end -30d | 8 | 100% | 88% | 4.4% | 12.3% |
| start 0d / end 0d | 8 | 88% | 75% | -2.0% | 17.9% |
| start 0d / end 30d | 8 | 100% | 62% | 1.4% | 22.8% |
| start 30d / end 0d | 8 | 75% | 75% | -3.6% | 23.9% |

| Target perturbation | Episodes | Terminal win | Cost win | Worst terminal edge | Worst cost edge |
|---|---:|---:|---:|---:|---:|
| live | 8 | 88% | 75% | -2.0% | 17.9% |
| conservative_90 | 8 | 75% | 75% | -3.7% | 22.6% |
| aggressive_110 | 8 | 88% | 75% | -1.7% | 13.6% |
| lagged_14d | 8 | 88% | 75% | -2.0% | 19.7% |

## Distribution Policy

- Windows: 7
- Value-at-low win-rate vs hold: 100%
- Windows with end value below 75% of hold: 0
- Worst end value vs hold: 134.3%
- Mean value-at-low edge vs hold: +5.48

| Asset | Top | Sold | Avg/peak | Value@low | End vs hold | Utility |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 2017-12-17 | 77% | 91% | 19.99 | 392.0% | 19.979985 |
| BTC | 2021-04-14 | 100% | 79% | 8.97 | 154.5% | 8.254199 |
| BTC | 2021-11-10 | 100% | 79% | 3.97 | 265.5% | 3.579023 |
| BTC | 2025-10-06 | 77% | 92% | 1.59 | 134.3% | 0.82575 |
| ETH | 2021-05-12 | 100% | 70% | 19.65 | 219.2% | 19.099476 |
| ETH | 2021-11-10 | 100% | 70% | 8.29 | 248.3% | 7.81773 |
| ETH | 2025-08-22 | 76% | 94% | 1.07 | 164.5% | 0.329495 |

Distribution anti-overfit checks:
- Parameter perturbations: min win-rate 100%, worst low/hold 118.8%, worst end/hold 85.7%
- Top-date jitter [-60, -30, 0, 30, 60]: min win-rate 100%, worst low/hold 100.0%, worst end/hold 114.0%
- Leave-one-top-out: worst held-out low/hold 153.2%, worst held-out end/hold 134.3%
- Chronological holdout since 2021-01-01: win-rate 100%, worst end/hold 134.3%

| Perturbation | Windows | Win-rate | Worst low/hold | Worst end/hold | Median avg/peak |
|---|---:|---:|---:|---:|---:|
| live | 7 | 100% | 153.2% | 134.3% | 79% |
| earlier_tighter | 7 | 100% | 155.5% | 136.3% | 79% |
| later_looser | 7 | 100% | 118.8% | 85.7% | 78% |
| less_rerisk | 7 | 100% | 150.3% | 134.9% | 77% |

| Top-date jitter | Windows | Win-rate | Worst low/hold | Worst end/hold |
|---:|---:|---:|---:|---:|
| -60d | 7 | 100% | 100.0% | 114.0% |
| -30d | 7 | 100% | 147.4% | 126.2% |
| 0d | 7 | 100% | 153.2% | 134.3% |
| 30d | 7 | 100% | 153.2% | 134.3% |
| 60d | 7 | 100% | 153.2% | 134.3% |

Distribution diagnostics:
- Worst value at post-top low: BTC 2025-10-06 sold=77% low/hold=153.2% end/hold=134.3%; BTC 2021-04-14 sold=100% low/hold=154.5% end/hold=154.5%; ETH 2021-05-12 sold=100% low/hold=219.2% end/hold=219.2%
- Worst end value vs hold: BTC 2025-10-06 sold=77% low/hold=153.2% end/hold=134.3%; BTC 2021-04-14 sold=100% low/hold=154.5% end/hold=154.5%; ETH 2025-08-22 sold=76% low/hold=241.1% end/hold=164.5%
- Lowest sold fraction: ETH 2025-08-22 sold=76% low/hold=241.1% end/hold=164.5%; BTC 2017-12-17 sold=77% low/hold=431.5% end/hold=392.0%; BTC 2025-10-06 sold=77% low/hold=153.2% end/hold=134.3%
