const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('@anchorproposal/shared');
const { fromHtml, fromPayload, listingFromPayload, originalFrom, mergeCandidates } = require('../src/extract.cjs');
const { BotApi } = require('../src/api.cjs');

const row = (changes = {}) => ({ jobResult: { jobId: 'abc123', jobTitle: 'Software Engineer', jobLocation: 'Remote, United States',
  publishTime: '2026-11-01 12:01:00', workModel: 'Remote', jobSummary: 'Build web software.', coreResponsibilities: ['Develop APIs'],
  url: 'https://jobright.ai/jobs/info/abc123', applyLink: 'https://jobright.ai/jobs/info/abc123', ...changes }, companyResult: { companyName: 'Example Co', url: 'https://example.com/' } });
test('source time is strict, UTC, and independent of first-seen dates and calendar rollover', () => {
  const now = Date.parse('2026-11-02T12:00:00Z'), start = '2026-11-01T12:00:00Z';
  assert.equal(rules.jobrightPostedAt('2026-11-01 12:01:00'), '2026-11-01T12:01:00.000Z');
  assert.equal(rules.jobrightPostedAt('2026-11-01T04:01:00-08:00'), '2026-11-01T12:01:00.000Z');
  for (const value of ['2026-02-30T12:00:00Z', '2026-11-01T24:01:00Z', 'today', '1 minute ago', '2026-11-01', null]) assert.equal(rules.jobrightPostedAt(value), null);
  for (const value of ['2026-11-01 11:59:59', start, '2026-11-02T12:00:01Z', 'unknown']) assert.equal(rules.jobrightAfterStart(value, start, now), false);
  assert.equal(rules.jobrightAfterStart('2026-11-01 12:01:00', start, now), true, 'A posting after the start stays eligible tomorrow');
  assert.equal(rules.jobrightAfterStart('2026-11-02T00:01:00Z', start, now), true);
});
test('original links, domain boundaries and decoded URL words are enforced', () => {
  const blocked = rules.normalizeJobrightRules(['*.LinkedIn.com', 'https://www.indeed.com/'], ['Contract', 'internship']);
  for (const value of ['https://linkedin.com/jobs/1', 'https://uk.linkedin.com/jobs/1', 'https://indeed.com/job/2']) assert.equal(rules.jobrightLinkExclusion(value, blocked), 'Blocked domain');
  assert.equal(rules.jobrightLinkExclusion('https://linkedin.com.example.org/jobs/1', blocked), null);
  assert.equal(rules.jobrightLinkExclusion('https://careers.example.org/%2563ONTRACT/1', blocked), 'Blocked word in URL');
  for (const value of ['https://jobright.ai/jobs/info/123', 'https://www.jobright.ai./jobs/1', 'file:///secret', 'https://127.0.0.1/jobs', 'https://user:pass@example.com/jobs', 'https://example.local/job']) assert.equal(rules.jobrightOriginalUrl(value), null);
  const employer = 'https://jobs.lever.co/example/123';
  assert.equal(rules.jobrightOriginalUrl('https://jobright.ai/jobs/external?url=' + encodeURIComponent(employer)), employer);
  assert.equal(rules.JOBRIGHT_JOBS_URL, 'https://jobright.ai/jobs/recommend');
  const recommended = 'https://jobright.ai/jobs/recommend?visit=software-engineer-jobs-in-united-states';
  assert.equal(rules.jobrightSearchUrl(recommended), recommended);
  for (const value of ['https://evil.com/jobs/search', 'https://jobright.ai/api/jobs', 'https://jobright.ai/jobs/liked', 'https://jobright.ai/jobs/applied', 'https://jobright.ai/jobs/profile']) assert.equal(rules.jobrightSearchUrl(value), null);
});
test('fresh listing responses are distinguished from detail and empty list responses', () => {
  assert.equal(listingFromPayload({ data: row() }), null);
  assert.deepEqual(listingFromPayload({ data: { jobList: [] } }), []);
  assert.equal(listingFromPayload({ data: { jobList: [row()] } })[0].externalId, 'abc123');
  assert.equal(listingFromPayload({ data: { jobs: [row()] } })[0].externalId, 'abc123');
  assert.deepEqual(fromPayload({ data: { jobList: [row()] } }, 'abc123'), [], 'Recommendation cards on a detail page are not job details');
  assert.equal(fromPayload({ data: { dataSource: row() } }, 'abc123')[0].externalId, 'abc123');
});
test('anonymous Jobright payloads never become original links or company homepages', () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { logined: false, jobList: [row()] } } }) + '</script>';
  const result = fromHtml(html); assert.equal(result.authenticated, false); assert.equal(result.jobs.length, 1);
  const job = result.jobs[0]; assert.equal(job.originalUrl, ''); assert.equal(job.company, 'Example Co'); assert.equal(job.workArrangement, 'REMOTE');
  assert.equal(job.publishedAt, '2026-11-01T12:01:00.000Z'); assert.match(job.description, /Develop APIs/);
  const signedIn = fromPayload({ data: { dataSource: row({ originalApplyUrl: 'https://careers.example.org/engineer' }) } });
  const merged = mergeCandidates(new Map([[job.externalId, job]]), signedIn).get(job.externalId); assert.equal(merged.originalUrl, 'https://careers.example.org/engineer');
  assert.equal(originalFrom({ hiringOrganization: { sameAs: 'https://example.org' } }), null);
  assert.equal(fromPayload({ jobResult: { ...row().jobResult, publishTime: undefined, publishTimeDesc: '1 minute ago', updatedAt: new Date().toISOString() } })[0].publishedAt, '');
});
test('JSON-LD uses source publication time and supports employer Apply URLs', () => {
  const data = { '@type': 'JobPosting', identifier: { value: 'abc123' }, title: 'Software Engineer', description: 'Develop APIs.',
    datePosted: '2026-11-01T12:01:00Z', jobLocationType: 'TELECOMMUTE', hiringOrganization: { name: 'Example', sameAs: 'https://example.org' },
    jobLocation: { address: { addressCountry: 'US', addressLocality: 'Boston' } }, url: 'https://jobright.ai/jobs/info/abc123' };
  const result = fromHtml('<script type="application/ld+json">' + JSON.stringify(data) + '</script>').jobs[0];
  assert.equal(result.originalUrl, ''); assert.equal(result.country, 'US'); assert.equal(result.workArrangement, 'REMOTE');
});
test('worker client sends only a scoped credential and refuses insecure remote servers', async () => {
  const key = 'jrbot_' + 'a'.repeat(64); let request;
  const api = new BotApi('https://example.org/backend', key, async (url, init) => { request = { url, init }; return Response.json({ desired: 'stopped' }); });
  await api.call('?instanceId=worker'); assert.equal(request.url, 'https://example.org/backend/job-pool/jobright-bot/worker?instanceId=worker');
  assert.equal(request.init.headers.Authorization, 'Bearer ' + key); assert.equal(request.init.method, 'GET');
  assert.throws(() => new BotApi('http://public.example.org', key), /HTTPS/);
  await assert.rejects(api.call('/auth/me'), /Unsupported/);
  const rejected = new BotApi('http://127.0.0.1:3001', key, async () => new Response('', { status: 401 }));
  await assert.rejects(rejected.call('?instanceId=worker'), error => error.status === 401 && !error.message.includes(key));
});
