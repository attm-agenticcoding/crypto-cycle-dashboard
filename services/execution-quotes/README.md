# Execution Market Quotes

Read-only backend for https://attm-agenticcoding.github.io/crypto-cycle-dashboard/execution/.

`GET /api/quote?instrument=ARCX%3ABTC` accepts only ARCX:BTC, ARCX:ETH,
BINANCE:SPOT:BTCUSDT, and BINANCE:SPOT:ETHUSDT. It never accepts a URL, credentials,
orders, holdings, or account information. CORS permits only the dashboard origin.

Latest ETF trades use the Nasdaq website JSON endpoint; this is not a contracted
market-data API and may become unavailable. Nasdaq's last-trade timestamp is
parsed in America/New_York. Exact ETF 09:35 minute closes use Yahoo Finance chart
1-minute bars for the same ETF ticker/currency. Crypto uses Binance's documented
public market-data REST endpoints, with no key. A timestamp is an event time,
not the time the request completed. Quotes older than five minutes are flagged.

The daily reference is 09:35:00–09:35:59 America/New_York, available only from
09:36. Exact bar timestamp, currency, symbol and granularity are required; null,
neighboring-day and neighboring-minute closes never substitute. Listed holidays
use the calculator's 2025–2028 NYSE calendar (lib/market-calendar.cjs). On closed
days there is no ETF reference. Crypto has a daily comparison reference, including
weekends; its fitted model's existing 00:00 UTC anchor is unchanged. The first
available daily reference is retained in the edge cache for one day; edge eviction
may cause it to be refetched, so the browser also keeps its first ready value for
the currently displayed day. No market data is bundled into source control.

`node --test tests/quotes.test.mjs` checks DST, reference readiness, exact bar
matching, event timestamps and independent provider failures. Build using the
Sites plugin build helper. The Site is initially owner-private; it must be
explicitly authorized for public access before the public calculator can call it.
Maintainable source is archived in the calculator repository's
`services/execution-quotes/` directory; Sites holds the deployment checkout.
