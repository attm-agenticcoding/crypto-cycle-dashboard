/* Optional, local-only execution progress. No storage, orders, or market-data IO.
 * Amounts are explicitly supplied by the caller; fees are zero.
 * BUY progress is recorded cash spent, SELL progress is recorded units sold.
 * This is not whole-position accounting: no pre-tracking fills/cost basis exist.
 * Every mutation needs an eventId, at timestamp, and expectedRevision.
 * Initial weeklyRemaining is the residual from tracking start, never a recurring
 * quota. beginWeek explicitly confirms a new week's cap; that week's recorded
 * fills and ALL outstanding reservations consume it, including carried orders.
 * recordWorkingOrder (and compatibility alias addOrder) records ALREADY-WORKING
 * real exposure. It never submits or authorizes an order and never drops known
 * exposure for exceeding a cap. New calculator plans must separately obey
 * snapshot.planningBlocked and snapshot.planningCapacity.
 */
(function (root, factory) {
  const calendar = typeof module === "object" && module.exports ? require("./market-calendar.js") : root.ExecutionCalendar;
  const api = factory(calendar);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ExecutionTaskLedger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (calendar) {
  "use strict";
  const VERSION = 1, MAX_EVENTS = 10000, MAX_SERIALIZED_LENGTH = 4 * 1024 * 1024, trusted = new WeakMap();
  const fields = ["schemaVersion", "key", "instrumentId", "side", "accountId", "marketCalendar", "createdAt", "initialTotalRemaining", "initialWeeklyRemaining", "deadlineDate", "revision", "events"];
  const eventFields = {
    addOrder: ["orderId", "quantity", "limitPrice"],
    recordFill: ["tradeId", "orderId", "quantity", "price", "executedAt"],
    requestCancel: ["orderId"], confirmCancel: ["orderId"],
    beginWeek: ["weeklyCap", "weekKey"]
  };
  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  }
  function keys(value, allowed, label) {
    object(value, label);
    if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} has unsupported fields.`);
  }
  function exactKeys(value, expected, label) {
    keys(value, expected, label);
    if (Object.keys(value).length !== expected.length) fail(`${label} is missing required fields.`);
  }
  function id(value, label) {
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 256) fail(`${label} must be a nonempty identifier.`);
    return value;
  }
  function amount(value, label, positive = false) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (positive && value === 0))
      fail(`${label} must be a finite ${positive ? "positive" : "nonnegative"} number in the supported range.`);
    return value === 0 ? 0 : value;
  }
  function timestamp(value, label = "Timestamp") {
    const date = value instanceof Date ? value : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9998) fail(`${label} must be a valid UTC timestamp (1900–9998).`);
    const canonical = date.toISOString();
    // Date parsing otherwise silently normalizes dates such as February 30.
    if (typeof value === "string" && canonical.slice(0, 19) !== value.slice(0, 19)) fail(`${label} must be a valid UTC timestamp.`);
    return canonical;
  }
  function market(value) {
    if (!["24X7", "XNYS"].includes(value)) fail("marketCalendar must be 24X7 or XNYS.");
    return value;
  }
  function civilDate(marketCalendar, at) {
    if (!calendar || typeof calendar.calendarParts !== "function") fail("ExecutionCalendar is required.");
    return calendar.calendarParts({market_calendar: market(marketCalendar)}, new Date(timestamp(at))).date;
  }
  function weekKey(marketCalendar, at) {
    const date = civilDate(marketCalendar, at);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  }
  function freeze(value) {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  function sum(a, b, label) { return amount(a + b, label); }
  function product(a, b) {
    const result = amount(a * b, "Notional");
    if (a > 0 && b > 0 && result === 0) fail("Notional is below the supported precision range.");
    return result;
  }
  function tolerance(a, b) { return 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE); }
  function exceeds(a, b) { return a > b + tolerance(a, b); }
  function remainder(cap, used) { return exceeds(cap, used) ? cap - used : 0; }
  function taskKey(instrumentId, side, accountId) { return JSON.stringify([instrumentId, side, accountId]); }
  function initialModel(state) {
    return {orders: new Map(), trades: new Map(), eventIds: new Map(),
      weeks: new Map([[weekKey(state.marketCalendar, state.createdAt), state.initialWeeklyRemaining]]),
      fillsByWeek: new Map(), quantity: 0, notional: 0, lastAt: state.createdAt, limitPriceBreach: false};
  }
  function metric(state, quantity, price) { return state.side === "buy" ? product(quantity, price) : quantity; }
  function summarize(state, model, at) {
    const currentWeek = weekKey(state.marketCalendar, at), confirmed = model.weeks.has(currentWeek);
    const totalFilled = state.side === "buy" ? model.notional : model.quantity;
    const weeklyFilled = model.fillsByWeek.get(currentWeek) || 0;
    const weeklyCap = confirmed ? model.weeks.get(currentWeek) : null;
    const totalRemaining = remainder(state.initialTotalRemaining, totalFilled);
    const weeklyRemaining = confirmed ? remainder(weeklyCap, weeklyFilled) : null;
    let reservedQuantity = 0, reservedCash = 0;
    const orders = [...model.orders.values()].map(order => {
      const remainingQuantity = remainder(order.quantity, order.filledQuantity);
      const status = remainingQuantity === 0 ? "filled" : order.cancelledAt ? "cancelled" : order.cancelRequestedAt ? "cancel-pending" : "working";
      const reserved = status === "working" || status === "cancel-pending" ? remainingQuantity : 0;
      reservedQuantity = sum(reservedQuantity, reserved, "Reserved quantity");
      reservedCash = sum(reservedCash, product(reserved, order.limitPrice), "Reserved cash");
      return {...order, remainingQuantity, status, reservedQuantity: reserved,
        reservedMetric: metric(state, reserved, order.limitPrice)};
    });
    const reservedMetric = state.side === "buy" ? reservedCash : reservedQuantity;
    const weeklyBreaches = [...model.weeks].filter(([week, cap]) => exceeds(model.fillsByWeek.get(week) || 0, cap))
      .map(([week, cap]) => ({weekKey: week, cap, filled: model.fillsByWeek.get(week), excess: model.fillsByWeek.get(week) - cap}));
    const breaches = {total: exceeds(totalFilled, state.initialTotalRemaining), weekly: weeklyBreaches.length > 0,
      limitPrice: model.limitPriceBreach};
    const reservationOverTotal = exceeds(reservedMetric, totalRemaining);
    const reservationOverWeekly = confirmed && exceeds(reservedMetric, weeklyRemaining);
    const needsWeekConfirmation = !confirmed;
    const planningBlocked = needsWeekConfirmation || Object.values(breaches).some(Boolean) || reservationOverTotal || reservationOverWeekly;
    const freeTotal = planningBlocked ? 0 : remainder(totalRemaining, reservedMetric);
    const freeWeekly = planningBlocked ? 0 : remainder(weeklyRemaining, reservedMetric);
    const today = civilDate(state.marketCalendar, at).toISOString().slice(0, 10);
    return {
      key: state.key, revision: state.revision, asOf: at, instrumentId: state.instrumentId, side: state.side,
      accountId: state.accountId, metric: state.side === "buy" ? "cash" : "units", weekKey: currentWeek,
      initialTotalRemaining: state.initialTotalRemaining, totalFilled, totalRemaining,
      recordedQuantity: model.quantity, recordedNotional: model.notional,
      averageFillPrice: model.quantity > 0 ? model.notional / model.quantity : null,
      progressFraction: state.initialTotalRemaining > 0 ? Math.min(1, totalFilled / state.initialTotalRemaining) : null,
      completed: !exceeds(state.initialTotalRemaining, totalFilled),
      weeklyCap, weeklyFilled, weeklyRemaining, needsWeekConfirmation,
      reservedQuantity, reservedCash, reservedMetric, freeTotal, freeWeekly,
      planningCapacity: Math.min(freeTotal, freeWeekly), planningBlocked,
      breaches, weeklyBreaches, reservationOverTotal, reservationOverWeekly,
      deadlineDate: state.deadlineDate, deadlinePassed: !!state.deadlineDate && today > state.deadlineDate,
      orders, fills: [...model.trades.values()]
    };
  }
  function normalizeEvent(state, type, input) {
    if (!eventFields[type]) fail("Unknown ledger event type.");
    keys(input, ["eventId", "at", "expectedRevision", "instrumentId", "side", "accountId", ...eventFields[type]], "Event");
    for (const field of ["instrumentId", "side", "accountId"])
      if (input[field] !== undefined && input[field] !== state[field]) fail(`Event ${field} does not match this task.`);
    const event = {eventId: id(input.eventId, "Event ID"), type, at: timestamp(input.at)};
    if (["addOrder", "requestCancel", "confirmCancel"].includes(type)) event.orderId = id(input.orderId, "Order ID");
    if (type === "addOrder") {
      event.quantity = amount(input.quantity, "Order quantity", true);
      event.limitPrice = amount(input.limitPrice, "Limit price", true);
      product(event.quantity, event.limitPrice);
    } else if (type === "recordFill") {
      event.tradeId = id(input.tradeId, "Trade ID");
      event.orderId = input.orderId === undefined || input.orderId === null ? null : id(input.orderId, "Order ID");
      event.quantity = amount(input.quantity, "Fill quantity", true);
      event.price = amount(input.price, "Fill price", true);
      event.executedAt = timestamp(input.executedAt === undefined ? input.at : input.executedAt, "Fill execution time");
      product(event.quantity, event.price);
    } else if (type === "beginWeek") {
      event.weeklyCap = amount(input.weeklyCap, "Confirmed weekly cap");
      event.weekKey = weekKey(state.marketCalendar, event.at);
      if (input.weekKey !== undefined && input.weekKey !== event.weekKey) fail("Confirmed week does not match the timestamp.");
    }
    return event;
  }
  function sameFill(a, b) {
    return ["tradeId", "orderId", "quantity", "price", "executedAt"].every(field => a[field] === b[field]);
  }
  function duplicate(model, event) {
    const existing = model.eventIds.get(event.eventId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(event)) fail("Conflicting event ID.");
      return true;
    }
    if (event.type === "recordFill" && model.trades.has(event.tradeId)) {
      if (!sameFill(model.trades.get(event.tradeId), event)) fail("Conflicting trade ID.");
      return true;
    }
    return false;
  }
  function apply(state, model, event) {
    if (event.at < model.lastAt) fail("Event timestamp precedes the latest recorded event.");
    if (duplicate(model, event)) fail("Duplicate event in saved ledger.");
    const order = event.orderId ? model.orders.get(event.orderId) : null;
    if (event.type === "addOrder") {
      if (model.orders.has(event.orderId)) fail("Order ID already exists.");
      // This is a report of already-working exposure, not a new-order request.
      // Overcommitment and an unconfirmed week must not hide a real reservation.
      // summarize() blocks future planning while still preserving this record.
      const prior = summarize(state, model, event.at);
      sum(prior.reservedQuantity, event.quantity, "Reserved quantity");
      sum(prior.reservedCash, product(event.quantity, event.limitPrice), "Reserved cash");
      model.orders.set(event.orderId, {orderId: event.orderId, quantity: event.quantity, limitPrice: event.limitPrice,
        createdAt: event.at, filledQuantity: 0, filledNotional: 0, cancelRequestedAt: null, cancelledAt: null});
    } else if (event.type === "recordFill") {
      if (event.executedAt < state.createdAt || event.executedAt > event.at) fail("Fill execution time must be within the tracking period and no later than its report.");
      if (event.orderId !== null) {
        if (!order) fail("Fill references an unknown order; external fills must explicitly be unlinked.");
        if (event.executedAt < order.createdAt || (order.cancelledAt && event.executedAt > order.cancelledAt)) fail("Fill execution time is outside this order's lifetime.");
        const filled = sum(order.filledQuantity, event.quantity, "Order filled quantity");
        if (exceeds(filled, order.quantity)) fail("Fill exceeds the individual order quantity.");
        order.filledQuantity = filled;
        order.filledNotional = sum(order.filledNotional, product(event.quantity, event.price), "Order filled notional");
        if (state.side === "buy" ? exceeds(event.price, order.limitPrice) : exceeds(order.limitPrice, event.price)) model.limitPriceBreach = true;
      }
      model.quantity = sum(model.quantity, event.quantity, "Recorded quantity");
      model.notional = sum(model.notional, product(event.quantity, event.price), "Recorded notional");
      const week = weekKey(state.marketCalendar, event.executedAt);
      model.fillsByWeek.set(week, sum(model.fillsByWeek.get(week) || 0, metric(state, event.quantity, event.price), "Weekly fills"));
      model.trades.set(event.tradeId, {...event});
    } else if (event.type === "requestCancel" || event.type === "confirmCancel") {
      if (!order) fail("Unknown order ID.");
      if (order.cancelledAt || (event.type === "requestCancel" && remainder(order.quantity, order.filledQuantity) === 0)) fail("Order is already closed.");
      if (event.type === "requestCancel") {
        if (order.cancelRequestedAt) fail("Cancellation is already pending.");
        order.cancelRequestedAt = event.at;
      } else {
        // Explicit exchange/broker confirmation may be recorded without an
        // earlier locally recorded request. No clock/expiry inference is used.
        order.cancelledAt = event.at;
      }
    } else if (event.type === "beginWeek") {
      if (model.weeks.has(event.weekKey)) fail("This week's cap was already confirmed.");
      model.weeks.set(event.weekKey, event.weeklyCap);
    }
    model.eventIds.set(event.eventId, event);
    model.lastAt = event.at;
  }
  function createTask(input) {
    keys(input, ["instrumentId", "side", "accountId", "marketCalendar", "totalRemaining", "weeklyRemaining", "at", "deadlineDate"], "Task");
    const instrumentId = id(input.instrumentId, "Instrument ID"), accountId = id(input.accountId === undefined ? "local" : input.accountId, "Account ID");
    if (!["buy", "sell"].includes(input.side)) fail("Side must be buy or sell.");
    const deadlineDate = input.deadlineDate === undefined || input.deadlineDate === null || input.deadlineDate === "" ? null : input.deadlineDate;
    if (deadlineDate !== null && (typeof deadlineDate !== "string" || calendar.dateKey(deadlineDate) !== deadlineDate)) fail("Deadline must be a valid YYYY-MM-DD date.");
    const state = {schemaVersion: VERSION, key: taskKey(instrumentId, input.side, accountId), instrumentId, side: input.side, accountId,
      marketCalendar: market(input.marketCalendar), createdAt: timestamp(input.at),
      initialTotalRemaining: amount(input.totalRemaining, "Total remaining target"),
      initialWeeklyRemaining: amount(input.weeklyRemaining, "This week's remaining target"), deadlineDate, revision: 0, events: []};
    const model = initialModel(state);
    freeze(state); trusted.set(state, model); return state;
  }
  function decode(saved) {
    let raw;
    if (typeof saved === "string" && saved.length > MAX_SERIALIZED_LENGTH) fail("Saved ledger exceeds the local size limit.");
    try { raw = typeof saved === "string" ? JSON.parse(saved) : saved; } catch (_) { fail("Saved ledger is not valid JSON."); }
    if (raw && typeof raw === "object" && trusted.has(raw)) return raw;
    exactKeys(raw, fields, "Saved ledger");
    if (raw.schemaVersion !== VERSION) fail("Unsupported ledger schema version.");
    if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS || !Number.isSafeInteger(raw.revision) || raw.revision !== raw.events.length)
      fail("Saved ledger revision or event list is invalid.");
    const initial = createTask({instrumentId: raw.instrumentId, side: raw.side, accountId: raw.accountId, marketCalendar: raw.marketCalendar,
      totalRemaining: raw.initialTotalRemaining, weeklyRemaining: raw.initialWeeklyRemaining, at: raw.createdAt, deadlineDate: raw.deadlineDate});
    if (raw.key !== initial.key || raw.createdAt !== initial.createdAt || raw.deadlineDate !== initial.deadlineDate)
      fail("Saved ledger identity, timestamp or deadline is invalid.");
    const model = initialModel(initial), events = [];
    for (const rawEvent of raw.events) {
      object(rawEvent, "Saved event");
      if (!eventFields[rawEvent.type]) fail("Unknown saved event type.");
      exactKeys(rawEvent, ["eventId", "type", "at", ...eventFields[rawEvent.type]], "Saved event");
      const {type, ...input} = rawEvent, event = normalizeEvent(initial, type, input);
      if (Object.keys(event).some(key => event[key] !== rawEvent[key])) fail("Saved event is not canonical.");
      apply(initial, model, event); events.push(event);
    }
    const state = freeze({...initial, revision: events.length, events});
    if (JSON.stringify(state).length > MAX_SERIALIZED_LENGTH) fail("Saved ledger exceeds the local size limit.");
    // Verify aggregate arithmetic even if the last event was an external fill.
    summarize(state, model, model.lastAt);
    trusted.set(state, model); return state;
  }
  function mutate(state, type, input) {
    state = decode(state);
    const event = normalizeEvent(state, type, input), oldModel = trusted.get(state);
    // An exact retry is safe even with its original revision; conflicts are not.
    if (duplicate(oldModel, event)) return state;
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== state.revision) fail("Stale or missing expectedRevision; reload the task before editing.");
    if (state.events.length >= MAX_EVENTS) fail("Local ledger event limit reached.");
    // Replay into a new model. Never mutate any model attached to prior state.
    const model = initialModel(state);
    for (const previous of state.events) apply(state, model, previous);
    apply(state, model, event);
    const next = freeze({...state, revision: state.revision + 1, events: [...state.events, event]});
    if (JSON.stringify(next).length > MAX_SERIALIZED_LENGTH) fail("Local ledger size limit reached.");
    summarize(next, model, event.at);
    trusted.set(next, model); return next;
  }
  function snapshot(state, asOf) {
    state = decode(state);
    const at = timestamp(asOf);
    if (at < state.createdAt) fail("Snapshot precedes the tracking start.");
    let model = trusted.get(state), revision = state.revision;
    if (at < model.lastAt) {
      model = initialModel(state); revision = 0;
      for (const event of state.events) if (event.at <= at) { apply(state, model, event); revision++; }
    }
    return freeze({...summarize(state, model, at), revision});
  }
  return Object.freeze({schemaVersion: VERSION, weekKey, createTask, decode,
    serialize: state => JSON.stringify(decode(state)), snapshot,
    recordWorkingOrder: (state, input) => mutate(state, "addOrder", input),
    addOrder: (state, input) => mutate(state, "addOrder", input),
    recordFill: (state, input) => mutate(state, "recordFill", input),
    requestCancel: (state, input) => mutate(state, "requestCancel", input),
    confirmCancel: (state, input) => mutate(state, "confirmCancel", input),
    beginWeek: (state, input) => mutate(state, "beginWeek", input)});
});
