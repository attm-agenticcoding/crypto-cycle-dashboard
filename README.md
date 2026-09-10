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
- `data/execution_instruments.json` is the source-of-truth registry. Each entry
  separates the listed identity (ticker + exchange MIC + official name) from
  the one-minute scaling proxy;
- the **Add ticker** button opens a structured GitHub issue form. Only a request
  submitted by the repository owner can update the registry, and the proxy is
  checked against the supported archive before it is accepted;
- every scheduled scaling refresh fits the complete enabled registry. Listed
  instruments that share the same proxy deliberately share one base market
  scaling, while account-specific deadline pressure is still calculated in the
  browser;
- when a scaling refresh changes the parameter bundle, that same workflow
  deploys the new GitHub Pages artifact instead of relying on a bot push to
  trigger a second workflow;
- the current long-history adapter is Binance Vision spot one-minute archives,
  sliced to the registered US-equity session. Additional providers require an
  explicit data adapter rather than guessing from a ticker.

Refresh cadence:

- 06:30 ET live intraday snapshot;
- 09:30-16:00 ET live intraday snapshots every 30 minutes;
- 20:30 ET close snapshot, which writes the historical close record.

Research / educational only. Not investment advice.
