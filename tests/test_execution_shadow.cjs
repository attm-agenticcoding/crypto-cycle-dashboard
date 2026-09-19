const test = require("node:test"), assert = require("node:assert/strict");
const shadow = require("../scripts/execution_shadow.cjs"), engine = require("../scripts/execution_v2.cjs");
const config = require("../research/execution-shadow-protocol.json"), protocol = require("../research/execution-v2-protocol.json");
const instruments = require("../data/execution_instruments.json").instruments;
const instrument = instruments.find(i => i.market_calendar === "XNYS");
const clone = x => JSON.parse(JSON.stringify(x));
const state = () => ({schema_version: 1, contract_hash: "locked", receipts: [], evaluations: [], events: []});
const fakeFit = (dataset, side, mode) => ({instrument_id: dataset.instrument.instrument_id, side, mode,
  selections: Object.fromEntries(engine.METHODS.map(method => [method, {choice: method === "paired_confirmation" ? "equal_paced" : 0,
    raw_minimum: 0, reason: "test fixture"}]))});
const dates = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
const expected = {XNYS: [{week: dates[0], dates, terminal_date: "2026-09-28"}], "24X7": []};

function fixture() {
  const dataset = {instruments: [{instrument, price_source: "TEST_ONLY", sessions: dates.map((date, i) => ({date,
    reference: 35, low: 34, high: 36, pre_closeout_low: 34.5, pre_closeout_high: 35.5,
    closeout_reference: 35, next_reference: i === 4 ? 36 : 35, drawdown_pct: 2, runup_pct: 2})),
    weeks: [{week: dates[0], indices: [0, 1, 2, 3, 4], terminal_date: "2026-09-28"}]}]};
  const ledger = state();
  for (const day of dates) {
    const history = [{date: "2026-09-18", drawdown_pct: 2, runup_pct: 2}];
    const payload = {record_kind: "prospective", calendar: "XNYS", effective_date: day,
      generated_at: day + "T09:20:00Z", freeze_before: day + "T13:30:00Z", run_id: day, source_commit: "abc",
      previous_receipt_hash: ledger.receipts.at(-1)?.hash ?? null,
      tasks: ["buy", "sell"].flatMap(side => protocol.modes.map(mode => fakeFit(dataset.instruments[0], side, mode))),
      histories: {[instrument.instrument_id]: {buy: history, sell: history}}};
    ledger.receipts.push({hash: shadow.digest(payload), payload, seal: {verified_github_source: true,
      run_id: day, created_at: day + "T09:25:00Z", artifact_id: 100}});
  }
  return {dataset, ledger};
}

test("canonical hashes ignore key ordering but reject undefined/nonfinite evidence", () => {
  assert.equal(shadow.digest({b: 1, a: [2, 3]}), shadow.digest({a: [2, 3], b: 1}));
  assert.throws(() => shadow.digest({a: undefined}), /Undefined/);
  assert.throws(() => shadow.digest([NaN]), /Non-finite/);
});

test("hash chain and code contract detect modified, reordered, and duplicate receipts", () => {
  const {ledger} = fixture();
  shadow.verifyState(ledger, "locked");
  assert.throws(() => shadow.verifyState(ledger, "different"), /contract/);
  for (const edit of [s => { s.receipts[0].payload.effective_date = "2026-09-20"; }, s => s.receipts.reverse(), s => s.receipts.push(clone(s.receipts[0]))]) {
    const copy = clone(ledger); edit(copy);
    assert.throws(() => shadow.verifyState(copy, "locked"), /altered|Duplicate/);
  }
});

test("only an on-time immutable server seal can make a receipt prospective", () => {
  const {ledger} = fixture(), r = ledger.receipts[0];
  assert.equal(shadow.validReceipt(r), true);
  r.seal = null;
  assert.equal(shadow.validReceipt(r), false);
  assert.throws(() => shadow.sealImported(ledger, {created_at: "2026-09-21T09:21:00Z"}), /metadata/);
  const meta = {verified_github_source: true, run_id: dates[0], artifact_id: 100, source_commit: "abc", created_at: "2026-09-21T09:25:00Z"};
  assert.throws(() => shadow.sealImported(ledger, {...meta, source_commit: "wrong"}), /commits/);
  shadow.sealImported(ledger, meta);
  assert.equal(shadow.validReceipt(r), true);
  r.seal.created_at = "2026-09-21T13:30:00Z";
  assert.equal(shadow.validReceipt(r), false); // Exactly at the boundary is too late.
  r.seal.created_at = "2026-09-21T09:19:00Z";
  assert.equal(shadow.validReceipt(r), false);
  r.seal.created_at = "2026-09-21T09:25:00Z";
  r.payload.record_kind = "test_only";
  assert.equal(shadow.validReceipt(r), false);
});

test("retry cannot refit or replace an existing receipt, even if it was late", () => {
  const {dataset, ledger} = fixture();
  ledger.receipts[0].seal.created_at = dates[0] + "T15:00:00Z";
  const before = shadow.digest(ledger);
  const value = shadow.freezeCalendar(dataset, {}, {calendar: "XNYS", date: dates[0]}, protocol, config, ledger,
    () => { throw new Error("Do not run clock"); }, () => { throw new Error("Do not refit"); });
  assert.equal(value, null);
  assert.equal(shadow.digest(ledger), before);
});

test("generation finishing after the deadline is not frozen; future or stale input fails closed", () => {
  const {dataset} = fixture(), ledger = state();
  const target = {calendar: "XNYS", date: "2026-09-28", expected_data_session: "2026-09-25", freeze_before: "2026-09-28T13:30:00Z"};
  const request = {as_of: "2026-09-27"};
  shadow.freezeCalendar(dataset, request, target, protocol, config, ledger, () => new Date("2026-09-28T13:30:00Z"), fakeFit);
  assert.equal(ledger.receipts.length, 0);
  assert.equal(ledger.events[0].event, "late_generation_not_frozen");
  assert.throws(() => shadow.freezeCalendar(dataset, request, {...target, expected_data_session: "2026-09-24"}, protocol, config, ledger), /Stale/);
  assert.throws(() => shadow.freezeCalendar(dataset, {as_of: "2026-09-24"}, target, protocol, config, ledger), /Future/);
});

test("crypto history and historical fit agree on the extra completed-session lag", () => {
  const dataset = {instrument: instruments.find(i => i.market_calendar === "24X7"),
    sessions: Array.from({length: 70}, (_, i) => ({date: String(i), drawdown_pct: i, runup_pct: i}))};
  assert.equal(engine.availableHistory(dataset, "sell", 69).at(-1).date, "68");
  assert.equal(engine.availableHistory({...dataset, observation_lag_sessions: 1}, "sell", 69).at(-1).date, "67");
  assert.equal(engine.availableHistory({...dataset, observation_lag_sessions: 1}, "buy", 69).at(-1).date, "67");
  assert.equal(engine.availableHistory({...dataset, instrument}, "buy", 69).at(-1).date, "67");
});

test("a new freeze stores side-specific samples and the crypto historical-lag contract", () => {
  for (const calendar of ["XNYS", "24X7"]) {
    const {dataset} = fixture(), ledger = state();
    if (calendar === "24X7") dataset.instruments[0].instrument = instruments.find(i => i.market_calendar === calendar);
    const item = dataset.instruments[0], lags = [];
    const request = {record_kind: "test_only", as_of: "2026-09-25", input_snapshot_sha256: "input-hash", run_id: "test", source_commit: "abc"};
    const target = {calendar, date: "2026-09-27", expected_data_session: "2026-09-25", freeze_before: "2026-09-27T00:00:00Z",
      reference_at: "2026-09-27T00:00:00Z", execution_starts_at: "2026-09-27T00:01:00Z"};
    const receipt = shadow.freezeCalendar(dataset, request, target, protocol, config, ledger, () => new Date("2026-09-26T09:20:00Z"),
      (data, side, mode) => { lags.push(data.observation_lag_sessions); return fakeFit(data, side, mode); });
    assert.equal(receipt.payload.histories[item.instrument.instrument_id].buy.at(-1).date, calendar === "XNYS" ? "2026-09-24" : "2026-09-25");
    assert.equal(receipt.payload.histories[item.instrument.instrument_id].sell.at(-1).date, "2026-09-25");
    assert.ok(lags.every(lag => lag === (calendar === "24X7" ? 1 : 0)));
    assert.equal(receipt.seal, null); assert.equal(shadow.validReceipt(receipt), false);
    shadow.verifyState(ledger, "locked");
  }
});

test("unsealed or missing daily receipt invalidates the full week for every method", () => {
  for (const missing of ["unsealed", "late", "absent", "test_only"]) {
    const {dataset, ledger} = fixture();
    if (missing === "unsealed") ledger.receipts[2].seal = null;
    if (missing === "late") ledger.receipts[2].seal.created_at = dates[2] + "T14:00:00Z";
    if (missing === "absent") ledger.receipts.splice(2, 1);
    if (missing === "test_only") ledger.receipts[2].payload.record_kind = "test_only";
    const coverage = shadow.settle(dataset, protocol, config, ledger, expected);
    assert.equal(ledger.evaluations.length, 0);
    assert.equal(coverage[0].complete, false);
    assert.deepEqual(coverage[0].missing_or_late_receipts, [dates[2]]);
  }
});

test("missing market weeks are explicit coverage failures rather than disappearing", () => {
  const {dataset, ledger} = fixture(); dataset.instruments[0].weeks = [];
  const coverage = shadow.settle(dataset, protocol, config, ledger, expected);
  assert.equal(coverage.length, 1); assert.equal(coverage[0].missing_market_data, true);
  assert.equal(shadow.reportState(ledger, config, coverage, protocol, [instrument.instrument_id]).summary.complete_week_count, 0);
});

test("settlement uses only frozen choices, is idempotent, and refuses to rewrite revised results", () => {
  const {dataset, ledger} = fixture();
  const coverage = shadow.settle(dataset, protocol, config, ledger, expected);
  assert.equal(ledger.evaluations.length, 4);
  assert.equal(Object.keys(ledger.evaluations[0].payload.outcomes).length, 5);
  assert.equal(Object.keys(ledger.evaluations[0].payload.outcomes.minimum_cost).length, 3);
  shadow.verifyState(ledger, "locked");
  const frozen = shadow.digest(ledger.evaluations);
  shadow.settle(dataset, protocol, config, ledger, expected);
  assert.equal(shadow.digest(ledger.evaluations), frozen);
  const report = shadow.reportState(ledger, config, coverage, protocol, [instrument.instrument_id]);
  assert.equal(report.summary.complete_week_count, 1);
  assert.equal(report.summary.tasks.length, 4); assert.equal(report.summary.family, null);
  assert.equal(report.summary.promotion_allowed, false);
  const missingCohort = shadow.reportState(ledger, config, coverage, protocol, [instrument.instrument_id, "missing"]);
  assert.equal(missingCohort.summary.complete_week_count, 0);
  ledger.evaluations[0].payload.outcomes.minimum_cost.nominal.cost_bps = 999;
  assert.throws(() => shadow.verifyState(ledger, "locked"), /settled result/);
  dataset.instruments[0].sessions[0].reference = 99;
  assert.throws(() => shadow.settle(dataset, protocol, config, ledger, expected), /revised/);
});

test("frozen hit samples are used even if later input history changes; future samples are rejected", () => {
  const {dataset} = fixture(), input = dataset.instruments[0];
  const earlier = Array.from({length: 60}, () => ({date: "2026-09-18", drawdown_pct: 0, runup_pct: 0}));
  input.sessions = [...earlier, ...input.sessions]; input.weeks[0].indices = [60, 61, 62, 63, 64];
  const frozenHistory = [{date: "2026-09-18", drawdown_pct: 2, runup_pct: 2}];
  const run = history => engine.simulateWeek(input, input.weeks[0], "buy", "price_seeking", protocol.scenarios[0], protocol,
    () => ({choice: 0, history}));
  const before = run(frozenHistory);
  earlier.forEach(row => { row.drawdown_pct = 100; });
  assert.deepEqual(run(frozenHistory), before);
  assert.throws(() => run([{date: "2026-09-21", drawdown_pct: 100}]), /strictly before/);
});

test("joint checks wait for all twelve complete weeks and can never promote", () => {
  const {dataset, ledger} = fixture();
  const oneCoverage = shadow.settle(dataset, protocol, config, ledger, expected);
  const oneWeek = clone(ledger.evaluations), coverage = [];
  ledger.evaluations = [];
  for (let i = 0; i < 12; i++) {
    const day = new Date("2026-09-21T00:00:00Z"); day.setUTCDate(day.getUTCDate() + i * 7);
    const week = day.toISOString().slice(0, 10);
    coverage.push({...oneCoverage[0], week});
    for (const row of clone(oneWeek)) {
      row.payload.week = week;
      for (const scenarios of Object.values(row.payload.outcomes)) for (const outcome of Object.values(scenarios)) outcome.week = week;
      row.hash = shadow.digest(row.payload); ledger.evaluations.push(row);
    }
  }
  const report = shadow.reportState(ledger, config, coverage, protocol, [instrument.instrument_id]);
  assert.equal(report.summary.complete_week_count, 12);
  assert.equal(report.summary.family.family_size, 72);
  assert.equal(report.summary.status, "review_required_no_automatic_promotion");
  assert.ok(report.summary.tasks.every(t => Object.values(t.gates).every(g => g.promotion_allowed === false)));
  coverage[0].complete = false;
  const failed = shadow.reportState(ledger, config, coverage, protocol, [instrument.instrument_id], "2026-12-16").summary;
  assert.equal(failed.family, null);
  assert.equal(failed.status, "trial_ended_insufficient_prospective_coverage");
});
