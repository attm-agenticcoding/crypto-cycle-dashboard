"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const ledger = require("../execution/task-ledger.js");

// Synthetic values only. Neither a user account nor archived market data is
// loaded. The ledger is explicitly opted into and cannot execute any order.
const start = "2026-10-07T12:00:00Z", monday = "2026-10-12T12:00:00Z";
const make = (overrides = {}) => ledger.createTask({instrumentId: "SYNTH:TEST", side: "buy", accountId: "synthetic-local",
  marketCalendar: "24X7", totalRemaining: 1000, weeklyRemaining: 300, at: start, ...overrides});
let serial = 0;
const change = (method, state, data = {}, at = start) => ledger[method](state, {eventId: `event-${++serial}`, at, expectedRevision: state.revision, ...data});
const fill = (state, quantity, price, extra = {}, at = start) => change("recordFill", state, {tradeId: `trade-${++serial}`, quantity, price, ...extra}, at);
const snap = (state, at = start) => ledger.snapshot(state, at);
const clone = state => JSON.parse(ledger.serialize(state));

test("explicit opt-in starts from residual inputs with zero recorded basis", () => {
  const state = make(), view = snap(state);
  assert.equal(state.revision, 0);
  assert.equal(view.metric, "cash");
  assert.equal(view.totalRemaining, 1000);
  assert.equal(view.weeklyRemaining, 300);
  assert.equal(view.totalFilled, 0);
  assert.equal(view.recordedQuantity, 0);
  assert.equal(view.recordedNotional, 0);
  assert.equal(view.averageFillPrice, null);
  assert.equal(view.progressFraction, 0);
  assert.equal(view.completed, false);
  assert.equal(view.planningCapacity, 300);
  assert.equal(view.needsWeekConfirmation, false);
  assert.equal(snap(make({totalRemaining: 0})).averageFillPrice, null);
  assert.equal(snap(make({totalRemaining: 0})).planningCapacity, 0);
  for (const totalRemaining of ["", undefined, null, "100", -1, Infinity, NaN]) assert.throws(() => make({totalRemaining}), /finite/);
  for (const weeklyRemaining of ["", null, -1, Infinity, NaN]) assert.throws(() => make({weeklyRemaining}), /finite/);
});

test("task identity separates instrument, side and account", () => {
  const variants = [make(), make({instrumentId: "SYNTH:OTHER"}), make({side: "sell"}), make({accountId: "another-local"})];
  assert.equal(new Set(variants.map(state => state.key)).size, 4);
  for (const extra of [{instrumentId: "wrong"}, {side: "sell"}, {accountId: "wrong"}])
    assert.throws(() => fill(variants[0], 1, 10, extra), /does not match/);
  for (const extra of [{instrumentId: " "}, {side: "short"}, {accountId: ""}, {marketCalendar: "UTC"}]) assert.throws(() => make(extra));
});

test("Wednesday start uses only that week's remaining input, never an inferred full quota", () => {
  const state = fill(make({weeklyRemaining: 125}), 1, 25);
  assert.equal(snap(state).weeklyCap, 125);
  assert.equal(snap(state).weeklyRemaining, 100);
  assert.equal(snap(state).totalRemaining, 975);
  assert.throws(() => change("beginWeek", state, {weeklyCap: 300}), /already confirmed/);
  const future = snap(state, monday);
  assert.equal(future.weeklyCap, null);
  assert.equal(future.weeklyRemaining, null);
  assert.equal(future.needsWeekConfirmation, true);
  assert.equal(future.freeWeekly, 0);
  assert.equal(future.planningCapacity, 0);
  assert.equal(future.totalFilled, 25);
  assert.equal(future.totalRemaining, 975);
  const actual = change("recordWorkingOrder", state, {orderId: "already-working", quantity: 1, limitPrice: 10}, monday);
  assert.equal(snap(actual, monday).reservedCash, 10);
  assert.equal(snap(actual, monday).planningBlocked, true);
  assert.equal(snap(actual, monday).planningCapacity, 0);
});

test("week keys use UTC for crypto and New York for listed instruments across DST", () => {
  const boundary = "2026-10-12T00:00:00Z";
  assert.equal(ledger.weekKey("24X7", boundary), "2026-10-12");
  assert.equal(ledger.weekKey("XNYS", boundary), "2026-10-05");
  assert.equal(ledger.weekKey("XNYS", "2026-10-12T03:59:59Z"), "2026-10-05");
  assert.equal(ledger.weekKey("XNYS", "2026-10-12T04:00:00Z"), "2026-10-12");
  assert.equal(ledger.weekKey("XNYS", "2026-11-02T04:59:59Z"), "2026-10-26");
  assert.equal(ledger.weekKey("XNYS", "2026-11-02T05:00:00Z"), "2026-11-02");
  assert.equal(ledger.weekKey("XNYS", "2026-03-09T03:59:59Z"), "2026-03-02");
  assert.equal(ledger.weekKey("XNYS", "2026-03-09T04:00:00Z"), "2026-03-09");
  assert.equal(ledger.weekKey("24X7", "2027-01-01T00:00:00Z"), "2026-12-28");
  assert.throws(() => ledger.weekKey("XNYS", "2026-02-30T00:00:00Z"), /valid UTC/);
});

test("buy reservations consume cash at limit price without pretending to be fills", () => {
  const original = make(), state = change("addOrder", original, {orderId: "buy-1", quantity: 2, limitPrice: 100});
  const view = snap(state);
  assert.equal(view.totalFilled, 0);
  assert.equal(view.averageFillPrice, null);
  assert.equal(view.reservedCash, 200);
  assert.equal(view.reservedQuantity, 2);
  assert.equal(view.freeTotal, 800);
  assert.equal(view.freeWeekly, 100);
  assert.equal(view.planningCapacity, 100);
  assert.equal(snap(original).reservedCash, 0);
  const overWeekly = snap(change("recordWorkingOrder", state, {orderId: "already-working-over-week", quantity: 2, limitPrice: 60}));
  assert.equal(overWeekly.reservedCash, 320);
  assert.equal(overWeekly.reservationOverWeekly, true);
  assert.equal(overWeekly.planningBlocked, true);
  assert.equal(overWeekly.planningCapacity, 0);
  const overTotal = snap(change("recordWorkingOrder", make({totalRemaining: 90}), {orderId: "already-working-over-total", quantity: 1, limitPrice: 100}));
  assert.equal(overTotal.reservedCash, 100);
  assert.equal(overTotal.reservationOverTotal, true);
  assert.equal(overTotal.planningBlocked, true);
  assert.equal(overTotal.planningCapacity, 0);
});

test("partial fill, cancel request, racing fill, and cancellation preserve exact actual progress", () => {
  let state = change("addOrder", make(), {orderId: "buy-1", quantity: 3, limitPrice: 100});
  state = fill(state, 1, 90, {orderId: "buy-1"});
  assert.equal(snap(state).weeklyRemaining, 210);
  assert.equal(snap(state).reservedCash, 200);
  assert.equal(snap(state).freeWeekly, 10); // Better fill releases 10 of limit reservation.
  state = change("requestCancel", state, {orderId: "buy-1"});
  assert.equal(snap(state).orders[0].status, "cancel-pending");
  assert.equal(snap(state).reservedCash, 200);
  state = fill(state, 0.5, 96, {orderId: "buy-1"});
  assert.equal(snap(state).reservedCash, 150);
  state = change("confirmCancel", state, {orderId: "buy-1"});
  const view = snap(state);
  assert.equal(view.orders[0].status, "cancelled");
  assert.equal(view.orders[0].filledQuantity, 1.5);
  assert.equal(view.orders[0].remainingQuantity, 1.5);
  assert.equal(view.recordedNotional, 138);
  assert.equal(view.averageFillPrice, 92);
  assert.equal(view.totalRemaining, 862);
  assert.equal(view.weeklyRemaining, 162);
  assert.equal(view.reservedCash, 0);
  assert.equal(view.freeWeekly, 162);
});

test("already-working exposure is recorded above both caps for buy and sell, including replay", () => {
  for (const side of ["buy", "sell"]) {
    const quantity = side === "buy" ? 15 : 1500;
    let state = change("recordWorkingOrder", make({side}), {orderId: "actual-overcommitment", quantity, limitPrice: 100});
    const view = snap(state);
    assert.equal(view.reservedMetric, 1500);
    assert.equal(view.reservationOverTotal, true);
    assert.equal(view.reservationOverWeekly, true);
    assert.equal(view.totalFilled, 0);
    assert.equal(view.planningCapacity, 0);
    assert.equal(view.planningBlocked, true);
    assert.deepEqual(snap(ledger.decode(ledger.serialize(state))), view);
    state = change("requestCancel", state, {orderId: "actual-overcommitment"});
    assert.equal(snap(state).reservedMetric, 1500);
    state = change("confirmCancel", state, {orderId: "actual-overcommitment"});
    assert.equal(snap(state).reservedMetric, 0);
    assert.equal(snap(state).planningCapacity, 300);
    assert.equal(snap(state).totalFilled, 0);
  }
  const initial = make(), input = {eventId: "reported", orderId: "reported-order", quantity: 15, limitPrice: 100, at: start, expectedRevision: 0};
  assert.deepEqual(ledger.recordWorkingOrder(initial, input), ledger.addOrder(initial, input));
});

test("pending-cancel reservations survive rollover and reduce the explicitly confirmed new cap", () => {
  let state = change("addOrder", make(), {orderId: "carry", quantity: 2, limitPrice: 100});
  state = fill(state, 1, 80, {orderId: "carry"});
  state = change("requestCancel", state, {orderId: "carry"});
  const before = snap(state, monday);
  assert.equal(before.totalRemaining, 920);
  assert.equal(before.reservedCash, 100);
  assert.equal(before.orders[0].status, "cancel-pending");
  state = change("beginWeek", state, {weeklyCap: 150}, monday);
  const after = snap(state, monday);
  assert.equal(after.totalFilled, 80);
  assert.equal(after.weeklyFilled, 0);
  assert.equal(after.weeklyRemaining, 150);
  assert.equal(after.freeWeekly, 50);
  assert.equal(after.freeTotal, 820);
  state = fill(state, 0.5, 90, {orderId: "carry"}, monday);
  assert.equal(snap(state, monday).weeklyFilled, 45);
  assert.equal(snap(state, monday).reservedCash, 50);
  assert.equal(snap(state, monday).freeWeekly, 55);
  assert.equal(snap(state, "2026-10-19T12:00:00Z").needsWeekConfirmation, true);
});

test("carried reservations larger than the new cap are preserved and block new planning", () => {
  let state = change("addOrder", make(), {orderId: "carry", quantity: 2, limitPrice: 100});
  state = change("beginWeek", state, {weeklyCap: 50}, monday);
  assert.equal(snap(state, monday).reservationOverWeekly, true);
  assert.equal(snap(state, monday).reservedCash, 200);
  assert.equal(snap(state, monday).planningCapacity, 0);
  state = change("confirmCancel", state, {orderId: "carry"}, monday);
  assert.equal(snap(state, monday).planningCapacity, 50);
  assert.equal(snap(state, monday).totalFilled, 0);
});

test("actual fills before a new week's confirmation are charged against its explicit cap", () => {
  let state = fill(make(), 1, 40, {}, monday);
  assert.equal(snap(state, monday).needsWeekConfirmation, true);
  assert.equal(snap(state, monday).weeklyFilled, 40);
  state = change("beginWeek", state, {weeklyCap: 100}, monday);
  assert.equal(snap(state, monday).weeklyRemaining, 60);
  assert.equal(snap(state, monday).totalRemaining, 960);
  assert.throws(() => change("beginWeek", make(), {weeklyCap: 100, weekKey: "2026-10-19"}, monday), /does not match/);
});

test("unlinked actual fills may exceed budget and weekly cap; truth remains recorded", () => {
  let state = fill(make({totalRemaining: 200, weeklyRemaining: 100}), 3, 100);
  let view = snap(state);
  assert.equal(view.totalFilled, 300);
  assert.equal(view.recordedQuantity, 3);
  assert.equal(view.averageFillPrice, 100);
  assert.equal(view.totalRemaining, 0);
  assert.equal(view.weeklyRemaining, 0);
  assert.equal(view.breaches.total, true);
  assert.equal(view.breaches.weekly, true);
  assert.equal(view.weeklyBreaches[0].excess, 200);
  assert.equal(view.planningCapacity, 0);
  state = change("recordWorkingOrder", state, {orderId: "actual-exposure", quantity: 1, limitPrice: 1});
  assert.equal(snap(state).reservedCash, 1);
  assert.equal(snap(state).planningBlocked, true);
  state = fill(state, 1, 110); // Real execution continues to be recordable.
  assert.equal(snap(state).totalFilled, 410);
  state = change("beginWeek", state, {weeklyCap: 500}, monday);
  view = snap(state, monday);
  assert.equal(view.breaches.weekly, true);
  assert.equal(view.weeklyFilled, 0);
  assert.equal(view.planningCapacity, 0);
});

test("external fills do not silently release existing order reservations", () => {
  let state = change("addOrder", make(), {orderId: "working", quantity: 3, limitPrice: 100});
  state = fill(state, 1, 50);
  assert.equal(snap(state).reservedCash, 300);
  assert.equal(snap(state).reservationOverWeekly, true);
  assert.equal(snap(state).breaches.weekly, false);
  state = change("confirmCancel", state, {orderId: "working"});
  assert.equal(snap(state).freeWeekly, 250);
});

test("sell progress and reservations are units; weighted price uses only recorded quantities", () => {
  let state = make({side: "sell", totalRemaining: 10, weeklyRemaining: 4});
  state = change("addOrder", state, {orderId: "sell-1", quantity: 3, limitPrice: 100});
  assert.equal(snap(state).reservedMetric, 3);
  assert.equal(snap(state).freeWeekly, 1);
  state = fill(state, 1, 110, {orderId: "sell-1"});
  state = fill(state, 0.5, 80); // External execution may legitimately have another price.
  const view = snap(state);
  assert.equal(view.metric, "units");
  assert.equal(view.totalFilled, 1.5);
  assert.equal(view.totalRemaining, 8.5);
  assert.equal(view.weeklyRemaining, 2.5);
  assert.equal(view.recordedNotional, 150);
  assert.equal(view.averageFillPrice, 100);
  assert.equal(view.reservedMetric, 2);
  assert.equal(view.freeWeekly, .5);
  assert.equal(view.breaches.limitPrice, false);
});

test("duplicate events/trades are idempotent, but conflicting IDs and stale changes fail", () => {
  const initial = make();
  const data = {eventId: "fill-event", tradeId: "broker-trade", quantity: 1, price: 100, at: start, expectedRevision: 0};
  const state = ledger.recordFill(initial, data);
  assert.equal(ledger.recordFill(state, data), state); // Original retry revision is safe.
  assert.equal(ledger.recordFill(state, {...data, eventId: "another-event"}), state);
  assert.throws(() => ledger.recordFill(state, {...data, price: 101}), /Conflicting event/);
  assert.throws(() => ledger.recordFill(state, {...data, eventId: "another-event", quantity: 2}), /Conflicting trade/);
  assert.throws(() => ledger.addOrder(state, {eventId: "fill-event", orderId: "x", quantity: 1, limitPrice: 1, at: start, expectedRevision: 1}), /Conflicting event/);
  assert.throws(() => ledger.addOrder(state, {eventId: "new", orderId: "x", quantity: 1, limitPrice: 1, at: start, expectedRevision: 0}), /Stale/);
  assert.throws(() => ledger.addOrder(state, {eventId: "new", orderId: "x", quantity: 1, limitPrice: 1, at: start}), /expectedRevision/);
  assert.equal(snap(state).recordedQuantity, 1);
});

test("impossible linked fills are rejected while valid late pre-cancel executions survive", () => {
  let state = change("addOrder", make(), {orderId: "order", quantity: 2, limitPrice: 100});
  assert.throws(() => fill(state, 3, 90, {orderId: "order"}), /individual order/);
  assert.throws(() => fill(state, 1, 90, {orderId: "missing"}), /unknown order/);
  assert.throws(() => fill(state, 1, 90, {executedAt: "2026-10-06T12:00:00Z"}), /tracking period/);
  assert.throws(() => fill(state, 1, 90, {executedAt: "2026-10-08T12:00:00Z"}), /no later/);
  state = change("confirmCancel", state, {orderId: "order"}, "2026-10-07T13:00:00Z");
  assert.throws(() => fill(state, 1, 90, {orderId: "order"}, "2026-10-07T14:00:00Z"), /lifetime/);
  state = fill(state, 1, 90, {orderId: "order", executedAt: "2026-10-07T12:30:00Z"}, "2026-10-07T14:00:00Z");
  const view = snap(state, "2026-10-07T14:00:00Z");
  assert.equal(view.totalFilled, 90);
  assert.equal(view.orders[0].status, "cancelled");
  assert.equal(view.reservedCash, 0);
  assert.throws(() => fill(state, 2, 90, {orderId: "order", executedAt: "2026-10-07T12:30:00Z"}, "2026-10-07T14:00:00Z"), /individual order/);
});

test("late fill is attributed to its execution week and can expose an older cap breach", () => {
  let state = change("beginWeek", make({weeklyRemaining: 50}), {weeklyCap: 200}, monday);
  state = fill(state, 1, 100, {executedAt: start}, monday);
  const view = snap(state, monday);
  assert.equal(view.weeklyFilled, 0);
  assert.equal(view.weeklyRemaining, 200);
  assert.equal(view.totalFilled, 100);
  assert.equal(view.weeklyBreaches[0].weekKey, "2026-10-05");
  assert.equal(view.planningBlocked, true);
  assert.equal(snap(state).totalFilled, 0); // Known-as-of view does not backfill later reports.
});

test("actual linked price violations remain truthful and block further planning", () => {
  for (const side of ["buy", "sell"]) {
    let state = change("addOrder", make({side}), {orderId: "limit", quantity: 1, limitPrice: 100});
    state = fill(state, 1, side === "buy" ? 105 : 95, {orderId: "limit"});
    assert.equal(snap(state).recordedQuantity, 1);
    assert.equal(snap(state).averageFillPrice, side === "buy" ? 105 : 95);
    assert.equal(snap(state).breaches.limitPrice, true);
    assert.equal(snap(state).planningBlocked, true);
  }
});

test("deadline, expiry, time passing and touches never manufacture fills or completion", () => {
  let state = make({deadlineDate: "2026-10-08"});
  state = change("addOrder", state, {orderId: "still-working", quantity: 3, limitPrice: 100});
  const before = snap(state), expired = snap(state, "2026-10-09T20:00:00Z"), muchLater = snap(state, "2026-12-30T20:00:00Z");
  assert.equal(before.deadlinePassed, false);
  for (const view of [expired, muchLater]) {
    assert.equal(view.deadlinePassed, true);
    assert.equal(view.completed, false);
    assert.equal(view.totalFilled, 0);
    assert.equal(view.progressFraction, 0);
    assert.equal(view.reservedCash, 300);
    assert.equal(view.averageFillPrice, null);
  }
  assert.throws(() => fill(state, 1, 100, {priceTouched: true}), /unsupported/);
  assert.throws(() => make({historicalCostBasis: 10000}), /unsupported/);
  const complete = fill(make({totalRemaining: 100}), 1, 100);
  assert.equal(snap(complete).completed, true);
});

test("weekly zero remains a hard cap even with an imminent or expired deadline", () => {
  for (const deadlineDate of ["2026-10-07", "2026-10-06"]) {
    const state = make({weeklyRemaining: 0, deadlineDate});
    assert.equal(snap(state).planningCapacity, 0);
    const actual = change("recordWorkingOrder", state, {orderId: "already-working", quantity: 1, limitPrice: 1});
    assert.equal(snap(actual).reservedCash, 1);
    assert.equal(snap(actual).reservationOverWeekly, true);
    assert.equal(snap(actual).planningCapacity, 0);
  }
});

test("state and snapshots are deeply immutable, including historical as-of replay", () => {
  const initial = make();
  const state = fill(initial, 1, 100, {}, "2026-10-07T13:00:00Z");
  assert.throws(() => { state.events.push({}); }, TypeError);
  assert.throws(() => { state.events[0].price = 0; }, TypeError);
  assert.throws(() => { snap(state, "2026-10-07T13:00:00Z").fills[0].price = 0; }, TypeError);
  assert.equal(snap(initial).totalFilled, 0);
  assert.equal(snap(state).revision, 0);
  assert.equal(snap(state).totalFilled, 0);
  assert.equal(snap(state, "2026-10-07T13:00:00Z").totalFilled, 100);
  assert.throws(() => snap(state, "2026-10-06T13:00:00Z"), /precedes/);
  assert.throws(() => fill(state, 1, 100, {}, start), /precedes/);
});

test("serialize/decode round trip replays every saved invariant instead of trusting balances", () => {
  let state = change("addOrder", make(), {orderId: "order", quantity: 2, limitPrice: 100});
  state = fill(state, 1, 90, {orderId: "order"});
  state = change("requestCancel", state, {orderId: "order"});
  state = change("beginWeek", state, {weeklyCap: 200}, monday);
  const restored = ledger.decode(ledger.serialize(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(snap(restored, monday), snap(state, monday));
  assert.equal(Object.isFrozen(restored.events[0]), true);
  const corruptions = [
    raw => { raw.revision--; },
    raw => { raw.schemaVersion = 9; },
    raw => { raw.key = "different"; },
    raw => { raw.deadlineDate = ""; },
    raw => { raw.totalRemaining = 1e9; },
    raw => { raw.events[0].quantity = -1; },
    raw => { raw.events[1].quantity = 3; },
    raw => { raw.events[1].price = null; },
    raw => { raw.events[1].instrumentId = "SYNTH:WRONG"; },
    raw => { raw.events[1].type = "priceTouched"; },
    raw => { raw.events[3].weekKey = "2026-10-19"; },
    raw => { raw.events.push({...raw.events[1]}); raw.revision++; },
    raw => { raw.events.push({...raw.events[1], eventId: "same-trade-again", at: "2026-10-12T12:00:00.000Z"}); raw.revision++; },
    raw => { raw.events[0].at = "2026-10-09T12:00:00.000Z"; },
    raw => { raw.initialTotalRemaining = null; },
    raw => { delete raw.accountId; }
  ];
  for (const corrupt of corruptions) { const raw = clone(state); corrupt(raw); assert.throws(() => ledger.decode(raw)); }
  for (const malformed of ["{", "null", "[]", '"text"', "false", "42"]) assert.throws(() => ledger.decode(malformed));
  assert.throws(() => ledger.decode(" ".repeat(4 * 1024 * 1024 + 1)), /size limit/);
  const tooMany = clone(make()); tooMany.events = Array(10001).fill({}); tooMany.revision = 10001;
  assert.throws(() => ledger.decode(tooMany), /event list/);
  const overflow = clone(make());
  overflow.events = ["one", "two"].map(orderId => ({eventId: orderId, type: "addOrder", at: "2026-10-07T12:00:00.000Z", orderId,
    quantity: Number.MAX_SAFE_INTEGER, limitPrice: 1}));
  overflow.events.push(...["one", "two"].map(orderId => ({eventId: `cancel-${orderId}`, type: "confirmCancel", at: "2026-10-07T12:00:00.000Z", orderId})));
  overflow.revision = overflow.events.length;
  assert.throws(() => ledger.decode(overflow), /Reserved quantity/); // Cannot hide invalid earlier exposure by later cancellations.
});

test("nonfinite, negative, zero-size, precision-overflow and malformed inputs fail closed", () => {
  const state = make();
  for (const quantity of [0, -1, NaN, Infinity, "1", null]) {
    assert.throws(() => fill(state, quantity, 10), /finite/);
    assert.throws(() => change("addOrder", state, {orderId: "bad", quantity, limitPrice: 10}), /finite/);
  }
  for (const price of [0, -1, NaN, Infinity, "1", null]) assert.throws(() => fill(state, 1, price), /finite/);
  assert.throws(() => fill(state, Number.MAX_SAFE_INTEGER, 2), /Notional/);
  assert.throws(() => fill(state, 1e-300, 1e-300), /precision/);
  assert.throws(() => make({at: "2026-02-30T12:00:00Z"}), /valid UTC/);
  assert.throws(() => make({at: "2026-10-07"}), /UTC/);
  assert.throws(() => make({deadlineDate: "2026-02-30"}), /Deadline/);
  assert.throws(() => fill(state, 1, 10, {tradeId: "x".repeat(257)}), /identifier/);
});

test("fractional synthetic paths conserve actual and reserved amounts under zero fees", () => {
  for (const side of ["buy", "sell"]) {
    let state = make({side, totalRemaining: side === "buy" ? 100 : 1, weeklyRemaining: side === "buy" ? 10 : .1});
    state = change("addOrder", state, {orderId: "fraction", quantity: .1, limitPrice: 100});
    for (let i = 0; i < 10; i++) state = fill(state, .01, side === "buy" ? 99 : 101, {orderId: "fraction"});
    const view = snap(state), filled = side === "buy" ? 9.9 : .1;
    assert.ok(Math.abs(view.totalFilled - filled) < 1e-12);
    assert.ok(Math.abs(view.totalRemaining + view.totalFilled - state.initialTotalRemaining) < 1e-12);
    assert.equal(view.reservedMetric, 0);
    assert.equal(view.orders[0].status, "filled");
    assert.equal(view.breaches.weekly, false);
    assert.ok(Math.abs(view.averageFillPrice - (side === "buy" ? 99 : 101)) < 1e-10);
    state = change("confirmCancel", state, {orderId: "fraction"}); // A racing acknowledgement changes no fills.
    assert.equal(snap(state).recordedQuantity, view.recordedQuantity);
  }
});

test("browser UMD exposes the same pure API without storage or network dependencies", () => {
  const context = vm.createContext({Intl, Date});
  vm.runInContext(fs.readFileSync(require.resolve("../execution/market-calendar.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require.resolve("../execution/task-ledger.js"), "utf8"), context);
  const value = vm.runInContext(`(() => {
    const state = ExecutionTaskLedger.createTask({instrumentId:'SYNTH:TEST', side:'buy', accountId:'synthetic-local', marketCalendar:'24X7', totalRemaining:1000, weeklyRemaining:300, at:'${start}'});
    return ExecutionTaskLedger.serialize(ExecutionTaskLedger.decode(ExecutionTaskLedger.serialize(state)));
  })()`, context);
  assert.equal(value, ledger.serialize(make()));
});
