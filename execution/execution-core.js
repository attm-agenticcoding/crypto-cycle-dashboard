/* Shared, dependency-free execution math. Used by the page and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ExecutionCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parametersReady(item) {
    return !!item && ["first_offset_pct", "spacing_pct", "lookback_sessions"]
      .every(field => typeof item[field] === "number" && Number.isFinite(item[field]) && item[field] > 0)
      && typeof item.expected_rungs_per_session === "number" && Number.isFinite(item.expected_rungs_per_session) && item.expected_rungs_per_session >= 0;
  }

  function sideParameters(instrument, side) {
    const fitted = instrument.sides?.[side] || (side === "buy" && !instrument.sides ? instrument : null);
    if (parametersReady(fitted)) return { ...instrument, ...fitted, trade_side: side };
    const pending = { ...instrument, trade_side: side, status: "pending-first-fit" };
    for (const field of ["first_offset_pct", "spacing_pct", "expected_rungs_per_session", "lookback_sessions", "session_samples", "data_as_of", "generated_at"])
      delete pending[field];
    return pending;
  }

  function hitCount(move, first, spacing) {
    if (move + 1e-12 < first) return 0;
    return Math.min(12, 1 + Math.floor((move - first + 1e-12) / spacing));
  }

  function sellExpectedHits(params, first, spacing) {
    const samples = (params.session_samples || []).filter(row => Number.isFinite(row.runup_pct))
      .slice(-params.lookback_sessions);
    if (!samples.length) return Math.min(12, Math.max(.1, params.expected_rungs_per_session));
    return Math.max(.1, samples.reduce((sum, row) => sum + hitCount(row.runup_pct / 100, first, spacing), 0) / samples.length);
  }

  function nonnegative(value, label) {
    if (value === "" || value === null || value === undefined || !Number.isFinite(+value) || +value < 0 || +value > Number.MAX_SAFE_INTEGER)
      throw new Error(`${label} must be a finite, nonnegative number.`);
    return +value;
  }

  function sellPace(weekly, total, weekSessions, horizon) {
    const entered = nonnegative(weekly, "Weekly shares");
    const enabled = total !== null && total !== undefined && total !== "";
    const remaining = enabled ? nonnegative(total, "Total remaining shares") : null;
    const paceSessions = enabled ? Math.min(weekSessions, horizon) : weekSessions;
    if (!(paceSessions > 0)) throw new Error("No eligible trading sessions remain for this deadline.");
    const base = enabled ? Math.min(entered, remaining) : entered;
    const scheduleFloor = enabled ? remaining * paceSessions / horizon : 0;
    const target = enabled ? Math.min(remaining, Math.max(base, scheduleFloor)) : base;
    const lift = target > 0 ? target / Math.max(base, 1) : 1;
    return {
      weekly: target, scheduleFloor, enabled, paceSessions,
      factor: Math.max(.4, Math.min(1, 1 / Math.sqrt(Math.max(1, lift)))),
      lift: Math.max(1, lift),
      urgency: lift > 1.5 ? "HIGH" : lift > 1.02 ? "ELEVATED" : enabled ? "NORMAL" : "BASE"
    };
  }

  function sellPlan({weekly, total = null, held, reserved = 0, reference, weekSessions, horizon, params, closeout = false, bid = null}) {
    if (!parametersReady(params) || params.trade_side !== "sell") throw new Error("Independent sell scaling is not ready.");
    const inventory = nonnegative(held, "Current held shares");
    const working = nonnegative(reserved, "Shares in existing sell orders");
    if (working > inventory) throw new Error("Existing sell orders exceed the current held shares.");
    const controller = sellPace(weekly, total, weekSessions, horizon);
    const available = Math.max(0, Math.floor(inventory - working));
    // Unfilled working sells still count toward the target, but cannot be
    // offered again. Only actual fills reduce the user's remaining inputs.
    const outstandingTarget = Math.max(0, Math.floor(controller.weekly - working));
    const targetShares = Math.min(outstandingTarget, available);
    const first = params.first_offset_pct / 100 * controller.factor;
    const spacing = params.spacing_pct / 100 * controller.factor;
    const hits = sellExpectedHits(params, first, spacing);
    const perRung = closeout ? targetShares : Math.max(1, Math.ceil(targetShares / (controller.paceSessions * hits)));
    const orders = [];
    if (targetShares > 0) {
      if (closeout) {
        const liveBid = nonnegative(bid, "Current best bid");
        if (liveBid < .01) throw new Error("Enter a current best bid of at least $0.01 for the closeout order.");
        const price = Math.floor(liveBid * 100 + 1e-8) / 100;
        orders.push({ rung: 1, price, shares: targetShares, notional: targetShares * price });
      } else {
        const ref = nonnegative(reference, "Reference price");
        if (ref < .01) throw new Error("Reference price must be at least $0.01.");
        let remaining = targetShares;
        for (let rung = 0; remaining > 0; rung++) {
          const shares = Math.min(perRung, remaining);
          // Round passive sell limits UP to avoid pricing below the fitted rung.
          const price = Math.ceil(ref * (1 + first + rung * spacing) * 100 - 1e-8) / 100;
          orders.push({ rung: rung + 1, price, shares, notional: shares * price });
          remaining -= shares;
        }
      }
    }
    return {
      controller, available, working, targetShares, perRung: targetShares ? perRung : 0,
      first, spacing, hits, orders, closeout,
      inventoryCapped: outstandingTarget > available,
      targetAlreadyCovered: working >= Math.floor(controller.weekly) && working > 0,
      fractionalRemainder: Math.max(0, Math.min(controller.weekly - working, inventory - working) - targetShares)
    };
  }

  // NYSE official calendar: https://www.nyse.com/trade/hours-calendars
  function sellSessionCloseMinutes(day) {
    const month = day.getUTCMonth() + 1, date = day.getUTCDate(), weekday = day.getUTCDay();
    const thanksgivingFriday = month === 11 && weekday === 5 && date >= 23 && date <= 29;
    const christmasEve = month === 12 && date === 24 && weekday >= 1 && weekday <= 4;
    const julyThird = month === 7 && date === 3 && weekday >= 1 && weekday <= 4;
    return thanksgivingFriday || christmasEve || julyThird ? 13 * 60 : 16 * 60;
  }

  function sellCloseoutState(deadline, now, isSession) {
    if (!(deadline instanceof Date) || !Number.isFinite(deadline.getTime())) throw new Error("Choose a valid sale deadline.");
    const finalSession = new Date(deadline);
    while (!isSession(finalSession)) finalSession.setUTCDate(finalSession.getUTCDate() - 1);
    const closeMinutes = sellSessionCloseMinutes(finalSession), startMinutes = closeMinutes - 15;
    const today = now.date.toISOString().slice(0, 10), finalDate = finalSession.toISOString().slice(0, 10);
    const minutes = now.hour * 60 + now.minute;
    return {
      finalDate, closeMinutes, startMinutes,
      due: today === finalDate && minutes >= startMinutes && minutes < closeMinutes,
      expired: today > finalDate || (today === finalDate && minutes >= closeMinutes)
    };
  }

  return { parametersReady, sideParameters, hitCount, sellExpectedHits, sellPace, sellPlan, sellSessionCloseMinutes, sellCloseoutState };
});
