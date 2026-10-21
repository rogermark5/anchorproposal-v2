// Real transactions in an isolated, disposable schema; no providers or AI calls.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { JobPoolService } = require('../dist/job-pool/job-pool.service');

(async () => {
  await ConfigModule.forRoot();
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Use a local test database.');
  const schema = `jobbatch_qa_${randomUUID().replaceAll('-', '')}`, admin = new PrismaClient();
  let db, checks = 0;
  const check = label => { checks++; console.log(`PASS ${label}`); };
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TYPE "WorkArrangement" AS ENUM (\'REMOTE\', \'HYBRID\', \'ONSITE\', \'UNKNOWN\')');
      await tx.$executeRawUnsafe('CREATE TABLE "users" ("id" TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "system_settings" ("id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "value" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL)');
      await tx.$executeRawUnsafe('CREATE TABLE profiles (id TEXT PRIMARY KEY,"firstName" TEXT NOT NULL,"lastName" TEXT NOT NULL)');
      await tx.$executeRawUnsafe(`INSERT INTO profiles VALUES ('qa-profile','Alex','Morgan')`);
      for (const migration of ['20261016120000_free_us_job_pool', '20261016200000_software_pool_applied_scroll', '20261018010000_job_pool_country_eligibility', '20261018060000_job_pool_viewed', '20261018070000_job_pool_import_batches','20261020010000_pool_profile_marks_and_title_rules']) {
        const sql = await fs.readFile(path.resolve(__dirname, '../prisma/migrations', migration, 'migration.sql'), 'utf8');
        for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe(`INSERT INTO "users" ("id") VALUES ('me'), ('other')`);
      await tx.systemSetting.create({ data: { key: 'job_pool_settings', value: JSON.stringify({ enabled: false, intervalHours: 1 }) } });
    });
    const user = { id: 'me', role: 'BIDDER' }, master = { id: 'me', role: 'MASTER' };
    const service = new JobPoolService(db, {profileForPool:async()=>({id:'qa-profile'}), matchingCompanies: async () => ({}) });
    const otherService = new JobPoolService(db, { matchingCompanies: async () => ({}) });
    const data = id => ({ externalId: id, canonicalUrl: `example.test/${id}`, jobUrl: `https://example.test/${id}`, title: 'Software Engineer', company: 'QA Company', location: 'Remote, United States', eligibleCountries: ['US'], description: 'Build software with TypeScript.', sourceName: 'Test only', workArrangement: 'REMOTE', isSoftware: true });
    const save = (id, worker = service) => worker.saveImportedJob(data(id), { description: 'Updated description' });
    assert.equal(await service.latestImport(), null);
    const [first, second] = await Promise.all([save('first'), save('second', otherService)]);
    const initial = await service.latestImport();
    assert.equal(first.addedBatchId, initial.id); assert.equal(second.addedBatchId, initial.id);
    assert.equal(new Date(initial.endsAt) - new Date(initial.startedAt), 3600000);
    check('Concurrent services put new jobs in one persisted one-hour import group');
    await service.markViewed(user, first.id); await service.markApplied(user, first.id, { applied: true, profileId:'qa-profile' });
    const expire = async () => { const batch = await service.latestImport(); batch.endsAt = new Date(Date.now() - 1).toISOString(); await db.systemSetting.update({ where: { key: 'job_pool_latest_additions' }, data: { value: JSON.stringify(batch) } }); };
    await expire();
    const refreshed = await save('first');
    assert.equal(refreshed.id, first.id); assert.equal(refreshed.addedBatchId, initial.id);
    await service.startWorker();
    assert.equal((await service.latestImport()).id, initial.id);
    check('Elapsed time, empty imports and existing-job refreshes do not reset New or create a fresh group');
    const [third, fourth] = await Promise.all([save('third'), save('fourth', otherService)]);
    const next = await service.latestImport();
    assert.notEqual(next.id, initial.id);
    assert.equal(third.addedBatchId, next.id); assert.equal(fourth.addedBatchId, next.id);
    const listed = await service.list(user, { status: 'all' });
    assert.equal(listed.latestImport.id, next.id);
    assert.deepEqual(listed.jobs.filter(job => job.addedBatchId === next.id).map(job => job.externalId).sort(), ['fourth', 'third']);
    const history = listed.jobs.find(job => job.id === first.id);
    assert.equal(history.viewed, true); assert.equal(history.applied, true); assert.equal(history.addedBatchId, initial.id);
    check('The next group moves New only to genuine additions and preserves old Viewed/Applied records');
    const restarted = new JobPoolService(db, { matchingCompanies: async () => ({}) });
    const otherListing = await restarted.list({ id: 'other', role: 'ADMIN' }, { status: 'all' });
    assert.equal(otherListing.latestImport.id, next.id); assert.equal(otherListing.jobs.find(job => job.id === first.id).viewed, false);
    assert.equal((await restarted.updates(user, { since: new Date(Date.now() - 86400000).toISOString() })).latestImport.id, next.id);
    check('Restarted services and every account see the same latest group, with private user histories');
    const manual = await service.addJob(master, { ...data('manual'), jobUrl: 'https://example.com/manual' });
    assert.equal(manual.addedBatchId, next.id);
    await assert.rejects(service.addJob(master, { ...data('manual'), jobUrl: 'https://example.com/manual' }), /already in/);
    assert.equal((await service.latestImport()).id, next.id);
    check('Master additions share the current group; duplicate publication cannot advance it');
    await expire();
    const originalTag = service.tagAddition;
    service.tagAddition = async function(tx, id) { await originalTag.call(this, tx, id); throw Error('Simulated interruption before commit'); };
    await assert.rejects(save('interrupted'), /Simulated interruption/);
    service.tagAddition = originalTag;
    assert.equal(await db.jobPoolJob.findUnique({ where: { canonicalUrl: data('interrupted').canonicalUrl } }), null);
    assert.equal((await service.latestImport()).id, next.id);
    check('Job insertion and New-group changes roll back together on failure');
    await db.systemSetting.update({ where: { key: 'job_pool_settings' }, data: { value: JSON.stringify({ enabled: false, intervalHours: 6 }) } });
    const changed = await save('six-hours'), changedBatch = await service.latestImport();
    assert.equal(changed.addedBatchId, changedBatch.id); assert.notEqual(changedBatch.id, next.id);
    assert.equal(new Date(changedBatch.endsAt) - new Date(changedBatch.startedAt), 6 * 3600000);
    check('New additions respect a changed import interval without relabelling existing jobs');
    console.log(`${checks} import-group database checks passed; no provider or AI requests.`);
  } finally {
    if (db) await db.$disconnect();
    if (!/^jobbatch_qa_[a-f0-9]{32}$/.test(schema)) throw Error('Invalid disposable QA schema');
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
