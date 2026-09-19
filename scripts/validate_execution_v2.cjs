#!/usr/bin/env node
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib");
const {execFileSync} = require("node:child_process");
const engine = require("./execution_v2.cjs");
const ROOT = path.resolve(__dirname, "..");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const num = value => Number.isFinite(value) ? value.toFixed(2) : "n/a";
const pct = value => Number.isFinite(value) ? (100 * value).toFixed(1) + "%" : "n/a";
const choiceText = choice => typeof choice === "number" ? `${engine.GRID[choice].lookback} sessions / ${num(engine.GRID[choice].first * 100)}% / ${num(engine.GRID[choice].spacing * 100)}%` : choice;

function markdown(report) {
  const lines = ["# Execution v2 — isolated validation report", "", `Generated: ${report.generated_at}. Production modified: **no**.`, "",
    "## Decision", "", "**Do not replace production parameters from this report.** No universal winning selector was assumed in advance.", "",
    `Coverage: ${report.protocol.start}–${report.protocol.as_of}. Reserved retrospective evaluation suffix: ${report.protocol.holdout_start}–${report.protocol.evaluation_end} (${report.family.common_holdout_weeks.length} common weeks).`, "",
    "The suffix overlaps dates examined in earlier project work: it is not a pristine, independently collected holdout. Daily outer decisions are causal, but prospective shadow evidence is still required.", "",
    `Grid: ${engine.GRID.length} candidates per side, independently fitted. Training: ${report.protocol.score_weeks} completed common weeks; paired rule uses the first ${report.protocol.score_weeks - report.protocol.confirmation_weeks} for discovery and the last ${report.protocol.confirmation_weeks} for confirmation. Hit estimation remains 10–60 sessions.`, "",
    "All costs below are simulated bp relative to the task's starting reference; lower is better. Negative cost does not mean profit. Buy is a fixed budget; sell is fixed inventory. Do not compare their magnitudes as identical tasks.", "",
    "## Nominal reserved-suffix results", "",
    "Assumed fees: 1 bp passive / 5 bp aggressive; aggressive price concession 2 bp. These are uncalibrated assumptions, not broker quotes.", "",
    "| Instrument / side / mode | Method | Mean cost bp | P95 cost bp | Passive completion | Modeled completion | Aggressive fraction | Parameter changes (all outer weeks) |",
    "|---|---|---:|---:|---:|---:|---:|---:|"];
  for (const task of report.tasks) for (const [method, policy] of Object.entries(task.policies)) {
    const s = policy.summary.nominal.holdout;
    lines.push(`| ${task.instrument_id} / ${task.side} / ${task.mode} | ${method} | ${num(s.mean_cost_bps)} | ${num(s.p95_cost_bps)} | ${pct(s.mean_passive_completion)} | ${pct(s.mean_modeled_completion)} | ${pct(s.mean_aggressive_fraction)} | ${policy.changes} |`);
  }
  lines.push("", "Price-seeking residuals are marked at the next session reference, including assumed aggressive frictions; they are not reported as completed orders. Finish mode assumes an explicit aggressive intervention 15 minutes before the final close. It is not a guarantee or an automatic broker action.", "",
    "## Paired improvements versus the distance control", "",
    `Positive improvement favors the challenger. The joint block-bootstrap margin is ${num(report.family.margin_bps)} bp across ${report.family.family_size} declared comparisons (selectors × modes × sides × instruments × scenarios × benchmarks). The short, dependent sample gives limited precision.`, "",
    "| Instrument / side / mode | Challenger | Mean improvement bp | Simultaneous lower bound bp | Numeric checks across all scenarios / benchmarks |",
    "|---|---|---:|---:|---|");
  for (const task of report.tasks) for (const method of engine.METHODS.slice(1)) {
    const c = report.family.comparisons.find(c => c.instrument_id === task.instrument_id && c.side === task.side && c.mode === task.mode &&
      c.method === method && c.baseline === engine.METHODS[0] && c.scenario === "nominal");
    lines.push(`| ${task.instrument_id} / ${task.side} / ${task.mode} | ${method} | ${num(c.mean_improvement_bps)} | ${num(c.simultaneous_lower_95_bps)} | ${task.gates[method].numeric_checks_pass ? "pass (not promotion)" : "not passed"} |`);
  }
  lines.push("", "## Last evaluated daily selections (not today's trading recommendations)", "",
    "| Instrument / side / mode | Selector | Raw common-window minimum: lookback / first / spacing | Adopted | Explanation |",
    "|---|---|---|---|---|");
  for (const task of report.tasks) for (const method of engine.METHODS) {
    const selection = task.policies[method].latest_selection;
    lines.push(`| ${task.instrument_id} / ${task.side} / ${task.mode} | ${method} | ${choiceText(selection.raw_minimum)} | ${choiceText(selection.choice)} | ${selection.reason} |`);
  }
  lines.push("", "## Data, limitations, and rollout gates", "");
  for (const task of report.tasks.filter(t => t.side === "buy" && t.mode === report.protocol.modes[0]))
    lines.push(`- ${task.instrument_id}: ${task.price_source}; ${task.quality.accepted_sessions} sessions, ${task.quality.rejected_sessions.length} rejected sessions; ${task.common_weeks.length} common score weeks, ${task.outer_weeks.length} outer weeks.`);
  lines.push("", ...report.protocol.notes.map(x => `- ${x}`), "",
    "Additional gaps: exact historical data-publication timing is not reconstructed; the crypto updater runs after the 00:00 anchor, so same-day 00:01 replay is a theoretical policy, not an exact replay of historically published decisions. Listed BUY retains its current one-session sample lag. The legacy-distance control preserves its selection rule, not the flawed unequal-window production score or an unavailable historical publication log.", "",
    "No venue order book, queue position, calibrated participation model, market-impact model, or tracking-error series is available. The proxy ETF results and current fixed crypto filters cannot validate real historical fills. Reserved open-order inventory is covered by order-engine tests; this replay explicitly assumes cancellation before every daily reset.", "",
    "Before promotion: obtain genuinely prospective results with actual parameter availability times; align the live page with the tested fee/closeout contract; use ETF data for ETF execution claims; separately approve the production switch. A numeric pass is not an automatic authorization.", "",
    "## Audit artifacts", "",
    "- `report.json`: complete daily decisions, weekly outcomes, scenarios, selection reasons, and checks.",
    "- `candidate-costs.json.gz`: every candidate's score on identical week IDs.",
    "- `sessions.json`: normalized input sessions plus archive URLs and SHA-256 hashes.",
    "- `protocol.json`: fixed settings used for this run.",
    `- Protocol SHA-256: ${report.protocol_sha256}.`,
    `- Session dataset SHA-256: ${report.sessions_sha256}.`,
    "", "Calendar sources: [NYSE hours](https://www.nyse.com/trade/hours-calendars), [2025 calendar](https://www.nyse.com/publicdocs/ICE_NYSE_2025_Yearly_Trading_Calendar.pdf), [January 9 extraordinary closure](https://ir.theice.com/press/news-details/2024/The-New-York-Stock-Exchange-Will-Close-Markets-on-January-9-to-Honor-the-Passing-of-Former-President-Jimmy-Carter-on-National-Day-of-Mourning/default.aspx).", "");
  return lines.join("\n");
}

function run({protocolFile, sessionsFile, output}) {
  const destination = path.resolve(output);
  if (!destination.startsWith(path.join(ROOT, ".research") + path.sep)) throw new Error("Outputs must remain inside the ignored .research/ tree");
  const rawProtocol = fs.readFileSync(protocolFile), protocol = JSON.parse(rawProtocol);
  const rawSessions = fs.readFileSync(sessionsFile), dataset = JSON.parse(rawSessions);
  if (dataset.protocol_sha256 !== hash(rawProtocol)) throw new Error("Protocol changed after preparing data; rebuild the research dataset");
  if (dataset.registry_sha256 !== hash(fs.readFileSync(path.join(ROOT, "data/execution_instruments.json")))) throw new Error("Registry changed; rebuild the dataset");
  fs.mkdirSync(destination, {recursive: true});
  const protectedFiles = ["data/execution_params.json", "data/execution_instruments.json", "execution/index.html", "execution/execution-core.js", "scripts/update_execution_params.py"];
  const before = Object.fromEntries(protectedFiles.map(p => [p, hash(fs.readFileSync(path.join(ROOT, p)))]));
  const tasks = [], matrices = [];
  for (const item of dataset.instruments) for (const side of ["buy", "sell"]) for (const mode of protocol.modes) {
    const label = `${item.instrument.instrument_id} ${side} ${mode}`;
    const task = engine.evaluateTask(item, side, mode, protocol, message => console.log(`${label}: ${message}`));
    matrices.push({instrument_id: task.instrument_id, side, mode, weeks: task.common_weeks, costs_bps: task.candidate_costs_bps});
    delete task.candidate_costs_bps;
    tasks.push(task);
    console.log(`${label}: ${task.outer_weeks.length} causal outer weeks completed`);
  }
  const family = engine.familywiseComparisons(tasks, protocol);
  let causalDecisionsChecked = 0;
  for (const task of tasks) {
    const input = dataset.instruments.find(x => x.instrument.instrument_id === task.instrument_id);
    for (const policy of Object.values(task.policies)) for (const outcome of policy.scenarios.nominal)
      for (const decision of outcome.decisions || []) {
        const week = input.weeks.find(w => w.week === decision.training_last_week);
        const visible = task.mode === "price_seeking" ? week.terminal_date : input.sessions[week.indices.at(-1)].date;
        if (!(visible < decision.date)) throw new Error("Future terminal label used in an outer decision");
        causalDecisionsChecked++;
      }
    task.gates = {};
    for (const method of engine.METHODS.slice(1)) {
      const comps = family.comparisons.filter(c => c.instrument_id === task.instrument_id && c.side === task.side && c.mode === task.mode && c.method === method);
      const tailAndCompletion = protocol.scenarios.every(({name}) => {
        const a = task.policies[method].summary[name].holdout, b = task.policies[engine.METHODS[0]].summary[name].holdout;
        return a.p95_cost_bps <= b.p95_cost_bps + protocol.maximum_tail_deterioration_bps &&
          a.mean_modeled_completion >= b.mean_modeled_completion - protocol.maximum_completion_deterioration;
      });
      task.gates[method] = {numeric_checks_pass: comps.every(c => c.cost_check) && tailAndCompletion,
        cost_checks_passed: comps.filter(c => c.cost_check).length, cost_checks_total: comps.length,
        tail_and_completion_pass: tailAndCompletion, promotion_allowed: false,
        reason: "Retrospective research; prospective, live-policy-availability, and real-instrument-data gates remain separate."};
    }
  }
  for (const p of protectedFiles) if (hash(fs.readFileSync(path.join(ROOT, p))) !== before[p]) throw new Error(`Protected production file changed: ${p}`);
  const report = {schema_version: 1, generated_at: new Date().toISOString(), production_modified: false,
    promotion_allowed: false, causal_decisions_checked: causalDecisionsChecked,
    protocol, protocol_sha256: hash(rawProtocol), sessions_sha256: hash(rawSessions),
    git_base: execFileSync("git", ["rev-parse", "HEAD"], {cwd: ROOT, encoding: "utf8"}).trim(),
    implementation_sha256: Object.fromEntries(["scripts/prepare_execution_v2.py", "scripts/execution_v2.cjs", "scripts/validate_execution_v2.cjs"].map(p => [p, hash(fs.readFileSync(path.join(ROOT, p)))])),
    protected_files_sha256: before, family, tasks};
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(destination, "candidate-costs.json.gz"), zlib.gzipSync(JSON.stringify({grid: engine.GRID, tasks: matrices})));
  fs.writeFileSync(path.join(destination, "protocol.json"), rawProtocol);
  fs.writeFileSync(path.join(destination, "sessions.json"), rawSessions);
  fs.writeFileSync(path.join(destination, "report.md"), markdown(report));
  console.log(`Report saved to ${destination}; production unchanged; automatic promotion disabled.`);
  return report;
}
if (require.main === module) {
  const args = process.argv.slice(2), options = {protocolFile: path.join(ROOT, "research/execution-v2-protocol.json"),
    sessionsFile: path.join(ROOT, ".research/sessions.json"), output: path.join(ROOT, ".research/report")};
  for (let i = 0; i < args.length; i += 2) {
    const key = {"--protocol": "protocolFile", "--sessions": "sessionsFile", "--output": "output"}[args[i]];
    if (!key || !args[i + 1]) throw new Error(`Unknown or incomplete argument ${args[i]}`);
    options[key] = path.resolve(args[i + 1]);
  }
  run(options);
}
module.exports = {run, markdown};
