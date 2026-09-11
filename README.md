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
  existing dollar-target calculation. Sell uses remaining shares, current
  holdings and shares committed to existing sell orders; new orders cannot
  exceed either the remaining target or uncommitted inventory. Orders use
  whole shares and cent prices (passive sell prices round upward);
- sale priority defaults to **Price seeking**. **Finish by deadline** requires
  total remaining shares for each active account and prepares a manual closeout
  in the last 15 minutes of the final eligible session (15:45 ET normally,
  12:45 ET on a 13:00 close). The closeout requires a newly entered best bid,
  valid for 60 seconds, and prices a limit at that bid rounded down to cents.
  It cannot guarantee a fill or submit/cancel broker orders;
- decrement both remaining share targets and current holdings by actual fills.
  Unfilled existing sell orders remain in the targets and must also be entered
  in the reserved-order field. Sale inputs reset when changing ticker;
- `data/execution_instruments.json` is the source-of-truth registry. Each entry
  separates the listed identity (ticker + exchange MIC + official name) from
  the one-minute scaling proxy;
- the **Add ticker** button opens a structured GitHub issue form. Only a request
  submitted by the repository owner can update the registry, and the proxy is
  checked against the supported archive before it is accepted;
- **Remove selected** targets the complete exchange-MIC-and-ticker identity and
  uses the same owner-only, auditable issue workflow. The final enabled
  instrument cannot be removed; removing the default selects another enabled
  instrument as the new default;
- the calculator reads the registry and fitted parameter bundle together, so a
  removed instrument disappears after the registry deploy while a newly added
  instrument is shown as pending until its first scaling run completes;
- every scheduled scaling refresh fits **both directions** for the complete enabled registry. Listed
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
- the current long-history adapter is Binance Vision spot one-minute archives,
  sliced to the registered US-equity session. Additional providers require an
  explicit data adapter rather than guessing from a ticker.

Scaling runs in GitHub Actions at **20:30 and 22:30 America/New_York**.
The backup skips only when every enabled instrument has current buy and sell
parameters. Public data archives may be published later than a scheduled attempt;
a failed attempt keeps the last valid complete bundle. Manual dispatch refits all
instruments. No holdings or account inputs are sent to GitHub.

Validation: `python3 -m unittest discover -s tests -v` and
`node --test tests/test_execution_core.cjs`. Registration/removal fixtures are
independent of the production list, including after removing the original BTC.

Refresh cadence:

- 06:30 ET live intraday snapshot;
- 09:30-16:00 ET live intraday snapshots every 30 minutes;
- 20:30 ET close snapshot, which writes the historical close record.

Research / educational only. Not investment advice.
