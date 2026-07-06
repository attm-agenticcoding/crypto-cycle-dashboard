# Common Exam Audit

Generated: 2026-07-06T15:20:41.502005+00:00
Verdict: **FAIL**

The current dashboard verdict is scoped to the historical utility audit. The stricter common-exam gates now replay parameter plateau and synthetic adverse paths through the dashboard full stack. Fable's external core-only cross-audit remains recorded as a separate warning because it failed the convex core on plateau and synthetic-shape stress.

## Boundary

- Current utility audit: **WATCH**
- Common-exam gates: **FAIL**
- Reason: The existing PASS covers utility, historical replay, jitter, target 90/110/lagged perturbations, leave-one-episode-out, and chronological holdout. The common exam below is a stricter promotion layer and should be read separately from the current utility verdict and from the Fable 2026-07-05 core-only cross-audit.

## Known Risks

| Risk | Status | Evidence |
|---|---:|---|
| horizon_cliff | MITIGATED_RETEST_REQUIRED | The live policy now uses deploy_duration_cdf_floor() with horizon multipliers (1.0, 1.5, 2.0) instead of a single linear 52-week clock. |
| forecast_coupled_deep_anchor | TESTED_REJECTED_SYNTHETIC_GATES | Deep anchor is coupled to the bottom forecast through DEPLOY_DEEP_ANCHOR_M=0.6; anchor-only candidate verdict=REJECTED_SYNTHETIC_GATES. |
| forecast_driven_last_tranche | MITIGATED_RETEST_REQUIRED | DEPLOY_LAST_TRANCHE_FRACTION=0.95 is locked until absolute observed drawdown exceeds the historical library or recovery/resolution confirmation fires. |
| historical_left_tail_cost | OPEN | Historical replay contains left-tail cost weak spots; see accumulation episode rows for negative utility or high average-cost premium cases. |

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

## Pre-Registered Gates

| Gate | Status | Result Summary | Pass Criteria |
|---|---:|---|---|
| parameter_plateau_25pct | FAIL | cells=11, failing=4, worst shift=10.0%, worst held-out delta=-12.9%, materiality=DELTA_ONLY_REVIEW, delta-only=4, positive-edge delta-only=3 | Worst terminal-ratio shift stays within 15% of the live policy.; No grid cell fails the current historical audit thresholds.; No asset has a worse held-out terminal edge than the current live audit by more than 5 percentage points. |
| synthetic_delayed_lower_low | FAIL | paths=1, failing=1, min DCA18 ratio=1.287973, min DCA52 ratio=1.065296 | Deployment at the final low remains below 85% unless an explicit capitulation confirmation fires.; Average entry premium versus the final low stays below 60%.; Terminal value stays within 10% of fixed 18-week DCA.; No early-exhaustion flag is triggered. |
| synthetic_false_bottom_continued_grind | FAIL | paths=1, failing=1, min DCA18 ratio=1.429945, min DCA52 ratio=1.23914 | Policy preserves at least the hard reserve floor until the final third of the path.; Terminal value beats fixed 52-week DCA after fees/slippage assumptions used by the research engine.; No single false-bottom bounce unlocks more than 20 percentage points of additional deployment. |
| synthetic_fast_v_participation | PASS | paths=1, failing=0, min DCA18 ratio=1.033405, min DCA52 ratio=1.164676 | Policy deploys at least 30% by the fast-V low.; Terminal value stays within 10% of fixed 18-week DCA. |
| synthetic_shallow_recover | PASS | paths=1, failing=0, min DCA18 ratio=0.844307, min DCA52 ratio=0.953953 | Terminal value stays within 5% of fixed 52-week DCA.; The shallow governor prevents a non-violent correction from exhausting reserve early. |
| early_exhaustion_guard | PASS | historical flags=0, synthetic flags=0 | No historical episode triggers early exhaustion.; No synthetic adverse path triggers early exhaustion.; Any policy candidate that triggers early exhaustion is blocked from dashboard promotion. |

## Decoupled Deep-Anchor Candidate (research-only)

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

## Release-Hardening Candidate (research-only)

- Verdict: **REJECTED_HISTORICAL_UTILITY**
- Synthetic common-exam gates: **PASS** (delayed_lower_low=PASS, false_bottom=PASS, fast_v=PASS, shallow_recover=PASS)
- Historical utility vs live (n=8): terminal win-rate 38% (gate >= 60%), worst terminal delta -25.2% (gate >= -15%), new early-exhaustion episodes 0
- Historical utility preserved: **False**
- The release-hardening overlay clears the delayed-lower-low average entry premium and false-bottom four-week unlock synthetic gates by throttling early front-loading and holding a late reserve until a non-forecast trigger fires. On the real accumulation episodes the same deferral buys later and higher in prolonged deep bears (2018 BTC/ETH worst), so terminal value and average cost both deteriorate versus live. Under the pre-registered promotion rule (historical utility AND common exam) the candidate is not promotable; it is recorded as a REJECTED research candidate with an explicit trade-off, not a production change.

## Promotion Rule

A future policy may be labelled fully promoted only if both the current historical utility audit and the common-exam gates pass. Until then, dashboard PASS labels must be scoped as current utility audit only.

## Re-Entry Candidates

- `decoupled_deep_anchor` (TESTED_REJECTED_SYNTHETIC_GATES): Test an anchor partly tied to realized valuation support or prior-cycle support rather than only the current bottom forecast multiplier.
- `delayed_release_reserve` (TESTED_REJECTED_HISTORICAL_UTILITY): Keep a larger late reserve until capitulation, time exhaustion, or recovery above a predeclared markup confirms.
- `anti_false_bottom_unlock` (TESTED_REJECTED_HISTORICAL_UTILITY): Limit catch-up and redeploy releases after shallow bounces unless final-low risk has materially decayed.
