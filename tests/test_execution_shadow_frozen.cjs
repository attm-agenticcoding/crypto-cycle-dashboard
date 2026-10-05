"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const {execFileSync} = require("node:child_process");
const {ROOT, FROZEN, sha, config, protocol, compatibility, manifest, implementation, syntheticFixture} = require("./execution_shadow_synthetic.cjs");
const shadow = require(path.join(FROZEN, "scripts/execution_shadow.cjs"));
const engine = require(path.join(FROZEN, "scripts/execution_v2.cjs"));
const CONTRACT = "ef1ef81a5a6515ed9642f98a4a9df15c403e3e23f33879e7af8144f204578724";
const COMPATIBILITY_SHA = "857f1deb8d696d4f68b4cfc5374ac37e2311efab135a8df03cda6e02f83bc625";
const clone = value => JSON.parse(JSON.stringify(value));

function prepareReplay(root, label, fixture, restoreOnly = false) {
  fs.mkdirSync(path.join(root, ".research"), {recursive: true});
  const folder = fs.mkdtempSync(path.join(root, ".research", label));
  const values = {"input-protocol.json": protocol, "shadow-protocol.json": config, "sessions.json": fixture.dataset,
    "prior-state.json": fixture.state, "request.json": {...fixture.request, restore_only: restoreOnly}};
  for (const [name, value] of Object.entries(values)) fs.writeFileSync(path.join(folder, name), JSON.stringify(value));
  fs.copyFileSync(path.join(root, "research/execution-shadow-compatibility.json"), path.join(folder, "compatibility.json"));
  return folder;
}
function replay(root, folder) {
  execFileSync(process.execPath, [path.join(root, "scripts/execution_shadow.cjs"), folder], {stdio: "pipe"});
  return fs.readFileSync(path.join(folder, "export/shadow-state.json"));
}

test("all sixteen frozen originals retain their pinned Git blobs, SHA-256 hashes and exact contract", () => {
  assert.equal(Object.keys(manifest.files).length, 16);
  assert.equal(manifest.source_commit, "dcc2d5feb9a3054a7eae570e3b6ef487496e70e4");
  assert.equal(manifest.contract_hash, CONTRACT);
  assert.equal(shadow.digest({config, code: implementation}), CONTRACT);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(FROZEN, name));
    assert.equal(sha(bytes), expected.sha256, name);
    const gitBlob = require("node:crypto").createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(gitBlob, expected.git_blob, name);
  }
  for (const root of [ROOT, FROZEN])
    assert.equal(sha(fs.readFileSync(path.join(root, "research/execution-shadow-compatibility.json"))), COMPATIBILITY_SHA);
  assert.equal(sha(fs.readFileSync(path.join(FROZEN, "research/execution-v2-protocol.json"))), config.base_protocol_sha256);
  assert.equal(sha(fs.readFileSync(path.join(FROZEN, "data/execution_instruments.json"))), config.registry_sha256);
});

test("synthetic receipt payloads, hashes and settled results survive byte-identical idempotent replay", () => {
  const fixture = syntheticFixture(shadow, engine), original = Buffer.from(JSON.stringify(fixture.state));
  shadow.verifyState(fixture.state, CONTRACT);
  assert.equal(fixture.state.receipts.length, 12);
  assert.equal(fixture.state.evaluations.length, 16);
  const folder = prepareReplay(FROZEN, "synthetic-ledger-replay-", fixture);
  try {
    assert.deepEqual(replay(FROZEN, folder), original);
    assert.deepEqual(replay(FROZEN, folder), original);
    const report = JSON.parse(fs.readFileSync(path.join(folder, "export/report.json")));
    assert.equal(report.record_count, 12);
    assert.equal(report.complete_week_count, 1);
    assert.equal(report.promotion_allowed, false);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test("synthetic settlement reproduces all instrument/side/mode combinations and five policies by three scenarios", () => {
  const {dataset, state, request} = syntheticFixture(shadow, engine), expected = clone(state.evaluations);
  state.evaluations = [];
  const coverage = shadow.settle(dataset, protocol, config, state, request.mature_weeks);
  assert.equal(coverage.filter(row => row.complete).length, 4);
  assert.deepEqual(state.evaluations, expected);
  assert.ok(state.evaluations.every(row => Object.keys(row.payload.outcomes).length === 5));
  assert.ok(state.evaluations.every(row => Object.values(row.payload.outcomes).every(scenarios => Object.keys(scenarios).length === 3)));
  shadow.verifyState(state, CONTRACT);
});

test("poisoned live code and registry cannot change frozen synthetic settlement or decision planning", () => {
  const fixture = syntheticFixture(shadow, engine);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "execution-frozen-isolation-"));
  const root = path.join(tmp, "research/frozen/execution-prospective-2026-09-v1");
  try {
    fs.cpSync(FROZEN, root, {recursive: true, filter: name => !name.includes(`${path.sep}.research`) && !name.includes("__pycache__")});
    for (const name of Object.keys(manifest.files)) {
      const target = path.join(tmp, name);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, name.endsWith(".py") ? 'raise RuntimeError("LIVE CODE MUST NOT RUN")\n' :
        name.endsWith(".js") || name.endsWith(".cjs") ? 'throw new Error("LIVE CODE MUST NOT RUN");\n' : 'LIVE DATA MUST NOT LOAD\n');
    }
    const folder = prepareReplay(root, "synthetic-live-poison-", fixture);
    assert.deepEqual(replay(root, folder), Buffer.from(JSON.stringify(fixture.state)));
    const copied = require(path.join(root, "scripts/execution_shadow.cjs"));
    const copiedEngine = require(path.join(root, "scripts/execution_v2.cjs"));
    for (const data of fixture.dataset.instruments) for (const side of ["buy", "sell"]) for (const mode of protocol.modes) {
      const args = {instrument: data.instrument, side, candidate: engine.GRID[0], history: data.sessions,
        weekly: side === "buy" ? 10000 : 100, total: mode === "price_seeking" ? null : side === "buy" ? 12000 : 120,
        held: 200, reserved: 10, reference: data.sessions.at(-1).reference, daysLeft: 3};
      assert.deepEqual(copiedEngine.dailyPlan(args), engine.dailyPlan(args));
    }
    const regenerated = clone(fixture.state); regenerated.evaluations = [];
    copied.settle(fixture.dataset, protocol, config, regenerated, fixture.request.mature_weeks);
    assert.deepEqual(regenerated.evaluations, fixture.state.evaluations);
    for (const filename of Object.keys(require.cache).filter(name => name.startsWith(tmp + path.sep)))
      assert.ok(filename.startsWith(root + path.sep), filename);
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
});

test("the unchanged allowlist still rejects an altered frozen implementation", () => {
  const {state} = syntheticFixture(shadow, engine), before = shadow.digest(state);
  const changed = {...implementation, "execution/execution-core.js": "new-live-planner"};
  const contract = shadow.digest({config, code: changed});
  assert.notEqual(contract, CONTRACT);
  assert.throws(() => shadow.migrateOperationalContract(state, contract, compatibility, COMPATIBILITY_SHA, "test"), /Unapproved/);
  assert.equal(shadow.digest(state), before);
});

test("research workflows invoke only frozen entry points and preserve declared scheduling and outputs", () => {
  const prefix = "research/frozen/execution-prospective-2026-09-v1";
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/execution-prospective-shadow.yml"), "utf8");
  assert.equal((workflow.match(new RegExp(`python ${prefix}/scripts/run_execution_shadow.py`, "g")) || []).length, 2);
  assert.ok(!workflow.includes("python scripts/run_execution_shadow.py"));
  assert.ok(workflow.includes("path: ${{ steps.collect.outputs.output_path }}"));
  assert.ok(workflow.includes("name: ${{ steps.collect.outputs.artifact_name }}"));
  assert.ok(workflow.includes("cron: '17 5 * * *'"));
  assert.ok(workflow.includes("cron: '17 7 * * *'"));
  assert.ok(workflow.includes("overwrite: false"));
  const retrospective = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-execution-v2.yml"), "utf8");
  assert.ok(retrospective.includes(`python ${prefix}/scripts/prepare_execution_v2.py`));
  assert.ok(retrospective.includes(`node ${prefix}/scripts/validate_execution_v2.cjs`));
  assert.ok(retrospective.includes(`path: ${prefix}/.research/report/`));
});

test("synthetic restore-only seals without changing prior payloads, hashes, outcomes or migrations", () => {
  const fixture = syntheticFixture(shadow, engine), latest = fixture.state.receipts.at(-1);
  latest.seal = null;
  const metadata = {verified_github_source: true, artifact_id: 9999, run_id: latest.payload.run_id,
    source_commit: latest.payload.source_commit, created_at: "2026-09-19T09:25:00Z"};
  const folder = prepareReplay(FROZEN, "synthetic-restore-", fixture, true);
  try {
    fs.rmSync(path.join(folder, "sessions.json"));
    fs.writeFileSync(path.join(folder, "prior-artifact.json"), JSON.stringify(metadata));
    const restoredBytes = replay(FROZEN, folder), restored = JSON.parse(restoredBytes);
    assert.deepEqual(restored.receipts.map(r => r.payload), fixture.state.receipts.map(r => r.payload));
    assert.deepEqual(restored.receipts.map(r => r.hash), fixture.state.receipts.map(r => r.hash));
    assert.deepEqual(restored.evaluations, fixture.state.evaluations);
    assert.equal(restored.contract_hash, CONTRACT);
    assert.equal(restored.contract_migrations, undefined);
    assert.equal(restored.receipts.at(-1).seal.artifact_id, 9999);
    assert.equal(shadow.validReceipt(restored.receipts.at(-1)), true);
    assert.deepEqual(replay(FROZEN, folder), restoredBytes);
    fs.writeFileSync(path.join(folder, "prior-state.json"), restoredBytes);
    assert.deepEqual(replay(FROZEN, folder), restoredBytes);
    const report = JSON.parse(fs.readFileSync(path.join(folder, "export/report.json")));
    assert.equal(report.mode, "restore_only");
    assert.equal(report.fitted_new_decisions, false);
    assert.equal(report.evaluated_new_market_data, false);
    assert.equal(report.payloads_and_hashes_preserved, true);
    assert.equal(report.on_time_receipts, 12);
    assert.equal(report.settled_task_weeks, 16);
    assert.ok(!fs.existsSync(path.join(folder, "export/sessions.json")));
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});
