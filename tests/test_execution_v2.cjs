const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const core = require("../execution/execution-core.js"), v2 = require("../scripts/execution_v2.cjs");
const protocol = require("../research/execution-v2-protocol.json");
const instrument = require("../data/execution_instruments.json").instruments[0];
const candidate = {lookback: 20, first: .0025, spacing: .008};
const free = protocol.scenarios.find(x => x.name === "frictionless_touch");

function synthetic({low = 35, high = 35, terminal = 36, preLow = low, preHigh = high} = {}) {
  const sessions = Array.from({length: 5}, (_, i) => ({date: `2026-06-${22 + i}`, reference: 35, low, high,
    pre_closeout_low: preLow, pre_closeout_high: preHigh, closeout_reference: 35,
    next_reference: i === 4 ? terminal : 35, drawdown_pct: (35 - low) / 35 * 100, runup_pct: (high - 35) / 35 * 100}));
  return {instrument, sessions, weeks: [{week: "2026-06-22", indices: [0, 1, 2, 3, 4], terminal_date: "2026-06-29"}]};
}

test("listed buy adapter is exactly the current page math, not an independent approximation", () => {
  const html = fs.readFileSync(require.resolve("../execution/index.html"), "utf8");
  const context = {};
  for (const name of ["optimizeDeadline", "buildOrders"]) {
    const source = html.match(new RegExp(`    function ${name}\\([^]*?(?=    function )`))[0];
    vm.runInNewContext(source + `; result = ${name};`, context);
    const original = context.result;
    if (name === "optimizeDeadline") for (const weekly of [0, .37, 5402, 10000]) for (const total of [null, 0, 88712, 225461]) for (const days of [1, 2, 5]) {
      assert.deepEqual(v2[name](weekly, total, days, 17), JSON.parse(JSON.stringify(original(weekly, total, days, 17))));
    } else for (const amount of [0, 1, 99.1, 5402, 10000.73]) for (const ref of [.03, 23.32, 35, 345]) for (const hits of [.1, 1.2, 12])
      assert.deepEqual(v2[name](amount, ref, 3, .0025, .008, hits), JSON.parse(JSON.stringify(original(amount, ref, 3, .0025, .008, hits))));
  }
});

test("sell and crypto call the same production planner, including reservations", () => {
  for (const item of require("../data/execution_instruments.json").instruments) for (const side of ["buy", "sell"]) {
    if (item.market_calendar !== "24X7" && side === "buy") continue;
    const history = [{runup_pct: 1.5, drawdown_pct: 1.2}];
    const args = {instrument: item, side, candidate, history, weekly: side === "buy" ? 10000 : 100,
      total: null, held: 200, reserved: 10, reference: item.default_reference_price, daysLeft: 3};
    const params = {...item, trade_side: side, lookback_sessions: 20, first_offset_pct: .25, spacing_pct: .8,
      session_samples: history, expected_rungs_per_session: .1};
    const direct = (item.market_calendar === "24X7" ? core.cryptoPlan : core.sellPlan)(
      {...args, weekSessions: 3, horizon: 3, params});
    assert.deepEqual(v2.dailyPlan(args), direct);
  }
});

test("canonical weeks do not depend on candidate lookback or hits", () => {
  const data = synthetic();
  data.weeks = [{week: "2026-06-22", indices: [61], terminal_date: "2026-06-29"}];
  data.sessions[61] = {date: "2026-06-26"};
  assert.equal(v2.GRID.length, 720);
  assert.equal(v2.canonicalWeeks(data, protocol).length, 1);
  data.weeks[0].indices = [60];
  assert.equal(v2.canonicalWeeks(data, protocol).length, 0);
});

test("terminal reference at the current anchor is purged from overnight training", () => {
  const data = synthetic();
  data.sessions.push({date: "2026-06-29"}, {date: "2026-06-30"});
  assert.deepEqual(v2.eligibleTrainingWeeks(data, data.weeks, 5, "price_seeking", 26), []);
  assert.deepEqual(v2.eligibleTrainingWeeks(data, data.weeks, 6, "price_seeking", 26), [0]);
  assert.deepEqual(v2.eligibleTrainingWeeks(data, data.weeks, 5, "finish_by_deadline", 26), [0]);
});

test("zero-hit weeks remain scored and residual has correct buy/sell sign", () => {
  const data = synthetic(), choose = () => ({choice: 0});
  const buy = v2.simulateWeek(data, data.weeks[0], "buy", "price_seeking", free, protocol, choose);
  const sell = v2.simulateWeek(data, data.weeks[0], "sell", "price_seeking", free, protocol, choose);
  assert.equal(buy.passive_completion, 0); assert.equal(sell.passive_completion, 0);
  assert.ok(buy.cost_bps > 0 && sell.cost_bps < 0);
  assert.equal(buy.modeled_completion, 0); assert.equal(buy.remaining_fraction, 1);
  assert.equal(buy.zero_fill_days, 5);
});

test("closeout excludes later extremes and does not call residual dust a fill", () => {
  const data = synthetic();
  Object.assign(data.sessions[4], {low: 20, high: 50, pre_closeout_low: 35, pre_closeout_high: 35});
  for (const side of ["buy", "sell"]) {
    const finished = v2.simulateWeek(data, data.weeks[0], side, "finish_by_deadline", free, protocol, () => ({choice: 0}));
    assert.equal(finished.passive_completion, 0);
    assert.ok(finished.terminal_intervention > .99 && finished.terminal_intervention <= 1);
    assert.ok(finished.modeled_completion <= 1);
    assert.equal(finished.modeled_completion, finished.terminal_intervention);
  }
});

test("fees, fractional fills and total/weekly decrements preserve funds and inventory", () => {
  for (const item of require("../data/execution_instruments.json").instruments) for (const side of ["buy", "sell"]) {
    const data = synthetic({low: 1, high: 100}); data.instrument = item;
    for (const scenario of protocol.scenarios) {
      const result = v2.simulateWeek(data, data.weeks[0], side, "finish_by_deadline", scenario, protocol, () => ({choice: 0}), true);
      assert.ok(result.passive_completion >= 0 && result.passive_completion <= 1 + 1e-12);
      assert.ok(result.modeled_completion >= 0 && result.modeled_completion <= 1 + 1e-12);
      for (let i = 1; i < result.decisions.length; i++) {
        assert.ok(result.decisions[i].remaining_before <= result.decisions[i - 1].remaining_before);
        assert.ok(result.decisions[i].weekly_before <= result.decisions[i - 1].weekly_before);
      }
    }
  }
});

test("future outcomes cannot affect an earlier selector decision", () => {
  const costs = v2.GRID.map((_, c) => Array.from({length: 40}, (_, w) => (c % 17) + w % 5));
  const baseline = {equal_paced: Array.from({length: 40}, () => ({cost_bps: 100}))};
  const train = Array.from({length: 26}, (_, i) => i);
  for (const method of v2.METHODS) {
    const before = v2.chooseCandidate(method, costs, baseline, train, null, protocol);
    const perturbed = costs.map((row, c) => row.map((x, i) => i >= 26 ? 1000000 - c * i : x));
    assert.deepEqual(v2.chooseCandidate(method, perturbed, baseline, train, null, protocol), before);
  }
});

test("paired challenger is discovered without confirmation data and needs both gates", () => {
  const p = {...protocol, bootstrap_replicates: 64};
  const train = Array.from({length: 26}, (_, i) => i);
  const costs = v2.GRID.map((_, c) => Array(26).fill(c === 0 ? 10 : 20));
  const baseline = {equal_paced: Array(26).fill({cost_bps: 0})};
  const rejected = v2.chooseCandidate("paired_confirmation", costs, baseline, train, null, p);
  assert.equal(rejected.choice, "equal_paced"); assert.equal(rejected.challenger, 0);
  costs[0].fill(-10, 18);
  const accepted = v2.chooseCandidate("paired_confirmation", costs, baseline, train, null, p);
  assert.equal(accepted.choice, 0);
  assert.equal(accepted.switching_fee_bps, 0);
  costs[1].fill(-100, 18); // Cannot change the discovery winner by seeing confirmation.
  assert.equal(v2.chooseCandidate("paired_confirmation", costs, baseline, train, null, p).challenger, 0);
});

test("paired interval is deterministic and uses differences, not candidate cost stderr", () => {
  const first = v2.pairedInterval([5, 5, 5, 5, 5, 5, 5, 5], protocol);
  assert.equal(first.lower_95_bps, 5);
  assert.deepEqual(v2.pairedInterval([1, 10, -4, 8, 10, 2, -2, 8], protocol), v2.pairedInterval([1, 10, -4, 8, 10, 2, -2, 8], protocol));
});

test("empty evaluation intervals fail rather than publishing NaN as a score", () => {
  assert.throws(() => v2.summary([]), /empty evaluation interval/);
});

test("joint bounds pair the same outer weeks and retain all comparisons", () => {
  const weeks = Array.from({length: 12}, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
  const policies = {};
  for (const method of [...v2.METHODS, ...v2.BASELINES]) policies[method] = {
    scenarios: Object.fromEntries(protocol.scenarios.map(({name}) => [name,
      weeks.map(week => ({week, cost_bps: method === "minimum_cost" ? -10 : 0}))]))};
  const task = {instrument_id: "test", side: "buy", mode: "price_seeking", policies};
  const family = v2.familywiseComparisons([task], {...protocol, bootstrap_replicates: 32});
  assert.equal(family.family_size, 18);
  assert.equal(family.margin_bps, 0);
  assert.ok(family.comparisons.filter(x => x.method === "minimum_cost").every(x => x.simultaneous_lower_95_bps === 10));
  policies.minimum_cost.scenarios.nominal[0].week = "2026-07-99";
  assert.throws(() => v2.familywiseComparisons([task], protocol), /Unpaired/);
});
