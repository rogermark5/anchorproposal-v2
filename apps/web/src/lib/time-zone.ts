import { calendarDay, validTimeZone } from '@anchorproposal/shared';
// The initial server/client render must agree; the provider then loads the account zone.
let selectedTimeZone = 'UTC';
export function displayTimeZone() { return selectedTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
export function setDisplayTimeZone(value: string) { if (validTimeZone(value)) selectedTimeZone = value; }
export function todayInTimeZone() { return calendarDay(new Date(), displayTimeZone()); }
export function formatZonedDate(value: string | Date, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Date(value).toLocaleDateString('en-US', { ...options, timeZone: displayTimeZone() });
}
export function formatZonedDateTime(value: string | Date) {
  return new Date(value).toLocaleString('en-US', { timeZone: displayTimeZone(), timeZoneName: 'short' });
}
