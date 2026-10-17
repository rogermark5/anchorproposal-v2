// Public, keyless API and redistribution instructions:
// https://remotejobs.org/developers/api
export const REMOTEJOBS_CATEGORIES = ['programming', 'devops', 'data-science', 'ai-machine-learning', 'cybersecurity', 'cyber-security', 'quality-assurance'] as const;
export const REMOTEJOBS_MAX_PAGES = 200;

type Geography = Record<string, any>;
const includesUs = (values: unknown) => Array.isArray(values) && values.some(value => typeof value === 'string' && /^US(?:-|$)/i.test(value));
export function remotejobsEligibility(row: Record<string, any>): 'us' | 'worldwide' | null {
  const applicant: Geography = row.applicant_location_requirements || row.location_normalization || {};
  const location: Geography = row.location_normalization || {};
  if (applicant.status !== 'known' || applicant.work_arrangement !== 'remote' ||
    includesUs(applicant.excluded_countries) || includesUs(location.excluded_countries) ||
    (Array.isArray(applicant.unresolved) && applicant.unresolved.length)) return null;
  if (includesUs(applicant.allowed_countries) || includesUs(applicant.allowed_subdivisions)) return 'us';
  // A bare Remote label or an inferred worldwide scope is insufficient.
  if (applicant.scope === 'worldwide' && applicant.worldwide_permission_verified === true &&
    !applicant.allowed_countries?.length && !applicant.allowed_regions?.length && !applicant.excluded_subdivisions?.length) return 'worldwide';
  return null;
}

export function remotejobsUrl(board: string, cursor: string | null): URL {
  if (!REMOTEJOBS_CATEGORIES.includes(board as typeof REMOTEJOBS_CATEGORIES[number])) throw new Error('Choose a supported RemoteJobs.org software category.');
  if (cursor && (!/^\d+$/.test(cursor) || Number(cursor) > 9950 || Number(cursor) % 50)) throw new Error('Invalid RemoteJobs.org page cursor.');
  const url = new URL('https://remotejobs.org/api/v1/jobs');
  url.search = new URLSearchParams({category: board, limit: '50', offset: cursor || '0'}).toString();
  return url;
}

// Aggregators can use their own URL for a posting already in an employer feed.
// Match substantial near-identical content only after company and title agree.
export function samePostingGroup(company: string, title: string): string {
  const normalized = (value: string) => value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return normalized(company).replace(/\s+(?:inc|llc|ltd|limited|corporation|corp)$/, '') + ':' + normalized(title);
}
export function postingShingles(description: string): Set<string> {
  const words = description.toLowerCase().replace(/https?:\/\/\S+/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  const result = new Set<string>();
  for (let i = 0; i + 4 < words.length; i++) result.add(words.slice(i, i + 5).join(' '));
  return result;
}
export function samePostingContent(left: Set<string>, right: Set<string>): boolean {
  if (Math.min(left.size, right.size) < 40) return false;
  let shared = 0; for (const item of left) if (right.has(item)) shared++;
  return shared / Math.min(left.size, right.size) >= 0.8;
}
