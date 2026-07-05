# Common Exam Audit

Generated: 2026-07-05T19:57:49.099637+00:00
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
| forecast_coupled_deep_anchor | OPEN_LAST_TRANCHE_DECOUPLED | Deep anchor is coupled to the bottom forecast through DEPLOY_DEEP_ANCHOR_M=0.6. |
| forecast_driven_last_tranche | MITIGATED_RETEST_REQUIRED | DEPLOY_LAST_TRANCHE_FRACTION=0.92 is locked until absolute observed drawdown exceeds the historical library or recovery/resolution confirmation fires. |
| historical_left_tail_cost | OPEN | Historical replay contains left-tail cost weak spots; see accumulation episode rows for negative utility or high average-cost premium cases. |

## Pre-Registered Gates

| Gate | Status | Result Summary | Pass Criteria |
|---|---:|---|---|
| parameter_plateau_25pct | FAIL | cells=11, failing=4, worst shift=10.0%, worst held-out delta=-12.9% | Worst terminal-ratio shift stays within 15% of the live policy.; No grid cell fails the current historical audit thresholds.; No asset has a worse held-out terminal edge than the current live audit by more than 5 percentage points. |
| synthetic_delayed_lower_low | PASS | paths=1, failing=0, min DCA18 ratio=1.287973, min DCA52 ratio=1.065296 | Deployment at the final low remains below 85% unless an explicit capitulation confirmation fires.; Average entry premium versus the final low stays below 60%.; No early-exhaustion flag is triggered. |
| synthetic_false_bottom_continued_grind | PASS | paths=1, failing=0, min DCA18 ratio=1.435497, min DCA52 ratio=1.243951 | Policy preserves at least the hard reserve floor until the final third of the path.; Terminal value beats fixed 52-week DCA after fees/slippage assumptions used by the research engine.; No single false-bottom bounce unlocks more than 20 percentage points of additional deployment. |
| synthetic_fast_v_participation | PASS | paths=1, failing=0, min DCA18 ratio=1.033405, min DCA52 ratio=1.164676 | Policy deploys at least 30% by the fast-V low.; Terminal value stays within 10% of fixed 18-week DCA. |
| synthetic_shallow_recover | PASS | paths=1, failing=0, min DCA18 ratio=0.844307, min DCA52 ratio=0.953953 | Terminal value stays within 5% of fixed 52-week DCA.; The shallow governor prevents a non-violent correction from exhausting reserve early. |
| early_exhaustion_guard | FAIL | historical flags=1, synthetic flags=0 | No historical episode triggers early exhaustion.; No synthetic adverse path triggers early exhaustion.; Any policy candidate that triggers early exhaustion is blocked from dashboard promotion. |

## Promotion Rule

A future policy may be labelled fully promoted only if both the current historical utility audit and the common-exam gates pass. Until then, dashboard PASS labels must be scoped as current utility audit only.

## Re-Entry Candidates

- `decoupled_deep_anchor`: Test an anchor partly tied to realized valuation support or prior-cycle support rather than only the current bottom forecast multiplier.
- `delayed_release_reserve`: Keep a larger late reserve until capitulation, time exhaustion, or recovery above a predeclared markup confirms.
- `anti_false_bottom_unlock`: Limit catch-up and redeploy releases after shallow bounces unless final-low risk has materially decayed.
