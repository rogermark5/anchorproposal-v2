export const JOBRIGHT_DEFAULT_PAGES = ['https://jobright.ai/jobs/software-engineer-jobs-in-united-states'];
export type JobrightRules = { blockedDomains: string[]; blockedWords: string[] };
export type JobrightSettings = JobrightRules & { searchUrls: string[]; intervalMinutes: number; maxJobsPerScan: number };
export type JobrightJob = { externalId: string; sourceUrl: string; originalUrl: string; title: string; company: string; location: string;
  description: string; publishedAt: string; workArrangement: 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN'; country?: string; salary?: string; employmentType?: string };
export type JobrightStatus = {
  settings: JobrightSettings; desired: 'stopped' | 'running' | 'login'; runId: string | null; startedAt: string | null;
  authenticated: boolean; keyConfigured: boolean; connected: boolean; workerStatus: string; browserMode: string;
  heartbeatAt: string | null; lastScanAt: string | null; lastError: string | null; loginFinishRequested: boolean;
  counts: { scanned: number; imported: number; duplicates: number; skipped: number };
  recent: { at: string; message: string }[];
};

export function jobrightPublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 3000) return null;
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase().replace(/\.+$/, ''); url.hostname = host;
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) ||
      !host.includes('.') || host.includes(':') || /^(?:\d+\.)*\d+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    return url.toString();
  } catch { return null; }
}
export function jobrightHost(host: string): boolean { host = host.toLowerCase().replace(/\.+$/, ''); return host === 'jobright.ai' || host.endsWith('.jobright.ai'); }
export function jobrightSearchUrl(value: unknown): string | null {
  const valid = jobrightPublicUrl(value); if (!valid) return null;
  const url = new URL(valid);
  if (url.protocol !== 'https:' || !['jobright.ai', 'www.jobright.ai'].includes(url.hostname) ||
    !/^\/jobs\//.test(url.pathname) || /%2f|%5c/i.test(url.pathname) || /^\/jobs\/(?:recommend|liked|applied|profile|resume|external)(?:\/|$)/.test(url.pathname)) return null;
  url.hash = ''; return url.toString();
}
export function normalizeJobrightRules(domains: unknown, words: unknown): JobrightRules {
  const lines = (value: unknown, name: string) => {
    if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 500)) throw Error(`Enter up to 100 ${name}.`);
    return [...new Set((value as string[]).map(item => item.trim()).filter(Boolean))];
  };
  return {
    blockedDomains: lines(domains, 'blocked domains').map(value => {
      const valid = jobrightPublicUrl(value.includes('://') ? value : 'https://' + value.replace(/^\*\./, ''));
      if (!valid) throw Error('Enter public domain names, such as linkedin.com.');
      return new URL(valid).hostname.toLowerCase().replace(/^www\./, '');
    }),
    blockedWords: lines(words, 'URL words').map(word => word.normalize('NFKC').toLowerCase()),
  };
}
/** Resolve explicit Jobright wrapper parameters; never substitute a Jobright URL. */
export function jobrightOriginalUrl(value: unknown): string | null {
  let valid = jobrightPublicUrl(value);
  for (let depth = 0; valid && depth < 5; depth++) {
    const url = new URL(valid);
    if (!jobrightHost(url.hostname)) return valid;
    const candidate = ['url', 'redirectUrl', 'redirect_url', 'target', 'applyUrl', 'applyLink', 'jobUrl', 'job_url'].map(key => url.searchParams.get(key)).find(Boolean);
    valid = candidate ? jobrightPublicUrl(candidate) : null;
  }
  return null;
}
export function jobrightLinkExclusion(value: unknown, rules: JobrightRules): string | null {
  const valid = jobrightPublicUrl(value); if (!valid) return 'Invalid public job URL';
  const url = new URL(valid), host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (jobrightHost(host)) return 'Jobright links cannot be imported';
  if (rules.blockedDomains.some(domain => host === domain || host.endsWith('.' + domain))) return 'Blocked domain';
  let decoded = valid;
  for (let i = 0; i < 3; i++) { try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; } }
  if (rules.blockedWords.some(word => decoded.normalize('NFKC').toLowerCase().includes(word))) return 'Blocked word in URL';
  return null;
}
/** Jobright's structured publishTime is UTC. Relative labels/updated dates are never posting times. */
export function jobrightPostedAt(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const utc = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(utc)) return null;
  const [day, clock] = utc.split('T'), [year, month, dateOfMonth] = day.split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, dateOfMonth));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== dateOfMonth ||
    Number(clock.slice(0, 2)) > 23 || Number(clock.slice(3, 5)) > 59 || Number(clock.slice(6, 8) || 0) > 59) return null;
  const date = new Date(utc); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function jobrightAfterStart(value: unknown, start: string | null, now = Date.now()): boolean {
  const posted = jobrightPostedAt(value), baseline = start ? Date.parse(start) : NaN;
  return !!posted && Number.isFinite(baseline) && Date.parse(posted) > baseline && Date.parse(posted) <= now;
}
