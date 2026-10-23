# Market price defaults and 09:35 ET reference

Implementation prepared 2026-10-23 on `codex/reference-market-quotes`.
The public calculator has NOT been updated yet: the quote service is deployed
owner-private pending the user's explicit authorization to make the read-only
public-data endpoint public. Then verify the deployed endpoint/CORS for all four
instruments, merge the branch into current main, push, and verify the normal
Pages deployment and served source. Do not expose a Sites bypass token to clients.

Service: https://execution-market-quotes.attmgromov.chatgpt.site
Sites project: appgprj_6adb4a5dc728819180965e554c09151b
Initial private deployed version: appgprj_6adb4a5dc728819180965e554c09151b~appgver_de832efe4b6c8191ac80f9a0738973e9
Maintainable backend source: services/execution-quotes/

Opening or changing ticker starts with a blank input and requests the latest
trade. A source trade no older than five minutes fills it once. Manual typing
(including while the request is in flight), switching ticker, and background
refreshes cannot overwrite a plan. Both explicit price buttons invalidate old
results and recalculate an existing plan. Requests carry only a whitelisted
instrument identifier, never account inputs or holdings. Failed or stale quotes
do not fall back to fixed seed prices. The source event time is shown in ET.

09:35 means the exact 09:35:00–09:35:59 ET candle close. Before 09:36 it is pending;
missing bars stay unavailable. NYSE holidays have no ETF reference. Crypto uses
this as an additional daily comparison; its model anchor remains 00:00 UTC.
The backend caches the first ready daily close, and the frontend holds its
first ready daily value during quote refreshes. No automatic trades are placed.

Validation completed locally because this task has no cloud execution tool:
- 40 calculation/calendar/quote-controller Node tests passed.
- 4 backend tests passed (DST, NYSE holidays, exact current-day minute, event time,
  missing prices, independent source failures).
- 55 existing Chromium desktop/mobile and progress-ledger regressions passed.
- Additional quote/time/default/manual-edit/reference-button Chromium test passed.
- Sites production build passed and private deployment succeeded.
- Local backend successfully read real latest trades for both ETFs and both pairs.
- Today's 09:35 bar is not yet formed at test time; readiness and exact-bar
  selection were tested with fixtures. Deployed provider access remains to verify
  after public authorization, since private browser sign-in was unavailable.
