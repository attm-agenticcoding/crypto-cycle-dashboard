/*
 * Real Chromium form regressions; intentionally opt-in so `node --test
 * tests/*.cjs` keeps working without any third-party dependencies.
 *
 * CI / local setup (Node 20+):
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   RUN_EXECUTION_BROWSER_TESTS=1 node --test tests/test_execution_browser.cjs
 *
 * To use an already installed browser, also set:
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
 * Optional screenshot destination: EXECUTION_BROWSER_ARTIFACTS=/tmp/artifacts
 *
 * Only a loopback test server and fixed public-style fixtures are used. No
 * production data, broker, user browser, or live-market request is involved.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

if (process.env.RUN_EXECUTION_BROWSER_TESTS !== "1") {
  test("execution browser regressions (opt-in; see file header)", { skip: true }, () => {});
} else {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const http = require("node:http");
  const { chromium } = require("playwright");
  const core = require("../execution/execution-core.js");
  const root = path.resolve(__dirname, "..");
  const artifacts = process.env.EXECUTION_BROWSER_ARTIFACTS || path.join(os.tmpdir(), `execution-browser-${process.pid}`);
  const cash = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
  const wholeCash = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  const numeric = value => Number(value.replace(/[^\d.\-]/g, ""));

  // Published 2026-10-05 BTC/ETH offsets and touch rates, with compact synthetic
  // samples that exactly reproduce 1.7/2.3 hits. The latest completed excursion
  // intentionally has no next-reference return: it MUST still count in sizing.
  function fitted(side, first, spacing, counts) {
    return {
      trade_side: side, status: "minute-rolling", first_offset_pct: first, spacing_pct: spacing,
      lookback_sessions: counts.length, expected_rungs_per_session: counts.reduce((a, b) => a + b, 0) / counts.length,
      data_as_of: "2026-10-02", generated_at: "2026-10-05T11:45:00Z",
      selection_diagnostics: {
        raw_minimum: { lookback_sessions: 5, first_offset_pct: .15, spacing_pct: .65 },
        adopted: { gap_to_raw_minimum_bps: 1.23, paired_standard_error_bps: 2.34 },
        eligible_candidate_count: 7, candidate_count: 144, reason: "Continuity within selection band",
        scoring_week_count: 26, common_scoring_weeks: ["2026-03-30", "2026-09-21"]
      },
      session_samples: counts.map((count, index) => ({
        date: `2026-09-${String(10 + index).padStart(2, "0")}`,
        drawdown_pct: side === "buy" ? first + (count - 1) * spacing + .01 : 0,
        runup_pct: side === "sell" ? first + (count - 1) * spacing + .01 : 0,
        next_reference_return_pct: index === counts.length - 1 ? null : .2
      }))
    };
  }
  function listed(symbol, reference, buy) {
    return {
      instrument_id: `ARCX:${symbol}`, symbol, name: `${symbol} regression ETF`, instrument_type: "listed_security",
      exchange: "NYSE Arca", exchange_mic: "ARCX", asset_class: "ETF", currency: "USD", base_asset: symbol,
      market_calendar: "XNYS", timezone: "America/New_York", default_reference_price: reference,
      reference_time: "09:35", fill_start_time: "09:36", price_tick: .01, quantity_step: 1, min_price: .01,
      scaling_source: { symbol: `${symbol}USDT`, rationale: "Fixed integration-test fixture" },
      sides: { buy, sell: fitted("sell", .5, .8, [1, 1, 1, 2]) }
    };
  }
  function fixture() {
    const btc = listed("BTC", 35, fitted("buy", .25, .95, [1, 1, 1, 1, 2, 2, 2, 2, 2, 3]));
    const eth = listed("ETH", 23.32, fitted("buy", .3, .8, [1, 1, 2, 2, 2, 2, 3, 3, 3, 4]));
    const crypto = {
      ...listed("BTCUSDT", 100000, fitted("buy", .25, .8, [1, 2, 2, 1])),
      instrument_id: "BINANCE:SPOT:BTCUSDT", name: "Bitcoin / TetherUS", instrument_type: "crypto_spot",
      exchange: "Binance", exchange_mic: "BINANCE", asset_class: "crypto", base_asset: "BTC", currency: "USDT",
      market_calendar: "24X7", timezone: "UTC", reference_time: "00:00", fill_start_time: "00:01",
      price_tick: .01, quantity_step: .00001, min_quantity: .00001, max_quantity: 9000,
      min_notional: 5, max_notional: 9000000, min_price: .01, max_price: 1000000
    };
    return { schema_version: 3, default_instrument_id: btc.instrument_id,
      instruments: Object.fromEntries([btc, eth, crypto].map(item => [item.instrument_id, item])) };
  }

  let browser, server, origin;
  test.before(async () => {
    fs.mkdirSync(artifacts, { recursive: true });
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const files = {
        "/execution/": "execution/index.html",
        "/execution/index.html": "execution/index.html",
        "/execution/execution-core.js": "execution/execution-core.js",
        "/execution/market-calendar.js": "execution/market-calendar.js"
      };
      if (!files[pathname]) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": pathname.endsWith(".js") ? "application/javascript" : "text/html", "Cache-Control": "no-store" });
      response.end(fs.readFileSync(path.join(root, files[pathname])));
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  });
  test.after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  async function open(t, { time = "2026-10-05T14:00:00Z", data = fixture(), viewport = { width: 1440, height: 1000 } } = {}) {
    const context = await browser.newContext({ viewport, locale: "en-US", timezoneId: "UTC" });
    t.after(() => context.close());
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/data/execution_params.json") return route.fulfill({ json: data });
      if (url.pathname === "/data/execution_instruments.json") return route.fulfill({ json: {
        schema_version: 1, default_instrument_id: data.default_instrument_id,
        instruments: Object.values(data.instruments).map(item => ({ instrument_id: item.instrument_id, enabled: true }))
      } });
      return route.continue();
    });
    // Observe the exact shared-core inputs/outputs used by the real form, while
    // leaving every core calculation and return value unchanged.
    await context.addInitScript(() => {
      window.__executionCalls = [];
      Object.defineProperty(window, "ExecutionCore", {
        configurable: true,
        set(api) {
          const instrumented = { ...api };
          for (const name of ["buyPlan", "sellPlan", "cryptoPlan"]) instrumented[name] = function (input) {
            const output = api[name](input);
            window.__executionCalls.push({ method: name, input: structuredClone(input), output: structuredClone(output) });
            return output;
          };
          Object.defineProperty(window, "ExecutionCore", { value: instrumented, writable: true, configurable: true });
        }
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], "no uncaught browser errors"));
    await page.clock.install({ time: new Date(new Date(time).getTime() - 1000) });
    await page.clock.pauseAt(new Date(time));
    await page.goto(`${origin}/execution/`);
    await page.waitForFunction(() => !document.getElementById("instrument-select").disabled);
    await page.locator("#weekly-two").fill("0");
    return page;
  }
  async function setFields(page, values) {
    for (const [id, value] of Object.entries(values)) await page.locator(`#${id}`).fill(String(value));
  }
  async function submit(page) {
    await page.locator("#calculate-button").click();
  }
  async function cleared(page) {
    assert.equal(await page.locator("#result-stack").isHidden(), true, "old plan is hidden");
    assert.equal(await page.locator("#result-stack .account-result").count(), 0, "old rows are removed");
    assert.equal(await page.locator("#empty").isVisible(), true);
  }
  async function moveClock(page, iso, refresh = true) {
    await page.clock.setSystemTime(new Date(iso));
    if (refresh) await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  }
  async function errorIncludes(page, expression) {
    assert.equal(await page.locator("#form-error").isVisible(), true);
    assert.match(await page.locator("#form-error").innerText(), expression);
    await cleared(page);
  }
  async function assertPlan(page, input, { account = 0, method = input.params.trade_side === "sell" ? "sellPlan" : "buyPlan" } = {}) {
    const expected = core[method](input);
    const article = page.locator("#result-stack .account-result").nth(account);
    assert.equal(await article.isVisible(), true, "calculation should render an account plan");
    const calls = await page.evaluate(() => window.__executionCalls);
    const call = calls.filter(item => item.method === method).slice(-(account === 0 ? await page.locator(".account-result").count() : 1))[0];
    assert.ok(call, `UI must call ExecutionCore.${method}`);
    assert.deepEqual(call.output, expected, "browser core output exactly equals the Node shared-core result");
    assert.equal(call.input.weekSessions, input.weekSessions);
    assert.equal(call.input.horizon, input.horizon ?? null, "optional deadline must remain absent, never invented");
    const crypto = input.params.market_calendar === "24X7";
    const formattedPrice = value => crypto
      ? `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: core.stepDecimals(input.params.price_tick) })} ${input.params.currency}` : cash(value);
    const formattedNotional = value => crypto
      ? `${value.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${input.params.currency}` : cash(value);
    const actualRows = await article.locator("tbody tr").evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent.trim())));
    assert.deepEqual(actualRows, expected.orders.map(order => [
      expected.closeout ? "Closeout" : `Rung ${order.rung}`, formattedPrice(order.price),
      core.quantityText(order.shares, input.params.quantity_step || 1), formattedNotional(order.notional)
    ]), "every displayed price, quantity, rung, and rounded notional matches the shared core");
    const metrics = await article.locator(".result-metric").evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.querySelector("span").textContent, node.querySelector("strong").textContent])));
    assert.equal(numeric(metrics[crypto ? `${input.params.base_asset} / rung` : input.params.trade_side === "sell" ? "shares / rung" : "Shares / rung"]), expected.perRung);
    const expectedTarget = input.params.trade_side === "sell" ? `${core.quantityText(expected.controller.weekly, input.params.quantity_step || 1)} ${crypto ? input.params.base_asset : "shares"}`
      : crypto ? `${expected.controller.weekly.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${input.params.currency}` : wholeCash(expected.controller.weekly);
    assert.equal(metrics["Effective weekly target"], expectedTarget);
    assert.equal(metrics["Deadline pace lift"], expected.controller.enabled ? `${expected.controller.lift.toFixed(2)}×` : "—");
    assert.doesNotMatch(await article.innerText(), /NaN|Infinity|undefined/);
    return { expected, metrics, article, call };
  }
  function params(id = "ARCX:BTC", side = "buy", data = fixture()) { return core.sideParameters(data.instruments[id], side); }
  const buyBase = () => ({ weekly: 10000, total: null, reference: 35, weekSessions: 5, horizon: null, params: params() });
  const sellBase = () => ({ weekly: 100, total: null, held: 1000, reserved: 0, reference: 35, weekSessions: 5, horizon: null, params: params("ARCX:BTC", "sell"), closeout: false, bid: "" });
  async function sellInputs(page, extra = {}) {
    await page.locator("#side-sell").click();
    await setFields(page, { "sell-weekly-one": 100, "sell-held-one": 1000, "sell-reserved-one": 0, ...extra });
  }

  test("real BTC and ETH forms retain newest unlabeled excursion and match every core order", async t => {
    const page = await open(t);
    await submit(page);
    const btc = await assertPlan(page, buyBase());
    assert.equal(btc.expected.hits, 1.7);
    assert.equal(btc.expected.perRung, 34);
    assert.equal(btc.expected.targetShares, 285);
    await page.locator("#instrument-select").selectOption("ARCX:ETH");
    await cleared(page);
    await page.locator("#weekly-two").fill("0");
    await submit(page);
    const eth = await assertPlan(page, { ...buyBase(), reference: 23.32, params: params("ARCX:ETH") });
    assert.equal(eth.expected.hits, 2.3);
    assert.equal(eth.expected.perRung, 38);
    assert.equal(eth.expected.targetShares, 428);
    await page.screenshot({ path: path.join(artifacts, "listed-buy-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, "listed-buy-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "mobile page has no whole-page horizontal overflow");
    t.diagnostic(`Desktop/mobile screenshots: ${artifacts}`);
  });

  test("blank total and explicit zero remain distinct for both BUY and SELL", async t => {
    const page = await open(t);
    await submit(page);
    assert.equal((await assertPlan(page, buyBase())).expected.targetShares, 285);
    await page.locator("#capital-one").fill("0");
    await cleared(page);
    await submit(page);
    assert.equal((await assertPlan(page, { ...buyBase(), total: 0 })).expected.targetShares, 0);
    await sellInputs(page);
    await submit(page);
    assert.equal((await assertPlan(page, sellBase())).expected.targetShares, 100);
    await page.locator("#sell-total-one").fill("0");
    await submit(page);
    assert.equal((await assertPlan(page, { ...sellBase(), total: 0 })).expected.targetShares, 0);
  });

  test("selection diagnostics distinguish raw minimum, adopted gap, score window, and latest market session", async t => {
    const page = await open(t);
    for (const side of ["buy", "sell"]) {
      if (side === "sell") await page.locator("#side-sell").click();
      const summary = await page.locator("#selection-summary").innerText();
      assert.match(summary, /Raw sample minimum: 5 sessions\/days, 0\.15% offset \/ 0\.65% spacing/);
      assert.match(summary, /Adopted excess modeled cost: 1\.23 bp; paired standard error: 2\.34 bp/);
      assert.match(summary, /Eligible: 7\/144/);
      assert.equal(await page.locator("#selection-reason").innerText(), "Adoption reason: Continuity within selection band.");
      const window = await page.locator("#selection-window").innerText();
      assert.match(window, /Scoring window: 26 completed weeks starting 2026-03-30 through 2026-09-21/);
      assert.match(window, /Latest market session: 2026-10-02/);
      assert.match(window, /before a scoring week becomes complete/);
    }
  });

  test("native numeric validation accepts fractional inputs and rejects blank, negative, and zero reference", async t => {
    const page = await open(t);
    await setFields(page, { "weekly-one": "10000.73", "reference-price": "35.12345" });
    assert.equal(await page.locator("#calculator-form").evaluate(node => node.checkValidity()), true);
    assert.equal(await page.locator("#reference-price").evaluate(node => node.validity.stepMismatch), false);
    await submit(page);
    await assertPlan(page, { ...buyBase(), weekly: 10000.73, reference: 35.12345 });
    for (const value of ["", "0", "-1"]) {
      await page.locator("#reference-price").fill(value);
      const before = await page.evaluate(() => window.__executionCalls.length);
      await submit(page);
      assert.equal(await page.locator("#reference-price").evaluate(node => node.checkValidity()), false);
      assert.equal(await page.evaluate(() => window.__executionCalls.length), before, "native invalid values never reach plan generation");
      await cleared(page);
    }
    await setFields(page, { "reference-price": 35, "weekly-one": -1 });
    await submit(page);
    assert.equal(await page.locator("#weekly-one").evaluate(node => node.validity.rangeUnderflow), true);
    await cleared(page);
    await page.locator("#weekly-one").fill("0");
    await submit(page);
    await cleared(page);
    assert.match(await page.locator("#empty").innerText(), /No buy quantity is requested/);
    await sellInputs(page, { "sell-weekly-one": 100.5, "sell-total-one": 1000.5, "sell-held-one": 1000.75, "sell-reserved-one": 25.25 });
    assert.equal(await page.locator("#weekly-one").isDisabled(), true, "hidden BUY fields do not interfere with SELL validation");
    assert.equal(await page.locator("#calculator-form").evaluate(node => node.checkValidity()), true);
    await submit(page);
    await assertPlan(page, { ...sellBase(), weekly: 100.5, total: 1000.5, held: 1000.75, reserved: 25.25 });
  });

  test("weekly zero plus total and five-session deadline activates the valid pace floor", async t => {
    const page = await open(t);
    await setFields(page, { "weekly-one": 0, "capital-one": 10000, deadline: "2026-10-09" });
    await submit(page);
    const { expected } = await assertPlan(page, { ...buyBase(), weekly: 0, total: 10000, horizon: 5 });
    assert.equal(expected.controller.weekly, 10000);
    assert.equal(expected.controller.scheduleFloor, 10000);
    assert.equal(expected.controller.factor, .4);
    await sellInputs(page, { "sell-weekly-one": 0, "sell-total-one": 1000 });
    await submit(page);
    assert.equal((await assertPlan(page, { ...sellBase(), weekly: 0, total: 1000, horizon: 5 })).expected.targetShares, 1000);
  });

  test("no deadline preserves BUY and patient SELL weekly pace and total cap without invented horizon", async t => {
    const page = await open(t);
    await page.locator("#capital-one").fill("100000");
    await submit(page);
    let result = await assertPlan(page, { ...buyBase(), total: 100000 });
    assert.equal(result.expected.controller.weekly, 10000);
    assert.equal(result.expected.controller.enabled, false);
    assert.equal(result.expected.controller.factor, 1);
    assert.equal(result.metrics["Even-pace floor"], "—");
    assert.match(await page.locator("#session-label").innerText(), /no deadline/);
    await page.locator("#capital-one").fill("3500");
    await submit(page);
    assert.equal((await assertPlan(page, { ...buyBase(), total: 3500 })).expected.targetShares, 100);
    await sellInputs(page, { "sell-total-one": 1000 });
    await submit(page);
    result = await assertPlan(page, { ...sellBase(), total: 1000 });
    assert.equal(result.expected.controller.weekly, 100);
    assert.equal(result.expected.controller.enabled, false);
    assert.equal(result.expected.controller.factor, 1);
    await page.locator("#sell-total-one").fill("50");
    await submit(page);
    assert.equal((await assertPlan(page, { ...sellBase(), total: 50 })).expected.targetShares, 50);
  });

  test("Finish by deadline requires an explicit date and total; native and submit guards agree", async t => {
    const page = await open(t);
    await sellInputs(page, { "sell-total-one": 1000 });
    await page.locator("#sell-policy").selectOption("deadline");
    await submit(page);
    assert.equal(await page.locator("#deadline").evaluate(node => node.required && node.validity.valueMissing), true);
    await cleared(page);
    // Also test the defense-in-depth handler when native form validation is bypassed.
    await page.locator("#calculator-form").dispatchEvent("submit");
    await errorIncludes(page, /Choose a deadline/);
    await page.locator("#deadline").fill("2026-10-09");
    await page.locator("#sell-total-one").fill("");
    await submit(page);
    await errorIncludes(page, /total remaining shares are required/i);
    await page.locator("#sell-total-one").fill("1000");
    await submit(page);
    await assertPlan(page, { ...sellBase(), total: 1000, horizon: 5 });
  });

  test("optional, malformed, expired, and unsupported deadlines never leave an old plan", async t => {
    const page = await open(t);
    await submit(page);
    await page.locator("#deadline").fill("2026-10-04");
    await submit(page);
    await errorIncludes(page, /no eligible sessions|passed/i);
    await page.locator("#deadline").fill("2029-01-01");
    await submit(page);
    await errorIncludes(page, /calendar range|2025.*2028/i);
    // Emulate a browser's text fallback for type=date, allowing a malformed civil date.
    await page.locator("#deadline").evaluate(node => { node.type = "text"; });
    await page.locator("#deadline").fill("2026-02-30");
    await submit(page);
    await errorIncludes(page, /valid deadline/i);
    await page.locator("#deadline").fill("");
    await submit(page);
    await assertPlan(page, buyBase());
    await page.locator("#deadline").evaluate(node => { node.type = "date"; });
    await sellInputs(page);
    await page.locator("#deadline").fill("2026-10-04");
    await submit(page);
    await errorIncludes(page, /no eligible sessions|passed/i);
    // January 1 is closed and is the first day in the supported calendar. The
    // policy hint must not throw while searching for an earlier final session.
    await page.locator("#deadline").fill("2025-01-01");
    await submit(page);
    await errorIncludes(page, /no eligible sessions|passed/i);
    await page.locator("#deadline").fill("2029-01-01");
    await submit(page);
    await errorIncludes(page, /calendar range|2025.*2028/i);
    await page.locator("#deadline").fill("");
    await submit(page);
    await assertPlan(page, sellBase());
  });

  test("30-rung BUY ceiling reports target 600, per rung 10, allocated 300, unallocated 300", async t => {
    const data = fixture();
    Object.assign(data.instruments["ARCX:BTC"].sides.buy, { session_samples: [], expected_rungs_per_session: 12 });
    const page = await open(t, { data });
    await setFields(page, { "weekly-one": 6000, "reference-price": 10 });
    await submit(page);
    const result = await assertPlan(page, { ...buyBase(), weekly: 6000, reference: 10, params: params("ARCX:BTC", "buy", data) });
    assert.equal(result.expected.targetShares, 600);
    assert.equal(result.expected.perRung, 10);
    assert.equal(result.expected.orders.length, 30);
    assert.equal(result.expected.orderQuantity, 300);
    assert.equal(result.expected.unallocated, 300);
    assert.match(await result.article.locator(".notice").innerText(), /300 shares are unallocated.*30-rung/i);
    assert.match(await result.article.locator(".notice").innerText(), /does not cover the target/i);
  });

  for (const side of ["buy", "sell"]) {
    test(`${side.toUpperCase()} is blocked at 09:35:59 ET and opens at 09:36`, async t => {
      const page = await open(t, { time: "2026-10-05T13:35:59Z" });
      if (side === "sell") await sellInputs(page);
      assert.equal(await page.locator("#calculate-button").isDisabled(), true);
      await page.locator("#calculator-form").dispatchEvent("submit");
      assert.equal(await page.locator("#result-stack").isHidden(), true);
      await moveClock(page, "2026-10-05T13:36:00Z");
      assert.equal(await page.locator("#calculate-button").isEnabled(), true);
      await submit(page);
      await assertPlan(page, side === "buy" ? buyBase() : sellBase());
    });
    test(`${side.toUpperCase()} respects Nov 27 half-day: 12:59 open, 13:00 closed`, async t => {
      const page = await open(t, { time: "2026-11-27T17:59:00Z" });
      if (side === "sell") await sellInputs(page);
      assert.equal(await page.locator("#calculate-button").isEnabled(), true);
      await submit(page);
      await assertPlan(page, { ...(side === "buy" ? buyBase() : sellBase()), weekSessions: 1 });
      await moveClock(page, "2026-11-27T18:00:00Z");
      assert.equal(await page.locator("#calculate-button").isDisabled(), true);
      assert.equal(await page.locator("#result-stack").isHidden(), true);
      assert.match(await page.locator("#session-label").innerText(), /13:00/);
    });
    test(`crypto ${side.toUpperCase()} excludes 00:00 and opens at 00:01 UTC`, async t => {
      const page = await open(t, { time: "2026-10-05T00:00:00Z" });
      await page.locator("#instrument-select").selectOption("BINANCE:SPOT:BTCUSDT");
      let input = { ...buyBase(), weekly: 1000, reference: 100000, weekSessions: 7, params: params("BINANCE:SPOT:BTCUSDT") };
      if (side === "sell") {
        await sellInputs(page, { "sell-weekly-one": .01, "sell-held-one": .1 });
        input = { ...sellBase(), weekly: .01, held: .1, reference: 100000, weekSessions: 7, params: params("BINANCE:SPOT:BTCUSDT", "sell") };
      } else await page.locator("#weekly-one").fill("1000");
      assert.equal(await page.locator("#calculate-button").isDisabled(), true);
      await moveClock(page, "2026-10-05T00:01:00Z");
      assert.equal(await page.locator("#calculate-button").isEnabled(), true);
      await submit(page);
      await assertPlan(page, input, { method: side === "buy" ? "cryptoPlan" : "sellPlan" });
      await moveClock(page, "2026-10-06T00:00:00Z");
      await cleared(page);
      assert.equal(await page.locator("#reference-price").inputValue(), "", "UTC daily reset invalidates yesterday's reference");
      assert.equal(await page.locator("#calculate-button").isDisabled(), true);
      await moveClock(page, "2026-10-06T00:01:00Z");
      await submit(page);
      await cleared(page);
      assert.equal(await page.locator("#reference-price").evaluate(node => node.validity.valueMissing), true);
      await page.locator("#reference-price").fill("100000");
      await submit(page);
      await assertPlan(page, { ...input, weekSessions: 6 }, { method: side === "buy" ? "cryptoPlan" : "sellPlan" });
    });
  }

  test("repeat submissions replace rows; input, direction, instrument, and failures invalidate old plans", async t => {
    const page = await open(t);
    await submit(page);
    const initial = await page.locator("#result-stack").innerHTML();
    await submit(page);
    assert.equal(await page.locator("#result-stack").innerHTML(), initial, "repeat submit replaces rather than appends orders");
    await page.locator("#reference-price").fill("36");
    await cleared(page);
    await submit(page);
    await assertPlan(page, { ...buyBase(), reference: 36 });
    await sellInputs(page, { "sell-total-one": 500, "sell-reserved-one": 25 });
    await cleared(page);
    await submit(page);
    await assertPlan(page, { ...sellBase(), total: 500, reserved: 25, reference: 36 });
    await page.locator("#side-buy").click();
    await cleared(page);
    assert.equal(await page.locator("#reference-price").inputValue(), "36");
    await page.locator("#side-sell").click();
    await submit(page);
    await page.locator("#instrument-select").selectOption("ARCX:ETH");
    await cleared(page);
    assert.equal(await page.locator("#reference-price").inputValue(), "23.32");
    for (const suffix of ["one", "two"]) for (const field of ["weekly", "held", "reserved", "total"])
      assert.equal(await page.locator(`#sell-${field}-${suffix}`).inputValue(), field === "total" ? "" : "0");
    await setFields(page, { "sell-weekly-one": 100, "sell-held-one": 500 });
    await submit(page);
    await setFields(page, { "sell-weekly-two": 100, "sell-held-two": 50, "sell-reserved-two": 60 });
    await submit(page);
    await errorIncludes(page, /Account 2.*exceed/i);
  });

  test("closeout uses a fresh bid, expires that quote after 60 seconds, and stops at the close", async t => {
    const page = await open(t, { time: "2026-10-05T19:45:00Z" });
    await sellInputs(page, { "sell-weekly-one": 100, "sell-total-one": 600, "sell-held-one": 550, "sell-reserved-one": 150 });
    await page.locator("#deadline").fill("2026-10-05");
    await page.locator("#sell-policy").selectOption("deadline");
    assert.equal(await page.locator("#closeout-bid-field").isVisible(), true);
    await page.locator("#closeout-bid").fill("34.237");
    await submit(page);
    let result = await assertPlan(page, { ...sellBase(), total: 600, held: 550, reserved: 150, horizon: 1, closeout: true, bid: 34.237 });
    assert.equal(result.expected.orders[0].shares, 400);
    assert.equal(result.expected.orders[0].price, 34.23);
    await page.screenshot({ path: path.join(artifacts, "sell-closeout-desktop.png"), fullPage: true });
    // setSystemTime does not fire timers, exercising the submit-time protection
    // required when a background tab throttles the periodic refresh.
    await moveClock(page, "2026-10-05T19:46:01Z", false);
    await submit(page);
    await errorIncludes(page, /Refresh.*best bid|quote.*expires/i);
    assert.equal(await page.locator("#closeout-bid").inputValue(), "");
    await page.locator("#closeout-bid").fill("34.251");
    await submit(page);
    result = await assertPlan(page, { ...sellBase(), total: 600, held: 550, reserved: 150, horizon: 1, closeout: true, bid: 34.251 });
    assert.equal(result.expected.orders[0].price, 34.25);
    await moveClock(page, "2026-10-05T20:00:00Z");
    assert.equal(await page.locator("#calculate-button").isDisabled(), true);
    assert.equal(await page.locator("#result-stack").isHidden(), true);
    assert.equal(await page.locator("#closeout-bid").inputValue(), "");
  });
}
