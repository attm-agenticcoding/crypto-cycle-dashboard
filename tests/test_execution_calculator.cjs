"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const core = require("../execution/execution-core.js"), calendar = require("../execution/market-calendar.js");
const listed = {market_calendar: "XNYS", trade_side: "buy", first_offset_pct: .25, spacing_pct: .95,
  lookback_sessions: 10, expected_rungs_per_session: 1.7};
const base = {weekly: 10000, total: null, reference: 35, weekSessions: 5, horizon: null, params: listed};
const quantity = plan => plan.orders.reduce((sum, order) => sum + order.shares, 0);

// Synthetic touch counts exercise the audited 1.7 / 2.3 sizing cases.
// No archived market observations or experiment receipts are test inputs.
const BTC = [1,1,1,1,2,2,2,2,2,3];
const ETH = [1,1,2,2,2,2,3,3,3,4];
const samples = (counts, first = .25, spacing = .95) => counts.map((count, index) => ({
  drawdown_pct: first + (count - 1) * spacing + .01, next_reference_return_pct: index === counts.length - 1 ? null : 0}));

test("ETF buy touches include the latest complete excursion without a future reference label", () => {
  const btc = core.buyPlan({...base, params: {...listed, session_samples: samples(BTC)}});
  assert.equal(btc.hits, 1.7); assert.equal(btc.perRung, 34);
  const eth = core.buyPlan({...base, reference: 23.32, params: {...listed, first_offset_pct: .3, spacing_pct: .8, session_samples: samples(ETH, .3, .8)}});
  assert.equal(eth.hits, 2.3); assert.equal(eth.perRung, 38);
  assert.equal(core.expectedHits({...listed, session_samples: [{drawdown_pct: null}, ...samples(BTC), {runup_pct: 99}]}, "buy", .0025, .0095), 1.7);
  assert.equal(core.buyPlan({...base, params: {...listed, session_samples: samples(BTC).map(row => ({...row, next_reference_return_pct: undefined}))}}).hits, 1.7);
});

test("blank and zero totals are distinct with or without a deadline", () => {
  for (const horizon of [null, 5]) {
    for (const total of [null, undefined, ""]) assert.ok(quantity(core.buyPlan({...base, total, horizon})) > 0);
    for (const total of [0, "0"]) {
      const plan = core.buyPlan({...base, total, horizon});
      assert.equal(plan.controller.weekly, 0); assert.equal(plan.perRung, 0); assert.equal(quantity(plan), 0);
    }
  }
});

test("zero weekly pace catches up only with an explicit deadline and total", () => {
  const due = core.buyPlan({...base, weekly: 0, total: 10000, horizon: 5});
  assert.equal(due.controller.weekly, 10000); assert.equal(due.controller.enabled, true); assert.ok(due.orders.length > 0);
  const patient = core.buyPlan({...base, weekly: 0, total: 10000});
  assert.equal(patient.controller.weekly, 0); assert.equal(patient.controller.enabled, false); assert.equal(patient.orders.length, 0);
});

test("no deadline never creates a hidden horizon or schedule floor", () => {
  for (const horizon of [undefined, null, ""]) for (const total of [null, 0, 50, 1000]) {
    const c = core.sellPace(100, total, 5, horizon);
    assert.equal(c.hasDeadline, false); assert.equal(c.enabled, false);
    assert.equal(c.scheduleFloor, 0); assert.equal(c.factor, 1); assert.equal(c.paceSessions, 5);
    assert.equal(c.weekly, total === null ? 100 : Math.min(100, total));
  }
});

test("same weekly pace and optional total semantics apply to all four order paths", () => {
  const crypto = {market_calendar: "24X7", first_offset_pct: .25, spacing_pct: .8,
    lookback_sessions: 10, expected_rungs_per_session: 1.2, quantity_step: .00001, price_tick: .01,
    min_quantity: .00001, min_notional: 5, min_price: .01, max_price: 1000000};
  for (const instrument of [listed, crypto]) for (const side of ["buy", "sell"]) for (const total of [null, 0, 50, 1000]) {
    const args = {...base, weekly: 100, total, held: 2000, reserved: 0, params: {...instrument, trade_side: side}};
    const plan = side === "buy" ? core.buyPlan(args) : core.sellPlan(args);
    assert.equal(plan.controller.hasDeadline, false); assert.equal(plan.controller.enabled, false); assert.equal(plan.controller.factor, 1);
    assert.equal(plan.controller.weekly, total === null ? 100 : Math.min(100, total));
    if (total === 0) assert.equal(plan.orders.length, 0);
  }
});

test("listed rung cap reports allocated and unallocated quantities explicitly", () => {
  const plan = core.listedBuyOrders(60000, 100, 5, .0025, .0005, 12);
  assert.equal(plan.targetShares, 600); assert.equal(plan.perRung, 10); assert.equal(plan.orders.length, 30);
  assert.equal(plan.orderQuantity, 300); assert.equal(plan.unallocated, 300); assert.equal(plan.rungCapReached, true);
  assert.equal(plan.orderQuantity + plan.unallocated, plan.targetShares);
});

test("listed budgets and exact residual accounting remain bounded across input scales", () => {
  for (const weekly of [0, .1, 1, 35, 999, 10000, 60000]) for (const reference of [.01, 23.32, 35, 100, 1000]) for (const hits of [.1, 1.7, 12]) {
    const plan = core.listedBuyOrders(weekly, reference, 5, .0025, .0095, hits);
    assert.equal(quantity(plan), plan.orderQuantity);
    assert.equal(plan.orderQuantity + plan.unallocated, plan.targetShares);
    assert.ok(plan.orders.length <= 30); assert.ok(quantity(plan) <= Math.floor(weekly / reference));
    assert.ok(plan.orders.reduce((sum, x) => sum + x.notional, 0) <= weekly + 1e-8);
    assert.ok(plan.orders.every(order => Number.isInteger(order.shares) && order.shares > 0));
  }
});

test("invalid nonempty inputs fail rather than falling back to a different intention", () => {
  for (const weekly of [-1, NaN, Infinity, ""]) assert.throws(() => core.buyPlan({...base, weekly}), /finite/);
  for (const total of [-1, "invalid", Infinity]) assert.throws(() => core.buyPlan({...base, total}), /finite/);
  for (const horizon of [0, -1, Infinity, NaN]) assert.throws(() => core.buyPlan({...base, horizon}), /sessions/);
  for (const weekSessions of [0, -1, NaN]) assert.throws(() => core.buyPlan({...base, weekSessions}), /sessions/);
});

test("page delegates buy sizing and pacing to the identical shared core", () => {
  const html = fs.readFileSync(require.resolve("../execution/index.html"), "utf8"), context = {ExecutionCore: core};
  for (const name of ["optimizeDeadline", "buildOrders"]) {
    const source = html.match(new RegExp(`    function ${name}\\([^]*?(?=    function )`))[0];
    vm.runInNewContext(source + `; result = ${name};`, context);
    for (const total of [null, "", 0, 100, 10000]) for (const horizon of [null, 1, 5, 30]) {
      const args = name === "optimizeDeadline" ? [100, total, 5, horizon] : [10000, 35, 5, .0025, .0095, 1.7];
      const expected = name === "optimizeDeadline" ? core.sellPace(...args) : core.listedBuyOrders(...args);
      assert.deepEqual(context.result(...args), expected);
    }
  }
  assert.match(html, /ExecutionCore\.buyPlan\(/);
  assert.match(html, /const values = id => document.getElementById\(id\).value/);
  assert.doesNotMatch(html, /id="deadline"[^>]*value=/);
});

test("closeout rejects unsupported calendars and honors last actual holiday session", () => {
  const at = (date, hour, minute) => ({date: new Date(date + "T00:00:00Z"), hour, minute});
  assert.throws(() => core.sellCloseoutState(new Date("2029-01-01"), at("2026-10-05", 10, 0), calendar.isSession), /calendar range/);
  const state = core.sellCloseoutState(new Date("2026-12-25"), at("2026-12-24", 12, 45), calendar.isSession);
  assert.equal(state.finalDate, "2026-12-24"); assert.equal(state.closeMinutes, 780); assert.equal(state.due, true);
  const full = core.sellCloseoutState(new Date("2027-12-31"), at("2027-12-31", 15, 45), calendar.isSession);
  assert.equal(full.closeMinutes, 960); assert.equal(full.due, true);
});
