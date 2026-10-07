/* Opt-in Chromium tests for optional device-local progress. Synthetic fixtures only.
 * RUN_EXECUTION_BROWSER_TESTS=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
 * node --test tests/test_execution_progress_browser.cjs
 * Screenshots: EXECUTION_BROWSER_ARTIFACTS (defaults to a temporary directory).
 */
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
if (process.env.RUN_EXECUTION_BROWSER_TESTS !== "1") {
  test("optional execution progress browser regressions (opt-in)", {skip: true}, () => {});
} else {
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
  const {chromium} = require("playwright");
  const core = require("../execution/execution-core.js");
  const ROOT = path.resolve(__dirname, ".."), KEY = "execution-progress-v1";
  const artifacts = process.env.EXECUTION_BROWSER_ARTIFACTS || path.join(os.tmpdir(), `execution-progress-browser-${process.pid}`);
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
    fs.mkdirSync(artifacts, {recursive: true});
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const allowed = ["execution/index.html", "execution/execution-core.js", "execution/market-calendar.js", "execution/task-ledger.js", "execution/task-ledger-ui.js"];
      const file = pathname === "/execution/" ? "execution/index.html" : pathname.slice(1);
      if (!allowed.includes(file)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, {"Content-Type": file.endsWith(".js") ? "application/javascript" : "text/html", "Cache-Control": "no-store"});
      response.end(fs.readFileSync(path.join(ROOT, file)));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
  });
  test.after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
  async function open(t, {mobile = false, storage = null, failure = null} = {}) {
    const context = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000}, locale: "en-US", timezoneId: "UTC", ...(mobile ? {isMobile: true, hasTouch: true, deviceScaleFactor: 1} : {})});
    t.after(() => context.close());
    const requests = [], errors = [];
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      requests.push({url: request.url(), method: request.method(), body: request.postData()});
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/data/execution_params.json") return route.fulfill({json: fixture()});
      if (url.pathname === "/data/execution_instruments.json") return route.fulfill({json: {schema_version: 1, default_instrument_id: "ARCX:BTC", instruments: Object.values(fixture().instruments).map(item => ({instrument_id: item.instrument_id, enabled: true}))}});
      return route.continue();
    });
    await context.addInitScript(({key, stored, failure}) => {
      window.__ledgerWrites = [];
      if (stored !== null && !sessionStorage.getItem("fixture-seeded")) { localStorage.setItem(key, stored); sessionStorage.setItem("fixture-seeded", "1"); }
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function(name) { if (failure === "unavailable" && name === key) throw new DOMException("Disabled", "SecurityError"); return get.call(this, name); };
      Storage.prototype.setItem = function(name, value) {
        if (name === key) { window.__ledgerWrites.push(value); if (failure === "quota") throw new DOMException("Full", "QuotaExceededError"); }
        return set.call(this, name, value);
      };
      if (failure === "locks") Object.defineProperty(navigator, "locks", {value: undefined});
      window.__executionCalls = [];
      Object.defineProperty(window, "ExecutionCore", {configurable: true, set(api) {
        const wrapped = {...api};
        for (const method of ["buyPlan", "sellPlan", "cryptoPlan"]) wrapped[method] = input => { const output = api[method](input); window.__executionCalls.push({method, input: structuredClone(input), output: structuredClone(output)}); return output; };
        Object.defineProperty(window, "ExecutionCore", {value: wrapped, configurable: true});
      }});
    }, {key: KEY, stored: storage, failure});
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-05T14:00:00Z"));
    await page.goto(`${origin}/execution/`); await page.waitForFunction(() => !document.getElementById("instrument-select").disabled && window.ExecutionProgressUI);
    t.after(() => {
      assert.deepEqual(errors, [], "no uncaught browser errors");
      for (const request of requests) {
        const url = new URL(request.url);
        assert.equal(url.origin, origin, "all requests stay on the fixture origin");
        assert.equal(request.method, "GET"); assert.equal(request.body, null, "financial inputs never enter a network body");
        assert.ok(["", "?v=1", "?v=6"].includes(url.search), "URLs contain only static asset versions");
      }
    });
    return page;
  }
  const read = page => page.evaluate(key => { const raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); }, KEY);
  async function fields(page, values) { for (const [id, value] of Object.entries(values)) await page.locator(`#${id}`).fill(String(value)); }
  async function expand(page) { await page.locator("#progress-details").evaluate(node => {node.open = true;}); await page.locator("#progress-enable").click(); }
  async function create(page, {weekly = 100, total = 500, side = "buy", account = "one"} = {}) {
    if (await page.locator("#progress-enable").isVisible()) await page.locator("#progress-enable").click();
    if (side === "sell") await page.locator("#side-sell").click();
    await page.locator("#progress-account").selectOption(account);
    await fields(page, side === "buy" ? {[`weekly-${account}`]: weekly, [`capital-${account}`]: total} : {[`sell-weekly-${account}`]: weekly, [`sell-total-${account}`]: total});
    await page.locator("#progress-create-button").click();
    await page.waitForFunction(() => document.getElementById("progress-task").hidden === false);
    assert.equal(await page.locator("#progress-error").isHidden(), true, await page.locator("#progress-error").textContent());
  }
  async function recordOrder(page, {quantity = 10, price = 10, id = "synthetic-order"} = {}) {
    await page.locator("#progress-order-form").evaluate(node => {node.closest("details").open = true;});
    await fields(page, {"progress-order-qty": quantity, "progress-order-price": price, "progress-order-id": id});
    await page.locator("#progress-order-save").click();
    await page.waitForFunction(() => !document.getElementById("progress-order-save").disabled);
    assert.equal(await page.locator("#progress-error").isHidden(), true, await page.locator("#progress-error").textContent());
  }
  async function recordFill(page, {quantity = 2, price = 9, order = "synthetic-order", id = "synthetic-fill", executedAt = ""} = {}) {
    await page.locator("#progress-fill-form").evaluate(node => {node.closest("details").open = true;});
    await page.locator("#progress-fill-order").selectOption(order);
    await fields(page, {"progress-fill-qty": quantity, "progress-fill-price": price, "progress-fill-id": id, "progress-fill-at": executedAt});
    await page.locator("#progress-fill-save").click();
    await page.waitForFunction(() => !document.getElementById("progress-fill-save").disabled);
    assert.equal(await page.locator("#progress-error").isHidden(), true, await page.locator("#progress-error").textContent());
  }
  const snapshot = page => page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)).tasks[0]; return ExecutionTaskLedger.snapshot(saved, new Date().toISOString()); }, KEY);
  const renderedOrders = page => page.locator("#result-stack tbody tr").evaluateAll(rows => rows.map(row => ({quantity: +row.cells[2].textContent.replace(/[^0-9.]/g, ""), price: +row.cells[1].textContent.replace(/[^0-9.]/g, "")})));
  async function screenshot(page, filename) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let top = 0; top < height; top += 600) { await page.evaluate(y => scrollTo(0, y), top); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no page-level horizontal overflow");
    await page.screenshot({path: path.join(artifacts, filename), fullPage: true});
  }
  test("default stays collapsed, empty, optional and financially stateless; manual math unchanged", async t => {
    const page = await open(t);
    assert.equal(await page.locator("#progress-details").evaluate(node => node.open), false);
    for (const id of ["weekly-one", "weekly-two", "capital-one", "capital-two", "sell-held-one", "sell-held-two"]) assert.equal(await page.locator(`#${id}`).inputValue(), "");
    assert.equal(await page.locator("#weekly-two").evaluate(node => node.required), false);
    await fields(page, {"weekly-one": 10000, "reference-price": 35}); await page.locator("#calculate-button").click();
    const call = await page.evaluate(() => window.__executionCalls.at(-1));
    assert.deepEqual(call.output, core.buyPlan(call.input));
    assert.equal(await page.locator("#result-stack .account-result").count(), 1);
    assert.deepEqual(await page.evaluate(() => window.__ledgerWrites), []); assert.equal(await read(page), null);
    await screenshot(page, "progress-desktop-collapsed.png");
    await page.locator("#instrument-select").selectOption("ARCX:ETH");
    assert.equal(await page.locator("#weekly-one").inputValue(), "");
    assert.equal(await page.locator("#weekly-two").inputValue(), "");
    assert.equal(await read(page), null);
  });
  test("opening alone creates nothing; explicit starting amounts persist without automatic adoption", async t => {
    const page = await open(t); await expand(page); assert.equal(await read(page), null);
    assert.equal(await page.locator("#progress-create-button").isDisabled(), true);
    await create(page); assert.equal((await read(page)).tasks.length, 1);
    assert.equal((await read(page)).tasks[0].events.length, 0);
    assert.match(await page.locator("#progress-average").innerText(), /No fills/);
    await page.reload(); await page.waitForFunction(() => !document.getElementById("instrument-select").disabled);
    assert.equal(await page.locator("#progress-details").evaluate(node => node.open), false);
    assert.equal(await page.locator("#weekly-one").inputValue(), "");
    await expand(page); assert.equal(await page.locator("#progress-task").isVisible(), true);
    assert.equal(await page.locator("#weekly-one").inputValue(), "");
    await page.locator("#progress-use").click(); assert.equal(await page.locator("#weekly-one").inputValue(), "100");
    assert.equal(await page.locator("#result-stack").isHidden(), true);
    await screenshot(page, "progress-desktop-expanded.png");
  });
  test("instrument, side and account records stay separate; drafts do not follow selection", async t => {
    const page = await open(t); await expand(page); await create(page);
    await page.locator("#progress-fill-form").evaluate(node => {node.closest("details").open = true;});
    await fields(page, {"progress-fill-qty": 7, "progress-fill-price": 8, "progress-fill-id": "draft"});
    await page.locator("#progress-account").selectOption("two");
    assert.equal(await page.locator("#progress-fill-qty").inputValue(), "");
    await create(page, {account: "two", weekly: 200, total: 900});
    await create(page, {side: "sell", account: "two", weekly: 20, total: 70});
    await page.locator("#instrument-select").selectOption("ARCX:ETH");
    assert.equal(await page.locator("#progress-task").isHidden(), true);
    await create(page, {side: "sell", weekly: 10, total: 100});
    const tasks = (await read(page)).tasks;
    assert.equal(tasks.length, 4); assert.equal(new Set(tasks.map(item => item.key)).size, 4);
    await page.locator("#instrument-select").selectOption("ARCX:BTC"); await page.locator("#side-buy").click();
    assert.equal(await page.locator("#progress-total-remaining").innerText(), "500 USD");
  });
  test("partial fills, pending cancellation and confirmed cancellation conserve reservations", async t => {
    const page = await open(t); await expand(page); await create(page); await recordOrder(page);
    assert.equal((await snapshot(page)).reservedCash, 100);
    await recordFill(page); let state = await snapshot(page);
    assert.equal(state.recordedQuantity, 2); assert.equal(state.totalRemaining, 482); assert.equal(state.reservedCash, 80); assert.equal(state.freeWeekly, 2);
    await page.getByRole("button", {name: "Record cancel requested", exact: true}).click();
    await page.waitForFunction(() => document.getElementById("progress-orders").textContent.includes("cancel-pending"));
    assert.equal((await snapshot(page)).reservedCash, 80);
    await recordFill(page, {quantity: 1, id: "second-fill"});
    assert.equal((await snapshot(page)).reservedCash, 70);
    await page.getByRole("button", {name: "Record broker-confirmed cancellation", exact: true}).click();
    assert.equal((await snapshot(page)).reservedCash, 70, "on-page confirmation required");
    await page.locator("#progress-confirm-yes").click();
    await page.waitForFunction(() => document.getElementById("progress-reserved").textContent === "0 USD");
    state = await snapshot(page); assert.equal(state.freeWeekly, 73); assert.equal(state.freeTotal, 473); assert.equal(state.averageFillPrice, 9);
    assert.match(await page.locator("#progress-average").innerText(), /^9 USD/);
  });
  test("late reported fill remains recordable after confirmed cancellation with actual execution time", async t => {
    const page = await open(t); await expand(page); await create(page); await recordOrder(page);
    await page.clock.setFixedTime(new Date("2026-10-05T14:02:00Z"));
    await page.getByRole("button", {name: "Record broker-confirmed cancellation", exact: true}).click(); await page.locator("#progress-confirm-yes").click();
    await page.clock.setFixedTime(new Date("2026-10-05T14:03:00Z"));
    await recordFill(page, {executedAt: "2026-10-05T14:01"});
    assert.equal((await snapshot(page)).totalRemaining, 482); assert.equal((await snapshot(page)).reservedCash, 0);
  });
  test("Friday-close preview never reuses current-week progress caps for next week", async t => {
    const page = await open(t); await expand(page); await create(page);
    await page.locator("#progress-use").click();
    await page.clock.setFixedTime(new Date("2026-10-09T20:00:00Z"));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.locator("#calculate-button").click();
    assert.equal(await page.locator("#result-stack").isHidden(), true);
    assert.match(await page.locator("#form-error").innerText(), /current week, not the next planning week/);
    await fields(page, {"weekly-one": 101});
    await page.locator("#calculate-button").click();
    assert.equal(await page.locator("#result-stack").isVisible(), true);
    assert.match(await page.locator("#plan-context").innerText(), /Oct 12, 2026/);
    assert.equal((await snapshot(page)).freeWeekly, 100, "preview does not mutate saved progress");
  });
  test("new week blocks copied amounts until explicit confirmation; working orders carry over", async t => {
    const page = await open(t); await expand(page); await create(page); await recordOrder(page, {quantity: 2}); await page.locator("#progress-use").click();
    await page.clock.setFixedTime(new Date("2026-10-12T14:00:00Z")); await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    assert.equal(await page.locator("#progress-week").isVisible(), true); assert.equal(await page.locator("#progress-week-cap").inputValue(), "");
    assert.equal(await page.locator("#progress-use").isDisabled(), true);
    await page.locator("#calculate-button").click(); assert.equal(await page.locator("#result-stack").isHidden(), true);
    await fields(page, {"progress-week-cap": 50}); await page.locator("#progress-confirm-week").click();
    await page.waitForFunction(() => document.getElementById("progress-use").disabled === false);
    await page.locator("#progress-use").click(); assert.equal(await page.locator("#weekly-one").inputValue(), "30");
    assert.equal((await snapshot(page)).reservedCash, 20);
  });
  test("buy deadline keeps post-plan cash cap; reference/deadline edits retain binding; amount edit detaches", async t => {
    const page = await open(t); await expand(page); await create(page, {weekly: 100, total: 10000}); await page.locator("#progress-use").click();
    await fields(page, {deadline: "2026-10-05", "reference-price": 35}); await page.locator("#calculate-button").click();
    let orders = await renderedOrders(page); assert.ok(orders.length); assert.ok(orders.reduce((sum, item) => sum + item.quantity * item.price, 0) <= 100);
    const call = await page.evaluate(() => window.__executionCalls.at(-1)); assert.ok(call.output.orders.reduce((sum, item) => sum + item.notional, 0) > 100, "original core deadline target unchanged");
    assert.match(await page.locator("#result-stack").innerText(), /Deadline pace exceeds.*confirmed weekly limit/);
    await fields(page, {"weekly-one": 200}); assert.match(await page.locator("#progress-binding").innerText(), /Manual mode/);
    await page.locator("#calculate-button").click(); orders = await renderedOrders(page); assert.ok(orders.reduce((sum, item) => sum + item.quantity * item.price, 0) > 100);
  });
  test("sell gross targets deduct ALL manual reservations once and retain hard cap with deadline", async t => {
    const page = await open(t); await expand(page); await create(page, {side: "sell", weekly: 100, total: 1000}); await recordOrder(page, {quantity: 30, price: 40});
    await fields(page, {"sell-held-one": 500, "sell-reserved-one": 20}); await page.locator("#progress-use").click();
    assert.match(await page.locator("#progress-error").innerText(), /ALL existing sell orders/);
    await fields(page, {"sell-reserved-one": 40}); await page.locator("#progress-use").click();
    assert.equal(await page.locator("#sell-weekly-one").inputValue(), "100"); assert.equal(await page.locator("#sell-held-one").inputValue(), "500");
    await fields(page, {deadline: "2026-10-05"}); await page.locator("#calculate-button").click();
    const orders = await renderedOrders(page); assert.ok(orders.length); assert.ok(orders.reduce((sum, item) => sum + item.quantity, 0) <= 60);
    await fields(page, {"sell-held-one": 450}); assert.match(await page.locator("#progress-binding").innerText(), /Manual mode/);
  });
  for (const failure of ["unavailable", "quota", "locks"]) test(`storage ${failure} rejects writes visibly while manual calculator stays usable`, async t => {
    const page = await open(t, {failure}); await expand(page);
    await fields(page, {"weekly-one": 100, "capital-one": 500});
    if (failure !== "unavailable") await page.locator("#progress-create-button").click();
    await page.waitForFunction(() => !document.getElementById("progress-error").hidden);
    assert.match(await page.locator("#progress-error").innerText(), /storage|browser/i);
    assert.doesNotMatch(await page.locator("#progress-message").innerText(), /Saved in this browser/);
    await page.locator("#calculate-button").click(); assert.equal(await page.locator("#result-stack .account-result").count(), 1);
    if (failure !== "unavailable") assert.equal(await read(page), null);
  });
  test("corrupt/version-unknown state fails closed; destructive reset needs explicit on-page confirmation", async t => {
    const page = await open(t, {storage: '{"storageVersion":999,"revision":0,"tasks":[]}'}); await expand(page);
    assert.equal(await page.locator("#progress-error").isVisible(), true); assert.equal(await page.locator("#progress-create").isHidden(), true);
    await page.locator("#progress-reset").click(); await page.locator("#progress-confirm-no").click(); assert.equal((await read(page)).storageVersion, 999);
    await page.locator("#progress-reset").click(); await page.locator("#progress-confirm-yes").click();
    await page.waitForFunction(key => localStorage.getItem(key) === null, KEY); assert.equal(await read(page), null);
  });
  test("delete requires confirmation and export downloads local JSON only", async t => {
    const page = await open(t); await expand(page); await create(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#progress-export").click()]);
    assert.equal(download.suggestedFilename(), "execution-progress-local.json");
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8")); assert.equal(exported.tasks[0].initialTotalRemaining, 500);
    await page.locator("#progress-delete").click(); assert.equal((await read(page)).tasks.length, 1);
    await page.locator("#progress-confirm-no").click(); assert.equal((await read(page)).tasks.length, 1);
    await page.locator("#progress-delete").click(); await page.locator("#progress-confirm-yes").click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).tasks.length === 0, KEY);
  });
  test("cross-tab changes invalidate plan binding and stale writer cannot overwrite", async t => {
    const page = await open(t); await expand(page); await create(page); await page.locator("#progress-use").click();
    const second = await page.context().newPage(); await second.clock.setFixedTime(new Date("2026-10-05T14:00:00Z")); await second.goto(`${origin}/execution/`);
    await second.waitForFunction(() => window.ExecutionProgressUI); await expand(second);
    await recordOrder(second, {quantity: 2});
    await page.waitForFunction(() => document.getElementById("progress-error").textContent.includes("changed"));
    assert.match(await page.locator("#progress-binding").innerText(), /another tab/);
    await page.locator("#calculate-button").click(); assert.equal(await page.locator("#result-stack").isHidden(), true);
    assert.equal((await read(page)).tasks[0].events.length, 1);
    await page.locator("#progress-reload").click(); await page.locator("#progress-use").click(); assert.equal(await page.locator("#weekly-one").inputValue(), "80");
  });
  test("storage fills up after adoption: failed actual fill invalidates the old plan", async t => {
    const page = await open(t); await expand(page); await create(page); await page.locator("#progress-use").click();
    await page.evaluate(key => { window.__simulateQuota = true; const original = Storage.prototype.setItem; Storage.prototype.setItem = function(name, value) { if (name === key && window.__simulateQuota) throw new DOMException("Full", "QuotaExceededError"); return original.call(this, name, value); }; }, KEY);
    await page.locator("#progress-fill-form").evaluate(node => {node.closest("details").open = true;});
    await fields(page, {"progress-fill-qty": 2, "progress-fill-price": 9}); await page.locator("#progress-fill-save").click();
    await page.waitForFunction(() => !document.getElementById("progress-error").hidden);
    assert.match(await page.locator("#progress-message").innerText(), /not confirmed saved/);
    await page.locator("#calculate-button").click(); assert.equal(await page.locator("#result-stack").isHidden(), true);
    await fields(page, {"weekly-one": 80}); await page.locator("#calculate-button").click();
    assert.equal(await page.locator("#result-stack .account-result").count(), 1, "explicit manual edit remains usable");
    await page.evaluate(() => { window.__simulateQuota = false; }); await page.locator("#progress-reload").click();
    assert.equal(await page.locator("#progress-use").isDisabled(), true, "Reload alone cannot erase knowledge of an unsaved actual fill");
    assert.match(await page.locator("#progress-warning").innerText(), /could not be recorded/);
    assert.equal(await page.locator("#progress-fill-qty").inputValue(), "2");
    await page.locator("#progress-fill-save").click(); await page.waitForFunction(() => !document.getElementById("progress-use").disabled);
    assert.equal((await snapshot(page)).recordedQuantity, 2);
    await page.locator("#progress-use").click(); assert.equal(await page.locator("#weekly-one").inputValue(), "82");
  });
  test("simultaneous tabs serialize creation and reject the stale writer", async t => {
    const page = await open(t); await expand(page); await fields(page, {"weekly-one": 100, "capital-one": 500});
    const second = await page.context().newPage(); await second.clock.setFixedTime(new Date("2026-10-05T14:00:00Z")); await second.goto(`${origin}/execution/`);
    await second.waitForFunction(() => window.ExecutionProgressUI); await expand(second); await fields(second, {"weekly-one": 200, "capital-one": 900});
    await Promise.all([page.locator("#progress-create-button").evaluate(node => node.click()), second.locator("#progress-create-button").evaluate(node => node.click())]);
    await page.waitForFunction(key => !!localStorage.getItem(key), KEY);
    await page.waitForFunction(() => !document.getElementById("progress-reload").disabled);
    await second.waitForFunction(() => !document.getElementById("progress-reload").disabled);
    const saved = await read(page); assert.equal(saved.tasks.length, 1); assert.equal(saved.revision, 1);
    assert.ok([500, 900].includes(saved.tasks[0].initialTotalRemaining));
    assert.ok(await page.locator("#progress-error").isVisible() || await second.locator("#progress-error").isVisible());
  });
  test("crypto post-plan hard cap preserves step and minimum notional; dust is disclosed", async t => {
    const page = await open(t); await page.locator("#instrument-select").selectOption("BINANCE:SPOT:BTCUSDT");
    await expand(page); await create(page, {weekly: 10, total: 1000}); await page.locator("#progress-use").click();
    await fields(page, {deadline: "2026-10-05", "reference-price": 100000}); await page.locator("#calculate-button").click();
    const orders = await renderedOrders(page); assert.ok(orders.length);
    assert.ok(orders.reduce((sum, order) => sum + order.quantity * order.price, 0) <= 10 + 1e-10);
    for (const order of orders) { assert.ok(order.quantity * order.price >= 5 - 1e-10); assert.ok(Math.abs(order.quantity / .00001 - Math.round(order.quantity / .00001)) < 1e-8); }
    assert.match(await page.locator("#result-stack").innerText(), /Unallocated remainder/);
  });
  test("already-working exposure beyond a cap is recorded truthfully and blocks new planning", async t => {
    const page = await open(t); await expand(page); await create(page);
    await recordOrder(page, {quantity: 60, price: 10});
    let state = await snapshot(page); assert.equal(state.reservedCash, 600); assert.equal(state.planningBlocked, true);
    assert.equal(await page.locator("#progress-use").isDisabled(), true);
    assert.equal(await page.locator("#progress-order-save").isEnabled(), true, "other real working exposure can still be recorded");
    await page.clock.setFixedTime(new Date("2026-10-12T14:00:00Z")); await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await recordOrder(page, {quantity: 1, price: 10, id: "carried-reported-order"});
    state = await snapshot(page); assert.equal(state.reservedCash, 610); assert.equal(state.needsWeekConfirmation, true);
  });
  test("rejected linked overfill invalidates a bound plan and must be corrected before reuse", async t => {
    const page = await open(t); await expand(page); await create(page, {weekly: 200}); await recordOrder(page); await page.locator("#progress-use").click();
    await page.locator("#progress-fill-form").evaluate(node => {node.closest("details").open = true;});
    await page.locator("#progress-fill-order").selectOption("synthetic-order"); await fields(page, {"progress-fill-qty": 11, "progress-fill-price": 9}); await page.locator("#progress-fill-save").click();
    await page.waitForFunction(() => !document.getElementById("progress-error").hidden); assert.match(await page.locator("#progress-error").innerText(), /individual order quantity/);
    await page.locator("#calculate-button").click(); assert.equal(await page.locator("#result-stack").isHidden(), true);
    await page.locator("#progress-reload").click(); assert.equal(await page.locator("#progress-use").isDisabled(), true);
    await fields(page, {"progress-fill-qty": 1}); await page.locator("#progress-fill-save").click();
    await page.waitForFunction(() => !document.getElementById("progress-use").disabled); assert.equal((await snapshot(page)).recordedQuantity, 1);
  });
  test("leave-page warning is only active while an actual-event entry is unsaved", async t => {
    const page = await open(t);
    const warned = () => page.evaluate(() => {const event = new Event("beforeunload", {cancelable: true}); dispatchEvent(event); return event.defaultPrevented;});
    assert.equal(await warned(), false, "manual/off mode has no leave-page warning");
    await expand(page); await create(page, {weekly: 200}); await recordOrder(page); assert.equal(await warned(), false, "saved records do not cause a warning");
    await page.locator("#progress-fill-form").evaluate(node => {node.closest("details").open = true;});
    await page.locator("#progress-fill-order").selectOption("synthetic-order"); await fields(page, {"progress-fill-qty": 11, "progress-fill-price": 9}); await page.locator("#progress-fill-save").click();
    await page.waitForFunction(() => !document.getElementById("progress-error").hidden);
    assert.equal(await warned(), true); assert.match(await page.locator("#progress-error").innerText(), /full page refresh.*lose the unsaved draft/i);
    await page.locator("#progress-reload").click(); assert.equal(await warned(), true, "local-record reload preserves the pending warning");
    await fields(page, {"progress-fill-qty": 1}); await page.locator("#progress-fill-save").click();
    await page.waitForFunction(() => !document.getElementById("progress-use").disabled); assert.equal(await warned(), false, "correctly saved entry clears the warning");
  });
  test("mobile collapsed and expanded opt-in are readable and have no overflow", async t => {
    const page = await open(t, {mobile: true}); await screenshot(page, "progress-mobile-collapsed.png");
    await expand(page); await create(page); await screenshot(page, "progress-mobile-expanded.png");
    await page.locator("#progress-use").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#progress-use").evaluate(node => {const r = node.getBoundingClientRect(); return r.width > 40 && r.height >= 44 && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));}), true);
    t.diagnostic(`Synthetic-only screenshots: ${artifacts}`);
  });
}
