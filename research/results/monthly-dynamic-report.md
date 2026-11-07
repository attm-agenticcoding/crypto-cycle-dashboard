# Monthly dynamic price and allocation model

Generated 2026-10-29T01:42:53.999145+00:00; `monthly-dynamic-v1`. Price priority with cash carry; fitted candidates are not claims of validated optimality.

Each daily plan recalculates both limit distance and investment fraction from strictly completed drawdowns, days left this month, free trade slots and the entered price/capital. Unfilled cash carries to subsequent months. There is no required month-end purchase.

Default cap 5. Costs are walk-forward portfolio implementation differences versus same-cap immediate execution per dollar contributed; negative is better. Cash and acquired units carry throughout each out-of-sample path.

| Instrument | Latest fitted policy | OOS months | Nominal excess bp (95% block interval) | Deployed | Advantage check |
|---|---|---:|---|---:|---|
| ARCX:BTC | monthly-60-0.5-1 | 12 | 139.08 [-340.38, 767.24] | 99.1% | not passed |
| BINANCE:SPOT:BTCUSDT | monthly-10-2-1.5 | 13 | 175.65 [-283.45, 689.35] | 97.7% | not passed |
| ARCX:ETH | monthly-10-1-1.5 | 12 | 260.70 [-319.82, 1115.31] | 99.1% | not passed |
| BINANCE:SPOT:ETHUSDT | monthly-10-2-1.5 | 13 | 341.23 [-325.59, 1200.05] | 99.2% | not passed |

Selection uses only six preceding complete months from continuously carried counterfactual policies. OOS candidate changes retain the selected path’s own cash and holdings. Five installments is a funding sensitivity, not automatic five-way sizing. The exact selection/completion constraint and benchmarks are pinned in the protocol.

Monthly observations include changes in the marked-to-market value of previous fills. The sum of monthly wealth-gap increments equals the final wealth gap; unspent cash is never counted as a hypothetical fill. Paired block intervals are exploratory, retrospective and uncorrected for candidate search.

The calculator uses the fitted policy requested by the user and labels its evidence. An unsuccessful advantage check does not become a success because a policy is available in the calculator. Live offsets use the existing daily completed-session feed; candidate coefficients are a dated research fit, with no new production schedule.

ETF replay uses indexed spot proxies, not ETF quotes. Fees/partial fills/touch penetration are scenarios. Each daily replacement assumes confirmed cancellation; the calculator does not submit or cancel broker orders. Arbitrary intraday repricing is not validated by the fixed daily observation times in this replay.

Input SHA-256: `ea0a87cb94bd33c70ce51c8685a059ee594f1f73f3b2fff89a5fcec9e9292634`. Protocol SHA-256: `af150e871aeddc56cd46e1fdb63fbffa217ce04bbe9d9f503065b911cde1d2d2`.

Reproduce in the cloud: `python3 scripts/prepare_monthly_execution.py --protocol research/execution-monthly-dynamic-protocol.json --output .research/monthly-dynamic-sessions.json`, then `python3 scripts/optimize_monthly_dynamic.py`.
