const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../execution/execution-core.js");

const sell = {
  trade_side: "sell", first_offset_pct: .25, spacing_pct: .8,
  lookback_sessions: 10, expected_rungs_per_session: 1.2,
  session_samples: []
};
const base = { weekly: 500, total: null, held: 2000, reserved: 0, reference: 35, weekSessions: 2, horizon: 20, params: sell };
const sum = plan => plan.orders.reduce((quantity, order) => quantity + order.shares, 0);

test("sell parameters never fall back to a legacy buy model", () => {
  const legacy = { ...sell, trade_side: "buy", instrument_id: "ARCX:BTC" };
  assert.equal(core.parametersReady(core.sideParameters(legacy, "sell")), false);
  assert.equal(core.parametersReady(core.sideParameters(legacy, "buy")), true);
  assert.equal(core.parametersReady(core.sideParameters({ ...legacy, sides: { buy: legacy } }, "sell")), false);
  const v3 = { ...legacy, sides: { buy: legacy, sell: { ...sell, spacing_pct: .6 } } };
  assert.equal(core.sideParameters(v3, "sell").spacing_pct, .6);
  assert.equal(core.sideParameters(v3, "buy").spacing_pct, .8);
  assert.equal(core.parametersReady({ ...sell, spacing_pct: null }), false);
});

test("passive sell ladder rounds prices up and trims final rung", () => {
  const plan = core.sellPlan(base);
  assert.equal(plan.perRung, 209);
  assert.deepEqual(plan.orders.map(order => order.shares), [209, 209, 82]);
  assert.deepEqual(plan.orders.map(order => order.price), [35.09, 35.37, 35.65]);
  assert.equal(sum(plan), 500);
});

test("all outstanding shares stay inside both sale target and inventory", () => {
  for (const weekly of [0, .9, 12, 100, 1000]) for (const held of [0, 25.3, 800]) for (const reserved of [0, 4.8, 25]) {
    if (reserved > held) continue;
    const plan = core.sellPlan({ ...base, weekly, held, reserved });
    assert.ok(sum(plan) <= Math.max(0, held - reserved));
    assert.ok(sum(plan) <= Math.max(0, weekly - reserved));
    assert.equal(sum(plan), plan.targetShares);
  }
  assert.equal(core.sellPlan({ ...base, held: 300, reserved: 120 }).targetShares, 180);
  assert.equal(core.sellPlan({ ...base, reserved: 500 }).orders.length, 0);
  assert.equal(core.sellPlan({ ...base, total: 0 }).orders.length, 0);
  assert.throws(() => core.sellPlan({ ...base, reserved: 2100 }), /exceed/);
  assert.throws(() => core.sellPlan({ ...base, held: NaN }), /finite/);
  assert.throws(() => core.sellPlan({ ...base, params: { ...sell, trade_side: "buy" } }), /sell scaling/);
  const deep = core.sellPlan({ ...base, weekly: 600, weekSessions: 5, params: { ...sell, expected_rungs_per_session: 12 } });
  assert.equal(sum(deep), 600);
});

test("closer deadlines increase the share floor without widening sell limits", () => {
  const far = core.sellPlan({ ...base, weekly: 100, total: 1000, horizon: 20 });
  const near = core.sellPlan({ ...base, weekly: 100, total: 1000, horizon: 2 });
  assert.equal(far.targetShares, 100);
  assert.equal(near.targetShares, 1000);
  assert.ok(near.first < far.first);
  assert.ok(near.spacing < far.spacing);
  assert.equal(core.sellPlan({ ...base, weekly: 0, total: 1000, horizon: 2 }).targetShares, 1000);
});

test("sell expected hits include the latest runup even without a next reference", () => {
  const params = { ...sell, lookback_sessions: 2, session_samples: [
    { drawdown_pct: 8, runup_pct: 0, next_reference_return_pct: .2 },
    { drawdown_pct: 0, runup_pct: 1.1, next_reference_return_pct: null }
  ] };
  assert.equal(core.sellExpectedHits(params, .0025, .008), 1);
});

test("deadline closeout uses fresh bid and the inventory reservation cap", () => {
  const plan = core.sellPlan({ ...base, total: 600, horizon: 1, reserved: 150, held: 550, closeout: true, bid: 34.237 });
  assert.equal(plan.orders.length, 1);
  assert.equal(plan.orders[0].price, 34.23);
  assert.equal(plan.orders[0].shares, 400);
  assert.throws(() => core.sellPlan({ ...base, closeout: true }), /best bid/);
});

test("closeout follows the last session, including half days and the closing cutoff", () => {
  const weekday = day => day.getUTCDay() > 0 && day.getUTCDay() < 6;
  const at = (date, hour, minute) => ({ date: new Date(date + "T00:00:00Z"), hour, minute });
  const deadline = new Date("2026-09-13T00:00:00Z");
  assert.equal(core.sellCloseoutState(deadline, at("2026-09-11", 15, 44), weekday).due, false);
  assert.equal(core.sellCloseoutState(deadline, at("2026-09-11", 15, 45), weekday).due, true);
  assert.equal(core.sellCloseoutState(deadline, at("2026-09-11", 16, 0), weekday).expired, true);
  const holiday = new Date("2026-11-29T00:00:00Z");
  const early = core.sellCloseoutState(holiday, at("2026-11-27", 12, 45), weekday);
  assert.equal(early.finalDate, "2026-11-27");
  assert.equal(early.due, true);
  assert.equal(early.closeMinutes, 780);
  assert.equal(core.sellCloseoutState(holiday, at("2026-11-27", 13, 0), weekday).expired, true);
});

const crypto = { ...sell, market_calendar: "24X7", timezone: "UTC", base_asset: "BTC", currency: "USDT",
  quantity_step: .00001, price_tick: .01, min_quantity: .00001, max_quantity: 9000,
  min_notional: 5, max_notional: 9000000, min_price: .01, max_price: 1000000 };

test("crypto buy uses fractional asset amounts, quote budgets, and valid filters", () => {
  const plan = core.cryptoPlan({ weekly: 10000.73, total: null, reference: 100000, weekSessions: 7, horizon: 30, params: { ...crypto, trade_side: "buy" } });
  assert.ok(plan.orderQuantity > 0 && plan.orderQuantity <= .1000073);
  assert.ok(plan.orders.reduce((sum, order) => sum + order.notional, 0) <= 10000.73);
  for (const order of plan.orders) {
    assert.ok(order.price < 100000);
    assert.ok(order.notional >= 5);
    assert.equal(core.quantize(order.shares, crypto.quantity_step), order.shares);
    assert.equal(core.quantize(order.price, crypto.price_tick), order.price);
  }
});

test("fractional crypto sell targets tighten correctly and never exceed free inventory", () => {
  const plan = core.sellPlan({ ...base, reference: 100000, weekly: .01, total: .1, held: .07543, reserved: .015, weekSessions: 2, horizon: 2, params: crypto });
  assert.equal(plan.controller.lift, 10);
  assert.ok(plan.controller.factor < 1);
  assert.ok(plan.orderQuantity <= .06043 + 1e-12);
  assert.ok(Math.abs(sum(plan) - plan.orderQuantity) < 1e-12);
  assert.ok(plan.orders.every(order => order.price >= 100000 * (1 + .0025 * plan.controller.factor)));
  assert.equal(core.quantityText(.00001, .00001), "0.00001");
});

test("minimum order dust is not rounded up beyond a budget or holding", () => {
  const buy = core.cryptoPlan({weekly: 2, reference: 100000, weekSessions: 7, horizon: 30, params: {...crypto, trade_side: "buy"}});
  assert.equal(buy.orders.length, 0);
  assert.ok(buy.unallocated > 0);
  const sell = core.cryptoPlan({weekly: .00002, held: .00002, reference: 100000, weekSessions: 7, horizon: 30, params: crypto});
  assert.equal(sell.orders.length, 0);
  const smallPrice = {...crypto, base_asset: "TEST", price_tick: .00000001, quantity_step: .1, min_quantity: .1, min_price: .00000001, min_notional: .00001};
  const tiny = core.cryptoPlan({weekly: 1000, held: 1000, reference: .00001237, weekSessions: 2, horizon: 10, params: smallPrice});
  assert.ok(tiny.orders.length > 0);
  assert.ok(tiny.orders.every(order => order.price > .00001237));
  assert.ok(tiny.orderQuantity <= 1000);
});

test("crypto calendar uses UTC weekends and a midnight closeout, not 16:00 ET", () => {
  const fridayEveningNY = new Date("2026-09-12T01:00:00Z");
  const parts = core.calendarParts(crypto, fridayEveningNY);
  assert.equal(parts.date.toISOString().slice(0, 10), "2026-09-12");
  assert.equal(core.cryptoRemainingDays(parts), 2);
  const sunday = new Date("2026-09-13T00:00:00Z");
  assert.equal(core.cryptoRemainingDays(parts, sunday), 2);
  const state = core.sellCloseoutState(sunday, {date: sunday, hour: 23, minute: 45}, () => false, "24X7");
  assert.equal(state.finalDate, "2026-09-13");
  assert.equal(state.due, true);
  assert.equal(state.closeMinutes, 1440);
});
