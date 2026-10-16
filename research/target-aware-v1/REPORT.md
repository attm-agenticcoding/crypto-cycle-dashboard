# Phase 2 findings and review gates

Date: 2026-10-05. Scope: isolated research prototype and synthetic engineering comparison.

## Bottom line

The target-position state machine is the useful foundation: it keeps current
holdings, target holdings, actual fills, active-order reservations and the
optional deadline in one causal ledger. There is no evidence here that one
ladder is economically optimal. Changing the assumed fill/liquidity scenario
materially changes the cost/completion trade-off. A price-only archive cannot
resolve that uncertainty.

Recommended implementation order, not an investment recommendation:

1. Integrate and review the ledger, target-unit objective and feasibility/error
   states before replacing any live sizing formula. Retain the current UI until
   that separate integration is tested.
2. Use same-horizon TWAP as the simplest completion-oriented reference; keep
   earliest-feasible execution as a separate urgency/cost benchmark. Both still
   depend on executable prices, liquidity, cash and operational access.
3. Present the 50% hybrid as a transparent intermediate research option and the
   passive ladder as a price-priority option. Show completion tails and required
   manual intervention beside any cost saving. Do not choose the setting on the
   user's behalf from these generated paths.
4. Keep the legacy quotation adapter as a continuity comparator. Its target-unit
   cap changes the old BUY cash-budget task, so it does not establish a like-for-
   like verdict on the full existing selector or policy.

## Partial fills: the apparent cost advantage has a completion price

Illustrative BUY, five-session deadline, 100-unit target, zero-drift noisy paths,
120 seeds. Passive fills use a hypothetical 50% fill probability conditional on price-crossing eligibility, 50%
fill fraction and 10-unit capacity per interval; aggressive capacity is assumed
100 units. These are scenario choices, not empirical market probabilities.

| Policy | Ordinary completion | Ordinary cost (bp) | With manual closeout completion | With closeout cost (bp) | P95 with-closeout cost (bp) | Manual closeout quantity |
|---|---:|---:|---:|---:|---:|---:|
| Earliest feasible | 100.0% | 11.00 | 100.0% | 11.00 | 11.00 | 0.0% |
| Same-horizon TWAP | 100.0% | 11.90 | 100.0% | 11.90 | 95.78 | 1.0% |
| Legacy quotation adapter | 21.3% | 2.71 | 100.0% | 11.40 | 138.00 | 78.7% |
| Paced passive | 46.6% | 2.13 | 100.0% | 8.03 | 129.30 | 53.4% |
| Paced hybrid 50% | 97.1% | 10.97 | 100.0% | 11.29 | 99.86 | 5.3% |

In this scenario, the passive candidate ordinarily completes only about 47%.
Its 100% result requires roughly 53% of the target to be bought in the explicitly
assumed manual closeout. The hybrid ordinarily completes about 97%. Even where
mean cost is lower, the passive candidate's P95 cost is much worse than the
immediate benchmark in this constructed zero-drift setting. A mean-only
nondominance flag must not be read as tail-risk dominance.

TWAP's 1% final tranche is part of its normal schedule in the ordinary branch;
it does not require manual rescue to reach its ordinary 100% in this scenario.
The manual branch labels whatever quantity is executed by that alternate
closeout process, including this otherwise-scheduled final tranche.

## Conservative bound: a deadline cannot manufacture liquidity

Same BUY and path family, but passive fills are zero and aggressive capacity is
only 10 units per interval.

| Policy | Ordinary completion | Ordinary cost (bp) | With manual closeout completion | With closeout cost (bp) | P95 with-closeout cost (bp) | Manual closeout quantity |
|---|---:|---:|---:|---:|---:|---:|
| Earliest feasible | 100.0% | 30.84 | 100.0% | 30.84 | 95.00 | 0.0% |
| Same-horizon TWAP | 100.0% | 31.91 | 100.0% | 31.91 | 115.98 | 1.0% |
| Legacy quotation adapter | 0.0% | 2.46 | 10.0% | 5.56 | 149.51 | 10.0% |
| Paced passive | 0.0% | 2.46 | 10.0% | 5.56 | 149.51 | 10.0% |
| Paced hybrid 50% | 97.0% | 31.08 | 100.0% | 32.02 | 120.68 | 6.0% |

The pure passive candidate finishes only 10% even with the modeled last-minute
closeout. Earlier paced aggressive execution completes in this particular
capacity scenario because its slices fit the assumed capacity. It still does
not establish a real-world guarantee. The low cost of doing almost nothing is
not an acceptable substitute for completion when completion is required.

## Waiting gains and losses are path-dependent

In the partial-fill BUY scenario, with manual closeout:

| Synthetic path family | Earliest feasible cost (bp) | TWAP cost (bp) | Paced passive cost (bp) | Hybrid cost (bp) |
|---|---:|---:|---:|---:|
| rising | 11.00 | 127.40 | 225.52 | 138.14 |
| falling | 11.00 | -101.82 | -184.63 | -113.17 |

A ladder benefits from a favorable path and is penalized by an unfavorable one.
Nothing in the controller predicts which path will occur. This separates
execution arithmetic and completion control from claimed market edge.

## No deadline means no forced completion

For the no-deadline scenario the common weekly allowance is 60 units of the
100-unit task. Under partial fills, ordinary completion is:

- Earliest feasible: 60.0% of the whole task; mean all-target cost 7.58 bp
- Same-horizon TWAP: 60.0% of the whole task; mean all-target cost 8.12 bp
- Legacy quotation adapter: 17.5% of the whole task; mean all-target cost 2.61 bp
- Paced passive: 19.7% of the whole task; mean all-target cost 2.82 bp
- Paced hybrid 50%: 59.0% of the whole task; mean all-target cost 7.81 bp

No policy receives an end-of-week manual closeout. The remaining quantity stays
visible; the comparison does not imply it must be completed within this week.

## Validation

- Frozen specification SHA-256: 8c21bf25421f3fc8a77cb395bc700e7c2dd8d5ac0f0fdefd2acbc007b995814d
- Full run: 28,800 generated episodes, 240 policy/scenario cells, 120 seeds per cell
- 64 prototype tests pass, including independent adversarial/property tests
- Phase-1 regression: 73 Python tests pass; 73 Node tests pass, one browser suite
  explicitly skipped because this task changes no live UI
- Existing phase-1 code and old prospective trial files remain unchanged
- Two public phase-1 code dependencies are copied byte-for-byte into this new
  research folder; their source commit and content hashes are recorded
- No archived trial dataset, real account data, credentials or new scheduled
  workflow is included

The independent review found and the implementation fixed: close-boundary
status ordering; calendar coverage and missing-session validation; target-change
same-timestamp fill accounting; minimum-order coalescing; cash overflow checks;
global event-time monotonicity; cancel-acknowledgment sequencing; and the final
TWAP interval. A future-suffix perturbation test verifies prior plans do not
change when later bars are altered.

The unchanged economic spec was fixed before scenario results. Implementation
corrections above enforce that contract. No constants or strategy choice were
retuned after reading the output. The complete machine-readable results are in
[synthetic-comparison.json](results/synthetic-comparison.json), with ordinary and
manual-closeout metrics and separate descriptive frontier flags.

## Boundaries and rollout decision

This phase is ready for research/code review only. It is not ready for production
activation. There is no new live UI and no new shadow collection enabled.

Existing public parameter data is session-summary price information. Historical
listed prices are spot-indexed proxies; the old archive parser/replay does not
supply actual order-book queues, broker executions, spreads or capacity. The
available inputs cannot empirically distinguish a large-account impact curve
or certify this intraday controller's real fills.

Before live adoption: finish reconciled account/external-order integration,
actual-instrument timestamped price/quote and venue-rule adapters, a clear UI
for cost-versus-completion choice and infeasible targets, exact browser/kernel
parity, operational cancellation/late-report handling, and an independently
reviewed new prospective protocol. The old frozen trial cannot validate this
new policy. Previously inspected history must remain labeled development data.

The synthetic experiment assumes instantaneous successful cancellations,
constant midprice during its final 15-minute bar, fixed fees/price frictions,
no impact, quote-currency fees, no halts, and chosen passive/aggressive capacity.
Random fills are rank-keyed sensitivity draws, not calibrated common queue
shocks. Its P95/P10 values and frontier flags describe these generated cases;
there is no inferential confidence or performance claim.

Operational references and full interface details are in [README.md](README.md).
