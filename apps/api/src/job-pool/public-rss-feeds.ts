import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { load } from 'cheerio';
import { FREEHIRE_SOURCES } from './freehire-feed';
import { ADDITIONAL_FREE_FEEDS } from './additional-free-feeds';

// Category and skill URLs advertised by the provider; each verified as live RSS.
export const REMOTE_FIRST_CATEGORIES = ['software-development', 'devops', 'data', 'cybersecurity', 'qa', 'ai',
'python', 'javascript', 'typescript', 'react', 'java', 'sql', 'nodejs', 'aws', 'azure', 'kubernetes', 'docker', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'android', 'ios', 'golang', 'data-science', 'machine-learning', 'cloud-security', 'systems-administration', 'security-engineer', 'unreal-engine', 'dotnet', 'tech', 'web3', 'data-processing', 'business-intelligence-analyst',
] as const;
export const ADDITIONAL_EMPLOYER_FEEDS = FREEHIRE_SOURCES;
export const USEFUL_FREE_FEEDS = [
  ...ADDITIONAL_FREE_FEEDS,
  { id: 'source-wwr-public-rss', provider: 'wwr', name: 'We Work Remotely', boardToken: '' },
  ...REMOTE_FIRST_CATEGORIES.map(category => ({ id: `source-remotefirst-${category}`, provider: 'remotefirst', name: `Remote First Jobs · ${category}`, boardToken: category })),
  ...ADDITIONAL_EMPLOYER_FEEDS.flatMap(boardToken => ['freehire', 'freehire-global'].map(provider => ({
    id: `source-${provider}-${boardToken}`, provider, name: `${boardToken} via Freehire${provider === 'freehire-global' ? ' · worldwide' : ''}`, boardToken,
  }))),
];

export function publicRssUrl(provider: string, category: string, cursor: string | null): URL {
  if (cursor !== null) throw Error('This public RSS feed has no pagination.');
  if (provider === 'wwr' && !category) return new URL('https://weworkremotely.com/remote-jobs.rss');
  if (provider === 'remotefirst' && REMOTE_FIRST_CATEGORIES.includes(category as typeof REMOTE_FIRST_CATEGORIES[number])) return new URL(`https://remotefirstjobs.com/rss/jobs/${category}.rss`);
  throw Error('Choose a supported public job feed.');
}

export function isRemoteFirstJobUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === 'remotefirstjobs.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/companies\/[a-z0-9-]+\/jobs\/[a-z0-9-]+-\d+\/?$/.test(url.pathname);
}

// Read public feeds and structured metadata without executing page scripts or
// resolving XML entities, linked resources or arbitrary remote addresses.
export function parsePublicRssResponse(url: URL, text: string): unknown | undefined {
  const isFeed = url.hostname === 'weworkremotely.com' && url.pathname === '/remote-jobs.rss' ||
    url.hostname === 'remotefirstjobs.com' && /^\/rss\/jobs\/[a-z0-9-]+\.rss$/.test(url.pathname);
  if (isFeed) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw Error('Source returned invalid public RSS.');
    const parsed = new XMLParser({ processEntities: false, parseTagValue: false, isArray: name => name === 'item' }).parse(text);
    const channel = parsed?.rss?.channel;
    if (!channel || typeof channel !== 'object' || !channel.title || channel.item !== undefined && !Array.isArray(channel.item)) throw Error('Source response does not contain an RSS jobs feed.');
    const jobs = channel.item || [];
    if (jobs.length > 1000 || jobs.some((job: unknown) => !job || typeof job !== 'object')) throw Error('Source returned an invalid RSS jobs list.');
    return { jobs };
  }
  if (!isRemoteFirstJobUrl(url)) return undefined;
  const $ = load(text);
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(script).text());
      const nodes = Array.isArray(data) ? data : [data, ...(Array.isArray(data?.['@graph']) ? data['@graph'] : [])];
      const job = nodes.find(row => row && (row['@type'] === 'JobPosting' || Array.isArray(row['@type']) && row['@type'].includes('JobPosting')));
      if (job) { const { description, ...metadata } = job; return { posting: metadata }; }
    } catch { /* Try the next structured metadata block. */ }
  }
  throw Error('Source posting has no public job metadata.');
}
