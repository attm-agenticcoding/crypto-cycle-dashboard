/* Monthly research profiles are separate from the legacy live ladder fit. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExecutionMonthlyScaling = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'monthly-single-order-v1';
  function profile(bundle, instrumentId, limit) {
    if (bundle?.schema_version !== 1 || bundle.policy_version !== VERSION || bundle.status !== 'research_only') return null;
    const instrument = bundle.instruments?.[instrumentId];
    const selected = instrument?.profiles?.[String(limit)];
    const nominal = selected?.oos?.nominal;
    const comparison = nominal?.comparisons?.immediate;
    if (!selected || selected.monthly_limit !== limit || !Number.isFinite(selected.next_offset_pct)
      || selected.next_offset_pct < .05 || selected.next_offset_pct > 5 || !Array.isArray(selected.oos_months)
      || typeof selected.candidate?.id !== 'string' || typeof instrument.data_as_of !== 'string'
      || !Number.isFinite(nominal?.mean_completion) || !Number.isFinite(comparison?.mean_excess_cost_bps)
      || (comparison.block_interval_95_bps !== null && (!Array.isArray(comparison.block_interval_95_bps)
        || comparison.block_interval_95_bps.length !== 2 || !comparison.block_interval_95_bps.every(Number.isFinite)))) return null;
    return {instrument, selected};
  }
  let bundle = null;
  function render({instrumentId, limit, side}) {
    const panel = document.getElementById('monthly-scaling');
    if (!panel) return;
    panel.hidden = side !== 'buy';
    const status = document.getElementById('monthly-scaling-status');
    const details = document.getElementById('monthly-scaling-details');
    const p = profile(bundle, instrumentId, limit);
    if (!p) {
      status.textContent = limit === 0 ? 'New buys paused by the monthly trade limit.'
        : bundle ? 'No monthly research profile for this selection. Profiles cover limits 1–31.'
        : 'Monthly research is unavailable. The current price reference comes from the previous daily ladder model.';
      details.textContent = '';
      return;
    }
    const {instrument, selected} = p;
    const nominal = selected.oos.nominal;
    const comparison = nominal.comparisons.immediate;
    const interval = comparison.block_interval_95_bps;
    status.textContent = `Limit ${limit} / month · candidate offset ${selected.next_offset_pct.toFixed(3)}% · ${selected.candidate.id}. ${selected.retrospective_gate_passed ? 'Retrospective checks passed; prospective evidence is still required.' : 'Validation threshold not passed.'} Research only; this candidate does not change your orders.`;
    details.textContent = `Data through ${instrument.data_as_of}; ${selected.oos_months.length} walk-forward test months. Nominal cost versus same-limit immediate execution: ${comparison.mean_excess_cost_bps.toFixed(2)} bp (negative is better)${interval ? `; exploratory 95% interval ${interval.map(v=>v.toFixed(2)).join(' to ')} bp` : ''}. Cash deployed: ${(nominal.mean_completion*100).toFixed(1)}%. ${instrument.price_source === 'direct_spot' ? 'Direct spot prices.' : 'Indexed spot proxy, not historical ETF quotes.'} Two fixed funding scenarios; no personal capital history is assumed. This is a dated research snapshot, not an automatically refreshed live fit.`;
  }
  async function load(context) {
    try {
      const response = await fetch('../data/execution_monthly_params.json', {cache:'no-store'});
      if (!response.ok) throw new Error('Monthly report unavailable');
      bundle = await response.json();
    } catch (_) { bundle = null; }
    render(context());
  }
  return Object.freeze({profile, render, load});
});
