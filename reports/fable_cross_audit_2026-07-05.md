# Fable Cross-Audit Summary

Date recorded: 2026-07-05

Source: user-provided Fable memo, with receipts listed there as
`../crypto-cycle-detection-fable/reports/HYPOTHESIS_CODEX_CONVEX_CROSS_AUDIT.md`,
`../crypto-cycle-detection-fable/reports/model_cross_audit.{json,log}` and
`../crypto-cycle-detection-fable/NOTES.md` 2026-07-04.

## Scope

Fable audited the Model convex policy core as a native Fable policy family. The
audit did not include this dashboard's hard-reserve release leg, redeploy leg or
re-arm logic, so the result should not be read as a full-stack dashboard replay.

## Findings

- The convex depth back-load direction showed real held-out merit: median LOCO
  terminal-value ratio vs DCA-18 was 1.038 for the Model core vs 1.012 for
  Fable's standing policy.
- The current dashboard utility gates are not the stricter common exam. Asset
  utility PASS does not imply parameter plateau or synthetic-stress robustness.
- The core failed the +/-25% parameter plateau: worst shift was 0.292 at
  `MAX_HORIZON_WEEKS x0.75`, above the 0.15 limit.
- The core also failed synthetic stress: delayed-lower-low ended at TV 0.546 vs
  0.762 for DCA-18 in the audited port, and one fast-V row was below the 30%
  deployed-at-low floor.
- The 52-week floor appears to be a tuned cliff until a broader horizon mixture
  or duration-CDF floor passes the same plateau gate.
- Forecast-coupled reserve anchoring can exhaust working capital above trailing
  lower lows; last-tranche release needs a non-forecast trigger before
  promotion.
- Downside probabilities need held-out LOCO log-loss and coverage checks before
  high-confidence claims are treated as sizing-grade.

## Dashboard Response

- Keep the convex direction visible as a candidate with merit.
- Surface common-exam status in the first viewport.
- Treat utility PASS labels as scoped.
- Block robustness promotion until full-stack reserve/re-arm replay passes the
  parameter plateau and synthetic-shape gates.
