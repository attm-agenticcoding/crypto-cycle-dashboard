/* Generated test-only market observations and receipts. No archived trial data. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
const FROZEN = path.join(ROOT, "research/frozen/execution-prospective-2026-09-v1");
const sha = data => crypto.createHash("sha256").update(data).digest("hex");
const readFrozen = name => JSON.parse(fs.readFileSync(path.join(FROZEN, name)));
const config = readFrozen("research/execution-shadow-protocol.json");
const protocol = readFrozen("research/execution-v2-protocol.json");
const compatibility = readFrozen("research/execution-shadow-compatibility.json");
const manifest = readFrozen("frozen-manifest.json");
const CODE_FILES = JSON.parse(fs.readFileSync(path.join(FROZEN, "scripts/run_execution_shadow.py"), "utf8").match(/CODE_FILES = (\[[\s\S]*?\])/)[1]);
const implementation = Object.fromEntries(CODE_FILES.map(name => [name, sha(fs.readFileSync(path.join(FROZEN, name)))]));
function syntheticFixture(shadow, engine) {
  const instruments = readFrozen("data/execution_instruments.json").instruments;
  const dates = count => Array.from({length: count}, (_, i) => `2026-09-${21 + i}`);
  const matureWeeks = {XNYS: [{week: "2026-09-21", dates: dates(5), terminal_date: "2026-09-28"}],
    "24X7": [{week: "2026-09-21", dates: dates(7), terminal_date: "2026-09-28"}]};
  const dataset = {registry_sha256: config.registry_sha256,
    protocol_sha256: sha(JSON.stringify(protocol)), instruments: instruments.map(instrument => {
      const days = dates(instrument.market_calendar === "XNYS" ? 5 : 7), reference = instrument.default_reference_price;
      return {instrument, price_source: "SYNTHETIC_TEST_ONLY", sessions: days.map(date => ({date,
        reference, low: reference * .96, high: reference * 1.04,
        pre_closeout_low: reference * .98, pre_closeout_high: reference * 1.02,
        closeout_reference: reference, next_reference: reference * 1.01,
        drawdown_pct: 4, runup_pct: 4})),
        weeks: [{week: days[0], indices: days.map((_, i) => i), terminal_date: "2026-09-28"}]};
    })};
  const state = {schema_version: 1, contract_hash: manifest.contract_hash,
    experiment_id: config.experiment_id, receipts: [], evaluations: [], events: []};
  for (const calendar of ["XNYS", "24X7"]) for (const date of matureWeeks[calendar][0].dates) {
    const items = dataset.instruments.filter(item => item.instrument.market_calendar === calendar);
    const history = [{date: "2026-09-18", drawdown_pct: 3, runup_pct: 3}];
    // Simulate the prospective flag and server seal solely to exercise coverage validation.
    const payload = {record_kind: "prospective", experiment_id: config.experiment_id,
      calendar, effective_date: date, generated_at: "2026-09-19T09:20:00Z",
      freeze_before: date + (calendar === "XNYS" ? "T13:30:00Z" : "T00:00:00Z"),
      run_id: `synthetic-${calendar}-${date}`, source_commit: "synthetic-test-only",
      previous_receipt_hash: state.receipts.at(-1)?.hash ?? null,
      tasks: items.flatMap(item => ["buy", "sell"].flatMap(side => protocol.modes.map(mode => ({
        instrument_id: item.instrument.instrument_id, side, mode,
        selections: Object.fromEntries(engine.METHODS.map(method => [method, {
          choice: method === "paired_confirmation" ? "equal_paced" : 0, raw_minimum: 0, reason: "Synthetic test fixture"}]))})))),
      histories: Object.fromEntries(items.map(item => [item.instrument.instrument_id, {buy: history, sell: history}]))};
    state.receipts.push({hash: shadow.digest(payload), payload, seal: {verified_github_source: true,
      run_id: payload.run_id, artifact_id: 1000 + state.receipts.length, created_at: "2026-09-19T09:25:00Z"}});
  }
  shadow.settle(dataset, protocol, config, state, matureWeeks);
  const request = {record_kind: "test_only", run_id: "synthetic-test-only", planned_at: "2026-09-29T09:00:00Z",
    restore_only: false, targets: [], mature_weeks: matureWeeks, registry_sha256: config.registry_sha256,
    instrument_ids: instruments.map(item => item.instrument_id).sort(), implementation_sha256: implementation,
    dispatch: {event: "local"}, compatibility_manifest_sha256: sha(fs.readFileSync(path.join(FROZEN, "research/execution-shadow-compatibility.json")))};
  return {dataset, state, request};
}
module.exports = {ROOT, FROZEN, sha, config, protocol, compatibility, manifest, implementation, syntheticFixture};
