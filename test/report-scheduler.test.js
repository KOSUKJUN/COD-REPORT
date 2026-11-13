import test from "node:test";
import assert from "node:assert/strict";
import {
  getKoreaDateTimeInput,
  getNextScheduleRun,
  getReportPeriod,
  getScheduleClock,
  isValidDateTimeInput,
  isScheduleDue,
  resolveDateRangeParameters,
  resolveScheduleParameters,
} from "../src/report-scheduler.js";

test("uses Korea time and checks daily schedules at the configured minute", () => {
  const now = new Date("2026-11-06T23:00:00.000Z");
  assert.deepEqual(getScheduleClock(now), {
    date: "2026-11-07",
    hour: "08",
    minute: "00",
    weekday: 6,
    dayOfMonth: 7,
  });
  assert.equal(isScheduleDue({
    enabled: true,
    frequency: "daily",
    time: "08:00",
  }, now), true);
  assert.equal(isScheduleDue({
    enabled: true,
    frequency: "daily",
    time: "08:01",
  }, now), false);
});

test("checks weekly and monthly schedule dates", () => {
  const mondayAtEight = new Date("2026-11-08T23:00:00.000Z");
  assert.equal(isScheduleDue({
    enabled: true,
    frequency: "weekly",
    weekday: 1,
    time: "08:00",
  }, mondayAtEight), true);
  assert.equal(isScheduleDue({
    enabled: true,
    frequency: "monthly",
    dayOfMonth: 9,
    time: "08:00",
  }, mondayAtEight), true);
  assert.equal(isScheduleDue({
    enabled: false,
    frequency: "daily",
    time: "08:00",
  }, mondayAtEight), false);
  assert.equal(isScheduleDue({
    enabled: true,
    frequency: "monthly",
    dayOfMonth: 31,
    time: "08:00",
  }, new Date("2026-02-27T23:00:00.000Z")), true);
});

test("finds the next run for daily, weekly, and monthly schedules in Korea time", () => {
  // 2026-11-07 (Sat) 09:30 KST
  const now = new Date("2026-11-07T00:30:00.000Z");
  assert.deepEqual(
    getNextScheduleRun({ enabled: true, frequency: "daily", time: "08:00" }, now),
    { date: "2026-11-08", time: "08:00", weekday: 0 },
  );
  assert.deepEqual(
    getNextScheduleRun({ enabled: true, frequency: "daily", time: "18:00" }, now),
    { date: "2026-11-07", time: "18:00", weekday: 6 },
  );
  assert.deepEqual(
    getNextScheduleRun({ enabled: true, frequency: "weekly", weekday: 1, time: "08:00" }, now),
    { date: "2026-11-09", time: "08:00", weekday: 1 },
  );
  assert.deepEqual(
    getNextScheduleRun(
      { enabled: true, frequency: "monthly", dayOfMonth: 31, time: "08:00" },
      new Date("2027-02-01T00:00:00.000Z"),
    ),
    { date: "2027-02-28", time: "08:00", weekday: 0 },
  );
  assert.equal(
    getNextScheduleRun({ enabled: false, frequency: "daily", time: "08:00" }, now),
    null,
  );
});

test("builds date parameters for the previous daily, weekly, or monthly period", () => {
  assert.deepEqual(getReportPeriod("2026-11-07", "daily"), {
    reportDate: "2026-11-07",
    previousDate: "2026-11-06",
    periodStart: "2026-11-06",
    periodEnd: "2026-11-06",
  });
  assert.deepEqual(getReportPeriod("2026-11-09", "weekly"), {
    reportDate: "2026-11-09",
    previousDate: "2026-11-08",
    periodStart: "2026-11-02",
    periodEnd: "2026-11-08",
  });
  assert.deepEqual(getReportPeriod("2026-01-01", "monthly"), {
    reportDate: "2026-01-01",
    previousDate: "2025-12-31",
    periodStart: "2025-12-01",
    periodEnd: "2025-12-31",
  });
});

test("resolves dynamic date values in query parameters without changing literal values", () => {
  assert.deepEqual(resolveScheduleParameters([
    "{{reportDate}}",
    "{{periodStart}}",
    "{{periodEnd}}",
    "literal",
    12,
  ], getReportPeriod("2026-11-09", "weekly")), [
    "2026-11-09",
    "2026-11-02",
    "2026-11-08",
    "literal",
    12,
  ]);
});

test("validates and formats Korea local date-time ranges", () => {
  const now = new Date("2026-11-07T00:45:00.000Z");
  assert.equal(getKoreaDateTimeInput(now), "2026-11-07T09:45");
  assert.equal(isValidDateTimeInput("2026-11-07T09:45"), true);
  assert.equal(isValidDateTimeInput("2026-02-30T09:45"), false);
  assert.equal(isValidDateTimeInput("2026-11-07T24:00"), false);
});

test("replaces query parameters with the selected range bounds", () => {
  assert.deepEqual(
    resolveDateRangeParameters({
      start: "2026-11-07T08:00:00",
      end: "2026-11-07T17:00:00",
    }),
    ["2026-11-07T08:00:00", "2026-11-07T17:00:00"],
  );
});
