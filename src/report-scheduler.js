const WEEKDAYS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function dateOffset(date, offset) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return value.toISOString().slice(0, 10);
}

export function getScheduleClock(now = new Date(), timeZone = "Asia/Seoul") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: values.hour,
    minute: values.minute,
    weekday: WEEKDAYS[values.weekday],
    dayOfMonth: Number(values.day),
  };
}

export function getKoreaDateTimeInput(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function isValidDateTimeInput(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute;
}

export function isScheduleDue(schedule, now = new Date(), timeZone = "Asia/Seoul") {
  if (!schedule.enabled) {
    return false;
  }
  const clock = getScheduleClock(now, timeZone);
  if (`${clock.hour}:${clock.minute}` !== schedule.time) {
    return false;
  }
  if (schedule.frequency === "weekly") {
    return clock.weekday === Number(schedule.weekday);
  }
  if (schedule.frequency === "monthly") {
    const [year, month] = clock.date.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return clock.dayOfMonth === Math.min(Number(schedule.dayOfMonth), lastDay);
  }
  return schedule.frequency === "daily";
}

export function getNextScheduleRun(schedule, now = new Date(), timeZone = "Asia/Seoul") {
  if (!schedule?.enabled || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time ?? "")) {
    return null;
  }
  const clock = getScheduleClock(now, timeZone);
  const currentTime = `${clock.hour}:${clock.minute}`;
  for (let offset = 0; offset <= 62; offset += 1) {
    if (offset === 0 && schedule.time < currentTime) {
      continue;
    }
    const date = dateOffset(clock.date, offset);
    const [year, month, day] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (schedule.frequency === "weekly" && weekday !== Number(schedule.weekday)) {
      continue;
    }
    if (schedule.frequency === "monthly") {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (day !== Math.min(Number(schedule.dayOfMonth), lastDay)) {
        continue;
      }
    }
    return { date, time: schedule.time, weekday };
  }
  return null;
}

export function getReportPeriod(date, frequency) {
  const previousDate = dateOffset(date, -1);
  if (frequency === "weekly") {
    return {
      reportDate: date,
      previousDate,
      periodStart: dateOffset(date, -7),
      periodEnd: previousDate,
    };
  }
  if (frequency === "monthly") {
    const [year, month] = date.split("-").map(Number);
    const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
    const priorMonthEnd = dateOffset(firstOfMonth, -1);
    return {
      reportDate: date,
      previousDate,
      periodStart: `${priorMonthEnd.slice(0, 7)}-01`,
      periodEnd: priorMonthEnd,
    };
  }
  return {
    reportDate: date,
    previousDate,
    periodStart: previousDate,
    periodEnd: previousDate,
  };
}

export function resolveScheduleParameters(parameters, period) {
  const tokens = {
    "{{reportDate}}": period.reportDate,
    "{{previousDate}}": period.previousDate,
    "{{periodStart}}": period.periodStart,
    "{{periodEnd}}": period.periodEnd,
  };
  return parameters.map((parameter) => {
    if (typeof parameter !== "string") {
      return parameter;
    }
    return tokens[parameter] ?? parameter;
  });
}

export function resolveDateRangeParameters(range) {
  return [range.start, range.end];
}
