// Real database behavior in a disposable schema. Provider responses are fixtures.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { JobPoolService } = require('../dist/job-pool/job-pool.service');
const providers = require('../dist/job-pool/job-providers');
const { normalizeTitleKeywords, isSoftwareJob, isBlockedPoolTitle } = require('../dist/job-pool/software-jobs');

(async () => {
  await ConfigModule.forRoot();
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Use a local test database.');
  const schema = `pooltime_qa_${randomUUID().replaceAll('-', '')}`, admin = new PrismaClient();
  let db, checks = 0, schemaCreated = false;
  const originalFetch = providers.fetchJobPage;
  const check = label => { checks++; console.log(`PASS ${label}`); };
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    url.searchParams.set('schema', schema);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(`CREATE TYPE "WorkArrangement" AS ENUM ('REMOTE','HYBRID','ONSITE','UNKNOWN')`);
      await tx.$executeRawUnsafe('CREATE TABLE users (id TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE profiles (id TEXT PRIMARY KEY,"firstName" TEXT NOT NULL,"lastName" TEXT NOT NULL)');
      await tx.$executeRawUnsafe('CREATE TABLE system_settings (id TEXT PRIMARY KEY,key TEXT UNIQUE NOT NULL,value TEXT NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL)');
      for (const name of ['20261016120000_free_us_job_pool','20261016200000_software_pool_applied_scroll','20261018010000_job_pool_country_eligibility','20261018060000_job_pool_viewed','20261018070000_job_pool_import_batches','20261020010000_pool_profile_marks_and_title_rules']) {
        const sql = await fs.readFile(path.resolve(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');
        for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe(`INSERT INTO users VALUES ('me')`);
      await tx.$executeRawUnsafe(`INSERT INTO profiles VALUES ('qa-profile','Alex','Morgan')`);
      await tx.jobPoolSource.updateMany({ data: { enabled: false } });
    });
    const user = { id: 'me', role: 'BIDDER' }, master = { ...user, role: 'MASTER' };
    const apps = { matchingCompanies: async () => ({}), profileForPool: async () => ({ id: 'qa-profile' }) };
    const service = new JobPoolService(db, apps), otherService = new JobPoolService(db, apps);
    const now = Date.now(), hour = 3600000;
    const data = (id, extra = {}) => ({ id, externalId: id, canonicalUrl: `example.test/${id}`, jobUrl: `https://example.test/${id}`, title: 'Software Engineer', company: 'QA Company', location: 'Remote, United States', eligibleCountries: ['US'], description: 'Build software APIs with TypeScript.', sourceName: 'QA', workArrangement: 'REMOTE', isSoftware: true, ...extra });
    const settings = await service.settings();
    assert.deepEqual(settings.excludedTitleKeywords, ['staff','principal','architect','junior','lead','director']);
    assert.deepEqual(normalizeTitleKeywords([' Lead ', 'LEAD', '  Vice   President ']), ['lead','vice president']);
    assert.equal(isBlockedPoolTitle('Senior C++ Software Developer', ['c++']), true);
    assert.equal(isBlockedPoolTitle('Backend Developer', ['c++']), false);
    assert.equal(isSoftwareJob('Lead Software Engineer', '', []), true);
    assert.equal(isSoftwareJob('Director of Marketing', '', []), false);
    for (const role of ['ADMIN','BIDDER']) {
      await assert.rejects(service.updateSettings({ ...user, role }, { excludedTitleKeywords: [] }), /Only Master/);
      await assert.rejects(service.manage({ ...user, role }), /Only Master/);
    }
    for (const invalid of [null, 'lead', [5], [''], ['%'], ['a_b'], ['.*'], ['x'.repeat(81)], Array(101).fill('lead')]) {
      await assert.rejects(service.updateSettings(master, { excludedTitleKeywords: invalid }), /keyword|word|phrase/);
    }
    check('Six default exclusions, literal matching, normalized phrases and Master-only validated settings');

    await service.updateSettings(master, { enabled: false });
    await Promise.all([
      service.updateSettings(master, { excludedTitleKeywords: [' Lead ', 'LEAD', 'Director'] }),
      otherService.updateSettings(master, { intervalHours: 12 }),
    ]);
    const restarted = new JobPoolService(db, apps);
    assert.deepEqual(await restarted.settings(), { enabled: false, intervalHours: 12, excludedTitleKeywords: ['lead','director'] });
    check('Concurrent interval/keyword edits preserve both fields across service restarts');

    await db.jobPoolJob.create({ data: data('recent-source', { company: 'Time Fixture', publishedAt: new Date(now-23*hour), createdAt: new Date(now-25*hour) }) });
    await db.jobPoolJob.create({ data: data('old-source', { company: 'Time Fixture', publishedAt: new Date(now-25*hour), createdAt: new Date(now-1*hour) }) });
    await db.jobPoolJob.create({ data: data('unknown-source', { company: 'Time Fixture', publishedAt: null, createdAt: new Date(now-1*hour) }) });
    const filtered = await service.list(user, { q: 'Time Fixture', days: '1', status: 'all' });
    assert.deepEqual(filtered.jobs.map(job => job.id), ['recent-source']);
    const allTimes = await service.list(user, { q: 'Time Fixture', status: 'all' });
    assert.deepEqual(allTimes.jobs.map(job => job.id), ['recent-source','old-source','unknown-source']);
    assert.equal((await service.list(user, { q: 'Time Fixture', days: '3', status: 'all' })).total, 2);
    const notices = await service.updates(user, { q: 'Time Fixture', status: 'all', since: new Date(now-2*hour).toISOString() });
    assert.equal(notices.newCount, 2);
    assert.equal((await service.updates(user, { q: 'Time Fixture', days: '1', status: 'all', since: new Date(now-2*hour).toISOString() })).newCount, 0);
    check('Rolling source dates override conflicting import dates; unknown dates sort last and import notices stay independent');

    for (let index=0; index<45; index++) await db.jobPoolJob.create({ data: data('scroll-'+String(index).padStart(2,'0'), {
      company: 'Scroll Fixture', publishedAt: index < 25 ? new Date(now-Math.floor(index/5)*hour) : null,
      createdAt: new Date(now-(45-index)*1000),
    }) });
    let page = await service.list(user, { q: 'Scroll Fixture', status: 'all' });
    assert.equal(page.jobs.length, 20);
    const ids = page.jobs.map(job => job.id), snapshot = page.asOf;
    await service.markApplied(user, ids[0], { applied: true, profileId: 'qa-profile' });
    await db.jobPoolJob.create({ data: data('scroll-late', { company: 'Scroll Fixture', publishedAt: new Date(now-hour), createdAt: new Date(Date.parse(snapshot)+2000) }) });
    while (page.nextCursor) {
      page = await service.list(user, { q: 'Scroll Fixture', status: 'all', cursor: page.nextCursor });
      ids.push(...page.jobs.map(job => job.id));
      assert.equal(page.asOf, snapshot);
    }
    assert.equal(ids.length, 45); assert.equal(new Set(ids).size, 45); assert.equal(ids.includes('scroll-late'), false);
    assert.deepEqual(ids.slice(-20), Array.from({length:20},(_,i)=>'scroll-'+(44-i)));
    const oldCursor = Buffer.from(JSON.stringify({at:new Date(now).toISOString(),id:'scroll-00',asOf:snapshot})).toString('base64url');
    await assert.rejects(service.list(user, { cursor: oldCursor }), /Refresh the job list/);
    check('Source-date scrolling crosses ties and unknown dates without skips or duplicates during imports and applied marks');

    await service.updateSettings(master, { excludedTitleKeywords: [] });
    const lead = await db.jobPoolJob.create({ data: data('history-lead', { title: 'Lead Software Engineer' }) });
    await service.markViewed(user, lead.id); await service.markApplied(user, lead.id, { applied: true, profileId: 'qa-profile' });
    await service.updateSettings(master, { excludedTitleKeywords: ['lead','director'] });
    assert.equal((await service.list(user, { q: 'Lead Software', status: 'all' })).total, 0);
    await assert.rejects(service.detail(lead.id, master), /no longer available/);
    await assert.rejects(service.markViewed(user, lead.id), /no longer available/);
    await assert.rejects(service.addJob(master, { title: 'Director of Software Engineering', company: 'QA', location: 'USA', description: 'Build software', jobUrl: 'https://example.com/director' }), /excluded keyword/);
    assert.equal(await db.jobPoolApplied.count({ where: { jobId: lead.id } }), 1);
    assert.equal(await db.jobPoolViewed.count({ where: { jobId: lead.id } }), 1);
    await service.updateSettings(master, { excludedTitleKeywords: [] });
    assert.equal((await service.detail(lead.id, user)).applied, true);
    assert.equal((await service.detail(lead.id, user)).viewed, true);
    check('Saved exclusions immediately filter existing jobs and actions while preserving per-profile application/viewed history');

    const source = await db.jobPoolSource.create({ data: { name: 'QA source only', provider: 'lever', boardToken: 'qa-only', queued: true } });
    const sourceDate = new Date(now-72*hour);
    const imported = (id,title,publishedAt=sourceDate) => {
      const { id: ignored, canonicalUrl: ignoredUrl, isSoftware: ignoredSoftware, ...job } = data(id, { title, publishedAt, salary: null, employmentType: null, expiresAt: null });
      return job;
    };
    let response = [imported('import-backend','Backend Developer'), imported('import-lead','Lead Software Engineer'), imported('import-director','Director of Engineering')];
    providers.fetchJobPage = async current => { assert.equal(current.id, source.id); return {jobs:response, next:null, complete:true}; };
    await service.updateSettings(master, { excludedTitleKeywords: ['lead','director'] });
    await service.poll('boards');
    assert.equal(await db.jobPoolJob.count({ where: { sourceId: source.id } }), 1);
    const original = await db.jobPoolJob.findFirst({ where: { sourceId: source.id } });
    assert.equal(original.publishedAt.getTime(), sourceDate.getTime());
    response = [imported('import-backend','Backend Developer',null), imported('import-lead','Lead Software Engineer'), imported('import-director','Director of Engineering'), imported('import-undated','Software Developer',null)];
    await service.updateSettings(master, { excludedTitleKeywords: [] });
    await db.jobPoolSource.update({ where: { id: source.id }, data: { queued: true, lastAttemptAt: null, nextSyncAt: new Date(0) } });
    await service.poll('boards');
    assert.equal(await db.jobPoolJob.count({ where: { sourceId: source.id } }), 4);
    const refreshed = await db.jobPoolJob.findUnique({ where: { id: original.id } });
    assert.equal(refreshed.publishedAt.getTime(), sourceDate.getTime());
    assert.equal(refreshed.postedAt.getTime(), sourceDate.getTime());
    assert.equal(refreshed.createdAt.getTime(), original.createdAt.getTime());
    assert.equal((await db.jobPoolJob.findFirst({ where: { externalId:'import-undated' } })).publishedAt, null);
    check('Imports honor saved keywords, allow removed terms, and preserve known source dates through undated refreshes');
    console.log(`${checks} source-time and keyword database checks passed; no external provider or AI requests.`);
  } finally {
    providers.fetchJobPage = originalFetch;
    if (db) await db.$disconnect();
    if (!/^pooltime_qa_[a-f0-9]{32}$/.test(schema)) throw Error('Invalid disposable QA schema');
    if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
