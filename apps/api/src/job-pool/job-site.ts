const sites: [string, string, RegExp][] = [
  ['aidev', 'AI Dev Jobs', /(^|\.)aidevboard\.com$/],
  ['arbeitnow', 'Arbeitnow', /(^|\.)arbeitnow\.(com|co\.uk|fr|ch|nl)$/],
  ['onjob', 'OnJob.io', /(^|\.)onjob\.io$/],
  ['nomado', 'Nomado24', /(^|\.)nomado24\.com$/],
  ['remote-network', 'Remote Frontend Jobs', /(^|\.)remotefrontendjobs\.com$/],
  ['remotefirst', 'Remote First Jobs', /(^|\.)remotefirstjobs\.com$/],
  ['wwr', 'We Work Remotely', /(^|\.)weworkremotely\.com$/],
  ['himalayas', 'Himalayas', /(^|\.)himalayas\.app$/],
  ['workday', 'Workday', /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/],
  ['greenhouse', 'Greenhouse', /(^|\.)(greenhouse\.io|greenhouse\.com)$/],
  ['lever', 'Lever', /(^|\.)lever\.co$/], ['ashby', 'Ashby', /(^|\.)ashbyhq\.com$/],
  ['workable', 'Workable', /(^|\.)workable\.com$/], ['recruitee', 'Recruitee', /(^|\.)recruitee\.com$/],
  ['breezy', 'Breezy HR', /(^|\.)breezy\.hr$/], ['pinpoint', 'Pinpoint', /(^|\.)pinpointhq\.com$/],
  ['personio', 'Personio', /(^|\.)personio\.(de|com)$/], ['teamtailor', 'Teamtailor', /(^|\.)teamtailor\.com$/],
  ['bamboohr', 'BambooHR', /(^|\.)bamboohr\.com$/], ['paylocity', 'Paylocity', /(^|\.)paylocity\.com$/],
  ['smartrecruiters', 'SmartRecruiters', /(^|\.)smartrecruiters\.com$/],
  ['linkedin', 'LinkedIn', /(^|\.)linkedin\.com$/], ['indeed', 'Indeed', /(^|\.)indeed\.com$/],
  ['jobicy', 'Jobicy', /(^|\.)jobicy\.com$/], ['remoteok', 'Remote OK', /(^|\.)remoteok\.com$/],
  ['usajobs', 'USAJOBS', /(^|\.)usajobs\.gov$/], ['remotejobs', 'RemoteJobs', /(^|\.)remotejobs\.org$/],
];
const names: Record<string,string> = { ocean: 'Ocean of Jobs', freehire: 'Freehire', 'freehire-global': 'Freehire', manual: 'Added by Master' };
export function jobSite(jobUrl: string, provider?: string | null) {
  let host = ''; try { host = new URL(jobUrl).hostname.toLowerCase(); } catch {}
  const match = sites.find(([, , pattern]) => pattern.test(host));
  const fallback = sites.find(([id]) => id === provider);
  return match ? { id: match[0], name: match[1] } : { id: provider || 'manual', name: fallback?.[1] || names[provider || 'manual'] || 'Company careers' };
}
