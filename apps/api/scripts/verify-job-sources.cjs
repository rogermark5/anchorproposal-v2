// Read-only verifier for public company boards. No credentials, paid API,
// application submission or database writes. Results contain metadata only.
const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchJobPage, readFeed, isUsLocation, plainText } = require('../dist/job-pool/job-providers');
const { eligibleCountries } = require('../dist/job-pool/job-geography');
const { isSoftwareJob } = require('../dist/job-pool/software-jobs');
const { parseCareerResponse, PUBLIC_CAREER_PROVIDERS, validCareerBoard } = require('../dist/job-pool/public-career-feeds');
const root = path.resolve(__dirname, '../../..');
const inputFile = path.resolve(root, process.argv[2] || 'apps/api/prisma/job-pool-additional-sources.json');
const outputFile = path.resolve(root, process.argv[3] || 'tmp/job-pool-qa/verified-sources.json');
const positiveTarget = Number(process.argv.find(arg => arg.startsWith('--target='))?.split('=')[1] || 0);
const jobTarget = Number(process.argv.find(arg => arg.startsWith('--target-jobs='))?.split('=')[1] || 0);
const softwareTarget = Number(process.argv.find(arg => arg.startsWith('--target-software-sources='))?.split('=')[1] || 0);
const concurrency = Number(process.argv.find(arg => arg.startsWith('--concurrency='))?.split('=')[1] || 4);
const maxCandidates = Number(process.argv.find(arg => arg.startsWith('--max-candidates='))?.split('=')[1] || 30_000);
const newOnly = process.argv.includes('--new-only');
if (!Number.isInteger(positiveTarget) || positiveTarget < 0 || positiveTarget > 30_000 || !Number.isInteger(jobTarget) || jobTarget < 0 || jobTarget > 100_000 || !Number.isInteger(softwareTarget) || softwareTarget < 0 || softwareTarget > 30_000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12 || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 30_000) throw Error('Use --target=0..30000, --target-jobs=0..100000, --target-software-sources=0..30000, --concurrency=1..12 and --max-candidates=1..30000.');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const providers = ['greenhouse', 'ashby', 'lever', 'smartrecruiters', 'workable', 'recruitee', 'breezy', 'pinpoint', ...PUBLIC_CAREER_PROVIDERS];
const gates = new Map(); const blocked = new Set();
async function read(url) {
  const hostname = url.hostname;
  const previous = gates.get(hostname) || Promise.resolve();
  const gate = previous.then(() => pause(200)); gates.set(hostname, gate); await gate;
  if (blocked.has(hostname)) throw Error('Rate limited; remaining requests to this host stopped');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(18_000), headers: { Accept: 'application/json', 'User-Agent': 'AnchorProposal/1.0 (public company board verification)' } });
  if (response.status === 429) { blocked.add(hostname); throw Error('Rate limited; remaining requests to this host stopped'); }
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const maximum = 20 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw Error('Response too large'); }
  if (!response.body) throw Error('Empty response');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length;
    if (length > maximum) { await reader.cancel(); throw Error('Response too large'); } chunks.push(item.value); }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8');
  return parseCareerResponse(url, text) ?? JSON.parse(text);
}
function endpoint(provider, token) {
  if (PUBLIC_CAREER_PROVIDERS.includes(provider) && !validCareerBoard(provider, token)) throw Error('Invalid public employer board');
  if (provider === 'teamtailor') return new URL(`https://${token}/jobs.json`);
  if (provider === 'personio') return new URL(`https://${token}.jobs.personio.de/xml?language=en`);
  if (provider === 'bamboohr') return new URL(`https://${token}.bamboohr.com/careers/list`);
  if (provider === 'paylocity') return new URL(`https://recruiting.paylocity.com/recruiting/jobs/All/${token}`);
  if (['workable','recruitee','breezy','pinpoint'].includes(provider) && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(token)) throw Error('Invalid employer subdomain');
  token = encodeURIComponent(token);
  if (provider === 'greenhouse') return new URL(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  if (provider === 'ashby') return new URL(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`);
  if (provider === 'lever') return new URL(`https://api.lever.co/v0/postings/${token}?mode=json&limit=100`);
  if (provider === 'workable') return new URL(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`);
  if (provider === 'recruitee') return new URL(`https://${token}.recruitee.com/api/offers`);
  if (provider === 'breezy') return new URL(`https://${token}.breezy.hr/json`);
  if (provider === 'pinpoint') return new URL(`https://${token}.pinpointhq.com/postings.json`);
  return new URL(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100&locationType=REMOTE&destination=PUBLIC`);
}
(async () => {
  const input = JSON.parse(await fs.readFile(inputFile, 'utf8')); const tasks = [];
  const candidates = input.candidates || Object.fromEntries(providers.map(provider => [provider, (input.sources || []).filter(source => source.provider === provider).map(source => source.boardToken)]));
  const migrations = path.join(root, 'apps/api/prisma/migrations');
  const existing = new Set();
  for (const entry of await fs.readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = entry.name;
    if (!newOnly && directory !== '20261016120000_free_us_job_pool') continue;
    const sql = await fs.readFile(path.join(migrations, directory, 'migration.sql'), 'utf8');
    for (const match of sql.matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)) existing.add(`${match[1]}:${match[2]}`.toLowerCase());
  }
  for (const source of input.excludedSources || []) {
    if (typeof source.provider !== 'string' || typeof source.boardToken !== 'string') throw Error('Invalid excluded source.');
    existing.add(`${source.provider}:${source.boardToken}`.toLowerCase());
  }
  const length = Math.max(...providers.map(provider => candidates[provider]?.length || 0));
  for (let i = 0; i < length; i++) for (const provider of providers) {
    const token = candidates[provider]?.[i];
    const key = `${provider}:${token}`.toLowerCase();
    if (token && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(token) && (!PUBLIC_CAREER_PROVIDERS.includes(provider) || validCareerBoard(provider,token)) && (!['workable','recruitee','breezy','pinpoint'].includes(provider) || /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(token)) && !existing.has(key)) {
      existing.add(key);
      tasks.push({ provider, boardToken: token, name: input.names?.[token] || input.sources?.find(source => source.provider === provider && source.boardToken === token)?.name || token.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase()) });
    }
  }
  let index = 0, completed = 0; const available = [], unavailable = [], seen = new Set();
  if (process.argv.includes('--resume')) {
    const previous = JSON.parse(await fs.readFile(outputFile, 'utf8'));
    const taskKeys = new Set(tasks.map(source => `${source.provider}:${source.boardToken}`.toLowerCase()));
    if (previous.candidates !== tasks.length || !Array.isArray(previous.available) || !Array.isArray(previous.unavailable)) throw Error('Resume file does not match this candidate input.');
    for (const row of [...previous.available, ...previous.unavailable]) {
      const key = `${row.provider}:${row.boardToken}`.toLowerCase();
      if (!taskKeys.has(key) || seen.has(key)) throw Error('Resume file contains mismatched or repeated boards.');
      seen.add(key);
    }
    if (previous.completed !== seen.size || previous.available.some(source => !Number.isInteger(source.remoteUsFirstPage) || source.remoteUsFirstPage < 0 || (softwareTarget && (!Number.isInteger(source.softwareJobsOnPage) || source.softwareJobsOnPage < 0)))) throw Error('Resume file has incomplete or invalid verification counts.');
    available.push(...previous.available); unavailable.push(...previous.unavailable); completed = previous.completed;
    for (const host of previous.rateLimitedHosts || []) blocked.add(host);
  }
  const belowTarget = () => (!positiveTarget && !jobTarget && !softwareTarget) || available.filter(source => source.remoteUsFirstPage > 0).length < positiveTarget || available.reduce((total, source) => total + source.remoteUsFirstPage, 0) < jobTarget || available.filter(source => source.softwareJobsOnPage > 0).length < softwareTarget;
  let checkpoint = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify({ checkedAt: new Date().toISOString(), candidates: tasks.length, completed, available, unavailable, rateLimitedHosts: [...blocked] }, null, 2);
    // A stopped verifier must leave its last complete checkpoint usable.
    checkpoint = checkpoint.then(async () => { await fs.writeFile(outputFile + '.tmp', snapshot); await fs.rename(outputFile + '.tmp', outputFile); });
    return checkpoint;
  };
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < Math.min(tasks.length, maxCandidates) && belowTarget()) {
      const source = tasks[index++], url = endpoint(source.provider, source.boardToken);
      if (seen.has(`${source.provider}:${source.boardToken}`.toLowerCase())) continue;
      if (blocked.has(url.hostname)) { unavailable.push({ provider: source.provider, boardToken: source.boardToken, reason: 'Rate limited; request skipped for this host.' }); completed++; continue; }
      try {
        const payload = await read(url);
        const rows = ['lever','breezy'].includes(source.provider) ? payload : source.provider === 'smartrecruiters' ? payload.content : source.provider === 'recruitee' ? payload.offers : source.provider === 'pinpoint' ? payload.data : source.provider === 'teamtailor' ? payload.items : source.provider === 'bamboohr' ? payload.result : source.provider === 'paylocity' ? payload.Jobs : payload.jobs;
        if (!Array.isArray(rows) || !rows.length) throw Error('No published jobs');
        const softwareJobsOnPage = rows.filter(row => {
          if (!row || typeof row !== 'object' || row.isListed === false || row.active === false || row.IsInternal === true) return false;
          const title = plainText(source.provider === 'lever' ? row.text : ['smartrecruiters','breezy','personio'].includes(source.provider) ? row.name : row.jobOpeningName || row.JobTitle || row.title, 250);
          const description = plainText(source.provider === 'greenhouse' ? row.content : source.provider === 'lever' ? [row.descriptionPlain || row.description, ...(row.lists || []).map(item => item.content || '')].join('\n') : row.descriptionPlain || row.descriptionHtml || row.description || row.Description || row.content_html || (row.jobDescriptions?.jobDescription || []).map(section=>section.value).join('\n'));
          return isSoftwareJob(title, description);
        }).length;
        let remoteUsFirstPage, remoteEligibleFirstPage, jobsByCountry;
        if (source.provider === 'smartrecruiters') {
          const eligible = rows.filter(row => row.location?.remote === true && row.location?.hybrid !== true && (!row.visibility || row.visibility === 'PUBLIC') && eligibleCountries(row.location?.city, row.location?.country).length > 0 && isSoftwareJob(plainText(row.name,250)));
          remoteUsFirstPage = eligible.filter(row => isUsLocation(row.location?.city,row.location?.country)).length;
          remoteEligibleFirstPage = eligible.length;
          jobsByCountry = Object.fromEntries(['US','GB','IE'].map(country => [country, eligible.filter(row => eligibleCountries(row.location?.city,row.location?.country).includes(country)).length]));
        }
        else {
          const jobs = (await fetchJobPage(source, null, async (detailUrl, headers) => detailUrl.origin === url.origin && detailUrl.pathname === url.pathname ? payload : readFeed(detailUrl,headers))).jobs;
          remoteUsFirstPage = jobs.filter(job => job.eligibleCountries.includes('US')).length;
          remoteEligibleFirstPage = jobs.length;
          jobsByCountry = Object.fromEntries(['US','GB','IE'].map(country => [country, jobs.filter(job => job.eligibleCountries.includes(country)).length]));
        }
        if (source.provider === 'greenhouse' && (remoteUsFirstPage > 0 || (softwareTarget && softwareJobsOnPage > 0))) {
          try { const board = await read(new URL(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.boardToken)}`));
            const name = plainText(board.name, 120).replace(/^(?:careers|jobs|current openings) at /i, '').trim();
            if (name && !/^(?:careers|jobs|current openings|job board)$/i.test(name)) source.name = name;
          } catch {}
        }
        if (source.provider === 'smartrecruiters') source.name = plainText(rows[0]?.company?.name, 120) || source.name;
        available.push({ ...source, publishedJobs: Number(payload.meta?.total || payload.totalFound || rows.length), softwareJobsOnPage, remoteUsFirstPage, remoteEligibleFirstPage, jobsByCountry, verifiedAt: new Date().toISOString() });
      } catch (error) { unavailable.push({ provider: source.provider, boardToken: source.boardToken, reason: error.message }); }
      completed++;
      if (completed % 30 === 0) { await save(); console.log(JSON.stringify({ checked: completed, candidates: tasks.length, verified: available.length, softwareSources: available.filter(source => source.softwareJobsOnPage > 0).length, withRemoteUs: available.filter(source => source.remoteUsFirstPage > 0).length, matchingJobs: available.reduce((total, source) => total + source.remoteUsFirstPage, 0) })); }
    }
  }));
  available.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)); await save();
  console.log(JSON.stringify({ complete: true, targetReached: positiveTarget || jobTarget || softwareTarget ? !belowTarget() : null, verified: available.length, softwareSources: available.filter(source => source.softwareJobsOnPage > 0).length, remoteUsListingsOnCheckedPages: available.reduce((sum, source) => sum + source.remoteUsFirstPage, 0), byProvider: Object.fromEntries(providers.map(provider => [provider, available.filter(source => source.provider === provider).length])), outputFile }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
