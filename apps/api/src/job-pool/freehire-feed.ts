// Public, keyless API: https://freehire.me/docs/api
// Restrict imports to employer recruiting systems, excluding aggregator feeds.
export const FREEHIRE_SOURCES = [
  'workday', 'workable', 'icims', 'oracle', 'breezy', 'bamboohr', 'rippling',
  'jazzhr', 'dayforce', 'pinpoint', 'gem', 'jobvite', 'adp', 'adpmyjobs',
  'ukg', 'ukgready', 'paycom', 'paycor', 'paylocity', 'successfactors',
  'taleo', 'hrmdirect', 'phenom', 'radancy', 'jibe', 'eightfold',
  'cornerstone', 'applicantpro', 'catsone', 'hiringthing', 'freshteam',
  'manatal', 'comeet', 'hibob', 'trakstar', 'recruitee', 'jobscore',
  'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'ashbygraphql',
  'gusto', 'deel', 'avature', 'gr8people', 'hireology', 'jobylon', 'join',
  'keka', 'loxo', 'recruiterflow', 'talentlyft', 'teamtailor', 'workstream',
  'zohorecruit', 'peopleforce', 'careerspage', 'ismartrecruit',
  'amazon', 'apple', 'ibm', 'meta', 'bairesdev', 'epam', 'lumenalta', 'dassault', 'uber',
] as const;
const CATEGORIES = 'software_engineering,backend,frontend,fullstack,mobile,devops,sre,network_engineering,data_engineering,data_science,data_analytics,ml_ai,ai_engineering,qa,security,architecture,embedded,blockchain,management,solutions_engineering';
export const FREEHIRE_MAX_PAGES = 500;

export function freehireCursor(cursor: string | null, board = ''): { index: number; offset: number } {
  const selected = board ? FREEHIRE_SOURCES.indexOf(board as typeof FREEHIRE_SOURCES[number]) : 0;
  const match = /^(\d{1,2}):(\d{1,4})$/.exec(cursor || `${selected}:0`);
  if (!match) throw new Error('Invalid Freehire page cursor.');
  const index = Number(match[1]), offset = Number(match[2]);
  if (selected < 0 || index >= FREEHIRE_SOURCES.length || offset > 9900 || offset % 100 !== 0 || (board && index !== selected)) throw new Error('Invalid Freehire page cursor.');
  return { index, offset };
}

export function freehireUrl(cursor: string | null, board = '', worldwide = false): URL {
  const { index, offset } = freehireCursor(cursor, board);
  const url = new URL('https://freehire.me/api/v1/agent/jobs/search');
  url.search = new URLSearchParams({ source: FREEHIRE_SOURCES[index], ...(worldwide ? { regions: 'global' } : { countries: 'US' }), work_mode: 'remote',
    category: CATEGORIES, description_format: 'text', limit: '100', offset: String(offset), sort: 'created_at', order: 'desc' }).toString();
  return url;
}

export function freehireNext(cursor: string | null, count: number, meta: Record<string, unknown>, board = ''): string | null {
  const { index, offset } = freehireCursor(cursor, board);
  const total = Number(meta?.total);
  if (!Number.isSafeInteger(total) || total < 0 || meta.offset !== offset || meta.limit !== 100 ||
    (Array.isArray(meta.ignored_params) && meta.ignored_params.length)) throw new Error('Freehire returned invalid or ignored search filters.');
  if (offset + count < total) {
    if (count !== 100) throw new Error('Freehire returned an incomplete jobs page.');
    if (offset >= 9900) throw new Error('Freehire search exceeds the public pagination limit. Imported jobs were kept.');
    return `${index}:${offset + count}`;
  }
  return !board && index + 1 < FREEHIRE_SOURCES.length ? `${index + 1}:0` : null;
}
