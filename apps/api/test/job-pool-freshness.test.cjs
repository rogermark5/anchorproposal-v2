require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isFreshPoolPosting, poolImportTimeZone, poolPostingWindow, POOL_DAY_MS } = require('../dist/job-pool/job-freshness');
const { JobPoolService } = require('../dist/job-pool/job-pool.service');
const { fetchJobPage } = require('../dist/job-pool/job-providers');

test('new imports require today in the configured calendar, rejecting yesterday even within 24 hours', () => {
  const now = new Date('2026-10-24T10:30:00-07:00'), zone = 'America/Los_Angeles';
  for (const value of [now, '2026-10-24T00:00:00-07:00', '2026-10-24T08:30:00+01:00']) assert.equal(isFreshPoolPosting(value, now, zone), true);
  for (const value of [null, undefined, '', 'invalid', '2026-10-23T23:59:59.999-07:00', '2026-10-24T10:30:00.001-07:00']) assert.equal(isFreshPoolPosting(value, now, zone), false);
});

test('today handles daylight-saving days longer and shorter than 24 hours', () => {
  const zone = 'America/Los_Angeles';
  const fall = new Date('2026-11-01T23:30:00-08:00'), midnight = new Date('2026-11-01T00:00:00-07:00');
  assert.ok(fall - midnight > POOL_DAY_MS);
  assert.equal(isFreshPoolPosting(midnight, fall, zone), true);
  const spring = new Date('2026-03-08T23:30:00-07:00'), yesterday = new Date('2026-03-07T23:45:00-08:00');
  assert.ok(spring - yesterday < POOL_DAY_MS);
  assert.equal(isFreshPoolPosting(yesterday, spring, zone), false);
  assert.equal(isFreshPoolPosting('2026-03-08T00:00:00-08:00', spring, zone), true);
});

test('import timezone configuration is shared across hosts and rejects invalid zones', () => {
  const previous = process.env.JOB_POOL_TIME_ZONE;
  try {
    delete process.env.JOB_POOL_TIME_ZONE;
    assert.equal(poolImportTimeZone(), 'America/Los_Angeles');
    process.env.JOB_POOL_TIME_ZONE = 'UTC';
    assert.equal(poolImportTimeZone(), 'UTC');
    const now = new Date('2026-10-24T01:00:00Z');
    assert.equal(isFreshPoolPosting('2026-10-23T23:00:00Z', now), false);
    assert.equal(isFreshPoolPosting('2026-10-23T23:00:00Z', now, 'America/Los_Angeles'), true);
    process.env.JOB_POOL_TIME_ZONE = 'Invalid/Zone';
    assert.throws(poolImportTimeZone, RangeError);
  } finally {
    if (previous === undefined) delete process.env.JOB_POOL_TIME_ZONE; else process.env.JOB_POOL_TIME_ZONE = previous;
  }
});

test('30-day source-age limit composes with search, site, status and rolling publication windows', () => {
  const now = new Date('2026-11-02T01:35:00Z'), service = new JobPoolService({}, {});
  const where = service.jobFilters({ id: 'me', role: 'BIDDER' }, { q: 'Engineer', days: '1', country: 'GB', site: 'lever', status: 'all' }, now, now);
  assert.deepEqual(where.AND[0], poolPostingWindow(now));
  assert.equal(where.AND[0].OR[1].publishedAt.gte.getTime(), now.getTime() - 30 * POOL_DAY_MS);
  assert.equal(where.AND[0].OR[1].publishedAt.lte.getTime(), now.getTime());
  assert.ok(where.AND[1].OR.some(clause => clause.title));
  assert.equal(where.publishedAt.gte.getTime(), now.getTime() - POOL_DAY_MS);
  assert.deepEqual(where.source, { is: { provider: 'lever' } });
  assert.deepEqual(where.eligibleCountries, { has: 'GB' });
});

test('cleanup still runs while imports are paused or no sources are due, without overlapping cleanup passes', async () => {
  let releases, calls = 0;
  const pending = new Promise(resolve => { releases = resolve; });
  const service = new JobPoolService({ jobPoolJob: { updateMany: async args => {
    calls++; assert.equal(args.where.isActive, true); assert.deepEqual(args.data, { isActive: false });
    assert.ok(args.where.publishedAt.lt instanceof Date); await pending; return { count: 0 };
  } } }, {});
  service.poll = async () => {};
  const first = service.startWorker(), second = service.startWorker();
  assert.equal(calls, 1); releases(); await Promise.all([first, second]);
  await service.startWorker(); assert.equal(calls, 2);
});

test('Greenhouse updates cannot substitute for a missing original publication date', async () => {
  const updated = new Date().toISOString();
  const row = { id: 1, title: 'Software Engineer', absolute_url: 'https://boards.greenhouse.io/example/jobs/1', company_name: 'Example', location: { name: 'Remote, United States' }, content: 'Build software services.', updated_at: updated };
  const page = await fetchJobPage({ provider: 'greenhouse', boardToken: 'example', name: 'Example' }, null, async () => ({ jobs: [row] }));
  assert.equal(page.jobs.length, 1); assert.equal(page.jobs[0].publishedAt, null);
  assert.equal(page.jobs[0].sourceUpdatedAt.toISOString(), updated);
  assert.equal(isFreshPoolPosting(page.jobs[0].publishedAt), false);
});
