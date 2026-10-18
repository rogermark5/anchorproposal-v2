const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchJobPage } = require('../dist/job-pool/job-providers');
const { freehireCursor, freehireNext, FREEHIRE_SOURCES } = require('../dist/job-pool/freehire-feed');
const source = { provider: 'freehire', name: 'Freehire', boardToken: '' };
const row = (overrides = {}) => ({ public_slug: 'engineer-example', source: 'workday', title: 'Software Engineer', company: 'Example',
  location: 'Remote, United States', countries: ['us'], work_mode: 'remote', closed_at: null,
  url: 'https://example.wd1.myworkdayjobs.com/External/job/US/Engineer_123?utm_source=freehire.me',
  description: '<p>Build production software.</p>', last_seen_at: new Date().toISOString(), posted_at: '2026-10-01T12:00:00Z', ...overrides });
const payload = (rows, total = rows.length, offset = 0) => ({ data: rows, meta: { total, limit: 100, offset } });

test('Freehire uses only public, filtered employer feeds and keeps full descriptions and original links', async () => {
  const result = await fetchJobPage(source, null, async (url, headers) => {
    assert.equal(url.origin, 'https://freehire.me'); assert.equal(url.pathname, '/api/v1/agent/jobs/search');
    assert.equal(url.searchParams.get('source'), 'workday'); assert.equal(url.searchParams.get('countries'), 'US,GB,IE');
    assert.equal(url.searchParams.get('work_mode'), 'remote'); assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.get('description_format'), 'text'); assert.deepEqual(headers, {});
    return payload([row()]);
  });
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].description, 'Build production software.');
  assert.equal(result.jobs[0].sourceName, 'Freehire · workday'); assert.equal(result.jobs[0].publishedAt.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.match(result.jobs[0].jobUrl, /myworkdayjobs\.com/); assert.equal(result.next, '1:0'); assert.equal(result.complete, false);
});

test('Freehire independently rejects closed, stale, non-US, vague, hybrid, onsite and non-software jobs', async () => {
  const excluded = [
    { closed_at: new Date().toISOString() }, { last_seen_at: new Date(Date.now() - 8 * 86400_000).toISOString() },
    { last_seen_at: null }, { last_seen_at: '2099-01-01' }, { countries: ['gb'] }, { countries: [] },
    { location: 'Remote', countries: [] }, { location: 'Worldwide except US' }, { location: 'Toronto, Canada' },
    { location: 'USA - Hybrid' }, { location: 'USA - Onsite' }, { work_mode: 'hybrid' },
    { work_mode: 'onsite' }, { work_mode: null }, { title: 'Account Executive' }, { title: 'Mechanical Engineer' },
    { url: 'https://himalayas.app/companies/example/jobs/1' }, { url: 'https://remotive.com/jobs/1' },
    { url: 'http://127.0.0.1/job' }, { description: '' },
  ];
  const result = await fetchJobPage(source, null, async () => payload([row(), ...excluded.map(value => row(value))]));
  assert.equal(result.jobs.length, 1);
  assert.ok(!FREEHIRE_SOURCES.includes('himalayas')); assert.ok(!FREEHIRE_SOURCES.includes('remotive'));
  await assert.rejects(fetchJobPage(source, null, async () => payload([row({ source: 'himalayas' })])), /employer source filter/);
});

test('Freehire paginates raw results even when every job on the page is filtered out', async () => {
  const result = await fetchJobPage(source, '0:100', async () => payload(Array.from({ length: 100 }, () => row({ title: 'Recruiter' })), 201, 100));
  assert.equal(result.jobs.length, 0); assert.equal(result.next, '0:200');
  const final = `${FREEHIRE_SOURCES.length - 1}:0`;
  const last = await fetchJobPage(source, final, async () => payload([]));
  assert.equal(last.next, null); assert.equal(last.complete, true);
});

test('Freehire rejects malformed pagination, ignored filters and requests beyond public limits', async () => {
  for (const cursor of ['https://evil.example', '0:1', '-1:0', `${FREEHIRE_SOURCES.length}:0`, '0:10000', '1:0:0']) assert.throws(() => freehireCursor(cursor));
  assert.throws(() => freehireNext(null, 0, { total: 100, limit: 100, offset: 0 }), /incomplete/);
  assert.throws(() => freehireNext(null, 1, { total: 1, limit: 100, offset: 0, ignored_params: ['countries'] }), /ignored/);
  assert.throws(() => freehireNext('0:9900', 100, { total: 10001, limit: 100, offset: 9900 }), /pagination limit/);
  assert.throws(() => freehireNext(null, 1, { total: 1, limit: 20, offset: 0 }), /invalid/);
  await assert.rejects(fetchJobPage(source, null, async () => ({ data: [], meta: { total: -1, limit: 100, offset: 0 } })), /invalid/);
});

test('Structured US eligibility resolves generic remote labels without accepting conflicting locations', async () => {
  const labels = ['Remote', 'Any Location / Remote', 'Remote (Any State)', 'Remote - TX', 'MN - Remote', 'USA_Remote'];
  const result = await fetchJobPage(source, null, async () => payload([...labels.map(location => row({ location })), row({ location: 'Remote', countries: ['ca'] }), row({ location: 'Remote - UK' }), row({ location: 'Remote - Worldwide', countries:['gb'] }), row({ location: 'Berlin' })]));
  assert.equal(result.jobs.length, labels.length + 1);
  for (const job of result.jobs.slice(0, labels.length)) assert.deepEqual(job.eligibleCountries, ['US']);
  assert.deepEqual(result.jobs.at(-1).eligibleCountries, ['GB']);
});

test('Worldwide employer feeds require explicit unrestricted locations and reject vague or conflicting eligibility', async () => {
  const accepted = ['Worldwide', 'Remote (Worldwide)', 'REMOTE - GLOBAL', 'Work from anywhere'];
  const rejected = ['Remote', 'Remote - Anywhere except US', 'Global - Europe', 'Anywhere; Europe', 'North America', 'EMEA'];
  const result = await fetchJobPage({...source,provider:'freehire-global',boardToken:'workday'}, null, async url => {
    assert.equal(url.searchParams.get('regions'),'global');assert.equal(url.searchParams.has('countries'),false);
    return payload([...accepted.map(location=>row({location,countries:[]})),...rejected.map(location=>row({location,countries:[]})),row({location:'Worldwide',countries:['gb']}),row({location:'Worldwide',countries:[],description:'Applicants outside the US only.'})]);
  });
  assert.deepEqual(result.jobs.map(job=>job.location),[...accepted, 'Worldwide', 'Worldwide']);
  assert.deepEqual(result.jobs.at(-2).eligibleCountries, ['GB']);
  assert.deepEqual(result.jobs.at(-1).eligibleCountries, ['GB', 'IE']);
});

test('Independent employer feeds stop at their own last page and cannot follow another feed cursor', async () => {
  const result = await fetchJobPage({ ...source, boardToken: 'workable' }, null, async url => {
    assert.equal(url.searchParams.get('source'), 'workable');
    return payload([row({ source: 'workable' })]);
  });
  assert.equal(result.jobs.length, 1); assert.equal(result.next, null); assert.equal(result.complete, true);
  assert.throws(() => freehireCursor('0:100', 'workable'), /Invalid/);
  assert.throws(() => freehireCursor(null, 'himalayas'), /Invalid/);
});
