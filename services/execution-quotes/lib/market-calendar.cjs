/* Shared NYSE cash-equity calendar and listed execution window. No dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ExecutionCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Explicit published dates, not generic US federal-holiday rules. In
  // particular, Saturday New Year's Day does NOT close the preceding Friday.
  // Verified 2026-10-05. Scheduled dates cannot predict later emergency closures;
  // update this table when NYSE publishes a calendar change or an additional year.
  const supportedRange = Object.freeze({ start: "2025-01-01", end: "2028-12-31" });
  const sources = Object.freeze([
    "https://www.nyse.com/trade/hours-calendars",
    "https://ir.theice.com/press/news-details/2024/NYSE-Group-Announces-2025-2026-and-2027-Holiday-and-Early-Closings-Calendar/default.aspx",
    "https://ir.theice.com/press/news-details/2024/The-New-York-Stock-Exchange-Will-Close-Markets-on-January-9-to-Honor-the-Passing-of-Former-President-Jimmy-Carter-on-National-Day-of-Mourning/default.aspx"
  ]);
  const closedDates = new Set([
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2025-01-09", // National Day of Mourning for President Jimmy Carter.
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19",
    "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25"
  ]);
  const earlyCloseDates = new Set([
    "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-11-27", "2026-12-24",
    "2027-11-26",
    "2028-07-03", "2028-11-24"
  ]);
  const regularOpenMinutes = 9 * 60 + 30;
  const referenceReadyMinutes = 9 * 60 + 36;

  // Date inputs represent a civil session date in their UTC fields, as returned
  // by calendarParts. For a real timestamp, convert with calendarParts first.
  // Date-only strings are strict: malformed/normalized dates fail closed.
  function dateKey(day) {
    if (day instanceof Date)
      return Number.isFinite(day.getTime()) ? day.toISOString().slice(0, 10) : null;
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  }

  function isSupportedDate(day) {
    const key = dateKey(day);
    return key !== null && key >= supportedRange.start && key <= supportedRange.end;
  }

  function isSession(day) {
    if (!isSupportedDate(day)) return false;
    const key = dateKey(day), weekday = new Date(`${key}T00:00:00.000Z`).getUTCDay();
    return weekday > 0 && weekday < 6 && !closedDates.has(key);
  }

  function sessionCloseMinutes(day) {
    if (!isSupportedDate(day))
      throw new Error("The NYSE calendar requires a valid date from 2025-01-01 through 2028-12-31. Update the calendar before using another date.");
    if (!isSession(day)) return null;
    return earlyCloseDates.has(dateKey(day)) ? 13 * 60 : 16 * 60;
  }

  // Keep the execution core's signature: listed calendars are New York civil
  // time; 24X7 instruments use UTC. IANA conversion handles both DST boundaries
  // and dates that differ from the UTC date. Never use the host's local zone.
  const formatters = new Map();
  function calendarParts(params = {}, at = new Date()) {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
      throw new Error("A valid timestamp is required for the market calendar.");
    const timeZone = params.market_calendar === "24X7" ? "UTC" : "America/New_York";
    if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }));
    const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(at)
      .filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return { date: new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day)), hour: +parts.hour, minute: +parts.minute };
  }

  // Listed BUY and SELL share exactly this window. The reference is the CLOSE
  // of the 09:35 minute, so even 09:35:59 cannot produce an executable plan.
  // Crypto's distinct 00:01 UTC window remains the caller's responsibility.
  function tradingWindow(now, symbol = "selected instrument") {
    const state = { open: false, reason: "", label: "", message: "", closeMinutes: null, startMinutes: referenceReadyMinutes };
    if (!now || dateKey(now.date) === null || !Number.isInteger(now.hour) || now.hour < 0 || now.hour > 23
      || !Number.isInteger(now.minute) || now.minute < 0 || now.minute > 59)
      return { ...state, reason: "invalid-calendar-input", label: "Invalid market time", message: "A valid market date and time are required before generating orders." };
    if (!isSupportedDate(now.date))
      return { ...state, reason: "unsupported-calendar", label: "Calendar update required", message: "The verified NYSE calendar covers 2025–2028. Update the calendar before generating orders for this date." };
    if (!isSession(now.date))
      return { ...state, reason: "non-session", label: `No ${symbol} session today`, message: `Today is not a ${symbol} trading session, so no same-day DAY orders are generated.` };
    const closeMinutes = sessionCloseMinutes(now.date), minutes = now.hour * 60 + now.minute;
    state.closeMinutes = closeMinutes;
    if (minutes < regularOpenMinutes)
      return { ...state, reason: "before-open", label: "Market not open", message: `The ${symbol} regular session has not opened. Recalculate from 09:36 ET using today's completed 09:35 reference-minute close.` };
    if (minutes < referenceReadyMinutes)
      return { ...state, reason: "reference-forming", label: "09:35 reference not ready", message: "The 09:35 ET reference minute must finish before orders can be generated. Recalculate from 09:36 ET using its closing price." };
    if (minutes >= closeMinutes) {
      const closeLabel = `${String(Math.floor(closeMinutes / 60)).padStart(2, "0")}:${String(closeMinutes % 60).padStart(2, "0")}`;
      return { ...state, reason: "after-close", label: `${closeLabel} ET cutoff passed`, message: `Today's ${symbol} session is over. Same-day orders are no longer generated.` };
    }
    return { ...state, open: true, reason: "open" };
  }

  // Arithmetic is available outside the modeled execution window. Keep that
  // window intact for labeling, and size previews from the next eligible day
  // after a close/holiday/weekend, never from a closed or invented session.
  function planningWindow(now, symbol = "selected instrument") {
    const execution = tradingWindow(now, symbol);
    if (["invalid-calendar-input", "unsupported-calendar"].includes(execution.reason))
      return { ...execution, executionOpen: false, preview: false, planningDate: null };
    let planningDate = new Date(now.date);
    if (!isSession(planningDate) || now.hour * 60 + now.minute >= sessionCloseMinutes(planningDate)) {
      do { planningDate.setUTCDate(planningDate.getUTCDate() + 1); }
      while (isSupportedDate(planningDate) && !isSession(planningDate));
    }
    if (!isSupportedDate(planningDate))
      return { ...execution, open: false, reason: "unsupported-calendar", executionOpen: false, preview: false, planningDate: null,
        label: "Calendar update required", message: "The next eligible session is outside the verified 2025–2028 NYSE calendar." };
    return { ...execution, open: true, executionOpen: execution.open, preview: !execution.open, planningDate,
      label: execution.open ? "Regular session" : "Planning preview",
      message: execution.open ? "" : `Planning preview for ${dateKey(planningDate)} ET using your reference input. The model uses the completed 09:35 reference and fills from 09:36; this is not a live quote or an instruction to trade outside that window.` };
  }

  return Object.freeze({ supportedRange, sources, regularOpenMinutes, referenceReadyMinutes,
    dateKey, isSupportedDate, isSession, sessionCloseMinutes, calendarParts, tradingWindow, planningWindow });
});
