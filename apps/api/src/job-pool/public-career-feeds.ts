import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { load } from 'cheerio';
import { eligibleCountries, PoolCountry } from './job-geography';

type Row = Record<string, any>;
export const PUBLIC_CAREER_PROVIDERS = ['personio', 'teamtailor', 'bamboohr', 'paylocity'];
export function validCareerBoard(provider: string, token: string): boolean {
  if (provider === 'teamtailor') return /^[a-z0-9][a-z0-9-]{0,70}(?:\.(?:na|au))?\.teamtailor\.com$/i.test(token);
  if (provider === 'paylocity') return /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(token);
  return /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(token);
}

// These parsers read public data only: no script evaluation, browser session,
// authentication, external XML entities or resources referenced by the HTML.
export function parseCareerResponse(url: URL, text: string): unknown | undefined {
  if (/^[a-z0-9][a-z0-9_-]{0,99}\.jobs\.personio\.(?:de|com)$/i.test(url.hostname) && url.pathname === '/xml') {
    if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw Error('Source returned invalid job-feed XML.');
    const data = new XMLParser({ processEntities: false, parseTagValue: false,
      isArray: name => ['position', 'jobDescription', 'office'].includes(name) }).parse(text);
    if (!Object.prototype.hasOwnProperty.call(data, 'workzag-jobs')) throw Error('Source response does not contain a jobs list.');
    return { jobs: data['workzag-jobs']?.position || [] };
  }
  if (url.hostname !== 'recruiting.paylocity.com') return undefined;
  if (/^\/recruiting\/jobs\/all\/[a-f\d-]{36}\/?$/i.test(url.pathname)) {
    for (const script of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      const assignment = /^\s*window\.pageData\s*=\s*([\s\S]*?)\s*$/.exec(script[1]);
      if (!assignment) continue;
      const data = JSON.parse(assignment[1].trim().replace(/;$/, ''));
      if (!Array.isArray(data.Jobs)) throw Error('Source response does not contain a jobs list.');
      return data;
    }
    throw Error('Source response does not contain public job data.');
  }
  if (/^\/recruiting\/jobs\/details\/\d+\/?$/i.test(url.pathname)) {
    const $ = load(text);
    const title = $('.job-preview-title').first().text().trim();
    const container = $('.job-preview-details').first().clone();
    container.find('script,style,.mobile-apply-btn,.job-listing-header,.apply-link-marker').remove();
    const breadcrumb = $('a.breadcrumb-link').first().attr('href');
    let boardToken = '', moduleId = '';
    try {
      const link = new URL(breadcrumb || '', url);
      if (link.origin === url.origin) boardToken = /^\/recruiting\/jobs\/all\/([a-f\d-]{36})(?:\/|$)/i.exec(link.pathname)?.[1] || '';
    } catch {}
    try {
      const logo = new URL($('#LayoutLogoImage').first().attr('src') || '', url);
      const account = logo.searchParams.get('moduleId');
      if (logo.origin === url.origin && account && /^\d{1,20}$/.test(account)) moduleId = account;
    } catch {}
    if (!title || !boardToken) throw Error('Source returned an incomplete public posting.');
    return { title, boardToken, moduleId, description: container.html() || '', company: $('#LayoutLogoName').first().text().trim(),
      remoteLabel: $('.preview-location').first().text().replace(/\s+/g, ' ').trim() };
  }
  return undefined;
}

function array(value: unknown): Row[] { return (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []).filter(row => row && typeof row === 'object'); }
export function schemaJobLocations(job: Row): { location: string; countries: PoolCountry[] } {
  const locations = array(job.jobLocation).map(place => place.address || {}).map(address => ({
    text: [address.addressLocality, address.addressRegion, typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry].filter(Boolean).join(', '),
    country: typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry,
  }));
  const requirements = array(job.applicantLocationRequirements);
  // Explicit applicant restrictions take priority over an office address.
  const countries = requirements.length ? requirements.flatMap(place => eligibleCountries(place.name, place['@type'] === 'Country' ? place.name : undefined)) :
    locations.flatMap(place => eligibleCountries(place.text, place.country));
  const names = requirements.length ? requirements.map(place => place.name).filter(Boolean) : locations.map(place => place.text);
  return { location: names.join(' · '), countries: [...new Set(countries)] };
}
