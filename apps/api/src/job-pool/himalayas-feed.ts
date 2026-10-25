import { eligibleCountries, excludedCountries, POOL_COUNTRIES } from './job-geography';

const queries = ['software', 'developer', 'devops', 'data engineer', 'qa engineer', 'security engineer', 'machine learning'];
export const HIMALAYAS_SEARCHES = ['US', 'GB', 'IE'].flatMap(country => queries.map(query => ({ token: `${country.toLowerCase()}-${query.replace(/ /g, '-')}`, country, query })));
export const HIMALAYAS_MAX_PAGES = 250;
export function himalayasUrl(board: string, cursor: string | null) {
  const search = HIMALAYAS_SEARCHES.find(item => item.token === board);
  if (!search || (cursor !== null && (!/^[1-9]\d{0,3}$/.test(cursor) || Number(cursor) > HIMALAYAS_MAX_PAGES))) throw new Error('Invalid Himalayas search or page.');
  const url = new URL('https://himalayas.app/jobs/api/search');
  url.search = new URLSearchParams({ q: search.query, country: search.country, sort: 'recent', page: cursor || '1' }).toString();
  return url;
}
function offset(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = typeof value === 'string' && /^(?:UTC|GMT)?\s*([+-]?\d{1,2})(?::(\d{2}))?$/i.exec(value);
  return match ? Number(match[1]) + Number(match[2] || 0) / 60 * (match[1].startsWith('-') ? -1 : 1) : null;
}
export function himalayasCountries(row: Record<string, any>, description: string) {
  if (!Array.isArray(row.locationRestrictions) || row.locationRestrictions.some((value: unknown) => typeof value !== 'string') || !Array.isArray(row.timezoneRestrictions)) return [];
  const countries = row.locationRestrictions.length ? [...new Set(row.locationRestrictions.flatMap((country: string) => eligibleCountries('', country)))] : [...POOL_COUNTRIES];
  const offsets = row.timezoneRestrictions.map(offset), excluded = excludedCountries(description);
  const zones = { US: [-10, -9, -8, -7, -6, -5, -4], GB: [0, 1], IE: [0, 1] };
  if (offsets.some((value: unknown) => value === null)) return [];
  return countries.filter(country => !excluded.includes(country) && (!offsets.length || zones[country].some(zone => offsets.includes(zone))));
}
