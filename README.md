# Crypto Cycle Dashboard

A public, auto-updating dashboard tracking BTC / ETH cycle position, downside
distribution, deployment policy targets, historical replays, and policy audit
state.

**Live:** https://attm-agenticcoding.github.io/crypto-cycle-dashboard/

Current display contract:

- first viewport shows external cross-audit status when the stricter common exam
  is not passed;
- first section shows calibrated future-low price distribution and downside
  odds, labeled as dashboard-model outputs until held-out LOCO log-loss and
  coverage checks are added;
- action sizing uses the raw structural posterior, with deployment policy
  layers for reserve, catch-up, redeployment, and fast-crash overlay;
- accumulation regimes show historic accumulation deployment charts;
- distribution-side regimes show top/distribution history charts;
- policy audit section shows the fixed utility objective, live signal ledger
  summary, BTC/ETH utility gates, external common-exam status, distribution
  weak spots, and refresh watchdog;
- prediction history is published as `history.json`;
- machine-readable governance artifacts are published under `reports/` as
  `policy_audit.json` and `robust_evaluation.json`;
- no user dollar amounts are published.

Execution calculator:

- `execution/` is a multi-instrument daily limit-ladder calculator;
- **Buy / Sell** selects separately fitted market parameters. Buy keeps the
  existing currency-target calculation. Sell uses remaining asset quantity, current
  holdings and quantity committed to existing sell orders; new orders cannot
  exceed either the remaining target or uncommitted inventory. Orders use
  whole shares and cent prices for listed securities; crypto spot uses the
  exchange's price tick, fractional quantity step and static quantity/notional
  limits. Passive sell prices round upward; buy prices round downward;
- sale priority defaults to **Price seeking**. **Finish by deadline** requires
  total remaining asset quantity for each active account and prepares a manual closeout
  in the last 15 minutes of the final eligible session (15:45 ET normally,
  12:45 ET on a 13:00 close; 23:45 UTC for crypto). The closeout requires a newly
  entered best bid, valid for 60 seconds, and rounds down to the applicable tick.
  It cannot guarantee a fill or submit/cancel broker orders;
- decrement both remaining share targets and current holdings by actual fills.
  Unfilled existing sell orders remain in the targets and must also be entered
  in the reserved-order field. Sale inputs reset when changing ticker;
- `data/execution_instruments.json` is the source-of-truth registry. Each entry
  separates the listed identity (ticker + exchange MIC + official name) from
  the one-minute scaling proxy. Crypto identity includes venue and product:
  `BINANCE:SPOT:BTCUSDT`, not the ETF ticker `ARCX:BTC`;
- the **Add ticker** button offers separate stock/ETF and Binance Spot forms.
  The spot form takes an exact pair (for example `BTCUSDT`) and a convenience
  default reference price. Public exchange metadata verifies the base/quote
  assets, active spot LIMIT support, tick and quantity/notional filters. Futures,
  perpetuals, other venues and guessed proxy mappings are not accepted.
  Only a request
  submitted by the repository owner can update the registry, and the proxy is
  checked against the supported archive before it is accepted;
- **Remove selected** targets the complete listed or spot instrument identity and
  uses the same owner-only, auditable issue workflow. The final enabled
  instrument cannot be removed; removing the default selects another enabled
  instrument as the new default;
- the calculator reads the registry and fitted parameter bundle together, so a
  removed instrument disappears after the registry deploy while a newly added
  instrument is shown as pending until its first scaling run completes;
- every scheduled scaling refresh fits **both directions** for the enabled
  instruments on its calendar; manual dispatch fits the complete registry. Listed
  instruments that share the same proxy deliberately share one base market
  scaling, while account-specific deadline pressure is still calculated in the
  browser;
- parameter schema v3 stores `instruments[ID].sides.buy` and `.sides.sell`;
  root instrument fields retain the buy payload for older readers. A missing
  sell fit forces a refresh even if buy data is current. The page never fills
  missing sell scaling with buy parameters;
- sell fitting uses eligible minute highs and minimizes weekly implementation
  shortfall, `(reference value - proceeds) / reference value`. Unfilled shares
  are valued at the next observed reference, so falling prices penalize waiting.
  A week without a later reference is excluded from sell scoring. Sell highs
  stop at the core close on half days; the existing buy calibration is retained.
  Deadline tightening and closeout are transparent overlays, not independently
  optimized policies. Proxy touches do not simulate spreads, queue position,
  partial fills, fees or impact on the actual listed instrument;
- each changed parameter bundle is committed to `main`, where the repository's
  active branch-based Pages deployment publishes it;
- the current long-history adapter is Binance Vision spot one-minute archives.
  Listed instruments retain the 09:35 ET reference-minute close, with eligible
  fills beginning at 09:36 ET. The starting time is a modeling convention, not
  a backtested optimum. Crypto spot uses the same pair's direct data, the
  00:00 UTC reference-minute close and fills from 00:01 through 23:59 UTC;
- crypto's daily cycle includes weekends/holidays; weeks end Sunday UTC and
  deadlines use UTC dates. Buy/sell independently search 10, 15, 20, 30, 45 and
  60 calendar-day lookbacks. Incomplete terminal weeks are excluded from both
  scoring directions. Listed lookbacks remain trading-session counts;
- crypto output is **GTC**, not a stock DAY order. The page clears its reference,
  bid and results at the next UTC day, but exchange orders do not expire then.
  Cancel or reconcile old orders before placing a replacement ladder. Sell
  reservations prevent duplicate inventory allocation; buy assumes old orders
  have been cancelled. Minimum-order dust is reported, not rounded up beyond
  the target. Check live dynamic price bands, fees and the exchange preview;
- additional venues/providers require an explicit identity and data adapter
  rather than guessing from a ticker. No new production ticker is added merely
  by enabling this capability.

Listed scaling runs in GitHub Actions at **20:30 and 22:30 America/New_York** on
weekdays. Crypto scaling runs **every day at 04:30 and 08:30 UTC**, including
weekends. Each calendar's backup skips when all of its instruments already have
current buy and sell parameters. Calendar-scoped runs preserve the other
calendar's fitted payloads. Public data archives may be published later than a scheduled attempt;
a failed attempt keeps the last valid complete bundle. Manual dispatch refits all
instruments. No holdings or account inputs are sent to GitHub.

Validation: `python3 -m unittest discover -s tests -v` and
`node --test tests/test_execution_core.cjs`. Registration/removal fixtures are
independent of the production list, including after removing the original BTC.
`Validate 24/7 crypto execution` is a manual, read-only GitHub Actions workflow:
it fits real BTCUSDT archives in a temporary registry and uploads a seven-day
`crypto-execution-validation` comparison artifact without publishing parameters
or adding a production ticker. Run the same validation locally with
`python3 scripts/validate_crypto_execution.py --report /tmp/crypto-validation.json`.

Refresh cadence:

- 06:30 ET live intraday snapshot;
- 09:30-16:00 ET live intraday snapshots every 30 minutes;
- 20:30 ET close snapshot, which writes the historical close record.

Research / educational only. Not investment advice.
