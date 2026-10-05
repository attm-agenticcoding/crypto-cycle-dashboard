/* Prospective research only. No broker or publishing capabilities. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const engine = require("./execution_v2.cjs");
const ROOT = path.resolve(__dirname, "..");
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite research value");
  if (value === undefined) throw new Error("Undefined research value");
  return JSON.stringify(value);
}
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const digest = value => sha(canonical(value));
const key = (calendar, day) => `${calendar}:${day}`;

// An API timestamp without fractional digits identifies a whole second, not
// its first millisecond. Keep the raw timestamp and compare precision bounds.
function timestampBounds(value) {
  const match = typeof value === "string" && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const lower = match ? Date.parse(value) : NaN;
  if (!Number.isFinite(lower) || new Date(lower).toISOString().slice(0, 19) !== match[1]) return null;
  const precisionMs = 10 ** (3 - (match[2]?.length || 0));
  return {lower, upperExclusive: lower + precisionMs, precisionMs};
}
function sealTiming(receipt, createdAt) {
  const artifact = timestampBounds(createdAt), generated = timestampBounds(receipt.payload.generated_at),
    deadline = timestampBounds(receipt.payload.freeze_before);
  if (!artifact || !generated || !deadline) return {valid: false, predates: false};
  const predates = artifact.upperExclusive <= generated.lower;
  return {predates, valid: !predates && generated.lower < deadline.lower && artifact.upperExclusive <= deadline.lower};
}

function verifyState(state, contract) {
  if (!state || state.schema_version !== 1 || state.contract_hash !== contract) throw new Error("Different or invalid experiment/code contract; never blend versions");
  const ids = new Set();
  let previous = null;
  for (const receipt of state.receipts) {
    if (receipt.hash !== digest(receipt.payload) || receipt.payload.previous_receipt_hash !== previous) throw new Error("Frozen receipt hash chain was altered");
    const id = key(receipt.payload.calendar, receipt.payload.effective_date);
    if (ids.has(id)) throw new Error("Duplicate frozen session receipt");
    ids.add(id); previous = receipt.hash;
    if (receipt.seal && receipt.seal.run_id !== receipt.payload.run_id) throw new Error("Seal and originating run do not match");
  }
  const weeks = new Set();
  for (const item of state.evaluations) {
    if (item.hash !== digest(item.payload)) throw new Error("A settled result was altered");
    const id = `${item.payload.instrument_id}:${item.payload.side}:${item.payload.mode}:${item.payload.week}`;
    if (weeks.has(id)) throw new Error("Duplicate settled result");
    weeks.add(id);
  }
  let priorContract = state.origin_contract_hash || state.contract_hash;
  for (const migration of state.contract_migrations || []) {
    if (migration.hash !== digest(migration.payload) || migration.payload.from_contract !== priorContract)
      throw new Error("Operational migration audit was altered");
    priorContract = migration.payload.to_contract;
  }
  if (priorContract !== state.contract_hash) throw new Error("Operational migration does not reach the current contract");
}
function migrateOperationalContract(state, contract, manifest, manifestHash, runId, clock = () => new Date()) {
  verifyState(state, state.contract_hash);
  if (state.contract_hash === contract) return false;
  const allowed = manifest?.migrations?.find(m => m.from_contract === state.contract_hash && m.to_contract === contract &&
    m.experiment_id === state.experiment_id && m.decision_policy_changed === false);
  if (!allowed) throw new Error("Unapproved experiment/code contract change; never blend versions");
  const payload = {from_contract: state.contract_hash, to_contract: contract, reason: allowed.reason,
    manifest_sha256: manifestHash, run_id: runId, migrated_at: clock().toISOString(),
    preserved_receipt_count: state.receipts.length, preserved_tip_hash: state.receipts.at(-1)?.hash ?? null,
    preserved_evaluations_sha256: digest(state.evaluations), decision_policy_changed: false};
  state.origin_contract_hash ||= state.contract_hash;
  state.contract_migrations ||= [];
  state.contract_migrations.push({hash: digest(payload), payload});
  state.contract_hash = contract;
  verifyState(state, contract);
  return true;
}
function sealImported(state, metadata) {
  if (!metadata?.verified_github_source || !timestampBounds(metadata.created_at))
    throw new Error("Official immutable artifact metadata required");
  const pending = state.receipts.filter(r => !r.seal && r.payload.run_id === metadata.run_id);
  // Validate the full import first. An error must not partially seal a ledger.
  for (const receipt of pending) {
    if (receipt.payload.source_commit !== metadata.source_commit) throw new Error("Artifact and receipt source commits differ");
    if (!timestampBounds(receipt.payload.generated_at) || !timestampBounds(receipt.payload.freeze_before)) throw new Error("Invalid receipt timestamp");
    if (sealTiming(receipt, metadata.created_at).predates) throw new Error("Artifact predates its payload");
  }
  for (const receipt of pending) {
    receipt.seal = {artifact_id: metadata.artifact_id, run_id: metadata.run_id,
      created_at: metadata.created_at, timestamp_comparison: "precision_interval_v1", verified_github_source: true};
  }
}
function validReceipt(receipt) {
  return !!receipt && receipt.payload.record_kind === "prospective" && receipt.seal?.verified_github_source === true &&
    receipt.seal.run_id === receipt.payload.run_id && sealTiming(receipt, receipt.seal.created_at).valid;
}

function fitTask(dataset, side, mode, protocol, previous) {
  const weeks = engine.canonicalWeeks(dataset, protocol);
  const training = weeks.map((w, i) => i).slice(-protocol.score_weeks);
  if (training.length !== protocol.score_weeks) throw new Error("Not enough common completed training weeks");
  const active = new Set(training), scenario = protocol.scenarios[0];
  const baselines = Object.fromEntries(engine.BASELINES.map(name => [name, weeks.map((w, i) => active.has(i) ?
    engine.simulateWeek(dataset, w, side, mode, scenario, protocol, () => ({choice: name})) : null)]));
  const costs = engine.GRID.map((_, c) => weeks.map((w, i) => active.has(i) ?
    engine.simulateWeek(dataset, w, side, mode, scenario, protocol, () => ({choice: c})).cost_bps : null));
  const window = training.map(i => ({week: weeks[i].week, terminal: weeks[i].terminal_date}));
  const fingerprint = digest({window, costs: costs.map(row => training.map(i => row[i])), baselines, lag: dataset.observation_lag_sessions || 0});
  const selections = {};
  for (const method of engine.METHODS) {
    const selected = previous?.training_fingerprint === fingerprint ? previous.selections[method] :
      engine.chooseCandidate(method, costs, baselines, training, previous?.selections?.[method]?.choice ?? null, protocol);
    selections[method] = {...selected, adopted_parameters: typeof selected.choice === "number" ? engine.GRID[selected.choice] : null,
      raw_minimum_parameters: engine.GRID[selected.raw_minimum]};
  }
  return {instrument_id: dataset.instrument.instrument_id, side, mode, training_fingerprint: fingerprint,
    training_weeks: window, selections, candidate_score_digest: digest(costs), price_source: dataset.price_source};
}

function freezeCalendar(dataset, request, target, protocol, config, state, clock = () => new Date(), fit = fitTask) {
  if (state.receipts.some(r => key(r.payload.calendar, r.payload.effective_date) === key(target.calendar, target.date)))
    return null; // First receipt is immutable, even if late.
  const inputs = dataset.instruments.filter(x => x.instrument.market_calendar === target.calendar);
  if (!inputs.length) throw new Error("No instruments for this calendar");
  const tasks = [], histories = {};
  for (const item of inputs) {
    if (item.sessions.at(-1)?.date !== target.expected_data_session) throw new Error(`Stale/incomplete observations for ${item.instrument.instrument_id}`);
    if (item.sessions.some(row => row.date > request.as_of || row.date >= target.date)) throw new Error("Future observation in freeze input");
    const end = item.sessions.length;
    histories[item.instrument.instrument_id] = {
      buy: item.sessions.slice(Math.max(0, end - 61), target.calendar === "XNYS" ? end - 1 : end)
        .slice(-60).map(({date, drawdown_pct, runup_pct}) => ({date, drawdown_pct, runup_pct})),
      sell: item.sessions.slice(-60).map(({date, drawdown_pct, runup_pct}) => ({date, drawdown_pct, runup_pct}))};
    const trainingData = {...item, observation_lag_sessions: target.calendar === "24X7" ? config.crypto_historical_observation_lag_sessions : 0};
    for (const side of ["buy", "sell"]) for (const mode of protocol.modes) {
      const prior = [...state.receipts].reverse().find(r => validReceipt(r) && r.payload.calendar === target.calendar && r.payload.effective_date < target.date);
      const previous = prior?.payload.tasks.find(t => t.instrument_id === item.instrument.instrument_id && t.side === side && t.mode === mode);
      tasks.push(fit(trainingData, side, mode, protocol, previous));
    }
  }
  const generatedAt = clock().toISOString();
  if (Date.parse(generatedAt) >= Date.parse(target.freeze_before)) {
    state.events.push({event: "late_generation_not_frozen", calendar: target.calendar, date: target.date, generated_at: generatedAt});
    return null;
  }
  const payload = {record_kind: request.record_kind, experiment_id: config.experiment_id,
    calendar: target.calendar, effective_date: target.date, freeze_before: target.freeze_before,
    reference_at: target.reference_at, execution_starts_at: target.execution_starts_at,
    generated_at: generatedAt, data_as_of: request.as_of, last_observation_date: target.expected_data_session,
    input_snapshot_sha256: request.input_snapshot_sha256, run_id: request.run_id, source_commit: request.source_commit,
    previous_receipt_hash: state.receipts.at(-1)?.hash ?? null, tasks, histories};
  const receipt = {hash: digest(payload), payload, seal: null};
  state.receipts.push(receipt);
  return receipt;
}

function settle(dataset, protocol, config, state, matureWeeks) {
  const coverage = [];
  for (const input of dataset.instruments) for (const expected of matureWeeks[input.instrument.market_calendar]) {
    const calendar = input.instrument.market_calendar;
    const week = input.weeks.find(w => w.week === expected.week && w.terminal_date === expected.terminal_date &&
      canonical(w.indices.map(i => input.sessions[i].date)) === canonical(expected.dates));
    if (!week) {
      coverage.push({instrument_id: input.instrument.instrument_id, week: expected.week, complete: false,
        missing_market_data: true, missing_or_late_receipts: expected.dates.filter(day => !validReceipt(state.receipts.find(r =>
          r.payload.calendar === calendar && r.payload.effective_date === day)))});
      if (state.evaluations.some(e => e.payload.instrument_id === input.instrument.instrument_id && e.payload.week === expected.week))
        throw new Error("Previously settled market week is now missing; review instead of rewriting performance");
      continue;
    }
    const receipts = week.indices.map(i => state.receipts.find(r => r.payload.calendar === calendar && r.payload.effective_date === input.sessions[i].date));
    const missing = week.indices.filter((i, j) => !validReceipt(receipts[j])).map(i => input.sessions[i].date);
    coverage.push({instrument_id: input.instrument.instrument_id, week: week.week, complete: !missing.length,
      missing_market_data: false, missing_or_late_receipts: missing});
    if (missing.length) continue;
    for (const side of ["buy", "sell"]) for (const mode of protocol.modes) {
      const already = state.evaluations.find(e => e.payload.instrument_id === input.instrument.instrument_id && e.payload.week === week.week &&
        e.payload.side === side && e.payload.mode === mode);
      const evidenceHash = digest({rows: week.indices.map(i => input.sessions[i]), receipts: receipts.map(r => r.hash)});
      if (already) {
        if (already.payload.evidence_hash !== evidenceHash) throw new Error("Settled market observations were revised; review instead of rewriting performance");
        continue;
      }
      const payload = {instrument_id: input.instrument.instrument_id, side, mode, week: week.week,
        price_source: input.price_source, evidence_hash: evidenceHash, receipt_hashes: receipts.map(r => r.hash), outcomes: {}};
      for (const method of [...engine.METHODS, ...engine.BASELINES]) {
        payload.outcomes[method] = {};
        for (const scenario of protocol.scenarios) payload.outcomes[method][scenario.name] = engine.simulateWeek(input, week, side, mode, scenario, protocol, i => {
          const receipt = receipts[week.indices.indexOf(i)].payload;
          const frozen = receipt.tasks.find(t => t.instrument_id === input.instrument.instrument_id && t.side === side && t.mode === mode);
          if (!frozen) throw new Error("Frozen task missing; retrospective selection is forbidden");
          return {choice: engine.BASELINES.includes(method) ? method : frozen.selections[method].choice,
            history: receipt.histories[input.instrument.instrument_id][side], receipt_hash: receipts[week.indices.indexOf(i)].hash};
        });
      }
      state.evaluations.push({hash: digest(payload), payload});
    }
  }
  return coverage;
}

function reportState(state, config, coverage, protocol, instrumentIds, runDate = null) {
  const rows = state.receipts.map(receipt => ({calendar: receipt.payload.calendar, effective_date: receipt.payload.effective_date,
    generated_at: receipt.payload.generated_at, sealed_at: receipt.seal?.created_at ?? null,
    status: receipt.payload.record_kind !== "prospective" ? "test_only" : !receipt.seal ? "awaiting_immutable_artifact_seal" : validReceipt(receipt) ? "frozen_on_time" : "late_not_eligible"}));
  const completed = [...new Set(state.evaluations.map(e => e.payload.week))].filter(week => {
    const row = coverage.filter(c => c.week === week);
    return instrumentIds.every(id => row.some(c => c.instrument_id === id && c.complete)) &&
      instrumentIds.every(id => ["buy", "sell"].every(side => protocol.modes.every(mode =>
        state.evaluations.some(e => e.payload.week === week && e.payload.instrument_id === id && e.payload.side === side && e.payload.mode === mode))));
  });
  const tasks = [];
  if (completed.length) for (const instrument_id of instrumentIds) for (const side of ["buy", "sell"]) for (const mode of protocol.modes) {
    const results = state.evaluations.map(e => e.payload).filter(e => e.instrument_id === instrument_id && e.side === side && e.mode === mode && completed.includes(e.week))
      .sort((a, b) => a.week.localeCompare(b.week));
    const policies = Object.fromEntries([...engine.METHODS, ...engine.BASELINES].map(method => [method, {
      scenarios: Object.fromEntries(protocol.scenarios.map(s => [s.name, results.map(r => r.outcomes[method][s.name])])),
      summary: Object.fromEntries(protocol.scenarios.map(s => [s.name, engine.summary(results.map(r => r.outcomes[method][s.name]))]))}]));
    tasks.push({instrument_id, side, mode, policies});
  }
  const family = completed.length >= config.minimum_complete_weeks ? engine.familywiseComparisons(tasks,
    {...protocol, holdout_start: config.starts_on, minimum_holdout_weeks: config.minimum_complete_weeks}) : null;
  if (family) for (const task of tasks) {
    task.gates = {};
    for (const method of engine.METHODS.slice(1)) {
      const comparisons = family.comparisons.filter(c => c.instrument_id === task.instrument_id && c.side === task.side && c.mode === task.mode && c.method === method);
      const tailAndCompletion = protocol.scenarios.every(({name}) => {
        const a = task.policies[method].summary[name], b = task.policies[engine.METHODS[0]].summary[name];
        return a.p95_cost_bps <= b.p95_cost_bps + protocol.maximum_tail_deterioration_bps &&
          a.mean_modeled_completion >= b.mean_modeled_completion - protocol.maximum_completion_deterioration;
      });
      task.gates[method] = {numeric_checks_pass: comparisons.every(c => c.cost_check) && tailAndCompletion,
        tail_and_completion_pass: tailAndCompletion, promotion_allowed: false};
    }
  }
  const latest = [...new Set(state.receipts.map(r => r.payload.calendar))].flatMap(calendar =>
    [...state.receipts].reverse().find(r => r.payload.calendar === calendar).payload.tasks.map(t => ({...t, calendar})));
  const summary = {experiment_id: config.experiment_id, record_count: state.receipts.length,
    on_time_receipts: state.receipts.filter(validReceipt).length, completed_common_weeks: completed,
    complete_week_count: completed.length, required_weeks: config.minimum_complete_weeks,
    status: completed.length >= config.minimum_complete_weeks ? "review_required_no_automatic_promotion" :
      runDate && runDate >= config.collect_until ? "trial_ended_insufficient_prospective_coverage" : "collecting_not_enough_prospective_evidence",
    promotion_allowed: false, production_modified: false, receipts: rows, coverage, settled_task_weeks: state.evaluations.length,
    descriptive_only_until_complete: true, tasks, family, latest_selections: latest};
  const lines = ["# Prospective execution shadow", "", `Experiment: ${config.experiment_id}`, "",
    "**Validation only. Production is unchanged. No orders are submitted.**", "",
    `Complete common prospective weeks: ${completed.length} / ${config.minimum_complete_weeks}. Status: ${summary.status}.`, "",
    "Parameters and samples must be sealed in a GitHub artifact before their effective session. Upcoming reference prices and fills are unknown. Later evaluation is hypothetical execution, not broker fills.", "",
    "| Calendar | Effective session | Generated UTC | Artifact seal UTC | Status |", "|---|---|---|---|---|",
    ...rows.slice(-16).map(r => `| ${r.calendar} | ${r.effective_date} | ${r.generated_at} | ${r.sealed_at ?? "pending"} | ${r.status} |`), "",
    `Expected mature instrument-weeks: ${coverage.length}; incomplete: ${coverage.filter(r => !r.complete).length}. See report.json for every missing date and missing-market-data flag.`, "",
    "Missing/late receipts are coverage failures, never backfilled. No winner is declared before sufficient complete future weeks accumulate. ETF data remain spot proxies; costs and fills are assumptions.", "",
    "Crypto day-D fits are for D+1 using data through D-1. Listed receipts freeze before 09:30 ET for the 09:35-minute reference. Production schedules are unchanged.", "",
    "Artifacts contain the receipt ledger, current input snapshot, fixed protocols, coverage and results. Changed execution code or registry requires a separate experiment.", "",
    "## Prospective comparison", "",
    "Only complete weeks shared by every instrument/method enter these descriptive summaries. No interim winner or promotion. Costs are simulated bp; lower is better, not profit. ETF inputs remain proxies.", ""];
  if (!tasks.length) lines.push("No complete prospective week yet; there is no prospective performance estimate.", "");
  else {
    lines.push("| Instrument / side / mode | Method | Mean cost bp | P95 cost bp | Passive completion | Modeled completion |", "|---|---|---:|---:|---:|---:|");
    for (const task of tasks) for (const [method, policy] of Object.entries(task.policies)) {
      const s = policy.summary.nominal;
      lines.push(`| ${task.instrument_id} / ${task.side} / ${task.mode} | ${method} | ${s.mean_cost_bps.toFixed(2)} | ${s.p95_cost_bps.toFixed(2)} | ${(s.mean_passive_completion * 100).toFixed(1)}% | ${(s.mean_modeled_completion * 100).toFixed(1)}% |`);
    }
  }
  const choiceText = c => typeof c === "number" ? `${engine.GRID[c].lookback} / ${(engine.GRID[c].first * 100).toFixed(2)}% / ${(engine.GRID[c].spacing * 100).toFixed(2)}%` : c;
  lines.push("", "## Latest frozen/test selections (not trading recommendations)", "", "| Instrument / side / mode | Method | Raw minimum: lookback / first / spacing | Adopted | Reason |", "|---|---|---|---|---|");
  for (const task of latest) for (const [method, s] of Object.entries(task.selections))
    lines.push(`| ${task.instrument_id} / ${task.side} / ${task.mode} | ${method} | ${choiceText(s.raw_minimum)} | ${choiceText(s.choice)} | ${s.reason} |`);
  lines.push("");
  return {summary, markdown: lines.join("\n")};
}

function main(directory) {
  const folder = path.resolve(directory);
  if (!folder.startsWith(path.join(ROOT, ".research") + path.sep)) throw new Error("Shadow output must remain in .research/");
  const read = name => JSON.parse(fs.readFileSync(path.join(folder, name)));
  const request = read("request.json"), config = read("shadow-protocol.json"), protocol = read("input-protocol.json");
  for (const [file, expected] of Object.entries(request.implementation_sha256))
    if (sha(fs.readFileSync(path.join(ROOT, file))) !== expected) throw new Error("Implementation changed during the run");
  const compatibilityRaw = fs.readFileSync(path.join(folder, "compatibility.json"));
  if (sha(compatibilityRaw) !== request.compatibility_manifest_sha256) throw new Error("Compatibility manifest changed during the run");
  const contract = digest({config, code: request.implementation_sha256});
  const state = fs.existsSync(path.join(folder, "prior-state.json")) ? read("prior-state.json") :
    {schema_version: 1, contract_hash: contract, experiment_id: config.experiment_id, receipts: [], evaluations: [], events: []};
  const before = {payloads: state.receipts.map(r => r.payload), hashes: state.receipts.map(r => r.hash), evaluations: state.evaluations};
  const beforeDigest = digest(before);
  migrateOperationalContract(state, contract, JSON.parse(compatibilityRaw), sha(compatibilityRaw), request.run_id);
  verifyState(state, contract);
  if (fs.existsSync(path.join(folder, "prior-artifact.json"))) sealImported(state, read("prior-artifact.json"));
  if (digest({payloads: state.receipts.map(r => r.payload), hashes: state.receipts.map(r => r.hash), evaluations: state.evaluations}) !== beforeDigest)
    throw new Error("Restoration changed an existing decision or settled result");
  verifyState(state, contract);
  const output = path.join(folder, "export"); fs.mkdirSync(output, {recursive: true});
  if (request.restore_only) {
    if (!fs.existsSync(path.join(folder, "prior-state.json"))) throw new Error("Restore-only requires an existing official ledger");
    const proof = {mode: "restore_only", record_kind: request.record_kind, source_artifact: read("prior-artifact.json"),
      record_count: state.receipts.length, on_time_receipts: state.receipts.filter(validReceipt).length,
      payloads_and_hashes_preserved: true, original_decisions_sha256: beforeDigest,
      contract_hash: state.contract_hash, contract_migrations: state.contract_migrations || [],
      fitted_new_decisions: false, evaluated_new_market_data: false, settled_task_weeks: state.evaluations.length,
      complete_week_count: null, production_modified: false, promotion_allowed: false, dispatch: request.dispatch};
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(proof, null, 2) + "\n");
    fs.writeFileSync(path.join(output, "report.md"), "# Shadow recovery-only verification\n\n" +
      `Run kind: ${request.record_kind}. Restored ${state.receipts.length} receipts; ${proof.on_time_receipts} pass the timing check.\n\n` +
      "Existing payloads, hashes, parameters, and settled results are unchanged. No new parameter fitting or market-data evaluation was performed; this is not a performance report. Production is unchanged.\n\n" +
      "The original artifact timestamps are retained. Their precision intervals must be entirely before the freeze deadline.\n");
    fs.writeFileSync(path.join(output, "shadow-state.json"), JSON.stringify(state));
    for (const file of ["shadow-protocol.json", "input-protocol.json", "request.json", "compatibility.json", "prior-artifact.json"])
      fs.copyFileSync(path.join(folder, file), path.join(output, file));
    console.log(JSON.stringify(proof));
    return;
  }
  const raw = fs.readFileSync(path.join(folder, "sessions.json")), dataset = JSON.parse(raw);
  if (sha(fs.readFileSync(path.join(folder, "input-protocol.json"))) !== dataset.protocol_sha256) throw new Error("Input protocol mismatch");
  if (dataset.registry_sha256 !== config.registry_sha256 || dataset.registry_sha256 !== request.registry_sha256) throw new Error("Registry mismatch");
  if (canonical(dataset.instruments.map(i => i.instrument.instrument_id).sort()) !== canonical([...request.instrument_ids].sort())) throw new Error("Incomplete instrument cohort");
  request.input_snapshot_sha256 = sha(raw);
  for (const target of request.targets) {
    console.log(`Freeze ${target.calendar} for ${target.date}`);
    freezeCalendar(dataset, request, target, protocol, config, state);
  }
  const coverage = settle(dataset, protocol, config, state, request.mature_weeks);
  verifyState(state, contract);
  const report = reportState(state, config, coverage, protocol, request.instrument_ids, request.planned_at.slice(0, 10));
  report.summary.dispatch = request.dispatch;
  report.summary.contract_migrations = state.contract_migrations || [];
  fs.writeFileSync(path.join(output, "shadow-state.json"), JSON.stringify(state));
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report.summary, null, 2) + "\n");
  fs.writeFileSync(path.join(output, "report.md"), report.markdown);
  fs.writeFileSync(path.join(output, "request.json"), JSON.stringify(request, null, 2) + "\n");
  for (const file of ["sessions.json", "shadow-protocol.json", "input-protocol.json", "compatibility.json"])
    fs.copyFileSync(path.join(folder, file), path.join(output, file));
  console.log(JSON.stringify({records: state.receipts.length, complete_weeks: report.summary.complete_week_count,
    record_kind: request.record_kind, promotion_allowed: false, production_modified: false}));
}
if (require.main === module) main(process.argv[2] || path.join(ROOT, ".research/shadow"));
module.exports = {canonical, digest, verifyState, migrateOperationalContract, timestampBounds, sealTiming, sealImported, validReceipt, fitTask, freezeCalendar, settle, reportState};
