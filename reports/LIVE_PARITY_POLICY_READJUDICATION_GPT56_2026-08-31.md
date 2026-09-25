# GPT-5.6 Live-Parity Policy Re-adjudication

Verdict: **DEMOTED_REVIEW**

- Integrity: **PASS**.
- Shape candidates tested: **324**; eligible: **3**.
- Shape decision: **CANDIDATE_SELECTED**.
- Catch-up divisor: **3** (incumbent 3).
- Pareto candidate robustness: **FAIL**; incumbent robustness: **FAIL**.

## Effective Parameters

- gamma `2.0`, floor weight `1.0`, deep-anchor multiplier `0.6`.
- duration horizon `52` weeks; reserve floors BTC `20%`, ETH `30%`.
- Production parameter change: **False**.

## Shape Versus Incumbent — 10 bps

- Acquisition-cost premium delta: -2.34% (lower is better).
- Deployment by low delta: -0.86%.
- Terminal deployment delta: -0.00%.
- Terminal value delta: 1.81%.
- Utility delta: 2.62%.

## Raw Gap/3 Versus Selected Full Controller — 10 bps

- Raw-minus-full acquisition-cost premium: 18.63%.
- Raw-minus-full deployment by low: -6.21%.
- Raw-minus-full terminal deployment: -36.81%.
- Raw-minus-full terminal value: -17.76%.
- Raw-minus-full utility: -19.46%.

## Catch-up Speed Grid

| Gap divisor | Eligible replacement | Cost premium delta vs /3 | Spent@low delta | Terminal deployment delta | Utility delta |
|---:|---|---:|---:|---:|---:|
| 2 | no | -0.85% | 2.45% | 0.65% | 0.70% |
| 3 | no | 0.00% | 0.00% | 0.00% | 0.00% |
| 4 | no | 1.48% | -2.08% | -0.69% | -1.31% |
| 6 | no | 2.75% | -5.26% | -2.22% | -4.07% |

## Cluster Detail — Selected Shape Minus Incumbent, 10 bps

| Cluster | Cost premium | Spent@low | Terminal deployment | Terminal value | Utility |
|---|---:|---:|---:|---:|---:|
| 2018 | -7.47% | -1.49% | -0.00% | 5.12% | 7.46% |
| 2019 | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% |
| 2020covid | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% |
| 2022 | -1.87% | -1.94% | 0.00% | 2.12% | 3.03% |

## Interpretation

- The cadence correction is independent of this retune decision and remains mandatory.
- Current 2026 values were excluded from selection.
- A cost-versus-participation trade-off is not labelled an optimum.
