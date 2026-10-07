const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const calendar = require("../execution/market-calendar.js");

const day = date => new Date(`${date}T00:00:00.000Z`);
const at = (date, hour, minute) => ({ date: day(date), hour, minute });
const ny = timestamp => calendar.calendarParts({ market_calendar: "XNYS" }, new Date(timestamp));

test("published NYSE holiday dates are closed in every supported year", () => {
  const holidays = {
    2025: ["01-01", "01-20", "02-17", "04-18", "05-26", "06-19", "07-04", "09-01", "11-27", "12-25"],
    2026: ["01-01", "01-19", "02-16", "04-03", "05-25", "06-19", "07-03", "09-07", "11-26", "12-25"],
    2027: ["01-01", "01-18", "02-15", "03-26", "05-31", "06-18", "07-05", "09-06", "11-25", "12-24"],
    2028: ["01-17", "02-21", "04-14", "05-29", "06-19", "07-04", "09-04", "11-23", "12-25"]
  };
  for (const [year, dates] of Object.entries(holidays)) for (const suffix of dates) {
    const date = `${year}-${suffix}`;
    assert.equal(calendar.isSupportedDate(date), true, date);
    assert.equal(calendar.isSession(date), false, date);
    assert.equal(calendar.isSession(day(date)), false, date);
    assert.equal(calendar.sessionCloseMinutes(date), null, date);
    assert.equal(calendar.tradingWindow(at(date, 10, 0), "SPY").open, false, date);
  }
});

test("exceptional Carter mourning closure is not a normal Thursday", () => {
  assert.equal(calendar.isSession("2025-01-08"), true);
  assert.equal(calendar.isSession("2025-01-09"), false);
  assert.equal(calendar.sessionCloseMinutes("2025-01-09"), null);
  assert.equal(calendar.isSession("2025-01-10"), true);
});

test("only published early-close sessions end at 13:00 ET", () => {
  const expected = new Set([
    "2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24",
    "2027-11-26", "2028-07-03", "2028-11-24"
  ]);
  for (let cursor = day(calendar.supportedRange.start); cursor <= day(calendar.supportedRange.end); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = calendar.dateKey(cursor), close = calendar.sessionCloseMinutes(cursor);
    if (expected.has(date)) assert.equal(close, 780, date);
    else if (calendar.isSession(cursor)) assert.equal(close, 960, date);
    else assert.equal(close, null, date);
  }
});

test("nearby holidays do not invent a July or Christmas early close", () => {
  for (const date of ["2026-07-02", "2027-07-02", "2027-12-23", "2028-12-22", "2025-12-31", "2026-12-31", "2027-12-31"])
    assert.equal(calendar.sessionCloseMinutes(date), 960, date);
  // NYSE explicitly does not observe Saturday January 1 on the Friday before it.
  assert.equal(calendar.isSession("2027-12-31"), true);
  assert.equal(calendar.isSession("2028-01-01"), false);
  assert.equal(calendar.isSession("2028-01-03"), true);
});

test("weekends close while NYSE-open bank holidays stay open", () => {
  for (const date of ["2026-10-03", "2026-10-04", "2028-12-31"])
    assert.equal(calendar.tradingWindow(at(date, 10, 0)).reason, "non-session", date);
  for (const date of ["2025-10-13", "2025-11-11", "2026-10-12", "2026-11-11"])
    assert.equal(calendar.sessionCloseMinutes(date), 960, date);
});

test("modeled execution window stays closed before open and throughout the 09:35 minute", () => {
  for (const [hour, minute] of [[0, 0], [9, 29], [9, 30], [9, 34], [9, 35]]) {
    const state = calendar.tradingWindow(at("2026-10-05", hour, minute), "SPY");
    assert.equal(state.open, false, `${hour}:${minute}`);
    assert.equal(state.closeMinutes, 960);
  }
  assert.equal(calendar.tradingWindow(at("2026-10-05", 9, 29)).reason, "before-open");
  assert.equal(calendar.tradingWindow(at("2026-10-05", 9, 35)).reason, "reference-forming");
  assert.equal(calendar.tradingWindow(ny("2026-10-05T13:35:59.999Z")).open, false);
  const open = calendar.tradingWindow(ny("2026-10-05T13:36:00.000Z"));
  assert.equal(open.open, true);
  assert.equal(open.startMinutes, 576);
});

test("regular session closes at 16:00 for the shared BUY/SELL window", () => {
  assert.equal(calendar.tradingWindow(at("2026-10-05", 15, 59)).open, true);
  assert.equal(calendar.tradingWindow(at("2026-10-05", 16, 0)).open, false);
  assert.equal(calendar.tradingWindow(at("2026-10-05", 23, 59)).reason, "after-close");
});

test("all half days allow 12:59 but block at 13:00, including both DST offsets", () => {
  for (const date of ["2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]) {
    assert.equal(calendar.tradingWindow(at(date, 9, 35)).open, false, date);
    assert.equal(calendar.tradingWindow(at(date, 9, 36)).open, true, date);
    assert.equal(calendar.tradingWindow(at(date, 12, 59)).open, true, date);
    const closed = calendar.tradingWindow(at(date, 13, 0));
    assert.equal(closed.open, false, date);
    assert.equal(closed.closeMinutes, 780, date);
    assert.match(closed.label, /13:00/, date);
  }
  assert.equal(calendar.tradingWindow(ny("2025-07-03T16:59:59Z")).open, true);
  assert.equal(calendar.tradingWindow(ny("2025-07-03T17:00:00Z")).open, false);
  assert.equal(calendar.tradingWindow(ny("2026-11-27T17:59:59Z")).open, true);
  assert.equal(calendar.tradingWindow(ny("2026-11-27T18:00:00Z")).open, false);
});

test("spring and fall DST changes preserve the local reference and closing boundaries", () => {
  for (const [date, readyHour, closeHour] of [
    ["2026-03-06", 14, 21], ["2026-03-09", 13, 20],
    ["2026-10-30", 13, 20], ["2026-11-02", 14, 21]
  ]) {
    assert.equal(calendar.tradingWindow(ny(`${date}T${readyHour}:35:59Z`)).open, false, date);
    assert.equal(calendar.tradingWindow(ny(`${date}T${readyHour}:36:00Z`)).open, true, date);
    assert.equal(calendar.tradingWindow(ny(`${date}T${closeHour - 1}:59:59Z`)).open, true, date);
    assert.equal(calendar.tradingWindow(ny(`${date}T${closeHour}:00:00Z`)).open, false, date);
  }
});

test("New York civil dates differ correctly from UTC around midnight", () => {
  const winterBefore = ny("2026-01-06T04:59:59Z"), winterAfter = ny("2026-01-06T05:00:00Z");
  assert.equal(calendar.dateKey(winterBefore.date), "2026-01-05");
  assert.equal(winterBefore.hour, 23);
  assert.equal(calendar.dateKey(winterAfter.date), "2026-01-06");
  assert.equal(winterAfter.hour, 0);
  const summerBefore = ny("2026-07-07T03:59:59Z"), summerAfter = ny("2026-07-07T04:00:00Z");
  assert.equal(calendar.dateKey(summerBefore.date), "2026-07-06");
  assert.equal(summerBefore.hour, 23);
  assert.equal(calendar.dateKey(summerAfter.date), "2026-07-07");
  assert.equal(summerAfter.hour, 0);
  const weekend = ny("2026-10-05T03:59:59Z");
  assert.equal(calendar.dateKey(weekend.date), "2026-10-04");
  assert.equal(calendar.tradingWindow(weekend).reason, "non-session");
});

test("24X7 timestamp conversion remains UTC without inheriting NYSE holidays", () => {
  const instant = new Date("2026-07-04T00:01:00Z");
  const parts = calendar.calendarParts({ market_calendar: "24X7" }, instant);
  assert.equal(calendar.dateKey(parts.date), "2026-07-04");
  assert.equal(parts.hour, 0);
  assert.equal(parts.minute, 1);
  assert.equal(calendar.dateKey(ny(instant.toISOString()).date), "2026-07-03");
});

test("unsupported years fail closed without guessing holiday rules", () => {
  for (const date of ["2024-12-31", "2029-01-02", "2030-06-03"]) {
    assert.equal(calendar.isSupportedDate(date), false, date);
    assert.equal(calendar.isSession(date), false, date);
    assert.throws(() => calendar.sessionCloseMinutes(date), /NYSE calendar.*2025-01-01.*2028-12-31/, date);
    assert.equal(calendar.tradingWindow(at(date, 10, 0)).reason, "unsupported-calendar", date);
  }
  assert.equal(calendar.isSupportedDate("2025-01-01"), true);
  assert.equal(calendar.isSupportedDate("2028-12-31"), true);
  assert.equal(calendar.isSession("2028-02-29"), true);
});

test("invalid civil dates and time fields fail closed", () => {
  for (const invalid of [null, undefined, NaN, new Date(NaN), "2026-02-29", "2026-13-01", "2026-00-01", "2026-1-05", "2026-10-05T00:00:00Z", 1791158400000]) {
    assert.equal(calendar.isSupportedDate(invalid), false);
    assert.equal(calendar.isSession(invalid), false);
    assert.throws(() => calendar.sessionCloseMinutes(invalid), /NYSE calendar.*valid date/);
    assert.equal(calendar.tradingWindow({ date: invalid, hour: 10, minute: 0 }).open, false);
  }
  for (const badTime of [null, {}, { hour: -1, minute: 0 }, { hour: 24, minute: 0 }, { hour: 10, minute: 60 }, { hour: 10, minute: NaN }, { hour: 9.5, minute: 36 }, { hour: "10", minute: 0 }])
    assert.equal(calendar.tradingWindow(badTime && { date: day("2026-10-05"), ...badTime }).reason, "invalid-calendar-input");
  assert.throws(() => calendar.calendarParts({}, new Date(NaN)), /valid timestamp/);
});

test("browser bundle publishes the same dependency-free calendar API", () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(fs.readFileSync(require.resolve("../execution/market-calendar.js"), "utf8"), context);
  assert.equal(context.ExecutionCalendar.isSession("2025-01-09"), false);
  assert.equal(context.ExecutionCalendar.sessionCloseMinutes("2026-11-27"), 780);
  assert.equal(context.ExecutionCalendar.tradingWindow(at("2026-10-05", 9, 35)).open, false);
  assert.equal(context.ExecutionCalendar.tradingWindow(at("2026-10-05", 9, 36)).open, true);
});


test("planning is available outside the modeled window with an explicit next eligible session", () => {
  for (const [stamp, date, preview] of [
    ["2026-10-05T10:00:00Z", "2026-10-05", true],
    ["2026-10-05T13:35:59Z", "2026-10-05", true],
    ["2026-10-05T13:36:00Z", "2026-10-05", false],
    ["2026-10-05T20:00:00Z", "2026-10-06", true],
    ["2026-10-09T20:00:00Z", "2026-10-12", true],
    ["2026-10-10T14:00:00Z", "2026-10-12", true],
    ["2026-11-26T14:00:00Z", "2026-11-27", true],
    ["2026-11-27T18:00:00Z", "2026-11-30", true],
    ["2026-03-09T13:35:59Z", "2026-03-09", true],
    ["2026-11-02T14:35:59Z", "2026-11-02", true],
    ["2026-10-05T03:59:59Z", "2026-10-05", true],
  ]) {
    const state = calendar.planningWindow(ny(stamp), "SPY");
    assert.equal(state.open, true, stamp);
    assert.equal(state.preview, preview, stamp);
    assert.equal(state.executionOpen, !preview, stamp);
    assert.equal(calendar.dateKey(state.planningDate), date, stamp);
    if (preview) assert.match(state.message, /Planning preview.*not a live quote/);
  }
});

test("planning still fails closed for invalid or unverifiable calendar dates", () => {
  for (const value of [null, at("2029-01-01", 10, 0), at("2024-12-31", 10, 0), at("2028-12-29", 16, 0), at("2028-12-31", 10, 0)]) {
    const state = calendar.planningWindow(value);
    assert.equal(state.open, false); assert.equal(state.planningDate, null);
  }
});
