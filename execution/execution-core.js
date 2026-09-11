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

  function sellPace(weekly, total, weekSessions, horizon, smallestUnit = 1) {
    const entered = nonnegative(weekly, "Weekly quantity");
    const enabled = total !== null && total !== undefined && total !== "";
    const remaining = enabled ? nonnegative(total, "Total remaining quantity") : null;
    const paceSessions = enabled ? Math.min(weekSessions, horizon) : weekSessions;
    if (!(paceSessions > 0)) throw new Error("No eligible trading sessions remain for this deadline.");
    const base = enabled ? Math.min(entered, remaining) : entered;
    const scheduleFloor = enabled ? remaining * paceSessions / horizon : 0;
    const target = enabled ? Math.min(remaining, Math.max(base, scheduleFloor)) : base;
    const lift = target > 0 ? target / Math.max(base, smallestUnit) : 1;
    return {
      weekly: target, scheduleFloor, enabled, paceSessions,
      factor: Math.max(.4, Math.min(1, 1 / Math.sqrt(Math.max(1, lift)))),
      lift: Math.max(1, lift),
      urgency: lift > 1.5 ? "HIGH" : lift > 1.02 ? "ELEVATED" : enabled ? "NORMAL" : "BASE"
    };
  }

  function sellPlan({weekly, total = null, held, reserved = 0, reference, weekSessions, horizon, params, closeout = false, bid = null}) {
    if (params.market_calendar === "24X7") return cryptoPlan({weekly, total, held, reserved, reference, weekSessions, horizon, params, closeout, bid});
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

  function sellCloseoutState(deadline, now, isSession, marketCalendar = "XNYS") {
    if (!(deadline instanceof Date) || !Number.isFinite(deadline.getTime())) throw new Error("Choose a valid sale deadline.");
    const finalSession = new Date(deadline);
    while (marketCalendar !== "24X7" && !isSession(finalSession)) finalSession.setUTCDate(finalSession.getUTCDate() - 1);
    const closeMinutes = marketCalendar === "24X7" ? 1440 : sellSessionCloseMinutes(finalSession), startMinutes = closeMinutes - 15;
    const today = now.date.toISOString().slice(0, 10), finalDate = finalSession.toISOString().slice(0, 10);
    const minutes = now.hour * 60 + now.minute;
    return {
      finalDate, closeMinutes, startMinutes,
      due: today === finalDate && minutes >= startMinutes && minutes < closeMinutes,
      expired: today > finalDate || (today === finalDate && minutes >= closeMinutes)
    };
  }

  function stepDecimals(step) {
    const [mantissa, exponent = "0"] = String(step).toLowerCase().split("e");
    return Math.max(0, (mantissa.split(".")[1] || "").length - Number(exponent));
  }
  function quantize(value, step, up = false) {
    if (!(step > 0) || !Number.isFinite(value)) throw new Error("Invalid order increment or amount.");
    const units = value / step;
    if (Math.abs(units) > Number.MAX_SAFE_INTEGER) throw new Error("Quantity exceeds the supported precision range.");
    return Number(((up ? Math.ceil(units - 1e-8) : Math.floor(units + 1e-8)) * step).toFixed(Math.min(15, stepDecimals(step))));
  }
  function quantityText(value, step = 1) {
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: Math.min(15, stepDecimals(step)) });
  }
  function calendarParts(params, at = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: params.market_calendar === "24X7" ? "UTC" : "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(at).filter(item => item.type !== "literal").map(item => [item.type, item.value]));
    return { date: new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day)), hour: +parts.hour, minute: +parts.minute };
  }
  function cryptoRemainingDays(now, endDate = null) {
    if (endDate) return Math.max(0, Math.floor((endDate - now.date) / 86400000) + 1);
    return 7 - ((now.date.getUTCDay() + 6) % 7); // ISO week ends on Sunday, UTC.
  }

  function cryptoPlan({weekly, total = null, held = 0, reserved = 0, reference, weekSessions, horizon, params, closeout = false, bid = null}) {
    const side = params.trade_side;
    if (!parametersReady(params) || !["buy", "sell"].includes(side)) throw new Error("Independent scaling is not ready.");
    const step = Number(params.quantity_step), tick = Number(params.price_tick);
    if (!(step > 0 && tick > 0 && Number.isFinite(params.min_quantity) && Number.isFinite(params.min_notional)))
      throw new Error("Verified exchange order increments are missing.");
    const ref = nonnegative(closeout ? bid : reference, closeout ? "Current best bid" : "Reference price");
    if (!(ref > 0)) throw new Error("A positive, current price is required.");
    const controller = sellPace(weekly, total, weekSessions, horizon, 1e-12);
    const inventory = side === "sell" ? nonnegative(held, "Current held quantity") : controller.weekly / ref;
    const working = side === "sell" ? nonnegative(reserved, "Quantity in existing sell orders") : 0;
    if (working > inventory) throw new Error("Existing sell orders exceed the held quantity.");
    const available = quantize(Math.max(0, inventory - working), step);
    const outstanding = Math.max(0, (side === "sell" ? controller.weekly : controller.weekly / ref) - working);
    const targetShares = Math.min(available, quantize(outstanding, step));
    const first = params.first_offset_pct / 100 * controller.factor, spacing = params.spacing_pct / 100 * controller.factor;
    const field = side === "sell" ? "runup_pct" : "drawdown_pct";
    const sample = (params.session_samples || []).filter(row => Number.isFinite(row[field])).slice(-params.lookback_sessions);
    const hits = Math.max(.1, Math.min(12, sample.length ? sample.reduce((sum, row) => sum + hitCount(row[field] / 100, first, spacing), 0) / sample.length : params.expected_rungs_per_session));
    const perRung = closeout ? targetShares : Math.max(step, quantize(targetShares / (controller.paceSessions * hits), step, true));
    const orders = [];
    let remaining = targetShares;
    for (let rung = 0; remaining >= step * .999999 && rung < 200; rung++) {
      const rawPrice = closeout ? ref : ref * (1 + (side === "sell" ? 1 : -1) * (first + rung * spacing));
      const price = quantize(rawPrice, tick, side === "sell" && !closeout);
      if (price <= 0 || price < params.min_price || (params.max_price > 0 && price > params.max_price)) break;
      const minimum = quantize(Math.max(params.min_quantity, params.min_notional / price), step, true);
      const maximum = quantize(Math.min(params.max_quantity || Infinity, params.max_notional > 0 ? params.max_notional / price : Infinity, remaining), step);
      let shares = Math.min(maximum, Math.max(minimum, perRung));
      if (shares < minimum) {
        const previous = orders.at(-1);
        if (previous && (!params.max_quantity || previous.shares + remaining <= params.max_quantity)
          && (!params.max_notional || (previous.shares + remaining) * previous.price <= params.max_notional)) {
          previous.shares = quantize(previous.shares + remaining, step);
          previous.notional = previous.shares * previous.price;
          remaining = 0;
        }
        break;
      }
      shares = quantize(shares, step);
      orders.push({ rung: orders.length + 1, price, shares, notional: price * shares });
      remaining = quantize(Math.max(0, remaining - shares), step);
    }
    return {
      controller, available, working, targetShares, perRung: targetShares ? perRung : 0, first, spacing, hits, orders, closeout,
      inventoryCapped: side === "sell" && outstanding > inventory - working,
      targetAlreadyCovered: side === "sell" && working >= controller.weekly && working > 0,
      fractionalRemainder: Math.max(0, Math.min(outstanding, inventory - working) - targetShares),
      unallocated: remaining,
      orderQuantity: quantize(orders.reduce((sum, order) => sum + order.shares, 0), step)
    };
  }

  return { parametersReady, sideParameters, hitCount, sellExpectedHits, sellPace, sellPlan, sellSessionCloseMinutes, sellCloseoutState,
    stepDecimals, quantize, quantityText, cryptoPlan, calendarParts, cryptoRemainingDays };
});
