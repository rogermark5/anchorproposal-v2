export const POOL_DAY_MS = 86_400_000;
export const POOL_MAX_POSTING_AGE_MS = 30 * POOL_DAY_MS;
const calendars = new Map<string, Intl.DateTimeFormat>();

function postingCalendar(timeZone: string) {
  let calendar = calendars.get(timeZone);
  if (!calendar) {
    calendar = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    calendars.set(timeZone, calendar);
  }
  return calendar;
}

export function poolImportTimeZone(): string {
  const timeZone = process.env.JOB_POOL_TIME_ZONE?.trim() || 'America/Los_Angeles';
  postingCalendar(timeZone); // Reject invalid configuration before importing.
  return timeZone;
}

export function isFreshPoolPosting(value: Date | string | null | undefined, now = new Date(), timeZone = poolImportTimeZone()): boolean {
  if (!value) return false;
  const posted = new Date(value), time = posted.getTime();
  if (!Number.isFinite(time) || time > now.getTime()) return false;
  // Compare calendar dates in the configured zone. Subtracting 24 hours would
  // admit yesterday's jobs and fails on 23- or 25-hour daylight-saving days.
  const calendar = postingCalendar(timeZone);
  return calendar.format(posted) === calendar.format(now);
}

export function poolPostingWindow(now = new Date()) {
  // Keep legacy undated records without inventing a publication date. New
  // undated postings cannot enter the pool through the import path.
  return { OR: [{ publishedAt: null }, { publishedAt: { gte: new Date(now.getTime() - POOL_MAX_POSTING_AGE_MS), lte: now } }] };
}
