'use strict';
const fs=require('node:fs'),path=require('node:path');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'results/synthetic-comparison.json'),'utf8'));
const names={immediate:'Earliest feasible',same_horizon_twap:'Same-horizon TWAP',existing_ladder_fixed_synthetic_parameters:'Legacy quotation adapter',paced_passive:'Paced passive',paced_hybrid_50:'Paced hybrid 50%'};
const f=x=>x.toFixed(2),pct=x=>(100*x).toFixed(1)+'%';
function cells(mode,scenario,family='flat',side='buy'){return data.results.filter(x=>x.mode===mode&&x.scenario===scenario&&x.family===family&&x.side===side);}
function table(rows){return ['| Policy | Ordinary completion | Ordinary cost (bp) | With manual closeout completion | With closeout cost (bp) | P95 with-closeout cost (bp) | Manual closeout quantity |','|---|---:|---:|---:|---:|---:|---:|',...rows.map(r=>`| ${names[r.policy]} | ${pct(r.meanWithoutCloseoutCompletion)} | ${f(r.meanWithoutCloseoutCostBps)} | ${pct(r.meanCompletion)} | ${f(r.meanCostBps)} | ${f(r.p95CostBps)} | ${pct(r.meanManualCloseoutFraction)} |`)].join('\n');}
const text=`# Phase 2 findings and review gates

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

${table(cells('deadline','partial_uncertain'))}

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

${table(cells('deadline','zero_passive_thin'))}

The pure passive candidate finishes only 10% even with the modeled last-minute
closeout. Earlier paced aggressive execution completes in this particular
capacity scenario because its slices fit the assumed capacity. It still does
not establish a real-world guarantee. The low cost of doing almost nothing is
not an acceptable substitute for completion when completion is required.

## Waiting gains and losses are path-dependent

In the partial-fill BUY scenario, with manual closeout:

| Synthetic path family | Earliest feasible cost (bp) | TWAP cost (bp) | Paced passive cost (bp) | Hybrid cost (bp) |
|---|---:|---:|---:|---:|
${['rising','falling'].map(fam=>{const rs=cells('deadline','partial_uncertain',fam);const get=p=>f(rs.find(x=>x.policy===p).meanCostBps);return `| ${fam} | ${get('immediate')} | ${get('same_horizon_twap')} | ${get('paced_passive')} | ${get('paced_hybrid_50')} |`;}).join('\n')}

A ladder benefits from a favorable path and is penalized by an unfavorable one.
Nothing in the controller predicts which path will occur. This separates
execution arithmetic and completion control from claimed market edge.

## No deadline means no forced completion

For the no-deadline scenario the common weekly allowance is 60 units of the
100-unit task. Under partial fills, ordinary completion is:

${cells('no_deadline','partial_uncertain').map(r=>`- ${names[r.policy]}: ${pct(r.meanCompletion)} of the whole task; mean all-target cost ${f(r.meanCostBps)} bp`).join('\n')}

No policy receives an end-of-week manual closeout. The remaining quantity stays
visible; the comparison does not imply it must be completed within this week.

## Validation

- Frozen specification SHA-256: ${data.specSha256}
- Full run: ${data.episodes.toLocaleString('en-US')} generated episodes, 240 policy/scenario cells, ${data.seeds} seeds per cell
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
`;
fs.writeFileSync(path.join(__dirname,'REPORT.md'),text);
