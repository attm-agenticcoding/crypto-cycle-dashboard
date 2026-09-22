const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), {execFileSync} = require("node:child_process");
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

test("GitHub whole-second seals accept the real 218ms precision-loss case without changing payloads", () => {
  const ledger = state(), generated = "2026-09-21T15:56:35.218Z";
  const payload = {record_kind: "prospective", calendar: "24X7", effective_date: "2026-09-22",
    generated_at: generated, freeze_before: "2026-09-22T00:00:00Z", run_id: "35622136814",
    source_commit: "1b8cb762acce4cbb1b5923b833ffbf3b8fa7fd30", previous_receipt_hash: null};
  const receipt = {payload, hash: shadow.digest(payload), seal: null};
  ledger.receipts.push(receipt);
  const before = shadow.digest(payload);
  shadow.sealImported(ledger, {verified_github_source: true, artifact_id: 10649937490,
    run_id: payload.run_id, source_commit: payload.source_commit, created_at: "2026-09-21T15:56:35Z"});
  assert.equal(shadow.validReceipt(receipt), true);
  assert.equal(receipt.seal.created_at, "2026-09-21T15:56:35Z");
  assert.equal(receipt.payload.generated_at, generated);
  assert.equal(receipt.hash, before);
  shadow.verifyState(ledger, "locked");
});

test("timestamp bounds reject invalid calendars, offsets and unsupported precision", () => {
  for (const invalid of [null, 123, "not-a-date", "2026-02-30T00:00:00Z", "2026-09-21T24:00:00Z",
    "2026-09-21T00:00:00+00:00", "2026-09-21T00:00:00.1234Z"])
    assert.equal(shadow.timestampBounds(invalid), null);
  for (const [fraction, ms] of [["", 1000], [".2", 100], [".21", 10], [".218", 1]]) {
    const b = shadow.timestampBounds("2026-09-21T15:56:35" + fraction + "Z");
    assert.equal(b.precisionMs, ms); assert.equal(b.upperExclusive - b.lower, ms);
  }
});

test("precision-aware comparisons still reject real reversal and all late/deadline-ambiguous seals", () => {
  const {ledger} = fixture(), receipt = ledger.receipts[0];
  receipt.payload.generated_at = "2026-09-21T13:29:59.218Z";
  for (const [stamp, valid] of [
    ["2026-09-21T13:29:58Z", false], ["2026-09-21T13:29:59.217Z", false],
    ["2026-09-21T13:29:59.218Z", true], ["2026-09-21T13:29:59Z", true],
    ["2026-09-21T13:29:59.999Z", true], ["2026-09-21T13:30:00Z", false],
    ["2026-09-21T13:30:00.000Z", false], ["2026-09-21T13:30:01Z", false], ["bad", false]]) {
    receipt.seal.created_at = stamp;
    assert.equal(shadow.validReceipt(receipt), valid, stamp);
  }
  receipt.payload.freeze_before = "2026-09-21T13:29:59.500Z";
  receipt.seal.created_at = "2026-09-21T13:29:59Z";
  assert.equal(shadow.validReceipt(receipt), false); // Unknown part of the same second crosses the cutoff.
  receipt.payload.generated_at = receipt.payload.freeze_before;
  receipt.seal.created_at = "2026-09-21T13:29:59.500Z";
  assert.equal(shadow.validReceipt(receipt), false);
});

test("a failed import leaves every pending seal untouched", () => {
  const {ledger} = fixture(), first = ledger.receipts[0], second = ledger.receipts[1];
  first.seal = second.seal = null;
  second.payload.run_id = first.payload.run_id;
  second.payload.generated_at = "2026-09-21T09:25:01.001Z";
  const before = shadow.digest(ledger);
  assert.throws(() => shadow.sealImported(ledger, {verified_github_source: true, artifact_id: 100,
    run_id: first.payload.run_id, source_commit: "abc", created_at: "2026-09-21T09:25:00Z"}), /predates/);
  assert.equal(shadow.digest(ledger), before);
});

test("only an exact predeclared maintenance migration is allowed, with immutable decisions and audit", () => {
  const {ledger} = fixture(); ledger.experiment_id = config.experiment_id;
  const entry = {experiment_id: config.experiment_id, from_contract: "locked", to_contract: "repaired",
    decision_policy_changed: false, reason: "precision-only test"};
  const manifest = {migrations: [entry]}, original = shadow.digest({receipts: ledger.receipts, evaluations: ledger.evaluations});
  for (const rejected of [[], [{...entry, to_contract: "other"}], [{...entry, experiment_id: "other"}],
    [{...entry, decision_policy_changed: true}]]) {
    const copy = clone(ledger), before = shadow.digest(copy);
    assert.throws(() => shadow.migrateOperationalContract(copy, "repaired", {migrations: rejected}, "manifest", "test"), /Unapproved/);
    assert.equal(shadow.digest(copy), before);
  }
  assert.equal(shadow.migrateOperationalContract(ledger, "repaired", manifest, "manifest", "test",
    () => new Date("2026-09-22T02:00:00Z")), true);
  assert.equal(ledger.origin_contract_hash, "locked");
  assert.equal(ledger.contract_hash, "repaired");
  assert.equal(ledger.contract_migrations.length, 1);
  assert.equal(ledger.contract_migrations[0].payload.preserved_tip_hash, ledger.receipts.at(-1).hash);
  assert.equal(shadow.digest({receipts: ledger.receipts, evaluations: ledger.evaluations}), original);
  assert.equal(shadow.migrateOperationalContract(ledger, "repaired", manifest, "manifest", "test"), false);
  assert.equal(ledger.contract_migrations.length, 1);
  assert.throws(() => shadow.migrateOperationalContract(ledger, "unreviewed-future-code", manifest, "manifest", "test"), /Unapproved/);
  shadow.verifyState(ledger, "repaired");
  ledger.contract_migrations[0].payload.reason = "changed";
  assert.throws(() => shadow.verifyState(ledger, "repaired"), /audit/);
});

test("the maintenance release does not change fitting, freezing or settlement policy functions", () => {
  const manifest = require("../research/execution-shadow-compatibility.json");
  for (const [name, expected] of Object.entries(manifest.unchanged_shadow_functions))
    assert.equal(crypto.createHash("sha256").update(shadow[name].toString()).digest("hex"), expected, name);
});

test("restore-only CLI recovers an old contract without any sessions file and is idempotent", () => {
  const root = path.resolve(__dirname, ".."), manifest = require("../research/execution-shadow-compatibility.json");
  const hash = x => crypto.createHash("sha256").update(x).digest("hex");
  const files = JSON.parse(fs.readFileSync(path.join(root, "scripts/run_execution_shadow.py"), "utf8").match(/CODE_FILES = (\[[\s\S]*?\])/)[1]);
  const request = {record_kind: "test_only", run_id: "recovery-test", restore_only: true,
    dispatch: {event: "local"}, compatibility_manifest_sha256: hash(fs.readFileSync(path.join(root, "research/execution-shadow-compatibility.json"))),
    implementation_sha256: Object.fromEntries(files.map(f => [f, hash(fs.readFileSync(path.join(root, f)))]))};
  const {ledger} = fixture(); ledger.receipts = ledger.receipts.slice(0, 1);
  ledger.contract_hash = manifest.migrations[0].from_contract; ledger.experiment_id = config.experiment_id;
  ledger.receipts[0].seal = null;
  ledger.receipts[0].payload.generated_at = "2026-09-21T09:25:00.218Z";
  ledger.receipts[0].hash = shadow.digest(ledger.receipts[0].payload);
  const original = clone(ledger.receipts[0]);
  fs.mkdirSync(path.join(root, ".research"), {recursive: true});
  const folder = fs.mkdtempSync(path.join(root, ".research/shadow-restore-test-"));
  try {
    const content = {"request.json": request, "shadow-protocol.json": config, "input-protocol.json": protocol,
      "prior-state.json": ledger, "prior-artifact.json": {verified_github_source: true, run_id: dates[0],
        artifact_id: 100, source_commit: "abc", created_at: "2026-09-21T09:25:00Z"}};
    for (const [file, value] of Object.entries(content)) fs.writeFileSync(path.join(folder, file), JSON.stringify(value));
    fs.copyFileSync(path.join(root, "research/execution-shadow-compatibility.json"), path.join(folder, "compatibility.json"));
    const run = () => {
      execFileSync(process.execPath, [path.join(root, "scripts/execution_shadow.cjs"), folder]);
      return JSON.parse(fs.readFileSync(path.join(folder, "export/shadow-state.json")));
    };
    const recovered = run(), report = JSON.parse(fs.readFileSync(path.join(folder, "export/report.json")));
    assert.deepEqual(recovered.receipts[0].payload, original.payload);
    assert.equal(recovered.receipts[0].hash, original.hash);
    assert.equal(recovered.contract_hash, manifest.migrations[0].to_contract);
    assert.equal(recovered.contract_migrations.length, 1);
    assert.equal(report.on_time_receipts, 1);
    assert.equal(report.fitted_new_decisions, false);
    assert.equal(report.evaluated_new_market_data, false);
    assert.equal(report.production_modified, false);
    assert.equal(report.promotion_allowed, false);
    assert.equal(fs.existsSync(path.join(folder, "sessions.json")), false);
    fs.writeFileSync(path.join(folder, "prior-state.json"), JSON.stringify(recovered));
    assert.deepEqual(run(), recovered);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true}); // Only this generated test directory.
  }
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
