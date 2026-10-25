import { validCareerBoard, PUBLIC_CAREER_PROVIDERS } from './public-career-feeds';

export const companyKey = (name: string) => name.toLowerCase().replace(/\s/g, '');
// Only infer a board from an explicit public ATS URL. Never guess slugs from names.
export function employerBoard(jobUrl: string): { provider: string; boardToken: string } | null {
  let url: URL; try { url = new URL(jobUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
  let provider = '', boardToken = '';
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io'].includes(host) && parts[1] === 'jobs') { provider = 'greenhouse'; boardToken = parts[0]; }
  else if (host === 'jobs.ashbyhq.com' && parts.length >= 2) { provider = 'ashby'; boardToken = parts[0]; }
  else if (host === 'jobs.lever.co' && parts.length >= 2) { provider = 'lever'; boardToken = parts[0]; }
  else if (host === 'apply.workable.com' && parts[1] === 'j') { provider = 'workable'; boardToken = parts[0]; }
  else if (host === 'jobs.smartrecruiters.com' && parts.length >= 2) { provider = 'smartrecruiters'; boardToken = parts[0]; }
  else {
    const patterns: [string, RegExp][] = [['recruitee', /^([a-z\d][a-z\d_-]*)\.recruitee\.com$/], ['breezy', /^([a-z\d][a-z\d_-]*)\.breezy\.hr$/], ['pinpoint', /^([a-z\d][a-z\d_-]*)\.pinpointhq\.com$/], ['bamboohr', /^([a-z\d][a-z\d_-]*)\.bamboohr\.com$/], ['personio', /^([a-z\d][a-z\d_-]*)\.jobs\.personio\.(?:de|com)$/], ['teamtailor', /^([a-z\d][a-z\d_-]*)\.teamtailor\.com$/]];
    for (const [candidate, pattern] of patterns) { const match = pattern.exec(host); if (match) { provider = candidate; boardToken = candidate === 'teamtailor' ? host : match[1]; break; } }
  }
  if (!provider || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(boardToken) || (PUBLIC_CAREER_PROVIDERS.includes(provider) && !validCareerBoard(provider, boardToken))) return null;
  return { provider, boardToken };
}
