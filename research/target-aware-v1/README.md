# Target-aware execution, phase 2 research prototype

Status: isolated, reviewable prototype. It is not connected to the live calculator,
any broker, or a new scheduled workflow. It does not choose portfolio targets.

## Decision and candidate policy

The objective is to move from an explicitly supplied current position to an
explicitly supplied target position. Both BUY and SELL now use asset units.
Cash is a feasibility constraint, rather than a different economic objective
for BUY. Long-only holdings, quote-currency fees, and explicit venue increments
are the prototype's supported contract.

The prototype accepts holdings in asset units. If a later UI accepts a target
allocation percentage or market value, it must request an explicit portfolio
valuation and conversion-price snapshot, convert once to a reviewed unit target,
and show rounding/cash feasibility. Market-price changes must not silently move
the target. No NAV, holdings or target percentage is inferred here.

Two controls are deliberately separate:

1. With a deadline, a fixed-origin cumulative schedule allocates the original
   target change over eligible trading minutes. Actual fills reduce the target;
   open and pending-cancel orders reserve it. Missed progress is carried forward.
2. Without a deadline, an explicit weekly asset-unit allowance caps filled plus
   still-working quantity. It never invents an end date, tightens prices because
   time passed, or invokes a final closeout. Unfinished quantity may persist.

The candidate ladder uses three transparent distances: 0.25, 0.75 and 1.25 times
past-only session volatility. Equal lots are coalesced when venue minima require
it. With a deadline, distance scales by max(0.25, 1 minus elapsed trading-time
fraction). These constants were fixed before scenario results, not selected by
an optimization grid. Volatility is the RMS of the last 20 completed-reference
log returns with a one-tick floor. It estimates price scale, not fill probability.

The controller's cumulative due quantity is:

    floor(original task lots × eligible time through next review / total eligible time)
    − actual filled lots − still-reserved lots

It never recomputes an entire horizon from the remaining target on every call.
Quantity cannot exceed remaining target, cash after fees, or unreserved inventory.

The research choices are paced passive, paced 50% aggressive / 50% passive,
same-horizon TWAP, earliest-feasible immediate execution, and a target-capped
phase-1 ladder quotation adapter. The cost/completion frontier is shown within
each scenario. No option is declared a universally optimal policy or promoted.

## What is implemented

- `kernel.cjs`: one pure ledger/planning/accounting kernel shared by the proposal
  interface and synthetic replay. There is no network or broker capability.
- `replay.cjs`: paired generated price paths, explicit fill/capacity scenarios,
  ordinary final tranche versus separate manual-closeout branch, all-target
  implementation shortfall, completion, passive/aggressive split and tail metrics.
- `plan-example.cjs`: normalized 100-unit planning example with an existing order
  and a prior partial fill. No account amount is inferred.
- `spec.json`: pre-result economic specification and scenario constants.
- `frozen/`: two byte-identical phase-1 dependencies, pinned in `manifest.json`.
  No imports point into the older prospective trial or evolving live calculator.
- `tests/`: ordinary, property, causal and independent adversarial tests.
- `results/synthetic-comparison.json`: all scenario cells; no market archive.
- `REPORT.md`: findings, trade-offs, validation and deployment gates.

Run from this directory with Node 22 or later:

    node --test tests/*.cjs
    node plan-example.cjs
    node replay.cjs --smoke
    node replay.cjs

The full replay has 120 seeds × 4 path families × 2 sides × 2 deadline modes ×
3 liquidity scenarios × 5 policies = 28,800 synthetic task episodes, each with
both ordinary/no-manual and explicit-manual terminal metrics when applicable.
The `flat` family means zero expected drift with noise; a deterministic flat-price
case is separately tested. These counts describe engineering coverage, not
independent real-market evidence or statistical power.

## State, lifecycle and causality contract

Initialize from one reconciled position/cash snapshot at the task origin. Import
existing unfilled orders at that snapshot with their remaining quantity and fee
cap. Earlier historical fills are already in the snapshot and must not be applied
again. Later fills are applied once by execution ID. A different payload under
the same execution ID fails closed.

- Fills alone change inventory/cash and completed quantity; cancellation releases
  reservations only after acknowledgment.
- A pending-cancel order can still fill. No replacement can reuse its reserved
  resources. Manual closeout waits for every active order to become terminal.
- The event stream is globally nondecreasing in time. Late/out-of-order reports,
  a fill exceeding the reserved fee/price/quantity, or conflicting snapshots stop
  the prototype for reconciliation. They are never silently dropped.
- A target change requires all prior orders terminal, records an explicit new
  task segment, and preserves the old fill history. Accounting uses a fill-index
  boundary, so a same-timestamp revision cannot double-count older fills.
- Both directions reserve worst-case resources. Opposing outstanding orders or
  orders larger than the new target require reconciliation rather than netting.
- Quantities are integer venue lots; prices round outward for passive orders.
  Cash arithmetic is finite IEEE-754 with explicit guards and tested tolerances.
  Negative rounding residues no greater than 1e-7 quote units are clamped to
  zero and recorded separately as cashRoundingAdjustment.
  Production financial accounting would need venue settlement rounding rules.
- Quotes carry observed and available timestamps and have a 60-second freshness
  limit. Reference history is available only after both timestamps pass.
- Calendar windows are regenerated and checked for complete session membership,
  not trusted merely because their first/last dates match. NYSE 2025–2028
  holidays, DST and half days come from the phase-1 verified calendar. Listed
  planning starts at 09:36 ET; crypto is 00:01–24:00 UTC, every day.
- A deadline on a nontrading date resolves to the last eligible trading instant;
  both requested and effective timestamps are exposed. An expired effective
  deadline is explicit even if the market is closed. Unsupported
  dates fail closed. Emergency closures/halts still require a new verified
  calendar/data adapter; this prototype does not discover them.

## Shared execution assumptions and comparison scope

All policies see the same generated path, starting position, target, cash,
quote/spread, fee schedule, price/quantity increments and capacity assumptions.
Price histories are paired by seed. Fill variates are deterministic by seed,
interval and order rank; different order structures do not share a physically
calibrated queue shock. There is no real queue model.

A bar crossing a passive price makes an order eligible only. A separate declared
probability, fraction and capacity determine its simulated fill. The scenario
set includes a zero-passive-fill lower bound and thin aggressive capacity.
These are sensitivity parameters, not estimates of market fill probabilities.
There is no market-impact model; multiplying an account size cannot preserve
assumed execution quality. Scaling tests check arithmetic units only.

The phase-1 quote generator is reused exactly with synthetic fixed values
(20 references, first distance 0.25%, spacing 0.80%, symmetric synthetic
excursions). A common target-unit/cash-feasibility adapter then caps its orders.
It is explicitly a legacy-shaped quotation comparator, not a reconstruction of
the old cash-budget objective, historical selected parameters or complete policy.
No production parameters were fitted to these scenarios.

The deadline terminal interval is a separate final 15-minute bar. One branch
continues each policy's normal final tranche. The other requests cancellations,
assumes acknowledgments, and models a manual aggressive closeout using that
interval's opening price and declared capacity. This synthetic final interval
holds the midprice constant; gap and late-liquidity behavior are separate future
stress requirements. Completion remains bounded by resources and assumed
capacity. Passive completion is always separately reported.

All comparisons cancel/replace at review points with instantaneous successful
acknowledgments in the scenario. Actual delay, queue loss, outages and unknown
order states are not estimated. Ledger tests separately exercise pending-cancel
races. Crypto GTC orders do not expire at UTC midnight merely because the
calculator's view changes.

Without a deadline, the weekly cap is 60 units of a 100-unit task for every policy.
TWAP gets an explicit five-session *comparison horizon*, never a user deadline
or forced closeout. Its 60-unit weekly tranche is paced within that horizon.
The residual 40 units remains part of the task's accounting denominator.

## Cost and completion are different outputs

For original task quantity Q, arrival reference P0, direction s=+1 for BUY and
−1 for SELL, actual fill quantities q and prices P, residual R, and common
terminal mid M:

    cost bp = 10,000 × [s × (sum(q×P) + R×M − Q×P0) + actual fees] / (Q×P0)

This is a task-quantity implementation-shortfall estimand for either side.
Residual marking is opportunity-cost accounting, never a fill or guaranteed
cost-to-complete. Fill-only cost is separate and cannot select a winner by
ignoring hard-to-fill residuals. P95 cost and P10 completion refer only to the
finite synthetic sample. Mean cost/completion nondominance is descriptive,
not a statistically established market frontier. Tail metrics must be reviewed
alongside it.

## Data availability and next gates

The current public parameter payload contains 90 per-side daily excursion and
next-reference summaries. Existing long-history adapters read Binance Spot
one-minute price archives; `MinuteBar` keeps low/high/close/timestamp and does
not retain volume/open. The old replay further aggregates to session extrema.
Listed BTC/ETH inputs are indexed spot proxies, not historical ETF quotes.
These summaries cannot reconstruct intraday schedule decisions, order-book
queues, executable spreads, partial-fill capacity or market impact.

A production-ready next stage requires:

1. A reconciled account adapter or explicit manual snapshot workflow, including
   external orders, executions, acknowledgments, fee currencies and dust.
2. Timestamped actual-instrument bars/quotes with availability metadata; minute
   sequence and missing-data rules; current static and dynamic venue constraints.
3. Capacity/latency/queue sensitivity calibrated where possible from observed
   orders; no claim that price-only data identifies an impact function.
4. A frozen prospective receipt protocol for this new kernel after independent
   readiness review. Old trial receipts remain evidence only for their own
   frozen policy. Previously inspected history is development data, not unseen.
5. UI/browser parity on this exact new kernel, clear infeasibility and residual
   presentation, explicit user choice of completion versus cost tolerance and
   manual intervention assumptions, plus fresh approval before any activation.

The kernel is a reviewable research implementation. It is not yet a live order
management system, a portfolio recommendation, or validated evidence of alpha.

## Primary references

- [SEC: limit orders are not guaranteed to execute](https://www.sec.gov/answers/limit.htm)
- [Investor.gov: market and limit order mechanics](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-14)
- [NYSE: official holidays and trading hours](https://www.nyse.com/markets/hours-calendars)
- [Binance: official spot filter definitions](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md)

These references support the operational constraints. They do not validate the
synthetic policy's economic performance.
