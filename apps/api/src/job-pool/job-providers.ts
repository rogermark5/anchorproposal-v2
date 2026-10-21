import { WorkArrangement } from '@prisma/client';
import { isSoftwareOccupation as isSoftwareJob, mayBeSoftwareOccupation as mayBeSoftwareJob } from './software-jobs';
import { freehireCursor, FREEHIRE_SOURCES, freehireNext, freehireUrl } from './freehire-feed';
import { REMOTEJOBS_CATEGORIES, remotejobsCountries, remotejobsUrl } from './remotejobs-feed';
import { eligibleCountries, COUNTRY_NAMES, POOL_COUNTRIES, PoolCountry, poolCountry, unrestrictedWorldwide } from './job-geography';
import { parseCareerResponse, PUBLIC_CAREER_PROVIDERS, schemaJobLocations, validCareerBoard } from './public-career-feeds';

export const JOB_PROVIDERS = [
  { id: 'jobicy', name: 'Jobicy', board: true, choices: ['usa', 'uk', 'ireland', 'anywhere'], docs: 'https://github.com/Jobicy/remote-jobs-api' },
  { id: 'remoteok', name: 'Remote OK', board: false, docs: 'https://remoteok.com/api' },
  { id: 'greenhouse', name: 'Greenhouse', board: true, docs: 'https://docs.greenhouse.io/job-board.html' },
  { id: 'lever', name: 'Lever', board: true, docs: 'https://github.com/lever/postings-api' },
  { id: 'ashby', name: 'Ashby', board: true, docs: 'https://developers.ashbyhq.com/docs/public-job-posting-api' },
  { id: 'workable', name: 'Workable', board: true, docs: 'https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page' },
  { id: 'recruitee', name: 'Recruitee', board: true, docs: 'https://support.recruitee.com/en/articles/8213076-faq-api' },
  { id: 'breezy', name: 'Breezy HR', board: true, docs: 'https://help.breezy.hr/en/articles/9237171-working-with-positions' },
  { id: 'pinpoint', name: 'Pinpoint', board: true, docs: 'https://developers.pinpointhq.com/docs/jobs-json-endpoint' },
  { id: 'personio', name: 'Personio', board: true, docs: 'https://developer.personio.de/v1.0/reference/get_xml' },
  { id: 'teamtailor', name: 'Teamtailor', board: true, docs: 'https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide' },
  { id: 'bamboohr', name: 'BambooHR', board: true, docs: 'https://documentation.bamboohr.com/reference/create-job-opening' },
  { id: 'paylocity', name: 'Paylocity public careers', board: true, docs: 'https://recruiting.paylocity.com/' },
  { id: 'smartrecruiters', name: 'SmartRecruiters', board: true, docs: 'https://developers.smartrecruiters.com/docs/endpoints' },
  { id: 'usajobs', name: 'USAJOBS', board: false, docs: 'https://developer.usajobs.gov/' },
  { id: 'freehire', name: 'Freehire · employer feeds', board: true, choices: FREEHIRE_SOURCES, docs: 'https://freehire.me/docs/api' },
  { id: 'freehire-global', name: 'Freehire · confirmed worldwide', board: true, choices: FREEHIRE_SOURCES, docs: 'https://freehire.me/docs/api' },
  { id: 'ocean', name: 'Ocean of Jobs', board: false, docs: 'https://oceanofjobs.com/api/help' },
  { id: 'remotejobs', name: 'RemoteJobs.org', board: true, choices: REMOTEJOBS_CATEGORIES, docs: 'https://remotejobs.org/developers/api' },
] as const;
export type ProviderId = typeof JOB_PROVIDERS[number]['id'];
export type ImportSource = { provider: string; name: string; boardToken: string };
// This is adapter search capability, not evidence of current hiring in a country.
// Employer boards are shared: a board is fetched once and its jobs are classified.
export function sourceCountries(source: Pick<ImportSource, 'provider' | 'boardToken'>): readonly PoolCountry[] {
  if (!JOB_PROVIDERS.some(provider => provider.id === source.provider)) return [];
  if (source.provider === 'usajobs') return ['US'];
  if (source.provider === 'jobicy') {
    if (source.boardToken === 'uk') return ['GB'];
    if (source.boardToken === 'ireland') return ['IE'];
    if (source.boardToken === 'anywhere') return POOL_COUNTRIES;
    return !source.boardToken || source.boardToken === 'usa' ? ['US'] : [];
  }
  return POOL_COUNTRIES;
}
export type ImportedJob = {
  externalId: string; jobUrl: string; title: string; company: string; location: string; eligibleCountries: PoolCountry[];
  description: string; workArrangement: WorkArrangement; sourceName: string;
  salary: string | null; employmentType: string | null; publishedAt: Date | null; expiresAt: Date | null;
};
export type ImportPage = { jobs: ImportedJob[]; next: string | null; complete: boolean; incomplete?: boolean };
type Row = Record<string, any>;
export const MIN_SYNC_MS = 60 * 60 * 1000;
export const MAX_IMPORT_PAGES = 30;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export function plainText(value: unknown, max = 100_000): string {
  if (typeof value !== 'string') return '';
  let text = value.slice(0, max * 3);
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', bull: '•' };
  for (let pass = 0; pass < 2; pass++) text = text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, key: string) => {
    if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? match;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:p|div|li|br|h[1-6]|ul|ol)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim().slice(0, max);
}
export function publicJobUrl(value: unknown): string | null {
  try {
    if (typeof value !== 'string' || value.length > 3000) return null;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) || url.hostname.includes(':')) return null;
    return url.toString();
  } catch { return null; }
}
export function jobDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date : null;
}
const US_NAMES = /\b(?:united states(?: of america)?|u\.?s\.?a\.?|u\.s\.|US|USA)\b/i;
const US_STATES = /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\b/i;
const US_CITIES = /\b(?:San Francisco|San Jose|Los Angeles|San Diego|New York City|NYC|Seattle|Boston|Chicago|Austin|Dallas|Houston|Denver|Atlanta|Miami|Philadelphia|Phoenix|Salt Lake City|Portland|Pittsburgh|Raleigh|San Antonio|Minneapolis|Nashville|Detroit|Baltimore|Washington DC)\b/i;
const STATE_CODES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
function genericRemoteLabel(location: string): boolean {
  if (/^(?:remote(?:\s*[-/]\s*remote)?|any location\s*[/,-]\s*remote|remote\s*\(any state\)|nationwide remote|remote\s*[/,-]\s*homebased)$/i.test(location)) return true;
  const state = /^(?:remote\s*[-/]\s*([a-z]{2})|([a-z]{2})\s*[-/]\s*remote)$/i.exec(location);
  return !!state && STATE_CODES.has((state[1] || state[2]).toUpperCase());
}
export function isUsLocation(location: unknown, country?: unknown): boolean {
  if (typeof country === 'string' && country.trim()) return /^(US|USA|United States(?: of America)?)$/i.test(country.trim());
  if (typeof location !== 'string' || !location.trim()) return false;
  const normalizedLocation = location.replace(/_/g, ' ');
  // Never infer US eligibility from a salary, company headquarters or description.
  if (US_NAMES.test(normalizedLocation)) return true;
  if (/\b(?:Canada|UK|United Kingdom|Europe|Germany|India|Australia|Mexico|Brazil|Singapore|France|Ireland|Poland)\b/i.test(normalizedLocation.replace(/New Mexico/gi, ''))) return false;
  // Georgia is also a country; an unqualified match is not enough evidence.
  if (/\bGeorgia\b/i.test(normalizedLocation) && !/\b(?:Atlanta|GA)\b/.test(normalizedLocation)) return false;
  return /(?:,|\()\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/.test(normalizedLocation) || US_STATES.test(normalizedLocation) || US_CITIES.test(normalizedLocation);
}
export function isExplicitWorldwide(location: unknown, country?: unknown): boolean {
  if (typeof country === 'string' && country.trim() && !isUsLocation('', country)) return false;
  if (typeof location !== 'string' || !/\b(?:worldwide|global|anywhere)\b/i.test(location)) return false;
  // Only an explicit unrestricted location qualifies. "Remote" alone, a
  // timezone, a company headquarters, or "Worldwide except US" does not.
  return !location.replace(/\b(?:work from anywhere|worldwide|global|anywhere|fully remote|remote|fully)\b|100%/gi, '').replace(/[\s\p{P}]/gu, '');
}
export function isUsEligibleLocation(location: unknown, country?: unknown): boolean {
  if (typeof location === 'string' && /\b(?:except|excluding|outside|not (?:in|available in|open to))\s+(?:the\s+)?(?:US|USA|United States)\b/i.test(location)) return false;
  return isUsLocation(location, country) || isExplicitWorldwide(location, country);
}
export function arrangement(value: unknown): WorkArrangement {
  const text = String(value || '').toLowerCase();
  if (/\bhybrid\b/.test(text)) return 'HYBRID';
  if (/\b(?:non[- ]remote|not remote|no remote|remote (?:is )?not (?:available|allowed)|on[- ]?site|in[- ]office|office[- ]based)\b/.test(text)) return 'ONSITE';
  return /\bremote\b|\bwork(?:ing)? from home\b|\bhome[- ]based\b/.test(text) ? 'REMOTE' : 'UNKNOWN';
}
function array(value: unknown): Row[] { return Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : []; }
function salary(min: unknown, max: unknown, currency = 'USD', period = 'year'): string | null {
  const numbers = [min, max].filter(value => Number.isFinite(Number(value)) && Number(value) > 0).map(value => Number(value).toLocaleString('en-US'));
  return numbers.length ? `${currency} ${[...new Set(numbers)].join(' – ')} / ${period}` : null;
}
function remoteTitle(title: unknown): string {
  // A job about remote sensing/support is not evidence of remote work.
  const text = String(title || '');
  return /\([^)]{0,60}\bremote\b[^)]*\)|[-–—|]\s*(?:fully\s+|100%\s+)?remote\b|\bremote\s*[-–—|]\s*(?:US|USA|United States)\b/i.test(text) ? text : '';
}
function convert(source: ImportSource, row: Row): ImportedJob | null {
  let data: Row;
  switch (source.provider) {
    case 'remotejobs': {
      const countries = remotejobsCountries(row);
      const link = publicJobUrl(row.apply_url);
      if (!countries.length || !link || new URL(link).hostname !== 'remotejobs.org' || !new URL(link).pathname.startsWith('/remote-jobs/')) return null;
      const location = plainText(row.location, 900);
      if (['HYBRID', 'ONSITE'].includes(arrangement(location))) return null;
      data = { externalId: row.id, jobUrl: link, title: row.title, company: row.company?.name,
        location: location || `Remote · ${countries.map(code => COUNTRY_NAMES[code]).join(', ')}`, eligibleCountries: countries,
        description: row.description, workArrangement: 'REMOTE', sourceName: 'RemoteJobs.org', publishedAt: row.posted_at,
        salary: row.salary_text, employmentType: row.type };
      break;
    }
    case 'ocean': {
      const seen = jobDate(row.last_seen);
      if (row.closed_at || row.confidence !== 'verified' || row.workplace_type !== 'remote' || !eligibleCountries(row.location).length ||
        ['HYBRID', 'ONSITE'].includes(arrangement(row.location)) || !seen || seen.getTime() < Date.now() - 7 * 86400_000 || seen.getTime() > Date.now() + 86400_000) return null;
      data = { externalId: row.id, jobUrl: row.url, title: row.title, company: row.company_name || row.company_domain,
        location: row.location, description: row.description, workArrangement: 'REMOTE', sourceName: `Ocean of Jobs · ${plainText(row.ats, 40) || 'employer'}`,
        publishedAt: row.posted_at, salary: row.salary_is_estimate ? null : row.salary_text };
      break;
    }
    case 'freehire':
    case 'freehire-global': {
      const structured = Array.isArray(row.countries) ? row.countries.map(poolCountry).filter((code: PoolCountry | null): code is PoolCountry => !!code) : [];
      const worldwide = unrestrictedWorldwide(row.location) && Array.isArray(row.countries) && !row.countries.length;
      if (!FREEHIRE_SOURCES.includes(row.source) || row.closed_at || row.work_mode !== 'remote' || (!structured.length && !worldwide) ||
        ['HYBRID', 'ONSITE'].includes(arrangement(row.location))) return null;
      const rawLocation = plainText(row.location, 1000);
      const generic = genericRemoteLabel(rawLocation);
      const located = eligibleCountries(rawLocation);
      const countries = worldwide ? [...POOL_COUNTRIES] : structured.filter((code: PoolCountry) => generic || located.includes(code));
      if (!countries.length) return null;
      const seen = jobDate(row.last_seen_at);
      if (!seen || seen.getTime() < Date.now() - 7 * 86400_000 || seen.getTime() > Date.now() + 86400_000) return null;
      const link = publicJobUrl(row.url);
      if (!link || /(^|\.)(?:himalayas\.app|remotive\.com|remotive\.io|freehire\.me)$/i.test(new URL(link).hostname)) return null;
      data = { externalId: row.public_slug, jobUrl: link, title: row.title, company: row.company, location: generic ? `${rawLocation} · ${countries.map((code: PoolCountry) => COUNTRY_NAMES[code]).join(', ')}` : rawLocation, eligibleCountries: countries,
        description: row.description, workArrangement: 'REMOTE', sourceName: `Freehire · ${row.source}`,
        publishedAt: row.posted_at, employmentType: row.enrichment?.employment_type };
      break;
    }
    case 'jobicy':
      data = { externalId: row.id, jobUrl: row.url, title: row.jobTitle, company: row.companyName, location: row.jobGeo,
        description: row.jobDescription, workArrangement: ['HYBRID', 'ONSITE'].includes(arrangement(row.jobGeo)) ? arrangement(row.jobGeo) : 'REMOTE', sourceName: 'Jobicy', employmentType: Array.isArray(row.jobType) ? row.jobType.join(', ') : row.jobType,
        salary: salary(row.salaryMin, row.salaryMax, row.salaryCurrency || 'USD', row.salaryPeriod || 'year'), publishedAt: row.pubDate };
      break;
    case 'remoteok':
      data = { externalId: row.id, jobUrl: row.url, title: row.position, company: row.company, location: row.location,
        description: row.description, workArrangement: ['HYBRID', 'ONSITE'].includes(arrangement(row.location)) ? arrangement(row.location) : 'REMOTE', sourceName: 'Remote OK', salary: salary(row.salary_min, row.salary_max), publishedAt: row.date };
      break;
    case 'greenhouse': {
      const locations = [row.location?.name, ...array(row.offices).map(office => office.location)].filter(value => typeof value === 'string');
      const workplace = array(row.metadata).filter(item => /(?:workplace|work arrangement|work location type|remote status)/i.test(String(item.name))).map(item => Array.isArray(item.value) ? item.value.join(' ') : item.value).join(' ');
      data = { externalId: row.id, jobUrl: row.absolute_url, title: row.title, company: row.company_name || source.name, location: locations.join(' · '),
        description: row.content, sourceName: `Greenhouse · ${source.name}`, workArrangement: arrangement(workplace || `${locations.join(' ')} ${remoteTitle(row.title)}`), publishedAt: row.first_published || row.updated_at,
        expiresAt: row.application_deadline };
      break;
    }
    case 'lever':
      data = { externalId: row.id, jobUrl: row.hostedUrl, title: row.text, company: source.name, location: row.categories?.location,
        country: row.country, description: [row.descriptionPlain || row.description, ...array(row.lists).map(list => `${list.text || ''}\n${list.content || ''}`), row.additionalPlain || row.additional].filter(Boolean).join('\n\n'),
        sourceName: `Lever · ${source.name}`, workArrangement: arrangement(row.workplaceType) !== 'UNKNOWN' ? arrangement(row.workplaceType) : arrangement(`${row.categories?.location || ''} ${remoteTitle(row.text)}`), employmentType: row.categories?.commitment,
        salary: salary(row.salaryRange?.min, row.salaryRange?.max, row.salaryRange?.currency, row.salaryRange?.interval), publishedAt: row.createdAt };
      break;
    case 'ashby': {
      if (row.isListed === false) return null;
      const locations = [{ location: row.location, country: row.address?.postalAddress?.addressCountry },
        ...array(row.secondaryLocations).map(loc => ({ location: loc.location, country: loc.address?.postalAddress?.addressCountry || loc.address?.addressCountry }))];
      const supported = locations.filter(loc => eligibleCountries(loc.location, loc.country).length);
      if (!supported.length) return null;
      data = { externalId: row.id || row.jobUrl, jobUrl: row.jobUrl, title: row.title, company: source.name,
        location: supported.map(loc => loc.location || COUNTRY_NAMES[poolCountry(loc.country)!]).join(' · '), eligibleCountries: [...new Set(supported.flatMap(loc => eligibleCountries(loc.location, loc.country)))],
        description: row.descriptionPlain || row.descriptionHtml, sourceName: `Ashby · ${source.name}`,
        workArrangement: arrangement(row.workplaceType || (row.isRemote ? 'remote' : '')), employmentType: row.employmentType,
        salary: row.compensation?.scrapeableCompensationSalarySummary, publishedAt: row.publishedAt };
      break;
    }
    case 'workable': {
      if (row.telecommuting !== true || ['HYBRID','ONSITE'].includes(arrangement(row.workplace_type || row.workplaceType)) || (row.state && /^(?:draft|closed|archived)$/i.test(row.state))) return null;
      const locations = array(row.locations).length ? array(row.locations) : [{ city: row.city, country: row.country }];
      const countries = [...new Set(locations.filter(loc => loc.hidden !== true).flatMap(loc => eligibleCountries(loc.city, loc.countryCode || loc.country_code || loc.country)))];
      data = { externalId: row.shortcode, jobUrl: row.url || row.shortlink, title: row.title, company: source.name,
        location: locations.filter(loc => loc.hidden !== true).map(loc => [loc.city, loc.country || loc.country_name || loc.countryCode].filter(Boolean).join(', ')).join(' · '), eligibleCountries: countries,
        description: row.description, sourceName: `Workable · ${source.name}`, workArrangement: 'REMOTE', employmentType: row.employment_type, publishedAt: row.published_on };
      break;
    }
    case 'recruitee': {
      if (row.remote !== true || row.hybrid === true || row.on_site === true || (row.status && row.status !== 'published')) return null;
      const locations = array(row.locations).length ? array(row.locations) : [{ city: row.city || row.location, country_code: row.country_code, country: row.country }];
      data = { externalId: row.id || row.guid, jobUrl: row.careers_url, title: row.title, company: row.company_name || source.name,
        location: row.location || locations.map(loc => [loc.city, loc.country].filter(Boolean).join(', ')).join(' · '), eligibleCountries: [...new Set(locations.flatMap(loc => eligibleCountries(loc.city, loc.country_code || loc.country)))],
        description: [row.description, row.requirements].filter(Boolean).join('\n\n'), sourceName: `Recruitee · ${source.name}`, workArrangement: 'REMOTE', employmentType: row.employment_type_code,
        publishedAt: row.published_at, expiresAt: row.close_at, salary: salary(row.salary?.min, row.salary?.max, row.salary?.currency, row.salary?.period) };
      break;
    }
    case 'pinpoint': {
      if (row.workplace_type !== 'remote' || row.hidden === true || row.active === false || row.status && row.status !== 'published') return null;
      const location = [row.location?.name, row.location?.city, row.location?.province].filter(value => typeof value === 'string' && value.trim()).join(', ');
      data = { externalId: row.id, jobUrl: row.url, title: row.title, company: source.name,
        location, country: row.location?.country_code || row.location?.country,
        description: [row.description, row.key_responsibilities, row.skills_knowledge_expertise, row.benefits].filter(Boolean).join('\n\n'),
        sourceName: `Pinpoint · ${source.name}`, workArrangement: 'REMOTE', employmentType: row.employment_type_text || row.employment_type,
        salary: row.compensation_visible === true ? row.compensation : null, publishedAt: row.published_at, expiresAt: row.deadline_at };
      break;
    }
    case 'personio': {
      const locations = [...(Array.isArray(row.office) ? row.office : [row.office]),
        ...(Array.isArray(row.additionalOffices?.office) ? row.additionalOffices.office : row.additionalOffices?.office ? [row.additionalOffices.office] : [])].filter(value => typeof value === 'string');
      if (!/^\d{1,20}$/.test(String(row.id))) return null;
      data = { externalId: row.id, jobUrl: `https://${source.boardToken}.jobs.personio.de/job/${row.id}?language=en`, title: row.name, company: row.subcompany || source.name,
        location: locations.join(' · '), description: array(row.jobDescriptions?.jobDescription).map(section => `${section.name || ''}\n${section.value || ''}`).join('\n\n'),
        sourceName: `Personio · ${source.name}`, workArrangement: arrangement(`${locations.join(' ')} ${remoteTitle(row.name)}`),
        employmentType: [row.employmentType, row.schedule].filter(Boolean).join(' · '), publishedAt: row.createdAt };
      break;
    }
    case 'teamtailor': {
      const job = row._jobposting;
      if (!job || job.jobLocationType !== 'TELECOMMUTE') return null;
      const place = schemaJobLocations(job);
      data = { externalId: row.id, jobUrl: row.url, title: row.title || job.title, company: job.hiringOrganization?.name || source.name,
        location: place.location, eligibleCountries: place.countries, description: row.content_html || job.description,
        sourceName: `Teamtailor · ${source.name}`, workArrangement: 'REMOTE', employmentType: Array.isArray(job.employmentType) ? job.employmentType.join(', ') : job.employmentType,
        publishedAt: row.date_published || job.datePosted, expiresAt: job.validThrough };
      break;
    }
    case 'bamboohr': {
      // BambooHR documents 0=on-site, 1=remote, 2=hybrid. Do not infer it
      // from isRemote, which is often null on the public list response.
      if (String(row.locationType) !== '1' || row.jobOpeningStatus && row.jobOpeningStatus !== 'Open') return null;
      const country = row.atsLocation?.country || row.location?.addressCountry;
      const place = { ...row.location, ...row.atsLocation };
      const location = [place.city, place.state || place.province, country].filter(Boolean).join(', ');
      data = { externalId: row.id, jobUrl: `https://${source.boardToken}.bamboohr.com/careers/${row.id}`, title: row.jobOpeningName, company: source.name,
        location, country, description: row.description, sourceName: `BambooHR · ${source.name}`,
        workArrangement: 'REMOTE', salary: row.compensation, employmentType: row.employmentStatusLabel || row.employmentType, publishedAt: row.datePosted };
      break;
    }
    case 'paylocity': {
      if (row.IsInternal === true || row.IsRemote !== true || !/\b(?:fully remote|100% remote)\b/i.test(row.detail?.remoteLabel || '') || ['HYBRID','ONSITE'].includes(arrangement(row.detail.remoteLabel))) return null;
      const place = row.JobLocation || {};
      data = { externalId: row.JobId, jobUrl: `https://recruiting.paylocity.com/recruiting/jobs/Details/${row.JobId}`, title: row.detail.title || row.JobTitle,
        company: row.detail.company || source.name, location: [place.City, place.State, place.Country].filter(Boolean).join(', '), country: place.Country,
        description: row.detail.description, sourceName: `Paylocity · ${source.name}`, workArrangement: 'REMOTE', publishedAt: row.PublishedDate };
      break;
    }
    case 'breezy': {
      const locations = array(row.locations).length ? array(row.locations) : [row.location || {}];
      const remote = locations.filter(loc => loc.is_remote === true && !/hybrid|on[-_ ]?site/i.test(String(loc.remote_details?.value || '')));
      if (!remote.length) return null;
      data = { externalId: row.id, jobUrl: row.url, title: row.name, company: row.company?.name || source.name,
        location: remote.map(loc => [loc.city || loc.name, loc.country?.name].filter(Boolean).join(', ')).join(' · '),
        eligibleCountries: [...new Set(remote.flatMap(loc => eligibleCountries(loc.name || loc.city, loc.country?.id || loc.country?.name)))],
        description: row.description, sourceName: `Breezy HR · ${source.name}`, workArrangement: 'REMOTE', employmentType: row.type?.name, salary: row.salary, publishedAt: row.published_date };
      break;
    }
    case 'smartrecruiters': {
      if (!smartRemote(row) || row.active === false || (row.visibility && row.visibility !== 'PUBLIC')) return null;
      const sections = row.jobAd?.sections || {};
      data = { externalId: row.id, jobUrl: row.postingUrl || row.applyUrl, title: row.name, company: row.company?.name || source.name,
        location: row.location?.fullLocation || [row.location?.city, row.location?.region, COUNTRY_NAMES[poolCountry(row.location?.country)!]].filter(Boolean).join(', '), country: row.location?.country,
        description: Object.values(sections).map((section: any) => typeof section?.text === 'string' ? `${section.title || ''}\n${section.text}` : '').filter(Boolean).join('\n\n'),
        sourceName: `SmartRecruiters · ${row.company?.name || source.name}`, workArrangement: 'REMOTE', employmentType: row.typeOfEmployment?.label,
        publishedAt: row.releasedDate, salary: row.compensation?.salary?.min ? salary(row.compensation.salary.min, row.compensation.salary.max, row.compensation.salary.currency, row.compensation.salary.period) : null };
      break;
    }
    case 'usajobs': {
      const job = row.MatchedObjectDescriptor;
      if (!job) return null;
      const details = job.UserArea?.Details || {};
      const locations = array(job.PositionLocation).filter(loc => isUsLocation(loc.LocationName, loc.CountryCode));
      if (!locations.length) return null;
      data = { externalId: row.MatchedObjectId, jobUrl: job.PositionURI, title: job.PositionTitle, company: job.OrganizationName,
        location: locations.map(loc => loc.LocationName).join(' · '), country: 'US', sourceName: 'USAJOBS',
        description: [job.QualificationSummary, details.JobSummary, details.MajorDuties, details.Requirements, details.Education, details.HowToApply].flat().filter(Boolean).join('\n\n'),
        workArrangement: String(details.RemoteIndicator).toLowerCase() === 'true' ? 'REMOTE' : 'UNKNOWN',
        employmentType: array(job.PositionSchedule).map(item => item.Name).join(', '),
        salary: job.PositionRemuneration?.[0] ? salary(job.PositionRemuneration[0].MinimumRange, job.PositionRemuneration[0].MaximumRange, 'USD', job.PositionRemuneration[0].Description || 'year') : null,
        publishedAt: job.PublicationStartDate, expiresAt: job.ApplicationCloseDate };
      break;
    }
    default: return null;
  }
  const jobUrl = publicJobUrl(data.jobUrl);
  const title = plainText(data.title, 250), company = plainText(data.company, 250), description = plainText(data.description);
  const claimed: PoolCountry[] = data.eligibleCountries || eligibleCountries(data.location, data.country);
  const countries = POOL_COUNTRIES.filter(code => claimed.includes(code) && eligibleCountries(data.location, code, description).includes(code));
  if (!jobUrl || !title || !company || !description || !isSoftwareJob(title, description) || !countries.length || data.workArrangement !== 'REMOTE') return null;
  return { externalId: String(data.externalId || jobUrl).slice(0, 300), jobUrl, title, company, description,
    location: plainText(data.location, 1000), eligibleCountries: countries, sourceName: data.sourceName, workArrangement: data.workArrangement || 'UNKNOWN',
    salary: plainText(data.salary, 300) || null, employmentType: plainText(data.employmentType, 150) || null,
    publishedAt: jobDate(data.publishedAt), expiresAt: jobDate(data.expiresAt) };
}

function smartRemote(row: Row): boolean {
  return row.location?.remote === true && row.location?.hybrid !== true && !/^(?:HYBRID|ONSITE)$/i.test(String(row.locationType || '')) && eligibleCountries(row.location?.city, row.location?.country).length > 0;
}

export class FeedError extends Error {
  constructor(message: string, public retryAfterMs = MIN_SYNC_MS, public status?: number) { super(message); this.name = 'FeedError'; }
}
const boardRequestGates = new Map<string, Promise<void>>();
const boardBlockedUntil = new Map<string, number>();
let smartRequestGate: Promise<void> = Promise.resolve();
let freehireRequestGate: Promise<void> = Promise.resolve();
let oceanRequestGate: Promise<void> = Promise.resolve();
let oceanBlockedUntil = 0;
let remotejobsRequestGate: Promise<void> = Promise.resolve();
let remotejobsBlockedUntil = 0;
export async function readFeed(url: URL, headers: Record<string, string> = {}): Promise<unknown> {
  const boardHost = /\.(?:recruitee\.com|breezy\.hr|pinpointhq\.com|teamtailor\.com|bamboohr\.com|personio\.(?:de|com))$/.test(url.hostname) ? url.hostname.split('.').slice(-2).join('.') : url.hostname;
  const throttledBoard = ['boards-api.greenhouse.io', 'api.lever.co', 'api.ashbyhq.com', 'apply.workable.com', 'recruitee.com', 'breezy.hr', 'pinpointhq.com', 'teamtailor.com', 'bamboohr.com', 'personio.de', 'personio.com', 'recruiting.paylocity.com'].includes(boardHost);
  if (throttledBoard) {
    const gate = (boardRequestGates.get(boardHost) || Promise.resolve()).then(() => new Promise<void>(resolve => setTimeout(resolve, boardHost === 'apply.workable.com' ? 1000 : 250)));
    boardRequestGates.set(boardHost, gate); await gate;
  }
  if ((boardBlockedUntil.get(boardHost) || 0) > Date.now()) throw new FeedError('Employer provider is cooling down after a rate limit. Imported jobs were kept.', boardBlockedUntil.get(boardHost)! - Date.now(), 429);
  if (url.hostname === 'remotejobs.org') {
    // The free public API allows fewer than 200 requests/hour/IP. Cache in DB
    // and space all category requests in this API process at least 19s apart.
    remotejobsRequestGate = remotejobsRequestGate.then(() => new Promise<void>(resolve => setTimeout(resolve, 19_000)));
    await remotejobsRequestGate;
    if (remotejobsBlockedUntil > Date.now()) throw new FeedError('RemoteJobs.org is cooling down after a rate limit.', remotejobsBlockedUntil - Date.now(), 429);
  }
  if (url.hostname === 'oceanofjobs.com') {
    // The public API allows 20 requests/second shared by all users. Stay at 5.
    oceanRequestGate = oceanRequestGate.then(() => new Promise<void>(resolve => setTimeout(resolve, 200)));
    await oceanRequestGate;
    if (oceanBlockedUntil > Date.now()) throw new FeedError('Ocean of Jobs is cooling down after a rate limit.', oceanBlockedUntil - Date.now(), 429);
  }
  if (url.hostname === 'freehire.me') {
    freehireRequestGate = freehireRequestGate.then(() => new Promise<void>(resolve => setTimeout(resolve, 1000)));
    await freehireRequestGate;
  }
  if (url.hostname === 'api.smartrecruiters.com') {
    // At most four new requests/second per process, below the documented limit.
    smartRequestGate = smartRequestGate.then(() => new Promise<void>(resolve => setTimeout(resolve, 250)));
    await smartRequestGate;
  }
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AnchorProposal/1.0 (free job feed reader)', ...headers },
      signal: AbortSignal.timeout(['freehire.me', 'oceanofjobs.com'].includes(url.hostname) ? 60_000 : 25_000),
      redirect: url.hostname === 'recruiting.paylocity.com' && /^\/recruiting\/jobs\/details\/\d+$/i.test(url.pathname) ? 'manual' : 'error' });
  } catch (error) { throw new FeedError((error as Error)?.name === 'TimeoutError' ? 'Source request timed out. Imported jobs were kept.' : 'Source request failed. Imported jobs were kept.'); }
  if (!response.ok) {
    if (url.hostname === 'recruiting.paylocity.com' && response.status === 302 && /^\/recruiting\/jobs\/jobnotfound\/?$/i.test(response.headers.get('location') || '')) {
      await response.body?.cancel(); throw new FeedError('Source returned HTTP 404 (posting closed).', MIN_SYNC_MS, 404);
    }
    const retry = response.headers.get('retry-after');
    const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? (Date.parse(retry) - Date.now()) : MIN_SYNC_MS;
    const delay = Number.isFinite(retryMs) ? Math.max(MIN_SYNC_MS, Math.min(7 * 86400_000, retryMs)) : MIN_SYNC_MS;
    if (response.status === 429 && (throttledBoard || url.hostname === 'api.smartrecruiters.com')) boardBlockedUntil.set(boardHost, Date.now() + delay);
    if (url.hostname === 'oceanofjobs.com' && response.status === 429) oceanBlockedUntil = Date.now() + delay;
    if (url.hostname === 'remotejobs.org' && response.status === 429) remotejobsBlockedUntil = Date.now() + delay;
    throw new FeedError(`Source returned HTTP ${response.status}${response.status === 429 ? ' (rate limit; will retry later)' : ''}.`, delay, response.status);
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new FeedError('Source response is too large.');
  if (!response.body) throw new FeedError('Source returned an empty response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new FeedError('Source response is too large.'); } chunks.push(item.value); }
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError(['TimeoutError', 'AbortError'].includes((error as Error)?.name) ? 'Source response timed out while downloading jobs. Imported jobs were kept.' : 'Source response was interrupted. Imported jobs were kept.');
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8');
  try { const career = parseCareerResponse(url, text); if (career !== undefined) return career; }
  catch (error) { const message = (error as Error).message; throw new FeedError(message.startsWith('Source ') ? message : 'Source returned invalid public careers data.'); }
  if (/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\.breezy\.hr$/.test(url.hostname) && url.pathname.startsWith('/p/')) {
    // Read public JobPosting metadata without executing the employer page.
    for (const match of text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const json = JSON.parse(match[1]);
        const nodes = Array.isArray(json) ? json : [json, ...(Array.isArray(json['@graph']) ? json['@graph'] : [])];
        const job = nodes.find(node => node && (node['@type'] === 'JobPosting' || node['@type']?.includes?.('JobPosting')));
        if (job && typeof job.description === 'string') return { description: job.description };
      } catch {}
    }
    return { description: '' };
  }
  try { return JSON.parse(text); }
  catch { throw new FeedError('Source returned invalid JSON.'); }
}

export async function fetchJobPage(source: ImportSource, cursor: string | null = null, read = readFeed, skipKnown: (url: string) => boolean = () => false): Promise<ImportPage> {
  let url: URL; const headers: Record<string, string> = {};
  if (['workable', 'recruitee', 'breezy', 'pinpoint'].includes(source.provider) && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(source.boardToken)) throw new FeedError('Invalid employer board name.');
  if (PUBLIC_CAREER_PROVIDERS.includes(source.provider) && !validCareerBoard(source.provider, source.boardToken)) throw new FeedError('Invalid public employer board name.');
  switch (source.provider) {
    case 'remotejobs':
      try { url = remotejobsUrl(source.boardToken, cursor); } catch (error) { throw new FeedError((error as Error).message); }
      break;
    case 'ocean': {
      if (cursor && (!/^\d+$/.test(cursor) || Number(cursor) > 10_000 || Number(cursor) % 500 !== 0)) throw new FeedError('Invalid Ocean of Jobs cursor.');
      url = new URL('https://oceanofjobs.com/api/jobs');
      url.search = new URLSearchParams({ country: 'US,GB,IE', workplace: 'remote', confidence: 'verified',
        department: 'Software Engineering,Infrastructure,Data & AI,Security,QA', limit: '500', offset: cursor || '0' }).toString();
      break;
    }
    case 'freehire':
    case 'freehire-global': url = freehireUrl(cursor, source.boardToken, source.provider === 'freehire-global'); break;
    case 'jobicy':
      if (source.boardToken && !['usa', 'uk', 'ireland', 'anywhere'].includes(source.boardToken)) throw new FeedError('Choose a supported Jobicy country.');
      url = new URL('https://jobicy.com/api/v2/remote-jobs?count=200'); url.searchParams.set('geo', source.boardToken || 'usa');
      if (cursor) url.searchParams.set('cursor', cursor); break;
    case 'remoteok': url = new URL('https://remoteok.com/api'); break;
    case 'greenhouse': url = new URL(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.boardToken)}/jobs?content=true`); break;
    case 'lever': url = new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(source.boardToken)}?mode=json&limit=100&skip=${cursor || '0'}`); break;
    case 'ashby': url = new URL(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.boardToken)}?includeCompensation=true`); break;
    case 'workable': url = new URL(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(source.boardToken)}?details=true`); break;
    case 'recruitee': url = new URL(`https://${source.boardToken}.recruitee.com/api/offers`); break;
    case 'breezy': url = new URL(`https://${source.boardToken}.breezy.hr/json`); break;
    case 'pinpoint': url = new URL(`https://${source.boardToken}.pinpointhq.com/postings.json`); break;
    case 'personio': url = new URL(`https://${source.boardToken}.jobs.personio.de/xml?language=en`); headers.Accept = 'application/xml'; break;
    case 'teamtailor': {
      url = new URL(cursor || `https://${source.boardToken}/jobs.json`);
      if (url.origin !== `https://${source.boardToken.toLowerCase()}` || url.pathname !== '/jobs.json' || url.hash || url.username || url.password) throw new FeedError('Invalid Teamtailor cursor.');
      break;
    }
    case 'bamboohr': url = new URL(`https://${source.boardToken}.bamboohr.com/careers/list`); break;
    case 'paylocity': url = new URL(`https://recruiting.paylocity.com/recruiting/jobs/All/${source.boardToken}`); headers.Accept = 'text/html'; break;
    case 'smartrecruiters': url = new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.boardToken)}/postings?limit=20&offset=${cursor || '0'}&locationType=REMOTE&destination=PUBLIC`); break;
    case 'usajobs':
      if (!process.env.USAJOBS_API_KEY || !process.env.USAJOBS_EMAIL) throw new FeedError('Add the free USAJOBS_API_KEY and USAJOBS_EMAIL to the API environment to enable this source.');
      url = new URL(`https://data.usajobs.gov/api/Search?ResultsPerPage=500&Page=${cursor || '1'}&LocationName=United%20States&WhoMayApply=public&Fields=full&RemoteIndicator=true`);
      headers['Authorization-Key'] = process.env.USAJOBS_API_KEY; headers['User-Agent'] = process.env.USAJOBS_EMAIL; break;
    default: throw new FeedError('Unsupported free source.');
  }
  const payload = await read(url, headers) as Row;
  let rows: Row[], next: string | null = null, incomplete = false;
  if (source.provider === 'remotejobs') {
    const page = payload?.pagination, offset = Number(cursor || 0);
    if (!Array.isArray(payload?.data) || !page || page.limit !== 50 || page.offset !== offset || !Number.isSafeInteger(page.total) || page.total < 0 || typeof page.has_more !== 'boolean') throw new FeedError('RemoteJobs.org returned invalid pagination.');
    rows = array(payload.data);
    if (rows.length !== payload.data.length || rows.length > 50 || (page.has_more && rows.length !== 50) || (!rows.length && page.total > offset)) throw new FeedError('RemoteJobs.org returned an incomplete jobs page.');
    if (page.has_more) {
      if (offset >= 9950) throw new FeedError('RemoteJobs.org search reached its pagination limit. Imported jobs were kept.');
      next = String(offset + 50);
    }
  } else if (source.provider === 'ocean') {
    const offset = Number(cursor || 0);
    if (!Array.isArray(payload?.jobs) || payload.offset !== offset || payload.limit !== 500 ||
      (payload.total !== null && (!Number.isSafeInteger(payload.total) || payload.total < 0))) throw new FeedError('Ocean of Jobs returned invalid pagination.');
    const listings = array(payload.jobs);
    if (!listings.length && payload.total > offset) throw new FeedError('Ocean of Jobs returned an incomplete search. Imported jobs were kept.');
    if (listings.length === 500 && (payload.total === null || payload.total > offset + listings.length)) {
      if (offset >= 10_000) throw new FeedError('Ocean of Jobs search reached its public pagination limit. Imported jobs were kept.');
      next = String(offset + listings.length);
    } else if (listings.length < 500 && payload.total > offset + listings.length) throw new FeedError('Ocean of Jobs returned an incomplete search. Imported jobs were kept.');
    const eligible = listings.filter(row => publicJobUrl(row.url) && mayBeSoftwareJob(plainText(row.title, 250)) && row.workplace_type === 'remote' &&
      row.confidence === 'verified' && !row.closed_at && eligibleCountries(row.location).length > 0 && !['HYBRID', 'ONSITE'].includes(arrangement(row.location)) && !skipKnown(row.url));
    const details: Row[] = []; let index = 0, failure: unknown;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (index < eligible.length && !failure) {
        const listing = eligible[index++];
        try {
          if (!/^[a-f\d]{8,64}$/i.test(String(listing.id))) throw new FeedError('Ocean of Jobs returned an invalid posting ID.');
          const detail = await read(new URL(`https://oceanofjobs.com/api/jobs/${encodeURIComponent(listing.id)}`)) as Row;
          if (!detail || detail.id !== listing.id) throw new FeedError('Ocean of Jobs returned an invalid posting.');
          if (!plainText(detail.description)) { incomplete = true; continue; }
          details.push(detail);
        } catch (error) { if (!(error instanceof FeedError && error.status === 404)) failure = error; }
      }
    }));
    if (failure) throw failure;
    rows = details;
  } else if (['freehire', 'freehire-global'].includes(source.provider)) {
    if (!Array.isArray(payload?.data) || !payload.meta) throw new FeedError('Freehire response does not contain a jobs list.');
    const { index } = freehireCursor(cursor, source.boardToken);
    rows = array(payload.data).filter(row => row.source === FREEHIRE_SOURCES[index]);
    if (rows.length !== payload.data.length) throw new FeedError('Freehire did not honor the employer source filter.');
    try { next = freehireNext(cursor, rows.length, payload.meta, source.boardToken); }
    catch (error) { throw new FeedError((error as Error).message); }
  } else if (source.provider === 'teamtailor') {
    if (!Array.isArray(payload?.items) || !/^https:\/\/jsonfeed.org\/version\//.test(String(payload.version))) throw new FeedError('Source response does not contain a jobs feed.');
    rows = array(payload.items);
    incomplete = rows.some(row => row._jobposting?.jobLocationType === 'TELECOMMUTE' && mayBeSoftwareJob(plainText(row.title || row._jobposting.title, 250)) && !plainText(row.content_html || row._jobposting.description));
    if (payload.next_url !== undefined) {
      if (typeof payload.next_url !== 'string' || !payload.next_url) throw new FeedError('Invalid Teamtailor pagination.');
      const target = new URL(payload.next_url);
      if (target.origin !== url.origin || target.pathname !== '/jobs.json' || target.hash || target.username || target.password || target.href === url.href) throw new FeedError('Invalid Teamtailor pagination.');
      next = target.href;
    }
  } else if (source.provider === 'bamboohr' || source.provider === 'paylocity') {
    const listings = source.provider === 'bamboohr' ? payload?.result : payload?.Jobs;
    if (!Array.isArray(listings)) throw new FeedError('Source response does not contain a jobs list.');
    if (source.provider === 'bamboohr' && (!Number.isSafeInteger(payload.meta?.totalCount) || payload.meta.totalCount !== listings.length)) throw new FeedError('BambooHR returned an incomplete jobs list.');
    rows = []; let index = 0, failure: unknown;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (index < listings.length && !failure) {
        const listing = listings[index++];
        const bamboo = source.provider === 'bamboohr';
        if (!listing || !mayBeSoftwareJob(plainText(bamboo ? listing.jobOpeningName : listing.JobTitle, 250)) ||
          (!bamboo && (listing.IsRemote !== true || listing.IsInternal === true)) || (bamboo && String(listing.locationType) !== '1')) continue;
        const id = String(bamboo ? listing.id : listing.JobId);
        try {
          if (!/^\d{1,20}$/.test(id)) throw new FeedError('Source returned an invalid posting ID.');
          const detailUrl = bamboo ? new URL(`https://${source.boardToken}.bamboohr.com/careers/${id}/detail`) : new URL(`https://recruiting.paylocity.com/recruiting/jobs/Details/${id}`);
          const result = await read(detailUrl, bamboo ? {} : { Accept: 'text/html' }) as Row;
          const detail = bamboo ? result?.result?.jobOpening : result;
          const account = !bamboo ? String(listing.JobLocation?.ModuleId || payload.ModuleId || '') : '';
          const sameAccount = /^\d{1,20}$/.test(account) && detail?.moduleId === account;
          if (!detail || (!bamboo && detail.boardToken?.toLowerCase() !== source.boardToken.toLowerCase() && !sameAccount)) throw new FeedError('Source returned a posting for a different employer.');
          if (!plainText(detail.description)) { incomplete = true; continue; }
          rows.push(bamboo ? { ...detail, id } : { ...listing, detail });
        } catch (error) { if (!(error instanceof FeedError && error.status === 404)) failure = error; }
      }
    }));
    if (failure) throw failure;
  } else if (source.provider === 'personio') {
    if (!Array.isArray(payload?.jobs)) throw new FeedError('Source response does not contain a jobs list.');
    rows = array(payload.jobs);
    incomplete = rows.some(row => mayBeSoftwareJob(plainText(row.name, 250)) && !plainText(array(row.jobDescriptions?.jobDescription).map(section => section.value || '').join('\n')));
  } else if (source.provider === 'pinpoint') {
    if (!Array.isArray(payload?.data) || payload.data.some((row: unknown) => !row || typeof row !== 'object')) throw new FeedError('Source response does not contain a jobs list.');
    rows = array(payload.data);
    incomplete = rows.some(row => row.workplace_type === 'remote' && mayBeSoftwareJob(plainText(row.title, 250)) &&
      !plainText([row.description, row.key_responsibilities, row.skills_knowledge_expertise, row.benefits].filter(Boolean).join('\n')));
  } else if (source.provider === 'recruitee') {
    if (!Array.isArray(payload?.offers)) throw new FeedError('Source response does not contain a jobs list.');
    rows = array(payload.offers);
  } else if (source.provider === 'breezy') {
    if (!Array.isArray(payload)) throw new FeedError('Source response does not contain a jobs list.');
    rows = []; const listings = array(payload); let index = 0, failure: unknown;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (index < listings.length && !failure) {
        const row = listings[index++];
        const locations = array(row.locations).length ? array(row.locations) : [row.location || {}];
        if (!mayBeSoftwareJob(plainText(row.name, 250)) || !locations.some(loc => loc.is_remote === true && !/hybrid|on[-_ ]?site/i.test(String(loc.remote_details?.value || '')) && eligibleCountries(loc.name || loc.city, loc.country?.id || loc.country?.name).length)) continue;
        try {
          const link = publicJobUrl(row.url);
          if (!link || new URL(link).hostname !== `${source.boardToken}.breezy.hr` || !/^\/p\/[a-zA-Z0-9_-]+\/?$/.test(new URL(link).pathname)) throw new FeedError('Invalid Breezy posting link.');
          const detail = await read(new URL(link), { Accept: 'text/html' }) as Row;
          if (!plainText(detail?.description)) { incomplete = true; continue; }
          rows.push({ ...row, description: detail.description });
        } catch (error) { if (!(error instanceof FeedError && error.status === 404)) failure = error; }
      }
    }));
    if (failure) throw failure;
  } else if (source.provider === 'remoteok' || source.provider === 'lever') {
    if (!Array.isArray(payload)) throw new FeedError('Source response does not contain a jobs list.');
    rows = array(payload);
    if (source.provider === 'lever' && rows.length === 100) next = String(Number(cursor || 0) + 100);
  } else if (source.provider === 'smartrecruiters') {
    if (!Array.isArray(payload?.content) || !Number.isFinite(Number(payload.totalFound))) throw new FeedError('Source response does not contain a jobs list.');
    const listings = array(payload.content), details: Row[] = []; let index = 0;
    if (!listings.length && Number(payload.totalFound) > Number(cursor || '0')) throw new FeedError('Source returned an incomplete jobs page.');
    // List responses omit descriptions. Fetch only public US remote details,
    // using fixed API hosts and encoded IDs instead of following untrusted refs.
    const eligible = listings.filter(row => {
      const title = plainText(row.name, 250);
      return smartRemote(row) && (!row.visibility || row.visibility === 'PUBLIC') && (!title || mayBeSoftwareJob(title));
    });
    let failure: unknown;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (index < eligible.length && !failure) {
        const row = eligible[index++];
        try {
          if (!/^[a-zA-Z0-9-]{1,120}$/.test(String(row.id))) throw new FeedError('Source returned an invalid posting ID.');
          const detail = await read(new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.boardToken)}/postings/${encodeURIComponent(row.id)}`)) as Row;
          if (!detail || typeof detail !== 'object' || !detail.jobAd?.sections) throw new FeedError('Source returned an incomplete posting.');
          details.push(detail);
        } catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
    rows = details;
    if (Number(payload.totalFound) > Number(cursor || '0') + listings.length && listings.length) next = String(Number(cursor || '0') + listings.length);
  } else if (source.provider === 'usajobs') {
    if (!Array.isArray(payload?.SearchResult?.SearchResultItems)) throw new FeedError('USAJOBS response does not contain search results.');
    rows = array(payload.SearchResult.SearchResultItems);
    if (Number(payload.SearchResult.SearchResultCountAll) > Number(cursor || 1) * 500) next = String(Number(cursor || 1) + 1);
  } else {
    if (!Array.isArray(payload?.jobs)) throw new FeedError('Source response does not contain a jobs list.');
    rows = array(payload.jobs);
    if (source.provider === 'jobicy' && typeof payload.nextCursor === 'string' && payload.nextCursor) next = payload.nextCursor;
  }
  return { jobs: rows.map(row => convert(source, row)).filter((job): job is ImportedJob => !!job), next, complete: !next && !incomplete, ...(incomplete ? { incomplete: true } : {}) };
}
