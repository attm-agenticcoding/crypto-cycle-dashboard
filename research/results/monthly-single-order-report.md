# Monthly single-order BUY optimization

Generated 2026-10-28T11:01:37.985580+00:00. Protocol `monthly-single-order-v1`. Research only; no automatic promotion.

Cash sizing uses the full outstanding amount. Monthly limits do not divide capital. The two standardized cash-arrival paths are assumptions, not reconstructed personal/CCD deployment history.

Default monthly cap: 5. Cost differences below are selected walk-forward policy minus same-cap immediate execution; negative is better. Intervals use paired 3-month blocks and are exploratory.

| Instrument | Latest candidate | Next offset | OOS months | Nominal excess bp (95% interval) | Completion | Gate |
|---|---|---:|---:|---|---:|---|
| ARCX:BTC | fixed-5 | 0.050% | 12 | 131.19 [50.99, 232.53] | 91.3% | not passed |
| BINANCE:SPOT:BTCUSDT | fixed-25 | 0.250% | 13 | 55.42 [14.12, 98.95] | 92.3% | not passed |
| ARCX:ETH | fixed-25 | 0.250% | 12 | 93.68 [-54.43, 283.06] | 89.0% | not passed |
| BINANCE:SPOT:ETHUSDT | fixed-5 | 0.050% | 13 | 0.30 [-17.16, 27.11] | 95.4% | not passed |

The gate requires at least eight test months, >5 bp improvement with the upper paired interval below -5 bp against both immediate and fixed 25 bp benchmarks under both nominal and adverse assumptions, and no >1 percentage-point completion deterioration. These are retrospective checks, not proof of future advantage.

ETF runs use indexed Binance spot proxies, not ETF quotes. Fees, touch penetration and partial fills are hypothetical sensitivities. Current order increments/filters are held constant. Daily cancellation/review and a single instrument consuming the available allowance are replay assumptions. Other accounts, sells and carried working orders still need the user-entered shared slot reservations.

Input SHA-256: `630449ddcec8017fad9f6add0af7bf7d421a4b76f6be90f2617433a5f0597186`. Protocol SHA-256: `67f33c8a52cf569c8537b66b4d2fcd38da19806e426c252217cba3a703d8f851`.

Reproduce: `python3 scripts/prepare_monthly_execution.py` then `python3 scripts/optimize_monthly_execution.py`. Archives are cached with SHA-256 provenance under ignored `.research/`; the complete compact report is in `data/execution_monthly_params.json`.
