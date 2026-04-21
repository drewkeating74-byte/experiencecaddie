export const MIN_TRIP_LEAD_CALENDAR_DAYS = 14;

export function normalizeClientTimeZone(clientTimezone?: string | null): string {
  const raw = (clientTimezone ?? "").trim();
  const tz = raw || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "UTC";
  }
}

export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  const tz = normalizeClientTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDaysToYmd(ymd: string, delta: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsToYmd(ymd: string, months: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export function minTripStartYmdForTimezone(clientTimezone?: string | null): string {
  const tz = normalizeClientTimeZone(clientTimezone);
  const today = calendarDateInTimeZone(new Date(), tz);
  return addCalendarDaysToYmd(today, MIN_TRIP_LEAD_CALENDAR_DAYS);
}

export function extractIsoDateYmd(dateTime: string | null | undefined): string | null {
  if (dateTime == null) return null;
  const s = String(dateTime).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function firstFutureConcertDisplayYmd(clientTimezone?: string | null): string {
  const tz = normalizeClientTimeZone(clientTimezone);
  const today = calendarDateInTimeZone(new Date(), tz);
  return addCalendarDaysToYmd(today, 1);
}

export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
