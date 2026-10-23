# Market price defaults and 09:35 ET reference

The user authorized public read-only access on 2026-10-23. The quote service
is public, and this change is ready for the normal main-branch Pages deployment.
ETF latest trades were verified through the deployed endpoint with correct CORS.
Crypto trades are read directly from Binance in the browser (verified), because
that upstream is unavailable from the hosting environment. No bypass credentials
are exposed. Only public instrument identifiers are sent to the service.

Service: https://execution-market-quotes.attmgromov.chatgpt.site
Sites project: appgprj_6adb4a5dc728819180965e554c09151b
Public backend version: appgprj_6adb4a5dc728819180965e554c09151b~appgver_d1795ec8a95c819184dba15721eb0fac
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
- 5 backend tests passed (DST, NYSE holidays, exact current-day minute, event time,
  missing prices, independent source failures).
- 56 Chromium desktop/mobile, ledger, and quote-interaction regressions passed.
- 4 quote-controller/direct-crypto tests passed, including ET/DST candle selection.
- Sites production build passed and private deployment succeeded.
- Local backend successfully read real latest trades for both ETFs and both pairs.
- Today's 09:35 bar is not yet formed at test time; readiness and exact-bar
  selection were tested with fixtures. Deployed ETF latest trades and direct Binance latest trades were verified;
  actual current-day 09:35 close retrieval cannot be checked until that minute forms.
