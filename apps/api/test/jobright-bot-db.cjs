// Real persistence and ingestion checks in a disposable PostgreSQL schema.
// The existing public schema/data are read only; no external job requests occur.
require('reflect-metadata');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'), { spawn } = require('node:child_process');
const { ConfigModule } = require('@nestjs/config'), { PrismaClient } = require('@prisma/client');
const { JobrightBotService } = require('../dist/job-pool/jobright-bot.service'), { JobPoolService } = require('../dist/job-pool/job-pool.service');
const bin = process.env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '/usr/bin');
async function command(name, args, env) {
  const child = spawn(path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')), args, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let message = ''; child.stderr.on('data', data => message += data); const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0) throw Error(name + ': ' + message.slice(0, 1000));
}
(async () => {
  await ConfigModule.forRoot(); const url = new URL(process.env.DATABASE_URL); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'QA requires local PostgreSQL.');
  const schema = 'qa_jobright_' + randomUUID().replaceAll('-', ''); assert.match(schema, /^qa_jobright_[a-f0-9]{32}$/);
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '10' };
  const folder = path.resolve('../../tmp/jobright-qa', schema); await fs.mkdir(folder, { recursive: true }); const dump = path.join(folder, 'schema.sql');
  await command('pg_dump', ['--schema-only', '--schema=public', '--no-owner', '--no-acl', '--file', dump], env);
  await fs.writeFile(dump, (await fs.readFile(dump, 'utf8')).replace(/\bpublic\b/g, schema)); await command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', dump], env);
  url.searchParams.set('schema', schema); const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    assert.equal((await db.$queryRawUnsafe('SELECT current_schema() AS name'))[0].name, schema);
    const master = await db.user.create({ data: { firstName: 'Master', lastName: 'QA', email: 'master@qa.invalid', passwordHash: 'qa-only', role: 'MASTER', status: 'ACTIVE' } });
    const pool = new JobPoolService(db, {}), service = new JobrightBotService(db, pool), instanceId = randomUUID();
    for (const role of ['ADMIN', 'BIDDER']) await assert.rejects(service.rotateKey({ id: master.id, role }), /Only Master/);
    const issued = await service.rotateKey(master); assert.match(issued.key, /^jrbot_[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(issued.status).includes('keyHash')); assert.ok(!JSON.stringify(issued.status).includes(issued.key));
    const digest = await service.authenticate('Bearer ' + issued.key); await assert.rejects(service.authenticate('Bearer ' + 'jrbot_' + 'a'.repeat(64)), /Invalid/);
    await service.settings(master, { searchUrls: ['https://jobright.ai/jobs/search'], blockedDomains: ['linkedin.com'], blockedWords: ['contract'], intervalMinutes: 5, maxJobsPerScan: 20 });
    await assert.rejects(service.settings(master, { searchUrls: ['https://evil.org/jobs'], blockedDomains: [], blockedWords: [], intervalMinutes: 5, maxJobsPerScan: 20 }), /jobright/i);
    const start = await service.command(master, 'start'); await new Promise(resolve => setTimeout(resolve, 30));
    const config = await service.workerConfig(digest, instanceId); assert.equal(config.startedAt, start.startedAt);
    const replacement = new JobrightBotService(db, pool); assert.equal((await replacement.status(master)).startedAt, start.startedAt, 'API restart must not move the cutoff');
    assert.equal((await service.command(master, 'start')).runId, start.runId, 'Repeated Start is idempotent');
    await assert.rejects(service.workerConfig(digest, randomUUID()), /Another worker/);
    const job = { externalId: 'qa001', sourceUrl: 'https://jobright.ai/jobs/info/qa001', originalUrl: 'https://careers.example.org/jobs/software-engineer',
      title: 'Software Engineer', company: 'Fresh Company', location: 'Remote, United States', description: 'Develop web applications, software and TypeScript APIs.', workArrangement: 'REMOTE', publishedAt: new Date().toISOString() };
    const send = jobs => service.ingest(digest, { instanceId, runId: start.runId, jobs });
    const results = (await send([job, { ...job, externalId: 'old', sourceUrl: 'https://jobright.ai/jobs/info/old', publishedAt: start.startedAt },
      { ...job, originalUrl: 'https://jobright.ai/jobs/info/qa001' }, { ...job, originalUrl: 'https://uk.linkedin.com/jobs/1' },
      { ...job, originalUrl: 'https://example.org/jobs/CONTRACT' }, { ...job, sourceUrl: 'https://evil.org/jobs/info/qa001' },
      { ...job, title: 'Principal Software Engineer', originalUrl: 'https://example.org/principal' }, { ...job, workArrangement: 'ONSITE' }])).results;
    assert.equal(results[0].status, 'imported'); assert.ok(results.slice(1).every(row => row.status === 'skipped'));
    const saved = await db.jobPoolJob.findUnique({ where: { id: results[0].id } }); assert.equal(saved.jobUrl, job.originalUrl); assert.equal(saved.publishedAt.toISOString(), job.publishedAt);
    assert.ok(saved.addedBatchId); assert.equal(saved.companyKey, 'freshcompany'); assert.equal(await db.jobPoolCompany.count(), 1);
    assert.equal((await db.jobPoolSource.findUnique({ where: { id: saved.sourceId } })).enabled, false, 'The generic importer must never poll browser sources');
    const concurrent = await Promise.all([send([job]), send([job])]); assert.ok(concurrent.every(row => row.results[0].status === 'duplicate')); assert.equal(await db.jobPoolJob.count(), 1);
    await service.heartbeat(digest, { instanceId, runId: start.runId, scanned: 10, skipped: 2 });
    const counts = (await service.status(master)).counts; await service.heartbeat(digest, { instanceId, runId: start.runId, scanned: 10, skipped: 2 }); assert.deepEqual((await service.status(master)).counts, counts, 'Heartbeat retries must not double-count');
    await service.command(master, 'login'); await service.heartbeat(digest, { instanceId, runId: start.runId, authenticated: true, loginCompleted: true });
    assert.equal((await service.status(master)).desired, 'running'); assert.equal((await service.status(master)).startedAt, start.startedAt, 'Re-login preserves the watch cutoff');
    await service.command(master, 'stop'); await assert.rejects(send([job]), /no longer watching/);
    const next = await service.command(master, 'start'); assert.notEqual(next.runId, start.runId); await assert.rejects(send([job]), /no longer watching/);
    await service.heartbeat(digest, { instanceId, release: true }); assert.equal((await service.status(master)).connected, false);
    const other = randomUUID(); await service.workerConfig(digest, other); assert.equal((await service.status(master)).connected, true, 'Clean restart can claim immediately');
    await service.rotateKey(master); await assert.rejects(service.authenticate('Bearer ' + issued.key), /Invalid/); await assert.rejects(service.workerConfig(digest, other), /revoked/);
    const current = await service.rotateKey(master); await db.user.update({ where: { id: master.id }, data: { status: 'SUSPENDED' } }); await assert.rejects(service.authenticate('Bearer ' + current.key), /inactive/);
    console.log('PASS: PostgreSQL persistence, posting cutoff, original URLs, exclusions, existing pool policies, canonical duplicates, company metadata, run cancellation, login resume, worker lease, key rotation and permissions.');
  } finally { await db.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE'); await db.$disconnect(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
