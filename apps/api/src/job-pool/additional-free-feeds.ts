import { eligibleCountries, POOL_COUNTRIES, COUNTRY_NAMES } from './job-geography';
import { schemaJobLocations } from './public-career-feeds';
import { isFreshPoolPosting } from './job-freshness';
import { mayBeSoftwareOccupation } from './software-jobs';

type Row = Record<string, any>;
type Source = { provider: string; boardToken: string };
type Read = (url: URL, headers?: Record<string, string>) => Promise<unknown>;
export const ARBEITNOW_EDITIONS = ['uk', 'germany', 'france', 'switzerland', 'netherlands'] as const;
const arbeitnowHosts: Record<string, string> = { uk: 'www.arbeitnow.co.uk', germany: 'www.arbeitnow.com', france: 'www.arbeitnow.fr', switzerland: 'www.arbeitnow.ch', netherlands: 'www.arbeitnow.nl' };
export const REMOTE_NETWORK_BOARDS = ['frontend', 'backend', 'java'] as const;
export const ADDITIONAL_FREE_PROVIDERS = [
  { id: 'arbeitnow', name: 'Arbeitnow', board: true, choices: ARBEITNOW_EDITIONS, docs: 'https://www.arbeitnow.com/blog/job-board-api' },
  { id: 'onjob', name: 'OnJob.io', board: false, docs: 'https://onjob.io/for-job-boards/' },
  { id: 'nomado', name: 'Nomado24', board: false, docs: 'https://www.nomado24.com/en/developers' },
  { id: 'remote-network', name: 'Remote Frontend / Backend / Java Jobs', board: true, choices: REMOTE_NETWORK_BOARDS, docs: 'https://www.remotefrontendjobs.com/developers' },
  { id: 'aidev', name: 'AI Dev Jobs', board: false, docs: 'https://aidevboard.com/llms.txt' },
] as const;
export const ADDITIONAL_FREE_FEEDS = [
  ...ARBEITNOW_EDITIONS.map(boardToken => ({ id: `source-arbeitnow-${boardToken}`, provider: 'arbeitnow', name: `Arbeitnow · ${boardToken}`, boardToken })),
  { id: 'source-onjob-public', provider: 'onjob', name: 'OnJob.io', boardToken: '' },
  { id: 'source-nomado-public', provider: 'nomado', name: 'Nomado24', boardToken: '' },
  { id: 'source-aidev-public', provider: 'aidev', name: 'AI Dev Jobs', boardToken: '' },
  ...REMOTE_NETWORK_BOARDS.map(boardToken => ({ id: `source-remote-network-${boardToken}`, provider: 'remote-network', name: `Remote ${boardToken} Jobs`, boardToken })),
];
export const ADDITIONAL_FREE_IDS: readonly string[] = ADDITIONAL_FREE_PROVIDERS.map(provider => provider.id);
export const DAILY_FREE_IDS: readonly string[] = ['himalayas', 'onjob'];

function validRows(value: unknown, max: number): Row[] {
  if (!Array.isArray(value) || value.length > max || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error('Source returned an invalid bounded jobs page. Imported jobs were kept.');
  return value;
}
function pageNumber(cursor: string | null, first = 1, max = 1000): number {
  if (cursor !== null && !/^(?:0|[1-9]\d{0,3})$/.test(cursor)) throw Error('Invalid public feed cursor.');
  const page = cursor === null ? first : Number(cursor);
  if (page < first || page > max) throw Error('Invalid public feed cursor.');
  return page;
}
// These adapters accept genuine timestamps only. A date with unknown time zone,
// an ingestion timestamp or a source's "first seen" value cannot prove today.
function sourceDate(value: unknown): Date | null {
  if (typeof value === 'number') { const date = new Date(value < 1e10 ? value * 1000 : value); return Number.isFinite(date.getTime()) ? date : null; }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null;
}
function ownLink(value: unknown, host: string, prefix: string): string | null {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && url.hostname === host && !url.port && !url.username && !url.password && url.pathname.startsWith(prefix) ? url.href : null; } catch { return null; }
}
function notRemote(title: unknown): boolean { return /\bhybrid\b|\bon[- ]?site\b/i.test(String(title || '')); }
function mayContainNewer(value: unknown): boolean { const date = sourceDate(value); return !date || date.getTime() > Date.now() || isFreshPoolPosting(date); }
function nominalCountries(row: Row): string[] {
  const applicant = row.applicantLocations;
  return Array.isArray(applicant?.countries) ? POOL_COUNTRIES.filter(code => applicant.countries.includes(code)) : [];
}

export async function readAdditionalFreePage(source: Source, cursor: string | null, read: Read): Promise<{ rows: Row[]; next: string | null; incomplete: boolean }> {
  let rows: Row[] = [], next: string | null = null, incomplete = false;
  if (source.provider === 'arbeitnow') {
    const host = arbeitnowHosts[source.boardToken]; if (!host) throw Error('Choose a supported Arbeitnow edition.');
    const page = pageNumber(cursor), url = new URL(`https://${host}/api/job-board-api?page=${page}`), payload = await read(url) as Row;
    const listings = validRows(payload?.data, 300);
    if (payload.meta?.current_page !== page || typeof payload.links !== 'object') throw Error('Arbeitnow returned invalid pagination.');
    if (payload.links.next) {
      const nextUrl = new URL(String(payload.links.next));
      if (nextUrl.origin !== url.origin || nextUrl.pathname !== url.pathname || nextUrl.searchParams.get('page') !== String(page + 1)) throw Error('Arbeitnow returned an unsafe page cursor.');
      // API pages are newest first. Once the entire page predates today there is
      // nothing new to insert; these are incremental feeds, never full snapshots.
      if (!listings.length || listings.some(row => mayContainNewer(row.created_at))) next = String(page + 1);
    }
    rows = listings.filter(row => row.remote === true && !notRemote(row.title)).map(row => ({
      externalId: row.slug, jobUrl: ownLink(row.url, host, '/jobs/'), title: row.title, company: row.company_name,
      location: row.location, description: row.description, workArrangement: 'REMOTE', sourceName: 'Arbeitnow',
      publishedAt: sourceDate(row.created_at), employmentType: Array.isArray(row.job_types) ? row.job_types.join(', ') : null,
    }));
  } else if (source.provider === 'onjob') {
    if (source.boardToken) throw Error('OnJob.io has one public feed.');
    const page = pageNumber(cursor), url = new URL(page === 1 ? 'https://onjob.io/feeds/jobs.json' : `https://onjob.io/feeds/jobs/${page}.json`), payload = await read(url) as Row;
    const listings = validRows(payload?.jobs, 5000);
    if (payload.page !== page || !Number.isSafeInteger(payload.totalPages) || payload.totalPages < page || !Number.isSafeInteger(payload.totalCount) || payload.totalCount < 0 || payload.count !== listings.length || (!listings.length && payload.totalCount > 0)) throw Error('OnJob.io returned invalid pagination.');
    if (page < payload.totalPages) {
      if (payload.next !== `https://onjob.io/feeds/jobs/${page + 1}.json`) throw Error('OnJob.io returned an unsafe page cursor.');
      next = String(page + 1);
    } else if (payload.next) throw Error('OnJob.io returned inconsistent pagination.');
    rows = listings.filter(row => row.remote === true && (!row.jsonLd?.jobLocationType || row.jsonLd.jobLocationType === 'TELECOMMUTE') && !notRemote(row.title)).map(row => {
      const geography = schemaJobLocations(row.jsonLd || {});
      return { externalId: row.id, jobUrl: ownLink(row.url, 'onjob.io', '/job/'), title: row.title, company: row.company,
        location: geography.location || row.location, eligibleCountries: geography.countries.length ? geography.countries : eligibleCountries(row.location, row.countryCode || row.country),
        description: row.descriptionHtml || row.jsonLd?.description, workArrangement: 'REMOTE', sourceName: 'OnJob.io',
        publishedAt: sourceDate(row.datePosted), expiresAt: sourceDate(row.jsonLd?.validThrough), employmentType: row.employmentType, salary: row.salary };
    });
  } else if (source.provider === 'nomado') {
    if (source.boardToken || cursor !== null && (!/^[A-Za-z0-9_-]{1,6000}$/.test(cursor))) throw Error('Invalid Nomado24 cursor.');
    const url = new URL('https://api.nomado24.de/api/public/v2/jobs');
    url.search = new URLSearchParams(cursor ? { cursor, limit: '100' } : { work_arrangement: 'remote', applicant_region: 'US,GB,IE', limit: '100', sort: 'published_desc' }).toString();
    const payload = await read(url) as Row, page = payload?.pagination, listings = validRows(payload?.data, 100);
    if (payload.resultStatus !== 'ok' || !page || page.limit !== 100 || page.cursor !== cursor || typeof page.hasNext !== 'boolean' || page.hasNext && (typeof page.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,6000}$/.test(page.nextCursor) || page.nextCursor === cursor)) throw Error('Nomado24 returned invalid pagination.');
    // The date's provenance must identify an employer source, never a board's
    // update time. Do not indirectly consume restricted aggregator feeds.
    rows = listings.filter(row => row.status === 'active' && row.source?.kind === 'ats' && row.dataOrigin?.fields?.['/publishedAt']?.type === 'source_fact' && row.dataOrigin.fields['/publishedAt'].sourceId === row.source.id && row.workArrangement === 'remote' && !notRemote(row.title)).map(row => {
      const countries = nominalCountries(row), geography = row.applicantLocations?.worldwide === true && !row.applicantLocations?.countries?.length ? eligibleCountries('Worldwide') : countries;
      return { externalId: row.id, jobUrl: ownLink(row.canonicalUrl, 'www.nomado24.com', '/en/remote-jobs/job/'), title: row.title, company: row.company?.name,
        location: row.applicantLocations?.rawText || geography.map(code => COUNTRY_NAMES[code as keyof typeof COUNTRY_NAMES]).join(' · '), eligibleCountries: geography,
        description: row.description?.html || row.description?.text, workArrangement: 'REMOTE', sourceName: 'Nomado24',
        publishedAt: sourceDate(row.publishedAt), expiresAt: sourceDate(row.expiresAt), employmentType: Array.isArray(row.employmentType) ? row.employmentType.join(', ') : null };
    });
    if (page.hasNext && (!listings.length || listings.some(row => mayContainNewer(row.publishedAt)))) next = page.nextCursor;
  } else if (source.provider === 'aidev') {
    if (source.boardToken) throw Error('AI Dev Jobs has one public search.');
    const page = pageNumber(cursor), url = new URL('https://aidevboard.com/api/v1/jobs');
    url.search = new URLSearchParams({ workplace: 'remote', posted_within_days: '2', limit: '50', page: String(page) }).toString();
    const payload = await read(url) as Row;
    // The public API uses both [] and null for an exact, healthy zero-result
    // search. Never normalize null when a positive count or degraded flag exists.
    const empty = payload?.jobs === null && payload.total === 0 && payload.has_next === false && payload.total_is_exact === true && payload.degraded === false && payload.estimated === false;
    const listings = validRows(empty ? [] : payload?.jobs, 50);
    if (payload.degraded !== false || payload.estimated !== false || payload.total_is_exact !== true || payload.page !== page || payload.per_page !== 50 || !Number.isSafeInteger(payload.total) || payload.total < 0 || typeof payload.has_next !== 'boolean' || payload.has_next && listings.length !== 50 || !listings.length && payload.total > 0) throw Error('AI Dev Jobs returned incomplete or invalid pagination.');
    rows = listings.filter(row => row.status === 'active' && row.workplace === 'remote' && !notRemote(row.title)).map(row => ({
      externalId: row.id, jobUrl: ownLink(row.url, 'aidevboard.com', '/job/'), title: row.title, company: row.company_name,
      location: row.location, eligibleCountries: eligibleCountries(row.remote_scope === 'worldwide' ? 'Worldwide' : row.location),
      description: row.description, workArrangement: 'REMOTE', sourceName: 'AI Dev Jobs', publishedAt: sourceDate(row.published_at), expiresAt: sourceDate(row.expires_at), employmentType: row.job_type,
    }));
    if (payload.has_next) next = String(page + 1);
  } else if (source.provider === 'remote-network') {
    if (!REMOTE_NETWORK_BOARDS.includes(source.boardToken as typeof REMOTE_NETWORK_BOARDS[number])) throw Error('Choose a supported Remote Jobs network board.');
    const offset = pageNumber(cursor, 0, 200); if (offset % 50) throw Error('Invalid Remote Jobs network offset.');
    const url = new URL('https://www.remotefrontendjobs.com/api/jobs');
    url.search = new URLSearchParams({ board: source.boardToken, postedWithin: '3d', limit: '50', offset: String(offset) }).toString();
    const listings = validRows(await read(url), 50);
    for (const row of listings) {
      if (typeof row.id !== 'string' || !/^[a-z0-9]{10,60}$/.test(row.id)) throw Error('Source returned an invalid job identifier.');
      if (!isFreshPoolPosting(sourceDate(row.isoDate)) || !mayBeSoftwareOccupation(String(row.title || ''))) continue;
      const detail = await read(new URL(`https://www.remotefrontendjobs.com/api/jobs/${row.id}`)) as Row;
      if (detail?.id !== row.id) throw Error('Source returned a different job.');
      if (detail.workModel !== 'fully_remote' || notRemote(detail.title)) continue;
      const worldwide = Array.isArray(detail.geoRegions) && detail.geoRegions.includes('worldwide');
      rows.push({ externalId: detail.id, jobUrl: `https://www.remotefrontendjobs.com/${detail.id}`, title: detail.title, company: detail.author,
        location: detail.geoLabel || detail.location, eligibleCountries: eligibleCountries(worldwide ? 'Worldwide' : detail.location),
        description: detail.content, workArrangement: 'REMOTE', sourceName: 'Remote Frontend Jobs',
        publishedAt: sourceDate(detail.isoDate), salary: detail.salary });
    }
    if (listings.length === 50) { if (offset < 200) next = String(offset + 50); else incomplete = true; }
  } else throw Error('Unsupported public free feed.');
  return { rows, next, incomplete };
}
