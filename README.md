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

Phase-one calculator consistency:

- BUY touch sizing uses every completed excursion; it does not wait for the next
  reference-return label used in weekly scoring.
- Blank totals are optional; an explicit zero total produces no new orders.
  A zero weekly pace can catch up only when both total and deadline are supplied.
- Deadline defaults to blank. Without it, the entered weekly pace is used and an
  optional total remains a cap, with no hidden completion horizon or tightening.
  Finish-by-deadline sells still require an explicit date and total.
- Both listed sides use the published 2025–2028 NYSE calendar, start at 09:36 ET
  after the reference minute completes, and stop at the actual 13:00/16:00 close.
  Unsupported calendar years fail closed until the calendar is updated; later
  emergency exchange closures also require a calendar-table update.
- Listed BUY retains its 30-rung limit and reports both allocated shares and any
  unallocated remainder. Touch-based sizing does not guarantee fills/completion.
- The calculator shows adopted versus raw-minimum diagnostics, retention reason,
  paired uncertainty and scoring-week dates separately from latest market data.
  Eligible candidates are a heuristic selection band, not a confidence interval.
- The existing prospective and retrospective experiment execute their frozen
  kernel under `research/frozen/execution-prospective-2026-09-v1/`; they do not
  evaluate this new calculator. Existing receipts and settled outcomes remain
  unchanged. No new economic model or experiment is introduced in this phase.
  Inputs remain remaining BUY budget or SELL quantity, not an automatic
  current-position-to-target-position optimizer.

Validation: `python3 -m unittest discover -s tests -v` and
`node --test tests/test_execution_*.cjs`. The browser suite requires Playwright
1.62.1 and Chromium; run
`RUN_EXECUTION_BROWSER_TESTS=1 node --test tests/test_execution_browser.cjs`,
optionally setting
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`. CI performs real browser parity/form tests;
the default dependency-free test run explicitly skips only that browser suite.

- Since September 28, 2026, production uses `scripts/update_execution_params_live.py`.
  Every candidate is scored on the same 26 complete weeks after a common
  60-session warm-up, with a later terminal reference for both directions.
  The stability band uses the standard error of **paired weekly excess costs**,
  with the existing 0.25 bp floor. It no longer uses one candidate's total
  market-cost volatility. Zero-hit weeks remain scored. New instruments use the
  raw minimum when there is no prior grid candidate; they do not inherit a BTC seed.
  This is a selection heuristic, not a significance or equivalence test.
- [Selection diagnostics](execution/selector.html) show raw/adopted/prior
  parameters, eligible candidate counts, matched scoring weeks, cost gaps,
  paired uncertainty and retention/replacement reasons. The ordinary calculator
  consumes the repaired published parameters with its existing order guards.
- The production repair requests 365 calendar days of input to support the
  common 26-week scoring window. Both sides respect listed half-day closes.
  Incomplete sessions or insufficient common history preserve the last complete
  bundle. The original updater and the frozen copies of every file hashed by
  the prospective shadow contract remain byte-for-byte unchanged; that experiment
  continues to measure its original methods and is not evidence for the new
  production selector or calculator.
- An isolated [execution v2 validation experiment](research/README.md) compares
  selection rules with common-week, causal daily replay. It does not replace
  the live parameters or change the production schedules;
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
  A week without a later reference is excluded from both directions. Buy lows
  and sell highs stop at the actual core close on half days.
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


## Optional device-local execution progress

The calculator still works with manual remaining amounts; no record setup or trade entry is required. The default budget fields are empty, and Account 2 is optional. The existing 720-candidate / 26-complete-week selector and its production update schedules are unchanged.

The collapsed **Optional: remember progress on this device** section can retain a separate task for each instrument, direction and account. Records are created only after you explicitly confirm the entered starting amounts. Buy progress is recorded cash spent; sell progress is recorded units sold. Average fill price covers only the fills recorded since tracking began, not unknown earlier trades or the cost basis of the whole position. Fees are treated as zero. Nothing connects to a broker or places, amends or cancels an order.

- Record only actual fills and already-working orders verified at the broker. Working and cancellation-pending orders reserve capacity. A requested cancellation does not release it; confirmed cancellation releases only the unfilled remainder. Late reports can record their actual UTC execution time. Use broker order/trade references where available to identify duplicate records.
- Total remaining carries across weeks. A new week requires an explicitly confirmed cap; the previous week's remaining amount is not assumed to be the next week's full quota. Outstanding reservations still count. Actual fills above a planned limit remain recorded and visibly block further ledger planning pending review.
- **Use available remaining in calculator** is explicit. With local progress bound, confirmed weekly and total availability are hard caps on new orders even if deadline pacing asks for more. Without a local record, the existing manual weekly input is a pace target: a supplied total and deadline can raise it. Total remaining still caps the plan. A deadline cannot guarantee a limit-order fill.
- Sell holdings and the total quantity in existing sell orders remain user-entered current state. Include all working orders, including those in the local record; reservations are not subtracted twice. Editing target/holdings/reservation inputs returns that account to manual mode.
- Records stay in this browser profile on this device. There is no cross-device sync. Shared-profile users may see them, and clearing site data can erase them. Optional JSON export is a local download containing financial records; keep it private. No import or server backup is provided. Deletion requires an explicit on-page confirmation.
- Browser storage failures, corrupt state and concurrent-tab changes must be visible. Web Locks are required to coordinate writes; unsupported browsers can keep using the manual calculator. No financial/task data is written while the optional feature is off; the existing nonfinancial ticker preference is unchanged.

New logic is in `execution/task-ledger.js` and `execution/task-ledger-ui.js`. Deterministic synthetic coverage is in `tests/test_execution_task_ledger.cjs`; browser/privacy/interaction coverage is in `tests/test_execution_progress_browser.cjs`. The existing calculator workflow runs both old and new browser suites and uploads synthetic screenshots. Do not commit real local progress JSON or real holdings/fill fixtures to this public repository.
