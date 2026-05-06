import { formatInTimeZone } from "date-fns-tz";

/** Institutional default: Zimbabwe (no DST). Override with `VITE_DISPLAY_TIMEZONE` if needed. */
export function getDisplayTimezone(): string {
  const env = String(import.meta.env.VITE_DISPLAY_TIMEZONE ?? "").trim();
  return env || "Africa/Harare";
}

/** `yyyy-MM-dd` in the display zone (for same-day / yesterday logic). */
export function dateKeyInDisplayZone(date: Date, timeZone = getDisplayTimezone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

export function isTodayInDisplayZone(date: Date, timeZone = getDisplayTimezone()): boolean {
  return dateKeyInDisplayZone(date, timeZone) === dateKeyInDisplayZone(new Date(), timeZone);
}

export function isYesterdayInDisplayZone(date: Date, timeZone = getDisplayTimezone()): boolean {
  const todayKey = dateKeyInDisplayZone(new Date(), timeZone);
  return dateKeyInDisplayZone(date, timeZone) === addCalendarDaysToYmd(todayKey, -1);
}

export function isThisYearInDisplayZone(date: Date, timeZone = getDisplayTimezone()): boolean {
  const y = formatInTimeZone(date, timeZone, "yyyy");
  const cy = formatInTimeZone(new Date(), timeZone, "yyyy");
  return y === cy;
}

export function formatInDisplayZone(
  date: Date,
  pattern: string,
  timeZone = getDisplayTimezone()
): string {
  return formatInTimeZone(date, timeZone, pattern);
}
