/* LOCAL RESEARCH ONLY. Pure planner and ledger; no network, credentials, or broker API. */
'use strict';
const calendar = require('./frozen/market-calendar.js');
const MINUTE = 60000, DAY = 86400000;
function finite(x, name, min = 0) { if (typeof x !== 'number' || !Number.isFinite(x) || x < min) throw Error(`${name} invalid`); return x; }
function timestamp(x, name = 'timestamp') { if (!Number.isSafeInteger(x)) throw Error(`${name} invalid`); return x; }
function lotFloor(q, step) { const n = Math.floor(q / step + 1e-9); if (!Number.isSafeInteger(n)) throw Error('quantity precision overflow'); return n; }
function lots(q, step) { finite(q, 'quantity'); const n = Math.round(q / step); if (!Number.isSafeInteger(n) || Math.abs(n * step - q) > step * 1e-7) throw Error('quantity not aligned to step'); return n; }
function roundPrice(p, tick, up) { finite(p, 'price', tick); const n = up ? Math.ceil(p / tick - 1e-9) : Math.floor(p / tick + 1e-9); if (!Number.isSafeInteger(n)) throw Error('price precision overflow'); return Number((n * tick).toPrecision(15)); }
function clone(x) { return structuredClone(x); }
function units(book, n) { return Number((n * book.rules.quantityStep).toPrecision(15)); }
function active(o) { return ['open', 'pending_cancel'].includes(o.status); }
function openOrders(book) { return Object.values(book.orders).filter(active); }
function signed(side) { return side === 'buy' ? 1 : -1; }
function residualLots(book) { return Math.abs(book.targetLots - book.positionLots); }
function reserves(book) {
  return openOrders(book).reduce((r, o) => {
    r.targetLots += o.remainingLots;
    if (o.side === 'buy') r.cash += units(book, o.remainingLots) * o.limitPrice * (1 + o.feeBps / 10000);
    else r.inventoryLots += o.remainingLots;
    return r;
  }, {cash: 0, inventoryLots: 0, targetLots: 0});
}
function invariant(book) {
  finite(book.cash, 'ledger cash');
  for (const key of ['positionLots', 'targetLots', 'initialPositionLots', 'initialTaskLots']) if (!Number.isSafeInteger(book[key]) || book[key] < 0) throw Error('invalid ledger quantity');
  finite(units(book, book.positionLots), 'inventory units');
  if (book.positionLots < 0 || book.cash < -1e-7) throw Error('negative inventory or cash');
  const r = reserves(book);
  finite(r.cash, 'reserved cash');
  if (!Number.isSafeInteger(r.targetLots) || !Number.isSafeInteger(r.inventoryLots)) throw Error('reservation overflow');
  if (r.cash > book.cash + 1e-7 || r.inventoryLots > book.positionLots) throw Error('reservation exceeds resources');
  if (r.targetLots > residualLots(book)) throw Error('open orders exceed target');
  const side = book.targetLots >= book.positionLots ? 'buy' : 'sell';
  if (openOrders(book).some(o => o.side !== side)) throw Error('opposite-side outstanding order requires reconciliation');
  return true;
}
function createBook({position, target, cash, startAt, rules}) {
  timestamp(startAt); finite(cash, 'cash');
  for (const k of ['quantityStep', 'priceTick']) finite(rules[k], k, Number.MIN_VALUE);
  for (const k of ['minQuantity', 'minNotional', 'maxQuantity', 'maxNotional']) finite(rules[k] ?? 0, k);
  const b = {schema: 1, startAt, lastEventAt: startAt, initialPositionLots: lots(position, rules.quantityStep), positionLots: lots(position, rules.quantityStep), targetLots: lots(target, rules.quantityStep), cash, rules: clone(rules), orders: {}, fills: [], segmentFillStart: 0, seenFillIds: [], revisions: []};
  b.initialTaskLots = residualLots(b); invariant(b); return b;
}
function reviseTarget(book, target, at) {
  if (openOrders(book).length) throw Error('confirm cancellation/reconciliation before revising target');
  timestamp(at); if (at < book.lastEventAt || book.fills.some(f => f.at > at)) throw Error('revision predates task events');
  const b = clone(book); b.revisions.push({at, oldTargetLots: b.targetLots, oldStartAt: b.startAt, initialTaskLots: b.initialTaskLots});
  b.targetLots = lots(target, b.rules.quantityStep); b.initialPositionLots = b.positionLots; b.initialTaskLots = residualLots(b); b.startAt = at; b.lastEventAt = at; b.segmentFillStart = b.fills.length; invariant(b); return b;
}
function validateIntent(book, intent) {
  const r = book.rules, n = lots(intent.quantity, r.quantityStep);
  if (!(n > 0) || !['buy', 'sell'].includes(intent.side)) throw Error('invalid order quantity/side');
  finite(intent.limitPrice, 'limit price', r.priceTick); finite(intent.feeBps, 'fee bps');
  finite(intent.quantity * intent.limitPrice * (1 + intent.feeBps / 10000), 'order monetary amount');
  if (Math.abs(roundPrice(intent.limitPrice, r.priceTick, false) - intent.limitPrice) > r.priceTick * 1e-7) throw Error('price not aligned to tick');
  if (intent.quantity < (r.minQuantity || 0) || intent.quantity * intent.limitPrice < (r.minNotional || 0) - 1e-8) throw Error('order below minimum');
  if (r.maxQuantity > 0 && intent.quantity > r.maxQuantity || r.maxNotional > 0 && intent.quantity * intent.limitPrice > r.maxNotional + 1e-8) throw Error('order above maximum');
  return n;
}
function submit(book, intent, id, at) {
  timestamp(at); if (at < book.lastEventAt) throw Error('out-of-order event requires reconciliation');
  if (typeof id !== 'string' || !id || book.orders[id]) throw Error('duplicate/invalid order id');
  const b = clone(book), n = validateIntent(b, intent);
  b.orders[id] = {...clone(intent), id, submittedAt: at, lastEventAt: at, remainingLots: n, originalLots: n, status: 'open'};
  b.lastEventAt = at; invariant(b); return b;
}
function cancelRequest(book, id, at) {
  timestamp(at); const b = clone(book), o = b.orders[id];
  if (!o || !active(o) || at < b.lastEventAt) throw Error('invalid cancel request');
  o.status = 'pending_cancel'; o.lastEventAt = at; b.lastEventAt = at; return b;
}
function cancelAck(book, id, at) {
  timestamp(at); const b = clone(book), o = b.orders[id];
  if (!o || o.status !== 'pending_cancel' || at < b.lastEventAt) throw Error('invalid cancel acknowledgment');
  o.status = 'cancelled'; o.lastEventAt = at; b.lastEventAt = at; invariant(b); return b;
}
function applyFill(book, {id, orderId, quantity, price, feeBps, at}) {
  if (book.seenFillIds.includes(id)) {
    const old = book.fills.find(f => f.id === id);
    if (JSON.stringify(old) !== JSON.stringify({id, orderId, quantity, price, feeBps, at})) throw Error('conflicting duplicate fill id');
    return clone(book);
  }
  if (typeof id !== 'string' || !id) throw Error('invalid fill id');
  timestamp(at); finite(price, 'fill price', Number.MIN_VALUE); finite(feeBps, 'fill fee');
  const b = clone(book), o = b.orders[orderId], n = lots(quantity, b.rules.quantityStep);
  if (!o || !active(o) || !(n > 0) || n > o.remainingLots || at < b.lastEventAt) throw Error('invalid/out-of-order fill requires reconciliation');
  if (feeBps > o.feeBps + 1e-9) throw Error('fill fee exceeds reserved cap; reconcile');
  if (o.side === 'buy' && price > o.limitPrice + 1e-9 || o.side === 'sell' && price < o.limitPrice - 1e-9) throw Error('fill violates price cap');
  const gross = finite(quantity * price, 'fill gross'), fee = finite(gross * feeBps / 10000, 'fill fee amount');
  b.positionLots += signed(o.side) * n;
  b.cash += o.side === 'buy' ? -gross * (1 + feeBps / 10000) : gross * (1 - feeBps / 10000);
  // Clamp only the declared sub-cent floating-point residue, never an actual funding shortfall.
  if (b.cash < 0 && b.cash >= -1e-7) { b.cashRoundingAdjustment = (b.cashRoundingAdjustment || 0) - b.cash; b.cash = 0; }
  o.remainingLots -= n; o.lastEventAt = at;
  if (!o.remainingLots) o.status = 'filled';
  const fill = {id, orderId, quantity, price, feeBps, at};
  b.fills.push(fill); b.seenFillIds.push(id); b.lastEventAt = at; invariant(b); return b;
}
function nyEpoch(dateString, minutes) {
  const date = new Date(`${dateString}T00:00:00Z`); timestamp(date.getTime());
  const desired = date.getTime() + minutes * MINUTE;
  let guess = desired + 5 * 60 * MINUTE;
  for (let i = 0; i < 3; i++) {
    const p = calendar.calendarParts({market_calendar: 'XNYS'}, new Date(guess));
    const actual = p.date.getTime() + (p.hour * 60 + p.minute) * MINUTE;
    guess += desired - actual;
  }
  return guess;
}
function sessionWindows(firstDate, lastDate, marketCalendar) {
  if (!['XNYS', '24X7'].includes(marketCalendar)) throw Error('unsupported market calendar');
  const first = Date.parse(firstDate + 'T00:00:00Z'), last = Date.parse(lastDate + 'T00:00:00Z');
  timestamp(first); timestamp(last);
  if (new Date(first).toISOString().slice(0, 10) !== firstDate || new Date(last).toISOString().slice(0, 10) !== lastDate) throw Error('invalid civil date');
  if (last < first || last - first > 366 * 4 * DAY) throw Error('invalid calendar interval');
  const out = [];
  for (let t = first; t <= last; t += DAY) {
    const d = new Date(t), key = d.toISOString().slice(0, 10);
    if (marketCalendar === '24X7') out.push({date: key, start: t + MINUTE, end: t + DAY});
    else { const close = calendar.sessionCloseMinutes(d); if (close !== null) out.push({date: key, start: nyEpoch(key, 576), end: nyEpoch(key, close)}); }
  }
  const coverage = {start: marketCalendar === '24X7' ? first : nyEpoch(firstDate, 0), end: marketCalendar === '24X7' ? last + DAY : nyEpoch(new Date(last + DAY).toISOString().slice(0, 10), 0), marketCalendar, firstDate, lastDate};
  for (const w of out) w.coverage = {...coverage};
  return out;
}
const calendarCache = new Map();
function validateWindows(windows) {
  if (!Array.isArray(windows) || !windows.length) throw Error('verified session windows required');
  const coverage = windows[0].coverage;
  if (!coverage || windows.some(w => JSON.stringify(w.coverage) !== JSON.stringify(coverage))) throw Error('calendar coverage metadata missing/inconsistent');
  const key = `${coverage.firstDate}|${coverage.lastDate}|${coverage.marketCalendar}`;
  if (!calendarCache.has(key)) calendarCache.set(key, JSON.stringify(sessionWindows(coverage.firstDate, coverage.lastDate, coverage.marketCalendar)));
  if (JSON.stringify(windows) !== calendarCache.get(key)) throw Error('calendar sessions incomplete or altered');
  let previous = -Infinity;
  for (const w of windows) { timestamp(w.start); timestamp(w.end); if (w.end <= w.start || w.start < previous) throw Error('invalid/overlapping session windows'); previous = w.end; }
}
function tradingTime(windows, from, to) { return windows.reduce((s, w) => s + Math.max(0, Math.min(w.end, to) - Math.max(w.start, from)), 0); }
function volatility(history, now, reference, tick) {
  const eligible = history.filter(x => {
    timestamp(x.observedAt); timestamp(x.availableAt); finite(x.price, 'history price', Number.MIN_VALUE);
    if (x.availableAt < x.observedAt) throw Error('history available before observed');
    return x.observedAt <= now && x.availableAt <= now;
  }).sort((a, b) => a.observedAt - b.observedAt);
  if (new Set(eligible.map(x => x.observedAt)).size !== eligible.length) throw Error('duplicate reference history');
  if (eligible.length < 21) throw Error('21 available completed session references required');
  const xs = eligible.slice(-21), returns = xs.slice(1).map((x, i) => Math.log(x.price / xs[i].price));
  return {value: finite(Math.max(tick / reference, Math.sqrt(returns.reduce((s, x) => s + x * x, 0) / 20)), 'volatility'), observations: 21, lastObservedAt: xs.at(-1).observedAt, lastAvailableAt: Math.max(...xs.map(x => x.availableAt))};
}
function plan(book, config, market) {
  invariant(book); const {now, nextReviewAt, windows, history, quote} = market;
  timestamp(now); timestamp(nextReviewAt); validateWindows(windows);
  if (now < book.startAt || nextReviewAt <= now) throw Error('invalid review clock');
  if (book.lastEventAt > now || book.fills.some(f => f.at > now) || Object.values(book.orders).some(o => o.lastEventAt > now)) throw Error('account snapshot contains future events');
  const r = reserves(book), remaining = residualLots(book), side = book.targetLots >= book.positionLots ? 'buy' : 'sell';
  const result = {side, remaining: units(book, remaining), reserved: units(book, r.targetLots), reservedCash: r.cash, intents: [], manualCloseoutRequired: false, reason: '', progress: null, allocated: 0};
  if (!remaining) return {...result, reason: 'target_reached'};
  const requestedDeadline = config.deadlineAt ?? null;
  let deadline = requestedDeadline;
  if (requestedDeadline !== null) {
    timestamp(requestedDeadline); if (requestedDeadline <= book.startAt) throw Error('deadline must follow task start');
    const coverage = windows[0].coverage; if (!coverage || coverage.start > book.startAt || coverage.end < requestedDeadline) throw Error('incomplete deadline calendar coverage');
    const eligibleEnds = windows.filter(w => w.start < requestedDeadline && w.end > book.startAt).map(w => Math.min(w.end, requestedDeadline));
    if (!eligibleEnds.length) throw Error('no eligible deadline trading time');
    deadline = Math.max(...eligibleEnds);
    result.requestedDeadlineAt = requestedDeadline; result.effectiveDeadlineAt = deadline;
    result.closeoutWindowStartsAt = deadline - 15 * MINUTE;
  }
  if (deadline !== null && now >= deadline) return {...result, reason: 'deadline_elapsed', manualCloseoutRequired: true};
  if (!windows.some(w => w.start <= now && now < w.end)) return {...result, reason: 'market_closed'};
  timestamp(quote.at); timestamp(quote.availableAt);
  if (quote.availableAt < quote.at || quote.at > now || quote.availableAt > now || now - quote.at > 60000) throw Error('current quote missing/stale/future');
  for (const x of ['mid', 'bid', 'ask']) finite(quote[x], `quote ${x}`, Number.MIN_VALUE);
  if (quote.bid > quote.ask || quote.mid < quote.bid || quote.mid > quote.ask) throw Error('invalid quote spread');
  for (const x of ['passiveFeeBps', 'aggressiveFeeBps', 'aggressiveSlippageBps']) finite(config[x], x);
  const filled = Math.max(0, book.initialTaskLots - remaining);
  let due, progress = 0;
  if (deadline !== null) {
    const duration = tradingTime(windows, book.startAt, deadline);
    if (!(duration > 0)) throw Error('no eligible deadline trading time');
    progress = Math.min(1, tradingTime(windows, book.startAt, now) / duration);
    due = Math.floor(book.initialTaskLots * Math.min(1, tradingTime(windows, book.startAt, Math.min(deadline, nextReviewAt)) / duration) + 1e-9) - filled;
  } else {
    finite(config.weeklyQuantity, 'explicit weekly quantity'); timestamp(config.weekStartAt); timestamp(config.weekEndAt);
    if (!(config.weekStartAt <= now && now < config.weekEndAt)) throw Error('current explicit pacing week required');
    const weeklyFilled = book.fills.slice(book.segmentFillStart).filter(f => f.at >= config.weekStartAt && f.at < config.weekEndAt).reduce((s, f) => s + lots(f.quantity, book.rules.quantityStep), 0);
    due = lotFloor(config.weeklyQuantity, book.rules.quantityStep) - weeklyFilled;
  }
  const strategy = config.strategy;
  if (!['paced_passive', 'paced_hybrid_50', 'same_horizon_twap', 'immediate'].includes(strategy)) throw Error('unknown strategy');
  if (strategy === 'same_horizon_twap' && deadline === null) {
    timestamp(config.comparisonHorizonAt);
    if (config.comparisonHorizonAt <= book.startAt || config.comparisonHorizonAt > config.weekEndAt) throw Error('explicit same-week comparison horizon required');
    const duration = tradingTime(windows, book.startAt, config.comparisonHorizonAt);
    if (!(duration > 0)) throw Error('no comparison trading time');
    const goal = Math.min(book.initialTaskLots, lotFloor(config.weeklyQuantity, book.rules.quantityStep));
    due = Math.min(due, Math.floor(goal * Math.min(1, tradingTime(windows, book.startAt, nextReviewAt) / duration) + 1e-9) - filled);
  }
  if (strategy === 'immediate' && deadline !== null) due = remaining;
  if (config.manualCloseoutScenario) {
    if (deadline === null || now < deadline - 15 * MINUTE) throw Error('manual closeout scenario outside final 15 minutes');
    due = remaining; result.manualCloseoutRequired = true;
    if (openOrders(book).length) return {...result, manualCloseoutRequired: true, reason: 'cancel_acknowledgments_required'};
  }
  const needed = Math.max(0, Math.min(remaining, due) - r.targetLots);
  result.progress = deadline === null ? null : progress;
  result.scheduledQuantity = units(book, Math.max(0, Math.min(remaining, due)));
  if (!needed) return {...result, reason: r.targetLots ? 'target_or_pace_reserved' : 'pace_satisfied'};
  let availableLots = Math.min(needed, side === 'sell' ? book.positionLots - r.inventoryLots : needed), availableCash = book.cash - r.cash;
  const aggressiveShare = config.manualCloseoutScenario || strategy === 'immediate' || strategy === 'same_horizon_twap' ? 1 : strategy === 'paced_hybrid_50' ? .5 : 0;
  const aggrLots = Math.floor(availableLots * aggressiveShare + 1e-9);
  function add(n, price, feeBps, kind) {
    if (!n) return;
    const rr = book.rules;
    n = Math.min(n, availableLots, rr.maxQuantity > 0 ? lotFloor(rr.maxQuantity, rr.quantityStep) : n,
      rr.maxNotional > 0 ? lotFloor(rr.maxNotional / price, rr.quantityStep) : n);
    if (side === 'buy') n = Math.min(n, lotFloor(Math.max(0, availableCash) / (price * (1 + feeBps / 10000)), rr.quantityStep));
    const quantity = units(book, n);
    if (!(n > 0) || quantity < (rr.minQuantity || 0) || quantity * price < (rr.minNotional || 0) - 1e-8) return;
    result.intents.push({side, quantity, limitPrice: price, feeBps, kind});
    availableLots -= n; if (side === 'buy') availableCash -= quantity * price * (1 + feeBps / 10000);
  }
  const aggressivePrice = roundPrice((side === 'buy' ? quote.ask : quote.bid) * (1 + signed(side) * config.aggressiveSlippageBps / 10000), book.rules.priceTick, side === 'buy');
  add(aggrLots, aggressivePrice, config.aggressiveFeeBps, 'aggressive_scenario');
  // Any unallocated aggressive quantity stays residual; no silent passive substitution.
  const passiveLots = Math.min(availableLots, needed - aggrLots);
  if (passiveLots > 0) {
    const v = volatility(history, now, quote.mid, book.rules.priceTick); result.volatility = v;
    const factor = deadline === null ? 1 : Math.max(.25, 1 - progress); result.distanceFactor = factor;
    const worstMinimumPrice = roundPrice(Math.max(book.rules.priceTick, quote.mid * (1 - signed(side) * (side === 'buy' ? 1.25 : .25) * v.value * factor)), book.rules.priceTick, side === 'sell');
    const minimumLots = Math.max(1, Math.ceil((book.rules.minQuantity || 0) / book.rules.quantityStep - 1e-9), Math.ceil((book.rules.minNotional || 0) / (worstMinimumPrice * book.rules.quantityStep) - 1e-9));
    const n = Math.min(3, Math.max(1, Math.floor(passiveLots / minimumLots))), base = Math.floor(passiveLots / n), extra = passiveLots % n;
    for (let i = 0; i < n; i++) {
      const price = roundPrice(Math.max(book.rules.priceTick, quote.mid * (1 - signed(side) * [.25, .75, 1.25][i] * v.value * factor)), book.rules.priceTick, side === 'sell');
      add(base + (i < extra ? 1 : 0), price, config.passiveFeeBps, 'passive_limit');
    }
  }
  result.allocated = result.intents.reduce((s, o) => s + o.quantity, 0);
  result.unallocatedDue = units(book, needed) - result.allocated;
  result.reason = result.allocated > 0 ? 'research_plan' : 'cash_inventory_or_order_minimum_infeasible';
  return result;
}
function metrics(book, arrival, terminalMid) {
  finite(arrival, 'arrival', Number.MIN_VALUE); finite(terminalMid, 'terminal', Number.MIN_VALUE);
  const q = units(book, book.initialTaskLots), rem = units(book, residualLots(book));
  if (!q) return {completion: 1, passiveCompletion: 0, aggressiveFraction: 0, costBps: 0, executedOnlyCostBps: null, remaining: 0};
  const side = book.targetLots >= book.initialPositionLots ? 'buy' : 'sell', sign = signed(side);
  const fills = book.fills.slice(book.segmentFillStart);
  const cashValue = fills.reduce((s, f) => s + f.quantity * f.price * (1 + sign * f.feeBps / 10000), 0);
  const filledQ = q - rem;
  const passiveQ = fills.filter(f => book.orders[f.orderId].kind === 'passive_limit').reduce((s, f) => s + f.quantity, 0);
  return {completion: filledQ / q, passiveCompletion: passiveQ / q, aggressiveFraction: (filledQ - passiveQ) / q,
    costBps: sign * ((cashValue + rem * terminalMid) / (q * arrival) - 1) * 10000,
    executedOnlyCostBps: filledQ ? sign * (cashValue / (filledQ * arrival) - 1) * 10000 : null, remaining: rem,
    residualMark: 'common terminal mid opportunity cost; not an assumed execution', reservedAtEnd: units(book, reserves(book).targetLots)};
}
module.exports = {createBook, reviseTarget, submit, cancelRequest, cancelAck, applyFill, invariant, reserves, openOrders, residualLots, units, lots, lotFloor, roundPrice, sessionWindows, nyEpoch, tradingTime, volatility, plan, metrics, MINUTE, DAY};
