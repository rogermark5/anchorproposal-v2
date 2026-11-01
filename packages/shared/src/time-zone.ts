export const DEFAULT_TIME_ZONE = 'UTC';
/** Current civil-time offset, including daylight saving and fractional hours. */
export function timeZoneOffset(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at);
  const offset = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT';
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset);
  return match ? `GMT${match[1]}${match[2].padStart(2, '0')}:${match[3] || '00'}` : 'GMT+00:00';
}
const calendars = new Map<string, Intl.DateTimeFormat>();
export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}
export function calendarDay(value: Date | string | number, timeZone: string): string {
  let formatter = calendars.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (calendars.size > 100) calendars.clear();
    calendars.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)!.value).join('-');
}
export function validCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function shiftCalendarDay(value: string, days: number): string {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** First instant of a calendar day; handles 23/25 hour days and midnight DST changes. */
export function calendarDayStart(value: string, timeZone: string): Date {
  if (!validCalendarDay(value) || !validTimeZone(timeZone)) throw new Error('Choose a valid date and time zone.');
  const noon = Date.parse(value + 'T12:00:00Z');
  let lo = noon - 48 * 3600_000, hi = noon + 48 * 3600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((hi + lo) / 2);
    if (calendarDay(mid, timeZone) < value) lo = mid; else hi = mid;
  }
  return new Date(hi);
}
export function calendarRange(from: string, to: string, timeZone: string) {
  if (!validCalendarDay(from) || !validCalendarDay(to) || from > to || !validTimeZone(timeZone)) throw new Error('Choose a valid From and To date and time zone.');
  return { gte: calendarDayStart(from, timeZone), lt: calendarDayStart(shiftCalendarDay(to, 1), timeZone) };
}
