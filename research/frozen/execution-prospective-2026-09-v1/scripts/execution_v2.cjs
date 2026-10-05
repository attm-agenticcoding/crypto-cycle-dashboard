/* Research-only causal replay. Reuses the production sell/crypto order engine.
 * Listed buy adapter is checked against the page's functions by parity tests.
 * This module has no networking, publishing, or order-placement capability.
 */
"use strict";
const core = require("../execution/execution-core.js");

const GRID = [10, 15, 20, 30, 45, 60].flatMap(lookback =>
  [10, 15, 20, 25, 30, 35, 40, 50].flatMap(first =>
    Array.from({length: 15}, (_, i) => ({lookback, first: first / 10000, spacing: (30 + i * 5) / 10000}))));
const METHODS = ["legacy_distance_control", "minimum_cost", "paired_confirmation"];
const BASELINES = ["equal_paced", "arrival_reference"];
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
function quantile(xs, q) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b), x = (sorted.length - 1) * q;
  return sorted[Math.floor(x)] + (sorted[Math.ceil(x)] - sorted[Math.floor(x)]) * (x % 1);
}
function stderr(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
}
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function blockIndices(n, length, random) {
  const result = [];
  while (result.length < n) {
    const start = Math.floor(random() * n);
    for (let k = 0; k < Math.min(length, n) && result.length < n; k++) result.push((start + k) % n);
  }
  return result;
}
function pairedInterval(differences, protocol, seedOffset = 0) {
  const point = mean(differences), random = rng(protocol.seed + seedOffset), boot = [];
  for (let b = 0; b < protocol.bootstrap_replicates; b++)
    boot.push(mean(blockIndices(differences.length, protocol.block_weeks, random).map(i => differences[i])));
  return {mean_improvement_bps: point, lower_95_bps: 2 * point - quantile(boot, .95),
    upper_95_bps: 2 * point - quantile(boot, .05), weeks: differences.length,
    interpretation: "pointwise one-sided 95% basic circular-block limits; not a familywise claim"};
}

// Keep semantics (including zero-total behavior) identical to the current page.
function optimizeDeadline(weekly, capital, weekSessions, horizon) {
  if (!capital || capital <= 0 || horizon <= 0) {
    return {weekly, scheduleFloor: 0, paceSessions: weekSessions, factor: 1, lift: 1, urgency: "BASE", enabled: false, inputCapped: false};
  }
  const total = Math.max(0, capital), enteredWeekly = Math.max(0, weekly);
  const baseWeekly = Math.min(enteredWeekly, total), paceSessions = Math.min(weekSessions, horizon);
  const scheduleFloor = Math.min(total, total * paceSessions / horizon);
  const effectiveWeekly = Math.min(total, Math.max(baseWeekly, scheduleFloor));
  const lift = effectiveWeekly / Math.max(baseWeekly, 1);
  const factor = Math.max(.40, Math.min(1, 1 / Math.sqrt(Math.max(1, lift))));
  return {weekly: effectiveWeekly, scheduleFloor, paceSessions, factor, lift,
    urgency: lift > 1.5 ? "HIGH" : lift > 1.02 ? "ELEVATED" : "NORMAL",
    enabled: true, inputCapped: enteredWeekly > total};
}
function buildOrders(amount, reference, weekSessions, first, spacing, hits) {
  const targetShares = Math.max(0, Math.floor(amount / reference));
  if (!targetShares) return {targetShares: 0, perRung: 0, orders: []};
  const perRung = Math.max(1, Math.ceil(targetShares / (weekSessions * Math.max(.1, hits))));
  const orders = [];
  let remaining = targetShares, rung = 0;
  while (remaining > 0 && rung < 30) {
    const shares = Math.min(perRung, remaining);
    const price = Math.max(.01, Math.floor(reference * (1 - first - rung * spacing) * 100 + 1e-8) / 100);
    orders.push({rung: rung + 1, price, shares, notional: shares * price});
    remaining -= shares; rung++;
  }
  return {targetShares, perRung, orders};
}
function dailyPlan({instrument, side, candidate, history, weekly, total, held, reference, daysLeft, reserved = 0}) {
  const params = {...instrument, trade_side: side, lookback_sessions: candidate.lookback,
    first_offset_pct: candidate.first * 100, spacing_pct: candidate.spacing * 100,
    session_samples: history, expected_rungs_per_session: .1};
  const args = {weekly, total, held, reserved, reference, weekSessions: daysLeft, horizon: daysLeft, params};
  if (instrument.market_calendar === "24X7") return core.cryptoPlan(args);
  if (side === "sell") return core.sellPlan(args);
  const controller = optimizeDeadline(weekly, total, daysLeft, daysLeft);
  const first = candidate.first * controller.factor, spacing = candidate.spacing * controller.factor;
  const sample = history.slice(-candidate.lookback);
  const hits = Math.max(.1, sample.length ? mean(sample.map(row => core.hitCount(row.drawdown_pct / 100, first, spacing))) : .1);
  return {...buildOrders(controller.weekly, reference, controller.paceSessions, first, spacing, hits), controller};
}

function availableHistory(dataset, side, index) {
  // Listed BUY currently drops the newest nightly sample because its next-ref
  // label is absent. Preserve that production quirk rather than silently fixing it.
  const lag = Math.max(dataset.observation_lag_sessions || 0,
    side === "buy" && dataset.instrument.market_calendar === "XNYS" ? 1 : 0);
  const end = Math.max(0, index - lag);
  return dataset.sessions.slice(Math.max(0, end - 60), end);
}
function canonicalWeeks(dataset, protocol) {
  return dataset.weeks.filter(w => w.indices[0] >= protocol.max_lookback + 1 &&
    dataset.sessions[w.indices.at(-1)].date <= protocol.evaluation_end);
}
function eligibleTrainingWeeks(dataset, weeks, decisionIndex, mode, scoreWeeks) {
  const decisionDate = dataset.sessions[decisionIndex].date;
  // A terminal reference at this morning's anchor is not available to last
  // night's parameter fit. A strict inequality purges that boundary label.
  return weeks.map((w, i) => ({w, i})).filter(({w}) =>
    (mode === "price_seeking" ? w.terminal_date : dataset.sessions[w.indices.at(-1)].date) < decisionDate)
    .map(({i}) => i).slice(-scoreWeeks);
}

function simulateWeek(dataset, week, side, mode, scenario, protocol, choose, trace = false) {
  const instrument = dataset.instrument, sessions = dataset.sessions;
  const initialPrice = sessions[week.indices[0]].reference, step = instrument.quantity_step;
  const initialTarget = side === "buy" ? protocol.task_notional : core.quantize(protocol.task_notional / initialPrice, step);
  let remaining = initialTarget, weeklyRemaining = initialTarget *
    (mode === "finish_by_deadline" ? protocol.weekly_fraction_of_deadline_target : 1);
  let acquired = 0, proceeds = 0, passiveAmount = 0, aggressiveAmount = 0, zeroDays = 0;
  const decisions = [];
  function transact(price, desiredQuantity, feeBps, passive) {
    if (!(price > 0) || price < instrument.min_price || (instrument.max_price > 0 && price > instrument.max_price)) return 0;
    const fee = feeBps / 10000;
    const affordable = side === "buy" ? remaining / (price * (1 + fee)) : remaining;
    const quantity = core.quantize(Math.min(affordable, desiredQuantity, instrument.max_quantity || Infinity,
      instrument.max_notional > 0 ? instrument.max_notional / price : Infinity), step);
    if (!(quantity >= instrument.min_quantity && quantity * price + 1e-8 >= instrument.min_notional)) return 0;
    const consumed = side === "buy" ? quantity * price * (1 + fee) : quantity;
    remaining = Math.max(0, remaining - consumed);
    weeklyRemaining = Math.max(0, weeklyRemaining - consumed);
    acquired += quantity;
    proceeds += quantity * price * (1 - fee);
    if (passive) passiveAmount += consumed;
    else aggressiveAmount += consumed;
    return consumed;
  }
  function aggressive(reference, amount) {
    const buy = side === "buy";
    const raw = reference * (1 + (buy ? 1 : -1) * scenario.aggressive_slippage_bps / 10000);
    const price = core.quantize(raw, instrument.price_tick, buy);
    const qty = buy ? amount / (price * (1 + scenario.aggressive_fee_bps / 10000)) : amount;
    return transact(price, qty, scenario.aggressive_fee_bps, false);
  }
  for (let day = 0; day < week.indices.length; day++) {
    const index = week.indices[day], session = sessions[index], daysLeft = week.indices.length - day;
    const selection = choose(index), choice = selection.choice;
    if (selection.history && selection.history.some(row => !row.date || row.date >= session.date))
      throw new Error("A frozen history sample is not strictly before its execution day");
    if (trace) decisions.push({date: session.date, ...selection, remaining_before: remaining, weekly_before: weeklyRemaining});
    const before = remaining;
    if (BASELINES.includes(choice)) {
      if (choice === "equal_paced" || day === 0) aggressive(session.reference, choice === "equal_paced" ? remaining / daysLeft : remaining);
    } else if (remaining > 0) {
      // Reserve explicit scenario fees inside the buy budget; the production
      // calculator itself does not currently reserve fees.
      const divisor = side === "buy" ? 1 + scenario.passive_fee_bps / 10000 : 1;
      const plan = dailyPlan({instrument, side, candidate: GRID[choice],
        history: selection.history || availableHistory(dataset, side, index), weekly: weeklyRemaining / divisor,
        total: mode === "finish_by_deadline" ? remaining / divisor : null,
        held: side === "sell" ? remaining : 0, reference: session.reference, daysLeft});
      const finalCloseout = mode === "finish_by_deadline" && daysLeft === 1;
      const low = finalCloseout ? session.pre_closeout_low : session.low;
      const high = finalCloseout ? session.pre_closeout_high : session.high;
      for (const order of plan.orders) {
        const crossed = side === "buy" ? low <= order.price * (1 - scenario.penetration_bps / 10000)
          : high >= order.price * (1 + scenario.penetration_bps / 10000);
        if (crossed) transact(order.price, order.shares * scenario.fill_fraction, scenario.passive_fee_bps, true);
      }
    }
    if (remaining === before) zeroDays++;
    if (mode === "finish_by_deadline" && daysLeft === 1 && remaining > 0)
      aggressive(session.closeout_reference, remaining);
  }
  const last = sessions[week.indices.at(-1)];
  const mark = mode === "finish_by_deadline" ? last.closeout_reference : last.next_reference;
  if (!(mark > 0 && initialTarget > 0)) throw new Error("Complete terminal observation and nonzero task required");
  // Residual is opportunity-cost valuation, NOT a claimed fill or a rounded-up order.
  const terminalPrice = mark * (1 + (side === "buy" ? 1 : -1) * scenario.aggressive_slippage_bps / 10000);
  const fee = scenario.aggressive_fee_bps / 10000;
  const cost = side === "buy" ? (initialTarget / (acquired + remaining / (terminalPrice * (1 + fee))) / initialPrice - 1) * 10000
    : (1 - (proceeds + remaining * terminalPrice * (1 - fee)) / (initialTarget * initialPrice)) * 10000;
  if (!Number.isFinite(cost)) throw new Error("Non-finite cost; do not silently drop this week");
  return {week: week.week, cost_bps: cost, passive_completion: passiveAmount / initialTarget,
    modeled_completion: 1 - remaining / initialTarget, terminal_intervention: aggressiveAmount / initialTarget,
    remaining_fraction: remaining / initialTarget, zero_fill_days: zeroDays, sessions: week.indices.length,
    ...(trace ? {decisions} : {})};
}

function chooseCandidate(method, costs, baselines, training, incumbent, protocol) {
  if (training.length < protocol.score_weeks) throw new Error("Insufficient common training weeks");
  const values = (choice, indices) => indices.map(i => typeof choice === "number" ? costs[choice][i] : baselines[choice][i].cost_bps);
  const means = costs.map(row => mean(training.map(i => row[i])));
  const raw = means.indexOf(Math.min(...means));
  const common = {raw_minimum: raw, raw_minimum_mean_bps: means[raw], training_weeks: training.length,
    training_first_index: training[0], training_last_index: training.at(-1)};
  if (method === "minimum_cost") return {...common, choice: raw, reason: "minimum net cost on common completed training weeks"};
  if (method === "legacy_distance_control") {
    const anchorIndex = typeof incumbent === "number" ? incumbent : GRID.findIndex(c => c.lookback === 20 && c.first === .0025 && c.spacing === .008);
    const anchor = GRID[anchorIndex], threshold = means[raw] + Math.max(stderr(values(raw, training)), .25);
    const distance = c => Math.abs(c.first - anchor.first) / .0005 + Math.abs(c.spacing - anchor.spacing) / .0005 + .15 * Math.abs(c.lookback - anchor.lookback) / 5;
    const plateau = GRID.map((c, i) => ({i, d: distance(c)})).filter(c => means[c.i] <= threshold)
      .sort((a, b) => a.d - b.d || means[a.i] - means[b.i] || a.i - b.i);
    return {...common, choice: plateau[0].i, reason: "legacy distance rule, but on repaired common-week replay",
      plateau_count: plateau.length, adopted_mean_bps: means[plateau[0].i]};
  }
  if (method !== "paired_confirmation") throw new Error("Unknown selector");
  // Challenger search and its paired confirmation use disjoint chronological
  // windows. Full outer replay still tests this entire adaptive procedure.
  const split = training.length - protocol.confirmation_weeks;
  const discovery = training.slice(0, split), confirmation = training.slice(split);
  const discoveryMeans = costs.map(row => mean(discovery.map(i => row[i])));
  const challenger = discoveryMeans.indexOf(Math.min(...discoveryMeans));
  const prior = incumbent ?? "equal_paced";
  const diffs = values(prior, confirmation).map((x, i) => x - values(challenger, confirmation)[i]);
  const interval = pairedInterval(diffs, protocol, training.at(-1));
  const accepted = interval.mean_improvement_bps >= protocol.switch_materiality_bps && interval.lower_95_bps > 0;
  return {...common, choice: accepted ? challenger : prior, challenger, confirmation: interval,
    reason: accepted ? "paired confirmation clears materiality and block-uncertainty checks"
      : prior === "equal_paced" ? "no validated ladder incumbent; keep independently tested equal-paced baseline"
      : "challenger has not cleared both paired confirmation checks; retain incumbent",
    switching_fee_bps: 0};
}

function summary(outcomes) {
  if (!outcomes.length) throw new Error("An empty evaluation interval is not a valid performance estimate");
  const costs = outcomes.map(x => x.cost_bps);
  return {weeks: outcomes.length, mean_cost_bps: mean(costs), p95_cost_bps: quantile(costs, .95),
    worst_week_bps: Math.max(...costs), mean_passive_completion: mean(outcomes.map(x => x.passive_completion)),
    mean_modeled_completion: mean(outcomes.map(x => x.modeled_completion)),
    mean_aggressive_fraction: mean(outcomes.map(x => x.terminal_intervention)),
    mean_remaining_fraction: mean(outcomes.map(x => x.remaining_fraction)),
    zero_fill_day_rate: outcomes.reduce((s, x) => s + x.zero_fill_days, 0) / outcomes.reduce((s, x) => s + x.sessions, 0)};
}

function evaluateTask(dataset, side, mode, protocol, progress = () => {}) {
  const weeks = canonicalWeeks(dataset, protocol), nominal = protocol.scenarios[0];
  if (weeks.length <= protocol.score_weeks + protocol.minimum_holdout_weeks) throw new Error("Insufficient full weeks for nested validation");
  const baselines = Object.fromEntries(BASELINES.map(name => [name, weeks.map(week =>
    simulateWeek(dataset, week, side, mode, nominal, protocol, () => ({choice: name})))]));
  const costs = GRID.map((candidate, c) => {
    if (c % 120 === 0) progress(`candidate ${c + 1}/${GRID.length}`);
    return weeks.map(week => simulateWeek(dataset, week, side, mode, nominal, protocol, () => ({choice: c})).cost_bps);
  });
  const outer = weeks.filter(week => eligibleTrainingWeeks(dataset, weeks, week.indices[0], mode, protocol.score_weeks).length === protocol.score_weeks);
  const policies = {};
  for (const method of METHODS) {
    let incumbent = null, lastTrainingKey = null, lastSelection = null, changes = 0, previousChoice;
    const choices = new Map();
    const nominalOutcomes = outer.map(week => simulateWeek(dataset, week, side, mode, nominal, protocol, index => {
      const training = eligibleTrainingWeeks(dataset, weeks, index, mode, protocol.score_weeks);
      const key = training.join(",");
      if (key !== lastTrainingKey) {
        lastSelection = chooseCandidate(method, costs, baselines, training, incumbent, protocol);
        incumbent = lastSelection.choice; lastTrainingKey = key;
      }
      if (previousChoice !== undefined && incumbent !== previousChoice) changes++;
      previousChoice = incumbent;
      choices.set(index, {...lastSelection});
      return {...lastSelection, training_first_week: weeks[training[0]].week,
        training_last_week: weeks[training.at(-1)].week};
    }, true));
    const scenarios = {[nominal.name]: nominalOutcomes};
    // Stress the selected nominal policy; never re-optimize after seeing a stress result.
    for (const scenario of protocol.scenarios.slice(1)) scenarios[scenario.name] = outer.map(week =>
      simulateWeek(dataset, week, side, mode, scenario, protocol, index => choices.get(index)));
    policies[method] = {changes, latest_selection: nominalOutcomes.at(-1).decisions.at(-1), scenarios};
  }
  for (const baseline of BASELINES) policies[baseline] = {changes: 0, scenarios: Object.fromEntries(protocol.scenarios.map(scenario =>
    [scenario.name, outer.map(week => simulateWeek(dataset, week, side, mode, scenario, protocol, () => ({choice: baseline})))]))};
  for (const policy of Object.values(policies)) {
    policy.summary = Object.fromEntries(Object.entries(policy.scenarios).map(([name, outcomes]) => [name, {
      development: summary(outcomes.filter(x => x.week < protocol.holdout_start)),
      holdout: summary(outcomes.filter(x => x.week >= protocol.holdout_start))}]));
  }
  return {instrument_id: dataset.instrument.instrument_id, side, mode, price_source: dataset.price_source,
    common_weeks: weeks.map(w => w.week), outer_weeks: outer.map(w => w.week),
    holdout_weeks: outer.filter(w => w.week >= protocol.holdout_start).map(w => w.week),
    quality: dataset.quality, policies, candidate_costs_bps: costs};
}

function familywiseComparisons(tasks, protocol) {
  const comparisons = [];
  for (const task of tasks) for (const method of METHODS.slice(1)) for (const baseline of [METHODS[0], ...BASELINES])
    for (const scenario of protocol.scenarios) {
      const a = task.policies[baseline].scenarios[scenario.name].filter(x => x.week >= protocol.holdout_start);
      const b = task.policies[method].scenarios[scenario.name].filter(x => x.week >= protocol.holdout_start);
      if (JSON.stringify(a.map(x => x.week)) !== JSON.stringify(b.map(x => x.week))) throw new Error("Unpaired outer weeks");
      comparisons.push({instrument_id: task.instrument_id, side: task.side, mode: task.mode, method, baseline,
        scenario: scenario.name, weeks: a.map(x => x.week), differences: a.map((x, i) => x.cost_bps - b[i].cost_bps)});
    }
  const common = comparisons[0].weeks.filter(w => comparisons.every(c => c.weeks.includes(w)));
  if (common.length < protocol.minimum_holdout_weeks) throw new Error("Too few common holdout weeks across all tasks");
  for (const c of comparisons) {
    c.differences = common.map(w => c.differences[c.weeks.indexOf(w)]); c.weeks = common;
    c.mean_improvement_bps = mean(c.differences);
  }
  const random = rng(protocol.seed), maxima = [];
  for (let b = 0; b < protocol.bootstrap_replicates; b++) {
    const indices = blockIndices(common.length, protocol.block_weeks, random);
    maxima.push(Math.max(0, ...comparisons.map(c => mean(indices.map(i => c.differences[i])) - c.mean_improvement_bps)));
  }
  const margin = quantile(maxima, .95);
  for (const c of comparisons) {
    c.simultaneous_lower_95_bps = c.mean_improvement_bps - margin;
    c.cost_check = c.mean_improvement_bps >= protocol.switch_materiality_bps && c.simultaneous_lower_95_bps > 0;
  }
  return {comparisons, family_size: comparisons.length, common_holdout_weeks: common,
    margin_bps: margin, interpretation: "approximate one-sided 95% joint basic block-bootstrap lower bounds across all declared comparisons; 12-week samples remain low-power"};
}

module.exports = {GRID, METHODS, BASELINES, mean, quantile, pairedInterval, optimizeDeadline, buildOrders,
  dailyPlan, availableHistory, canonicalWeeks, eligibleTrainingWeeks, simulateWeek, chooseCandidate,
  summary, evaluateTask, familywiseComparisons};
